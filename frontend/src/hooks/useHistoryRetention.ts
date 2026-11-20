import { useEffect } from 'react';
import { ref, query, orderByChild, endAt, get, update } from 'firebase/database';
import { toast } from 'sonner';
import { database } from '@/config/firebase';
import type { Log } from '@/store/useStore';
import { RETENTION_DAYS } from '@/lib/constants';

interface RetentionUser {
  role?: string;
  username?: string;
}

/**
 * Monthly cleanup of one tank's history: when an admin opens Reports, samples older than
 * RETENTION_DAYS (90) are deleted, at most once per calendar month per tank and browser.
 * The alert worker does the same every day; this is the fallback while it is not running.
 */
export function useHistoryRetention(
  currentUser: RetentionUser | null | undefined,
  tankId: string,
  addLog: (log: Omit<Log, 'id' | 'timestamp'>) => unknown,
): void {
  useEffect(() => {
    if (currentUser?.role !== 'admin' || !tankId) return;

    const currentMonthKey = new Date().toISOString().slice(0, 7); // e.g. "2026-10"
    const storageKey = `wm_monthly_history_cleanup_${tankId}`;
    if (localStorage.getItem(storageKey) === currentMonthKey) return; // already done this month

    const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
    const oldSamples = query(ref(database, `history/tanks/${tankId}`), orderByChild('timestamp'), endAt(cutoff));

    get(oldSamples).then((snapshot) => {
      if (snapshot.exists()) {
        const updates: Record<string, null> = {};
        let count = 0;
        snapshot.forEach((child) => {
          updates[child.key!] = null;
          count++;
        });
        if (count > 0) {
          update(ref(database, `history/tanks/${tankId}`), updates).then(() => {
            addLog({
              action: 'Historical Data Retention',
              details: `Monthly automated cleanup: deleted ${count} historical samples older than ${RETENTION_DAYS} days from tank ${tankId}.`,
              performedBy: currentUser.username || 'Admin',
              logLevel: 'INFO',
            });
            toast.info(`Monthly cleanup: removed ${count} historical samples older than ${RETENTION_DAYS} days.`);
          }).catch((err) => {
            console.error('Error removing old history samples:', err);
          });
        }
      }
      localStorage.setItem(storageKey, currentMonthKey);
    }).catch((err) => {
      console.warn('Error querying historical samples for cleanup:', err);
    });
  }, [currentUser, tankId, addLog]);
}
