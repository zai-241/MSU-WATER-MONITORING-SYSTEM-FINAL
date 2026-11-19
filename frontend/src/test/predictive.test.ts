import { describe, it, expect } from 'vitest';
import {
  usageIntervals,
  usageProfile,
  forecastToday,
  predictTimeToLevel,
  phTrend,
  phParts,
  hourLabel,
  hourRangeLabel,
  durationLabel,
  type UsageSample,
} from '@/lib/predictive';

/** Server ms for a Philippine (UTC+8) wall-clock time in November 2026 (Nov 16 2026 is a Monday) */
const ph = (day: number, hour: number, minute = 0) => Date.UTC(2026, 10, day, hour - 8, minute);
const TEN_MIN = 10 * 60_000;

/**
 * Builds 10-minute samples from `start` for `days` days. `drainPerSample(t)` is the % used in the
 * 10 minutes before t; when the level would go under 20 % it is refilled to 90 % (pump sample).
 */
function simulate(startDay: number, days: number, drainPerSample: (t: number) => number, startLevel = 90): UsageSample[] {
  const out: UsageSample[] = [];
  let level = startLevel;
  const start = ph(startDay, 0);
  for (let t = start; t < start + days * 24 * 3600_000; t += TEN_MIN) {
    let pumpOn = false;
    level -= drainPerSample(t);
    if (level < 20) { level = 90; pumpOn = true; }
    out.push({ timestamp: t, waterLevel: Math.round(level * 100) / 100, phLevel: 7.2, pumpOn, levelSensorOk: true, phSensorOk: true });
  }
  return out;
}

describe('Philippine time helpers', () => {
  it('reads hour and weekday in Philippine time', () => {
    expect(phParts(ph(16, 7, 30))).toMatchObject({ hour: 7, minuteOfHour: 30, weekday: 1 }); // Monday
    expect(phParts(ph(22, 23, 59)).weekday).toBe(0); // Sunday
  });

  it('formats hours and durations', () => {
    expect(hourLabel(0)).toBe('12 AM');
    expect(hourLabel(13)).toBe('1 PM');
    expect(hourRangeLabel(11)).toBe('11 AM to 12 PM');
    expect(durationLabel(0.5)).toBe('about 30 min');
    expect(durationLabel(6.2)).toBe('about 6 h');
    expect(durationLabel(28)).toBe('about 1 day 4 h');
  });
});

describe('usageIntervals', () => {
  const base = { phLevel: 7, levelSensorOk: true, phSensorOk: true };

  it('counts drops while the pump is off and leaves out pump, fault and gap intervals', () => {
    const s: UsageSample[] = [
      { ...base, timestamp: 0, waterLevel: 80 },
      { ...base, timestamp: TEN_MIN, waterLevel: 76 },                     // used 4
      { ...base, timestamp: 2 * TEN_MIN, waterLevel: 90, pumpOn: true },   // pump: left out
      { ...base, timestamp: 3 * TEN_MIN, waterLevel: 88 },                 // pump on before: left out
      { ...base, timestamp: 4 * TEN_MIN, waterLevel: 86 },                 // used 2
      { ...base, timestamp: 5 * TEN_MIN, waterLevel: 50, levelSensorOk: false }, // fault: left out
      { ...base, timestamp: 6 * TEN_MIN, waterLevel: 84 },                 // after fault: left out
      { ...base, timestamp: 12 * TEN_MIN, waterLevel: 70 },                // 1 h gap: left out
    ];
    expect(usageIntervals(s).map(i => i.usedPercent)).toEqual([4, 2]);
  });

  it('does not count a 2 % sensor step twice', () => {
    const levels = [50, 48, 50, 48, 50, 48];
    const s = levels.map((waterLevel, i) => ({ ...base, timestamp: i * TEN_MIN, waterLevel }));
    const total = usageIntervals(s).reduce((sum, i) => sum + i.usedPercent, 0);
    expect(total).toBe(2);
  });

  it('treats a large rise without the pump flag as a refill', () => {
    const levels = [40, 38, 80, 78];
    const s = levels.map((waterLevel, i) => ({ ...base, timestamp: i * TEN_MIN, waterLevel }));
    expect(usageIntervals(s).map(i => i.usedPercent)).toEqual([2, 0, 2]);
  });

  it('skips a one-reading glitch and a sensor jump (seen in the real Tank 1 history)', () => {
    const spike = [100, 100, 30, 99, 95].map((waterLevel, i) => ({ ...base, timestamp: i * TEN_MIN, waterLevel }));
    expect(usageIntervals(spike).reduce((sum, i) => sum + i.usedPercent, 0)).toBe(5); // 100 -> 95 only

    const jump = [34, 100, 0, 71, 71, 69].map((waterLevel, i) => ({ ...base, timestamp: i * TEN_MIN, waterLevel }));
    expect(usageIntervals(jump).reduce((sum, i) => sum + i.usedPercent, 0)).toBe(2); // 71 -> 69 only
  });
});

