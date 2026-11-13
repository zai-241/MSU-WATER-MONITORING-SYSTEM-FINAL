/**
 * @file useRangeLogs.ts
 * @description Live system logs for a report window (the last 7, 14 or 30 days).
 * The shared log stream only holds the newest 100 entries, which is not enough for
 * per-day pump counts or alert totals over 30 days, so the Reports page reads the
 * whole window here. Newest first.
 */
import { useEffect, useState } from 'react';
import { ref, onValue, query, orderByChild, startAt } from 'firebase/database';
import { database } from '@/config/firebase';
import type { Log } from '@/store/useStore';
import { reportWindowStart } from '@/lib/reportLogs';

export function useRangeLogs(days: number): { logs: Log[]; isLoading: boolean } {
  const [logs, setLogs] = useState<Log[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    setIsLoading(true);
    const logsQuery = query(ref(database, 'logs'), orderByChild('timestamp'), startAt(reportWindowStart(days)));

    return onValue(
      logsQuery,
      (snapshot) => {
        const data = snapshot?.val?.();
        if (data && typeof data === 'object') {
          const list = Object.entries(data as Record<string, Partial<Log> | null>)
            .filter(([, value]) => value && typeof value === 'object')
            .map(([key, value]) => ({
              id: key,
              action: String(value?.action ?? ''),
              details: String(value?.details ?? ''),
              performedBy: String(value?.performedBy ?? ''),
              logLevel: value?.logLevel,
              timestamp: typeof value?.timestamp === 'number' ? value.timestamp : 0,
            })) as Log[];
          list.sort((a, b) => b.timestamp - a.timestamp);
          setLogs(list);
        } else {
          setLogs([]);
        }
        setIsLoading(false);
      },
      (error) => {
        console.error('Error reading report logs:', error);
        setLogs([]);
        setIsLoading(false);
      }
    );
  }, [days]);

  return { logs, isLoading };
}
