// Formatting helpers for the UTC hours ("YYYY-MM-DDTHH:00") the API works in, shown in local time.

export const parseUtcHour = (utc: string) => new Date(`${utc}:00Z`);

/** Local hour, e.g. "07:00". */
export function clockLabel(utc: string): string {
  return parseUtcHour(utc).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

/** "today at 15:00", "tomorrow at 07:00" or "on Thursday at 10:00". */
export function whenLabel(utc: string): string {
  const d = parseUtcHour(utc);
  const days = localDayDiff(new Date(), d);
  const day = days === 0 ? "today" : days === 1 ? "tomorrow" : `on ${d.toLocaleDateString(undefined, { weekday: "long" })}`;
  return `${day} at ${clockLabel(utc)}`;
}

/** Short label for the timeline, e.g. "Wed 14:00". */
export function shortLabel(utc: string): string {
  const d = parseUtcHour(utc);
  return `${d.toLocaleDateString(undefined, { weekday: "short" })} ${clockLabel(utc)}`;
}

/** Whole calendar days (in local time) from a to b. */
export function localDayDiff(a: Date, b: Date): number {
  const midnight = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  return Math.round((midnight(b) - midnight(a)) / 86_400_000);
}

export function durationLabel(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}
