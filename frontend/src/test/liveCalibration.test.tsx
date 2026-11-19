import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { Tank } from '@/store/useStore';
import { CALIBRATION_LIVE_STEP_MS } from '@/lib/constants';

const mockUpdateTank = vi.fn().mockResolvedValue(undefined);

vi.mock('@/store/useStore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/store/useStore')>();
  return {
    ...actual,
    updateTank: (...args: unknown[]) => mockUpdateTank(...args),
    useServerTimeOffset: () => 0,
  };
});
vi.mock('@/config/firebase', () => ({ database: {}, firestore: {}, auth: {} }));

import LiveCalibrationPanel from '@/pages/admin/LiveCalibrationPanel';

const baseTank: Tank = {
  id: '1', name: 'Reservoir Tank 1', waterLevel: 100, phLevel: 7.1, waterHeight: 0.9, status: 'safe',
  assignedWorker: null, pumpOn: false, enabled: true, levelVmin: 0.6, levelVmax: 1.1, tankHeight: 0.9,
  capacityLiters: 200, levelOffset: 0, phNeutralVoltage: 2.3, phSlope: 0.18, phOffset: 0,
  phSensorOk: true, levelSensorOk: true, lastUpdate: Date.now(), controllerOffline: false,
};

describe('Live calibration readings', () => {
  beforeEach(() => vi.clearAllMocks());

  it('is off by default and Start opens a 10 minute window', async () => {
    const before = Date.now(); // the panel's clock ticks once per second from render
    render(<LiveCalibrationPanel tank={baseTank} canEdit onUseValue={vi.fn()} />);
    expect(screen.getByText('Off')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Start (10 min)' }));
    await waitFor(() => expect(mockUpdateTank).toHaveBeenCalledTimes(1));
    const [id, updates] = mockUpdateTank.mock.calls[0];
    expect(id).toBe('1');
    expect(updates.calibrationUntil).toBeGreaterThanOrEqual(before + CALIBRATION_LIVE_STEP_MS);
    expect(updates.calibrationUntil).toBeLessThanOrEqual(Date.now() + CALIBRATION_LIVE_STEP_MS);
  });

  it('shows fresh readings, warns when Vmax is too low, and fills the form', () => {
    const onUseValue = vi.fn();
    const tank: Tank = {
      ...baseTank,
      calibrationUntil: Date.now() + 5 * 60_000,
      calibrationLive: { voltage: 1.352, heightM: 1.354, percent: 100, phVoltage: 2.31, at: Date.now() },
    };
    render(<LiveCalibrationPanel tank={tank} canEdit onUseValue={onUseValue} />);

    expect(screen.getByText('1.352 V')).toBeInTheDocument();
    expect(screen.getByText('1.354 m')).toBeInTheDocument();
    expect(screen.getByText(/Vmax is probably set too low/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Use as Vmax/ }));
    expect(onUseValue).toHaveBeenCalledWith('levelVmax', 1.352);
  });

  it('waits instead of showing an old reading, and Stop clears the window', async () => {
    const tank: Tank = {
      ...baseTank,
      calibrationUntil: Date.now() + 5 * 60_000,
      calibrationLive: { voltage: 0.9, heightM: 0.54, percent: 60, at: Date.now() - 60_000 },
    };
    render(<LiveCalibrationPanel tank={tank} canEdit onUseValue={vi.fn()} />);
    expect(screen.getByText(/Waiting for Reservoir Tank 1/)).toBeInTheDocument();
    expect(screen.queryByText('0.900 V')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    await waitFor(() => expect(mockUpdateTank).toHaveBeenCalledWith('1', { calibrationUntil: null }));
  });

  it('disables the controls for non-admins', () => {
    render(<LiveCalibrationPanel tank={baseTank} canEdit={false} onUseValue={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Start (10 min)' })).toBeDisabled();
  });
});
