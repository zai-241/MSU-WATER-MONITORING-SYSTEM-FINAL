import { describe, it, expect, vi } from 'vitest';
import type { Tank } from '@/store/useStore';

vi.mock('@/config/firebase', () => ({ database: {}, firestore: {}, auth: {} }));

import { buildExcelWorkbook, buildPdfDocument, type ReportExportData } from '@/lib/reportExport';

const tank = { id: '1', name: 'Reservoir Tank No. 1', enabled: true, tankHeight: 1 } as Tank;

const data: ReportExportData = {
  currentUser: { username: 'Zailanor Pundato' },
  dateRange: 'Last 30 Days',
  days: 30,
  logs: [],
  pumpActivityData: [],
  selectedTank: tank,
  summaryMetrics: null,
  telemetryData: [
    {
      date: '11/17/2026', timestamp: 1, waterLevel: 55, phLevel: 7.1, height: 0.5, sampleCount: 144,
      levelFault: true, phFault: false, hasSamples: true,
      problems: { levelFault: 2, phFault: 0, offline: 1, other: 3 },
    },
    // A day with problems but no readings (controller offline all day)
    {
      date: '11/18/2026', timestamp: 2, waterLevel: null, phLevel: null, height: 0, sampleCount: 0,
      levelFault: false, phFault: false, hasSamples: false,
      problems: { levelFault: 0, phFault: 0, offline: 1, other: 0 },
    },
  ],
  thresholds: { lowLevel: 15, overflow: 95, minPh: 6.5, maxPh: 8.5 },
};

describe('Exports include the problem count columns', () => {
  it('adds the four columns to the Excel Telemetry History sheet', async () => {
    const sheet = (await buildExcelWorkbook(data)).getWorksheet('Telemetry History')!;
    const header = (sheet.getRow(1).values as unknown[]).slice(1);
    expect(header).toEqual(expect.arrayContaining(['Level Sensor Fault', 'pH Sensor Fault', 'Controller Offline', 'Other Problems']));

    const values = (row: number) => (sheet.getRow(row).values as unknown[]).slice(1);
    expect(values(2).slice(-4)).toEqual([2, 0, 1, 3]);
    // Problem-only day: no readings, still counted
    expect(values(3)).toEqual(expect.arrayContaining(['No data']));
    expect(values(3).slice(-4)).toEqual([0, 0, 1, 0]);
  });

  it('adds the four columns to the PDF history table', () => {
    const doc = buildPdfDocument(data);
    const text = doc.output();
    // The narrow header cells wrap, so look for the words one by one
    for (const header of ['(Fault)', '(Controller)', '(Offline)', '(Other)', '(Problems)']) {
      expect(text).toContain(header);
    }
  });
});
