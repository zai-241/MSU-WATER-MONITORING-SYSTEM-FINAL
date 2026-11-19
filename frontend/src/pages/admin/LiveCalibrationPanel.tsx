import { useEffect, useState } from 'react';
import { Activity, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Tank, updateTank, useServerTimeOffset } from '@/store/useStore';
import {
  CALIBRATION_LIVE_STEP_MS,
  CALIBRATION_LIVE_MAX_MS,
  CALIBRATION_LIVE_STALE_MS,
} from '@/lib/constants';
import { errorMessage } from '@/lib/utils';

export type LiveCalibrationField = 'levelVmin' | 'levelVmax' | 'phNeutralVoltage';

interface Props {
  tank: Tank;
  canEdit: boolean;
  /** Copies a live voltage into the calibration form (the admin still saves it) */
  onUseValue: (field: LiveCalibrationField, value: number) => void;
}

const fmtCountdown = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/**
 * Live sensor readings for calibration: a remote stand-in for the Arduino Serial
 * Monitor. Writing tanks/{id}/calibrationUntil asks the controller to send
 * tanks/{id}/calibrationLive once per second until that time (10 min per step,
 * 30 min at most). It ends on its own, so a forgotten session costs nothing.
 */
const LiveCalibrationPanel = ({ tank, canEdit, onUseValue }: Props) => {
  const serverOffset = useServerTimeOffset();
  const [now, setNow] = useState(() => Date.now() + serverOffset);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setNow(Date.now() + serverOffset);
    const id = setInterval(() => setNow(Date.now() + serverOffset), 1000);
    return () => clearInterval(id);
  }, [serverOffset]);

  const until = typeof tank.calibrationUntil === 'number' ? tank.calibrationUntil : 0;
  const active = until > now;
  const live = tank.calibrationLive;
  const sessionStart = until - CALIBRATION_LIVE_MAX_MS; // earliest start of the current window
  const fresh =
    active && !!live && typeof live.at === 'number' &&
    now - live.at <= CALIBRATION_LIVE_STALE_MS && live.at >= sessionStart;

  const setUntil = async (value: number | null, message: string) => {
    setBusy(true);
    try {
      await updateTank(tank.id, { calibrationUntil: value });
      toast.success(message);
    } catch (err) {
      toast.error(errorMessage(err) || 'Failed to change live readings');
    } finally {
      setBusy(false);
    }
  };

  const start = () =>
    setUntil(now + CALIBRATION_LIVE_STEP_MS, 'Live readings started for 10 minutes');
  const extend = () =>
    setUntil(
      Math.min(Math.max(until, now) + CALIBRATION_LIVE_STEP_MS, now + CALIBRATION_LIVE_MAX_MS),
      'Live readings extended',
    );
  const stop = () => setUntil(null, 'Live readings stopped');

  const tankHeight = tank.tankHeight;
  const heightWarning =
    fresh && live
      ? live.heightM > tankHeight + 0.02
        ? `Height is above the tank height (${tankHeight} m): Vmax is probably set too low. Put the sensor on the floor of the full tank and use this voltage as Vmax.`
        : live.heightM < -0.02
          ? 'Height is below 0 m: Vmin is probably set too high. Lift the sensor out of the water and use this voltage as Vmin.'
          : null
      : null;

  const fillButton = (label: string, field: LiveCalibrationField, value: number | undefined) => (
    <button
      type="button"
      disabled={!canEdit || !fresh || typeof value !== 'number'}
      onClick={() => typeof value === 'number' && onUseValue(field, Number(value.toFixed(3)))}
      className="rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-semibold hover:bg-secondary disabled:opacity-50 disabled:cursor-not-allowed"
    >
      {label}
    </button>
  );

  return (
    <div className="rounded-lg border border-border bg-secondary/30 p-4" aria-live="polite">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Activity size={16} className={active ? 'text-primary' : 'text-muted-foreground'} />
          <h4 className="font-semibold text-sm">Live sensor readings</h4>
          <span
            className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
              active ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'
            }`}
          >
            {active ? `On · stops in ${fmtCountdown(until - now)}` : 'Off'}
          </span>
        </div>
        <div className="flex flex-wrap gap-2">
          {!active ? (
            <button
              type="button"
              onClick={start}
              disabled={!canEdit || busy}
              className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50"
            >
              {busy ? <Loader2 size={14} className="animate-spin" /> : 'Start (10 min)'}
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={extend}
                disabled={!canEdit || busy || until - now > CALIBRATION_LIVE_MAX_MS - CALIBRATION_LIVE_STEP_MS}
                className="rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-semibold hover:bg-secondary disabled:opacity-50"
              >
                +10 min
              </button>
              <button
                type="button"
                onClick={stop}
                disabled={!canEdit || busy}
                className="rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-semibold hover:bg-secondary disabled:opacity-50"
              >
                Stop
              </button>
            </>
          )}
        </div>
      </div>

      <p className="text-[11px] text-muted-foreground mt-2">
        Shows what the controller measures right now, like the Arduino Serial Monitor, sent once per second.
        It stops by itself after the time runs out (30 min at most). Needs the controller firmware with live
        calibration support.
      </p>

      {active && !fresh && (
        <p className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 size={14} className="animate-spin" /> Waiting for {tank.name} to send readings…
        </p>
      )}

      {fresh && live && (
        <div className="mt-3 space-y-3">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Reading label="Level voltage (V=)" value={`${live.voltage.toFixed(3)} V`} />
            <Reading label="Height (height=)" value={`${live.heightM.toFixed(3)} m`} />
            <Reading label="Level" value={`${live.percent} %`} />
            <Reading
              label="pH voltage"
              value={typeof live.phVoltage === 'number' ? `${live.phVoltage.toFixed(3)} V` : '—'}
            />
          </div>
          {heightWarning && (
            <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">
              {heightWarning}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            {fillButton('Use as Vmin (sensor out of water)', 'levelVmin', live.voltage)}
            {fillButton('Use as Vmax (sensor on floor, full tank)', 'levelVmax', live.voltage)}
            {fillButton('Use as pH neutral (pH 7 buffer)', 'phNeutralVoltage', live.phVoltage)}
          </div>
          <p className="text-[11px] text-muted-foreground">
            Wait about 10 s after moving the sensor so the filter settles. "Use as" only fills the form below;
            press Save to apply it.
          </p>
        </div>
      )}
    </div>
  );
};

const Reading = ({ label, value }: { label: string; value: string }) => (
  <div className="rounded-md border border-border bg-background px-3 py-2">
    <p className="text-[11px] text-muted-foreground">{label}</p>
    <p className="font-mono text-base font-semibold">{value}</p>
  </div>
);

export default LiveCalibrationPanel;
