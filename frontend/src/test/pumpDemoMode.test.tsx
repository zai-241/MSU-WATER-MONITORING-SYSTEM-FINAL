import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { Tank, SystemConfig } from '@/store/useStore';

const liveTank: Tank = {
  id: '1', name: 'Reservoir Tank 1', waterLevel: 60, phLevel: 7.1, waterHeight: 3, status: 'safe',
  assignedWorker: null, pumpOn: false, enabled: true, levelVmin: 0.25, levelVmax: 3, tankHeight: 5,
  capacityLiters: 200, levelOffset: 0, phNeutralVoltage: 2.5, phSlope: 0.18, phOffset: 0,
  phSensorOk: true, levelSensorOk: true, lastUpdate: Date.now(), controllerOffline: false,
};
const state: { config: SystemConfig } = {
  config: { lowLevelThreshold: 15, overflowThreshold: 95, minPh: 6.5, maxPh: 8.5, maintenanceMode: false, pumpControlLock: false },
};

vi.mock('@/store/useStore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/store/useStore')>();
  return {
    ...actual,
    useTanks: () => ({ tanks: [liveTank], isLive: true, updateTank: vi.fn(), serverTimeOffset: 0 }),
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

import { isPumpDemoOn } from '@/store/useStore';
import Dashboard from '@/pages/Dashboard';
import { buildExcelWorkbook, type ReportExportData } from '@/lib/reportExport';

describe('Pump demo mode', () => {
  beforeEach(() => {
    state.config = { lowLevelThreshold: 15, overflowThreshold: 95, minPh: 6.5, maxPh: 8.5, maintenanceMode: false, pumpControlLock: false };
  });

  it('is on unless an admin turns it off', () => {
    expect(isPumpDemoOn(undefined)).toBe(true);
    expect(isPumpDemoOn({})).toBe(true);
    expect(isPumpDemoOn({ pumpDemoMode: true })).toBe(true);
    expect(isPumpDemoOn({ pumpDemoMode: false })).toBe(false);
  });

  it('shows the demo pump switch on the dashboard by default', () => {
    render(<Dashboard />);
    expect(screen.getByText('Pump (Demo):')).toBeInTheDocument();
  });

  it('hides the pump switch and the pump lock banner when demo mode is off', () => {
    state.config = { ...state.config, pumpDemoMode: false, pumpControlLock: true };
    render(<Dashboard />);
    expect(screen.queryByText('Pump (Demo):')).not.toBeInTheDocument();
    expect(screen.queryByText(/Pump Control Lock is active/)).not.toBeInTheDocument();
  });

  it('leaves the pump sheet out of the Excel export when demo mode is off', async () => {
    const base: ReportExportData = {
      currentUser: null,
      dateRange: 'Last 7 Days',
      days: 7,
      logs: [],
      pumpActivityData: [{ date: 'Nov 14', activations: 2 }],
      selectedTank: liveTank,
      summaryMetrics: null,
      telemetryData: [],
      thresholds: { lowLevel: 15, overflow: 95, minPh: 6.5, maxPh: 8.5 },
    } as unknown as ReportExportData;

    const withPump = await buildExcelWorkbook(base);
    expect(withPump.getWorksheet('Demo Pump Activity')).toBeDefined();

    const withoutPump = await buildExcelWorkbook({ ...base, includePump: false });
    expect(withoutPump.getWorksheet('Demo Pump Activity')).toBeUndefined();
    expect(withoutPump.getWorksheet('Alert Logs')).toBeDefined();
  });
});
