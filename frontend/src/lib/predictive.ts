/**
 * @file predictive.ts
 * @description Predictive analytics from the 10-minute history (/history/tanks/{id}).
 * Pure functions, no database access: Reports and the Dashboard pass in the samples.
 *
 * What it predicts, all from averages of past use (no machine learning):
 *   - water use per 10-minute interval (level drops while the pump is off)
 *   - peak hours: average use for each hour of the day
 *   - peak day: average daily use for each day of the week
 *   - expected use today (from the same weekday in the past)
 *   - time until the level reaches the low threshold (hour-of-day profile run forward)
 *   - pH trend: a straight line through the last 24 h of pH, and when it would pass a limit
 *
 * All hours and days are Philippine time (UTC+8), the motor pool's clock, whatever the
 * viewer's device is set to.
 */
import { NIGHT_TZ_OFFSET_MIN } from './alertEngine';

/** The slice of a history sample the analysis needs */
export interface UsageSample {
  timestamp: number;
  waterLevel: number | null;
  phLevel?: number | null;
  pumpOn?: boolean;
  levelSensorOk?: boolean;
  phSensorOk?: boolean;
}

const MIN_MS = 60_000;
const HOUR_MS = 60 * MIN_MS;
const DAY_MS = 24 * HOUR_MS;
const TZ_MS = NIGHT_TZ_OFFSET_MIN * MIN_MS;

/** The ESP32 saves one history sample every 10 minutes. */
export const SAMPLE_INTERVAL_MS = 10 * MIN_MS;
/** Two samples further apart than this (missed uploads, controller offline) are not compared. */
export const MAX_SAMPLE_GAP_MS = 25 * MIN_MS;
/**
 * A rise this large without the pump on counts as a refill (the pump can run and stop between
 * two 10-minute samples). Smaller rises are sensor steps (the level moves in 2 % steps) and ignored.
 */
export const REFILL_RISE_PERCENT = 4;
/**
 * A single reading that jumps this far from both neighbours and comes back (100 -> 30 -> 99)
 * is a glitch, not water use, and is skipped.
 */
export const SPIKE_PERCENT = 8;
/**
 * A drop larger than this within one 10-minute interval is treated as a sensor jump (unplugged
 * sensor, calibration, testing), not water use. 25 % of the 200 L drum is 50 L in 10 minutes.
 */
export const MAX_DROP_PER_INTERVAL_PERCENT = 25;
/** An hour of one day counts toward the hourly average when at least this many of its 6 intervals are usable. */
export const MIN_INTERVALS_PER_HOUR = 3;
/** A day counts toward the weekday average when at least this share of its 144 intervals is usable. */
export const MIN_DAY_COVERAGE = 0.6;
/** Time-to-low is not projected further than this. */
export const MAX_FORECAST_HOURS = 72;
/** The pH trend uses this much recent history. */
export const PH_TREND_WINDOW_MS = DAY_MS;
/** A pH change slower than this per day is called stable. */
export const PH_STABLE_PER_DAY = 0.1;

export const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;

/** Philippine wall-clock parts of a server time */
export function phParts(ms: number): { dayKey: number; hour: number; weekday: number; minuteOfHour: number } {
  const local = ms + TZ_MS;
  const dayKey = Math.floor(local / DAY_MS); // days since 1970-01-01, Philippine date
  const inDay = local - dayKey * DAY_MS;
  return {
    dayKey,
    hour: Math.floor(inDay / HOUR_MS),
    minuteOfHour: Math.floor((inDay % HOUR_MS) / MIN_MS),
    weekday: (dayKey + 4) % 7, // 1970-01-01 was a Thursday
  };
}

/** "7 AM", "12 PM", "12 AM" */
export function hourLabel(hour: number): string {
  const h = ((hour % 24) + 24) % 24;
  return `${h % 12 === 0 ? 12 : h % 12} ${h < 12 ? 'AM' : 'PM'}`;
}

/** "7 AM to 8 AM" */
export function hourRangeLabel(hour: number): string {
  return `${hourLabel(hour)} to ${hourLabel(hour + 1)}`;
}

export interface UsageInterval {
  /** End of the interval (the later sample) */
  end: number;
  /** Water used in the interval, % of the tank */
  usedPercent: number;
}

const levelUsable = (s: UsageSample) =>
  typeof s.waterLevel === 'number' && Number.isFinite(s.waterLevel) && s.waterLevel >= 0 && s.waterLevel <= 100 && s.levelSensorOk !== false;

