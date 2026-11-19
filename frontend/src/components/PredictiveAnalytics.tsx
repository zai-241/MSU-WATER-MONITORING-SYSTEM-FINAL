import type { ReactNode } from 'react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell } from 'recharts';
import { Clock, CalendarDays, Droplets, TimerReset, FlaskConical, Sparkles } from 'lucide-react';
import { hourLabel, hourRangeLabel, type PredictiveReport, type UsageProfile } from '@/lib/predictive';

interface Props {
  /** From buildPredictiveReport(); the Excel and PDF exports use the same object */
  report: PredictiveReport;
  lowLevelThreshold: number;
  rangeLabel: string;
}

const PEAK = '#f59e0b';
const BASE = '#3b82f6';

const Tile = ({ icon, title, value, detail, testId }: { icon: ReactNode; title: string; value: string; detail?: string; testId: string }) => (
  <div data-testid={testId} className="rounded-xl border border-border/40 bg-card/40 p-4 print:bg-white print:border-gray-300 print:p-3 print:break-inside-avoid">
    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5 print:text-gray-600">{icon} {title}</p>
    <p className="mt-2 text-xl font-bold text-foreground leading-tight print:text-black print:text-base">{value}</p>
    {detail && <p className="mt-1 text-xs text-muted-foreground print:text-gray-700">{detail}</p>}
  </div>
);

const printCell = 'border border-gray-300 px-2 py-1';

/**
 * Print only: the hour and weekday averages as tables (charts print badly and browsers drop
 * background colours, so the peak rows are bold and marked "Peak"). Same layout as the PDF.
 */
