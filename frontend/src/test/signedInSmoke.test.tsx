import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import fs from 'fs';
import path from 'path';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

/**
 * Smoke test for the signed-in app shell with the REAL store (only Firebase is faked).
 * It exists to catch crashes that unit tests with mocked hooks cannot see: the layout,
 * the alert monitor, the bell and each page mounting together on live-shaped data.
 */

const now = Date.now();
const DATA: Record<string, unknown> = {
  tanks: {
    '1': {
      id: '1', name: 'Reservoir Tank 1', enabled: true, waterLevel: 62, phLevel: 7.3, waterHeight: 3.1,
      status: 'safe', pumpOn: false, phSensorOk: true, levelSensorOk: true, lastUpdate: now,
      wifiConnected: true, firebaseConnected: true, rssi: -55, assignedWorker: null,
    },
    '2': { id: '2', name: 'Reservoir Tank 2', enabled: true, waterLevel: 0, phLevel: 7 },
  },
  config: { lowLevelThreshold: 15, overflowThreshold: 95, minPh: 6.5, maxPh: 8.5, maintenanceMode: false, pumpControlLock: false },
  notifications: {
    'alert-1-ph': { id: 'alert-1-ph', tankId: '1', title: 'Unsafe pH Level', message: 'Reservoir Tank 1 pH level is unsafe (9.2).', type: 'danger', timestamp: now - 60000, acknowledged: false, resolved: false },
    'n2': { id: 'n2', tankId: '1', title: 'Controller Back Online', message: 'Reporting live.', type: 'info', timestamp: now - 120000, acknowledged: true, resolved: true },
  },
  logs: { l1: { action: 'PUMP_ON', details: 'Pump turned ON', performedBy: 'admin', timestamp: now - 5000, logLevel: 'INFO' } },
  '.info/serverTimeOffset': 0,
  '.info/connected': true,
  'system/worker/lastSeen': null,
  'userState/uid-admin': null,
  roles: { 'uid-esp32': 'device' },
};

vi.mock('firebase/database', () => ({
  ref: (_db: unknown, p?: string) => ({ _path: p ?? '' }),
  query: (r: unknown) => r,
  orderByChild: vi.fn(), orderByKey: vi.fn(), limitToLast: vi.fn(), startAt: vi.fn(), endAt: vi.fn(),
  onValue: (target: { _path: string }, cb: (s: unknown) => void) => {
    const value = DATA[target._path] ?? null;
    cb({ val: () => value, exists: () => value !== null, forEach: () => {} });
    return () => {};
  },
  get: vi.fn().mockResolvedValue({ exists: () => false, val: () => null, forEach: () => {} }),
  set: vi.fn().mockResolvedValue(undefined),
  update: vi.fn().mockResolvedValue(undefined),
  remove: vi.fn().mockResolvedValue(undefined),
  push: vi.fn(() => ({ key: 'pushKey' })),
  runTransaction: vi.fn().mockResolvedValue({ committed: false }),
}));

vi.mock('firebase/firestore', () => ({
  collection: vi.fn(), query: vi.fn(), doc: vi.fn(),
  onSnapshot: (_q: unknown, cb: (s: unknown) => void) => { cb({ forEach: () => {} }); return () => {}; },
  getDoc: vi.fn(), getDocs: vi.fn(), setDoc: vi.fn(), updateDoc: vi.fn(), deleteDoc: vi.fn(),
}));

vi.mock('@/config/firebase', () => ({ app: {}, database: { app: {} }, firestore: {}, auth: { currentUser: { uid: 'uid-admin' } }, firebaseConfig: {} }));

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({
    currentUser: { id: 'uid-admin', username: 'Admin', email: 'admin@example.com', role: 'admin', jobTitle: 'Admin', status: 'active', createdAt: 1 },
    loading: false, error: null, login: vi.fn(), logout: vi.fn(), resetPassword: vi.fn(), clearError: vi.fn(),
  }),
}));

vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn(), dismiss: vi.fn(), promise: vi.fn() }),
}));

global.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;

import AppLayout from '@/components/AppLayout';
import Dashboard from '@/pages/Dashboard';
import Notifications from '@/pages/Notifications';
import Logs from '@/pages/Logs';
import AdminPanel from '@/pages/AdminPanel';

const renderPage = (page: React.ReactNode) =>
  render(<MemoryRouter><AppLayout>{page}</AppLayout></MemoryRouter>);

describe('Signed-in app smoke test (real store, fake Firebase)', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('renders the dashboard inside the layout with live tank data', async () => {
    renderPage(<Dashboard />);
    await waitFor(() => expect(screen.getAllByText('Reservoir Tank 1').length).toBeGreaterThan(0));
    expect(screen.getByText(/System Controller: Online/)).toBeInTheDocument();
    expect(screen.getByText(/Planned - IoT not yet installed/)).toBeInTheDocument();
    expect(screen.queryByTestId('cached-data-banner')).not.toBeInTheDocument();
    // The active unacknowledged alert shows on the bell
    expect(screen.getByTestId('unacknowledged-count-badge')).toHaveTextContent('1');
  });

  it('renders the notification history page with its rows', async () => {
    renderPage(<Notifications />);
    await waitFor(() => expect(screen.getAllByText('Unsafe pH Level').length).toBeGreaterThan(0));
    expect(screen.getByText('Controller Back Online')).toBeInTheDocument();
  });

  it('renders the logs page', async () => {
    renderPage(<Logs />);
    await waitFor(() => expect(screen.getByText('PUMP_ON')).toBeInTheDocument());
  });

  it('renders the admin panel shell', async () => {
    renderPage(<AdminPanel />);
    await waitFor(() => expect(screen.getAllByText(/Admin Panel|User Management|Users/i).length).toBeGreaterThan(0));
  });
});

describe('Build configuration', () => {
  it('Tailwind resolves its source files relative to the frontend folder', () => {
    // Regression guard: with plain "./src/**" globs, building from the repository root
    // produced a stylesheet with no utility classes and the deployed site was unstyled.
    const config = fs.readFileSync(path.resolve(__dirname, '../../tailwind.config.ts'), 'utf8');
    expect(config).toMatch(/relative:\s*true/);
  });
});
