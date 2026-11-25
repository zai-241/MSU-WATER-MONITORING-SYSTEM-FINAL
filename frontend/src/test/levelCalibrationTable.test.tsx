import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import fs from 'node:fs';
import path from 'node:path';
import type { Tank, SystemConfig } from '@/store/useStore';

const makeTank = (id: string, extra: Partial<Tank> = {}): Tank => ({
  id,
  name: `Reservoir Tank ${id}`,
  waterLevel: 50,
  phLevel: 7,
  waterHeight: 0.45,
  status: 'safe',
  assignedWorker: null,
  pumpOn: false,
  enabled: true,
  levelVmin: 0.6,
  levelVmax: 1.36,
  tankHeight: 0.9,
  capacityLiters: 200,
  levelOffset: 0,
  phNeutralVoltage: 2.5,
  phSlope: 0.18,
  phOffset: 0,
  phSensorOk: true,
  levelSensorOk: true,
  ...extra,
});

const savedTable = [
  { depthM: 0, volts: 0.6 },
  { depthM: 0.3, volts: 0.82 },
  { depthM: 0.6, volts: 1.1 },
  { depthM: 0.9, volts: 1.36 },
];

let mockTanks: Tank[] = [];
let mockRole = 'admin';

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
    useServerTimeOffset: () => 0,
    addSystemLog: (...args: unknown[]) => mockAddSystemLog(...args),
  };
});

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'u1', username: 'admin', role: mockRole } }),
}));

vi.mock('@/pages/admin/DeviceAccounts', () => ({ default: () => null }));
vi.mock('@/config/firebase', () => ({ database: {}, firestore: {}, auth: {} }));

import Configuration from '@/pages/admin/Configuration';

const table = () => screen.getByTestId('level-calibration-table');
const depthInput = (row: number) => within(table()).getByLabelText(`Depth (cm), row ${row}`) as HTMLInputElement;
const voltInput = (row: number) => within(table()).getByLabelText(`Voltage (V), row ${row}`) as HTMLInputElement;
const vminInput = () => screen.getByLabelText('Vmin (Empty Tank Voltage)') as HTMLInputElement;
const vmaxInput = () => screen.getByLabelText('Vmax (Full Tank Voltage)') as HTMLInputElement;

