import { describe, it, expect } from 'vitest';
import {
  evaluateNight,
  createNightState,
  nightWindowAt,
  nightSettings,
  formatHour12,
  restoreNightState,
  NIGHT_DRAIN_CONFIRM_MS,
  NIGHT_STEADY_MS,
  type NightConfig,
  type NightEvent,
  type NightState,
  type NightTank,
  type ExistingAlert,
} from '@/lib/alertEngine';

/** Server ms for a Philippine (UTC+8) wall-clock time on 19-20 Nov 2026 */
const ph = (day: number, hour: number, minute = 0, second = 0) => Date.UTC(2026, 10, day, hour - 8, minute, second);
const MIN = 60_000;

const tank: NightTank = {
  id: '1', name: 'Tank 1', enabled: true, lastUpdate: 1, waterLevel: 80, levelSensorOk: true, pumpOn: false, capacityLiters: 200,
};
const config: NightConfig = {};

/** Feeds readings to one detector; each step is [time, tank overrides]. Returns all events in order. */
function feed(steps: Array<[number, Partial<NightTank>]>, opts: { cfg?: NightConfig; existing?: Record<string, ExistingAlert>; state?: NightState } = {}) {
  const state = opts.state ?? createNightState();
  const events: NightEvent[] = [];
  for (const [now, overrides] of steps) {
    events.push(...evaluateNight({
      tank: { ...tank, ...overrides }, config: opts.cfg ?? config, state, now,
      getExisting: id => opts.existing?.[id] ?? null,
    }));
  }
  return { state, events };
}

/** One reading every 30 s from `start` for `minutes`, level from `level(minute)` */
function series(start: number, minutes: number, level: (minute: number) => number, extra: Partial<NightTank> = {}): Array<[number, Partial<NightTank>]> {
  const steps: Array<[number, Partial<NightTank>]> = [];
  for (let s = 0; s <= minutes * 60; s += 30) steps.push([start + s * 1000, { waterLevel: level(s / 60), ...extra }]);
  return steps;
}

describe('night window (Philippine time)', () => {
  it('runs from 10 PM to 3 AM across midnight', () => {
    const w = nightWindowAt(ph(19, 23), 22, 3)!;
    expect(w.start).toBe(ph(19, 22));
    expect(w.end).toBe(ph(20, 3));
    expect(nightWindowAt(ph(20, 2, 59), 22, 3)!.start).toBe(ph(19, 22));
    expect(nightWindowAt(ph(20, 3), 22, 3)).toBeNull();
    expect(nightWindowAt(ph(19, 21, 59), 22, 3)).toBeNull();
    expect(nightWindowAt(ph(19, 12), 22, 3)).toBeNull();
  });

  it('handles a window that does not cross midnight, and none when start equals end', () => {
    expect(nightWindowAt(ph(19, 1), 0, 4)!.start).toBe(ph(19, 0));
    expect(nightWindowAt(ph(19, 1), 5, 5)).toBeNull();
  });

  it('uses defaults for missing or invalid settings, and never a threshold under 3 %', () => {
    expect(nightSettings(undefined)).toEqual({ enabled: true, startHour: 22, endHour: 3, fastDrop: 5, slowDrop: 3 });
    expect(nightSettings({ nightStartHour: 25, nightFastDropPercent: 1, nightSlowDropPercent: 4 })).toMatchObject({ startHour: 22, fastDrop: 5, slowDrop: 4 });
    expect(nightSettings({ nightWatchEnabled: false }).enabled).toBe(false);
  });

  it('formats hours in 12-hour time', () => {
    expect([0, 3, 12, 22].map(formatHour12)).toEqual(['12 AM', '3 AM', '12 PM', '10 PM']);
  });
});

