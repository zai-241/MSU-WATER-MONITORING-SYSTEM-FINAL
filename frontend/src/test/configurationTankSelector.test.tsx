import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import type { Tank, SystemConfig } from '@/store/useStore';

const makeTank = (id: string, tankHeight: number, extra: Partial<Tank> = {}): Tank => ({
  id,
  name: `Reservoir Tank ${id}`,
  waterLevel: 0,
  phLevel: 7,
  waterHeight: 0,
  status: 'safe',
  assignedWorker: null,
  pumpOn: false,
  enabled: true,
  levelVmin: 0.25,
  levelVmax: 3.0,
  tankHeight,
  capacityLiters: 200,
  levelOffset: 0,
  phNeutralVoltage: 2.5,
  phSlope: 0.18,
  phOffset: 0,
  phSensorOk: true,
  levelSensorOk: true,
  ...extra,
});

// Distinct heights so the form shows which tank is loaded
const mockTanks: Tank[] = [
  makeTank('1', 5, { lastUpdate: Date.now() }),
  makeTank('2', 2),
  makeTank('3', 3),
  makeTank('4', 4),
];

const mockConfig: SystemConfig = {
  lowLevelThreshold: 15,
  overflowThreshold: 95,
  minPh: 6.5,
  maxPh: 8.5,
  maintenanceMode: false,
  pumpControlLock: false,
  offlineThresholdSec: 30,
  repeatIntervalSec: 60,
  soundEnabled: true,
  pushEnabled: true,
};

const mockUpdateTank = vi.fn().mockResolvedValue(undefined);
const mockUpdateConfig = vi.fn().mockResolvedValue(undefined);
const mockAddSystemLog = vi.fn();

vi.mock('@/store/useStore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/store/useStore')>();
  return {
    ...actual,
    useTanks: () => ({ tanks: mockTanks, updateTank: mockUpdateTank, serverTimeOffset: 0 }),
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

const heightInput = () =>
  screen.getByText('Physical Tank Height (m)').parentElement!.querySelector('input') as HTMLInputElement;
const capacityInput = () =>
  screen.getByText('Tank Capacity (L)').parentElement!.querySelector('input') as HTMLInputElement;
const calibrationHeading = () => screen.getByRole('heading', { name: /Sensor Calibration & Offsets/ });

describe('Configuration: per-tank sensor calibration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('offers Tank 1 to Tank 4 and starts on Tank 1', () => {
    render(<Configuration />);
    const tabs = screen.getAllByRole('tab').map(t => t.textContent);
    expect(tabs).toEqual(['Tank 1', 'Tank 2', 'Tank 3', 'Tank 4']);
    expect(screen.getByRole('tab', { name: 'Tank 1' })).toHaveAttribute('aria-selected', 'true');
    expect(calibrationHeading()).toHaveTextContent('(Tank 1)');
    expect(heightInput().value).toBe('5');
  });

  it('loads the selected tank and saves its calibration to that tank only', async () => {
    render(<Configuration />);

    fireEvent.click(screen.getByRole('tab', { name: 'Tank 3' }));
    expect(calibrationHeading()).toHaveTextContent('(Tank 3)');
    expect(heightInput().value).toBe('3');

    fireEvent.change(heightInput(), { target: { value: '3.5' } });
    fireEvent.click(screen.getByRole('button', { name: /Save All Configurations/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm & Apply' }));

    await waitFor(() => expect(mockUpdateTank).toHaveBeenCalledTimes(1));
    expect(mockUpdateTank).toHaveBeenCalledWith('3', expect.objectContaining({ tankHeight: 3.5, levelVmin: 0.25 }));
    expect(mockUpdateTank).not.toHaveBeenCalledWith('1', expect.anything());

    const calibrationLog = mockAddSystemLog.mock.calls
      .map(([entry]) => entry as { action: string; details: string })
      .find(entry => entry.action === 'Calibration Updated');
    expect(calibrationLog?.details).toContain('Reservoir Tank 3');
    expect(calibrationLog?.details).toContain('Tank Height (3 -> 3.5)');
  });

  it('saves the capacity the admin sets for the selected tank', async () => {
    render(<Configuration />);

    expect(capacityInput().value).toBe('200');
    fireEvent.click(screen.getByRole('tab', { name: 'Tank 2' }));
    fireEvent.change(capacityInput(), { target: { value: '1500' } });
    fireEvent.click(screen.getByRole('button', { name: /Save All Configurations/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm & Apply' }));

    await waitFor(() => expect(mockUpdateTank).toHaveBeenCalledWith('2', expect.objectContaining({ capacityLiters: 1500 })));
    const calibrationLog = mockAddSystemLog.mock.calls
      .map(([entry]) => entry as { action: string; details: string })
      .find(entry => entry.action === 'Calibration Updated');
    expect(calibrationLog?.details).toContain('Tank Capacity (L) (200 -> 1500)');
  });

  it('refuses a capacity of zero', async () => {
    render(<Configuration />);
    fireEvent.change(capacityInput(), { target: { value: '0' } });
    fireEvent.click(screen.getByRole('button', { name: /Save All Configurations/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm & Apply' }));
    await waitFor(() => expect(mockUpdateConfig).toHaveBeenCalled());
    expect(mockUpdateTank).not.toHaveBeenCalled();
  });

  it('asks before discarding unsaved changes when switching tanks', () => {
    render(<Configuration />);

    fireEvent.change(heightInput(), { target: { value: '6' } });
    fireEvent.click(screen.getByRole('tab', { name: 'Tank 2' }));

    // Still on Tank 1 with the edit kept, and a confirmation is shown
    const dialog = screen.getByRole('alertdialog');
    expect(dialog).toHaveTextContent('Discard unsaved changes?');
    expect(calibrationHeading()).toHaveTextContent('(Tank 1)');

    fireEvent.click(within(dialog).getByRole('button', { name: 'Keep Editing' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(calibrationHeading()).toHaveTextContent('(Tank 1)');
    expect(heightInput().value).toBe('6');

    fireEvent.click(screen.getByRole('tab', { name: 'Tank 2' }));
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Discard Changes' }));
    expect(calibrationHeading()).toHaveTextContent('(Tank 2)');
    expect(heightInput().value).toBe('2');
    expect(mockUpdateTank).not.toHaveBeenCalled();
  });

  it('switches without asking when nothing was edited', () => {
    render(<Configuration />);
    fireEvent.click(screen.getByRole('tab', { name: 'Tank 4' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(calibrationHeading()).toHaveTextContent('(Tank 4)');
    expect(heightInput().value).toBe('4');
  });
});
