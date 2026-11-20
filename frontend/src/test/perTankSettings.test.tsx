import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import type { Tank, SystemConfig } from '@/store/useStore';
import {
  evaluateTank,
  evaluateNight,
  createTankTrackers,
  createNightState,
  ownTankThresholds,
  tankThresholds,
  isNightWatchedTank,
  ALERT_VALIDATION_MS,
  type EngineConfig,
  type EngineTank,
} from '@/lib/alertEngine';

const shared: EngineConfig = { lowLevelThreshold: 15, overflowThreshold: 95, minPh: 6.5, maxPh: 8.5 };
const own = { lowLevelThreshold: 25, overflowThreshold: 90, minPh: 6.8, maxPh: 8.2 };

describe('per-tank thresholds (tanks/{id}/thresholds)', () => {
  it('uses a tank\'s own values only when all four are valid', () => {
    expect(ownTankThresholds(own)).toEqual(own);
    expect(ownTankThresholds(null)).toBeNull();
    expect(ownTankThresholds({ lowLevelThreshold: 25, overflowThreshold: 90, minPh: 6.8 })).toBeNull(); // maxPh missing
    expect(ownTankThresholds({ ...own, lowLevelThreshold: 95 })).toBeNull(); // low above overflow
    expect(ownTankThresholds({ ...own, maxPh: 15 })).toBeNull();
    expect(ownTankThresholds({ ...own, minPh: '6' })).toBeNull();
    expect(tankThresholds({ thresholds: own }, shared)).toEqual(own);
    expect(tankThresholds({ thresholds: { ...own, minPh: 9 } }, shared)).toEqual(shared);
    expect(tankThresholds(null, shared)).toEqual(shared);
  });

  it('raises the low-water alert at the tank\'s own threshold', () => {
    const tank: EngineTank = { id: '2', name: 'Tank 2', lastUpdate: 1, waterLevel: 20, phLevel: 7, thresholds: own };
    const run = (t: EngineTank) => {
      const trackers = createTankTrackers();
      evaluateTank({ tank: t, config: shared, trackers, now: 1_000, getExisting: () => null });
      return evaluateTank({ tank: t, config: shared, trackers, now: 1_000 + ALERT_VALIDATION_MS, getExisting: () => null });
    };
    expect(run(tank).map(e => e.key)).toEqual(['lowLevel']); // 20 % < own 25 %
    expect(run({ ...tank, thresholds: null })).toEqual([]); // 20 % is fine for the shared 15 %
    // pH 8.4 is unsafe for the tank's own 8.2 limit
    expect(run({ ...tank, waterLevel: 50, phLevel: 8.4 }).map(e => e.key)).toEqual(['ph']);
  });
});

describe('night watch: tanks to watch (config/nightWatchTanks)', () => {
  /** Server ms for a Philippine (UTC+8) time on 19 Nov 2026 */
  const ph = (hour: number, minute = 0) => Date.UTC(2026, 10, 19, hour - 8, minute);

  it('watches a tank unless it is set to false (map or array form)', () => {
    expect(isNightWatchedTank('2', {})).toBe(true);
    expect(isNightWatchedTank('2', { nightWatchTanks: { '1': true } })).toBe(true);
    expect(isNightWatchedTank('2', { nightWatchTanks: { '2': false } })).toBe(false);
    // The database returns {"1":true,"2":false} as an array
    expect(isNightWatchedTank('2', { nightWatchTanks: [false, true, false] })).toBe(false);
    expect(isNightWatchedTank('1', { nightWatchTanks: [false, true, false] })).toBe(true);
  });

  it('raises nothing for an unwatched tank and closes its open night alerts', () => {
    const state = createNightState();
    const tank = { id: '2', name: 'Tank 2', lastUpdate: 1, waterLevel: 80, levelSensorOk: true, pumpOn: false };
    const config = { nightWatchTanks: { '2': false } };
    const events = [];
    // A 10 % drop in 10 min at 11 PM would raise "Possible Leak or Open Faucet" on a watched tank
    for (let m = 0; m <= 10; m++) {
      events.push(...evaluateNight({ tank: { ...tank, waterLevel: 80 - m }, config, state, now: ph(23, m), getExisting: () => null }));
    }
    expect(events).toEqual([]);

    const closed = evaluateNight({
      tank, config, state, now: ph(23, 11),
      getExisting: id => (id === 'alert-2-nightDrain' ? { timestamp: 1, resolved: false } : null),
    });
    expect(closed).toEqual([expect.objectContaining({ kind: 'close', notifId: 'alert-2-nightDrain' })]);
  });
});