describe('usageProfile: peak hours and peak day', () => {
  // Two weeks from Monday 16 Nov: use only 7-8 AM (3 % per 10 min) and 1-2 PM (1 % per 10 min);
  // Mondays use twice as much.
  const samples = simulate(16, 14, (t) => {
    const { hour, weekday } = phParts(t - 1);
    const factor = weekday === 1 ? 2 : 1;
    if (hour === 7) return 3 * factor / 2; // 9 % per hour (18 % on Mondays)
    if (hour === 13) return 0.5 * factor;  // 3 % per hour
    return 0;
  });
  const intervals = usageIntervals(samples);
  const profile = usageProfile(intervals, 200);

  it('finds 7 AM as the peak hour and 1 PM second', () => {
    expect(profile.peakHours.map(h => h.hour)).toEqual([7, 13]);
    expect(profile.peakHours[0].avgPercent).toBeGreaterThan(profile.peakHours[1].avgPercent as number);
    expect(profile.hours[3].avgPercent).toBe(0);
  });

  it('finds Monday as the peak day and gives liters', () => {
    expect(profile.peakWeekday?.name).toBe('Monday');
    expect(profile.peakWeekday?.days).toBe(2);
    expect(profile.weekdays[2].avgPercent).toBeCloseTo(12, 0); // Tuesday: 9 + 3
    expect(profile.weekdays[2].avgLiters).toBeCloseTo(24, 0);  // 12 % of 200 L
    expect(profile.coveredDays).toBe(14);
  });

  it('forecasts today from the same weekday', () => {
    const now = ph(30, 9); // a Monday, after the 7 AM peak
    const today = forecastToday(profile, intervals, now, 200);
    expect(today).toMatchObject({ weekday: 'Monday', basis: 'weekday' });
    expect(today.expectedPercent).toBeCloseTo(profile.weekdays[1].avgPercent as number, 5);
  });

  it('predicts when the level reaches the low threshold from the hourly pattern', () => {
    // At 6 AM with 30 %: 7 AM uses ~9-10 %, 1 PM ~3 %... reaching 15 % takes until a later peak
    const result = predictTimeToLevel(30, 15, profile, ph(31, 6)); // Tuesday 6 AM
    expect(result.kind).toBe('hours');
    if (result.kind === 'hours') {
      expect(result.hours).toBeGreaterThan(1);
      expect(phParts(result.at).hour === 7 || phParts(result.at).hour === 13).toBe(true);
    }
    expect(predictTimeToLevel(10, 15, profile, ph(31, 6))).toEqual({ kind: 'below' });
  });

  it('says there is not enough data with less than a quarter of the day seen', () => {
    const few = usageIntervals(simulate(16, 1, () => 0.5).slice(0, 20));
    expect(predictTimeToLevel(50, 15, usageProfile(few, 200), ph(17, 8))).toEqual({ kind: 'no-data' });
  });

  it('needs a mostly complete day before a weekday counts', () => {
    const half = usageIntervals(simulate(16, 1, () => 0.1).slice(0, 60)); // 10 hours only
    const p = usageProfile(half, 200);
    expect(p.coveredDays).toBe(0);
    expect(p.peakWeekday).toBeNull();
  });
});

describe('phTrend', () => {
  const now = ph(20, 12);
  const series = (perDay: number, start = 7.5) => Array.from({ length: 144 }, (_, i) => {
    const t = now - (143 - i) * TEN_MIN;
    return { timestamp: t, waterLevel: 50, phLevel: start + perDay * ((t - now) / 86_400_000) };
  });

  it('reports a rising pH and when it would pass the upper limit', () => {
    const trend = phTrend(series(0.5, 8.0), 6.5, 8.5, now)!;
    expect(trend.direction).toBe('rising');
    expect(trend.perDay).toBeCloseTo(0.5, 2);
    expect(trend.limit).toBe(8.5);
    expect(trend.hoursToLimit).toBeCloseTo(24, 0);
  });

  it('calls a flat pH stable and ignores faulty readings', () => {
    const s = series(0.02).map((x, i) => (i % 10 === 0 ? { ...x, phLevel: 14, phSensorOk: false } : x));
    expect(phTrend(s, 6.5, 8.5, now)?.direction).toBe('stable');
  });

  it('needs at least 2 hours of readings', () => {
    expect(phTrend(series(0.5).slice(-5), 6.5, 8.5, now)).toBeNull();
  });
});
