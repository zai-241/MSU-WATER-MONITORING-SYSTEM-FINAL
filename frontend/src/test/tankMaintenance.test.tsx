import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import type { Tank, SystemConfig } from '@/store/useStore';
import type { UserProfile } from '@/services/authService';
import {
  evaluateTank,
  evaluateNight,
  createTankTrackers,
  createNightState,
  isTankInMaintenance,
  type EngineConfig,
  type EngineTank,
} from '@/lib/alertEngine';

const makeTank = (id: string, changes: Partial<Tank> = {}): Tank => ({
  id, name: `Reservoir Tank ${id}`, waterLevel: 60, phLevel: 7.1, waterHeight: 0.5, status: 'safe',
  assignedWorker: null, pumpOn: false, enabled: true, levelVmin: 0.25, levelVmax: 3, tankHeight: 1,
  capacityLiters: 200, levelOffset: 0, phNeutralVoltage: 2.5, phSlope: 0.18, phOffset: 0,
  phSensorOk: true, levelSensorOk: true, lastUpdate: Date.now(), controllerOffline: false,
  ...changes,
});

const state: { tanks: Tank[]; config: SystemConfig } = { tanks: [], config: {} as SystemConfig };
const mockUpdateTank = vi.fn();
const mockAddSystemLog = vi.fn();

vi.mock('@/store/useStore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/store/useStore')>();
  return {
    ...actual,
    useTanks: () => ({ tanks: state.tanks, isLive: true, updateTank: mockUpdateTank, serverTimeOffset: 0 }),
    useConfig: () => ({ config: state.config, updateConfig: vi.fn().mockResolvedValue(undefined) }),
    useServerTimeOffset: () => 0,
    useWorkerStatus: () => ({ active: true, lastSeen: Date.now() }),
    addSystemLog: (...args: unknown[]) => mockAddSystemLog(...args),
  };
});
const admin = {
  id: 'admin1', username: 'admin', email: 'admin@example.com', role: 'admin', jobTitle: 'admin', status: 'active', createdAt: 0,
} as UserProfile;
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ currentUser: admin }) }));
vi.mock('@/pages/admin/DeviceAccounts', () => ({ default: () => null }));
vi.mock('firebase/firestore', () => ({ collection: vi.fn(), onSnapshot: vi.fn(() => vi.fn()), query: vi.fn() }));
vi.mock('@/config/firebase', () => ({ database: {}, firestore: {}, auth: {} }));

import Dashboard from '@/pages/Dashboard';
import Configuration from '@/pages/admin/Configuration';

const engineConfig: EngineConfig = { lowLevelThreshold: 15, overflowThreshold: 95, minPh: 6.5, maxPh: 8.5 };
const lowTank: EngineTank = {
  id: '2', name: 'Tank 2', enabled: true, lastUpdate: 1, waterLevel: 5, phLevel: 7, phSensorOk: true, levelSensorOk: true,
};

describe('per-tank maintenance: alert engine', () => {
  it('counts the tank switch or the system-wide switch', () => {
    expect(isTankInMaintenance({ maintenanceMode: true }, { maintenanceMode: false })).toBe(true);
    expect(isTankInMaintenance({ maintenanceMode: false }, { maintenanceMode: true })).toBe(true);
    expect(isTankInMaintenance({}, {})).toBe(false);
    expect(isTankInMaintenance(null, null)).toBe(false);
  });

  it('silences only the tank under maintenance', () => {
    const run = (tank: EngineTank) => {
      const trackers = createTankTrackers();
      return [1000, 6000, 12000].flatMap(now => evaluateTank({ tank, config: engineConfig, trackers, now, getExisting: () => null }));
    };
    expect(run({ ...lowTank, maintenanceMode: true })).toEqual([]);
    expect(run(lowTank)[0]).toMatchObject({ kind: 'raise', key: 'lowLevel', notifId: 'alert-2-lowLevel' });
  });

  it('pauses the night watch for that tank', () => {
    const nightState = createNightState();
    nightState.lastEvalAt = 123;
    const events = evaluateNight({
      tank: { ...lowTank, maintenanceMode: true }, config: {}, state: nightState, now: Date.UTC(2026, 10, 19, 15), getExisting: () => null,
    });
    expect(events).toEqual([]);
    expect(nightState.lastEvalAt).toBe(0); // tracking restarts when maintenance ends
  });
});

