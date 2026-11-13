/**
 * @file useTankHistory.ts
 * @description Historical telemetry for one tank from /history/tanks/{tankId}.
 * Extracted from Reports.tsx (Q1). The ESP32 posts one sample every 10 minutes.
 */
import { useState, useEffect } from 'react';
import { ref, onValue, query, orderByChild, startAt, limitToLast } from 'firebase/database';
import { database } from '@/config/firebase';

export interface HistoryRawSample {
  id: string;
  waterLevel: number | null;
  phLevel: number | null;
  waterHeight: number | null;
  pumpOn?: boolean;
  timestamp: number;
}

export interface GroupedTelemetryPoint {
  date: string;
  timestamp: number;
  waterLevel: number | null;
  phLevel: number | null;
  height: number;
  sampleCount: number;
}

export function useTankHistory(selectedTankId: string, days: number) {
  const [historySamples, setHistorySamples] = useState<HistoryRawSample[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(true);

  useEffect(() => {
    if (!selectedTankId) {
      setHistorySamples([]);
      setIsLoadingHistory(false);
      return;
    }

    setIsLoadingHistory(true);
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    const historyRef = ref(database, `history/tanks/${selectedTankId}`);
    const historyQuery = query(
      historyRef,
      orderByChild('timestamp'),
      startAt(cutoff),
      limitToLast(5000)
    );

    const unsubscribe = onValue(
      historyQuery,
      (snapshot) => {
        if (snapshot.exists()) {
          const data = snapshot.val();
          const list: HistoryRawSample[] = Object.entries(data as Record<string, Partial<Record<keyof HistoryRawSample, unknown>> | null>).map(([key, val]) => ({
            id: key,
            waterLevel: typeof val?.waterLevel === 'number' ? val.waterLevel : null,
            phLevel: typeof val?.phLevel === 'number' ? val.phLevel : null,
            waterHeight: typeof val?.waterHeight === 'number' ? val.waterHeight : null,
            pumpOn: typeof val?.pumpOn === 'boolean' ? val.pumpOn : false,
            timestamp: typeof val?.timestamp === 'number' ? val.timestamp : 0,
          })).filter((item) => item.timestamp >= cutoff);

          list.sort((a, b) => a.timestamp - b.timestamp);
          setHistorySamples(list);
        } else {
          setHistorySamples([]);
        }
        setIsLoadingHistory(false);
      },
      (error) => {
        console.error('Error fetching historical telemetry:', error);
        setHistorySamples([]);
        setIsLoadingHistory(false);
      }
    );

    return () => unsubscribe();
  }, [selectedTankId, days]);

  return { historySamples, isLoadingHistory };
}