/** Drops single-reading spikes: far from both neighbours, in opposite directions, with the neighbours close together. */
function withoutSpikes(sorted: UsageSample[]): UsageSample[] {
  return sorted.filter((s, i) => {
    const prev = sorted[i - 1];
    const next = sorted[i + 1];
    if (!prev || !next || !levelUsable(s) || !levelUsable(prev) || !levelUsable(next)) return true;
    if (next.timestamp - prev.timestamp > 2 * MAX_SAMPLE_GAP_MS) return true;
    const v = s.waterLevel as number;
    const a = prev.waterLevel as number;
    const b = next.waterLevel as number;
    const out = v - a;
    const back = b - v;
    return !(Math.abs(out) >= SPIKE_PERCENT && Math.abs(back) >= SPIKE_PERCENT
      && Math.sign(out) !== Math.sign(back) && Math.abs(b - a) < Math.abs(out) / 2);
  });
}

/**
 * Water used in each 10-minute interval, as % of the tank. Intervals with the pump on, a sensor
 * fault on either side, or a gap in the data are left out (they are not "zero use").
 * A reference level follows the lowest reading since the last refill, so a reading that steps
 * up and back down by the 2 % deadband is not counted twice.
 */
export function usageIntervals(samples: UsageSample[]): UsageInterval[] {
  const sorted = withoutSpikes([...samples].sort((a, b) => a.timestamp - b.timestamp));
  const out: UsageInterval[] = [];
  let ref: number | null = null;
  let prev: UsageSample | null = null;

  for (const s of sorted) {
    const usable = levelUsable(s);
    const comparable = prev !== null && usable && levelUsable(prev)
      && s.timestamp - prev.timestamp <= MAX_SAMPLE_GAP_MS
      && !s.pumpOn && !prev.pumpOn;

    if (!usable) {
      ref = null;
    } else if (!comparable || ref === null) {
      ref = s.waterLevel as number; // start again from this reading
    } else {
      const level = s.waterLevel as number;
      if (level < ref && ref - level > MAX_DROP_PER_INTERVAL_PERCENT) {
        ref = level; // a sensor jump, not use: not counted, and tracking restarts here
      } else if (level < ref) {
        out.push({ end: s.timestamp, usedPercent: ref - level });
        ref = level;
      } else {
        if (level - ref >= REFILL_RISE_PERCENT) ref = level; // refilled between samples
        out.push({ end: s.timestamp, usedPercent: 0 });
      }
    }
    prev = s;
  }
  return out;
}

export interface HourStat {
  hour: number;
  /** Average use in this hour of the day, % of the tank (null: no usable data for this hour) */
  avgPercent: number | null;
  avgLiters: number | null;
  /** Days that had enough data in this hour */
  days: number;
}

export interface WeekdayStat {
  weekday: number;
  name: string;
  /** Average use per day, % of the tank (null: no complete day of this weekday yet) */
  avgPercent: number | null;
  avgLiters: number | null;
  days: number;
}

export interface UsageProfile {
  hours: HourStat[];
  weekdays: WeekdayStat[];
  /** Days with enough data to count (MIN_DAY_COVERAGE) */
  coveredDays: number;
  /** Average daily use over all covered days, % of the tank */
  avgDailyPercent: number | null;
  avgDailyLiters: number | null;
  /** The busiest hours, highest first (up to 3, only hours with use) */
  peakHours: HourStat[];
  /** The busiest day of the week (null until at least one complete day) */
  peakWeekday: WeekdayStat | null;
  /** The quietest day of the week */
  lowWeekday: WeekdayStat | null;
}

