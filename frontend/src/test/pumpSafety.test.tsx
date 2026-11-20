/**
 * N1 / N2 (docs/New_Bugs_2026-11-20.md):
 *  - N1: the controller treats only HTTP 2xx as success, and reads pump commands only from a real tank record.
 *  - N2: the dry-run guard stops a pump whose level does not rise (or that runs too long), writes
 *        tanks/{id}/pumpFault, and the alert engine and Dashboard report it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import fs from 'fs';
import path from 'path';
import { evaluateTank, createTankTrackers, describePumpFault, type EngineTank, type EngineConfig } from '@/lib/alertEngine';
import { sanitizeTank, type Tank, type SystemConfig } from '@/store/useStore';

const SKETCHES = ['esp32_firmware.ino', 'tank2/tank2.ino', 'tank3/tank3.ino', 'tank4/tank4.ino'];
const firmwareDir = [
  path.resolve(process.cwd(), 'backend/firmware'),
  path.resolve(process.cwd(), '../backend/firmware'),
].find(p => fs.existsSync(p))!;

describe('Firmware: Firebase replies and the pump dry-run guard (all sketches)', () => {
  for (const sketch of SKETCHES) {
    const source = fs.readFileSync(path.join(firmwareDir, sketch), 'utf8');

    it(`${sketch}: only HTTP 2xx counts as a successful poll or upload (N1)`, () => {
      expect(source).not.toContain('httpResponseCode > 0 && httpResponseCode != 401');
      expect(source.match(/httpResponseCode >= 200 && httpResponseCode < 300/g)?.length).toBeGreaterThanOrEqual(2);
      // A reply without "pumpOn" (error text, null) is never read as an OFF command
      expect(source).toMatch(/hasKeyInJson\(payload, "pumpOn"\) &&\s+firebasePump != lastSentPumpState/);
    });

    it(`${sketch}: stops a pump whose level does not rise or that runs too long (N2)`, () => {
      expect(source).toMatch(/const unsigned long PUMP_NO_RISE_TIMEOUT_MS = /);
      expect(source).toMatch(/const unsigned long PUMP_MAX_RUN_MS = /);
      expect(source).toContain('fault = "no-rise"');
      expect(source).toContain('fault = "max-run"');
      // Every start (automatic and manual) restarts the guard's clocks
      expect(source.match(/notePumpStarted\((levelPercent|lvlPct)\);/g)?.length).toBeGreaterThanOrEqual(3);
      // Automatic starts wait for an operator after a trip; the fault is reported to the database
      expect(source).toContain('[Pump] Auto-start blocked: pump fault');
      expect(source).toContain('\\"pumpFault\\":');
    });
  }
});

describe('Alert engine: pump fault', () => {
  const config: EngineConfig = { lowLevelThreshold: 15, overflowThreshold: 95, minPh: 6.5, maxPh: 8.5 };
  const tank: EngineTank = {
    id: '1', name: 'Tank 1', enabled: true, lastUpdate: 1, waterLevel: 12, phLevel: 7.2, phSensorOk: true, levelSensorOk: true,
  };
  const run = (t: EngineTank, times: number[], trackers = createTankTrackers()) =>
    times.map(now => evaluateTank({ tank: t, config, trackers, now, getExisting: () => null }));

  it('describes the controller reasons', () => {
    expect(describePumpFault('no-rise')).toMatch(/did not rise/);
    expect(describePumpFault('max-run')).toMatch(/maximum run time/);
    expect(describePumpFault(null)).toBeNull();
    expect(describePumpFault('')).toBeNull();
  });

  it('raises a danger alert after 5 s and recovers when the fault clears', () => {
    const trackers = createTankTrackers();
    const raised = run({ ...tank, pumpFault: 'no-rise' }, [1000, 6000], trackers).flat().filter(e => e.key === 'pumpFault');
    expect(raised).toHaveLength(1);
    expect(raised[0]).toMatchObject({ kind: 'raise', level: 'danger', notifId: 'alert-1-pumpFault', title: 'Pump Stopped: Check Water Supply' });
    expect(raised[0].message).toMatch(/did not rise/);

    const recovered = run({ ...tank, pumpFault: null }, [7000, 12000], trackers).flat().filter(e => e.key === 'pumpFault');
    expect(recovered[0]).toMatchObject({ kind: 'recover' });
  });

  it('stays quiet without a fault', () => {
    expect(run(tank, [1000, 6000]).flat().filter(e => e.key === 'pumpFault')).toEqual([]);
  });

  it('sanitizeTank keeps a fault string and drops anything else', () => {
    expect(sanitizeTank('1', { pumpFault: 'max-run' }).pumpFault).toBe('max-run');
    expect(sanitizeTank('1', { pumpFault: 42 }).pumpFault).toBeNull();
    expect(sanitizeTank('1', {}).pumpFault).toBeNull();
  });
});

// --- Dashboard notice ---------------------------------------------------------

const baseTank: Tank = {
  id: '1', name: 'Reservoir Tank 1', waterLevel: 12, phLevel: 7.1, waterHeight: 0.1, status: 'safe',
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

describe('Dashboard: pump stopped by the dry-run guard', () => {
  beforeEach(() => {
    state.tank = { ...baseTank, lastUpdate: Date.now() };
    state.config = { ...state.config, pumpDemoMode: true };
  });

  it('shows no notice without a pump fault', () => {
    render(<Dashboard />);
    expect(screen.queryByTestId('pump-fault-notice')).not.toBeInTheDocument();
  });

  it('explains the stop and how to clear it', () => {
    state.tank = { ...state.tank, pumpFault: 'no-rise' };
    render(<Dashboard />);
    const notice = screen.getByTestId('pump-fault-notice');
    expect(notice).toHaveTextContent('Pump stopped automatically');
    expect(notice).toHaveTextContent('did not rise');
    expect(notice).toHaveTextContent('turned ON here');
  });

  it('hides the notice while the pump system is off', () => {
    state.tank = { ...state.tank, pumpFault: 'max-run' };
    state.config = { ...state.config, pumpDemoMode: false };
    render(<Dashboard />);
    expect(screen.queryByTestId('pump-fault-notice')).not.toBeInTheDocument();
  });
});
