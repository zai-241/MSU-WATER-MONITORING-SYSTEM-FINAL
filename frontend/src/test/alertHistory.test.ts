import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockSet = vi.fn();
const mockUpdate = vi.fn();
/** Value the mocked transaction sees as the current database record */
let currentRecord: any = null;
/** What the transaction wrote (undefined = aborted) */
let transactionWrite: any;

vi.mock('firebase/database', () => ({
  ref: (_db: unknown, path?: string) => ({ _path: path ?? '' }),
  query: (r: unknown) => r,
  orderByChild: vi.fn(),
  limitToLast: vi.fn(),
  endAt: vi.fn(),
  onValue: vi.fn(() => () => {}),
  get: vi.fn(),
  set: (...args: unknown[]) => mockSet(...args),
  update: (...args: unknown[]) => mockUpdate(...args),
  push: vi.fn(() => ({ key: 'pushKey1' })),
  remove: vi.fn(),
  runTransaction: vi.fn(async (_ref: unknown, updater: (cur: unknown) => unknown) => {
    transactionWrite = updater(currentRecord);
    return { committed: transactionWrite !== undefined };
  }),
}));

vi.mock('@/config/firebase', () => ({
  database: {},
  firestore: {},
  auth: { currentUser: { uid: 'uid-worker-1' } },
}));

import { addNotification, resolveNotification, acknowledgeNotification } from '@/store/useStore';

const alert = { id: 'alert-1-ph', tankId: '1', title: 'Unsafe pH Level', message: 'pH is unsafe', type: 'danger' as const };

describe('Alert history and acknowledgement writes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    currentRecord = null;
    transactionWrite = undefined;
    mockSet.mockResolvedValue(undefined);
    mockUpdate.mockResolvedValue(undefined);
  });

  it('creates the live record when no alert exists yet', async () => {
    const outcome = await addNotification(alert);

    expect(outcome).toBe('created');
    expect(transactionWrite).toMatchObject({ id: 'alert-1-ph', acknowledged: false, resolved: false, tankId: '1' });
    expect(mockSet).not.toHaveBeenCalled(); // nothing to archive
  });

  it('archives the finished episode before a new one overwrites it', async () => {
    currentRecord = {
      ...alert, timestamp: 1000, resolved: true, resolvedAt: 2000,
      acknowledged: true, acknowledgedBy: 'Ana', acknowledgedByUid: 'uid-ana',
    };
    const outcome = await addNotification(alert);

    expect(outcome).toBe('created');
    expect(transactionWrite).toMatchObject({ acknowledged: false, resolved: false });
    expect(transactionWrite.acknowledgedBy).toBeUndefined();

    expect(mockSet).toHaveBeenCalledTimes(1);
    const [archiveRef, archived] = mockSet.mock.calls[0];
    expect(archiveRef._path).toBe('notifications/alert-1-ph-1000');
    expect(archived).toMatchObject({ id: 'alert-1-ph-1000', timestamp: 1000, resolved: true, acknowledgedBy: 'Ana' });
    expect(archived.acknowledgedByUid).toBeUndefined();
  });

  it('does not reopen an alert that an operator already acknowledged (B2)', async () => {
    currentRecord = { ...alert, timestamp: 1000, resolved: false, acknowledged: true };
    const outcome = await addNotification(alert);

    expect(outcome).toBe('skipped');
    expect(transactionWrite).toBeUndefined();
    expect(mockSet).not.toHaveBeenCalled();
  });

  it('re-announces an active unacknowledged alert without changing when it started', async () => {
    currentRecord = { ...alert, timestamp: 1000, resolved: false, acknowledged: false };
    const outcome = await addNotification(alert);

    expect(outcome).toBe('repeated');
    expect(transactionWrite.timestamp).toBe(1000);
    expect(transactionWrite.acknowledged).toBe(false);
    expect(transactionWrite.lastRepeatedAt).toBeGreaterThan(1000);
    expect(mockSet).not.toHaveBeenCalled();
  });

  it('writes recovery/info rows as plain history rows', async () => {
    await addNotification({ tankId: '1', title: 'Unsafe pH Level Recovered', message: 'ok', type: 'info', acknowledged: true, resolved: true });

    expect(mockSet).toHaveBeenCalledTimes(1);
    expect(mockSet.mock.calls[0][0]._path).toBe('notifications/pushKey1');
    expect(mockSet.mock.calls[0][1]).toMatchObject({ id: 'pushKey1', type: 'info' });
  });

  it('resolves an active alert once and reports it, so only one client writes the recovery (B3)', async () => {
    currentRecord = { ...alert, timestamp: 1000, resolved: false };
    const first = await resolveNotification('alert-1-ph');
    expect(first).toMatchObject({ id: 'alert-1-ph', timestamp: 1000 });
    expect(transactionWrite).toMatchObject({ resolved: true });
    // Resolving must not pretend an operator acknowledged it
    expect(transactionWrite.acknowledged).toBeUndefined();

    currentRecord = { ...alert, timestamp: 1000, resolved: true };
    expect(await resolveNotification('alert-1-ph')).toBeNull();

    currentRecord = null;
    expect(await resolveNotification('alert-1-ph')).toBeNull();
  });

  it('acknowledges and logs in one write, recording the signed-in UID', async () => {
    await acknowledgeNotification('alert-1-ph', 'workerBob', 'Unsafe pH Level');

    expect(mockUpdate).toHaveBeenCalledTimes(1);
    const fields = mockUpdate.mock.calls[0][1];
    expect(fields['notifications/alert-1-ph/acknowledged']).toBe(true);
    expect(fields['notifications/alert-1-ph/acknowledgedBy']).toBe('workerBob');
    expect(fields['notifications/alert-1-ph/acknowledgedByUid']).toBe('uid-worker-1');
    expect(fields['logs/pushKey1']).toMatchObject({ action: 'Alert Acknowledged', performedBy: 'workerBob' });
  });
});
