/**
 * @file reportCalculations.ts
 * @description Pure calculations behind the Reports page (charts, printable table, summary cards
 * and the CSV export). Kept out of Reports.tsx so the page only wires data to the layout, and so
 * each step can be unit-tested on its own.
 */
import type { Log } from '@/store/useStore';
import type { HistoryRawSample, GroupedTelemetryPoint } from '@/hooks/useTankHistory';
import { isLevelSampleFaulty, isPhSampleFaulty } from '@/hooks/useTankHistory';
import { formatDate, formatDateTime } from '@/lib/dateFormat';
import { estimateVolumeLiters } from '@/lib/constants';
import {
  ALERT_CATEGORIES,
  countAlertStarts,
  countProblemsByPeriod,
  emptyProblemCounts,
  isPumpRun,
  PROBLEM_COLUMNS,
  type ProblemCounts,
  type TelemetryTableRow,
} from '@/lib/reportLogs';
import type { TankThresholds } from '@/lib/alertEngine';

export const DATE_RANGES = ['Last 7 Days', 'Last 14 Days', 'Last 30 Days'] as const;
export type DateRange = typeof DATE_RANGES[number];

const HOUR_MS = 3_600_000;

export function rangeDays(range: DateRange): number {
  return range === 'Last 7 Days' ? 7 : range === 'Last 14 Days' ? 14 : 30;
}

/** The 7-day view groups by hour, the longer ones by day. */
export const isHourlyRange = (days: number) => days === 7;

