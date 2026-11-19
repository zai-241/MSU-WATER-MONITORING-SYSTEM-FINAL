import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';
import type { Notification } from '@/store/useStore';
import { ALERT_SERVICE_OFFLINE_ID } from '@/lib/alertEngine';

const state: {
  worker: { active: boolean; lastSeen: number | null; loaded: boolean };
  notifications: Notification[];
  maintenanceMode: boolean;
  connected: boolean;
  /** What a fresh read of system/worker/lastSeen from the server returns */
  serverLastSeen: () => number | null | undefined;
} = {
  worker: { active: false, lastSeen: null, loaded: true }, notifications: [], maintenanceMode: false,
  connected: true, serverLastSeen: () => null,
};

const mockAdd = vi.fn().mockResolvedValue('created');
const mockResolve = vi.fn().mockResolvedValue(null);

vi.mock('@/store/useStore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/store/useStore')>();
  return {
    ...actual,
    useTanks: () => ({ tanks: [], serverTimeOffset: 0 }),
    useConfig: () => ({ config: { lowLevelThreshold: 15, overflowThreshold: 95, minPh: 6.5, maxPh: 8.5, maintenanceMode: state.maintenanceMode, pumpControlLock: false } }),
    useNotifications: () => ({ notifications: state.notifications, addNotification: mockAdd, resolveNotification: mockResolve }),
    useWorkerStatus: () => state.worker,
    useConnectionState: () => state.connected,
    fetchWorkerLastSeen: () => Promise.resolve(state.serverLastSeen()),
    serverNow: () => Date.now(),
    addSystemLog: vi.fn(),
    syncTankOfflineState: vi.fn(),
  };
});
vi.mock('@/utils/alertSound', () => ({ alertSound: { startAlert: vi.fn(), stopAlert: vi.fn() } }));
vi.mock('@/config/firebase', () => ({ database: {}, firestore: {}, auth: {} }));

import SystemMonitor from '@/components/SystemMonitor';

const noticeCalls = () => mockAdd.mock.calls.filter(([n]) => n.id === ALERT_SERVICE_OFFLINE_ID);
/** Moves time on in 2 s steps (the monitor's tick), re-rendering after each like a real page */
const advance = async (ms: number) => {
  for (let done = 0; done < ms; done += 2_000) {
    await act(async () => { await vi.advanceTimersByTimeAsync(Math.min(2_000, ms - done)); });
  }
};
const setVisibility = (value: 'visible' | 'hidden') => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => value });
  document.dispatchEvent(new Event('visibilitychange'));
};

describe('Alert Service Offline notice', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    state.worker = { active: false, lastSeen: null, loaded: true };
    state.notifications = [];
    state.maintenanceMode = false;
    state.connected = true;
    state.serverLastSeen = () => null;
    setVisibility('visible');
  });
  afterEach(() => {
    vi.useRealTimers();
    setVisibility('visible');
  });

  it('waits for this page to settle (10 s) and then 60 s more, then raises one warning', async () => {
    render(<SystemMonitor />);
    await advance(60_000);
    expect(noticeCalls()).toHaveLength(0);

    await advance(16_000);
    expect(noticeCalls()).toHaveLength(1);
    expect(noticeCalls()[0][0]).toMatchObject({ id: ALERT_SERVICE_OFFLINE_ID, title: 'Alert Service Offline', type: 'warning' });

    await advance(60_000);
    expect(noticeCalls()).toHaveLength(1); // once per outage
  });

  it('does nothing before the heartbeat has been read, or in maintenance mode', async () => {
    state.worker = { active: false, lastSeen: null, loaded: false };
    const { rerender } = render(<SystemMonitor />);
    await advance(120_000);
    expect(noticeCalls()).toHaveLength(0);

    state.worker = { active: false, lastSeen: null, loaded: true };
    state.maintenanceMode = true;
    rerender(<SystemMonitor />);
    await advance(120_000);
    expect(noticeCalls()).toHaveLength(0);
  });

  it('never raises from a hidden page or while this browser is disconnected', async () => {
    setVisibility('hidden');
    const { rerender } = render(<SystemMonitor />);
    await advance(180_000);
    expect(noticeCalls()).toHaveLength(0);

    setVisibility('visible');
    state.connected = false;
    rerender(<SystemMonitor />);
    await advance(180_000);
    expect(noticeCalls()).toHaveLength(0);
  });

  it('restarts the wait when the page wakes up (a sleeping tab saw no heartbeats)', async () => {
    render(<SystemMonitor />);
    await advance(60_000);
    setVisibility('hidden');
    await advance(30_000);
    setVisibility('visible'); // wake-up: the 10 s settle and the 60 s grace start again
    await advance(60_000);
    expect(noticeCalls()).toHaveLength(0);
    await advance(16_000);
    expect(noticeCalls()).toHaveLength(1);
  });

  it('does not raise when the server still has a fresh heartbeat (this view was stale)', async () => {
    state.serverLastSeen = () => Date.now() - 5_000;
    render(<SystemMonitor />);
    await advance(80_000);
    expect(noticeCalls()).toHaveLength(0);

    state.serverLastSeen = () => undefined; // could not ask the server: do not raise either
    await advance(80_000);
    expect(noticeCalls()).toHaveLength(0);
  });

  it('resolves the open notice when the service is back', () => {
    state.worker = { active: true, lastSeen: Date.now(), loaded: true };
    state.notifications = [{ id: ALERT_SERVICE_OFFLINE_ID, title: 'Alert Service Offline', message: '', type: 'warning', timestamp: 1, read: false, resolved: false }];
    render(<SystemMonitor />);
    expect(mockResolve).toHaveBeenCalledWith(ALERT_SERVICE_OFFLINE_ID);
    expect(noticeCalls()).toHaveLength(0);
  });
});