const save = () => {
  fireEvent.click(screen.getByRole('button', { name: /Save All Configurations/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Confirm & Apply' }));
};

const calibrationLogDetails = () =>
  mockAddSystemLog.mock.calls
    .map(([entry]) => entry as { action: string; details: string })
    .find(entry => entry.action === 'Calibration Updated')?.details;

describe('Admin Panel: level calibration table', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRole = 'admin';
    mockTanks = [makeTank('1', { lastUpdate: Date.now() }), makeTank('2'), makeTank('3'), makeTank('4')];
  });

  it('starts empty (Vmin/Vmax) and saves a new table built from 10 cm steps', async () => {
    render(<Configuration />);
    expect(within(table()).getByText('Not set: Vmin/Vmax line')).toBeInTheDocument();

    fireEvent.click(within(table()).getByRole('button', { name: 'Start with 10 cm steps' }));
    expect(within(table()).getAllByLabelText(/^Depth \(cm\), row/)).toHaveLength(10);
    expect(depthInput(1).value).toBe('0');
    expect(depthInput(10).value).toBe('90');

    for (let i = 1; i <= 10; i++) {
      fireEvent.change(voltInput(i), { target: { value: (0.6 + (i - 1) * 0.08).toFixed(3) } });
    }
    expect(within(table()).getByText('10 points')).toBeInTheDocument();
    expect(within(table()).queryByRole('alert')).not.toBeInTheDocument();
    // The fallback is filled from the table and cannot be typed while it has rows
    expect(vminInput()).toBeDisabled();
    expect(vmaxInput()).toBeDisabled();
    expect(vminInput().value).toBe('0.600');
    expect(vmaxInput().value).toBe('1.320');

    save();
    await waitFor(() => expect(mockUpdateTank).toHaveBeenCalledTimes(1));
    const [id, updates] = mockUpdateTank.mock.calls[0];
    expect(id).toBe('1');
    expect(updates.levelCalPoints).toHaveLength(10);
    expect(updates.levelCalPoints[0]).toEqual({ depthM: 0, volts: 0.6 });
    expect(updates.levelCalPoints[4]).toEqual({ depthM: 0.4, volts: 0.92 });
    expect(updates.levelCalPoints[9]).toEqual({ depthM: 0.9, volts: 1.32 });
    // Vmin/Vmax fallback = the table's first and last voltage
    expect(updates.levelVmin).toBe(0.6);
    expect(updates.levelVmax).toBe(1.32);
    expect(calibrationLogDetails()).toContain('Level calibration table (none -> 10 points: 0 cm 0.600 V');
    expect(calibrationLogDetails()).toContain('Level Vmax (1.36 -> 1.32)');
  });

  it('without a table, Vmin and Vmax are typed and saved as before', async () => {
    render(<Configuration />);
    expect(screen.getByTestId('level-fallback')).toHaveTextContent('Used while this tank has no calibration table');
    expect(vminInput()).not.toBeDisabled();
    fireEvent.change(vminInput(), { target: { value: '0.55' } });
    fireEvent.change(vmaxInput(), { target: { value: '1.4' } });
    save();
    await waitFor(() => expect(mockUpdateTank).toHaveBeenCalledTimes(1));
    const [, updates] = mockUpdateTank.mock.calls[0];
    expect(updates.levelVmin).toBe(0.55);
    expect(updates.levelVmax).toBe(1.4);
    expect(updates.levelCalPoints).toBeNull();
  });

  it('offers "Use as Vmin/Vmax" in the live readings only while there is no table', () => {
    const live = {
      calibrationUntil: Date.now() + 5 * 60_000,
      calibrationLive: { voltage: 0.61, heightM: 0.01, percent: 1, calPoints: 0, at: Date.now() },
    };
    mockTanks[0] = makeTank('1', live);
    const { unmount } = render(<Configuration />);
    expect(screen.getByRole('button', { name: /Use as Vmin/ })).toBeInTheDocument();
    unmount();

    mockTanks[0] = makeTank('1', { ...live, levelCalPoints: savedTable });
    render(<Configuration />);
    expect(screen.queryByRole('button', { name: /Use as Vmin/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Use as Vmax/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Use as pH neutral/ })).toBeInTheDocument();
    expect(screen.getByText(/Vmin and Vmax are taken from it/)).toBeInTheDocument();
  });

  it('shows the problems before saving and writes nothing while the table is invalid', async () => {
    render(<Configuration />);
    const add = within(table()).getByRole('button', { name: /Add row/ });
    fireEvent.click(add);
    fireEvent.click(add);
    fireEvent.change(voltInput(1), { target: { value: '0.9' } });
    fireEvent.change(depthInput(2), { target: { value: '90' } });
    fireEvent.change(voltInput(2), { target: { value: '0.8' } });

    expect(within(table()).getByRole('alert')).toHaveTextContent('Row 2: voltage must be greater than row 1.');

    fireEvent.change(depthInput(2), { target: { value: '80' } });
    expect(within(table()).getByRole('alert')).toHaveTextContent('must equal the tank height');

    save();
    // Nothing is written: not the tank, not the shared settings
    await new Promise(r => setTimeout(r, 50));
    expect(mockUpdateTank).not.toHaveBeenCalled();
    expect(mockUpdateConfig).not.toHaveBeenCalled();
  });

  it('loads a saved table, and Clear removes it (back to Vmin/Vmax)', async () => {
    mockTanks[0] = makeTank('1', { levelCalPoints: savedTable });
    render(<Configuration />);
    expect(within(table()).getByText('4 points')).toBeInTheDocument();
    expect(depthInput(2).value).toBe('30');
    expect(voltInput(3).value).toBe('1.1');

    fireEvent.click(within(table()).getByRole('button', { name: 'Clear table (use Vmin/Vmax)' }));
    expect(within(table()).getByText('Not set: Vmin/Vmax line')).toBeInTheDocument();

    save();
    await waitFor(() => expect(mockUpdateTank).toHaveBeenCalledWith('1', expect.objectContaining({ levelCalPoints: null })));
    expect(calibrationLogDetails()).toContain('Level calibration table (4 points:');
    expect(calibrationLogDetails()).toContain('-> none)');
  });

  it('keeps a saved table as it is when only another field changes', async () => {
    mockTanks[0] = makeTank('1', { levelCalPoints: savedTable });
    render(<Configuration />);
    const capacity = screen.getByText('Tank Capacity (L)').parentElement!.querySelector('input') as HTMLInputElement;
    fireEvent.change(capacity, { target: { value: '210' } });
    save();
    await waitFor(() => expect(mockUpdateTank).toHaveBeenCalledWith('1', expect.objectContaining({ levelCalPoints: savedTable })));
    expect(calibrationLogDetails()).not.toContain('Level calibration table');
  });

  it('fills a voltage from the live reading and previews the level with the table', () => {
    mockTanks[0] = makeTank('1', {
      levelCalPoints: savedTable,
      calibrationUntil: Date.now() + 5 * 60_000,
      calibrationLive: { voltage: 0.971, heightM: 0.44, percent: 48, calPoints: 0, at: Date.now() },
    });
    render(<Configuration />);

    expect(screen.getByTestId('level-calibration-preview')).toHaveTextContent('46.2 cm, 51 %');
    expect(screen.getByText(/Vmin and Vmax \(no calibration table\)/)).toBeInTheDocument();

    fireEvent.click(within(table()).getByRole('button', { name: 'Use live reading, row 2' }));
    expect(voltInput(2).value).toBe('0.971');
  });

  it('disables Use live reading without fresh readings, and the whole table for non-admins', () => {
    mockTanks[0] = makeTank('1', { levelCalPoints: savedTable });
    const { unmount } = render(<Configuration />);
    expect(within(table()).getByRole('button', { name: 'Use live reading, row 1' })).toBeDisabled();
    expect(voltInput(1)).not.toBeDisabled();
    unmount();

    mockRole = 'viewer';
    render(<Configuration />);
    expect(voltInput(1)).toBeDisabled();
    expect(depthInput(1)).toBeDisabled();
    expect(within(table()).getByRole('button', { name: /Add row/ })).toBeDisabled();
  });
});

describe('database rules: levelCalPoints', () => {
  it('lets only admins write it and checks the shape of each point', () => {
    const rulesPath = [
      path.resolve(process.cwd(), 'backend/cloud/database.rules.json'),
      path.resolve(process.cwd(), '../backend/cloud/database.rules.json'),
    ].find(p => fs.existsSync(p))!;
    const tank = JSON.parse(fs.readFileSync(rulesPath, 'utf8')).rules.tanks.$tankId;
    const node = tank.levelCalPoints;
    expect(node['.validate']).toContain("val() === 'admin'");
    expect(node['.validate']).toContain("hasChildren(['0', '1'])");
    const point = node.$i['.validate'];
    expect(point).toContain('$i.matches(/^1?[0-9]$/)'); // 20 points at most (keys 0-19)
    expect(point).toContain("hasChildren(['depthM', 'volts'])");
    expect(point).toContain("newData.child('volts').val() >= 0.2");
    expect(point).toContain("newData.child('volts').val() <= 3.25");
    expect(node.$i.$other['.validate']).toBe("$other === 'depthM' || $other === 'volts'");
  });
});
