import { describe, it, expect } from 'vitest';
import { groupNotifications, FLAP_WINDOW_MS } from '@/lib/notificationGroups';
import type { Notification } from '@/store/useStore';

const n = (id: string, title: string, timestamp: number, tankId = '1'): Notification => ({
  id, title, message: title, type: title === 'Controller Offline' ? 'danger' : 'info', timestamp, read: false, tankId,
});

describe('groupNotifications', () => {
  it('collapses offline/online flaps from one tank within 60 s into one entry', () => {
    const list = [
      n('a', 'Controller Back Online', 100_000),
      n('b', 'Controller Offline', 80_000),
      n('c', 'Controller Back Online', 50_000),
      n('d', 'Controller Offline', 10_000),
    ];
    const groups = groupNotifications(list);
    expect(groups).toHaveLength(1);
    expect(groups[0].latest.id).toBe('a');
    expect(groups[0].members.map((m) => m.id)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('starts a new group after a gap longer than the window', () => {
    const list = [
      n('a', 'Controller Back Online', 200_000),
      n('b', 'Controller Offline', 200_000 - FLAP_WINDOW_MS - 1),
    ];
    expect(groupNotifications(list)).toHaveLength(2);
  });

  it('keeps tanks apart and leaves other alerts untouched, in order', () => {
    const list = [
      n('a', 'Controller Offline', 100_000, '1'),
      n('x', 'Low Water Level', 95_000, '1'),
      n('b', 'Controller Offline', 90_000, '2'),
      n('c', 'Controller Back Online', 80_000, '1'),
    ];
    const groups = groupNotifications(list);
    expect(groups.map((g) => g.key)).toEqual(['a', 'x', 'b']);
    expect(groups[0].members.map((m) => m.id)).toEqual(['a', 'c']);
  });
});
