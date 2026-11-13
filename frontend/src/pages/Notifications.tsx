import { useState, useMemo, useEffect } from 'react';
import {
  useNotificationHistory,
  useUserNotificationsState,
  acknowledgeNotification,
  purgeOldNotifications,
  Notification,
} from '@/store/useStore';
import { RETENTION_DAYS } from '@/lib/constants';
import { useAuth } from '@/hooks/useAuth';
import {
  Bell,
  Search,
  AlertTriangle,
  AlertOctagon,
  Info,
  CheckCircle2,
  Trash2,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock,
  Sparkles,
  ShieldAlert
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';

/**
 * Format a Unix timestamp to localized human-readable date + time.
 */
const getFormattedDateTime = (timestamp?: number): string => {
  if (!timestamp) return 'Unknown Time';
  try {
    const d = new Date(timestamp);
    if (isNaN(d.getTime())) return 'Invalid Date';
    return d.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    }) + ' ' + d.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true,
    });
  } catch {
    return 'Unknown Time';
  }
};

/**
 * Highlight search query matches in text safely.
 */
const highlightText = (text: unknown, search: string) => {
  if (text === null || text === undefined) return '';
  const str = String(text);
  if (!search || !search.trim()) return <span>{str}</span>;

  try {
    const escapedSearch = search.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
    const regex = new RegExp(`(${escapedSearch})`, 'gi');
    const parts = str.split(regex);

    return (
      <span>
        {parts.map((part, index) =>
          index % 2 === 1 ? (
            <mark key={index} className="bg-primary/20 text-foreground font-semibold rounded px-0.5">
              {part}
            </mark>
          ) : (
            part
          )
        )}
      </span>
    );
  } catch {
    return <span>{str}</span>;
  }
};

const ITEMS_PER_PAGE = 15;

