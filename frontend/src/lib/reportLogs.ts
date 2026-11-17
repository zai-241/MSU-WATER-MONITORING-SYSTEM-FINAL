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
import type { GroupedTelemetryPoint } from '@/hooks/useTankHistory';

export const ALERT_CATEGORIES = [
  'Low Water Level',
  'High Water Level',
  'Unsafe pH Level',
  'Sensor Faults',
  'Network Failures',
] as const;

export type AlertCategory = typeof ALERT_CATEGORIES[number];

/**
 * Tank for ESP32 entries that carry no tankId: the Tank 1 firmware (esp32_firmware.ino)
 * and every log written before the Tank 2–4 controllers existed.
 */
export const FIRMWARE_TANK_ID = '1';

/** The tank an ESP32 log entry came from: its tankId, or Tank 1 when it has none. */
export function esp32LogTankId(log: Pick<Log, 'tankId'>): string {
  const id = log.tankId != null ? String(log.tankId).trim() : '';
  return id || FIRMWARE_TANK_ID;
}

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
 * True when the entry is about this tank. ESP32 entries belong to the tank in their tankId
 * (Tank 1 when absent); controller offline/recovery entries name the tank in their details.
 * Other entries (settings, users) are system-wide and count for every tank.
 */
export function logBelongsToTank(log: Log, tank: Pick<Tank, 'id' | 'name'>): boolean {
  if (log.performedBy === ESP32_PERFORMER) return tank.id === esp32LogTankId(log);
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

// --- Problem counts per table row (Printable Telemetry Log Table) -----------------------

export type ProblemKind = 'levelFault' | 'phFault' | 'offline' | 'other';
export type ProblemCounts = Record<ProblemKind, number>;

export const emptyProblemCounts = (): ProblemCounts => ({ levelFault: 0, phFault: 0, offline: 0, other: 0 });

/**
 * Which problem column a log entry counts in, or null when it is not the start of a problem.
 * - levelFault / phFault: the ESP32 "Sensor Fault" entry (logged once when a fault starts)
 * - offline: CONTROLLER_OFFLINE (once per outage)
 * - other: every other alert start (low / high level, unsafe pH, network alerts)
 */
export function problemKind(log: Log): ProblemKind | null {
  if (log.action === 'Sensor Fault') {
    const d = (log.details ?? '').toLowerCase();
    if (d.startsWith('water level sensor') || d.startsWith('level sensor')) return 'levelFault';
    if (d.startsWith('ph sensor')) return 'phFault';
    return 'other';
  }
  if (log.action === 'CONTROLLER_OFFLINE') return 'offline';
  return alertStartCategory(log) ? 'other' : null;
}

/**
 * One row of the Printable Telemetry Log Table and of the exports: telemetry averages plus
 * the problems that started in that period. `hasSamples` is false for a period that only has
 * problems (no readings, e.g. the controller was offline). Missing fields count as a row
 * with samples and no problems.
 */
export type TelemetryTableRow = GroupedTelemetryPoint & { hasSamples?: boolean; problems?: ProblemCounts };

/** Column headers for the four problem counts, in table order (Excel, CSV). */
export const PROBLEM_COLUMNS: { key: ProblemKind; header: string }[] = [
  { key: 'levelFault', header: 'Level Sensor Fault' },
  { key: 'phFault', header: 'pH Sensor Fault' },
  { key: 'offline', header: 'Controller Offline' },
  { key: 'other', header: 'Other Problems' },
];

/** Problem counts per period; `periodStart` maps a timestamp to the start of its table row. */
export function countProblemsByPeriod(logs: Log[], periodStart: (timestamp: number) => number): Map<number, ProblemCounts> {
  const byPeriod = new Map<number, ProblemCounts>();
  for (const log of logs) {
    const kind = problemKind(log);
    if (!kind) continue;
    const key = periodStart(log.timestamp);
    const counts = byPeriod.get(key) ?? emptyProblemCounts();
    counts[kind]++;
    byPeriod.set(key, counts);
  }
  return byPeriod;
}

// --- Pump activity log (who turned which pump on or off, and when) ----------------------

/** Dashboard pump commands: written by the user's browser when they confirm the pump toggle. */
const PUMP_REQUEST_ACTIONS = ['PUMP_ON', 'PUMP_OFF'];
/** "Pump for <tank name> was turned ON" (dashboard log text, also on entries without tankId). */
const PUMP_REQUEST_DETAILS = /^Pump for (.+) was turned (ON|OFF)\b/;
/**
 * How far apart a dashboard command and the controller's reply may be logged. The controller
 * reads commands every second and the dashboard gives up after 15 s; both use server time.
 */
export const PUMP_REPLY_WINDOW_MS = 60_000;

export type PumpEventResult = 'automatic' | 'accepted' | 'refused' | 'unconfirmed';

export interface PumpEvent {
  id: string;
  timestamp: number;
  /** Tank (and so pump) the event is about; null when an old entry names an unknown tank */
  tankId: string | null;
  /** Pump state that was requested or set; null when the log does not say (lock refusal) */
  state: 'ON' | 'OFF' | null;
  /** 'user': a dashboard command; 'automatic': the controller's own pump logic */
  source: 'user' | 'automatic';
  /** User name, "Automatic (controller)", or "Unknown user" for a command with no dashboard entry */
  actor: string;
  /** Role of the user at the time (admin / worker); missing on entries written before it was saved */
  role?: string;
  result: PumpEventResult;
  /** Reason or controller message */
  detail: string;
}

/** Text after "Reason: " (automatic stops), or after the first ": " (refusals). */
function pumpReason(details: string): string {
  const reason = details.match(/Reason: (.+)$/);
  if (reason) return reason[1].trim();
  const afterColon = details.indexOf(': ');
  return afterColon >= 0 ? details.slice(afterColon + 2).trim() : details;
}

interface ControllerPumpEntry {
  kind: 'auto' | 'reply';
  state: 'ON' | 'OFF' | null;
  accepted: boolean;
  detail: string;
}

/** Reads one ESP32 "Pump Controller" entry; null for entries that are not pump switching (mode changes). */
function parseControllerPumpEntry(log: Log): ControllerPumpEntry | null {
  if (log.performedBy !== ESP32_PERFORMER || log.action !== 'Pump Controller') return null;
  const d = log.details ?? '';
  if (d.startsWith('Pump started automatically')) {
    return { kind: 'auto', state: 'ON', accepted: true, detail: pumpReason(d) };
  }
  if (d.startsWith('Pump stopped automatically')) {
    return { kind: 'auto', state: 'OFF', accepted: true, detail: pumpReason(d) };
  }
  const accepted = d.match(/^Manual pump (ON|OFF) command accepted/);
  if (accepted) {
    return { kind: 'reply', state: accepted[1] as 'ON' | 'OFF', accepted: true, detail: d };
  }
  const refusedOn = d.match(/^Manual pump (ON|OFF) command refused/);
  if (refusedOn) {
    return { kind: 'reply', state: refusedOn[1] as 'ON' | 'OFF', accepted: false, detail: pumpReason(d) };
  }
  if (d.startsWith('Manual pump toggle refused')) {
    return { kind: 'reply', state: null, accepted: false, detail: pumpReason(d) };
  }
  return null;
}

/**
 * Tank of a dashboard pump command: its tankId, or, for entries written before tankId was
 * saved, the tank whose name appears in "Pump for <name> was turned ...".
 */
export function pumpRequestTankId(log: Log, tanks: Pick<Tank, 'id' | 'name'>[]): string | null {
  const id = log.tankId != null ? String(log.tankId).trim() : '';
  if (id) return id;
  const named = (log.details ?? '').match(PUMP_REQUEST_DETAILS)?.[1];
  if (!named) return null;
  return tanks.find(t => t.name === named)?.id ?? null;
}

/**
 * One row per pump switch: dashboard commands (with who sent them and whether the controller
 * accepted them) and the controller's automatic starts and stops. Newest first.
 */
export function buildPumpEvents(logs: Log[], tanks: Pick<Tank, 'id' | 'name'>[]): PumpEvent[] {
  const requests: PumpEvent[] = [];
  const replies: { log: Log; entry: ControllerPumpEntry; tankId: string }[] = [];
  const events: PumpEvent[] = [];

  for (const log of logs) {
    if (PUMP_REQUEST_ACTIONS.includes(log.action)) {
      requests.push({
        id: log.id,
        timestamp: log.timestamp,
        tankId: pumpRequestTankId(log, tanks),
        state: log.action === 'PUMP_ON' ? 'ON' : 'OFF',
        source: 'user',
        actor: log.performedBy || 'Unknown user',
        ...(log.performedByRole ? { role: log.performedByRole } : {}),
        result: 'unconfirmed',
        detail: 'No reply from the controller was logged.',
      });
      continue;
    }
    const entry = parseControllerPumpEntry(log);
    if (!entry) continue;
    const tankId = esp32LogTankId(log);
    if (entry.kind === 'auto') {
      events.push({
        id: log.id,
        timestamp: log.timestamp,
        tankId,
        state: entry.state,
        source: 'automatic',
        actor: 'Automatic (controller)',
        result: 'automatic',
        detail: entry.detail,
      });
    } else {
      replies.push({ log, entry, tankId });
    }
  }

  // Pair each controller reply with the closest unanswered command for the same tank and state
  const answered = new Set<PumpEvent>();
  replies.sort((a, b) => a.log.timestamp - b.log.timestamp);
  for (const { log, entry, tankId } of replies) {
    let best: PumpEvent | null = null;
    for (const req of requests) {
      if (answered.has(req) || req.tankId !== tankId) continue;
      if (entry.state && req.state !== entry.state) continue;
      const gap = log.timestamp - req.timestamp;
      // The command is logged first; allow a few seconds the other way for clock rounding
      if (gap < -5_000 || gap > PUMP_REPLY_WINDOW_MS) continue;
      if (!best || Math.abs(gap) < Math.abs(log.timestamp - best.timestamp)) best = req;
    }
    if (best) {
      answered.add(best);
      best.result = entry.accepted ? 'accepted' : 'refused';
      best.detail = entry.detail;
    } else {
      // The controller answered a command whose dashboard entry is missing
      events.push({
        id: log.id,
        timestamp: log.timestamp,
        tankId,
        state: entry.state,
        source: 'user',
        actor: 'Unknown user',
        result: entry.accepted ? 'accepted' : 'refused',
        detail: entry.detail,
      });
    }
  }

  return [...requests, ...events].sort((a, b) => b.timestamp - a.timestamp);
}

/** Start of the report window: midnight `days` days ago, matching the per-day charts. */
export function reportWindowStart(days: number, now: number = Date.now()): number {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - days);
  return start.getTime();
}
