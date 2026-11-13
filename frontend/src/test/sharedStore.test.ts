import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

type Listener = (snap: { val: () => unknown; exists: () => boolean }) => void;
const listeners = new Map<string, Listener[]>();
const mockOnValue = vi.fn((target: { _path: string }, cb: Listener) => {
  const list = listeners.get(target._path) ?? [];
  list.push(cb);
  listeners.set(target._path, list);
  return () => {
    listeners.set(target._path, (listeners.get(target._path) ?? []).filter(l => l !== cb));
  };
});
const mockSet = vi.fn().mockResolvedValue(undefined);
const mockUpdate = vi.fn().mockResolvedValue(undefined);

vi.mock('firebase/database', () => ({
  ref: (_db: unknown, path?: string) => ({ _path: path ?? '' }),
  query: (r: unknown) => r,
  orderByChild: vi.fn(),
  limitToLast: vi.fn(),
  endAt: vi.fn(),
  onValue: (target: { _path: string }, cb: Listener) => mockOnValue(target, cb),
  get: vi.fn(),
  set: (...args: unknown[]) => mockSet(...args),
  update: (...args: unknown[]) => mockUpdate(...args),
  push: vi.fn(() => ({ key: 'k1' })),
  remove: vi.fn(),
  runTransaction: vi.fn(),
}));

// `app` makes the store treat this as a real database (enables guarded listeners)
vi.mock('@/config/firebase', () => ({ database: { app: {} }, firestore: {}, auth: {} }));

import { useNotifications, useUserNotificationsState, useWorkerStatus } from '@/store/useStore';

const emit = (path: string, value: unknown) =>
  act(() => { (listeners.get(path) ?? []).forEach(cb => cb({ val: () => value, exists: () => value !== null })); });
const listenerCount = (path: string) => mockOnValue.mock.calls.filter(([target]) => target._path === path).length;

describe('Shared store subscriptions and per-user read state', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listeners.clear();
  });

  it('attaches one database listener no matter how many components use the hook (P2)', () => {
    const a = renderHook(() => useNotifications());
    const b = renderHook(() => useNotifications());
    expect(listenerCount('notifications')).toBe(1);

    emit('notifications', { n1: { id: 'n1', title: 'A', message: 'm', type: 'info', timestamp: 10 } });
    expect(a.result.current.notifications).toHaveLength(1);
    expect(b.result.current.notifications).toBe(a.result.current.notifications);

    a.unmount();
    expect(listeners.get('notifications')).toHaveLength(1); // still in use by b
    b.unmount();
    expect(listeners.get('notifications')).toHaveLength(0); // detached with the last user
  });

  it('keeps read state per user, with mark-one and mark-all (R5)', async () => {
    const { result } = renderHook(() => useUserNotificationsState('uid-1'));
    const older = { id: 'old', timestamp: 100 };
    const newer = { id: 'new', timestamp: 300 };

    // Nothing read yet
    expect(result.current.isUnread(older)).toBe(true);

    emit('userState/uid-1', { notificationsLastReadAt: 200, notificationsReadIds: {} });
    expect(result.current.isUnread(older)).toBe(false);
    expect(result.current.isUnread(newer)).toBe(true);

    await act(async () => { await result.current.markOneRead('new'); });
    expect(result.current.isUnread(newer)).toBe(false);
    expect(mockSet.mock.calls[0][0]._path).toBe('userState/uid-1/notificationsReadIds/new');
    // The shared notification record is never touched
    expect(mockUpdate).not.toHaveBeenCalled();

    await act(async () => { await result.current.markAllAsRead(); });
    const [target, fields] = mockUpdate.mock.calls[0];
    expect(target._path).toBe('userState/uid-1');
    expect(fields.notificationsReadIds).toBeNull();
    expect(fields.notificationsLastReadAt).toBeGreaterThan(300);
  });

  it('treats the alert worker as active only while its heartbeat is fresh', () => {
    const { result } = renderHook(() => useWorkerStatus());
    expect(result.current.active).toBe(false);

    emit('system/worker/lastSeen', Date.now());
    expect(result.current.active).toBe(true);

    emit('system/worker/lastSeen', Date.now() - 120_000);
    expect(result.current.active).toBe(false);

    emit('system/worker/lastSeen', null);
    expect(result.current.active).toBe(false);
  });
});
