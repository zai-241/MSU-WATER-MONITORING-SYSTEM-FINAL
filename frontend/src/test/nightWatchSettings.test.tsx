import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { Tank, SystemConfig } from '@/store/useStore';

const mockTanks: Tank[] = [{
  id: '1', name: 'Reservoir Tank 1', waterLevel: 50, phLevel: 7, waterHeight: 0, status: 'safe',
  assignedWorker: null, pumpOn: false, enabled: true, levelVmin: 0.25, levelVmax: 3, tankHeight: 1,
  capacityLiters: 200, levelOffset: 0, phNeutralVoltage: 2.5, phSlope: 0.18, phOffset: 0,
  phSensorOk: true, levelSensorOk: true, lastUpdate: Date.now(),
}];

let mockConfig: SystemConfig;
const mockUpdateConfig = vi.fn().mockResolvedValue(undefined);
const mockAddSystemLog = vi.fn();

vi.mock('@/store/useStore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/store/useStore')>();
  return {
    ...actual,
    useTanks: () => ({ tanks: mockTanks, updateTank: vi.fn().mockResolvedValue(undefined), serverTimeOffset: 0 }),
    useConfig: () => ({ config: mockConfig, updateConfig: mockUpdateConfig }),
    useWorkerStatus: () => ({ active: true, lastSeen: Date.now() }),
    addSystemLog: (...args: unknown[]) => mockAddSystemLog(...args),
  };
});
vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'admin1', username: 'admin', role: 'admin' } }),
}));
vi.mock('@/pages/admin/DeviceAccounts', () => ({ default: () => null }));
vi.mock('@/config/firebase', () => ({ database: {}, firestore: {}, auth: {} }));

import Configuration from '@/pages/admin/Configuration';

const save = () => {
  fireEvent.click(screen.getByRole('button', { name: /Save All Configurations/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Confirm & Apply' }));
};

describe('Admin Panel: Night Watch (leak detection) settings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockConfig = {
      lowLevelThreshold: 15, overflowThreshold: 95, minPh: 6.5, maxPh: 8.5,
      maintenanceMode: false, pumpControlLock: false, offlineThresholdSec: 30, repeatIntervalSec: 60,
    };
  });

  it('shows the defaults when nothing is saved yet: on, 10 PM to 3 AM, 5 % fast, 3 % total', () => {
    render(<Configuration />);
    expect(screen.getByTestId('night-watch-settings')).toBeInTheDocument();
    expect((screen.getByLabelText('Starts at') as HTMLSelectElement).value).toBe('22');
    expect((screen.getByLabelText('Ends at') as HTMLSelectElement).value).toBe('3');
    expect((screen.getByLabelText('Fast Drop (%)') as HTMLInputElement).value).toBe('5');
    expect((screen.getByLabelText('Total Night Drop (%)') as HTMLInputElement).value).toBe('3');
    expect(screen.getAllByRole('option', { name: '10 PM' })).toHaveLength(2); // start and end lists
  });

  it('saves changed hours and thresholds and logs them', async () => {
    render(<Configuration />);
    fireEvent.change(screen.getByLabelText('Starts at'), { target: { value: '21' } });
    fireEvent.change(screen.getByLabelText('Fast Drop (%)'), { target: { value: '8' } });
    save();
    await waitFor(() => expect(mockUpdateConfig).toHaveBeenCalled());
    expect(mockUpdateConfig).toHaveBeenCalledWith(expect.objectContaining({
      nightWatchEnabled: true, nightStartHour: 21, nightEndHour: 3, nightFastDropPercent: 8, nightSlowDropPercent: 3,
    }));
    const details = mockAddSystemLog.mock.calls.map(([e]) => (e as { details: string }).details).join(' ');
    expect(details).toContain('Night Hours (10 PM-3 AM -> 9 PM-3 AM)');
    expect(details).toContain('Night Fast Drop (5% -> 8%)');
  });

  it('refuses a threshold under 3 % (the level moves in 2 % steps) and equal start and end hours', async () => {
    render(<Configuration />);
    fireEvent.change(screen.getByLabelText('Total Night Drop (%)'), { target: { value: '2' } });
    save();
    await new Promise(r => setTimeout(r, 50));
    expect(mockUpdateConfig).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('Total Night Drop (%)'), { target: { value: '3' } });
    fireEvent.change(screen.getByLabelText('Ends at'), { target: { value: '22' } });
    save();
    await new Promise(r => setTimeout(r, 50));
    expect(mockUpdateConfig).not.toHaveBeenCalled();
  });

  it('can be switched off', async () => {
    render(<Configuration />);
    fireEvent.click(screen.getByRole('button', { name: 'Night Watch' }));
    save();
    await waitFor(() => expect(mockUpdateConfig).toHaveBeenCalledWith(expect.objectContaining({ nightWatchEnabled: false })));
  });
});
