const TZ = process.env.APP_TIMEZONE ?? 'Asia/Dubai';

/** Return today's date string (YYYY-MM-DD) in the app timezone. */
export function todayInTZ(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: TZ }); // en-CA gives YYYY-MM-DD
}

/** Return a Date object representing midnight of the given ISO date string in TZ. */
export function parseLocalDate(isoDate: string): Date {
  // Parse as midnight UTC then shift — safe for display purposes
  return new Date(`${isoDate}T00:00:00`);
}

/** Format a YYYY-MM-DD string for display: "Monday, June 3" */
export function formatDateDisplay(isoDate: string): string {
  const d = new Date(`${isoDate}T12:00:00`);
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: TZ });
}

/** Return the ISO weekday (1=Mon … 7=Sun) for a YYYY-MM-DD string. */
export function isoWeekday(isoDate: string): number {
  const d = new Date(`${isoDate}T12:00:00`);
  const day = d.getDay(); // 0=Sun … 6=Sat
  return day === 0 ? 7 : day;
}

/** True if the date is Saturday. */
export function isSaturday(isoDate: string): boolean {
  return isoWeekday(isoDate) === 6;
}

/** True if the date is Sunday. */
export function isSunday(isoDate: string): boolean {
  return isoWeekday(isoDate) === 7;
}

/** True if the date is Saturday or Sunday. */
export function isWeekend(isoDate: string): boolean {
  const wd = isoWeekday(isoDate);
  return wd === 6 || wd === 7;
}

/** Shift an ISO date string by `days` days. */
export function shiftDate(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T12:00:00`);
  d.setDate(d.getDate() + days);
  return d.toLocaleDateString('en-CA', { timeZone: TZ });
}
