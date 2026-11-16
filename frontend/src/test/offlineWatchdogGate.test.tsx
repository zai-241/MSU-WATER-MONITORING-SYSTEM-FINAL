import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';
import type { Tank } from '@/store/useStore';
import { OFFLINE_CHECK_SETTLE_MS } from '@/lib/constants';

// The browser fallback watchdog (worker down) must not report a controller offline from
// data it held while asleep or disconnected: that caused offline/back-online pairs a second apart.

const state: { tanks: Tank[]; connected: boolean } = { tanks: [], connected: true };
const mockSync = vi.fn().mockResolvedValue(true);

vi.mock('@/store/useStore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/store/useStore')>();
  return {
    ...actual,
    useTanks: () => ({ tanks: state.tanks, serverTimeOffset: 0 }),
    useConfig: () => ({ config: { lowLevelThreshold: 15, overflowThreshold: 95, minPh: 6.5, maxPh: 8.5, maintenanceMode: false, pumpControlLock: false } }),
    useNotifications: () => ({ notifications: [], addNotification: vi.fn().mockResolvedValue('created'), resolveNotification: vi.fn().mockResolvedValue(null) }),
    useWorkerStatus: () => ({ active: false, lastSeen: null, loaded: true }),
    useConnectionState: () => state.connected,
    addSystemLog: vi.fn(),
    syncTankOfflineState: (...args: unknown[]) => mockSync(...args),
  };
});
vi.mock('@/utils/alertSound', () => ({ alertSound: { startAlert: vi.fn(), stopAlert: vi.fn() } }));
vi.mock('@/config/firebase', () => ({ database: {}, firestore: {}, auth: {} }));

import SystemMonitor from '@/components/SystemMonitor';
import { canJudgeControllerOffline } from '@/store/useStore';

const tank = (overrides: Partial<Tank> = {}): Tank => ({
  id: '1',
  name: 'Reservoir Tank 1',
  waterLevel: 50,
  phLevel: 7,
  waterHeight: 0.5,
  status: 'safe',
  assignedWorker: null,
  pumpOn: false,
  enabled: true,
  lastUpdate: Date.now() - 120_000, // two minutes old: looks offline
  controllerOffline: false,
  ...overrides,
} as Tank);

const offlineCalls = () => mockSync.mock.calls.filter((c) => c[2] === true);
const recoveryCalls = () => mockSync.mock.calls.filter((c) => c[2] === false);

const setVisibility = (value: 'visible' | 'hidden') => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => value });
  document.dispatchEvent(new Event('visibilitychange'));
};

describe('canJudgeControllerOffline', () => {
  it('needs a live connection that has been up for the settle time', () => {
    expect(canJudgeControllerOffline(false, 0, 60_000)).toBe(false);
    expect(canJudgeControllerOffline(true, null, 60_000)).toBe(false);
    expect(canJudgeControllerOffline(true, 55_000, 60_000)).toBe(false);
    expect(canJudgeControllerOffline(true, 60_000 - OFFLINE_CHECK_SETTLE_MS, 60_000)).toBe(true);
  });
});

describe('Browser offline watchdog gate', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    state.connected = true;
    state.tanks = [tank()];
    setVisibility('visible');
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('waits for the settle time after load before marking a stale controller offline', () => {
    render(<SystemMonitor />);
    expect(offlineCalls()).toHaveLength(0);

    act(() => { vi.advanceTimersByTime(OFFLINE_CHECK_SETTLE_MS - 2000); });
    expect(offlineCalls()).toHaveLength(0);

    act(() => { vi.advanceTimersByTime(4000); });
    expect(offlineCalls()).toHaveLength(1);
  });

  it('never marks offline while this browser is disconnected', () => {
    state.connected = false;
    render(<SystemMonitor />);
    act(() => { vi.advanceTimersByTime(60_000); });
    expect(offlineCalls()).toHaveLength(0);
  });

  it('waits again after the page wakes up, and fresh data arriving in time prevents the alert', () => {
    state.tanks = [tank({ lastUpdate: Date.now() })];
    const { rerender } = render(<SystemMonitor />);
    act(() => { vi.advanceTimersByTime(OFFLINE_CHECK_SETTLE_MS + 2000); });

    // The page sleeps (timers frozen); when it comes back its copy of lastUpdate is old
    setVisibility('hidden');
    vi.setSystemTime(Date.now() + 60_000);
    act(() => { setVisibility('visible'); });
    rerender(<SystemMonitor />);
    act(() => { vi.advanceTimersByTime(2000); });
    expect(offlineCalls()).toHaveLength(0);

    // The listener re-syncs within the settle time with a fresh lastUpdate
    state.tanks = [tank({ lastUpdate: Date.now() })];
    rerender(<SystemMonitor />);
    act(() => { vi.advanceTimersByTime(OFFLINE_CHECK_SETTLE_MS); });
    expect(offlineCalls()).toHaveLength(0);
  });

  it('still reports recovery right away', () => {
    state.tanks = [tank({ lastUpdate: Date.now(), controllerOffline: true })];
    render(<SystemMonitor />);
    expect(recoveryCalls()).toHaveLength(1);
  });
});
