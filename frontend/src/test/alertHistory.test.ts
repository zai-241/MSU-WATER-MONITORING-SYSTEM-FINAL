import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';

const mockGet = vi.fn();
const mockSet = vi.fn();
const mockUpdate = vi.fn();

vi.mock('firebase/database', () => ({
  ref: (_db: unknown, path?: string) => ({ _path: path ?? '' }),
  query: (r: unknown) => r,
  orderByChild: vi.fn(),
  limitToLast: vi.fn(),
  onValue: vi.fn(() => () => {}),
  get: (...args: unknown[]) => mockGet(...args),
  set: (...args: unknown[]) => mockSet(...args),
  update: (...args: unknown[]) => mockUpdate(...args),
  push: vi.fn(() => ({ key: 'pushKey1' })),
  remove: vi.fn(),
  runTransaction: vi.fn(),
}));

vi.mock('@/config/firebase', () => ({
  database: {},
  firestore: {},
  auth: { currentUser: { uid: 'uid-worker-1' } },
}));

import { useNotifications } from '@/store/useStore';

const snap = (val: unknown) => ({ exists: () => val !== null, val: () => val });
const alert = { id: 'alert-1-ph', tankId: '1', title: 'Unsafe pH Level', message: 'pH is unsafe', type: 'danger' as const };

describe('Alert history and acknowledgement writes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSet.mockResolvedValue(undefined);
    mockUpdate.mockResolvedValue(undefined);
  });

  it('creates the live record when no alert exists yet', async () => {
    mockGet.mockResolvedValue(snap(null));
    const { result } = renderHook(() => useNotifications());
    await result.current.addNotification(alert);

    expect(mockSet).toHaveBeenCalledTimes(1);
    expect(mockSet.mock.calls[0][0]._path).toBe('notifications/alert-1-ph');
    expect(mockSet.mock.calls[0][1]).toMatchObject({ acknowledged: false, resolved: false, tankId: '1' });
  });

  it('archives the finished episode before a new one overwrites it', async () => {
    mockGet.mockResolvedValue(snap({
      ...alert, timestamp: 1000, resolved: true, resolvedAt: 2000,
      acknowledged: true, acknowledgedBy: 'Ana', acknowledgedByUid: 'uid-ana',
    }));
    const { result } = renderHook(() => useNotifications());
    await result.current.addNotification(alert);

    expect(mockSet).toHaveBeenCalledTimes(2);
    const [archiveRef, archived] = mockSet.mock.calls[0];
    expect(archiveRef._path).toBe('notifications/alert-1-ph-1000');
    expect(archived).toMatchObject({ id: 'alert-1-ph-1000', timestamp: 1000, resolved: true, acknowledgedBy: 'Ana' });
    expect(archived.acknowledgedByUid).toBeUndefined();

    const [liveRef, live] = mockSet.mock.calls[1];
    expect(liveRef._path).toBe('notifications/alert-1-ph');
    expect(live).toMatchObject({ acknowledged: false, resolved: false });
    expect(live.acknowledgedBy).toBeUndefined();
  });

  it('does not reopen an alert that an operator already acknowledged', async () => {
    mockGet.mockResolvedValue(snap({ ...alert, timestamp: 1000, resolved: false, acknowledged: true }));
    const { result } = renderHook(() => useNotifications());
    await result.current.addNotification(alert);

    expect(mockSet).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('re-announces an active unacknowledged alert without changing when it started', async () => {
    mockGet.mockResolvedValue(snap({ ...alert, timestamp: 1000, resolved: false, acknowledged: false }));
    const { result } = renderHook(() => useNotifications());
    await result.current.addNotification(alert);

    expect(mockSet).not.toHaveBeenCalled();
    expect(mockUpdate).toHaveBeenCalledTimes(1);
    const fields = mockUpdate.mock.calls[0][1];
    expect(fields.timestamp).toBeUndefined();
    expect(fields.acknowledged).toBeUndefined();
    expect(fields.read).toBe(false);
  });

  it('acknowledges and logs in one write, recording the signed-in UID', async () => {
    const { result } = renderHook(() => useNotifications());
    await result.current.acknowledgeNotification('alert-1-ph', 'workerBob', 'Unsafe pH Level');

    expect(mockUpdate).toHaveBeenCalledTimes(1);
    const fields = mockUpdate.mock.calls[0][1];
    expect(fields['notifications/alert-1-ph/acknowledged']).toBe(true);
    expect(fields['notifications/alert-1-ph/acknowledgedBy']).toBe('workerBob');
    expect(fields['notifications/alert-1-ph/acknowledgedByUid']).toBe('uid-worker-1');
    expect(fields['logs/pushKey1']).toMatchObject({ action: 'Alert Acknowledged', performedBy: 'workerBob' });
  });
});
