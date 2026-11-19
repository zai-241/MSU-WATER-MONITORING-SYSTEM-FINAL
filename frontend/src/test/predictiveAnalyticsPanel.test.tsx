import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import PredictiveAnalytics from '@/components/PredictiveAnalytics';
import { phParts, type UsageSample } from '@/lib/predictive';

// Recharts needs ResizeObserver, which jsdom does not have
global.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;

const ph = (day: number, hour: number, minute = 0) => Date.UTC(2026, 10, day, hour - 8, minute);
const TEN_MIN = 10 * 60_000;

/** Two weeks from Monday 16 Nov: water used 8-9 AM only, twice as much on Wednesdays */
function history(): UsageSample[] {
  const out: UsageSample[] = [];
  let level = 90;
  for (let t = ph(16, 0); t < ph(30, 0); t += TEN_MIN) {
    const { hour, weekday } = phParts(t - 1);
    let pumpOn = false;
    if (hour === 8) level -= weekday === 3 ? 2 : 1;
    if (level < 30) { level = 90; pumpOn = true; }
    out.push({ timestamp: t, waterLevel: level, phLevel: 7.2, pumpOn, levelSensorOk: true, phSensorOk: true });
  }
  return out;
}

const props = {
  capacityLiters: 200, lowLevelThreshold: 15, minPh: 6.5, maxPh: 8.5,
  now: ph(30, 6), rangeLabel: 'Last 30 Days', pumpAuto: true,
};

describe('Reports: Predictive Analytics panel', () => {
  it('shows the peak hour, the peak day, today’s forecast, time to low and the pH trend', () => {
    render(<PredictiveAnalytics {...props} samples={history()} liveLevel={20} />);
    expect(screen.getByTestId('peak-hours')).toHaveTextContent('8 AM to 9 AM');
    expect(screen.getByTestId('peak-day')).toHaveTextContent('Wednesday');
    expect(screen.getByTestId('today-forecast')).toHaveTextContent('Average for a Monday');
    // 20 % now, about 6 % used between 8 and 9 AM: crosses 15 % during the 8 AM hour
    expect(screen.getByTestId('time-to-low')).toHaveTextContent(/about \d+ h/);
    expect(screen.getByTestId('time-to-low')).toHaveTextContent('8:');
    expect(screen.getByTestId('ph-trend')).toHaveTextContent('Stable');
  });

  it('says it is still learning when there is no history', () => {
    render(<PredictiveAnalytics {...props} samples={[]} liveLevel={50} />);
    expect(screen.getByText(/Not enough history yet/)).toBeInTheDocument();
    expect(screen.getByTestId('time-to-low')).toHaveTextContent('Learning');
    expect(screen.getByTestId('peak-day')).toHaveTextContent('Not enough days yet');
  });

  it('does not forecast time to low without a live level', () => {
    render(<PredictiveAnalytics {...props} samples={history()} liveLevel={null} />);
    expect(screen.getByTestId('time-to-low')).toHaveTextContent('Unavailable');
  });
});
