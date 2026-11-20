/**
 * Constants and labels for the Reports page (kept apart from ReportParts.tsx, which exports only components).
 */
import type { PumpEvent } from '@/lib/reportLogs';

export const PIE_COLORS = ['#ef4444', '#f59e0b', '#a855f7', '#f97316', '#3b82f6'];

export const PUMP_LOG_PAGE_SIZE = 10;

/** "Zailanor Pundato - ADMIN"; just the name for entries written before the role was saved. */
export function pumpActorLabel(event: PumpEvent): string {
  return event.role ? `${event.actor} - ${event.role.toUpperCase()}` : event.actor;
}

export const PUMP_RESULT_STYLE: Record<PumpEvent['result'], { label: string; className: string }> = {
  automatic: { label: 'Automatic', className: 'text-blue-500 bg-blue-500/10 border-blue-500/20' },
  accepted: { label: 'Accepted', className: 'text-safe bg-safe/10 border-safe/20' },
  refused: { label: 'Refused', className: 'text-danger bg-danger/10 border-danger/20' },
  unconfirmed: { label: 'No reply', className: 'text-warning bg-warning/10 border-warning/20' },
};
