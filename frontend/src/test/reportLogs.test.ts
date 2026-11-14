import { describe, it, expect } from 'vitest';
import type { Log } from '@/store/useStore';
import {
  alertStartCategory,
  countAlertStarts,
  esp32LogTankId,
  isPumpRun,
  logBelongsToTank,
  reportWindowStart,
} from '@/lib/reportLogs';

const log = (action: string, details: string, performedBy = 'ESP32 System', logLevel: Log['logLevel'] = 'INFO'): Log => ({
  id: `${action}-${details}`,
  action,
  details,
  performedBy,
  logLevel,
  timestamp: 0,
});

const tank1 = { id: '1', name: 'Reservoir Tank No. 1' };
const tank2 = { id: '2', name: 'Reservoir Tank No. 2' };

describe('Reports log rules', () => {
  it('counts one incident per alert: Triggered only, not Persistent or Recovered', () => {
    const logs = [
      log('Low Water Level Alert', 'Water level at 12% [Status: Triggered]', 'ESP32 System', 'CRITICAL'),
      log('Low Water Level Alert', 'Water level at 11% [Status: Persistent]', 'ESP32 System', 'CRITICAL'),
      log('Low Water Level Alert', 'Water level at 18% [Status: Recovered]'),
      log('High Water Level Alert', 'Water level at 97% [Status: Triggered]', 'ESP32 System', 'WARNING'),
      log('Unsafe pH Level Alert', 'pH 5.9 [Status: Triggered]', 'ESP32 System', 'CRITICAL'),
    ];
    const counts = countAlertStarts(logs);
    expect(counts['Low Water Level']).toBe(1);
    expect(counts['High Water Level']).toBe(1);
    expect(counts['Unsafe pH Level']).toBe(1);
  });

  it('does not count settings changes that mention overflow or low level as alerts', () => {
    const logs = [
      log('Configuration Updated', 'Updated system thresholds: Overflow (95% -> 90%)', 'Admin'),
      log('Configuration Updated', 'Updated system thresholds: Low Level (15% -> 20%)', 'Admin'),
      log('Alert Acknowledged', 'High Water Level alert for Tank 1 acknowledged', 'Admin'),
    ];
    expect(Object.values(countAlertStarts(logs)).every(v => v === 0)).toBe(true);
  });

  it('classifies sensor faults and network failures', () => {
    expect(alertStartCategory(log('Sensor Fault', 'Water Level Sensor FAULT!', 'ESP32 System', 'CRITICAL'))).toBe('Sensor Faults');
    expect(alertStartCategory(log('Network Alert', 'Ethernet connection unexpectedly disconnected', 'ESP32 System', 'CRITICAL'))).toBe('Network Failures');
    expect(alertStartCategory(log('CONTROLLER_OFFLINE', 'Controller for Reservoir Tank No. 1 went offline', 'Alert Service', 'WARNING'))).toBe('Network Failures');
    expect(alertStartCategory(log('Network Recovery', 'WiFi backup connection established successfully.'))).toBeNull();
  });

  it('counts only real pump starts', () => {
    expect(isPumpRun(log('Pump Controller', 'Pump started automatically. Water level: 14%'))).toBe(true);
    expect(isPumpRun(log('Pump Controller', 'Manual pump ON command accepted. Water level: 40%'))).toBe(true);
    expect(isPumpRun(log('Pump Controller', 'Manual pump ON command refused: Maintenance mode is active.'))).toBe(false);
    expect(isPumpRun(log('Pump Controller', 'Pump stopped automatically. Water level: 95%'))).toBe(false);
    expect(isPumpRun(log('PUMP_ON', 'Pump for Tank 1 was turned ON', 'Admin'))).toBe(false);
  });

  it('assigns ESP32 entries to the firmware tank and offline entries by tank name', () => {
    const esp = log('Sensor Fault', 'pH Sensor FAULT!');
    expect(logBelongsToTank(esp, tank1)).toBe(true);
    expect(logBelongsToTank(esp, tank2)).toBe(false);

    const offline2 = log('CONTROLLER_OFFLINE', 'Controller for Reservoir Tank No. 2 went offline', 'Alert Service');
    expect(logBelongsToTank(offline2, tank1)).toBe(false);
    expect(logBelongsToTank(offline2, tank2)).toBe(true);

    const config = log('Configuration Updated', 'Updated system thresholds', 'Admin');
    expect(logBelongsToTank(config, tank2)).toBe(true);
  });

  it('routes ESP32 entries to the tank in their tankId, and entries without one to Tank 1', () => {
    const tank3 = { id: '3', name: 'Reservoir Tank No. 3' };
    const tank4 = { id: '4', name: 'Reservoir Tank No. 4' };
    const tanks = [tank1, tank2, tank3, tank4];
    const owners = (entry: Log) => tanks.filter(t => logBelongsToTank(entry, t)).map(t => t.id);

    const fromTank3: Log = { ...log('Sensor Fault', 'Water Level Sensor FAULT!'), tankId: '3' };
    expect(owners(fromTank3)).toEqual(['3']);
    expect(esp32LogTankId(fromTank3)).toBe('3');

    const fromTank2: Log = { ...log('Low Water Level Alert', 'Water level at 12% [Status: Triggered]'), tankId: '2' };
    expect(owners(fromTank2)).toEqual(['2']);
    expect(countAlertStarts([fromTank2].filter(l => logBelongsToTank(l, tank2)))['Low Water Level']).toBe(1);
    expect(countAlertStarts([fromTank2].filter(l => logBelongsToTank(l, tank1)))['Low Water Level']).toBe(0);

    const explicitTank1: Log = { ...log('Pump Controller', 'Pump started automatically. Water level: 14%'), tankId: '1' };
    expect(owners(explicitTank1)).toEqual(['1']);

    // Old logs and the Tank 1 firmware send no tankId (or a blank one): they stay with Tank 1
    expect(owners(log('Network Alert', 'Ethernet connection unexpectedly disconnected'))).toEqual(['1']);
    expect(owners({ ...log('Network Alert', 'WiFi lost'), tankId: '  ' })).toEqual(['1']);
  });

  it('starts the report window at midnight the given number of days ago', () => {
    const now = new Date(2026, 10, 13, 15, 30).getTime();
    expect(reportWindowStart(7, now)).toBe(new Date(2026, 10, 6, 0, 0, 0, 0).getTime());
  });
});
