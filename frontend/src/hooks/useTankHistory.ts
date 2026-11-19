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
  /** false when the sample was taken during a sensor fault (the value is still the live reading) */
  levelSensorOk: boolean;
  phSensorOk: boolean;
}

export interface GroupedTelemetryPoint {
  date: string;
  timestamp: number;
  waterLevel: number | null;
  phLevel: number | null;
  height: number;
  sampleCount: number;
  /** At least one sample in the group came from a faulty sensor (or has no value) */
  levelFault: boolean;
  phFault: boolean;
}

/**
 * Older firmware wrote null for a faulty sensor; newer firmware keeps the reading and
 * adds levelSensorOk / phSensorOk = false. Either one marks the sample as faulty.
 */
export function isLevelSampleFaulty(s: Pick<HistoryRawSample, 'waterLevel' | 'levelSensorOk'>): boolean {
  return s.waterLevel === null || !s.levelSensorOk;
}

export function isPhSampleFaulty(s: Pick<HistoryRawSample, 'phLevel' | 'phSensorOk'>): boolean {
  return s.phLevel === null || !s.phSensorOk;
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
    let unsubscribe: () => void;
    try {
      const historyRef = ref(database, `history/tanks/${selectedTankId}`);
      const historyQuery = query(
        historyRef,
        orderByChild('timestamp'),
        startAt(cutoff),
        limitToLast(5000)
      );

      unsubscribe = onValue(
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
              levelSensorOk: val?.levelSensorOk !== false,
              phSensorOk: val?.phSensorOk !== false,
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
    } catch (err) {
      // Database not ready (or not available, as in tests): show no history instead of crashing the page
      console.error('Error attaching history listener:', err);
      setHistorySamples([]);
      setIsLoadingHistory(false);
      return;
    }

    return () => unsubscribe();
  }, [selectedTankId, days]);

  return { historySamples, isLoadingHistory };
}
