import { useEffect, useState } from 'react';
import { Tank, CalibrationLive, useServerTimeOffset } from '@/store/useStore';
import { CALIBRATION_LIVE_MAX_MS, CALIBRATION_LIVE_STALE_MS } from '@/lib/constants';

export interface LiveCalibrationState {
  /** Server time now (ms), ticking once per second */
  now: number;
  /** tanks/{id}/calibrationUntil, 0 if not set */
  until: number;
  /** The live window is open */
  active: boolean;
  /** The latest reading, when it is from this window and not older than CALIBRATION_LIVE_STALE_MS */
  reading: CalibrationLive | null;
}

/**
 * The tank's live calibration window and its latest fresh reading, shared by the
 * live readings panel and the level calibration table ("Use live reading").
 */
export function useLiveCalibration(tank: Tank | undefined): LiveCalibrationState {
  const serverOffset = useServerTimeOffset();
  const [now, setNow] = useState(() => Date.now() + serverOffset);

  useEffect(() => {
    setNow(Date.now() + serverOffset);
    const id = setInterval(() => setNow(Date.now() + serverOffset), 1000);
    return () => clearInterval(id);
  }, [serverOffset]);

  const until = typeof tank?.calibrationUntil === 'number' ? tank.calibrationUntil : 0;
  const active = until > now;
  const live = tank?.calibrationLive;
  const sessionStart = until - CALIBRATION_LIVE_MAX_MS; // earliest start of the current window
  const fresh =
    active && !!live && typeof live.at === 'number' &&
    now - live.at <= CALIBRATION_LIVE_STALE_MS && live.at >= sessionStart;

  return { now, until, active, reading: fresh && live ? live : null };
}
