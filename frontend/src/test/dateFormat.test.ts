import { describe, it, expect } from 'vitest';
import { formatDate, formatTime, formatDateTime } from '@/lib/dateFormat';
import { formatLastSeen } from '@/lib/formatTime';

describe('Date and time format (mm/dd/yyyy, 12-hour)', () => {
  it('formats dates as mm/dd/yyyy', () => {
    expect(formatDate(new Date(2026, 0, 5, 8, 0))).toBe('01/05/2026');
    expect(formatDate(new Date(2026, 10, 17))).toBe('11/17/2026');
  });

  it('formats times in 12-hour format with AM/PM', () => {
    expect(formatTime(new Date(2026, 0, 1, 0, 7))).toBe('12:07 AM');
    expect(formatTime(new Date(2026, 0, 1, 12, 0))).toBe('12:00 PM');
    expect(formatTime(new Date(2026, 0, 1, 21, 5, 9), { seconds: true })).toBe('09:05:09 PM');
  });

  it('combines both', () => {
    expect(formatDateTime(new Date(2026, 10, 17, 23, 25, 30).getTime(), { seconds: true })).toBe('11/17/2026 11:25:30 PM');
    expect(formatDateTime(NaN)).toBe('Invalid Date');
  });

  it('dashboard "last seen" falls back to mm/dd/yyyy after a day', () => {
    const ts = new Date(2026, 10, 15, 10, 0).getTime();
    expect(formatLastSeen(ts, ts + 3 * 24 * 3600_000)).toBe('11/15/2026');
  });
});
