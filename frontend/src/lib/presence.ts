/**
 * Online / offline status of users (Admin Panel → User Management).
 *
 * Every signed-in browser tab or APK adds one entry under /presence/{uid}/connections while its
 * database connection is up. The database server removes that entry by itself when the
 * connection drops (tab or app closed, phone offline) and writes /presence/{uid}/lastSeen, so a
 * user is online while at least one entry exists. Signing out removes the entry first, because
 * signing out does not close the database connection.
 */
import { useEffect, useState } from 'react';
import {
  ref,
  onValue,
  push,
  set,
  remove,
  onDisconnect,
  serverTimestamp,
  type DatabaseReference,
} from 'firebase/database';
import { Capacitor } from '@capacitor/core';
import { database } from '@/config/firebase';

export interface PresenceConnection {
  /** Server time (ms) the connection came online */
  since?: number;
  /** "web" or "android" */
  app?: string;
}

export interface PresenceRecord {
  connections?: Record<string, PresenceConnection>;
  /** Server time (ms) the user's last connection closed */
  lastSeen?: number;
}

export interface PresenceStatus {
  online: boolean;
  /** Open connections (tabs and phones) */
  devices: number;
  /** Apps the user is online on, e.g. ["web", "android"] */
  apps: string[];
  /** Server time (ms) the user was last online; null if never recorded */
  lastSeen: number | null;
}

export function presenceStatus(record: PresenceRecord | null | undefined): PresenceStatus {
  const connections = Object.values(record?.connections ?? {}).filter(c => c && typeof c === 'object');
  const apps = [...new Set(connections.map(c => (c.app === 'android' ? 'android' : 'web')))].sort();
  return {
    online: connections.length > 0,
    devices: connections.length,
    apps,
    lastSeen: typeof record?.lastSeen === 'number' ? record.lastSeen : null,
  };
}

/** "Last seen just now", "5 min ago", "3 h ago", "2 days ago", or "Never seen online". */
export function lastSeenLabel(lastSeen: number | null, serverNow: number): string {
  if (!lastSeen) return 'Never seen online';
  const sec = Math.max(0, Math.round((serverNow - lastSeen) / 1000));
  if (sec < 60) return 'Last seen just now';
  const min = Math.floor(sec / 60);
  if (min < 60) return `Last seen ${min} min ago`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return `Last seen ${hours} h ago`;
  const days = Math.floor(hours / 24);
  return `Last seen ${days} day${days === 1 ? '' : 's'} ago`;
}

const appName = (): string => {
  try {
    return Capacitor.isNativePlatform() ? 'android' : 'web';
  } catch {
    return 'web';
  }
};

/**
 * Marks this tab or app as online for `uid` until the returned function is called (await it
 * before signing out). Reconnects are handled: each new connection adds a fresh entry.
 */
export function startPresence(uid: string): () => Promise<void> {
  const lastSeenRef = ref(database, `presence/${uid}/lastSeen`);
  let current: DatabaseReference | null = null;
  let stopped = false;

  const unsubscribe = onValue(ref(database, '.info/connected'), (snap) => {
    if (snap.val() !== true || stopped) return;
    const connection = push(ref(database, `presence/${uid}/connections`));
    current = connection;
    // Queue the server-side cleanup first, so the entry can never outlive the connection
    Promise.all([onDisconnect(connection).remove(), onDisconnect(lastSeenRef).set(serverTimestamp())])
      .then(() => (stopped ? undefined : set(connection, { since: serverTimestamp(), app: appName() })))
      .catch(() => { /* offline or not permitted: the status simply stays offline */ });
  });

  return async () => {
    stopped = true;
    unsubscribe();
    const connection = current;
    current = null;
    if (!connection) return;
    try {
      await onDisconnect(connection).cancel();
      await onDisconnect(lastSeenRef).cancel();
      await remove(connection);
      await set(lastSeenRef, serverTimestamp());
    } catch {
      /* the server removes the entry when the connection closes anyway */
    }
  };
}

/** Live presence of every user (admins only; the rules refuse anyone else). */
export function usePresence(enabled: boolean): Record<string, PresenceStatus> {
  const [statuses, setStatuses] = useState<Record<string, PresenceStatus>>({});
  useEffect(() => {
    if (!enabled) return;
    try {
      return onValue(
        ref(database, 'presence'),
        (snap) => {
          const data = (snap.val() ?? {}) as Record<string, PresenceRecord>;
          setStatuses(Object.fromEntries(Object.entries(data).map(([uid, record]) => [uid, presenceStatus(record)])));
        },
        () => setStatuses({}),
      );
    } catch {
      return undefined;
    }
  }, [enabled]);
  return statuses;
}
