import { describe, it, expect } from 'vitest';
import type { Log } from '@/store/useStore';
import type { HistoryRawSample } from '@/hooks/useTankHistory';
import {
  rangeDays,
  periodStart,
  groupTelemetry,
  buildTableRows,
  pumpActivationsByDay,
  summarizeReport,
  recentAlertLogs,
  signalStrength,
  phCategory,
  buildReportCsv,
} from '@/lib/reportCalculations';

const HOUR = 3_600_000;
const base = new Date(2026, 10, 18, 8, 0, 0).getTime(); // 18 Nov 2026, 8:00 local

const sample = (t: number, level: number | null, ph: number | null, extra: Partial<HistoryRawSample> = {}): HistoryRawSample => ({
  id: `s${t}`, timestamp: t, waterLevel: level, phLevel: ph, waterHeight: null, levelSensorOk: true, phSensorOk: true, ...extra,
});
const log = (action: string, details: string, timestamp: number, logLevel: Log['logLevel'] = 'INFO'): Log => ({
  id: `${action}-${timestamp}`, action, details, performedBy: 'Tank 1', timestamp, logLevel,
});

describe('report calculations (Reports page)', () => {
  it('maps the date range to days and buckets by hour or local day', () => {
    expect([rangeDays('Last 7 Days'), rangeDays('Last 14 Days'), rangeDays('Last 30 Days')]).toEqual([7, 14, 30]);
    expect(periodStart(base + 25 * 60_000, true)).toBe(base);
    expect(periodStart(base + 5 * HOUR, false)).toBe(new Date(2026, 10, 18).getTime());
  });

  it('averages samples per hour in the 7-day view and flags fault samples', () => {
    const points = groupTelemetry([
      sample(base, 60, 7.0),
      sample(base + 10 * 60_000, 63, 7.3, { levelSensorOk: false }),
      sample(base + HOUR, 50, null),
    ], 7, 2);
    expect(points).toHaveLength(2);
    expect(points[0]).toMatchObject({ timestamp: base, waterLevel: 62, phLevel: 7.2, height: 1.24, sampleCount: 2, levelFault: true, phFault: false });
    expect(points[1]).toMatchObject({ waterLevel: 50, phLevel: null, phFault: true });
  });

  it('averages per day in the 14/30-day views', () => {
    const points = groupTelemetry([sample(base, 40, 7), sample(base + 6 * HOUR, 60, 7), sample(base + 24 * HOUR, 80, 7)], 30, 1);
    expect(points.map(p => p.waterLevel)).toEqual([50, 80]);
    expect(groupTelemetry([], 30, 1)).toEqual([]);
  });

  it('adds table rows for periods with problems but no samples', () => {
    const telemetry = groupTelemetry([sample(base, 60, 7)], 7, 1);
    const rows = buildTableRows(telemetry, [log('CONTROLLER_OFFLINE', 'Controller for Tank 1 went offline', base + 3 * HOUR, 'WARNING')], 7);
    expect(rows).toHaveLength(2);
    expect(rows[1]).toMatchObject({ timestamp: base + 3 * HOUR, hasSamples: false, waterLevel: null });
    expect(rows[1].problems.offline).toBe(1);
  });

  it('counts pump runs per day and builds the summary cards', () => {
    const now = new Date(base);
    const runs = [
      log('Pump Controller', 'Pump started automatically at 14%', base - 2 * HOUR),
      log('Pump Controller', 'Manual pump ON command accepted. Water level: 30%', base - HOUR),
      log('Pump Controller', 'Manual pump toggle refused: Pump control lock is enabled.', base - HOUR),
    ];
    const activity = pumpActivationsByDay(runs, 7, now);
    expect(activity).toHaveLength(8);
    expect(activity[activity.length - 1].activations).toBe(2);

    const telemetry = groupTelemetry([sample(base, 40, 6.9), sample(base + HOUR, 80, 7.5)], 7, 1);
    expect(summarizeReport(telemetry, activity, [{ name: 'Low Water Level', value: 3 }])).toEqual({
      avgLevel: 60, minLevel: 40, maxLevel: 80, avgPh: 7.2, minPh: 6.9, maxPh: 7.5, totalPumpRuns: 2, alertsRegistered: 3,
    });
    expect(summarizeReport([], activity, [])).toBeNull();
  });

  it('keeps only warning/error entries for the alert history card', () => {
    const logs = [log('Settings', 'saved', 1), log('Sensor Fault', 'pH', 2, 'WARNING'), log('Low Level Alert', 'x', 3)];
    expect(recentAlertLogs(logs).map(l => l.timestamp)).toEqual([2, 3]);
  });

  it('labels the signal and the pH category', () => {
    expect(signalStrength(-55, false).label).toBe('Excellent');
    expect(signalStrength(-80, false).label).toBe('Fair');
    expect(signalStrength(undefined, false).label).toBe('Offline');
    expect(signalStrength(-55, true).color).toBe('text-amber-500');
    expect(phCategory(6.2, { minPh: 6.5, maxPh: 8.5 }).label).toBe('Acidic');
    expect(phCategory(8.6, { minPh: 6.5, maxPh: 8.5 }).label).toBe('Alkaline');
    expect(phCategory(8.6, { minPh: 6.5, maxPh: 9 }).label).toBe('Neutral');
  });

  it('writes the CSV with "No data" rows and extra blocks', () => {
    const telemetry = groupTelemetry([sample(base, 50, 7.1)], 7, 1);
    const rows = buildTableRows(telemetry, [log('CONTROLLER_OFFLINE', 'Controller for Tank 1 went offline', base + 2 * HOUR, 'WARNING')], 7);
    const lines = buildReportCsv(rows, 200, ['Predictive', 'a,b']).split('\n');
    expect(lines[0]).toMatch(/^Date,Water Level \(%\),Water Height \(m\),pH Value,Estimated Volume \(L\),Sample Count,/);
    expect(lines[1]).toContain(',50,0.5,7.1,100,1,');
    expect(lines[2]).toContain(',No data,No data,No data,N/A,0,');
    expect(lines.slice(-3)).toEqual(['', 'Predictive', 'a,b']);
  });
});
