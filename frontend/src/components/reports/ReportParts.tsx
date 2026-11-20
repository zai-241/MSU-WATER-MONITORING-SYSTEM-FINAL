/**
 * Small display pieces of the Reports page (table cells, status lines). Constants and labels are in reportStyles.ts.
 */

/** Problem count cell: a red number when there were problems, a muted 0 otherwise. */
export function ProblemCell({ count }: { count: number }) {
  return (
    <td className="py-3.5 px-3 text-center">
      <span className={count > 0 ? 'inline-block min-w-[1.5rem] px-1.5 py-0.5 rounded bg-danger/10 text-danger font-bold' : 'text-muted-foreground/60'}>
        {count}
      </span>
    </td>
  );
}

/** Marks a history value recorded while the sensor was faulty (monitoring continues, value may be off). */
export function FaultTag({ what }: { what: string }) {
  return (
    <span
      className="ml-1.5 text-[10px] text-danger font-semibold uppercase"
      title={`Recorded during a ${what} sensor fault; may be inaccurate`}
    >
      Fault
    </span>
  );
}

/** Sensor health line on the live cards. A fault is shown, but the reading above keeps updating. */
export function SensorStatusRow({ ok }: { ok: boolean }) {
  return (
    <div className="mt-4 pt-2 border-t border-border/40 flex items-center justify-between gap-2 text-xs font-medium text-muted-foreground">
      <span>Status:</span>
      <span
        className={ok ? 'text-safe' : 'text-danger font-bold text-right'}
        title={ok ? undefined : 'Monitoring continues; the reading may be inaccurate until the sensor is checked'}
      >
        {ok ? 'SENSOR OK' : 'SENSOR FAULT · still monitoring'}
      </span>
    </div>
  );
}