describe('night watch: fast drop (open faucet)', () => {
  it('raises once when the level falls 5 % within 30 min at night, then recovers when it holds', () => {
    // 80 % falling 2 % every 2 min from 23:00, stopping at 70 %
    const steps = series(ph(19, 23), 20, m => Math.max(70, 80 - 2 * Math.floor(m / 2)));
    const { events } = feed(steps);
    const raises = events.filter(e => e.kind === 'raise');
    expect(raises).toHaveLength(1);
    expect(raises[0]).toMatchObject({ key: 'nightDrain', notifId: 'alert-1-nightDrain', level: 'danger', title: 'Possible Leak or Open Faucet' });
    expect(raises[0].message).toContain('10 PM to 3 AM');
    expect(raises[0].message).toMatch(/about \d+ L/);
    expect(events.some(e => e.kind === 'recover')).toBe(false); // steady for only 10 min so far

    const recovered = feed(series(ph(19, 23), 60, m => Math.max(70, 80 - 2 * Math.floor(m / 2)))).events;
    const recover = recovered.find(e => e.kind === 'recover')!;
    expect(recover).toMatchObject({ key: 'nightDrain', title: 'Night Water Loss Stopped' });
  });

  it('needs the drop to last a minute: a short dip is ignored', () => {
    const steps = series(ph(19, 23), 10, m => (m >= 4 && m < 4.5 ? 70 : 80));
    expect(feed(steps).events).toEqual([]);
  });

  it('ignores the same drop during the day', () => {
    const steps = series(ph(19, 14), 40, m => Math.max(60, 80 - 2 * Math.floor(m / 2)));
    expect(feed(steps).events).toEqual([]);
  });

  it('does not count water used before the window starts', () => {
    // Level fell from 90 to 70 at 21:50; steady from 22:00
    const before = series(ph(19, 21, 40), 19, m => (m < 10 ? 90 : 70));
    const after = series(ph(19, 22), 30, () => 70);
    expect(feed([...before, ...after]).events).toEqual([]);
  });

  it('ignores readings while the pump runs, during a level sensor fault and during live calibration', () => {
    const falling = (m: number) => Math.max(50, 80 - 2 * Math.floor(m / 2));
    expect(feed(series(ph(19, 23), 30, falling, { pumpOn: true })).events).toEqual([]);
    expect(feed(series(ph(19, 23), 30, falling, { levelSensorOk: false })).events).toEqual([]);
    expect(feed(series(ph(19, 23), 30, falling, { calibrationUntil: ph(19, 23, 45) })).events).toEqual([]);
  });

  it('stays quiet in maintenance mode and when switched off', () => {
    const falling = (m: number) => Math.max(50, 80 - 2 * Math.floor(m / 2));
    expect(feed(series(ph(19, 23), 30, falling), { cfg: { maintenanceMode: true } }).events).toEqual([]);
    expect(feed(series(ph(19, 23), 30, falling), { cfg: { nightWatchEnabled: false } }).events).toEqual([]);
  });

  it('restarts tracking after a pause in evaluation, so a drop during the pause is not raised', () => {
    const first = series(ph(19, 23), 5, () => 80);
    const afterGap = series(ph(19, 23, 20), 10, () => 60); // e.g. maintenance mode in between
    expect(feed([...first, ...afterGap]).events.filter(e => e.key === 'nightDrain')).toEqual([]);
  });

  it('repeats until acknowledged, and stays silent once acknowledged', () => {
    const steps = series(ph(19, 23), 12, m => Math.max(60, 80 - 2 * Math.floor(m / 2)));
    const unacked = feed(steps, { cfg: { repeatIntervalSec: 60 } }).events;
    expect(unacked.filter(e => e.kind === 'repeat').length).toBeGreaterThan(0);

    const state = createNightState();
    const raised = feed(steps.slice(0, 16), { state }).events;
    expect(raised.filter(e => e.kind === 'raise')).toHaveLength(1);
    const acked = { 'alert-1-nightDrain': { timestamp: ph(19, 23, 5), acknowledged: true, resolved: false } };
    const rest = feed(steps.slice(16), { state, existing: acked, cfg: { repeatIntervalSec: 60 } }).events;
    expect(rest.filter(e => e.kind === 'repeat')).toEqual([]);
  });

  it('adopts an alert that is already active (worker restart) and resolves it when the level holds', () => {
    const existing = { 'alert-1-nightDrain': { timestamp: ph(19, 23), acknowledged: false, resolved: false } };
    const { events } = feed(series(ph(19, 23, 30), 20, () => 60), { existing });
    expect(events.filter(e => e.kind === 'raise')).toEqual([]);
    expect(events.filter(e => e.kind === 'recover')).toHaveLength(1);
  });

  it('waits the confirm time before raising', () => {
    expect(NIGHT_DRAIN_CONFIRM_MS).toBe(MIN);
    expect(NIGHT_STEADY_MS).toBe(15 * MIN);
  });
});

