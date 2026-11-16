import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import type { Tank, SystemConfig } from '@/store/useStore';
import type { UserProfile } from '@/services/authService';
import { PUMP_COMMAND_TIMEOUT_MS, PUMP_FEEDBACK_MS } from '@/lib/constants';

const baseTank: Tank = {
  id: '1', name: 'Reservoir Tank 1', waterLevel: 60, phLevel: 7.1, waterHeight: 3, status: 'safe',
  assignedWorker: null, pumpOn: false, enabled: true, levelVmin: 0.25, levelVmax: 3, tankHeight: 5,
  capacityLiters: 200, levelOffset: 0, phNeutralVoltage: 2.5, phSlope: 0.18, phOffset: 0,
  phSensorOk: true, levelSensorOk: true, lastUpdate: Date.now(), controllerOffline: false,
  pumpCommandAt: 1000, pumpCommandResult: 'accepted',
};

const config: SystemConfig = {
  lowLevelThreshold: 15, overflowThreshold: 95, minPh: 6.5, maxPh: 8.5,
  maintenanceMode: false, pumpControlLock: false, offlineThresholdSec: 30, repeatIntervalSec: 60,
};

const admin = {
  id: 'admin1', username: 'admin', email: 'admin@example.com', role: 'admin', jobTitle: 'admin', status: 'active', createdAt: 0,
} as UserProfile;

const state: { tanks: Tank[] } = { tanks: [baseTank] };
const mockUpdateTank = vi.fn();

vi.mock('@/store/useStore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/store/useStore')>();
  return {
    ...actual,
    useTanks: () => ({ tanks: state.tanks, isLive: true, updateTank: mockUpdateTank, serverTimeOffset: 0 }),
    useConfig: () => ({ config, updateConfig: vi.fn() }),
    useServerTimeOffset: () => 0,
    addSystemLog: vi.fn(),
  };
});
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ currentUser: admin }) }));
vi.mock('firebase/firestore', () => ({ collection: vi.fn(), onSnapshot: vi.fn(() => vi.fn()), query: vi.fn() }));
vi.mock('@/config/firebase', () => ({ database: {}, firestore: {}, auth: {} }));

import Dashboard from '@/pages/Dashboard';
import { resolvePumpCommand } from '@/lib/pumpCommand';

/** Simulates the database: the web app's write lands, then the controller may acknowledge. */
function setTank(changes: Partial<Tank>) {
  state.tanks = [{ ...state.tanks[0], ...changes }];
}

function sendPumpOn(rerender: (ui: React.ReactElement) => void) {
  fireEvent.click(screen.getByTestId('pump-toggle'));
  fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
  setTank({ pumpOn: true }); // local write of the command
  rerender(<Dashboard />);
}

describe('resolvePumpCommand', () => {
  const pending = { requested: true, ackBefore: 1000, sentAt: 0 };

  it('keeps waiting until pumpCommandAt changes', () => {
    expect(resolvePumpCommand(pending, { pumpCommandAt: 1000, pumpCommandResult: 'accepted' }, 1000)).toBeNull();
    expect(resolvePumpCommand(pending, {}, 1000)).toBeNull();
  });

  it('reports an accepted or refused command', () => {
    expect(resolvePumpCommand(pending, { pumpCommandAt: 2000, pumpCommandResult: 'accepted' }, 1000))
      .toEqual({ kind: 'accepted', message: 'Pump turned ON.' });
    expect(resolvePumpCommand(pending, { pumpCommandAt: 2000, pumpCommandResult: 'refused-maintenance' }, 1000))
      .toEqual({ kind: 'refused', message: 'Refused: maintenance mode is on.' });
    expect(resolvePumpCommand(pending, { pumpCommandAt: 2000, pumpCommandResult: 'refused-something-new' }, 1000))
      .toEqual({ kind: 'refused', message: 'Refused: the controller refused the command.' });
  });

  it('times out when the controller never answers', () => {
    expect(resolvePumpCommand(pending, { pumpCommandAt: 1000 }, PUMP_COMMAND_TIMEOUT_MS - 1)).toBeNull();
    expect(resolvePumpCommand(pending, { pumpCommandAt: 1000 }, PUMP_COMMAND_TIMEOUT_MS)?.kind).toBe('timeout');
  });
});

describe('Dashboard pump toggle waiting state', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUpdateTank.mockResolvedValue(undefined);
    state.tanks = [{ ...baseTank, lastUpdate: Date.now() }];
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows a spinner until the controller accepts the command', () => {
    const { rerender } = render(<Dashboard />);
    sendPumpOn(rerender);

    expect(mockUpdateTank).toHaveBeenCalledWith('1', { pumpOn: true });
    expect(screen.getByTestId('pump-status')).toHaveTextContent('Turning ON…');
    expect(screen.getByTestId('pump-toggle')).toBeDisabled();
    expect(screen.getByTestId('pump-feedback')).toHaveTextContent('Waiting for the controller to confirm');

    setTank({ pumpCommandAt: 2000, pumpCommandResult: 'accepted' });
    rerender(<Dashboard />);

    expect(screen.getByTestId('pump-status')).toHaveTextContent('ON');
    expect(screen.getByTestId('pump-toggle')).not.toBeDisabled();
    expect(screen.getByTestId('pump-feedback')).toHaveTextContent('Pump turned ON.');
  });

  it('shows the reason when the controller refuses the command', () => {
    const { rerender } = render(<Dashboard />);
    sendPumpOn(rerender);

    setTank({ pumpOn: false, pumpCommandAt: 2000, pumpCommandResult: 'refused-overflow' });
    rerender(<Dashboard />);

    expect(screen.getByTestId('pump-status')).toHaveTextContent('OFF');
    expect(screen.getByTestId('pump-feedback'))
      .toHaveTextContent('Refused: the water level is at or above the overflow threshold.');
  });

  it('stops waiting and says so when there is no answer, then clears the message', () => {
    vi.useFakeTimers();
    const { rerender } = render(<Dashboard />);
    sendPumpOn(rerender);
    expect(screen.getByTestId('pump-status')).toHaveTextContent('Turning ON…');

    // Keep the controller "online" while no acknowledgment arrives
    act(() => { vi.advanceTimersByTime(PUMP_COMMAND_TIMEOUT_MS / 2); });
    setTank({ lastUpdate: Date.now() });
    rerender(<Dashboard />);
    act(() => { vi.advanceTimersByTime(PUMP_COMMAND_TIMEOUT_MS / 2 + 1000); });
    setTank({ lastUpdate: Date.now() });
    rerender(<Dashboard />);

    expect(screen.getByTestId('pump-feedback')).toHaveTextContent('No response from the controller yet');
    expect(screen.getByTestId('pump-toggle')).not.toBeDisabled();

    act(() => { vi.advanceTimersByTime(PUMP_FEEDBACK_MS + 1000); });
    expect(screen.queryByTestId('pump-feedback')).not.toBeInTheDocument();
  });

  it('shows an error when the command cannot be written', async () => {
    mockUpdateTank.mockRejectedValue(new Error('PERMISSION_DENIED'));
    render(<Dashboard />);
    fireEvent.click(screen.getByTestId('pump-toggle'));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    });

    expect(screen.getByTestId('pump-feedback')).toHaveTextContent('Could not send the command: PERMISSION_DENIED');
    expect(screen.getByTestId('pump-toggle')).not.toBeDisabled();
  });
});
