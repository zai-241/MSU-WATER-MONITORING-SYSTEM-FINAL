import { describe, it, expect } from 'vitest';
import {
  heightFromVoltage,
  levelPercentFromVoltage,
  effectiveLevelCalPoints,
  validateLevelCalPoints,
  parseLevelCalPoints,
  type LevelCalPoint,
} from '@/lib/levelCalibration';

// A curved sensor: steeper at the top, like the Tank 1 drum over-read between 50 and 80 cm
const drum: LevelCalPoint[] = [
  { depthM: 0, volts: 0.6 },
  { depthM: 0.3, volts: 0.82 },
  { depthM: 0.6, volts: 1.1 },
  { depthM: 0.9, volts: 1.36 },
];
const H = 0.9;

/** The two-point formula the firmware used before the table */
const oldHeight = (v: number, vmin: number, vmax: number, h: number) => (v - vmin) * (h / (vmax - vmin));
const oldPercent = (v: number, vmin: number, vmax: number, h: number, offset = 0) => {
  const clamped = Math.min(Math.max(oldHeight(v, vmin, vmax, h), 0), h);
  let p = Math.trunc((clamped / h) * 100);
  p += Math.trunc(offset);
  return Math.min(100, Math.max(0, p));
};

describe('heightFromVoltage (piecewise-linear interpolation)', () => {
  it('returns the depth of each point at its exact voltage', () => {
    for (const p of drum) {
      expect(heightFromVoltage(p.volts, drum)).toBeCloseTo(p.depthM, 9);
    }
  });

  it('interpolates linearly between the two points around the voltage', () => {
    // halfway between 0.3 m @ 0.82 V and 0.6 m @ 1.10 V
    expect(heightFromVoltage(0.96, drum)).toBeCloseTo(0.45, 9);
    // a quarter of the way into the last segment
    expect(heightFromVoltage(1.1 + 0.26 / 4, drum)).toBeCloseTo(0.675, 9);
    // first segment
    expect(heightFromVoltage(0.71, drum)).toBeCloseTo(0.15, 9);
  });

  it('extends the first and last segments outside the table (unclamped height)', () => {
    expect(heightFromVoltage(0.5, drum)).toBeCloseTo(-0.1 * (0.3 / 0.22), 9);
    expect(heightFromVoltage(1.62, drum)).toBeCloseTo(0.9 + 0.26 * (0.3 / 0.26), 9);
  });

  it('returns 0 when a segment has no slope', () => {
    expect(heightFromVoltage(1, [{ depthM: 0, volts: 1 }, { depthM: 1, volts: 1 }])).toBe(0);
    expect(heightFromVoltage(1, [{ depthM: 0, volts: 1 }])).toBe(0);
  });
});

describe('levelPercentFromVoltage', () => {
  const cal = { levelVmin: 0.6, levelVmax: 1.36, tankHeight: H, levelOffset: 0, levelCalPoints: drum };

  it('is 0 % below the first point and 100 % above the last', () => {
    expect(levelPercentFromVoltage(0.4, cal)).toBe(0);
    expect(levelPercentFromVoltage(0.6, cal)).toBe(0);
    expect(levelPercentFromVoltage(1.36, cal)).toBe(100);
    expect(levelPercentFromVoltage(2.5, cal)).toBe(100);
  });

  it('follows the table between points', () => {
    expect(levelPercentFromVoltage(0.82, cal)).toBe(33); // 0.30 / 0.90 = 33.3 %
    expect(levelPercentFromVoltage(1.1, cal)).toBe(66);
    // The straight line Vmin-Vmax would read this voltage much higher
    const straight = { ...cal, levelCalPoints: null };
    expect(levelPercentFromVoltage(1.1, straight)).toBe(65);
    expect(levelPercentFromVoltage(0.97, cal)).toBe(51);
    expect(levelPercentFromVoltage(0.97, straight)).toBe(48);
  });

  it('applies the reading offset and clamps to 0..100', () => {
    expect(levelPercentFromVoltage(0.97, { ...cal, levelOffset: 5 })).toBe(56);
    expect(levelPercentFromVoltage(1.36, { ...cal, levelOffset: 5 })).toBe(100);
    expect(levelPercentFromVoltage(0.6, { ...cal, levelOffset: -5 })).toBe(0);
  });

  it('with two points (0, Vmin) and (H, Vmax) equals the old Vmin/Vmax formula', () => {
    const vmin = 0.6, vmax = 1.36;
    const two = [{ depthM: 0, volts: vmin }, { depthM: H, volts: vmax }];
    for (let v = 0.3; v <= 3.2; v += 0.037) {
      expect(heightFromVoltage(v, two)).toBeCloseTo(oldHeight(v, vmin, vmax, H), 9);
      expect(levelPercentFromVoltage(v, { levelVmin: vmin, levelVmax: vmax, tankHeight: H, levelOffset: 3, levelCalPoints: two }))
        .toBe(oldPercent(v, vmin, vmax, H, 3));
    }
  });

  it('without a table (or with an invalid one) uses the old formula exactly', () => {
    const base = { levelVmin: 0.6, levelVmax: 1.36, tankHeight: H, levelOffset: 0 };
    const invalid = [{ depthM: 0, volts: 0.6 }, { depthM: 0.5, volts: 0.5 }, { depthM: 0.9, volts: 1.36 }];
    for (const v of [0.4, 0.6, 0.75, 0.96, 1.2, 1.36, 2]) {
      const expected = oldPercent(v, 0.6, 1.36, H);
      expect(levelPercentFromVoltage(v, base)).toBe(expected);
      expect(levelPercentFromVoltage(v, { ...base, levelCalPoints: null })).toBe(expected);
      expect(levelPercentFromVoltage(v, { ...base, levelCalPoints: [] })).toBe(expected);
      expect(levelPercentFromVoltage(v, { ...base, levelCalPoints: invalid })).toBe(expected);
    }
    expect(effectiveLevelCalPoints({ ...base, levelCalPoints: invalid }).usesTable).toBe(false);
    expect(effectiveLevelCalPoints({ ...base, levelCalPoints: drum }).usesTable).toBe(true);
  });
});

