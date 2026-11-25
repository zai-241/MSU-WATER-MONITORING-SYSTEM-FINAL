/**
 * Multi-point (piecewise-linear) water level calibration.
 *
 * A tank may have a table of (depth, voltage) points in tanks/{id}/levelCalPoints,
 * measured by lowering the sensor step by step into the full tank. The level then
 * follows the sensor's real curve instead of a straight line from Vmin to Vmax.
 * Without a valid table the old two-point formula (Vmin, Vmax, tank height) is used.
 *
 * The ESP32 sketches (processLevelSensor / levelHeightFromVoltage) do the same
 * math and the same validation. Change both together; see docs/Methodology.md 3.1.
 */

/** One calibration point: water depth above the sensor tip (m) and the filtered sensor voltage (V) */
export interface LevelCalPoint {
  depthM: number;
  volts: number;
}

export const LEVEL_CAL_MIN_POINTS = 2;
export const LEVEL_CAL_MAX_POINTS = 20;
/** Readings outside this range are sensor faults in the firmware (LEVEL_MIN_VALID_VOLTAGE 0.20 V since 25 Nov 2026, 3.25 V) */
export const LEVEL_CAL_MIN_VOLTS = 0.2;
export const LEVEL_CAL_MAX_VOLTS = 3.25;
/** How close the last depth must be to the tank height (m) */
export const LEVEL_CAL_HEIGHT_TOLERANCE_M = 0.005;

const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/**
 * Reads tanks/{id}/levelCalPoints as the database returns it (an array, or an
 * object with keys "0", "1", ...). Returns null when there is no list or an
 * entry is not a {depthM, volts} pair of numbers.
 */
export function parseLevelCalPoints(raw: unknown): LevelCalPoint[] | null {
  if (raw === null || raw === undefined) return null;
  let entries: unknown[];
  if (Array.isArray(raw)) {
    entries = raw;
  } else if (typeof raw === 'object') {
    entries = Object.keys(raw as Record<string, unknown>)
      .filter(k => /^\d+$/.test(k))
      .sort((a, b) => Number(a) - Number(b))
      .map(k => (raw as Record<string, unknown>)[k]);
  } else {
    return null;
  }
  const points: LevelCalPoint[] = [];
  for (const e of entries) {
    if (e === null || e === undefined) continue; // a hole in a sparse array
    if (typeof e !== 'object') return null;
    const { depthM, volts } = e as Record<string, unknown>;
    if (!isFiniteNumber(depthM) || !isFiniteNumber(volts)) return null;
    points.push({ depthM, volts });
  }
  return points.length > 0 ? points : null;
}

/**
 * Checks a point list against the rules the firmware also applies. Returns the
 * problems found (empty = valid).
 */
export function validateLevelCalPoints(points: LevelCalPoint[], tankHeight: number): string[] {
  const errors: string[] = [];
  if (points.length < LEVEL_CAL_MIN_POINTS) {
    errors.push(`Enter at least ${LEVEL_CAL_MIN_POINTS} points (empty and full).`);
  }
  if (points.length > LEVEL_CAL_MAX_POINTS) {
    errors.push(`Use at most ${LEVEL_CAL_MAX_POINTS} points.`);
  }
  points.forEach((p, i) => {
    const row = `Row ${i + 1}`;
    if (!isFiniteNumber(p.depthM)) errors.push(`${row}: depth is not a number.`);
    if (!isFiniteNumber(p.volts)) {
      errors.push(`${row}: voltage is not a number.`);
    } else if (p.volts < LEVEL_CAL_MIN_VOLTS || p.volts > LEVEL_CAL_MAX_VOLTS) {
      errors.push(`${row}: voltage must be between ${LEVEL_CAL_MIN_VOLTS.toFixed(2)} and ${LEVEL_CAL_MAX_VOLTS.toFixed(2)} V.`);
    }
    if (i > 0) {
      const prev = points[i - 1];
      if (isFiniteNumber(p.depthM) && isFiniteNumber(prev.depthM) && p.depthM <= prev.depthM) {
        errors.push(`${row}: depth must be greater than row ${i}.`);
      }
      if (isFiniteNumber(p.volts) && isFiniteNumber(prev.volts) && p.volts <= prev.volts) {
        errors.push(`${row}: voltage must be greater than row ${i}.`);
      }
    }
  });
  if (points.length > 0) {
    const first = points[0];
    const last = points[points.length - 1];
    if (isFiniteNumber(first.depthM) && Math.abs(first.depthM) > 1e-9) {
      errors.push('The first depth must be 0 (sensor just above the water surface).');
    }
    if (!isFiniteNumber(tankHeight) || tankHeight <= 0) {
      errors.push('Set the tank height first.');
    } else if (points.length >= 2 && isFiniteNumber(last.depthM) &&
               Math.abs(last.depthM - tankHeight) > LEVEL_CAL_HEIGHT_TOLERANCE_M) {
      errors.push(
        `The last depth (${(last.depthM * 100).toFixed(1)} cm) must equal the tank height (${(tankHeight * 100).toFixed(1)} cm). ` +
        'Set the tank height to the full water depth, or measure the last point with the sensor on the floor of the full tank.',
      );
    }
  }
  return errors;
}

