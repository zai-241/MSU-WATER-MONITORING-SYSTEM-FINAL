import { useState, useEffect, useMemo } from 'react';
import {
  Bell,
  Check,
  Volume2,
  VolumeX,
  BellOff,
  ExternalLink,
  CheckCheck,
  X,
} from 'lucide-react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { useNotifications, useUserNotificationsState, Notification } from '@/store/useStore';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/hooks/useAuth';
import { useIsPhone } from '@/hooks/useMediaQuery';
import { alertSound } from '@/utils/alertSound';
import { groupNotifications, type NotificationGroup } from '@/lib/notificationGroups';
import { toast } from 'sonner';
import { getPushStatus, enablePush, disablePush, type PushStatus } from '@/utils/push';

/** Every control in the panel is at least 44 × 44 px so it can be tapped reliably. */
const TAP = 'min-h-11 min-w-11';

const isAlert = (n: Notification) => n.type === 'warning' || n.type === 'danger';

const formatDateTime = (timestamp?: number) => {
  if (!timestamp) return '';
  const d = new Date(timestamp);
  const isToday = new Date().toDateString() === d.toDateString();
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true });
  return isToday ? time : `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${time}`;
};

const NotificationCenter = () => {
  const { notifications, acknowledgeNotification } = useNotifications();
  const { currentUser } = useAuth();
  const { isUnread, markAllAsRead, markOneRead } = useUserNotificationsState(currentUser?.id);
  const isPhone = useIsPhone();

  // Audio state
  const [isMuted, setIsMuted] = useState(() => alertSound.isMuted());
  const [isSnoozed, setIsSnoozed] = useState(() => alertSound.isSnoozed());
  const [isAudioBlocked, setIsAudioBlocked] = useState(() => alertSound.isAudioBlocked());
  const [open, setOpen] = useState(false);

  useEffect(() => {
    return alertSound.subscribe(() => {
      setIsMuted(alertSound.isMuted());
      setIsSnoozed(alertSound.isSnoozed());
      setIsAudioBlocked(alertSound.isAudioBlocked());
    });
  }, []);

  const groups = useMemo(() => groupNotifications(notifications), [notifications]);

  // Unread count per user
  const unreadCount = notifications.filter(isUnread).length;

  // Warning and critical alerts that are not yet acknowledged or resolved
  const unacknowledgedCount = notifications.filter(
    n => isAlert(n) && !n.acknowledged && !n.resolved
  ).length;

  // Only admin and worker can acknowledge alerts
  const canAcknowledge = currentUser?.role === 'admin' || currentUser?.role === 'worker';

  const handleAcknowledge = (group: NotificationGroup) => {
    const username = currentUser?.username || 'Operator';
    const pending = group.members.filter(n => isAlert(n) && !n.acknowledged);
    Promise.all(pending.map(n => Promise.resolve(acknowledgeNotification(n.id, username, n.title)))).catch(() => {
      toast.error('Could not acknowledge the alert. Check your connection and try again.');
    });
  };

  // R7: desktop notifications for background tabs need a one-time browser permission
  const desktopSupported = typeof window !== 'undefined' && 'Notification' in window;
  const [desktopPermission, setDesktopPermission] = useState<string>(
    () => (desktopSupported ? window.Notification.permission : 'denied')
  );
  const requestDesktopAlerts = async () => {
    if (!desktopSupported) return;
    try {
      const result = await window.Notification.requestPermission();
      setDesktopPermission(result);
      if (result === 'denied') {
        toast.error('Desktop alerts are blocked for this site in your browser settings.');
      }
    } catch {
      // Browser refused to show the prompt
    }
  };

  // R9: push alerts reach this device even when the tab (or the Android app) is closed
  const [pushStatus, setPushStatus] = useState<PushStatus>('unsupported');
  const [pushBusy, setPushBusy] = useState(false);
  useEffect(() => {
    let cancelled = false;
    getPushStatus().then((status) => { if (!cancelled) setPushStatus(status); });
    return () => { cancelled = true; };
  }, [open, currentUser?.id]);

  const togglePush = async () => {
    const uid = currentUser?.id;
    if (!uid || pushBusy) return;
    setPushBusy(true);
    try {
      if (pushStatus === 'enabled') {
        await disablePush(uid);
        setPushStatus(await getPushStatus());
        toast.success('Push alerts turned off on this device.');
        return;
      }
      const result = await enablePush(uid);
      setPushStatus(result.status);
      if (desktopSupported) setDesktopPermission(window.Notification.permission);
      if (result.status === 'enabled') {
        toast.success('Push alerts enabled on this device.');
      } else if (result.message) {
        toast.error(result.message);
      }
    } finally {
      setPushBusy(false);
    }
  };
  const pushAvailable = pushStatus === 'enabled' || pushStatus === 'available';

  /** Toolbar button: icon only on phones (label kept for screen readers), icon + text from 640px */
  const ToolButton = ({ label, text, icon, onClick, className = '', variant = 'ghost', disabled, testId }: {
    label: string; text: string; icon: React.ReactNode; onClick: () => void;
    className?: string; variant?: 'ghost' | 'outline'; disabled?: boolean; testId?: string;
  }) => (
    <Button
      variant={variant}
      size="sm"
      onClick={onClick}
      disabled={disabled}
      data-testid={testId}
      aria-label={label}
      title={label}
      className={`${TAP} px-2 text-[11px] font-semibold gap-1 ${className}`}
    >
      {icon}
      <span className="hidden sm:inline">{text}</span>
    </Button>
  );

  const header = (
    <div className="shrink-0 border-b">
      <div className="flex items-center justify-between gap-2 px-3 py-1">
        <div className="flex min-w-0 items-center gap-2">
          {isPhone ? (
            <DialogPrimitive.Title className="font-semibold text-sm truncate">Notifications</DialogPrimitive.Title>
          ) : (
            <h4 className="font-semibold text-sm truncate">Notifications</h4>
          )}
          {unacknowledgedCount > 0 && (
            <span className="shrink-0 px-1.5 py-0.5 rounded text-[10px] font-bold bg-red-500/10 text-red-600 border border-red-500/20">
              {unacknowledgedCount} Unack
            </span>
          )}
        </div>
        <div className="flex shrink-0 items-center">
          {unreadCount > 0 && (
            <ToolButton
              label="Mark all as read for your account"
              text="Mark all read"
              icon={<CheckCheck className="h-4 w-4" />}
              onClick={() => markAllAsRead()}
              className="text-muted-foreground hover:text-foreground"
            />
          )}
          {isPhone && (
            <DialogPrimitive.Close asChild>
              <Button variant="ghost" size="icon" className={TAP} aria-label="Close notifications">
                <X className="h-5 w-5" />
              </Button>
            </DialogPrimitive.Close>
          )}
        </div>
      </div>

      {/* Audio and delivery controls (R7, R9) */}
      <div className="flex flex-wrap items-center justify-between gap-x-2 bg-secondary/30 border-t px-3 text-xs text-muted-foreground">
        <span className="text-[11px] font-medium">Alert audio</span>
        <div className="flex flex-wrap items-center justify-end">
          {pushAvailable && (
            <ToolButton
              testId="push-toggle"
              variant={pushStatus === 'enabled' ? 'ghost' : 'outline'}
              label={pushStatus === 'enabled'
                ? 'Push alerts are on for this device. Tap to turn them off.'
                : 'Get alerts on this device even when the app is closed'}
              text={pushStatus === 'enabled' ? 'Push On' : 'Enable Push'}
              icon={<Bell className="h-4 w-4" />}
              onClick={togglePush}
              disabled={pushBusy}
              className={pushStatus === 'enabled' ? 'text-emerald-600' : ''}
            />
          )}
          {!pushAvailable && desktopSupported && desktopPermission === 'default' && (
            <ToolButton
              variant="outline"
              label="Show a desktop notification when an alert fires while this tab is in the background"
              text="Desktop Alerts"
              icon={<Bell className="h-4 w-4" />}
              onClick={requestDesktopAlerts}
            />
          )}
          {isAudioBlocked && (
            <ToolButton
              variant="outline"
              label="Enable alert sound"
              text="Enable Sound"
              icon={<Volume2 className="h-4 w-4" />}
              onClick={() => alertSound.unlockAudio()}
              className="text-amber-600 border-amber-500/30 hover:bg-amber-500/10"
            />
          )}
          <ToolButton
            label={isSnoozed ? 'Snooze active (15 min). Tap to resume alert sound.' : 'Snooze alert sound for 15 minutes'}
            text={isSnoozed ? 'Snoozed (15m)' : 'Snooze'}
            icon={<BellOff className="h-4 w-4" />}
            onClick={() => (isSnoozed ? alertSound.clearSnooze() : alertSound.snooze(15))}
            className={isSnoozed ? 'bg-amber-500/10 text-amber-600' : ''}
          />
          <ToolButton
            label={isMuted ? 'Unmute alert sounds' : 'Mute alert sounds on this device'}
            text={isMuted ? 'Muted' : 'Mute'}
            icon={isMuted ? <VolumeX className="h-4 w-4 text-red-500" /> : <Volume2 className="h-4 w-4" />}
            onClick={() => alertSound.setMuted(!isMuted)}
            className={isMuted ? 'text-destructive' : ''}
          />
        </div>
      </div>
    </div>
  );

  const list = (
    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain" data-testid="notification-list">
      {groups.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-40 text-muted-foreground text-sm">
          <Bell className="h-8 w-8 mb-2 opacity-20" />
          <p>No notifications yet</p>
        </div>
      ) : (
        <div className="divide-y">
          {groups.map((group) => {
            const notif = group.latest;
            const count = group.members.length;
            const alertMembers = group.members.filter(isAlert);
            const hasAlert = alertMembers.length > 0;
            const pending = alertMembers.filter(n => !n.acknowledged);
            const acked = alertMembers.find(n => n.acknowledged);
            const unread = group.members.some(isUnread);

            return (
              <div
                key={group.key}
                className={`px-3 py-3 cursor-pointer hover:bg-muted/50 transition-colors ${unread ? 'bg-primary/5' : ''}`}
                onClick={() => group.members.forEach(n => markOneRead(n.id))}
              >
                <div className="flex gap-2.5 items-start">
                  <div
                    className={`mt-1.5 h-2 w-2 rounded-full shrink-0 ${
                      notif.type === 'danger' ? 'bg-red-500' : notif.type === 'warning' ? 'bg-yellow-500' : 'bg-blue-500'
                    }`}
                  />
                  <div className="min-w-0 flex-1 space-y-1">
                    {/* Title and time share one row; the title truncates, the time never does */}
                    <div className="flex min-w-0 items-baseline gap-2">
                      <p className={`min-w-0 flex-1 truncate text-sm font-medium ${unread ? 'text-primary font-semibold' : ''}`}>
                        {notif.title}
                      </p>
                      {count > 1 && (
                        <span
                          className="shrink-0 rounded bg-secondary px-1.5 text-[10px] font-bold text-foreground"
                          aria-label={`${count} connection changes`}
                          title={`${count} offline/online changes within a minute of each other`}
                        >
                          ×{count}
                        </span>
                      )}
                      <time className="shrink-0 whitespace-nowrap text-xs text-muted-foreground">
                        {formatDateTime(notif.timestamp)}
                      </time>
                      {unread && <span className="h-1.5 w-1.5 shrink-0 self-center rounded-full bg-blue-500" />}
                    </div>
                    <p className="text-xs text-muted-foreground line-clamp-2 break-words">{notif.message}</p>
                    {count > 1 && (
                      <p className="text-[11px] text-muted-foreground">
                        Connection changed {count} times between {formatDateTime(group.members[count - 1].timestamp)} and {formatDateTime(notif.timestamp)}.
                      </p>
                    )}
                  </div>
                </div>

                {/* Status and Acknowledge sit on their own row and wrap when space runs out */}
                {hasAlert && (
                  <div className="mt-2 ml-[18px] flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t border-border/40 pt-2 text-xs">
                    {pending.length === 0 ? (
                      <span className="flex min-w-0 items-center gap-1 text-[11px] font-medium text-muted-foreground">
                        <Check className="h-3 w-3 shrink-0 text-emerald-500" />
                        <span className="break-words">
                          Acknowledged by {acked?.acknowledgedBy || 'Operator'} at {formatDateTime(acked?.acknowledgedAt || acked?.timestamp)}
                        </span>
                      </span>
                    ) : (
                      <>
                        <span className="text-[11px] font-semibold text-amber-600 dark:text-amber-400">Unacknowledged</span>
                        {canAcknowledge && (
                          <Button
                            size="sm"
                            variant="outline"
                            className={`${TAP} px-3 text-xs font-semibold border-amber-500/40 text-amber-600 hover:bg-amber-500/10 dark:text-amber-400`}
                            onClick={(e) => {
                              e.stopPropagation();
                              handleAcknowledge(group);
                            }}
                          >
                            Acknowledge
                          </Button>
                        )}
                      </>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );

  const footer = (
    <div className="shrink-0 border-t bg-muted/20 text-center">
      <a
        href="/notifications"
        onClick={() => setOpen(false)}
        className="flex min-h-11 items-center justify-center gap-1 px-3 text-xs font-semibold text-primary hover:underline"
      >
        <span>View All Notifications & History</span>
        <ExternalLink className="h-3 w-3 shrink-0" />
      </a>
    </div>
  );

  const bell = (
    <Button variant="ghost" size="icon" className={`relative ${TAP}`} data-testid="notification-bell" aria-label="Notifications">
      <Bell className="h-5 w-5" />
      {unacknowledgedCount > 0 ? (
        <span
          data-testid="unacknowledged-count-badge"
          className="absolute top-0.5 right-0.5 flex h-[18px] min-w-[18px] px-1 items-center justify-center rounded-full bg-red-600 text-[10px] font-bold text-white shadow-sm ring-2 ring-background animate-pulse"
          title={`${unacknowledgedCount} unacknowledged alert${unacknowledgedCount > 1 ? 's' : ''}`}
        >
          {unacknowledgedCount > 99 ? '99+' : unacknowledgedCount}
        </span>
      ) : unreadCount > 0 ? (
        <span className="absolute top-2 right-2 flex h-2.5 w-2.5">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
          <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-blue-500"></span>
        </span>
      ) : null}
    </Button>
  );

  // Phones: a full-width bottom sheet over a backdrop, nearly full height, with its own close button
  if (isPhone) {
    return (
      <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
        <DialogPrimitive.Trigger asChild>{bell}</DialogPrimitive.Trigger>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/60 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
          <DialogPrimitive.Content
            aria-describedby={undefined}
            className="fixed inset-x-0 bottom-0 z-50 flex h-[calc(100dvh-2.5rem)] max-h-[100dvh] w-full flex-col overflow-hidden rounded-t-2xl border-t bg-background pb-[env(safe-area-inset-bottom)] shadow-xl data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom"
          >
            {header}
            {list}
            {footer}
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>
    );
  }

  // Tablet and desktop: a dropdown under the bell, never wider than the screen
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{bell}</PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={8}
        collisionPadding={8}
        className="flex w-[min(400px,calc(100vw-16px))] max-h-[min(70vh,var(--radix-popover-content-available-height))] flex-col overflow-hidden p-0"
      >
        {header}
        {list}
        {footer}
      </PopoverContent>
    </Popover>
  );
};

export default NotificationCenter;
