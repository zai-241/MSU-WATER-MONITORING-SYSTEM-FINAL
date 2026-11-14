/**
 * Collapses a flapping controller connection into one notification entry.
 *
 * When a controller's link drops and returns repeatedly, the list fills with
 * "Controller Offline" / "Controller Back Online" pairs. Entries of those two kinds
 * from the same tank are grouped while each one follows the previous within
 * FLAP_WINDOW_MS. Every other notification stays on its own.
 */
import type { Notification } from '@/store/useStore';

export const FLAP_WINDOW_MS = 60_000;
export const CONNECTION_TITLES = new Set(['Controller Offline', 'Controller Back Online']);

export interface NotificationGroup {
  /** Stable key: the id of the newest member */
  key: string;
  /** Newest member; its title, message and time are shown */
  latest: Notification;
  /** All members, newest first */
  members: Notification[];
}

const isConnectionEvent = (n: Notification) => CONNECTION_TITLES.has(n.title);

/** Groups a list sorted newest first. The result keeps that order. */
export function groupNotifications(list: Notification[]): NotificationGroup[] {
  const groups: NotificationGroup[] = [];
  const open = new Map<string, NotificationGroup>(); // tankId -> group still accepting older members

  for (const n of list) {
    if (!isConnectionEvent(n)) {
      groups.push({ key: n.id, latest: n, members: [n] });
      continue;
    }
    const tank = n.tankId ?? '';
    const group = open.get(tank);
    const oldest = group?.members[group.members.length - 1];
    if (group && oldest && oldest.timestamp - n.timestamp <= FLAP_WINDOW_MS) {
      group.members.push(n);
    } else {
      const fresh = { key: n.id, latest: n, members: [n] };
      groups.push(fresh);
      open.set(tank, fresh);
    }
  }
  return groups;
}
