import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';
import type { Notification } from '@/store/useStore';
import { ALERT_SERVICE_OFFLINE_ID } from '@/lib/alertEngine';

const state: {
  worker: { active: boolean; lastSeen: number | null; loaded: boolean };
  notifications: Notification[];
  maintenanceMode: boolean;
} = { worker: { active: false, lastSeen: null, loaded: true }, notifications: [], maintenanceMode: false };

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
    addSystemLog: vi.fn(),
    syncTankOfflineState: vi.fn(),
  };
});
vi.mock('@/utils/alertSound', () => ({ alertSound: { startAlert: vi.fn(), stopAlert: vi.fn() } }));
vi.mock('@/config/firebase', () => ({ database: {}, firestore: {}, auth: {} }));

import SystemMonitor from '@/components/SystemMonitor';

const noticeCalls = () => mockAdd.mock.calls.filter(([n]) => n.id === ALERT_SERVICE_OFFLINE_ID);

describe('Alert Service Offline notice', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    state.worker = { active: false, lastSeen: null, loaded: true };
    state.notifications = [];
    state.maintenanceMode = false;
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('stays quiet for the first 60 seconds, then raises one warning', () => {
    render(<SystemMonitor />);
    act(() => { vi.advanceTimersByTime(50_000); });
    expect(noticeCalls()).toHaveLength(0);

    act(() => { vi.advanceTimersByTime(14_000); });
    expect(noticeCalls()).toHaveLength(1);
    expect(noticeCalls()[0][0]).toMatchObject({ id: ALERT_SERVICE_OFFLINE_ID, title: 'Alert Service Offline', type: 'warning' });

    act(() => { vi.advanceTimersByTime(60_000); });
    expect(noticeCalls()).toHaveLength(1); // once per outage
  });

  it('does nothing before the heartbeat has been read, or in maintenance mode', () => {
    state.worker = { active: false, lastSeen: null, loaded: false };
    const { rerender } = render(<SystemMonitor />);
    act(() => { vi.advanceTimersByTime(120_000); });
    expect(noticeCalls()).toHaveLength(0);

    state.worker = { active: false, lastSeen: null, loaded: true };
    state.maintenanceMode = true;
    rerender(<SystemMonitor />);
    act(() => { vi.advanceTimersByTime(120_000); });
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
