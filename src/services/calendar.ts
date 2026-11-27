/** Calendar helpers on YYYY-MM-DD strings (no time zones involved: these are already local days). */
const DAY_MS = 86_400_000;

function toUtc(day: string): number {
  const [y, m, d] = day.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

function fromUtc(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function isRealDay(day: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(day) && fromUtc(toUtc(day)) === day;
}

/** 0 = Monday ... 6 = Sunday. */
export function weekdayOf(day: string): number {
  return (new Date(toUtc(day)).getUTCDay() + 6) % 7;
}

export function addDays(day: string, n: number): string {
  return fromUtc(toUtc(day) + n * DAY_MS);
}

/** ISO-8601 week label, e.g. 2026-W48. */
export function isoWeekOf(day: string): string {
  const thursday = addDays(day, 3 - weekdayOf(day));
  const year = Number(thursday.slice(0, 4));
  const jan4 = `${year}-01-04`;
  const week1Monday = addDays(jan4, -weekdayOf(jan4));
  const week = Math.floor((toUtc(thursday) - toUtc(week1Monday)) / (7 * DAY_MS)) + 1;
  return `${year}-W${String(week).padStart(2, "0")}`;
}

/** The seven days (Monday first) of an ISO week, or null if the label is not a real week. */
export function daysOfIsoWeek(week: string): string[] | null {
  const m = /^(\d{4})-W(\d{2})$/.exec(week);
  if (!m) return null;
  const year = Number(m[1]);
  const n = Number(m[2]);
  const jan4 = `${year}-01-04`;
  const monday = addDays(addDays(jan4, -weekdayOf(jan4)), (n - 1) * 7);
  if (n < 1 || isoWeekOf(monday) !== week) return null;
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}
