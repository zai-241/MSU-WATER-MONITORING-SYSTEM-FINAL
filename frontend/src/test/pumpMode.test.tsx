import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { Tank, SystemConfig } from '@/store/useStore';
import type { UserProfile } from '@/services/authService';

const liveTank: Tank = {
  id: '1', name: 'Reservoir Tank 1', waterLevel: 60, phLevel: 7.1, waterHeight: 3, status: 'safe',
  assignedWorker: null, pumpOn: false, enabled: true, levelVmin: 0.25, levelVmax: 3, tankHeight: 5,
  capacityLiters: 200, levelOffset: 0, phNeutralVoltage: 2.5, phSlope: 0.18, phOffset: 0,
  phSensorOk: true, levelSensorOk: true, lastUpdate: Date.now(), controllerOffline: false,
};

const baseConfig: SystemConfig = {
  lowLevelThreshold: 15, overflowThreshold: 95, minPh: 6.5, maxPh: 8.5,
  maintenanceMode: false, pumpControlLock: false, offlineThresholdSec: 30, repeatIntervalSec: 60,
};

const makeUser = (role: UserProfile['role']): UserProfile => ({
  id: `${role}1`, username: role, email: `${role}@example.com`, role, jobTitle: role, status: 'active', createdAt: 0,
} as UserProfile);

const state: { config: SystemConfig; user: UserProfile } = { config: baseConfig, user: makeUser('admin') };
const mockUpdateConfig = vi.fn().mockResolvedValue(undefined);
const mockAddSystemLog = vi.fn();

vi.mock('@/store/useStore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/store/useStore')>();
  return {
    ...actual,
    useTanks: () => ({ tanks: [liveTank], isLive: true, updateTank: vi.fn(), serverTimeOffset: 0 }),
    useConfig: () => ({ config: state.config, updateConfig: mockUpdateConfig }),
    useWorkerStatus: () => ({ active: true, lastSeen: Date.now() }),
    useServerTimeOffset: () => 0,
    addSystemLog: (...args: unknown[]) => mockAddSystemLog(...args),
  };
});
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ currentUser: state.user }) }));
vi.mock('@/pages/admin/DeviceAccounts', () => ({ default: () => null }));
vi.mock('firebase/firestore', () => ({ collection: vi.fn(), onSnapshot: vi.fn(() => vi.fn()), query: vi.fn() }));
vi.mock('@/config/firebase', () => ({ database: {}, firestore: {}, auth: {} }));

import { getPumpMode } from '@/store/useStore';
import Configuration from '@/pages/admin/Configuration';
import Dashboard from '@/pages/Dashboard';

describe('Pump mode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.config = { ...baseConfig };
    state.user = makeUser('admin');
  });

  it('counts a missing or invalid value as auto', () => {
    expect(getPumpMode(undefined)).toBe('auto');
    expect(getPumpMode({})).toBe('auto');
    expect(getPumpMode({ pumpMode: 'auto' })).toBe('auto');
    expect(getPumpMode({ pumpMode: 'MANUAL' })).toBe('auto');
    expect(getPumpMode({ pumpMode: 42 })).toBe('auto');
    expect(getPumpMode({ pumpMode: 'manual' })).toBe('manual');
  });

  describe('Admin Panel toggle', () => {
    it('is shown to admins and selects Auto when pumpMode is missing', () => {
      render(<Configuration />);
      expect(screen.getByTestId('pump-mode-setting')).toBeInTheDocument();
      expect(screen.getByRole('radio', { name: 'Auto' })).toHaveAttribute('aria-checked', 'true');
      expect(screen.getByRole('radio', { name: 'Manual' })).toHaveAttribute('aria-checked', 'false');
    });

    it.each(['worker', 'viewer'] as const)('is hidden from a %s', (role) => {
      state.user = makeUser(role);
      render(<Configuration />);
      expect(screen.queryByTestId('pump-mode-setting')).not.toBeInTheDocument();
    });

    it('is hidden when the Pump System is off', () => {
      state.config = { ...baseConfig, pumpDemoMode: false };
      render(<Configuration />);
      expect(screen.queryByTestId('pump-mode-setting')).not.toBeInTheDocument();
    });

    it('writes pumpMode after confirmation and adds an audit log entry', async () => {
      render(<Configuration />);
      fireEvent.click(screen.getByRole('radio', { name: 'Manual' }));
      expect(mockUpdateConfig).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole('button', { name: 'Switch to Manual' }));

      await waitFor(() => expect(mockUpdateConfig).toHaveBeenCalledWith({ pumpMode: 'manual' }));
      expect(mockAddSystemLog).toHaveBeenCalledWith(expect.objectContaining({
        action: 'Configuration Updated',
        details: 'Pump mode changed (AUTO -> MANUAL)',
        logLevel: 'INFO',
      }));
    });

    it('does not write pumpMode from Save All Configurations', async () => {
      state.config = { ...baseConfig, pumpMode: 'manual' };
      render(<Configuration />);
      fireEvent.click(screen.getByRole('button', { name: /Save All Configurations/ }));
      fireEvent.click(screen.getByRole('button', { name: 'Confirm & Apply' }));
      await waitFor(() => expect(mockUpdateConfig).toHaveBeenCalled());
      expect(mockUpdateConfig.mock.calls[0][0]).not.toHaveProperty('pumpMode');
    });
  });

  describe('Dashboard badge', () => {
    it('shows Auto and the auto-restart note when pumpMode is missing', () => {
      render(<Dashboard />);
      expect(screen.getByTestId('pump-mode-badge')).toHaveTextContent('Auto');
      expect(screen.getByTestId('pump-auto-note')).toHaveTextContent('may restart by itself at or below 15%');
    });

    it('shows Manual without the auto-restart note in manual mode', () => {
      state.config = { ...baseConfig, pumpMode: 'manual' };
      render(<Dashboard />);
      expect(screen.getByTestId('pump-mode-badge')).toHaveTextContent('Manual');
      expect(screen.queryByTestId('pump-auto-note')).not.toBeInTheDocument();
    });

    it('is hidden when the Pump System is off', () => {
      state.config = { ...baseConfig, pumpDemoMode: false, pumpMode: 'manual' };
      render(<Dashboard />);
      expect(screen.queryByTestId('pump-mode-badge')).not.toBeInTheDocument();
      expect(screen.queryByTestId('pump-auto-note')).not.toBeInTheDocument();
    });
  });
});