describe('night watch: slow leak (whole night)', () => {
  /** One reading every 5 min across the night, then one after 3 AM */
  function night(level: (minutesSince10pm: number) => number, extra: (m: number) => Partial<NightTank> = () => ({})) {
    const steps: Array<[number, Partial<NightTank>]> = [];
    // every 30 s so the gap reset never triggers
    for (let s = 0; s <= 5 * 3600; s += 30) {
      const m = s / 60;
      steps.push([ph(19, 22) + s * 1000, { waterLevel: level(m), ...extra(m) }]);
    }
    steps.push([ph(20, 3, 0, 30), { waterLevel: level(300) }]);
    return steps;
  }

  it('warns once at 3 AM when the level fell 3 % or more in small steps', () => {
    // 80 -> 76 in 2 % steps, two hours apart: never 5 % in 30 min
    const { events } = feed(night(m => 80 - 2 * Math.floor(m / 120)));
    expect(events.filter(e => e.key === 'nightDrain')).toEqual([]);
    const leaks = events.filter(e => e.key === 'nightLeak');
    expect(leaks).toHaveLength(1);
    expect(leaks[0]).toMatchObject({ kind: 'raise', level: 'warning', title: 'Possible Slow Leak' });
    expect(leaks[0].message).toContain('4%');
    expect(leaks[0].message).toContain('about 8 L');
  });

  it('says nothing for a steady night or a single 2 % sensor step', () => {
    expect(feed(night(() => 80)).events).toEqual([]);
    expect(feed(night(m => (m < 100 ? 80 : 78))).events).toEqual([]);
  });

  it('does not count the pump refilling the tank as a loss, but adds the drops on both sides of it', () => {
    // 80 -> 78 (2 %), pump refills to 90, then 90 -> 88 (2 %): 4 % in total
    const level = (m: number) => (m < 100 ? (m < 50 ? 80 : 78) : m < 110 ? 85 : m < 200 ? 90 : 88);
    const pump = (m: number) => ({ pumpOn: m >= 100 && m < 110 });
    const leaks = feed(night(level, pump)).events.filter(e => e.key === 'nightLeak');
    expect(leaks).toHaveLength(1);
    expect(leaks[0].message).toContain('4%');
  });

  it('is not sent on top of a fast-drop alert the same night', () => {
    const level = (m: number) => (m < 60 ? 80 : Math.max(60, 80 - 2 * Math.floor((m - 60) / 2)));
    const events = feed(night(level)).events;
    expect(events.filter(e => e.key === 'nightDrain' && e.kind === 'raise')).toHaveLength(1);
    expect(events.filter(e => e.key === 'nightLeak')).toEqual([]);
  });

  it('closes last night’s notice when the next night starts', () => {
    const existing = { 'alert-1-nightLeak': { timestamp: ph(19, 3), acknowledged: true, resolved: false } };
    const { events } = feed([[ph(19, 22, 0, 10), { waterLevel: 80 }]], { existing });
    expect(events).toEqual([expect.objectContaining({ kind: 'close', notifId: 'alert-1-nightLeak' })]);
  });
});

describe('night watch: state saved by the worker (N6)', () => {
  /** What the database gives back: nulls and empty arrays are dropped */
  const viaDatabase = (state: NightState) =>
    JSON.parse(JSON.stringify(state, (_k, v) => (v === null || (Array.isArray(v) && v.length === 0) ? undefined : v)));

  it('keeps the slow-leak total across a restart in the middle of the night', () => {
    // 2 % lost before a 00:00 restart, 2 % after it: 4 % in total, above the 3 % threshold
    const before = feed(series(ph(19, 22), 120, m => 80 - (2 * m) / 120));
    const restored = restoreNightState(viaDatabase(before.state));
    expect(restored.committedDrop + ((restored.segmentPeak ?? 0) - (restored.segmentLast ?? 0))).toBeCloseTo(2, 5);

    const after = feed([...series(ph(20, 0, 5), 170, m => 78 - (2 * m) / 170), [ph(20, 3, 1), { waterLevel: 76 }]], { state: restored });
    const leaks = after.events.filter(e => e.key === 'nightLeak');
    expect(leaks).toHaveLength(1);
    expect(leaks[0].message).toMatch(/lost 4%/);
  });

  it('without the saved state the same night is missed (the old behaviour)', () => {
    const after = feed([...series(ph(20, 0, 5), 170, m => 78 - (2 * m) / 170), [ph(20, 3, 1), { waterLevel: 76 }]]);
    expect(after.events.filter(e => e.key === 'nightLeak')).toEqual([]);
  });

  it('falls back to a fresh state for missing or malformed data', () => {
    expect(restoreNightState(null)).toEqual(createNightState());
    expect(restoreNightState({ windowStart: 'x', samples: [{ t: 1 }, { t: 2, level: 50 }], active: 'yes' })).toMatchObject({
      windowStart: 0, samples: [{ t: 2, level: 50 }], active: false, segmentPeak: null,
    });
  });
});