/** Start (ms) of the hour or local day that contains `ts`. */
export function periodStart(ts: number, hourly: boolean): number {
  if (hourly) return Math.floor(ts / HOUR_MS) * HOUR_MS;
  const d = new Date(ts);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

const average = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length;

/**
 * Groups the 10-minute history samples into hourly (7 days) or daily (14/30 days) averages.
 * Level is rounded to whole %, pH to 0.1, height to 0.01 m (computed from the level when no
 * sample has a height). A group is marked faulty if any of its samples was taken during a fault.
 */
export function groupTelemetry(samples: HistoryRawSample[], days: number, tankHeight: number): GroupedTelemetryPoint[] {
  if (samples.length === 0) return [];
  const hourly = isHourlyRange(days);
  const groups = new Map<number, HistoryRawSample[]>();
  for (const sample of samples) {
    const key = periodStart(sample.timestamp, hourly);
    const group = groups.get(key);
    if (group) group.push(sample);
    else groups.set(key, [sample]);
  }

  return Array.from(groups.entries())
    .sort(([a], [b]) => a - b)
    .map(([timestamp, group]) => {
      const levels = group.map(s => s.waterLevel).filter((v): v is number => v !== null);
      const phs = group.map(s => s.phLevel).filter((v): v is number => v !== null);
      const heights = group.map(s => s.waterHeight).filter((v): v is number => v !== null);

      const avgLevel = levels.length > 0 ? Math.round(average(levels)) : null;
      const avgPh = phs.length > 0 ? Math.round(average(phs) * 10) / 10 : null;
      let avgHeight = 0;
      if (heights.length > 0) avgHeight = Number(average(heights).toFixed(2));
      else if (avgLevel !== null) avgHeight = Number(((avgLevel / 100) * tankHeight).toFixed(2));

      return {
        date: hourly ? formatDateTime(new Date(timestamp)) : formatDate(new Date(timestamp)),
        timestamp,
        waterLevel: avgLevel,
        phLevel: avgPh,
        height: avgHeight,
        sampleCount: group.length,
        levelFault: group.some(isLevelSampleFaulty),
        phFault: group.some(isPhSampleFaulty),
      };
    });
}

/** A Printable Telemetry Log Table row: telemetry averages plus the problems logged in that period. */
export type TableRow = TelemetryTableRow & { hasSamples: boolean; problems: ProblemCounts };

/**
 * Printable table rows: the grouped telemetry plus how many problems started in each row's period.
 * A period with problems but no samples (such as a day the controller was offline) still gets a row.
 */
export function buildTableRows(telemetry: GroupedTelemetryPoint[], logs: Log[], days: number): TableRow[] {
  const hourly = isHourlyRange(days);
  const problems = countProblemsByPeriod(logs, ts => periodStart(ts, hourly));
  const rows: TableRow[] = telemetry.map(p => ({
    ...p,
    hasSamples: true,
    problems: problems.get(p.timestamp) ?? emptyProblemCounts(),
  }));
  const withSamples = new Set(telemetry.map(p => p.timestamp));
  for (const [ts, counts] of problems) {
    if (withSamples.has(ts)) continue;
    rows.push({
      date: hourly ? formatDateTime(ts) : formatDate(ts),
      timestamp: ts,
      waterLevel: null,
      phLevel: null,
      height: 0,
      sampleCount: 0,
      levelFault: false,
      phFault: false,
      hasSamples: false,
      problems: counts,
    });
  }
  return rows.sort((a, b) => a.timestamp - b.timestamp);
}

export interface PumpActivityPoint { date: string; activations: number }

/** Pump runs per calendar day, from `days` days ago up to today (both included). */
export function pumpActivationsByDay(logs: Log[], days: number, now: Date = new Date()): PumpActivityPoint[] {
  const runs = logs.filter(isPumpRun);
  const result: PumpActivityPoint[] = [];
  for (let i = days; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const date = formatDate(d);
    result.push({ date, activations: runs.filter(l => formatDate(l.timestamp) === date).length });
  }
  return result;
}

export interface AlertSlice { name: string; value: number }

/** One count per alert incident (its "Triggered" entry), only categories that occurred. */
export function alertDistribution(logs: Log[]): AlertSlice[] {
  const counts = countAlertStarts(logs);
  return ALERT_CATEGORIES.map(name => ({ name, value: counts[name] })).filter(item => item.value > 0);
}

export interface SummaryMetrics {
  avgLevel: number;
  minLevel: number;
  maxLevel: number;
  avgPh: number;
  minPh: number;
  maxPh: number;
  totalPumpRuns: number;
  alertsRegistered: number;
}

/** Summary cards: averages and extremes of the grouped telemetry, pump runs and alert incidents. */
export function summarizeReport(
  telemetry: GroupedTelemetryPoint[],
  pumpActivity: PumpActivityPoint[],
  alerts: AlertSlice[],
): SummaryMetrics | null {
  if (telemetry.length === 0) return null;
  const levels = telemetry.map(d => d.waterLevel).filter((v): v is number => v !== null);
  const phs = telemetry.map(d => d.phLevel).filter((v): v is number => v !== null);
  if (levels.length === 0 && phs.length === 0) return null;
  return {
    avgLevel: levels.length > 0 ? Math.round(average(levels)) : 0,
    minLevel: levels.length > 0 ? Math.min(...levels) : 0,
    maxLevel: levels.length > 0 ? Math.max(...levels) : 0,
    avgPh: phs.length > 0 ? Number(average(phs).toFixed(1)) : 7.0,
    minPh: phs.length > 0 ? Math.min(...phs) : 7.0,
    maxPh: phs.length > 0 ? Math.max(...phs) : 7.0,
    totalPumpRuns: pumpActivity.reduce((acc, p) => acc + p.activations, 0),
    alertsRegistered: alerts.reduce((acc, a) => acc + a.value, 0),
  };
}

/** The newest warning/error entries for the tank's alert history card. */
export function recentAlertLogs(logs: Log[], limit = 8): Log[] {
  return logs.filter(l =>
    l.logLevel === 'WARNING' || l.logLevel === 'ERROR' || l.logLevel === 'CRITICAL' ||
    l.action.includes('Alert') || l.action.includes('Fault')
  ).slice(0, limit);
}

export interface Badge { label: string; color: string }

/** Wi-Fi signal label for the connection card (-999 = no reading). */
export function signalStrength(rssi: number | undefined, offline: boolean): Badge & { pct: number } {
  if (offline) return { label: 'Offline', color: 'text-amber-500', pct: 0 };
  const value = rssi ?? -999;
  if (value === -999) return { label: 'Offline', color: 'text-muted-foreground', pct: 0 };
  if (value >= -60) return { label: 'Excellent', color: 'text-safe', pct: 100 };
  if (value >= -75) return { label: 'Good', color: 'text-safe/80', pct: 75 };
  if (value >= -85) return { label: 'Fair', color: 'text-warning', pct: 45 };
  return { label: 'Poor', color: 'text-danger', pct: 20 };
}

/** pH category badge against the tank's safe range. */
export function phCategory(ph: number, limits: Pick<TankThresholds, 'minPh' | 'maxPh'>): Badge {
  if (ph < limits.minPh) return { label: 'Acidic', color: 'text-danger bg-danger/10 border-danger/20' };
  if (ph > limits.maxPh) return { label: 'Alkaline', color: 'text-warning bg-warning/10 border-warning/20' };
  return { label: 'Neutral', color: 'text-safe bg-safe/10 border-safe/20' };
}

/** CSV text: one line per table row (rows without samples say "No data"), then optional extra blocks. */
export function buildReportCsv(rows: TableRow[], capacityLiters: number, extraLines: string[] = []): string {
  const header = `Date,Water Level (%),Water Height (m),pH Value,Estimated Volume (L),Sample Count,${PROBLEM_COLUMNS.map(c => c.header).join(',')}\n`;
  const body = rows.map(d => {
    const noData = !d.hasSamples;
    const lvl = noData ? 'No data' : d.waterLevel !== null ? String(d.waterLevel) : 'N/A';
    const height = noData ? 'No data' : String(d.height);
    const ph = noData ? 'No data' : d.phLevel !== null ? String(d.phLevel) : 'N/A';
    const volume = !noData && d.waterLevel !== null ? estimateVolumeLiters(d.waterLevel, capacityLiters) : 'N/A';
    const problems = PROBLEM_COLUMNS.map(c => d.problems[c.key]).join(',');
    return `${d.date},${lvl},${height},${ph},${volume},${d.sampleCount},${problems}`;
  }).join('\n');
  return header + body + (extraLines.length > 0 ? `\n\n${extraLines.join('\n')}` : '');
}
