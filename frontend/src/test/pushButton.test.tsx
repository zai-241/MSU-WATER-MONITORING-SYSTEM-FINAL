import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import NotificationCenter from '@/components/NotificationCenter';
import * as authHooks from '@/hooks/useAuth';
import * as storeModule from '@/store/useStore';
import * as push from '@/utils/push';
import { toast } from 'sonner';

vi.mock('@/config/firebase', () => ({ app: {}, database: {}, firestore: {}, auth: {} }));

vi.mock('sonner', () => ({
  toast: { warning: vi.fn(), error: vi.fn(), success: vi.fn(), dismiss: vi.fn() },
}));

vi.mock('@/utils/push', () => ({
  getPushStatus: vi.fn(),
  enablePush: vi.fn(),
  disablePush: vi.fn(),
}));

/** The push button must be visible in every state, so a user can always find out why push is off. */
describe('NotificationCenter push button', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(storeModule, 'useNotifications').mockReturnValue({
      notifications: [],
      addNotification: vi.fn(),
      markRead: vi.fn(),
      clearAll: vi.fn(),
      acknowledgeNotification: vi.fn(),
    } as unknown as ReturnType<typeof storeModule.useNotifications>);
    vi.spyOn(authHooks, 'useAuth').mockReturnValue({
      currentUser: { id: 'u1', username: 'workerBob', email: 'workerBob@example.com', role: 'worker', jobTitle: 'Operator', status: 'active', createdAt: 0 },
      loading: false,
      error: null,
      login: vi.fn(),
      logout: vi.fn(),
      resetPassword: vi.fn(),
      clearError: vi.fn(),
    });
  });

  const openBell = async () => {
    render(<NotificationCenter />);
    fireEvent.click(screen.getByTestId('notification-bell'));
    return screen.findByTestId('push-toggle');
  };

  it.each([
    ['available', 'Enable Push'],
    ['enabled', 'Push On'],
    ['blocked', 'Push Blocked'],
    ['not-configured', 'Push Unavailable'],
    ['unsupported', 'Push Unavailable'],
  ] as const)('shows the button when push is %s', async (status, text) => {
    vi.mocked(push.getPushStatus).mockResolvedValue(status);
    expect(await openBell()).toHaveTextContent(text);
  });

  it('explains why when push cannot be enabled', async () => {
    vi.mocked(push.getPushStatus).mockResolvedValue('not-configured');
    vi.mocked(push.enablePush).mockResolvedValue({ status: 'not-configured', message: 'Push is not set up.' });

    fireEvent.click(await openBell());

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Push is not set up.'));
    expect(screen.getByTestId('push-toggle')).toHaveTextContent('Push Unavailable');
  });
});