const Notifications = () => {
  // Full history (not the capped live feed): "Load older" widens the window on demand
  const { notifications, loading, hasMore, loadMore } = useNotificationHistory();
  const { currentUser } = useAuth();
  const { isUnread, markAllAsRead, markOneRead } = useUserNotificationsState(currentUser?.id);

  const isAdmin = currentUser?.role === 'admin';
  const isWorker = currentUser?.role === 'worker';
  const canAcknowledge = isAdmin || isWorker;

  const [search, setSearch] = useState('');
  const [severityFilter, setSeverityFilter] = useState<'all' | 'danger' | 'warning' | 'info'>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'unread' | 'unacknowledged' | 'acknowledged' | 'resolved'>('all');
  const [currentPage, setCurrentPage] = useState(1);
  const [showPurgeConfirm, setShowPurgeConfirm] = useState(false);
  const [isPurging, setIsPurging] = useState(false);

  // Compute unread count per user
  const unreadCount = useMemo(() => {
    return notifications.filter(isUnread).length;
  }, [notifications, isUnread]);

  const unacknowledgedCount = useMemo(() => {
    return notifications.filter(
      n => (n.type === 'danger' || n.type === 'warning') && !n.acknowledged && !n.resolved
    ).length;
  }, [notifications]);

  // Filtered notifications
  const filteredNotifications = useMemo(() => {
    return notifications.filter(notif => {
      // 1. Severity filter
      if (severityFilter !== 'all' && notif.type !== severityFilter) {
        return false;
      }

      // 2. Status filter
      if (statusFilter === 'unread') {
        if (!isUnread(notif)) return false;
      } else if (statusFilter === 'unacknowledged') {
        if (notif.acknowledged || notif.resolved || (notif.type !== 'danger' && notif.type !== 'warning')) {
          return false;
        }
      } else if (statusFilter === 'acknowledged') {
        if (!notif.acknowledged || notif.resolved) {
          return false;
        }
      } else if (statusFilter === 'resolved') {
        if (!notif.resolved) {
          return false;
        }
      }

      // 3. Search query
      if (search.trim()) {
        const query = search.toLowerCase();
        const dateStr = getFormattedDateTime(notif.timestamp).toLowerCase();
        const titleMatch = (notif.title || '').toLowerCase().includes(query);
        const msgMatch = (notif.message || '').toLowerCase().includes(query);
        const ackMatch = (notif.acknowledgedBy || '').toLowerCase().includes(query);
        const tankMatch = (notif.tankId || '').toLowerCase().includes(query);
        if (!titleMatch && !msgMatch && !ackMatch && !tankMatch && !dateStr.includes(query)) {
          return false;
        }
      }

      return true;
    });
  }, [notifications, severityFilter, statusFilter, search, isUnread]);

  // Pagination calculation
  const totalPages = Math.max(1, Math.ceil(filteredNotifications.length / ITEMS_PER_PAGE));
  const paginatedNotifications = useMemo(() => {
    const start = (currentPage - 1) * ITEMS_PER_PAGE;
    return filteredNotifications.slice(start, start + ITEMS_PER_PAGE);
  }, [filteredNotifications, currentPage]);

  const handlePageChange = (page: number) => {
    setCurrentPage(Math.min(Math.max(1, page), totalPages));
  };

  // Keep the page number valid when filters, purges or new data shrink the list
  useEffect(() => {
    if (currentPage > totalPages) setCurrentPage(totalPages);
  }, [currentPage, totalPages]);

  const handleMarkAllRead = async () => {
    try {
      await markAllAsRead();
      toast.success('All notifications marked as read for your account');
    } catch {
      toast.error('Failed to mark notifications as read');
    }
  };

  const handleAcknowledge = (notif: Notification) => {
    const operatorName = currentUser?.username || 'Operator';
    Promise.resolve(acknowledgeNotification(notif.id, operatorName, notif.title))
      .then(() => toast.success(`Alert "${notif.title}" acknowledged`))
      .catch(() => toast.error('Could not acknowledge the alert. Check your connection and try again.'));
  };

  const handlePurge90Days = async () => {
    setIsPurging(true);
    try {
      const purged = await purgeOldNotifications(RETENTION_DAYS);
      toast.success(
        purged > 0
          ? `Retention cleanup complete: ${purged} notification(s) older than 90 days removed.`
          : 'Retention check complete: No notifications older than 90 days found.'
      );
      setShowPurgeConfirm(false);
    } catch (err: any) {
      toast.error(err.message || 'Failed to purge old notifications');
    } finally {
      setIsPurging(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2.5">
              <Bell className="h-6 w-6 text-primary" />
              Notification History & Auditing
            </h1>
            {unacknowledgedCount > 0 && (
              <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-red-500/10 text-red-600 border border-red-500/20 animate-pulse">
                {unacknowledgedCount} Unacknowledged
              </span>
            )}
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            System-wide event feed, telemetry alerts, acknowledgment tracking, and 90-day compliance retention.
          </p>
        </div>

        <div className="flex items-center gap-2.5 flex-wrap">
          {unreadCount > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleMarkAllRead}
              className="text-xs h-9 gap-1.5"
            >
              <Sparkles className="h-3.5 w-3.5 text-primary" />
              Mark All as Read ({unreadCount})
            </Button>
          )}

          {isAdmin && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowPurgeConfirm(true)}
              className="text-xs h-9 gap-1.5 text-muted-foreground hover:text-destructive hover:border-destructive/40"
              title="Purge notifications older than 90 days"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Purge &gt; 90 Days
            </Button>
          )}
        </div>
      </div>

      {/* Filters Bar */}
      <div className="rounded-xl bg-card border border-border/40 p-4 shadow-sm space-y-3">
        <div className="flex flex-col md:flex-row gap-3">
          {/* Search bar */}
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search notifications by title, message, operator, or date..."
              value={search}
              onChange={e => {
                setSearch(e.target.value);
                setCurrentPage(1);
              }}
              className="w-full pl-9 pr-4 py-2 text-sm rounded-lg border border-input bg-background focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
          </div>

          {/* Severity Filter Tabs */}
          <div className="flex items-center gap-1 bg-secondary/50 p-1 rounded-lg border border-border/40">
            <button
              onClick={() => { setSeverityFilter('all'); setCurrentPage(1); }}
              className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${
                severityFilter === 'all'
                  ? 'bg-card text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              All Types
            </button>
            <button
              onClick={() => { setSeverityFilter('danger'); setCurrentPage(1); }}
              className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors flex items-center gap-1 ${
                severityFilter === 'danger'
                  ? 'bg-card text-red-600 shadow-sm'
                  : 'text-muted-foreground hover:text-red-600'
              }`}
            >
              <AlertOctagon className="h-3 w-3" /> Critical
            </button>
            <button
              onClick={() => { setSeverityFilter('warning'); setCurrentPage(1); }}
              className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors flex items-center gap-1 ${
                severityFilter === 'warning'
                  ? 'bg-card text-yellow-600 shadow-sm'
                  : 'text-muted-foreground hover:text-yellow-600'
              }`}
            >
              <AlertTriangle className="h-3 w-3" /> Warnings
            </button>
            <button
              onClick={() => { setSeverityFilter('info'); setCurrentPage(1); }}
              className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors flex items-center gap-1 ${
                severityFilter === 'info'
                  ? 'bg-card text-blue-600 shadow-sm'
                  : 'text-muted-foreground hover:text-blue-600'
              }`}
            >
              <Info className="h-3 w-3" /> Info
            </button>
          </div>

          {/* Status Filter Tabs */}
          <div className="flex items-center gap-1 bg-secondary/50 p-1 rounded-lg border border-border/40">
            <button
              onClick={() => { setStatusFilter('all'); setCurrentPage(1); }}
              className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${
                statusFilter === 'all'
                  ? 'bg-card text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              All Status
            </button>
            <button
              onClick={() => { setStatusFilter('unread'); setCurrentPage(1); }}
              className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${
                statusFilter === 'unread'
                  ? 'bg-card text-primary shadow-sm'
                  : 'text-muted-foreground hover:text-primary'
              }`}
            >
              Unread
            </button>
            <button
              onClick={() => { setStatusFilter('unacknowledged'); setCurrentPage(1); }}
              className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${
                statusFilter === 'unacknowledged'
                  ? 'bg-card text-red-600 shadow-sm'
                  : 'text-muted-foreground hover:text-red-600'
              }`}
            >
              Unack
            </button>
            <button
              onClick={() => { setStatusFilter('acknowledged'); setCurrentPage(1); }}
              className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${
                statusFilter === 'acknowledged'
                  ? 'bg-card text-emerald-600 shadow-sm'
                  : 'text-muted-foreground hover:text-emerald-600'
              }`}
            >
              Acked
            </button>
            <button
              onClick={() => { setStatusFilter('resolved'); setCurrentPage(1); }}
              className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${
                statusFilter === 'resolved'
                  ? 'bg-card text-muted-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Resolved
            </button>
          </div>
        </div>
      </div>

      {/* Notifications List */}
      <div className="rounded-xl bg-card border border-border/40 shadow-sm overflow-hidden">
        {loading && notifications.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center text-muted-foreground text-sm">
            Loading notification history...
          </div>
        ) : filteredNotifications.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center text-muted-foreground">
            <Bell className="h-12 w-12 stroke-[1.2] mb-3 opacity-30" />
            <h3 className="font-semibold text-base text-foreground">No notifications found</h3>
            <p className="text-xs text-muted-foreground mt-1 max-w-sm">
              {search || severityFilter !== 'all' || statusFilter !== 'all'
                ? 'Try adjusting your search criteria or filters to view other notification records.'
                : 'All alerts and system events are currently clear.'}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-border/40">
              {paginatedNotifications.map((notif) => {
                const isAlert = notif.type === 'danger' || notif.type === 'warning';
                const isAcknowledged = !!notif.acknowledged;
                const isResolved = !!notif.resolved;
                const unread = isUnread(notif);

                return (
                  <div
                    key={notif.id}
                    onClick={() => { if (unread) markOneRead(notif.id); }}
                    className={`p-4 transition-colors hover:bg-muted/40 ${
                      unread ? 'bg-primary/[0.03] cursor-pointer' : ''
                    }`}
                  >
                    <div className="flex items-start justify-between gap-4">
                      {/* Left icon & text */}
                      <div className="flex items-start gap-3 flex-1 min-w-0">
                        <div
                          className={`mt-0.5 h-8 w-8 rounded-lg flex items-center justify-center flex-shrink-0 ${
                            notif.type === 'danger'
                              ? 'bg-red-500/10 text-red-600 border border-red-500/20'
                              : notif.type === 'warning'
                              ? 'bg-yellow-500/10 text-yellow-600 border border-yellow-500/20'
                              : 'bg-blue-500/10 text-blue-600 border border-blue-500/20'
                          }`}
                        >
                          {notif.type === 'danger' ? (
                            <ShieldAlert className="h-4 w-4" />
                          ) : notif.type === 'warning' ? (
                            <AlertTriangle className="h-4 w-4" />
                          ) : (
                            <Info className="h-4 w-4" />
                          )}
                        </div>

                        <div className="flex-1 min-w-0 space-y-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-semibold text-sm text-foreground">
                              {highlightText(notif.title, search)}
                            </span>
                            {notif.tankId && (
                              <span className="px-1.5 py-0.2 rounded text-[10px] font-medium bg-secondary text-muted-foreground border border-border/40">
                                Tank {notif.tankId}
                              </span>
                            )}
                            {unread && (
                              <span className="px-1.5 py-0.2 rounded text-[10px] font-bold bg-primary/10 text-primary border border-primary/20">
                                New
                              </span>
                            )}
                            {isResolved && (
                              <span className="px-1.5 py-0.2 rounded text-[10px] font-semibold bg-muted text-muted-foreground">
                                Resolved
                              </span>
                            )}
                          </div>

                          <p className="text-xs text-muted-foreground leading-relaxed">
                            {highlightText(notif.message, search)}
                          </p>

                          <div className="flex items-center gap-3 text-[11px] text-muted-foreground pt-1 flex-wrap">
                            <span className="flex items-center gap-1 font-mono">
                              <Clock className="h-3 w-3" />
                              {getFormattedDateTime(notif.timestamp)}
                            </span>

                            {isAlert && isAcknowledged && (
                              <span className="flex items-center gap-1 text-emerald-600 font-medium">
                                <CheckCircle2 className="h-3 w-3" />
                                Acknowledged by {notif.acknowledgedBy || 'Operator'}
                                {notif.acknowledgedAt && ` (${getFormattedDateTime(notif.acknowledgedAt)})`}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Right actions */}
                      <div className="flex items-center gap-2 flex-shrink-0 self-center">
                        {isAlert && !isAcknowledged && !isResolved && canAcknowledge && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={(e) => { e.stopPropagation(); handleAcknowledge(notif); }}
                            className="h-7 px-2.5 text-xs font-semibold border-amber-500/40 text-amber-600 hover:bg-amber-500/10 dark:text-amber-400 gap-1"
                          >
                            <Check className="h-3.5 w-3.5" />
                            Acknowledge
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
          </div>
        )}

        {/* Pagination Footer */}
        {filteredNotifications.length > 0 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-border/40 text-xs text-muted-foreground bg-muted/20">
            <span>
              Showing {Math.min((currentPage - 1) * ITEMS_PER_PAGE + 1, filteredNotifications.length)} -{' '}
              {Math.min(currentPage * ITEMS_PER_PAGE, filteredNotifications.length)} of{' '}
              {filteredNotifications.length} notifications
            </span>

            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                size="sm"
                onClick={() => handlePageChange(currentPage - 1)}
                disabled={currentPage === 1}
                className="h-7 w-7 p-0"
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="px-2 font-medium">
                Page {currentPage} of {totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => handlePageChange(currentPage + 1)}
                disabled={currentPage >= totalPages}
                className="h-7 w-7 p-0"
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}

        {/* Older history is fetched on demand so the page opens fast */}
        {hasMore && (
          <div className="flex items-center justify-center px-4 py-3 border-t border-border/40 bg-muted/10">
            <Button variant="outline" size="sm" onClick={loadMore} disabled={loading} className="text-xs h-8">
              {loading ? 'Loading...' : `Load older notifications (${notifications.length} loaded)`}
            </Button>
          </div>
        )}
      </div>

      {/* 90-Day Purge Retention Confirmation Dialog */}
      {showPurgeConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/40 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-card rounded-xl p-6 shadow-xl max-w-sm w-full mx-4 border border-border/40 space-y-4 animate-in zoom-in-95 duration-200">
            <div className="flex items-center gap-3 text-danger mb-2">
              <Trash2 className="h-6 w-6 text-primary animate-pulse" />
              <h4 className="text-lg font-bold text-foreground">Confirm Retention Purge</h4>
            </div>
            <p className="text-sm text-muted-foreground">
              Are you sure you want to purge all notification records older than <strong>90 days</strong>?
            </p>
            <p className="text-xs text-muted-foreground bg-secondary/50 p-3 rounded-lg border border-border/40">
              ℹ️ Notifications within the last 90 days will be preserved. This adheres to system data compliance and keeps Realtime Database queries performant.
            </p>
            <div className="flex gap-3 pt-2">
              <Button
                variant="outline"
                onClick={() => setShowPurgeConfirm(false)}
                disabled={isPurging}
                className="flex-1"
              >
                Cancel
              </Button>
              <Button
                onClick={handlePurge90Days}
                disabled={isPurging}
                className="flex-1 bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                {isPurging ? 'Purging...' : 'Confirm Purge'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Notifications;

