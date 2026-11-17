import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { Tank, SystemConfig } from '@/store/useStore';

const baseTank: Tank = {
  id: '1', name: 'Reservoir Tank 1', waterLevel: 60, phLevel: 7.1, waterHeight: 3, status: 'safe',
  assignedWorker: null, pumpOn: false, enabled: true, levelVmin: 0.25, levelVmax: 3, tankHeight: 5,
  capacityLiters: 200, levelOffset: 0, phNeutralVoltage: 2.5, phSlope: 0.18, phOffset: 0,
  phSensorOk: true, levelSensorOk: true, lastUpdate: Date.now(), controllerOffline: false,
};
const state: { tank: Tank; config: SystemConfig } = {
  tank: baseTank,
  config: { lowLevelThreshold: 15, overflowThreshold: 95, minPh: 6.5, maxPh: 8.5, maintenanceMode: false, pumpControlLock: false },
};

vi.mock('@/store/useStore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/store/useStore')>();
  return {
    ...actual,
    useTanks: () => ({ tanks: [state.tank], isLive: true, updateTank: vi.fn(), serverTimeOffset: 0 }),
    useConfig: () => ({ config: state.config, updateConfig: vi.fn() }),
    useServerTimeOffset: () => 0,
    addSystemLog: vi.fn(),
  };
});
vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'a1', username: 'admin', email: 'a@example.com', role: 'admin', jobTitle: 'Admin', status: 'active', createdAt: 0 } }),
}));
vi.mock('firebase/firestore', () => ({ collection: vi.fn(), onSnapshot: vi.fn(() => vi.fn()), query: vi.fn() }));
vi.mock('@/config/firebase', () => ({ database: {}, firestore: {}, auth: {} }));

import Dashboard from '@/pages/Dashboard';

describe('Dashboard during a sensor fault', () => {
  beforeEach(() => {
    state.tank = { ...baseTank, lastUpdate: Date.now() };
  });

  it('shows no fault notice when both sensors are healthy', () => {
    render(<Dashboard />);
    expect(screen.queryByTestId('sensor-fault-notice')).not.toBeInTheDocument();
  });

  it('shows the pH fault and keeps showing the live pH reading', () => {
    state.tank = { ...state.tank, phSensorOk: false, phLevel: 14 };
    render(<Dashboard />);
    const notice = screen.getByTestId('sensor-fault-notice');
    expect(notice).toHaveTextContent('pH sensor fault');
    expect(notice).toHaveTextContent('monitoring continues');
    expect(screen.getByText('14')).toBeInTheDocument();
  });

  it('shows both faults, keeps the level reading, and says the pump stays off', () => {
    state.tank = { ...state.tank, phSensorOk: false, levelSensorOk: false, waterHeight: 0.4 };
    render(<Dashboard />);
    const notice = screen.getByTestId('sensor-fault-notice');
    expect(notice).toHaveTextContent('Water level and pH sensor fault');
    expect(notice).toHaveTextContent('The pump stays off');
    expect(screen.getByText('0.4m')).toBeInTheDocument();
  });
});