const toLiters = (percent: number | null, capacityLiters: number) =>
  percent === null ? null : Math.round((percent / 100) * capacityLiters * 10) / 10;

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Peak hours and peak day of the week from the usage intervals. */
export function usageProfile(intervals: UsageInterval[], capacityLiters: number): UsageProfile {
  // (day, hour) and day buckets
  const hourBuckets = new Map<string, { hour: number; used: number; n: number }>();
  const dayBuckets = new Map<number, { weekday: number; used: number; n: number }>();
  for (const iv of intervals) {
    // An interval belongs to the time it started in (end - 10 min), so 7:00-7:10 is 7 AM
    const p = phParts(iv.end - 1);
    const hk = `${p.dayKey}:${p.hour}`;
    const hb = hourBuckets.get(hk) ?? { hour: p.hour, used: 0, n: 0 };
    hb.used += iv.usedPercent;
    hb.n += 1;
    hourBuckets.set(hk, hb);
    const db = dayBuckets.get(p.dayKey) ?? { weekday: p.weekday, used: 0, n: 0 };
    db.used += iv.usedPercent;
    db.n += 1;
    dayBuckets.set(p.dayKey, db);
  }

  const hourSums = Array.from({ length: 24 }, () => ({ used: 0, days: 0 }));
  for (const b of hourBuckets.values()) {
    if (b.n < MIN_INTERVALS_PER_HOUR) continue;
    hourSums[b.hour].used += b.used * (6 / b.n); // scale a partly covered hour to a full hour
    hourSums[b.hour].days += 1;
  }
  const hours: HourStat[] = hourSums.map((h, hour) => {
    const avg = h.days ? round1(h.used / h.days) : null;
    return { hour, avgPercent: avg, avgLiters: toLiters(avg, capacityLiters), days: h.days };
  });

  const intervalsPerDay = DAY_MS / SAMPLE_INTERVAL_MS;
  const weekdaySums = Array.from({ length: 7 }, () => ({ used: 0, days: 0 }));
  let allUsed = 0;
  let coveredDays = 0;
  for (const d of dayBuckets.values()) {
    if (d.n < intervalsPerDay * MIN_DAY_COVERAGE) continue;
    const scaled = d.used * (intervalsPerDay / d.n);
    weekdaySums[d.weekday].used += scaled;
    weekdaySums[d.weekday].days += 1;
    allUsed += scaled;
    coveredDays += 1;
  }
  const weekdays: WeekdayStat[] = weekdaySums.map((w, weekday) => {
    const avg = w.days ? round1(w.used / w.days) : null;
    return { weekday, name: WEEKDAY_NAMES[weekday], avgPercent: avg, avgLiters: toLiters(avg, capacityLiters), days: w.days };
  });
  const avgDaily = coveredDays ? round1(allUsed / coveredDays) : null;

  const peakHours = hours
    .filter(h => (h.avgPercent ?? 0) > 0)
    .sort((a, b) => (b.avgPercent as number) - (a.avgPercent as number) || a.hour - b.hour)
    .slice(0, 3);
  const withData = weekdays.filter(w => w.avgPercent !== null);
  const peakWeekday = withData.length
    ? withData.reduce((best, w) => ((w.avgPercent as number) > (best.avgPercent as number) ? w : best))
    : null;
  const lowWeekday = withData.length > 1
    ? withData.reduce((low, w) => ((w.avgPercent as number) < (low.avgPercent as number) ? w : low))
    : null;

  return {
    hours, weekdays, coveredDays,
    avgDailyPercent: avgDaily, avgDailyLiters: toLiters(avgDaily, capacityLiters),
    peakHours, peakWeekday, lowWeekday,
  };
}

export interface TodayForecast {
  weekday: string;
  /** Expected use for the whole day, % of the tank */
  expectedPercent: number | null;
  expectedLiters: number | null;
  /** What the forecast is based on */
  basis: 'weekday' | 'all-days' | 'none';
  /** Use measured so far today */
  usedSoFarPercent: number;
  usedSoFarLiters: number;
}

/** Expected use for the day `now` falls in: the average of the same weekday, else of all days. */
export function forecastToday(profile: UsageProfile, intervals: UsageInterval[], now: number, capacityLiters: number): TodayForecast {
  const today = phParts(now);
  const sameDay = profile.weekdays[today.weekday];
  const [expected, basis] = sameDay.avgPercent !== null
    ? [sameDay.avgPercent, 'weekday' as const]
    : profile.avgDailyPercent !== null ? [profile.avgDailyPercent, 'all-days' as const] : [null, 'none' as const];
  const used = round1(intervals.filter(iv => phParts(iv.end - 1).dayKey === today.dayKey).reduce((sum, iv) => sum + iv.usedPercent, 0));
  return {
    weekday: WEEKDAY_NAMES[today.weekday],
    expectedPercent: expected,
    expectedLiters: toLiters(expected, capacityLiters),
    basis,
    usedSoFarPercent: used,
    usedSoFarLiters: toLiters(used, capacityLiters) ?? 0,
  };
}

export type TimeToLow =
  | { kind: 'below' }
  | { kind: 'hours'; hours: number; at: number }
  | { kind: 'beyond' }
  | { kind: 'no-data' };

/**
 * When the level is expected to reach `targetPercent`, running the hour-of-day use profile
 * forward from `now`. Hours without data use the average of the hours that have data.
 */