// ---------------------------------------------------------------------------
// Admin Panel
// ---------------------------------------------------------------------------

const makeTank = (id: string, extra: Partial<Tank> = {}): Tank => ({
  id, name: `Reservoir Tank ${id}`, waterLevel: 50, phLevel: 7, waterHeight: 0, status: 'safe',
  assignedWorker: null, pumpOn: false, enabled: true, levelVmin: 0.25, levelVmax: 3, tankHeight: 1,
  capacityLiters: 200, levelOffset: 0, phNeutralVoltage: 2.5, phSlope: 0.18, phOffset: 0,
  phSensorOk: true, levelSensorOk: true, ...extra,
});

let mockTanks: Tank[];
let mockConfig: SystemConfig;
const mockUpdateTank = vi.fn().mockResolvedValue(undefined);
const mockUpdateConfig = vi.fn().mockResolvedValue(undefined);
const mockAddSystemLog = vi.fn();

vi.mock('@/store/useStore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/store/useStore')>();
  return {
    ...actual,
    useTanks: () => ({ tanks: mockTanks, updateTank: mockUpdateTank, serverTimeOffset: 0 }),
    useConfig: () => ({ config: mockConfig, updateConfig: mockUpdateConfig }),
    useWorkerStatus: () => ({ active: true, lastSeen: Date.now() }),
    addSystemLog: (...args: unknown[]) => mockAddSystemLog(...args),
  };
});
vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'admin1', username: 'admin', role: 'admin' } }),
}));
vi.mock('@/pages/admin/DeviceAccounts', () => ({ default: () => null }));
vi.mock('@/config/firebase', () => ({ database: {}, firestore: {}, auth: {} }));

import Configuration from '@/pages/admin/Configuration';

