import { useState, useMemo } from 'react';
import { useLogs } from '@/store/useStore';
import { useAuth } from '@/hooks/useAuth';
import {
  FileText,
  Search,
  AlertTriangle,
  XCircle,
  Info,
  Trash2,
  CheckCircle2,
  X,
  ChevronLeft,
  ChevronRight,
  ShieldAlert
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';

/**
 * Safely format a Unix timestamp to localized human-readable string.
 * Prevents errors if telemetry sends an invalid date.
 */
const getFormattedDate = (timestamp: number): string => {
  try {
    const d = new Date(timestamp);
    if (isNaN(d.getTime())) return 'Invalid Date';
    return d.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true
    });
  } catch {
    return 'Unknown Time';
  }
};

/**
 * Safely split text and highlight matching search strings.
 * Safe-guarded against null, undefined, or non-string values.
 */
const highlightText = (text: unknown, search: string) => {
  if (text === null || text === undefined) return '';
  const str = String(text);
  if (!search || !search.trim()) return <span>{str}</span>;

  try {
    const escapedSearch = search.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
    const regex = new RegExp(`(${escapedSearch})`, 'gi');
    const parts = str.split(regex);

    return (
      <span>
        {parts.map((part, index) =>
          regex.test(part) ? (
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

const ITEMS_PER_PAGE = 20;

const Logs = () => {
  const { logs, clearAll, purgeOldLogs } = useLogs();
  const { currentUser } = useAuth();
  const isAdmin = currentUser?.role === 'admin';

  const [search, setSearch] = useState('');
  const [activeTab, setActiveTab] = useState<'all' | 'alerts' | 'system' | 'errors'>('all');
  const [currentPage, setCurrentPage] = useState(1);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [showPurgeConfirm, setShowPurgeConfirm] = useState(false);
  const [isPurging, setIsPurging] = useState(false);

  // 1. Memoized search matched logs to prevent recalculating on every render
  const searchMatchedLogs = useMemo(() => {
    if (!search.trim()) return logs;

    const query = search.toLowerCase();
    return logs.filter(log => {
      const formattedDate = getFormattedDate(log.timestamp).toLowerCase();
      const severity = (log.logLevel || 'INFO').toLowerCase();
      const action = (log.action || '').toLowerCase();
      const details = (log.details || '').toLowerCase();
      const performedBy = (log.performedBy || '').toLowerCase();

      return (
        action.includes(query) ||
        details.includes(query) ||
        performedBy.includes(query) ||
        severity.includes(query) ||
        formattedDate.includes(query)
      );
    });
  }, [logs, search]);

  // 2. Memoized category counts for badges
  const categoryCounts = useMemo(() => {
    let alerts = 0;
    let system = 0;
    let errors = 0;

    searchMatchedLogs.forEach(log => {
      const severity = log.logLevel || 'INFO';
      const actionStr = log.action || '';

      if (severity === 'CRITICAL' || severity === 'WARNING' || actionStr.toLowerCase().includes('alert')) {
        alerts++;
      }
      if (severity === 'INFO') {
        system++;
      }
      if (severity === 'ERROR' || severity === 'CRITICAL') {
        errors++;
      }
    });

    return {
      total: searchMatchedLogs.length,
      alerts,
      system,
      errors
    };
  }, [searchMatchedLogs]);

  // 3. Memoized tab filtered logs
  const filteredLogs = useMemo(() => {
    if (activeTab === 'all') return searchMatchedLogs;

    return searchMatchedLogs.filter(log => {
      const severity = log.logLevel || 'INFO';
      const actionStr = log.action || '';

      if (activeTab === 'alerts') {
        return severity === 'CRITICAL' || severity === 'WARNING' || actionStr.toLowerCase().includes('alert');
      }
      if (activeTab === 'system') {
        return severity === 'INFO';
      }
      if (activeTab === 'errors') {
        return severity === 'ERROR' || severity === 'CRITICAL';
      }
      return true;
    });
  }, [searchMatchedLogs, activeTab]);

  // 4. Pagination calculation
  const totalPages = Math.max(1, Math.ceil(filteredLogs.length / ITEMS_PER_PAGE));
  const paginatedLogs = useMemo(() => {
    const start = (currentPage - 1) * ITEMS_PER_PAGE;
    return filteredLogs.slice(start, start + ITEMS_PER_PAGE);
  }, [filteredLogs, currentPage]);

  const handlePageChange = (newPage: number) => {
    setCurrentPage(Math.min(Math.max(1, newPage), totalPages));
  };

  // Map severities to visual themes (color badges, borders, icons)
  const getLogLevelMeta = (level?: string) => {
    const severity = level || 'INFO';
    switch (severity) {
      case 'CRITICAL':
        return {
          label: 'CRITICAL',
          icon: <XCircle className="h-4 w-4 text-rose-500" />,
          badgeClass: 'bg-rose-500/10 text-rose-600 border-rose-500/20 dark:text-rose-400',
          rowClass: 'border-l-4 border-l-rose-500 bg-rose-500/[0.01] hover:bg-rose-500/[0.03]'
        };
      case 'ERROR':
        return {
          label: 'ERROR',
          icon: <AlertTriangle className="h-4 w-4 text-orange-500" />,
          badgeClass: 'bg-orange-500/10 text-orange-600 border-orange-500/20 dark:text-orange-400',
          rowClass: 'border-l-4 border-l-orange-500 bg-orange-500/[0.01] hover:bg-orange-500/[0.03]'
        };
      case 'WARNING':
        return {
          label: 'WARNING',
          icon: <AlertTriangle className="h-4 w-4 text-amber-500" />,
          badgeClass: 'bg-amber-500/10 text-amber-600 border-amber-500/20 dark:text-amber-400',
          rowClass: 'border-l-4 border-l-amber-500 bg-amber-500/[0.01] hover:bg-amber-500/[0.03]'
        };
      case 'INFO':
      default:
        return {
          label: 'INFO',
          icon: <Info className="h-4 w-4 text-sky-500" />,
          badgeClass: 'bg-sky-500/10 text-sky-600 border-sky-500/20 dark:text-sky-400',
          rowClass: 'border-l-4 border-l-sky-500 bg-sky-500/[0.005] hover:bg-sky-500/[0.02]'
        };
    }
  };

  const handleClearLogs = async () => {
    try {
      await clearAll();
      toast.success('All historical logs have been purged');
    } catch {
      toast.error('Failed to clear logs');
    } finally {
      setShowClearConfirm(false);
    }
  };

  const handlePurgeOldLogs = async () => {
    if (!purgeOldLogs) return;
    setIsPurging(true);
    try {
      const purged = await purgeOldLogs(90);
      toast.success(
        purged > 0
          ? `Retention cleanup complete: ${purged} log(s) older than 90 days removed.`
          : 'Retention check complete: No logs older than 90 days found.'
      );
      setShowPurgeConfirm(false);
    } catch {
      toast.error('Failed to purge old logs');
    } finally {
      setIsPurging(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header Area */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold text-primary flex items-center gap-2.5">
            <FileText className="h-6 w-6 text-primary" /> System Logs
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Real-time historical timeline of system telemetry, alerts, and operational events.
          </p>
        </div>

        <div className="flex items-center gap-2.5 self-start md:self-auto flex-wrap">
          {/* Search Field */}
          <div className="relative flex items-center">
            <Search className="absolute left-3 h-4 w-4 text-muted-foreground" />
            <input
              placeholder="Search logs by levels, actions, dates..."
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setCurrentPage(1);
              }}
              className="pl-9 pr-8 py-2 rounded-xl border border-input text-sm bg-background w-full sm:w-64 focus:outline-none focus:ring-2 focus:ring-primary/20 shadow-xs"
            />
            {search && (
              <button
                onClick={() => {
                  setSearch('');
                  setCurrentPage(1);
                }}
                className="absolute right-2.5 p-1 hover:bg-muted rounded-full transition-colors text-muted-foreground hover:text-foreground"
                title="Clear search"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          {/* Admin Retention & Clear Utilities */}
          {isAdmin && (
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowPurgeConfirm(true)}
                className="h-9 px-3 text-xs gap-1.5 text-muted-foreground hover:text-foreground"
                title="Purge logs older than 90 days"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Purge &gt; 90 Days
              </Button>

              {logs.length > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowClearConfirm(true)}
                  className="h-9 px-3 text-xs gap-1.5 border-danger/30 text-danger bg-danger/5 hover:bg-danger hover:text-white"
                  title="Purge all logs"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Clear All
                </Button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="flex border-b border-border gap-1 bg-muted/20 p-1.5 rounded-xl max-w-lg overflow-x-auto scrollbar-none whitespace-nowrap">
        <button
          onClick={() => {
            setActiveTab('all');
            setCurrentPage(1);
          }}
          className={`py-1.5 px-3 text-xs font-bold rounded-lg transition-all shrink-0 ${
            activeTab === 'all'
              ? 'bg-card text-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          All Logs ({categoryCounts.total})
        </button>
        <button
          onClick={() => {
            setActiveTab('alerts');
            setCurrentPage(1);
          }}
          className={`py-1.5 px-3 text-xs font-bold rounded-lg transition-all flex items-center justify-center gap-1.5 shrink-0 ${
            activeTab === 'alerts'
              ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400 shadow-sm border border-amber-500/15'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          Alerts {categoryCounts.alerts > 0 && <span className="bg-amber-500/25 px-1.5 py-0.2 rounded text-[10px]">{categoryCounts.alerts}</span>}
        </button>
        <button
          onClick={() => {
            setActiveTab('system');
            setCurrentPage(1);
          }}
          className={`py-1.5 px-3 text-xs font-bold rounded-lg transition-all flex items-center justify-center gap-1.5 shrink-0 ${
            activeTab === 'system'
              ? 'bg-sky-500/10 text-sky-600 dark:text-sky-400 shadow-sm border border-sky-500/15'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          System {categoryCounts.system > 0 && <span className="bg-sky-500/25 px-1.5 py-0.2 rounded text-[10px]">{categoryCounts.system}</span>}
        </button>
        <button
          onClick={() => {
            setActiveTab('errors');
            setCurrentPage(1);
          }}
          className={`py-1.5 px-3 text-xs font-bold rounded-lg transition-all flex items-center justify-center gap-1.5 shrink-0 ${
            activeTab === 'errors'
              ? 'bg-rose-500/10 text-rose-600 dark:text-rose-400 shadow-sm border border-rose-500/15'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          Errors {categoryCounts.errors > 0 && <span className="bg-rose-500/25 px-1.5 py-0.2 rounded text-[10px]">{categoryCounts.errors}</span>}
        </button>
      </div>

      {/* Logs Table Area */}
      <div className="rounded-xl bg-card shadow-sm border overflow-hidden">
        <div className="p-4 border-b bg-muted/40 hidden md:grid grid-cols-12 gap-4 font-bold text-xs text-muted-foreground uppercase tracking-wider">
          <div className="col-span-3">Timestamp</div>
          <div className="col-span-2">Severity</div>
          <div className="col-span-3">Action Group</div>
          <div className="col-span-4">Event Details</div>
        </div>

        {filteredLogs.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 px-4 text-center text-muted-foreground space-y-4">
            {search ? (
              <>
                <div className="p-3 bg-muted rounded-full text-muted-foreground/60">
                  <Search className="h-8 w-8" />
                </div>
                <div className="space-y-1">
                  <p className="text-base font-bold text-foreground">No logs match your search</p>
                  <p className="text-sm text-muted-foreground max-w-xs mx-auto">
                    We couldn't find any results for "{search}". Try checking your spelling or clearing the query.
                  </p>
                </div>
                <Button
                  onClick={() => {
                    setSearch('');
                    setCurrentPage(1);
                  }}
                  size="sm"
                  className="rounded-xl text-xs font-bold"
                >
                  Clear Search Filter
                </Button>
              </>
            ) : (
              <>
                <CheckCircle2 className="h-10 w-10 text-muted-foreground/40" />
                <div className="space-y-1">
                  <p className="text-base font-bold text-foreground">No operational logs found</p>
                  <p className="text-sm text-muted-foreground">All systems are operational and quiet in this category.</p>
                </div>
              </>
            )}
          </div>
        ) : (
          <div className="divide-y divide-border/50">
            {paginatedLogs.map((log) => {
              const meta = getLogLevelMeta(log.logLevel);
              return (
                <div
                  key={log.id}
                  className={`p-4 flex flex-col md:grid md:grid-cols-12 gap-3 md:gap-4 text-sm md:items-center transition-colors ${meta.rowClass}`}
                >
                  {/* Timestamp */}
                  <div className="col-span-3 text-xs text-muted-foreground font-mono order-3 md:order-none flex justify-between md:block items-center border-t md:border-none pt-2 md:pt-0">
                    <span className="md:hidden font-bold uppercase tracking-wider text-[10px] text-muted-foreground/50">Logged At</span>
                    {highlightText(getFormattedDate(log.timestamp), search)}
                  </div>

                  {/* Level Badge */}
                  <div className="col-span-2 flex items-center gap-1.5 order-1 md:order-none justify-between md:justify-start">
                    <span className="md:hidden font-bold uppercase tracking-wider text-[10px] text-muted-foreground/50">Severity</span>
                    <span className={`px-2 py-0.5 rounded-md text-[10px] font-extrabold tracking-wider border uppercase flex items-center gap-1.5 ${meta.badgeClass}`}>
                      {meta.icon}
                      {highlightText(meta.label, search)}
                    </span>
                  </div>

                  {/* Action Group */}
                  <div className="col-span-3 font-semibold text-foreground flex items-center gap-1.5 order-1 md:order-none justify-between md:justify-start">
                    <span className="md:hidden font-bold uppercase tracking-wider text-[10px] text-muted-foreground/50">Action</span>
                    <span>{highlightText(log.action, search)}</span>
                  </div>

                  {/* Details */}
                  <div className="col-span-4 text-muted-foreground text-xs leading-relaxed order-2 md:order-none">
                    <div className="md:hidden font-bold uppercase tracking-wider text-[10px] text-muted-foreground/50 mb-1">Details & Operator</div>
                    {highlightText(log.details, search)}
                    <span className="block mt-0.5 text-[10px] font-medium text-muted-foreground/60">
                      Operator: {highlightText(log.performedBy, search)}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Pagination Footer */}
        {filteredLogs.length > 0 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-border/40 text-xs text-muted-foreground bg-muted/20">
            <span>
              Showing {Math.min((currentPage - 1) * ITEMS_PER_PAGE + 1, filteredLogs.length)} -{' '}
              {Math.min(currentPage * ITEMS_PER_PAGE, filteredLogs.length)} of {filteredLogs.length} logs
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
      </div>

      {/* Clear All Logs Modal */}
      {showClearConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/60 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="bg-card rounded-xl p-6 shadow-xl max-w-sm w-full mx-4 border border-border space-y-4 animate-in zoom-in-95 duration-150">
            <div className="flex items-center gap-3 text-danger">
              <AlertTriangle className="h-6 w-6" />
              <h4 className="text-lg font-bold text-foreground">Purge All Logs?</h4>
            </div>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Are you sure you want to clear <strong>all historical database logs</strong>? This action is permanent and cannot be undone.
            </p>
            <div className="flex gap-3 pt-2">
              <Button
                variant="outline"
                onClick={() => setShowClearConfirm(false)}
                className="flex-1 rounded-xl"
              >
                Cancel
              </Button>
              <Button
                onClick={handleClearLogs}
                className="flex-1 rounded-xl bg-danger text-danger-foreground hover:bg-danger/90"
              >
                Clear All
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* 90-Day Retention Purge Modal */}
      {showPurgeConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/60 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="bg-card rounded-xl p-6 shadow-xl max-w-sm w-full mx-4 border border-border space-y-4 animate-in zoom-in-95 duration-150">
            <div className="flex items-center gap-3 text-primary">
              <Trash2 className="h-6 w-6" />
              <h4 className="text-lg font-bold text-foreground">Confirm Retention Purge</h4>
            </div>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Are you sure you want to purge all log records older than <strong>90 days</strong>?
            </p>
            <p className="text-xs text-muted-foreground bg-secondary/50 p-3 rounded-lg border border-border/40">
              ℹ️ Logs within the last 90 days will be preserved. This adheres to system data compliance and keeps Realtime Database queries performant.
            </p>
            <div className="flex gap-3 pt-2">
              <Button
                variant="outline"
                onClick={() => setShowPurgeConfirm(false)}
                disabled={isPurging}
                className="flex-1 rounded-xl"
              >
                Cancel
              </Button>
              <Button
                onClick={handlePurgeOldLogs}
                disabled={isPurging}
                className="flex-1 rounded-xl bg-destructive text-destructive-foreground hover:bg-destructive/90"
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

export default Logs;
