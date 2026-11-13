import { useState, useEffect, useRef } from 'react';
import {
  Bell,
  Check,
  Volume2,
  VolumeX,
  BellOff,
  ExternalLink,
  CheckCheck
} from 'lucide-react';
import { useNotifications, useUserNotificationsState, Notification } from '@/store/useStore';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useAuth } from '@/hooks/useAuth';
import { alertSound } from '@/utils/alertSound';
import { toast } from 'sonner';
import {
  getPushStatus,
  enablePush,
  disablePush,
  setPushOptOut,
  autoEnableNativePush,
  clearDeliveredPushNotifications,
  type PushStatus,
} from '@/utils/push';

const NotificationCenter = () => {
  const { notifications, acknowledgeNotification } = useNotifications();
  const { currentUser } = useAuth();
  const { isUnread, markAllAsRead, markOneRead } = useUserNotificationsState(currentUser?.id);

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

  // Unread count per user
  const unreadCount = notifications.filter(isUnread).length;

  // Warning and critical alerts (type === 'warning' or 'danger') that are not yet acknowledged or resolved
  const unacknowledgedCount = notifications.filter(
    n => (n.type === 'warning' || n.type === 'danger') && !n.acknowledged && !n.resolved
  ).length;

  // Only admin and worker can acknowledge alerts
  const isPrivileged = currentUser?.role === 'admin' || currentUser?.role === 'worker';
  const canAcknowledge = isPrivileged;

  const handleMarkRead = (id: string) => {
    markOneRead(id);
  };

  const handleAcknowledge = (notif: Notification) => {
    const username = currentUser?.username || 'Operator';
    Promise.resolve(acknowledgeNotification(notif.id, username, notif.title)).catch(() => {
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

  // Android app: switch push on by itself after sign-in (asks Android permission once)
  useEffect(() => {
    const uid = currentUser?.id;
    if (!uid) return;
    let cancelled = false;
    autoEnableNativePush(uid).then((result) => {
      if (cancelled || !result) return;
      setPushStatus(result.status);
      if (result.status === 'enabled') toast.success('Push alerts are on for this phone.');
      else if (result.message) toast.error(result.message);
    });
    return () => { cancelled = true; };
  }, [currentUser?.id]);

  // Android app: once everything is read, clear the alerts in the shade and the app-icon badge.
  // Only on a change to zero, so the empty list while data is still loading does not clear them.
  const previousUnread = useRef(unreadCount);
  useEffect(() => {
    if (previousUnread.current > 0 && unreadCount === 0) clearDeliveredPushNotifications();
    previousUnread.current = unreadCount;
  }, [unreadCount]);

  const togglePush = async () => {
    const uid = currentUser?.id;
    if (!uid || pushBusy) return;
    setPushBusy(true);
    try {
      if (pushStatus === 'enabled') {
        await disablePush(uid);
        setPushOptOut(true);
        setPushStatus(await getPushStatus());
        toast.success('Push alerts turned off on this device.');
        return;
      }
      setPushOptOut(false);
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

  const formatDateTime = (timestamp?: number) => {
    if (!timestamp) return '';
    const d = new Date(timestamp);
    const isToday = new Date().toDateString() === d.toDateString();
    if (isToday) {
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true });
    }
    return (
      d.toLocaleDateString([], { month: 'short', day: 'numeric' }) +
      ' ' +
      d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true })
    );
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" data-testid="notification-bell">
          <Bell className="h-5 w-5" />
          {unacknowledgedCount > 0 ? (
            <span
              data-testid="unacknowledged-count-badge"
              className="absolute -top-1 -right-1 flex h-4.5 min-w-4.5 px-1 items-center justify-center rounded-full bg-red-600 text-[10px] font-bold text-white shadow-sm ring-2 ring-background animate-pulse"
              title={`${unacknowledgedCount} unacknowledged alert${unacknowledgedCount > 1 ? 's' : ''}`}
            >
              {unacknowledgedCount > 99 ? '99+' : unacknowledgedCount}
            </span>
          ) : unreadCount > 0 ? (
            <span className="absolute top-1.5 right-1.5 flex h-2.5 w-2.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-blue-500"></span>
            </span>
          ) : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-84 sm:w-96 p-0" align="end">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <div className="flex items-center gap-2">
            <h4 className="font-semibold text-sm">Notifications</h4>
            {unacknowledgedCount > 0 && (
              <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-red-500/10 text-red-600 border border-red-500/20">
                {unacknowledgedCount} Unack
              </span>
            )}
          </div>

          <div className="flex items-center gap-1">
            {unreadCount > 0 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => markAllAsRead()}
                className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground gap-1"
                title="Mark all as read for your account"
              >
                <CheckCheck className="h-3 w-3" />
                Mark all read
              </Button>
            )}
          </div>
        </div>

        {/* Audio controls toolbar (R7) */}
        <div className="flex items-center justify-between px-4 py-1.5 bg-secondary/30 border-b text-xs text-muted-foreground">
          <span className="text-[11px] font-medium">Alert Audio:</span>
          <div className="flex items-center gap-1.5">
            {pushAvailable && (
              <Button
                variant={pushStatus === 'enabled' ? 'ghost' : 'outline'}
                size="sm"
                onClick={togglePush}
                disabled={pushBusy}
                data-testid="push-toggle"
                className={`h-6 px-2 text-[10px] font-semibold gap-1 ${pushStatus === 'enabled' ? 'text-emerald-600' : ''}`}
                title={pushStatus === 'enabled'
                  ? 'Push alerts are on for this device. Click to turn them off.'
                  : 'Get alerts on this device even when this page is closed'}
              >
                <Bell className="h-3 w-3" />
                {pushStatus === 'enabled' ? 'Push On' : 'Enable Push'}
              </Button>
            )}
            {!pushAvailable && desktopSupported && desktopPermission === 'default' && (
              <Button
                variant="outline"
                size="sm"
                onClick={requestDesktopAlerts}
                className="h-6 px-2 text-[10px] font-semibold gap-1"
                title="Show a desktop notification when an alert fires while this tab is in the background"
              >
                <Bell className="h-3 w-3" />
                Desktop Alerts
              </Button>
            )}
            {isAudioBlocked && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => alertSound.unlockAudio()}
                className="h-6 px-2 text-[10px] font-semibold text-amber-600 border-amber-500/30 hover:bg-amber-500/10 gap-1"
              >
                <Volume2 className="h-3 w-3" />
                Enable Sound
              </Button>
            )}

            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                if (isSnoozed) {
                  alertSound.clearSnooze();
                } else {
                  alertSound.snooze(15);
                }
              }}
              className={`h-6 px-2 text-[10px] gap-1 ${
                isSnoozed ? 'bg-amber-500/10 text-amber-600 font-semibold' : ''
              }`}
              title={isSnoozed ? 'Snooze active (15m). Click to resume.' : 'Snooze alert sound for 15 minutes'}
            >
              <BellOff className="h-3 w-3" />
              {isSnoozed ? 'Snoozed (15m)' : 'Snooze'}
            </Button>

            <Button
              variant="ghost"
              size="sm"
              onClick={() => alertSound.setMuted(!isMuted)}
              className={`h-6 px-2 text-[10px] gap-1 ${
                isMuted ? 'text-destructive font-semibold' : ''
              }`}
              title={isMuted ? 'Unmute alert sounds' : 'Mute alert sounds on this device'}
            >
              {isMuted ? <VolumeX className="h-3 w-3 text-red-500" /> : <Volume2 className="h-3 w-3" />}
              {isMuted ? 'Muted' : 'Mute'}
            </Button>
          </div>
        </div>

        {/* Scrollable list */}
        <ScrollArea className="h-[320px]">
          {notifications.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-40 text-muted-foreground text-sm">
              <Bell className="h-8 w-8 mb-2 opacity-20" />
              <p>No notifications yet</p>
            </div>
          ) : (
            <div className="divide-y">
              {notifications.map((notif) => {
                const isAlert = notif.type === 'warning' || notif.type === 'danger';
                const isAcknowledged = !!notif.acknowledged;
                const unread = isUnread(notif);

                return (
                  <div
                    key={notif.id}
                    className={`flex flex-col gap-1.5 px-4 py-3 cursor-pointer hover:bg-muted/50 transition-colors ${
                      unread ? 'bg-primary/5' : ''
                    }`}
                    onClick={() => handleMarkRead(notif.id)}
                  >
                    <div className="flex gap-3 items-start">
                      <div
                        className={`mt-1 h-2 w-2 rounded-full flex-shrink-0 ${
                          notif.type === 'danger'
                            ? 'bg-red-500'
                            : notif.type === 'warning'
                            ? 'bg-yellow-500'
                            : 'bg-blue-500'
                        }`}
                      />
                      <div className="flex-1 space-y-1">
                        <div className="flex justify-between items-start">
                          <p
                            className={`text-sm font-medium leading-none ${
                              unread ? 'text-primary font-semibold' : ''
                            }`}
                          >
                            {notif.title}
                          </p>
                          <span className="text-xs text-muted-foreground whitespace-nowrap ml-2">
                            {formatDateTime(notif.timestamp)}
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground line-clamp-2">
                          {notif.message}
                        </p>
                      </div>
                      {unread && (
                        <div className="flex items-center justify-center pt-0.5">
                          <div className="h-1.5 w-1.5 rounded-full bg-blue-500" />
                        </div>
                      )}
                    </div>

                    {/* Alert Acknowledgment Section for warning / critical notifications */}
                    {isAlert && (
                      <div className="mt-1 pt-1.5 border-t border-border/40 flex items-center justify-between text-xs">
                        {isAcknowledged ? (
                          <span className="text-[11px] text-muted-foreground font-medium flex items-center gap-1">
                            <Check className="h-3 w-3 text-emerald-500 flex-shrink-0" />
                            Acknowledged by {notif.acknowledgedBy || 'Operator'} at{' '}
                            {formatDateTime(notif.acknowledgedAt || notif.timestamp)}
                          </span>
                        ) : canAcknowledge ? (
                          <div className="flex items-center justify-between w-full">
                            <span className="text-[11px] font-semibold text-amber-600 dark:text-amber-400">
                              Unacknowledged
                            </span>
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-6 px-2.5 text-xs font-semibold border-amber-500/40 text-amber-600 hover:bg-amber-500/10 dark:text-amber-400"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleAcknowledge(notif);
                              }}
                            >
                              Acknowledge
                            </Button>
                          </div>
                        ) : (
                          <span className="text-[11px] font-semibold text-amber-600 dark:text-amber-400">
                            Unacknowledged
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </ScrollArea>

        {/* Footer: View all link */}
        <div className="p-2 border-t bg-muted/20 text-center">
          <a
            href="/notifications"
            onClick={() => setOpen(false)}
            className="text-xs font-semibold text-primary hover:underline flex items-center justify-center gap-1 py-1"
          >
            <span>View All Notifications & History</span>
            <ExternalLink className="h-3 w-3" />
          </a>
        </div>
      </PopoverContent>
    </Popover>
  );
};

export default NotificationCenter;