const save = () => {
  fireEvent.click(screen.getByRole('button', { name: /Save All Configurations/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Confirm & Apply' }));
};
const reservoir = () => within(screen.getByTestId('reservoir-settings'));
const choose = (name: string) => fireEvent.click(reservoir().getByRole('radio', { name }));
const logDetails = () => mockAddSystemLog.mock.calls.map(([e]) => (e as { details: string }).details).join(' | ');

describe('Admin Panel: tank choices in Reservoir Settings and Night Watch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTanks = [
      makeTank('1', { lastUpdate: Date.now() }),
      makeTank('2'),
      makeTank('3', { thresholds: own }),
      makeTank('4'),
    ];
    mockConfig = {
      ...shared, maintenanceMode: false, pumpControlLock: false, offlineThresholdSec: 30, repeatIntervalSec: 60,
    };
  });

  it('offers All tanks plus every tank, and marks tanks with their own values', () => {
    render(<Configuration />);
    const options = reservoir().getAllByRole('radio');
    expect(options.map(o => o.getAttribute('aria-label'))).toEqual(['All tanks', 'Tank 1', 'Tank 2', 'Tank 3', 'Tank 4']);
    expect(reservoir().getByRole('radio', { name: 'All tanks' })).toHaveAttribute('aria-checked', 'true');
    expect(reservoir().getByRole('radio', { name: 'Tank 3' })).toHaveTextContent('own');
    expect(reservoir().getByRole('radio', { name: 'Tank 2' })).not.toHaveTextContent('own');
    expect(reservoir().getByLabelText('Low-Level Threshold (%)')).toHaveValue(15);
  });

  it('shows a tank\'s own values, or the shared ones read-only when it has none', () => {
    render(<Configuration />);
    choose('Tank 3');
    expect(reservoir().getByRole('switch', { name: 'Own values for Reservoir Tank 3' })).toHaveAttribute('aria-checked', 'true');
    expect(reservoir().getByLabelText('Low-Level Threshold (%)')).toHaveValue(25);
    choose('Tank 2');
    expect(reservoir().getByRole('switch', { name: 'Own values for Reservoir Tank 2' })).toHaveAttribute('aria-checked', 'false');
    expect(reservoir().getByLabelText('Low-Level Threshold (%)')).toHaveValue(15);
    expect(reservoir().getByLabelText('Low-Level Threshold (%)')).toBeDisabled();
  });

  it('saves own values to that tank only and logs them', async () => {
    render(<Configuration />);
    choose('Tank 2');
    fireEvent.click(reservoir().getByRole('switch', { name: 'Own values for Reservoir Tank 2' }));
    fireEvent.change(reservoir().getByLabelText('Low-Level Threshold (%)'), { target: { value: '30' } });
    fireEvent.change(reservoir().getByLabelText('Maximum pH'), { target: { value: '8' } });
    // The shared values are not changed by a tank's own
    choose('All tanks');
    expect(reservoir().getByLabelText('Low-Level Threshold (%)')).toHaveValue(15);
    save();
    await waitFor(() => expect(mockUpdateTank).toHaveBeenCalledWith('2', {
      thresholds: { lowLevelThreshold: 30, overflowThreshold: 95, minPh: 6.5, maxPh: 8 },
    }));
    expect(mockUpdateTank.mock.calls.filter(([, u]) => 'thresholds' in u)).toHaveLength(1);
    expect(mockUpdateConfig).toHaveBeenCalledWith(expect.objectContaining({ lowLevelThreshold: 15 }));
    expect(logDetails()).toContain('Own thresholds for Reservoir Tank 2: Low 30% | Overflow 95% | pH 6.5 - 8');
  });

  it('turning own values off sends the tank back to the shared values', async () => {
    render(<Configuration />);
    choose('Tank 3');
    fireEvent.click(reservoir().getByRole('switch', { name: 'Own values for Reservoir Tank 3' }));
    save();
    await waitFor(() => expect(mockUpdateTank).toHaveBeenCalledWith('3', { thresholds: null }));
    expect(logDetails()).toContain('Reservoir Tank 3 uses the shared thresholds again');
  });

  it('refuses invalid own values and writes nothing', async () => {
    render(<Configuration />);
    choose('Tank 2');
    fireEvent.click(reservoir().getByRole('switch', { name: 'Own values for Reservoir Tank 2' }));
    fireEvent.change(reservoir().getByLabelText('Low-Level Threshold (%)'), { target: { value: '96' } });
    save();
    await new Promise(r => setTimeout(r, 50));
    expect(mockUpdateConfig).not.toHaveBeenCalled();
    expect(mockUpdateTank.mock.calls.filter(([, u]) => 'thresholds' in u)).toHaveLength(0);
  });

  it('lists every tank under Night Watch and saves the unticked ones as not watched', async () => {
    mockConfig = { ...mockConfig, nightWatchTanks: [false, true, true, true, true] }; // array form from the database
    render(<Configuration />);
    const group = within(screen.getByRole('group', { name: 'Tanks to watch' }));
    const boxes = group.getAllByRole('checkbox');
    expect(boxes).toHaveLength(4);
    boxes.forEach(b => expect(b).toBeChecked());
    fireEvent.click(group.getByLabelText('Reservoir Tank 2'));
    expect(group.getByLabelText('Reservoir Tank 2')).not.toBeChecked();
    save();
    await waitFor(() => expect(mockUpdateConfig).toHaveBeenCalledWith(expect.objectContaining({
      nightWatchTanks: { '1': true, '2': false, '3': true, '4': true },
    })));
    expect(logDetails()).toContain('Night Watch Tanks (1, 2, 3, 4 -> 1, 3, 4)');
  });

  it('warns when no tank is watched', () => {
    mockConfig = { ...mockConfig, nightWatchTanks: { '1': false, '2': false, '3': false, '4': false } };
    render(<Configuration />);
    expect(screen.getByText(/No tank is watched/)).toBeInTheDocument();
  });
});
