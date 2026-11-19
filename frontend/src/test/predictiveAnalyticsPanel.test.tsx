import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { Tank } from '@/store/useStore';

vi.mock('@/config/firebase', () => ({ database: {}, firestore: {}, auth: {} }));

import PredictiveAnalytics from '@/components/PredictiveAnalytics';
import { buildPredictiveReport, predictiveCsvLines, csvCell, phParts, type PredictiveInput, type UsageSample } from '@/lib/predictive';
import { buildExcelWorkbook, buildPdfDocument, type ReportExportData } from '@/lib/reportExport';

// Recharts needs ResizeObserver, which jsdom does not have
global.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;

const ph = (day: number, hour: number, minute = 0) => Date.UTC(2026, 10, day, hour - 8, minute);
const TEN_MIN = 10 * 60_000;

/** Two weeks from Monday 16 Nov: water used 8-9 AM only, twice as much on Wednesdays */
function history(): UsageSample[] {
  const out: UsageSample[] = [];
  let level = 90;
  for (let t = ph(16, 0); t < ph(30, 0); t += TEN_MIN) {
    const { hour, weekday } = phParts(t - 1);
    let pumpOn = false;
    if (hour === 8) level -= weekday === 3 ? 2 : 1;
    if (level < 30) { level = 90; pumpOn = true; }
    out.push({ timestamp: t, waterLevel: level, phLevel: 7.2, pumpOn, levelSensorOk: true, phSensorOk: true });
  }
  return out;
}

const input: PredictiveInput = {
  samples: history(), capacityLiters: 200, liveLevel: 20, lowLevelThreshold: 15, minPh: 6.5, maxPh: 8.5,
  now: ph(30, 6), pumpAuto: true,
};
const show = (overrides: Partial<PredictiveInput> = {}) =>
  render(<PredictiveAnalytics report={buildPredictiveReport({ ...input, ...overrides })} lowLevelThreshold={15} rangeLabel="Last 30 Days" />);

describe('Reports: Predictive Analytics panel', () => {
  it('shows the peak hour, the peak day, today’s forecast, time to low and the pH trend', () => {
    show();
    expect(screen.getByTestId('peak-hours')).toHaveTextContent('8 AM to 9 AM');
    expect(screen.getByTestId('peak-day')).toHaveTextContent('Wednesday');
    expect(screen.getByTestId('today-forecast')).toHaveTextContent('Average for a Monday');
    // 20 % now, about 6 % used between 8 and 9 AM: crosses 15 % during the 8 AM hour
    expect(screen.getByTestId('time-to-low')).toHaveTextContent(/about \d+ h/);
    expect(screen.getByTestId('time-to-low')).toHaveTextContent('8:');
    expect(screen.getByTestId('ph-trend')).toHaveTextContent('Stable');
  });

  it('says it is still learning when there is no history', () => {
    show({ samples: [], liveLevel: 50 });
    expect(screen.getByText(/Not enough history yet/)).toBeInTheDocument();
    expect(screen.getByTestId('time-to-low')).toHaveTextContent('Learning');
    expect(screen.getByTestId('peak-day')).toHaveTextContent('Not enough days yet');
  });

  it('does not forecast time to low without a live level', () => {
    show({ liveLevel: null });
    expect(screen.getByTestId('time-to-low')).toHaveTextContent('Unavailable');
  });
});

describe('Exports: predictive analytics', () => {
  const report = buildPredictiveReport(input);
  const data: ReportExportData = {
    currentUser: { username: 'admin' },
    dateRange: 'Last 30 Days',
    days: 30,
    logs: [],
    pumpActivityData: [],
    selectedTank: { id: '1', name: 'Reservoir Tank No. 1', enabled: true, tankHeight: 1 } as Tank,
    summaryMetrics: null,
    telemetryData: [],
    thresholds: { lowLevel: 15, overflow: 95, minPh: 6.5, maxPh: 8.5 },
    predictive: report,
  };
  const rowsOf = (sheet: { eachRow: (cb: (row: { values: unknown }) => void) => void }) => {
    const rows: unknown[][] = [];
    sheet.eachRow(row => rows.push((row.values as unknown[]).slice(1)));
    return rows;
  };

  it('adds a Predictive Analytics sheet to the Excel workbook with the same results as the page', async () => {
    const sheet = (await buildExcelWorkbook(data)).getWorksheet('Predictive Analytics')!;
    expect(sheet).toBeDefined();
    const rows = rowsOf(sheet);
    expect(rows).toContainEqual(['Peak hours', report.peakHours.value, report.peakHours.detail]);
    expect(rows).toContainEqual(['Peak day', 'Wednesday', report.peakDay.detail]);
    expect(rows).toContainEqual(['Time until 15%', report.timeToLow.value, report.timeToLow.detail]);
    // 24 hour rows and 7 weekday rows
    expect(rows.filter(r => typeof r[0] === 'string' && / to /.test(r[0] as string) && /M$/.test(r[0] as string))).toHaveLength(24);
    expect(rows.find(r => r[0] === 'Wednesday')?.[3]).toBe(2);
  });

  it('leaves the sheet out when there is no predictive report', async () => {
    const workbook = await buildExcelWorkbook({ ...data, predictive: undefined });
    expect(workbook.getWorksheet('Predictive Analytics')).toBeUndefined();
  });

  it('adds a numbered Predictive Analytics section to the PDF and renumbers the later sections', () => {
    const text = buildPdfDocument(data).output();
    expect(text).toContain('3. Predictive Analytics');
    expect(text).toContain('4. Pump Activity');
    expect(text).toContain('5. System Alarms & Incident Logs');
    expect(text).toContain('8 AM to 9 AM');
    expect(text).toContain('Wednesday');

    const withoutPump = buildPdfDocument({ ...data, includePump: false }).output();
    expect(withoutPump).toContain('4. System Alarms & Incident Logs');
    const withoutPredictive = buildPdfDocument({ ...data, predictive: undefined }).output();
    expect(withoutPredictive).toContain('3. Pump Activity');
    expect(withoutPredictive).not.toContain('Predictive Analytics');
  });
});

