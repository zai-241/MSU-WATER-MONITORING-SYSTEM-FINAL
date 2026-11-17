import { describe, it, expect } from 'vitest';
import { isLevelSampleFaulty, isPhSampleFaulty } from '@/hooks/useTankHistory';
import { sensorStatusLabel } from '@/lib/reportExport';

describe('history samples recorded during a sensor fault', () => {
  it('marks a sample faulty from the new health flags, keeping its value', () => {
    expect(isLevelSampleFaulty({ waterLevel: 12, levelSensorOk: false })).toBe(true);
    expect(isPhSampleFaulty({ phLevel: 3.1, phSensorOk: false })).toBe(true);
  });

  it('still marks old null samples (older firmware) as faulty', () => {
    expect(isLevelSampleFaulty({ waterLevel: null, levelSensorOk: true })).toBe(true);
    expect(isPhSampleFaulty({ phLevel: null, phSensorOk: true })).toBe(true);
  });

  it('treats a healthy sample as normal', () => {
    expect(isLevelSampleFaulty({ waterLevel: 50, levelSensorOk: true })).toBe(false);
    expect(isPhSampleFaulty({ phLevel: 7.2, phSensorOk: true })).toBe(false);
  });

  it('labels the report status column from the fault flags', () => {
    expect(sensorStatusLabel({ levelFault: true, phFault: true })).toBe('Both Faulty');
    expect(sensorStatusLabel({ levelFault: true, phFault: false })).toBe('Level Fault');
    expect(sensorStatusLabel({ levelFault: false, phFault: true })).toBe('pH Fault');
    expect(sensorStatusLabel({ levelFault: false, phFault: false })).toBe('Normal');
  });
});
