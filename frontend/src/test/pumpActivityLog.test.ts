import { describe, it, expect } from 'vitest';
import type { Log } from '@/store/useStore';
import { buildPumpEvents, pumpRequestTankId } from '@/lib/reportLogs';

const tanks = [
  { id: '1', name: 'Reservoir Tank No. 1' },
  { id: '2', name: 'Reservoir Tank No. 2' },
];

let seq = 0;
const entry = (fields: Partial<Log> & Pick<Log, 'action' | 'details' | 'timestamp'>): Log => ({
  id: `log-${++seq}`,
  performedBy: 'ESP32 System',
  logLevel: 'INFO',
  ...fields,
});

const request = (on: boolean, tankName: string, timestamp: number, extra: Partial<Log> = {}) =>
  entry({
    action: on ? 'PUMP_ON' : 'PUMP_OFF',
    details: `Pump for ${tankName} was turned ${on ? 'ON' : 'OFF'}`,
    performedBy: 'Zailanor Pundato',
    timestamp,
    ...extra,
  });

describe('Pump Activity Log', () => {
  it('shows who turned the pump on, with role, and the controller acceptance', () => {
    const events = buildPumpEvents([
      request(true, 'Reservoir Tank No. 1', 1_000, { tankId: '1', performedByRole: 'admin' }),
      entry({ action: 'Pump Controller', details: 'Manual pump ON command accepted. Water level: 40%', timestamp: 2_200 }),
    ], tanks);

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      tankId: '1', state: 'ON', source: 'user', actor: 'Zailanor Pundato', role: 'admin', result: 'accepted',
    });
  });

  it('pairs a refusal with the command and keeps the reason', () => {
    const [event] = buildPumpEvents([
      request(true, 'Reservoir Tank No. 2', 1_000, { tankId: '2', performedByRole: 'worker' }),
      entry({ action: 'Pump Controller', details: 'Manual pump ON command refused: Maintenance mode is active.', timestamp: 2_000, tankId: '2' }),
    ], tanks);

    expect(event).toMatchObject({ tankId: '2', result: 'refused', detail: 'Maintenance mode is active.' });
  });

  it('does not pair a reply from another tank', () => {
    const events = buildPumpEvents([
      request(true, 'Reservoir Tank No. 2', 1_000, { tankId: '2' }),
      entry({ action: 'Pump Controller', details: 'Manual pump ON command accepted. Water level: 40%', timestamp: 2_000 }), // Tank 1
    ], tanks);

    const tank2 = events.find(e => e.tankId === '2');
    const tank1 = events.find(e => e.tankId === '1');
    expect(tank2?.result).toBe('unconfirmed');
    expect(tank1).toMatchObject({ actor: 'Unknown user', result: 'accepted' });
  });

  it('lists automatic starts and stops with their reason', () => {
    const events = buildPumpEvents([
      entry({ action: 'Pump Controller', details: 'Pump started automatically. Water level: 14% fell to low level threshold (15%). Reason: Low water level refill triggered.', timestamp: 1_000 }),
      entry({ action: 'Pump Controller', details: 'Pump stopped automatically. Water level: 95% reached overflow threshold (95%). Reason: Overflow shutoff protection.', timestamp: 5_000, tankId: '3' }),
      entry({ action: 'Pump Controller', details: 'Pump mode changed to MANUAL', timestamp: 6_000 }),
    ], tanks);

    expect(events.map(e => [e.tankId, e.state, e.source, e.detail])).toEqual([
      ['3', 'OFF', 'automatic', 'Overflow shutoff protection.'],
      ['1', 'ON', 'automatic', 'Low water level refill triggered.'],
    ]);
  });

  it('finds the tank of older entries (no tankId) from the tank name', () => {
    expect(pumpRequestTankId(request(false, 'Reservoir Tank No. 2', 0), tanks)).toBe('2');
    expect(pumpRequestTankId(request(false, 'Old Tank', 0), tanks)).toBeNull();
  });

  it('marks a command with no controller reply as unconfirmed', () => {
    const [event] = buildPumpEvents([
      request(true, 'Reservoir Tank No. 1', 1_000, { tankId: '1' }),
      entry({ action: 'Pump Controller', details: 'Manual pump ON command accepted. Water level: 40%', timestamp: 1_000 + 120_000 }),
    ], tanks).filter(e => e.actor === 'Zailanor Pundato');

    expect(event.result).toBe('unconfirmed');
  });
});