describe('CSV export: predictive analytics', () => {
  const report = buildPredictiveReport(input);
  const lines = predictiveCsvLines(report, 15);

  /** Minimal RFC 4180 parser for one line */
  const parse = (line: string) => {
    const cells: string[] = [];
    let cur = '';
    let quoted = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (quoted) {
        if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
        else if (ch === '"') quoted = false;
        else cur += ch;
      } else if (ch === '"') quoted = true;
      else if (ch === ',') { cells.push(cur); cur = ''; }
      else cur += ch;
    }
    cells.push(cur);
    return cells;
  };

  it('adds the forecasts, the 24 hours and the 7 days as titled blocks', () => {
    expect(lines[0]).toBe('PREDICTIVE ANALYTICS');
    expect(lines).toContain('AVERAGE WATER USE BY HOUR OF THE DAY');
    expect(lines).toContain('AVERAGE WATER USE BY DAY OF THE WEEK');
    const rows = lines.map(parse);
    expect(rows).toContainEqual(['Peak hours', report.peakHours.value, report.peakHours.detail]);
    expect(rows).toContainEqual(['Peak day', 'Wednesday', report.peakDay.detail]);
    expect(rows.filter(r => / to /.test(r[0]) && /M$/.test(r[0]))).toHaveLength(24);
    expect(rows.find(r => r[0] === '8 AM to 9 AM')?.[4]).toBe('Yes');
    expect(rows.find(r => r[0] === 'Wednesday')?.[4]).toBe('Yes');
    expect(rows.find(r => r[0] === 'Tuesday')?.[4]).toBe('');
  });

  it('quotes cells with commas or quotes so the columns stay in place', () => {
    expect(csvCell('About 6 L. Next: 1 PM, 2 PM')).toBe('"About 6 L. Next: 1 PM, 2 PM"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell(12.5)).toBe('12.5');
    expect(csvCell(null)).toBe('');
    // Every forecast row parses back to exactly 3 cells
    lines.slice(3, 8).forEach(l => expect(parse(l)).toHaveLength(3));
  });
});

describe('Print view: predictive analytics', () => {
  it('starts on a new page and prints tables in place of the charts', () => {
    show();
    expect(screen.getByTestId('predictive-analytics').className).toContain('print:break-before-page');
    // Charts are hidden in print, the tables only show in print
    expect(screen.getByTestId('usage-charts').className).toContain('print:hidden');
    expect(screen.getByTestId('print-tables').className).toMatch(/(^| )hidden( |$)/);
    expect(screen.getByTestId('print-tables').className).toContain('print:grid');

    const hourRows = screen.getByTestId('print-hour-table').querySelectorAll('tbody tr');
    expect(hourRows).toHaveLength(12); // 24 hours in two columns
    expect(screen.getByTestId('print-hour-table')).toHaveTextContent('8 AM to 9 AM (Peak)');
    expect(screen.getByTestId('print-day-table').querySelectorAll('tbody tr')).toHaveLength(7);
    expect(screen.getByTestId('print-day-table')).toHaveTextContent('Wednesday (Peak)');
  });

  it('prints only the "not enough history" note when there is no history', () => {
    show({ samples: [], liveLevel: 50 });
    expect(screen.queryByTestId('print-tables')).toBeNull();
    expect(screen.getByText(/Not enough history yet/)).toBeInTheDocument();
  });
});
