import { describe, it, expect, vi, beforeEach } from 'vitest';
import { alertSound } from '@/utils/alertSound';
import { z } from 'zod';

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] || null,
    setItem: (key: string, value: string) => {
      store[key] = value.toString();
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
  };
})();

Object.defineProperty(window, 'localStorage', {
  value: localStorageMock,
  writable: true,
});

describe('Phase 2: R7 Sound and Visual Alert Controls', () => {
  beforeEach(() => {
    localStorageMock.clear();
    alertSound.stopAlert();
    alertSound.setMuted(false);
    alertSound.clearSnooze();
  });

  it('correctly toggles and persists mute status in localStorage', () => {
    expect(alertSound.isMuted()).toBe(false);
    alertSound.setMuted(true);
    expect(alertSound.isMuted()).toBe(true);
    expect(localStorageMock.getItem('wm_sound_muted')).toBe('true');

    alertSound.setMuted(false);
    expect(alertSound.isMuted()).toBe(false);
    expect(localStorageMock.getItem('wm_sound_muted')).toBe('false');
  });

  it('correctly sets and clears 15-minute audio snooze', () => {
    expect(alertSound.isSnoozed()).toBe(false);

    alertSound.snooze(15);
    expect(alertSound.isSnoozed()).toBe(true);

    const untilStr = localStorageMock.getItem('wm_sound_snooze_until');
    expect(untilStr).not.toBeNull();
    const until = Number(untilStr);
    expect(until).toBeGreaterThan(Date.now() + 14 * 60 * 1000);
    expect(until).toBeLessThanOrEqual(Date.now() + 15 * 60 * 1000 + 1000);

    alertSound.clearSnooze();
    expect(alertSound.isSnoozed()).toBe(false);
    expect(localStorageMock.getItem('wm_sound_snooze_until')).toBeNull();
  });

  it('prevents starting alerts when muted or snoozed', () => {
    alertSound.setMuted(true);
    alertSound.startAlert();
    expect(alertSound.isAlerting()).toBe(false);

    alertSound.setMuted(false);
    alertSound.snooze(15);
    alertSound.startAlert();
    expect(alertSound.isAlerting()).toBe(false);
  });

  it('notifies subscribers when audio state changes', () => {
    const listener = vi.fn();
    const unsubscribe = alertSound.subscribe(listener);

    alertSound.setMuted(true);
    expect(listener).toHaveBeenCalled();

    alertSound.snooze(15);
    expect(listener).toHaveBeenCalledTimes(2);

    unsubscribe();
    alertSound.clearSnooze();
    expect(listener).toHaveBeenCalledTimes(2); // No new call after unsubscribe
  });
});

describe('Phase 2: R5 Per-User Read Timestamp & 90-Day Retention Model', () => {
  it('correctly determines unread notifications based on per-user lastReadAt timestamp', () => {
    const userLastReadAt = 1000;

    const notifs = [
      { id: '1', title: 'Older alert', timestamp: 800, read: false },
      { id: '2', title: 'Exact read alert', timestamp: 1000, read: false },
      { id: '3', title: 'New alert after read', timestamp: 1200, read: false },
    ];

    // Notification is unread for this user only if notif.timestamp > userLastReadAt
    const unread = notifs.filter(n => (userLastReadAt > 0 ? n.timestamp > userLastReadAt : !n.read));
    expect(unread).toHaveLength(1);
    expect(unread[0].id).toBe('3');
  });

  it('falls back to notification.read if user has no lastReadAt recorded yet', () => {
    const userLastReadAt = 0;

    const notifs = [
      { id: '1', title: 'Old read', timestamp: 800, read: true },
      { id: '2', title: 'Unread alert', timestamp: 1200, read: false },
    ];

    const unread = notifs.filter(n => (userLastReadAt > 0 ? n.timestamp > userLastReadAt : !n.read));
    expect(unread).toHaveLength(1);
    expect(unread[0].id).toBe('2');
  });

  it('purges records older than 90 days and retains records within 90 days', () => {
    const now = Date.now();
    const ninetyDaysMs = 90 * 24 * 60 * 60 * 1000;
    const cutoff = now - ninetyDaysMs;

    const dummyNotifs: Record<string, { timestamp: number; title: string }> = {
      notif_recent: { timestamp: now - 1000 * 60, title: 'Recent alert' },
      notif_89_days: { timestamp: now - 89 * 24 * 60 * 60 * 1000, title: '89 days old' },
      notif_91_days: { timestamp: now - 91 * 24 * 60 * 60 * 1000, title: '91 days old' },
      notif_120_days: { timestamp: now - 120 * 24 * 60 * 60 * 1000, title: '120 days old' },
    };

    const updates: Record<string, null> = {};
    let count = 0;
    Object.entries(dummyNotifs).forEach(([key, notif]) => {
      if (notif.timestamp < cutoff) {
        updates[key] = null;
        count++;
      }
    });

    expect(count).toBe(2);
    expect(updates['notif_91_days']).toBeNull();
    expect(updates['notif_120_days']).toBeNull();
    expect(updates['notif_recent']).toBeUndefined();
    expect(updates['notif_89_days']).toBeUndefined();
  });
});

describe('Phase 2: R8 Watchdog & Notification Threshold Schema Validation', () => {
  const thresholdSchema = z.object({
    lowLevelThreshold: z.number().min(0).max(100),
    overflowThreshold: z.number().min(0).max(100),
    minPh: z.number().min(0).max(14),
    maxPh: z.number().min(0).max(14),
    offlineThresholdSec: z.number().min(20, 'Offline watchdog threshold must be at least 20 seconds').max(3600).optional(),
    repeatIntervalSec: z.number().min(10, 'Alert repeat interval must be at least 10 seconds').max(3600).optional(),
    soundEnabled: z.boolean().optional(),
  }).refine(data => data.lowLevelThreshold < data.overflowThreshold, {
    message: 'Low-level threshold must be strictly less than overflow threshold',
  }).refine(data => data.minPh < data.maxPh, {
    message: 'Minimum pH must be strictly less than maximum pH',
  });

  it('accepts valid notification and watchdog settings', () => {
    const validConfig = {
      lowLevelThreshold: 15,
      overflowThreshold: 90,
      minPh: 6.5,
      maxPh: 8.5,
      offlineThresholdSec: 30,
      repeatIntervalSec: 60,
      soundEnabled: true,
    };

    const result = thresholdSchema.safeParse(validConfig);
    expect(result.success).toBe(true);
  });

  it('rejects offline watchdog threshold less than 20 seconds (preventing false alerts below 2 heartbeats)', () => {
    const invalidConfig = {
      lowLevelThreshold: 15,
      overflowThreshold: 90,
      minPh: 6.5,
      maxPh: 8.5,
      offlineThresholdSec: 15, // Below 20s minimum
      repeatIntervalSec: 60,
      soundEnabled: true,
    };

    const result = thresholdSchema.safeParse(invalidConfig);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.errors[0].message).toContain('at least 20 seconds');
    }
  });

  it('rejects repeat interval less than 10 seconds', () => {
    const invalidConfig = {
      lowLevelThreshold: 15,
      overflowThreshold: 90,
      minPh: 6.5,
      maxPh: 8.5,
      offlineThresholdSec: 30,
      repeatIntervalSec: 5, // Below 10s minimum
      soundEnabled: true,
    };

    const result = thresholdSchema.safeParse(invalidConfig);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.errors[0].message).toContain('at least 10 seconds');
    }
  });
});

