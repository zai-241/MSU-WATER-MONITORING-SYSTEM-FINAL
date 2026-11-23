import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import type { Tank } from '@/store/useStore';
import type { UserProfile } from '@/services/authService';

const makeTank = (id: string, changes: Partial<Tank> = {}): Tank => ({
  id, name: `Reservoir Tank ${id}`, waterLevel: 60, phLevel: 7.1, waterHeight: 0.5, status: 'safe',
  assignedWorker: null, pumpOn: false, enabled: true, levelVmin: 0.25, levelVmax: 3, tankHeight: 1,
  capacityLiters: 200, levelOffset: 0, phNeutralVoltage: 2.5, phSlope: 0.18, phOffset: 0,
  phSensorOk: true, levelSensorOk: true, lastUpdate: Date.now(), controllerOffline: false,
  ...changes,
});

const state: { tanks: Tank[] } = { tanks: [] };
const mockUpdateTank = vi.fn();

vi.mock('@/store/useStore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/store/useStore')>();
  return {
    ...actual,
    useTanks: () => ({
      tanks: state.tanks, isLive: true, serverTimeOffset: 0,
      updateTank: mockUpdateTank, addTank: vi.fn(), deleteTank: vi.fn(),
    }),
    useServerTimeOffset: () => 0,
  };
});
vi.mock('@/lib/presence', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/presence')>();
  return { ...actual, usePresence: () => ({}) };
});
const admin = {
  id: 'admin1', username: 'admin', email: 'admin@example.com', role: 'admin', jobTitle: 'Administrator', status: 'active', createdAt: 0,
} as UserProfile;
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ currentUser: admin }) }));
vi.mock('@/config/firebase', () => ({ database: {}, firestore: {}, auth: {} }));

import TankAssignment from '@/pages/admin/TankAssignment';
import UserManagement from '@/pages/admin/UserManagement';

const user = (id: string, username: string, changes: Partial<UserProfile> = {}): UserProfile => ({
  id, username, email: `${username}@example.com`, role: 'worker', jobTitle: 'Operator', status: 'active', createdAt: 0, ...changes,
});
const users = [admin, user('w1', 'juan'), user('w2', 'maria'), user('v1', 'pedro', { role: 'viewer', jobTitle: 'Viewer', status: 'inactive' })];

describe('Tank Assignment confirmations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUpdateTank.mockResolvedValue(undefined);
    state.tanks = [makeTank('1', { assignedWorker: 'w1' }), makeTank('2', { enabled: false })];
  });

  it('asks before disabling a tank, and Cancel changes nothing', async () => {
    render(<TankAssignment users={users} />);
    fireEvent.click(screen.getByRole('button', { name: /^Disable$/ }));
    const dialog = screen.getByRole('alertdialog');
    expect(dialog).toHaveTextContent('Disable Reservoir Tank 1?');
    expect(dialog).toHaveTextContent('juan is unassigned');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(mockUpdateTank).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /^Disable$/ }));
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Disable Tank' }));
    await waitFor(() => expect(mockUpdateTank).toHaveBeenCalledWith('1', { enabled: false, pumpOn: false, assignedWorker: null }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
  });

  it('enables a disabled tank without asking', async () => {
    render(<TankAssignment users={users} />);
    fireEvent.click(screen.getByRole('button', { name: /^Enable$/ }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    await waitFor(() => expect(mockUpdateTank).toHaveBeenCalledWith('2', { enabled: true }));
  });

  it('asks before changing the assigned operator', async () => {
    render(<TankAssignment users={users} />);
    const select = screen.getByLabelText('Assigned operator for Reservoir Tank 1');
    fireEvent.change(select, { target: { value: 'w2' } });
    const dialog = screen.getByRole('alertdialog');
    expect(dialog).toHaveTextContent('Change assigned operator?');
    expect(dialog).toHaveTextContent('moves from juan to maria');
    expect(mockUpdateTank).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Change' }));
    await waitFor(() => expect(mockUpdateTank).toHaveBeenCalledWith('1', { assignedWorker: 'w2' }));
  });

  it('asks before unassigning, and Cancel keeps the operator', () => {
    render(<TankAssignment users={users} />);
    const select = screen.getByLabelText('Assigned operator for Reservoir Tank 1');
    fireEvent.change(select, { target: { value: '' } });
    const dialog = screen.getByRole('alertdialog');
    expect(dialog).toHaveTextContent('Unassign operator?');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(mockUpdateTank).not.toHaveBeenCalled();
    expect(select).toHaveValue('w1');
  });
});

describe('User Management: deactivate confirmation', () => {
  it('asks before deactivating, and activates without asking', async () => {
    const updateUser = vi.fn().mockResolvedValue(undefined);
    render(<UserManagement users={users} loading={false} addUser={vi.fn()} updateUser={updateUser} />);

    fireEvent.click(screen.getAllByRole('button', { name: 'Deactivate' })[0]);
    const dialog = screen.getByRole('alertdialog');
    expect(dialog).toHaveTextContent('Deactivate juan?');
    expect(dialog).toHaveTextContent('signed out right away');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(updateUser).not.toHaveBeenCalled();

    fireEvent.click(screen.getAllByRole('button', { name: 'Deactivate' })[0]);
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Deactivate' }));
    await waitFor(() => expect(updateUser).toHaveBeenCalledWith('w1', { status: 'inactive' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Activate' }));
    await waitFor(() => expect(updateUser).toHaveBeenCalledWith('v1', { status: 'active' }));
  });
});
