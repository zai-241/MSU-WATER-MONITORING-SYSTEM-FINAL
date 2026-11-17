/**
 * @file dateFormat.ts
 * @description The one date/time format used across the web app, the APK and the exports:
 * dates as mm/dd/yyyy, times in 12-hour format (e.g. "11/17/2026 09:05:30 PM").
 * Built by hand (not toLocaleString) so it looks the same whatever the phone or PC locale is.
 */

type DateInput = number | Date;

const pad2 = (n: number) => String(n).padStart(2, '0');

const toDate = (value: DateInput): Date | null => {
  const d = value instanceof Date ? value : new Date(value);
  return isNaN(d.getTime()) ? null : d;
};

/** "11/17/2026" */
export function formatDate(value: DateInput): string {
  const d = toDate(value);
  if (!d) return 'Invalid Date';
  return `${pad2(d.getMonth() + 1)}/${pad2(d.getDate())}/${d.getFullYear()}`;
}

/** "09:05 PM", or "09:05:30 PM" with seconds */
export function formatTime(value: DateInput, options: { seconds?: boolean } = {}): string {
  const d = toDate(value);
  if (!d) return 'Invalid Date';
  const hours = d.getHours();
  const hour12 = hours % 12 === 0 ? 12 : hours % 12;
  const suffix = hours < 12 ? 'AM' : 'PM';
  const secs = options.seconds ? `:${pad2(d.getSeconds())}` : '';
  return `${pad2(hour12)}:${pad2(d.getMinutes())}${secs} ${suffix}`;
}

/** "11/17/2026 09:05 PM", or "11/17/2026 09:05:30 PM" with seconds */
export function formatDateTime(value: DateInput, options: { seconds?: boolean } = {}): string {
  const d = toDate(value);
  if (!d) return 'Invalid Date';
  return `${formatDate(d)} ${formatTime(d, options)}`;
}
