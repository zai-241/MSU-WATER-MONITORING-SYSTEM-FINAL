import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import type { Tank, SystemConfig } from '@/store/useStore';
import type { UserProfile } from '@/services/authService';
import { isValidTankId, nextFreeTankId, tankIdsInOrder, isDefaultTankId } from '@/lib/constants';

const makeTank = (id: string, changes: Partial<Tank> = {}): Tank => ({
  id, name: `Reservoir Tank ${id}`, waterLevel: 60, phLevel: 7.1, waterHeight: 0.5, status: 'safe',
  assignedWorker: null, pumpOn: false, enabled: true, levelVmin: 0.25, levelVmax: 3, tankHeight: 1,
  capacityLiters: 200, levelOffset: 0, phNeutralVoltage: 2.5, phSlope: 0.18, phOffset: 0,
  phSensorOk: true, levelSensorOk: true, lastUpdate: id === '1' ? Date.now() : undefined, controllerOffline: false,
  ...changes,
});

const state: { tanks: Tank[] } = { tanks: [] };
const mockAddTank = vi.fn();
const config: SystemConfig = {
  lowLevelThreshold: 15, overflowThreshold: 95, minPh: 6.5, maxPh: 8.5,
  maintenanceMode: false, pumpControlLock: false, offlineThresholdSec: 30, repeatIntervalSec: 60,
};

vi.mock('@/store/useStore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/store/useStore')>();
  return {
    ...actual,
    useTanks: () => ({
      tanks: state.tanks, isLive: true, serverTimeOffset: 0,
      updateTank: vi.fn().mockResolvedValue(undefined), addTank: mockAddTank, deleteTank: vi.fn().mockResolvedValue(undefined),
    }),
    useConfig: () => ({ config, updateConfig: vi.fn().mockResolvedValue(undefined) }),
    useWorkerStatus: () => ({ active: true, lastSeen: Date.now() }),
    addSystemLog: vi.fn(),
  };
});
const admin = {
  id: 'admin1', username: 'admin', email: 'admin@example.com', role: 'admin', jobTitle: 'admin', status: 'active', createdAt: 0,
} as UserProfile;
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ currentUser: admin }) }));
vi.mock('@/pages/admin/DeviceAccounts', () => ({ default: () => null }));
vi.mock('@/config/firebase', () => ({ database: {}, firestore: {}, auth: {} }));

import TankAssignment from '@/pages/admin/TankAssignment';
import Configuration from '@/pages/admin/Configuration';

describe('tank IDs', () => {
  it('accepts whole numbers 1 to 999 only', () => {
    expect(['1', '5', '42', '999'].every(isValidTankId)).toBe(true);
    expect(['', '0', '05', '1000', '2.5', '-3', 'A', ' 5'].some(isValidTankId)).toBe(false);
  });

  it('suggests the lowest free ID and sorts by number', () => {
    expect(nextFreeTankId(['1', '2', '3', '4'])).toBe('5');
    expect(nextFreeTankId(['1', '2', '4', '5'])).toBe('3');
    expect(tankIdsInOrder(['10', '2', '1', '5'])).toEqual(['1', '2', '5', '10']);
  });

  it('protects only Tanks 1–4 from deletion', () => {
    expect(['1', '2', '3', '4'].every(isDefaultTankId)).toBe(true);
    expect(isDefaultTankId('5')).toBe(false);
  });
});

describe('Tank Assignment: registering more tanks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAddTank.mockResolvedValue(undefined);
    state.tanks = ['1', '2', '3', '4'].map(id => makeTank(id));
  });

  it('can register Tank 5 when Tanks 1–4 exist', async () => {
    render(<TankAssignment users={[]} />);
    const button = screen.getByRole('button', { name: /Register New Tank/ });
    expect(button).not.toBeDisabled();
    fireEvent.click(button);
    expect(screen.getByLabelText('Tank ID')).toHaveValue(5);
    expect(screen.getByLabelText('Tank Name')).toHaveValue('Reservoir Tank 5');
    fireEvent.click(screen.getByRole('button', { name: 'Register' }));
    await waitFor(() => expect(mockAddTank).toHaveBeenCalledWith(expect.objectContaining({ id: '5', name: 'Reservoir Tank 5' })));
  });

  it('follows a typed ID in the suggested name and refuses a taken or invalid ID', async () => {
    render(<TankAssignment users={[]} />);
    fireEvent.click(screen.getByRole('button', { name: /Register New Tank/ }));
    fireEvent.change(screen.getByLabelText('Tank ID'), { target: { value: '12' } });
    expect(screen.getByLabelText('Tank Name')).toHaveValue('Reservoir Tank 12');

    fireEvent.change(screen.getByLabelText('Tank ID'), { target: { value: '3' } });
    fireEvent.click(screen.getByRole('button', { name: 'Register' }));
    expect(await screen.findByText(/already exists/)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Tank ID'), { target: { value: '1000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Register' }));
    expect(await screen.findByText(/Tank ID must be a whole number from 1 to 999/)).toBeInTheDocument();
    expect(mockAddTank).not.toHaveBeenCalled();
  });

  it('lets an added tank be deleted, but not Tanks 1–4', () => {
    state.tanks = [...state.tanks, makeTank('5')];
    render(<TankAssignment users={[]} />);
    expect(screen.getAllByTitle('Delete Tank')).toHaveLength(1);
    expect(screen.getAllByTitle('System tank: cannot be deleted. Use Disable instead.')).toHaveLength(4);
  });
});

describe('Admin Panel lists every registered tank', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.tanks = ['1', '2', '3', '4', '5', '10'].map(id => makeTank(id));
  });

  it('shows calibration tabs and maintenance switches for added tanks, in number order', () => {
    render(<Configuration />);
    const tabs = within(screen.getByRole('tablist', { name: 'Tank to calibrate' })).getAllByRole('tab');
    expect(tabs.map(t => t.textContent)).toEqual(['Tank 1', 'Tank 2', 'Tank 3', 'Tank 4', 'Tank 5', 'Tank 10']);
    const card = screen.getByTestId('tank-maintenance-settings');
    expect(within(card).getAllByRole('switch')).toHaveLength(6);
    expect(within(card).getByRole('switch', { name: 'Maintenance for Reservoir Tank 10' })).toBeInTheDocument();
  });
});
