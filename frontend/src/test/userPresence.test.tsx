import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import type { UserProfile } from '@/services/authService';
import type { PresenceStatus } from '@/lib/presence';

const state: { presence: Record<string, PresenceStatus> } = { presence: {} };

vi.mock('@/lib/presence', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/presence')>();
  return { ...actual, usePresence: () => state.presence };
});
vi.mock('@/store/useStore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/store/useStore')>();
  return { ...actual, useServerTimeOffset: () => 0 };
});
const admin = {
  id: 'admin1', username: 'admin', email: 'admin@example.com', role: 'admin', jobTitle: 'Administrator', status: 'active', createdAt: 0,
} as UserProfile;
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ currentUser: admin }) }));
vi.mock('@/config/firebase', () => ({ database: {}, firestore: {}, auth: {} }));

import UserManagement from '@/pages/admin/UserManagement';
import { presenceStatus, lastSeenLabel } from '@/lib/presence';

const user = (id: string, username: string, changes: Partial<UserProfile> = {}): UserProfile => ({
  id, username, email: `${username}@example.com`, role: 'worker', jobTitle: 'Operator', status: 'active', createdAt: 0, ...changes,
});
const users = [admin, user('w1', 'juan'), user('w2', 'maria'), user('v1', 'pedro', { role: 'viewer', jobTitle: 'Viewer', status: 'inactive' })];

describe('presence helpers', () => {
  it('is online while at least one connection is open', () => {
    expect(presenceStatus(null)).toEqual({ online: false, devices: 0, apps: [], lastSeen: null });
    expect(presenceStatus({ lastSeen: 5 })).toMatchObject({ online: false, lastSeen: 5 });
    expect(presenceStatus({ connections: { a: { since: 1, app: 'web' }, b: { since: 2, app: 'android' }, c: { since: 3, app: 'web' } } }))
      .toEqual({ online: true, devices: 3, apps: ['android', 'web'], lastSeen: null });
  });

  it('describes when a user was last online', () => {
    const now = 10 * 86_400_000;
    expect(lastSeenLabel(null, now)).toBe('Never seen online');
    expect(lastSeenLabel(now - 20_000, now)).toBe('Last seen just now');
    expect(lastSeenLabel(now - 5 * 60_000, now)).toBe('Last seen 5 min ago');
    expect(lastSeenLabel(now - 3 * 3_600_000, now)).toBe('Last seen 3 h ago');
    expect(lastSeenLabel(now - 86_400_000, now)).toBe('Last seen 1 day ago');
    expect(lastSeenLabel(now - 4 * 86_400_000, now)).toBe('Last seen 4 days ago');
  });
});

describe('User Management: online status', () => {
  beforeEach(() => {
    state.presence = {
      admin1: { online: true, devices: 1, apps: ['web'], lastSeen: null },
      w1: { online: true, devices: 2, apps: ['android', 'web'], lastSeen: null },
      w2: { online: false, devices: 0, apps: [], lastSeen: Date.now() - 10 * 60_000 },
      // v1 never signed in since presence was added
    };
  });

  const renderPage = () => render(<UserManagement users={users} loading={false} addUser={vi.fn()} updateUser={vi.fn()} />);

  it('shows Online or Offline for every user, with the app or the last time seen', () => {
    renderPage();
    expect(screen.getByTestId('presence-w1')).toHaveTextContent('Online');
    expect(screen.getByTestId('presence-w1')).toHaveTextContent('App + Web (2 open)');
    expect(screen.getByTestId('presence-w2')).toHaveTextContent('Offline');
    expect(screen.getByTestId('presence-w2')).toHaveTextContent('Last seen 10 min ago');
    expect(screen.getByTestId('presence-v1')).toHaveTextContent('Never seen online');
    expect(within(screen.getByTestId('online-users')).getByText('2')).toBeInTheDocument();
  });

  it('keeps the account status in its own column', () => {
    renderPage();
    expect(screen.getByRole('columnheader', { name: 'Status' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Account' })).toBeInTheDocument();
    expect(screen.getAllByText('Inactive').length).toBeGreaterThan(0);
  });

  it('has no delete button in the actions any more', () => {
    renderPage();
    expect(screen.getAllByRole('button', { name: 'Deactivate' })).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Activate' })).toBeInTheDocument();
    expect(document.querySelector('.lucide-trash-2, .lucide-trash2')).toBeNull();
    expect(screen.queryByText('Delete User')).not.toBeInTheDocument();
  });
});
