import { describe, it, expect } from 'vitest';
import {
  evaluateTank,
  createTankTrackers,
  isControllerOffline,
  offlineThresholdMs,
  repeatIntervalMs,
  type EngineTank,
  type EngineConfig,
  type ExistingAlert,
} from '@/lib/alertEngine';

const config: EngineConfig = { lowLevelThreshold: 15, overflowThreshold: 95, minPh: 6.5, maxPh: 8.5 };
const healthy: EngineTank = {
  id: '1', name: 'Tank 1', enabled: true, lastUpdate: 1, waterLevel: 50, phLevel: 7.2, phSensorOk: true, levelSensorOk: true,
};

function run(tank: EngineTank, times: number[], opts: { cfg?: EngineConfig; existing?: Record<string, ExistingAlert> } = {}) {
  const trackers = createTankTrackers();
  const all = times.map(now => evaluateTank({
    tank, config: opts.cfg ?? config, trackers, now, getExisting: id => opts.existing?.[id] ?? null,
  }));
  return { trackers, all, flat: all.flat() };
}

describe('alertEngine', () => {
  it('raises nothing for a healthy tank', () => {
    expect(run(healthy, [0, 6000, 12000]).flat).toEqual([]);
  });

  it('waits 5 s before raising, then raises once', () => {
    const { all } = run({ ...healthy, phLevel: 9.4 }, [1000, 3000, 6000, 7000]);
    expect(all[0]).toEqual([]);
    expect(all[1]).toEqual([]);
    expect(all[2]).toHaveLength(1);
    expect(all[2][0]).toMatchObject({ kind: 'raise', key: 'ph', level: 'danger', notifId: 'alert-1-ph' });
    expect(all[3]).toEqual([]);
  });

  it('follows the firmware: low water is danger, overflow is warning, comparisons are strict', () => {
    expect(run({ ...healthy, waterLevel: 10 }, [1000, 6000]).flat[0]).toMatchObject({ key: 'lowLevel', level: 'danger' });
    expect(run({ ...healthy, waterLevel: 97 }, [1000, 6000]).flat[0]).toMatchObject({ key: 'overflow', level: 'warning' });
    // exactly on the threshold is not abnormal
    expect(run({ ...healthy, waterLevel: 15 }, [1000, 6000]).flat).toEqual([]);
    expect(run({ ...healthy, waterLevel: 95 }, [1000, 6000]).flat).toEqual([]);
  });

  it('repeats an unacknowledged alert only after the configured interval', () => {
    const { all } = run({ ...healthy, phLevel: 9.4 }, [1000, 6000, 30000, 66000], { cfg: { ...config, repeatIntervalSec: 60 } });
    expect(all[2]).toEqual([]);
    expect(all[3][0]).toMatchObject({ kind: 'repeat', key: 'ph' });
  });

  it('adopts an alert that is already active and acknowledged instead of raising it again', () => {
    const existing = { 'alert-1-ph': { timestamp: 500, acknowledged: true, resolved: false } };
    const { flat, trackers } = run({ ...healthy, phLevel: 9.4 }, [1000, 6000, 70000, 200000], { existing });
    expect(flat).toEqual([]);
    expect(trackers.ph.status).toBe('CRITICAL');
  });

  it('recovers after 5 s inside the hysteresis band and can raise again later', () => {
    const trackers = createTankTrackers();
    const step = (tank: EngineTank, now: number) => evaluateTank({ tank, config, trackers, now, getExisting: () => null });
    step({ ...healthy, waterLevel: 10 }, 1000);
    expect(step({ ...healthy, waterLevel: 10 }, 6000)[0].kind).toBe('raise');
    // 16 % is above the threshold but inside the 2 % hysteresis: still active
    expect(step({ ...healthy, waterLevel: 16 }, 7000)).toEqual([]);
    expect(step({ ...healthy, waterLevel: 16 }, 13000).filter(e => e.kind === 'recover')).toEqual([]);
    step({ ...healthy, waterLevel: 40 }, 80000);
    const recovered = step({ ...healthy, waterLevel: 40 }, 85000);
    expect(recovered[0]).toMatchObject({ kind: 'recover', key: 'lowLevel', title: 'Low Water Level Recovered' });
    step({ ...healthy, waterLevel: 40 }, 86000); // RECOVERED -> NORMAL
    step({ ...healthy, waterLevel: 5 }, 87000);
    expect(step({ ...healthy, waterLevel: 5 }, 92000)[0].kind).toBe('raise');
  });

  it('raises a sensor fault and never a false low-water alarm from a broken sensor', () => {
    const { flat } = run({ ...healthy, levelSensorOk: false, waterLevel: 0 }, [1000, 6000, 12000]);
    expect(flat.map(e => e.key)).toEqual(['levelFault']);
  });

  it('ignores physically impossible readings', () => {
    expect(run({ ...healthy, waterLevel: -999, phLevel: 99 }, [1000, 6000]).flat).toEqual([]);
    expect(run({ ...healthy, waterLevel: NaN }, [1000, 6000]).flat).toEqual([]);
  });

  it('stays silent for disabled tanks, tanks that never reported, and maintenance mode', () => {
    const bad = { ...healthy, phLevel: 2 };
    expect(run({ ...bad, enabled: false }, [1000, 6000]).flat).toEqual([]);
    expect(run({ ...bad, lastUpdate: undefined }, [1000, 6000]).flat).toEqual([]);
    expect(run(bad, [1000, 6000], { cfg: { ...config, maintenanceMode: true } }).flat).toEqual([]);
  });

  it('offline helper treats never-reported tanks as planned and clamps the threshold', () => {
    expect(isControllerOffline(undefined, 100000, 30000)).toBe(false);
    expect(isControllerOffline(60000, 100000, 30000)).toBe(true);
    expect(isControllerOffline(80000, 100000, 30000)).toBe(false);
    expect(offlineThresholdMs({ offlineThresholdSec: 5 })).toBe(20000);
    expect(offlineThresholdMs(null)).toBe(30000);
    expect(repeatIntervalMs({ repeatIntervalSec: 1 })).toBe(10000);
  });
});