export function predictTimeToLevel(level: number, targetPercent: number, profile: UsageProfile, now: number): TimeToLow {
  if (level <= targetPercent) return { kind: 'below' };
  const known = profile.hours.filter(h => h.avgPercent !== null);
  if (known.length < 6) return { kind: 'no-data' }; // less than a quarter of the day seen
  const fallback = known.reduce((s, h) => s + (h.avgPercent as number), 0) / known.length;
  const perHour = profile.hours.map(h => h.avgPercent ?? fallback);
  if (perHour.every(p => p <= 0)) return { kind: 'beyond' };

  let remaining = level - targetPercent;
  let t = now;
  const end = now + MAX_FORECAST_HOURS * HOUR_MS;
  while (t < end) {
    const { hour, minuteOfHour } = phParts(t);
    const fractionLeft = (60 - minuteOfHour) / 60;
    const use = perHour[hour] * fractionLeft;
    if (use >= remaining && use > 0) {
      const at = t + (remaining / perHour[hour]) * HOUR_MS;
      return { kind: 'hours', hours: Math.round(((at - now) / HOUR_MS) * 10) / 10, at };
    }
    remaining -= use;
    t += fractionLeft * HOUR_MS;
  }
  return { kind: 'beyond' };
}

export interface PhTrend {
  /** pH change per day (positive = rising) */
  perDay: number;
  direction: 'rising' | 'falling' | 'stable';
  /** Latest fitted pH */
  current: number;
  /** Hours until the trend line passes the limit it is heading to (null: not within 72 h, or stable) */
  hoursToLimit: number | null;
  limit: number | null;
  samples: number;
}

/** A least-squares line through the last 24 h of pH readings (sensor faults left out). */
export function phTrend(samples: UsageSample[], minPh: number, maxPh: number, now: number): PhTrend | null {
  const pts = samples
    .filter(s => s.timestamp > now - PH_TREND_WINDOW_MS && s.timestamp <= now
      && typeof s.phLevel === 'number' && Number.isFinite(s.phLevel) && s.phLevel >= 0 && s.phLevel <= 14 && s.phSensorOk !== false)
    .map(s => ({ x: (s.timestamp - now) / DAY_MS, y: s.phLevel as number }));
  if (pts.length < 12) return null; // under 2 hours of readings
  const n = pts.length;
  const mx = pts.reduce((s, p) => s + p.x, 0) / n;
  const my = pts.reduce((s, p) => s + p.y, 0) / n;
  const sxx = pts.reduce((s, p) => s + (p.x - mx) ** 2, 0);
  if (sxx === 0) return null;
  const slope = pts.reduce((s, p) => s + (p.x - mx) * (p.y - my), 0) / sxx; // pH per day
  const current = my + slope * (0 - mx);
  const direction = Math.abs(slope) < PH_STABLE_PER_DAY ? 'stable' : slope > 0 ? 'rising' : 'falling';
  let limit: number | null = null;
  let hoursToLimit: number | null = null;
  if (direction !== 'stable') {
    limit = direction === 'rising' ? maxPh : minPh;
    const days = (limit - current) / slope;
    if (days >= 0 && days * 24 <= MAX_FORECAST_HOURS) hoursToLimit = Math.round(days * 24 * 10) / 10;
  }
  return { perDay: Math.round(slope * 100) / 100, direction, current: Math.round(current * 100) / 100, hoursToLimit, limit, samples: n };
}

/** Philippine clock time of `at`: "4:20 PM", "tomorrow 7:40 AM", "Mon 7:40 AM" */
export function clockLabel(at: number, now: number): string {
  const a = phParts(at);
  const n = phParts(now);
  const h = a.hour % 12 === 0 ? 12 : a.hour % 12;
  const time = `${h}:${String(a.minuteOfHour).padStart(2, '0')} ${a.hour < 12 ? 'AM' : 'PM'}`;
  if (a.dayKey === n.dayKey) return time;
  if (a.dayKey === n.dayKey + 1) return `tomorrow ${time}`;
  return `${WEEKDAY_NAMES[a.weekday].slice(0, 3)} ${time}`;
}

/** "about 6 h", "about 45 min", "about 1 day 4 h" */
export function durationLabel(hours: number): string {
  if (hours < 1) return `about ${Math.max(1, Math.round(hours * 60))} min`;
  if (hours < 24) return `about ${Math.round(hours)} h`;
  const d = Math.floor(hours / 24);
  const h = Math.round(hours - d * 24);
  return `about ${d} day${d > 1 ? 's' : ''}${h ? ` ${h} h` : ''}`;
}

// ---------------------------------------------------------------------------
// Report summary: one set of texts for the Reports panel and the Excel/PDF exports
// ---------------------------------------------------------------------------

