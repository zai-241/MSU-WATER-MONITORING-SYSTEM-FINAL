import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

type Listener = (snap: { val: () => unknown; exists: () => boolean }) => void;
const listeners = new Map<string, Listener[]>();
const mockSet = vi.fn().mockResolvedValue(undefined);
const mockUpdate = vi.fn().mockResolvedValue(undefined);
const mockRemove = vi.fn().mockResolvedValue(undefined);

vi.mock('firebase/database', () => ({
  ref: (_db: unknown, path?: string) => ({ _path: path ?? '' }),
  query: (r: unknown) => r,
  orderByChild: vi.fn(),
  limitToLast: vi.fn(),
  endAt: vi.fn(),
  onValue: (target: { _path: string }, cb: Listener) => {
    listeners.set(target._path, [...(listeners.get(target._path) ?? []), cb]);
    return () => listeners.set(target._path, (listeners.get(target._path) ?? []).filter(l => l !== cb));
  },
  get: vi.fn(),
  set: (...args: unknown[]) => mockSet(...args),
  update: (...args: unknown[]) => mockUpdate(...args),
  push: vi.fn(() => ({ key: 'k1' })),
  remove: (...args: unknown[]) => mockRemove(...args),
  runTransaction: vi.fn(),
}));

vi.mock('@/config/firebase', () => ({ database: { app: {} }, firestore: {}, auth: {} }));

import { useTanks, resetDefaultTankSeeding, addTank, deleteTank } from '@/store/useStore';

const emitTanks = (value: unknown) =>
  act(() => { (listeners.get('tanks') ?? []).forEach(cb => cb({ val: () => value, exists: () => value !== null })); });

const tank1 = { name: 'Reservoir Tank 1', lastUpdate: 1700000000000, tankHeight: 4.2, waterLevel: 60 };

describe('Default tanks 1–4', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetDefaultTankSeeding();
  });

  it('creates missing Tanks 2–4 with Tank 1 calibration defaults and never writes existing tanks', () => {
    const { unmount } = renderHook(() => useTanks());
    emitTanks({ '1': tank1, '3': { name: 'Custom Tank 3' } });

    const writtenPaths = mockSet.mock.calls.map(([target]) => (target as { _path: string })._path);
    expect(writtenPaths.sort()).toEqual(['tanks/2', 'tanks/4']);
    expect(mockUpdate).not.toHaveBeenCalled();

    const tank2 = mockSet.mock.calls.find(([target]) => (target as { _path: string })._path === 'tanks/2')![1];
    expect(tank2).toMatchObject({
      id: '2', name: 'Reservoir Tank 2', enabled: true,
      levelVmin: 0.25, levelVmax: 3.0, tankHeight: 5.0, capacityLiters: 200, levelOffset: 0,
      phNeutralVoltage: 2.5, phSlope: 0.18, phOffset: 0,
    });
    // No lastUpdate: the new tank shows as planned until its controller reports
    expect(tank2).not.toHaveProperty('lastUpdate');

    // Later snapshots do not write the same tanks again
    emitTanks({ '1': tank1, '3': { name: 'Custom Tank 3' } });
    expect(mockSet).toHaveBeenCalledTimes(2);
    unmount();
  });

  it('writes nothing when all four tanks exist', () => {
    const { result, unmount } = renderHook(() => useTanks());
    emitTanks({ '1': tank1, '2': { name: 'T2' }, '3': { name: 'T3' }, '4': { name: 'T4' } });
    expect(mockSet).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(result.current.tanks.map(t => t.id)).toEqual(['1', '2', '3', '4']);
    unmount();
  });

  it('registers only Tanks 1–4', async () => {
    await expect(addTank({ id: '5', name: 'Tank 5' })).rejects.toThrow(/Only Tanks 1, 2, 3, 4/);
    expect(mockSet).not.toHaveBeenCalled();
    await expect(addTank({ id: '2', name: 'Reservoir Tank 2' })).resolves.toBeUndefined();
    expect(mockSet).toHaveBeenCalledTimes(1);
  });

  it('refuses to delete Tanks 1–4 but can remove a stray tank', async () => {
    for (const id of ['1', '2', '3', '4']) {
      await expect(deleteTank(id)).rejects.toThrow(/cannot be deleted/);
    }
    expect(mockRemove).not.toHaveBeenCalled();
    await deleteTank('5');
    expect(mockRemove).toHaveBeenCalledTimes(1);
  });
});
