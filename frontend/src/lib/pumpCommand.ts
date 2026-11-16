/**
 * Pump command feedback for the dashboard.
 *
 * The web app sends a pump command by writing tanks/{id}/pumpOn. The controller
 * picks it up on its next poll (about 1 s) and acknowledges it by writing
 * pumpCommandAt (server time) and pumpCommandResult ("accepted" or
 * "refused-<reason>"). While a command waits for that acknowledgment the pump
 * toggle shows a spinner; a change of pumpCommandAt ends the wait.
 */
import { PUMP_COMMAND_TIMEOUT_MS } from '@/lib/constants';

export interface PendingPumpCommand {
  /** The pump state that was requested */
  requested: boolean;
  /** tanks/{id}/pumpCommandAt when the command was sent (the wait ends when it changes) */
  ackBefore: number | undefined;
  /** Local time (Date.now()) when the command was sent */
  sentAt: number;
}

export type PumpCommandOutcomeKind = 'accepted' | 'refused' | 'timeout' | 'error';

export interface PumpCommandOutcome {
  kind: PumpCommandOutcomeKind;
  message: string;
}

const REFUSAL_REASONS: Record<string, string> = {
  'refused-demo-off': 'Pump Demo Mode is off',
  'refused-overflow': 'the water level is at or above the overflow threshold',
  'refused-maintenance': 'maintenance mode is on',
  'refused-lock': 'the pump control lock is on',
  'refused-level-sensor': 'the water level sensor is faulty',
};

/** Text for a controller result such as "refused-maintenance". */
export function describePumpCommandResult(result: string | undefined, requested: boolean): PumpCommandOutcome {
  if (result === 'accepted') {
    return { kind: 'accepted', message: `Pump turned ${requested ? 'ON' : 'OFF'}.` };
  }
  const reason = (result && REFUSAL_REASONS[result]) || 'the controller refused the command';
  return { kind: 'refused', message: `Refused: ${reason}.` };
}

/**
 * The outcome of a pending command, or null while it is still waiting.
 * `now` is local time (Date.now()).
 */
export function resolvePumpCommand(
  pending: PendingPumpCommand,
  tank: { pumpCommandAt?: number; pumpCommandResult?: string } | undefined,
  now: number,
): PumpCommandOutcome | null {
  const ackAt = tank?.pumpCommandAt;
  if (typeof ackAt === 'number' && ackAt !== pending.ackBefore) {
    return describePumpCommandResult(tank?.pumpCommandResult, pending.requested);
  }
  if (now - pending.sentAt >= PUMP_COMMAND_TIMEOUT_MS) {
    return {
      kind: 'timeout',
      message: 'No response from the controller yet. Check that it is online, and see Logs.',
    };
  }
  return null;
}