const PrintTables = ({ profile }: { profile: UsageProfile }) => {
  const peakHours = new Set(profile.peakHours.map(h => h.hour));
  const liters = (v: number | null, empty: string) => (v === null ? empty : `${v} L`);
  const mark = (on: boolean) => (on ? ' (Peak)' : '');
  return (
    <div data-testid="print-tables" className="hidden print:grid print:grid-cols-2 print:gap-4 mt-4 text-[11px] text-black">
      <table data-testid="print-hour-table" className="w-full border-collapse break-inside-avoid">
        <caption className="text-left font-semibold mb-1">Average water use by hour of the day</caption>
        <thead>
          <tr>
            <th className={`${printCell} text-left`}>Hour</th>
            <th className={`${printCell} text-right`}>Avg. use</th>
            <th className={`${printCell} text-left`}>Hour</th>
            <th className={`${printCell} text-right`}>Avg. use</th>
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: 12 }, (_, i) => {
            const a = profile.hours[i];
            const b = profile.hours[i + 12];
            const cells = (h: typeof a) => {
              const peak = peakHours.has(h.hour);
              return (
                <>
                  <td className={`${printCell} ${peak ? 'font-bold' : ''}`}>{hourRangeLabel(h.hour)}{mark(peak)}</td>
                  <td className={`${printCell} text-right ${peak ? 'font-bold' : ''}`}>{liters(h.avgLiters, '-')}</td>
                </>
              );
            };
            return <tr key={i}>{cells(a)}{cells(b)}</tr>;
          })}
        </tbody>
      </table>
      <table data-testid="print-day-table" className="w-full border-collapse self-start break-inside-avoid">
        <caption className="text-left font-semibold mb-1">Average water use by day of the week</caption>
        <thead>
          <tr>
            <th className={`${printCell} text-left`}>Day</th>
            <th className={`${printCell} text-right`}>Avg. use per day</th>
            <th className={`${printCell} text-right`}>Days</th>
          </tr>
        </thead>
        <tbody>
          {profile.weekdays.map(w => {
            const peak = profile.peakWeekday?.weekday === w.weekday;
            return (
              <tr key={w.weekday}>
                <td className={`${printCell} ${peak ? 'font-bold' : ''}`}>{w.name}{mark(peak)}</td>
                <td className={`${printCell} text-right ${peak ? 'font-bold' : ''}`}>{liters(w.avgLiters, 'No complete day')}</td>
                <td className={`${printCell} text-right`}>{w.days}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};

/**
 * Predictive analytics panel in Reports: peak hours, peak day of the week, expected use today,
 * time until the low level, and the pH trend. The numbers and texts come from lib/predictive.ts.
 */
const PredictiveAnalytics = ({ report, lowLevelThreshold, rangeLabel }: Props) => {
  const { profile, enoughData } = report;
  const peakHourSet = new Set(profile.peakHours.map(h => h.hour));
  const hourData = profile.hours.map(h => ({ label: hourLabel(h.hour), liters: h.avgLiters ?? 0, hour: h.hour, days: h.days }));
  const dayData = profile.weekdays.map(w => ({ label: w.name.slice(0, 3), name: w.name, liters: w.avgLiters ?? 0, days: w.days, weekday: w.weekday }));

  return (
    <section
      data-testid="predictive-analytics"
      className="bg-card/30 backdrop-blur-md p-6 rounded-xl border border-border/40 shadow-sm print:break-before-page print:bg-white print:backdrop-blur-none print:shadow-none print:border-gray-300 print:p-4 print:text-black"
    >
      <h3 className="text-lg font-bold text-foreground flex items-center gap-2 tracking-tight print:text-black">
        <Sparkles className="text-amber-500 h-5 w-5" /> Predictive Analytics
      </h3>
      <p className="text-xs text-muted-foreground mt-0.5 print:text-gray-700">
        Water use is the level drop while the pump is off, from the 10-minute history ({rangeLabel}, {profile.coveredDays} complete day{profile.coveredDays === 1 ? '' : 's'}).
        Forecasts are averages of past use, in Philippine time.
      </p>

      <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-4 print:grid-cols-3 print:gap-2 print:mt-3">
        <Tile testId="peak-hours" icon={<Clock size={14} />} title="Peak hours" {...report.peakHours} />
        <Tile testId="peak-day" icon={<CalendarDays size={14} />} title="Peak day" {...report.peakDay} />
        <Tile testId="today-forecast" icon={<Droplets size={14} />} title="Expected use today" {...report.today} />
        <Tile testId="time-to-low" icon={<TimerReset size={14} />} title={`Time until ${lowLevelThreshold}%`} {...report.timeToLow} />
        <Tile testId="ph-trend" icon={<FlaskConical size={14} />} title="pH trend" {...report.phTrend} />
      </div>

      {!enoughData ? (
        <p className="mt-6 rounded-lg border border-dashed border-border/40 bg-secondary/5 p-4 text-center text-sm text-muted-foreground print:text-gray-700 print:mt-3">
          Not enough history yet to show usage patterns. They appear after about a day of readings with the level sensor working.
        </p>
      ) : (
        <>
        <PrintTables profile={profile} />
        <div className="mt-6 grid grid-cols-1 lg:grid-cols-2 gap-6 print:hidden" data-testid="usage-charts">
          <div>
            <p className="text-sm font-semibold text-foreground">Average water use by hour of the day</p>
            <p className="text-xs text-muted-foreground">Liters per hour; the busiest hours are highlighted</p>
            <div className="h-64 w-full mt-3">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={hourData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
                  <XAxis dataKey="label" interval={2} tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} />
                  <YAxis tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} tickFormatter={(v) => `${v} L`} />
                  <Tooltip
                    contentStyle={{ background: 'hsl(var(--card))', borderColor: 'rgba(255,255,255,0.1)', borderRadius: '8px', color: 'hsl(var(--foreground))' }}
                    labelFormatter={(_, payload) => (payload?.[0] ? hourRangeLabel((payload[0].payload as { hour: number }).hour) : '')}
                    formatter={(value: unknown, _name, item) => [`${value} L (${(item.payload as { days: number }).days} days)`, 'Average use']}
                  />
                  <Bar dataKey="liters" radius={[4, 4, 0, 0]}>
                    {hourData.map(d => <Cell key={d.hour} fill={peakHourSet.has(d.hour) ? PEAK : BASE} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
          <div>
            <p className="text-sm font-semibold text-foreground">Average water use by day of the week</p>
            <p className="text-xs text-muted-foreground">Liters per day; the busiest day is highlighted</p>
            <div className="h-64 w-full mt-3">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={dayData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} />
                  <YAxis tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} tickFormatter={(v) => `${v} L`} />
                  <Tooltip
                    contentStyle={{ background: 'hsl(var(--card))', borderColor: 'rgba(255,255,255,0.1)', borderRadius: '8px', color: 'hsl(var(--foreground))' }}
                    labelFormatter={(_, payload) => (payload?.[0] ? (payload[0].payload as { name: string }).name : '')}
                    formatter={(value: unknown, _name, item) => {
                      const days = (item.payload as { days: number }).days;
                      return [days ? `${value} L (${days} day${days === 1 ? '' : 's'})` : 'No complete day yet', 'Average use'];
                    }}
                  />
                  <Bar dataKey="liters" radius={[4, 4, 0, 0]}>
                    {dayData.map(d => <Cell key={d.weekday} fill={profile.peakWeekday?.weekday === d.weekday ? PEAK : BASE} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
        </>
      )}
    </section>
  );
};

export default PredictiveAnalytics;