export interface LevelCalibrationParams {
  levelVmin: number;
  levelVmax: number;
  tankHeight: number;
  levelOffset?: number;
  levelCalPoints?: LevelCalPoint[] | null;
}

/**
 * The points the level is computed from: the tank's table when it is valid,
 * else the two-point line (0 m, Vmin) to (tank height, Vmax).
 */
export function effectiveLevelCalPoints(cal: LevelCalibrationParams): { points: LevelCalPoint[]; usesTable: boolean } {
  const table = cal.levelCalPoints;
  if (table && table.length > 0 && validateLevelCalPoints(table, cal.tankHeight).length === 0) {
    return { points: table, usesTable: true };
  }
  return {
    points: [
      { depthM: 0, volts: cal.levelVmin },
      { depthM: cal.tankHeight, volts: cal.levelVmax },
    ],
    usesTable: false,
  };
}

/**
 * Water height (m) for a voltage, not clamped: between two points it is the
 * straight line through them; below the first or above the last point the
 * first or last segment is extended (the firmware's fault check uses that).
 * With the two points (0, Vmin) and (H, Vmax) this is exactly the old formula
 * (V - Vmin) * H / (Vmax - Vmin). Returns 0 when the segment has no slope.
 */
export function heightFromVoltage(volts: number, points: LevelCalPoint[]): number {
  const n = points.length;
  if (n < 2) return 0;
  let i = 0; // segment index: points[i] .. points[i + 1]
  if (volts <= points[0].volts) {
    i = 0;
  } else if (volts >= points[n - 1].volts) {
    i = n - 2;
  } else {
    while (i < n - 2 && volts > points[i + 1].volts) i++;
  }
  const a = points[i];
  const b = points[i + 1];
  const dv = b.volts - a.volts;
  if (Math.abs(dv) <= 0.001) return 0;
  return a.depthM + (volts - a.volts) * ((b.depthM - a.depthM) / dv);
}

/**
 * Level % the controller reports for a voltage: height clamped to 0..tank height,
 * as a whole % of the tank height (truncated, as in the firmware), plus the
 * offset, clamped to 0..100.
 */
export function levelPercentFromVoltage(volts: number, cal: LevelCalibrationParams): number {
  const { points } = effectiveLevelCalPoints(cal);
  const height = heightFromVoltage(volts, points);
  const tankHeight = cal.tankHeight;
  if (!(tankHeight > 0)) return 0;
  const clamped = Math.min(Math.max(height, 0), tankHeight);
  let percent = Math.trunc((clamped / tankHeight) * 100);
  percent += Math.trunc(cal.levelOffset ?? 0);
  return Math.min(100, Math.max(0, percent));
}

// ---------------------------------------------------------------------------
// Admin Panel table editor: rows hold the typed text (depth in cm, voltage in V)
// ---------------------------------------------------------------------------

export interface LevelCalRow {
  depthCm: string;
  volts: string;
}

const numberOrNaN = (s: string) => (s.trim() === '' ? Number.NaN : Number(s));

export function rowsFromLevelCalPoints(points: LevelCalPoint[] | null | undefined): LevelCalRow[] {
  return (points ?? []).map(p => ({
    depthCm: String(Number((p.depthM * 100).toFixed(1))),
    volts: String(Number(p.volts.toFixed(3))),
  }));
}

/** Rows to points: depth cm -> m (to 0.1 mm), voltage to 1 mV. Blank or non-numeric cells become NaN. */
export function levelCalPointsFromRows(rows: LevelCalRow[]): LevelCalPoint[] {
  return rows.map(r => {
    const cm = numberOrNaN(r.depthCm);
    const v = numberOrNaN(r.volts);
    return {
      depthM: Number.isFinite(cm) ? Number((cm / 100).toFixed(4)) : Number.NaN,
      volts: Number.isFinite(v) ? Number(v.toFixed(3)) : Number.NaN,
    };
  });
}

/**
 * Empty rows for a new table: depths from 0 to the tank height in 10 cm steps
 * (wider steps for a tall tank, so there are at most LEVEL_CAL_MAX_POINTS rows).
 */
export function depthStepRows(tankHeight: number): LevelCalRow[] {
  if (!(tankHeight > 0)) return [];
  const heightCm = Number((tankHeight * 100).toFixed(1));
  let step = 10;
  while (Math.ceil(heightCm / step) + 1 > LEVEL_CAL_MAX_POINTS) step += 5;
  const rows: LevelCalRow[] = [];
  for (let d = 0; d < heightCm - 1e-6; d += step) rows.push({ depthCm: String(d), volts: '' });
  rows.push({ depthCm: String(heightCm), volts: '' });
  return rows;
}