describe('validateLevelCalPoints', () => {
  it('accepts a valid table', () => {
    expect(validateLevelCalPoints(drum, H)).toEqual([]);
    expect(validateLevelCalPoints([{ depthM: 0, volts: 0.6 }, { depthM: 0.9, volts: 1.36 }], H)).toEqual([]);
  });

  it('accepts a last depth within 5 mm of the tank height', () => {
    const t = [{ depthM: 0, volts: 0.6 }, { depthM: 0.904, volts: 1.36 }];
    expect(validateLevelCalPoints(t, H)).toEqual([]);
  });

  it('needs 2 to 20 points', () => {
    expect(validateLevelCalPoints([{ depthM: 0, volts: 0.6 }], H).join(' ')).toMatch(/at least 2/);
    expect(validateLevelCalPoints([], H).join(' ')).toMatch(/at least 2/);
    const many = Array.from({ length: 21 }, (_, i) => ({ depthM: (i * H) / 20, volts: 0.6 + i * 0.05 }));
    expect(validateLevelCalPoints(many, H).join(' ')).toMatch(/at most 20/);
    expect(validateLevelCalPoints(many.slice(0, 20).map((p, i) => ({ ...p, depthM: (i * H) / 19 })), H)).toEqual([]);
  });

  it('needs depths strictly increasing from 0 to the tank height', () => {
    expect(validateLevelCalPoints([{ depthM: 0.05, volts: 0.6 }, { depthM: 0.9, volts: 1.36 }], H).join(' '))
      .toMatch(/first depth must be 0/);
    expect(validateLevelCalPoints([{ depthM: 0, volts: 0.6 }, { depthM: 0.8, volts: 1.36 }], H).join(' '))
      .toMatch(/must equal the tank height/);
    const equal = [{ depthM: 0, volts: 0.6 }, { depthM: 0.3, volts: 0.8 }, { depthM: 0.3, volts: 0.9 }, { depthM: 0.9, volts: 1.36 }];
    expect(validateLevelCalPoints(equal, H).join(' ')).toMatch(/Row 3: depth must be greater/);
    const down = [{ depthM: 0, volts: 0.6 }, { depthM: 0.5, volts: 0.8 }, { depthM: 0.4, volts: 0.9 }, { depthM: 0.9, volts: 1.36 }];
    expect(validateLevelCalPoints(down, H).join(' ')).toMatch(/Row 3: depth must be greater/);
  });

  it('needs voltages strictly increasing and inside the valid sensor range', () => {
    const flat = [{ depthM: 0, volts: 0.6 }, { depthM: 0.4, volts: 0.9 }, { depthM: 0.9, volts: 0.9 }];
    expect(validateLevelCalPoints(flat, H).join(' ')).toMatch(/Row 3: voltage must be greater/);
    expect(validateLevelCalPoints([{ depthM: 0, volts: 0.2 }, { depthM: 0.9, volts: 1.36 }], H).join(' '))
      .toMatch(/Row 1: voltage must be between/);
    expect(validateLevelCalPoints([{ depthM: 0, volts: 0.6 }, { depthM: 0.9, volts: 3.3 }], H).join(' '))
      .toMatch(/Row 2: voltage must be between/);
  });

  it('rejects numbers that are not numbers and a missing tank height', () => {
    expect(validateLevelCalPoints([{ depthM: 0, volts: NaN }, { depthM: 0.9, volts: 1.36 }], H).join(' '))
      .toMatch(/Row 1: voltage is not a number/);
    expect(validateLevelCalPoints([{ depthM: Number.NaN, volts: 0.6 }, { depthM: 0.9, volts: 1.36 }], H).join(' '))
      .toMatch(/Row 1: depth is not a number/);
    expect(validateLevelCalPoints(drum, 0).join(' ')).toMatch(/tank height/);
  });
});

describe('parseLevelCalPoints', () => {
  it('reads an array or the object form the database may return', () => {
    expect(parseLevelCalPoints(drum)).toEqual(drum);
    expect(parseLevelCalPoints({ 1: drum[1], 0: drum[0], 2: drum[2], 3: drum[3] })).toEqual(drum);
  });

  it('returns null for nothing or a malformed list', () => {
    expect(parseLevelCalPoints(undefined)).toBeNull();
    expect(parseLevelCalPoints(null)).toBeNull();
    expect(parseLevelCalPoints([])).toBeNull();
    expect(parseLevelCalPoints('x')).toBeNull();
    expect(parseLevelCalPoints([{ depthM: 0 }])).toBeNull();
    expect(parseLevelCalPoints([{ depthM: '0', volts: 0.6 }])).toBeNull();
  });
});
