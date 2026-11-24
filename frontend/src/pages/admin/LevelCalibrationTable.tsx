import { Plus, Trash2, Table2 } from 'lucide-react';
import { Tank } from '@/store/useStore';
import {
  LEVEL_CAL_MAX_POINTS,
  depthStepRows,
  heightFromVoltage,
  levelCalPointsFromRows,
  levelPercentFromVoltage,
  validateLevelCalPoints,
  type LevelCalRow,
} from '@/lib/levelCalibration';
import { useLiveCalibration } from './useLiveCalibration';

interface Props {
  /** The saved tank (for the live readings) */
  tank: Tank | undefined;
  /** Tank height (m) as the form shows it, unsaved edits included */
  tankHeight: number;
  /** Reading offset (%) as the form shows it */
  levelOffset: number;
  rows: LevelCalRow[];
  onChange: (rows: LevelCalRow[]) => void;
  canEdit: boolean;
}

/**
 * Multi-point level calibration table (tanks/{id}/levelCalPoints). Edits stay in
 * the form until the page's Save. Empty table = the controller uses Vmin/Vmax.
 */
const LevelCalibrationTable = ({ tank, tankHeight, levelOffset, rows, onChange, canEdit }: Props) => {
  const { reading } = useLiveCalibration(tank);
  const points = levelCalPointsFromRows(rows);
  const errors = rows.length > 0 ? validateLevelCalPoints(points, tankHeight) : [];
  const valid = rows.length > 0 && errors.length === 0;

  const setRow = (index: number, patch: Partial<LevelCalRow>) =>
    onChange(rows.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  const removeRow = (index: number) => onChange(rows.filter((_, i) => i !== index));
  const addRow = () => {
    const lastCm = Number(rows[rows.length - 1]?.depthCm);
    const next = rows.length === 0 ? '0' : Number.isFinite(lastCm) ? String(lastCm + 10) : '';
    onChange([...rows, { depthCm: next, volts: '' }]);
  };

  const cellClass = 'w-full rounded-md border border-input px-2 py-1.5 text-sm bg-background disabled:opacity-60';
  const smallButton =
    'inline-flex items-center gap-1 rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-semibold hover:bg-secondary disabled:opacity-50 disabled:cursor-not-allowed';

  return (
    <div className="mt-6 rounded-lg border border-border p-4" data-testid="level-calibration-table">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Table2 size={16} className="text-primary" />
          <h5 className="font-semibold text-sm">Level calibration table (multi-point)</h5>
          <span
            className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
              valid ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'
            }`}
          >
            {rows.length === 0 ? 'Not set: Vmin/Vmax line' : valid ? `${rows.length} points` : 'Not valid yet'}
          </span>
        </div>
        <div className="flex flex-wrap gap-2">
          {rows.length === 0 && (
            <button
              type="button"
              className={smallButton}
              disabled={!canEdit || !(tankHeight > 0)}
              onClick={() => onChange(depthStepRows(tankHeight))}
            >
              Start with 10 cm steps
            </button>
          )}
          <button
            type="button"
            className={smallButton}
            disabled={!canEdit || rows.length >= LEVEL_CAL_MAX_POINTS}
            onClick={addRow}
          >
            <Plus size={14} /> Add row
          </button>
          {rows.length > 0 && (
            <button type="button" className={smallButton} disabled={!canEdit} onClick={() => onChange([])}>
              Clear table (use Vmin/Vmax)
            </button>
          )}
        </div>
      </div>

      <p className="text-[11px] text-muted-foreground mt-2">
        The level follows the sensor&apos;s real curve: between two points it is a straight line, below the first
        point it reads 0 % and above the last 100 %. Without a table (or with an invalid one) the controller uses
        Vmin and Vmax above. 2 to {LEVEL_CAL_MAX_POINTS} points; depths from 0 cm to the tank height, depths and
        voltages both increasing.
      </p>

      <details className="mt-2 text-xs">
        <summary className="cursor-pointer font-semibold text-primary">How to measure the points</summary>
        <ol className="mt-2 list-decimal space-y-1 pl-5 text-muted-foreground">
          <li>Keep the tank full; do not drain it. Start the live sensor readings above.</li>
          <li>
            Hold the sensor just above the water surface: that is depth 0 cm. Wait about 10 s, then press
            &quot;Use live reading&quot; on the 0 cm row.
          </li>
          <li>
            Lower the sensor step by step (for example every 10 cm). Depth = distance from the water surface to the
            sensor tip, measured with a steel tape. Keep the sensor vertical and the vent tube open and dry. Wait
            about 10 s at each step, then press &quot;Use live reading&quot; on that row.
          </li>
          <li>
            The last point is the sensor on the floor of the full tank; its depth must equal the tank height (set the
            tank height to the full water depth if they differ).
          </li>
          <li>Return the sensor to its normal position on the floor, check the table, then press Save.</li>
        </ol>
      </details>

      {rows.length > 0 && (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground">
                <th className="py-1 pr-2 font-semibold">#</th>
                <th className="py-1 pr-2 font-semibold">Depth (cm)</th>
                <th className="py-1 pr-2 font-semibold">Voltage (V)</th>
                <th className="py-1 pr-2 font-semibold"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={i}>
                  <td className="py-1 pr-2 text-xs text-muted-foreground">{i + 1}</td>
                  <td className="py-1 pr-2">
                    <input
                      type="number"
                      step="0.1"
                      min={0}
                      aria-label={`Depth (cm), row ${i + 1}`}
                      value={row.depthCm}
                      disabled={!canEdit}
                      onChange={e => setRow(i, { depthCm: e.target.value })}
                      className={cellClass}
                    />
                  </td>
                  <td className="py-1 pr-2">
                    <input
                      type="number"
                      step="0.001"
                      aria-label={`Voltage (V), row ${i + 1}`}
                      value={row.volts}
                      disabled={!canEdit}
                      onChange={e => setRow(i, { volts: e.target.value })}
                      className={cellClass}
                    />
                  </td>
                  <td className="py-1 pr-2">
                    <div className="flex gap-1">
                      <button
                        type="button"
                        className={smallButton}
                        disabled={!canEdit || !reading}
                        title={reading ? undefined : 'Start the live sensor readings first'}
                        aria-label={`Use live reading, row ${i + 1}`}
                        onClick={() => reading && setRow(i, { volts: reading.voltage.toFixed(3) })}
                      >
                        Use live reading
                      </button>
                      <button
                        type="button"
                        className={smallButton}
                        disabled={!canEdit}
                        aria-label={`Remove row ${i + 1}`}
                        onClick={() => removeRow(i)}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {errors.length > 0 && (
        <ul
          role="alert"
          className="mt-3 list-disc space-y-0.5 rounded-md border border-amber-300 bg-amber-50 py-2 pl-7 pr-3 text-xs text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200"
        >
          {errors.map(e => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      )}

      {valid && reading && (
        <p className="mt-3 text-xs text-muted-foreground" data-testid="level-calibration-preview">
          Live reading {reading.voltage.toFixed(3)} V with this table:{' '}
          <strong>
            {(Math.min(Math.max(heightFromVoltage(reading.voltage, points), 0), tankHeight) * 100).toFixed(1)} cm,{' '}
            {levelPercentFromVoltage(reading.voltage, { levelVmin: 0, levelVmax: 0, tankHeight, levelOffset, levelCalPoints: points })} %
          </strong>{' '}
          (the controller now shows {reading.percent} %).
        </p>
      )}
    </div>
  );
};

export default LevelCalibrationTable;
