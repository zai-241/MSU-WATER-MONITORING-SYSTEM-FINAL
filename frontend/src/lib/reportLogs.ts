/**
 * @file reportLogs.ts
 * @description Rules for reading system logs on the Reports page: which entries are the start
 * of an alert incident, which are pump runs, and which belong to a tank. Kept separate from
 * the page so the rules can be unit-tested.
 *
 * What the system logs:
 * - ESP32 (performedBy "ESP32 System"): one "<Name> Alert" entry with "[Status: Triggered]"
 *   when an alert starts, then "[Status: Persistent]" reminders and "[Status: Recovered]".
 *   Only the Triggered entry is a new incident. Also "Sensor Fault", "Network Alert",
 *   and "Pump Controller" entries.
 * - Alert service / dashboards: "CONTROLLER_OFFLINE" with the tank name in the details.
 * - Users: configuration, calibration, acknowledgment entries. These are never alerts, even
 *   when their text mentions "overflow" or "low level".
 */
import type { Log, Tank } from '@/store/useStore';

export const ALERT_CATEGORIES = [
  'Low Water Level',
  'High Water Level',
  'Unsafe pH Level',
  'Sensor Faults',
  'Network Failures',
] as const;

export type AlertCategory = typeof ALERT_CATEGORIES[number];

/** The tank the ESP32 firmware reports for (TANK_ID in esp32_firmware.ino). */
export const FIRMWARE_TANK_ID = '1';

const ESP32_PERFORMER = 'ESP32 System';
const TRIGGERED = '[Status: Triggered]';

/** The alert category when this log entry starts a new alert incident, otherwise null. */
export function alertStartCategory(log: Log): AlertCategory | null {
  const triggered = log.details?.includes(TRIGGERED) ?? false;
  switch (log.action) {
    case 'Low Water Level Alert':
      return triggered ? 'Low Water Level' : null;
    case 'High Water Level Alert':
      return triggered ? 'High Water Level' : null;
    case 'Unsafe pH Level Alert':
      return triggered ? 'Unsafe pH Level' : null;
    case 'Sensor Fault':
      return 'Sensor Faults';
    case 'Network Alert':
    case 'CONTROLLER_OFFLINE':
      return 'Network Failures';
    default:
      return null;
  }
}

/**
 * True when the controller actually started the pump: automatically at the low threshold,
 * or after accepting a manual ON command. Refused commands and dashboard requests
 * (PUMP_ON, which the controller then logs as accepted or refused) are not counted.
 */
export function isPumpRun(log: Log): boolean {
  return log.action === 'Pump Controller' &&
    (log.details.startsWith('Pump started automatically') ||
      log.details.startsWith('Manual pump ON command accepted'));
}

/**
 * True when the entry is about this tank. ESP32 entries belong to the firmware's tank;
 * controller offline/recovery entries name the tank in their details. Other entries
 * (settings, users) are system-wide and count for every tank.
 */
export function logBelongsToTank(log: Log, tank: Pick<Tank, 'id' | 'name'>): boolean {
  if (log.performedBy === ESP32_PERFORMER) return tank.id === FIRMWARE_TANK_ID;
  if (log.action === 'CONTROLLER_OFFLINE' || log.action === 'CONTROLLER_RECOVERED') {
    return log.details.includes(tank.name);
  }
  return true;
}

/** Number of alert incidents per category among the given entries. */
export function countAlertStarts(logs: Log[]): Record<AlertCategory, number> {
  const counts = Object.fromEntries(ALERT_CATEGORIES.map(c => [c, 0])) as Record<AlertCategory, number>;
  for (const log of logs) {
    const category = alertStartCategory(log);
    if (category) counts[category]++;
  }
  return counts;
}

/** Start of the report window: midnight `days` days ago, matching the per-day charts. */
export function reportWindowStart(days: number, now: number = Date.now()): number {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - days);
  return start.getTime();
}