describe('per-tank maintenance: Dashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.config = {
      lowLevelThreshold: 15, overflowThreshold: 95, minPh: 6.5, maxPh: 8.5,
      maintenanceMode: false, pumpControlLock: false, offlineThresholdSec: 30, repeatIntervalSec: 60,
    };
    state.tanks = [makeTank('1'), makeTank('2', { maintenanceMode: true })];
  });

  it('marks the tank and disables only its pump toggle', () => {
    render(<Dashboard />);
    expect(screen.getAllByTestId('tank-maintenance-badge')).toHaveLength(1);
    expect(screen.getByTestId('tank-maintenance-notice')).toHaveTextContent('alerts for this tank are paused and its pump is held off');
    const toggles = screen.getAllByTestId('pump-toggle');
    expect(toggles[0]).not.toBeDisabled();
    expect(toggles[1]).toBeDisabled();
    expect(toggles[1]).toHaveAttribute('title', 'Pump toggle disabled: Maintenance mode');
  });

  it('shows the badge on a planned tank (no controller yet)', () => {
    state.tanks = [makeTank('1'), makeTank('3', { lastUpdate: undefined, maintenanceMode: true })];
    render(<Dashboard />);
    expect(screen.getByTestId('tank-maintenance-badge')).toHaveTextContent('Under Maintenance');
    expect(screen.queryByText('Planned - IoT not yet installed')).not.toBeInTheDocument();
  });
});

describe('per-tank maintenance: Admin Panel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUpdateTank.mockResolvedValue(undefined);
    state.config = {
      lowLevelThreshold: 15, overflowThreshold: 95, minPh: 6.5, maxPh: 8.5,
      maintenanceMode: false, pumpControlLock: false, offlineThresholdSec: 30, repeatIntervalSec: 60,
    };
    state.tanks = ['1', '2', '3', '4'].map(id => makeTank(id, id === '1' ? {} : { lastUpdate: undefined }));
  });

  it('has one switch per tank, 1 to 4', () => {
    render(<Configuration />);
    const card = screen.getByTestId('tank-maintenance-settings');
    for (const id of ['1', '2', '3', '4']) {
      expect(within(card).getByRole('switch', { name: `Maintenance for Reservoir Tank ${id}` })).toHaveAttribute('aria-checked', 'false');
    }
  });

  it('turns maintenance on for Tank 3 only, after confirming, and logs it', async () => {
    render(<Configuration />);
    fireEvent.click(screen.getByRole('switch', { name: 'Maintenance for Reservoir Tank 3' }));
    const dialog = screen.getByRole('alertdialog');
    expect(dialog).toHaveTextContent('The other tanks are not affected');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Enable' }));
    await waitFor(() => expect(mockUpdateTank).toHaveBeenCalledWith('3', { maintenanceMode: true }));
    expect(mockUpdateTank).toHaveBeenCalledTimes(1);
    expect(mockAddSystemLog).toHaveBeenCalledWith(expect.objectContaining({
      details: 'Maintenance mode enabled for Reservoir Tank 3', tankId: '3',
    }));
  });

  it('turns it off again', async () => {
    state.tanks = state.tanks.map(t => (t.id === '4' ? { ...t, maintenanceMode: true } : t));
    render(<Configuration />);
    const sw = screen.getByRole('switch', { name: 'Maintenance for Reservoir Tank 4' });
    expect(sw).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(sw);
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Disable' }));
    await waitFor(() => expect(mockUpdateTank).toHaveBeenCalledWith('4', { maintenanceMode: false }));
  });
});
