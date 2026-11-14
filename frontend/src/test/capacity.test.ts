import { describe, it, expect } from 'vitest';
import { DEFAULT_TANK_CAPACITY_LITERS, estimateVolumeLiters, tankCapacityLiters } from '@/lib/constants';
import { sanitizeTank } from '@/store/useStore';

describe('Per-tank capacity', () => {
  it('defaults to 200 L (Tank 1) when a tank has no valid capacity', () => {
    expect(DEFAULT_TANK_CAPACITY_LITERS).toBe(200);
    expect(tankCapacityLiters({})).toBe(200);
    expect(tankCapacityLiters(null)).toBe(200);
    expect(tankCapacityLiters({ capacityLiters: 0 })).toBe(200);
    expect(tankCapacityLiters({ capacityLiters: Number.NaN })).toBe(200);
    expect(tankCapacityLiters({ capacityLiters: 1500 })).toBe(1500);
  });

  it('estimates the stored volume from the level and the tank capacity', () => {
    expect(estimateVolumeLiters(50)).toBe(100);
    expect(estimateVolumeLiters(75, 200)).toBe(150);
    expect(estimateVolumeLiters(40, 1500)).toBe(600);
  });

  it('keeps each tank\'s own capacity when reading from the database', () => {
    expect(sanitizeTank('1', { name: 'Reservoir Tank 1' }).capacityLiters).toBe(200);
    expect(sanitizeTank('3', { name: 'Reservoir Tank 3', capacityLiters: 1000 }).capacityLiters).toBe(1000);
    expect(sanitizeTank('4', { name: 'Reservoir Tank 4', capacityLiters: 'big' }).capacityLiters).toBe(200);
  });
});