export interface PredictiveInput {
  samples: UsageSample[];
  capacityLiters: number;
  /** Live level for the time-to-low forecast; null when offline, faulty or unknown */
  liveLevel: number | null;
  lowLevelThreshold: number;
  minPh: number;
  maxPh: number;
  /** Server time (ms) */
  now: number;
  /** Pump auto mode: the pump refills at the low threshold */
  pumpAuto: boolean;
}

export interface PredictiveItem {
  /** Short result, e.g. "7 AM to 8 AM" */
  value: string;
  /** One-line explanation */
  detail: string;
}

export interface PredictiveReport {
  profile: UsageProfile;
  /** At least a quarter of the day's hours have data, so the patterns can be shown */
  enoughData: boolean;
  peakHours: PredictiveItem;
  peakDay: PredictiveItem;
  today: PredictiveItem;
  timeToLow: PredictiveItem;
  phTrend: PredictiveItem;
}

/** Everything the Predictive Analytics panel and the exports show, as data and ready-made text. */
export function buildPredictiveReport(input: PredictiveInput): PredictiveReport {
  const { samples, capacityLiters, liveLevel, lowLevelThreshold, minPh, maxPh, now, pumpAuto } = input;
  const intervals = usageIntervals(samples);
  const profile = usageProfile(intervals, capacityLiters);
  const today = forecastToday(profile, intervals, now, capacityLiters);
  const toLow = liveLevel === null ? null : predictTimeToLevel(liveLevel, lowLevelThreshold, profile, now);
  const ph = phTrend(samples, minPh, maxPh, now);
  const enoughData = profile.hours.filter(h => h.avgPercent !== null).length >= 6;

  const [peak, ...others] = profile.peakHours;
  const peakHours: PredictiveItem = peak
    ? { value: hourRangeLabel(peak.hour), detail: `About ${peak.avgLiters} L on average${others.length ? `. Next: ${others.map(h => hourLabel(h.hour)).join(', ')}` : ''}` }
    : { value: 'No use yet', detail: enoughData ? 'No water use measured in this period' : 'Needs about a day of readings' };

  const peakDay: PredictiveItem = profile.peakWeekday
    ? { value: profile.peakWeekday.name, detail: `About ${profile.peakWeekday.avgLiters} L per day${profile.lowWeekday ? `. Quietest: ${profile.lowWeekday.name} (${profile.lowWeekday.avgLiters} L)` : ''}` }
    : { value: 'Not enough days yet', detail: 'Needs at least one mostly complete day of readings' };

  const todayItem: PredictiveItem = {
    value: today.expectedLiters !== null ? `About ${today.expectedLiters} L` : 'Not enough days yet',
    detail: today.basis === 'none'
      ? `Used so far today: ${today.usedSoFarLiters} L`
      : `${today.basis === 'weekday' ? `Average for a ${today.weekday}` : 'Average of all days'}. Used so far today: ${today.usedSoFarLiters} L`,
  };

  let timeToLow: PredictiveItem = { value: 'Unavailable', detail: 'Needs a live level reading from the controller' };
  if (toLow?.kind === 'below') {
    timeToLow = { value: 'At or below now', detail: `The level is at or under ${lowLevelThreshold}%` };
  } else if (toLow?.kind === 'hours') {
    timeToLow = { value: durationLabel(toLow.hours), detail: `Around ${clockLabel(toLow.at, now)} at the usual rate of use${pumpAuto ? '; the pump starts then (Auto mode)' : ''}` };
  } else if (toLow?.kind === 'beyond') {
    timeToLow = { value: 'More than 3 days', detail: 'Use in this period is too low to reach the threshold soon' };
  } else if (toLow?.kind === 'no-data') {
    timeToLow = { value: 'Learning', detail: 'Needs more history to know the usual rate of use' };
  }

  let phItem: PredictiveItem = { value: 'Not enough readings', detail: 'Needs at least 2 hours of pH readings in the last day' };
  if (ph) {
    const rate = `${ph.perDay > 0 ? '+' : ''}${ph.perDay} per day`;
    phItem = {
      value: ph.direction === 'stable' ? 'Stable' : ph.direction === 'rising' ? 'Rising' : 'Falling',
      detail: ph.hoursToLimit !== null
        ? `${rate}; may pass ${ph.limit} in ${durationLabel(ph.hoursToLimit)}`
        : `${rate} over the last 24 h; stays within ${minPh} to ${maxPh}`,
    };
  }

  return { profile, enoughData, peakHours, peakDay, today: todayItem, timeToLow, phTrend: phItem };
}
