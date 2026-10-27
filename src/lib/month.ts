import { TEAM_TIME_ZONE } from "./timezone";

/**
 * Calendar math for one month in Detroit. Pure and browser-safe: everything takes and returns
 * "YYYY-MM-DD" and "YYYY-MM" strings, never a Date in the local zone.
 */

let dayFormat: Intl.DateTimeFormat | null = null;

/** "2026-10-27": the date it is right now in Detroit. */
export function todayInDetroit(now: Date = new Date()): string {
  dayFormat ??= new Intl.DateTimeFormat("en-CA", { timeZone: TEAM_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" });
  return dayFormat.format(now);
}

export function isDateKey(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  if (m < 1 || m > 12) return false;
  return d >= 1 && d <= daysInMonth(y, m);
}

export function isMonthKey(s: string): boolean {
  if (!/^\d{4}-\d{2}$/.test(s)) return false;
  const m = Number(s.slice(5));
  return m >= 1 && m <= 12;
}

export function monthKeyOf(date: string): string {
  return date.slice(0, 7);
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** 0 = Sunday … 6 = Saturday, for a "YYYY-MM-DD". */
export function weekday(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function isBusinessDay(date: string): boolean {
  const w = weekday(date);
  return w >= 1 && w <= 5;
}

/** Every date of the month in order. */
export function datesOfMonth(key: string): string[] {
  const [y, m] = key.split("-").map(Number);
  const n = daysInMonth(y, m);
  return Array.from({ length: n }, (_, i) => `${key}-${String(i + 1).padStart(2, "0")}`);
}

export function addMonths(key: string, delta: number): string {
  const [y, m] = key.split("-").map(Number);
  const total = y * 12 + (m - 1) + delta;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return `${ny}-${String(nm).padStart(2, "0")}`;
}

export function addDays(date: string, delta: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + delta));
  return t.toISOString().slice(0, 10);
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** "October 2026" */
export function monthLabel(key: string): string {
  const [y, m] = key.split("-").map(Number);
  return `${MONTHS[m - 1]} ${y}`;
}

/** "October" */
export function monthName(key: string): string {
  return MONTHS[Number(key.slice(5)) - 1];
}

/** "Mon, Oct 27" */
export function dayLabel(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
}

export interface MonthClock {
  key: string;
  label: string;
  today: string;
  /** Where the viewer stands: before the month, in it, or after it ended. */
  position: "past" | "current" | "future";
  businessDays: number;
  /** Business days up to and including today (0 before the month starts, all of them after it ends). */
  elapsed: number;
  /** Business days from today to the end of the month, today included (0 after the month ends). */
  remaining: number;
  /** Calendar days from today to the end of the month, today included. */
  calendarRemaining: number;
  /** 0 to 1: how far through its business days the month is. */
  progress: number;
}

/** The month's calendar seen from `today` (both Detroit dates). */
export function monthClock(key: string, today: string): MonthClock {
  const dates = datesOfMonth(key);
  const business = dates.filter(isBusinessDay);
  const first = dates[0];
  const last = dates[dates.length - 1];
  const position: MonthClock["position"] = today < first ? "future" : today > last ? "past" : "current";
  const elapsed = position === "future" ? 0 : position === "past" ? business.length : business.filter((d) => d <= today).length;
  const remaining = position === "past" ? 0 : position === "future" ? business.length : business.filter((d) => d >= today).length;
  const calendarRemaining = position === "past" ? 0 : position === "future" ? dates.length : dates.filter((d) => d >= today).length;
  return {
    key,
    label: monthLabel(key),
    today,
    position,
    businessDays: business.length,
    elapsed,
    remaining,
    calendarRemaining,
    progress: business.length ? elapsed / business.length : 0,
  };
}

export interface Pace {
  /** Where the month lands if the team keeps today's rate (0 before the first business day). */
  projectedCents: number;
  /** What a straight line to the goal expects by now. */
  expectedCents: number;
  /** Production minus the expectation: positive is ahead, negative behind. */
  aheadCents: number;
  /** What each remaining business day needs to average to reach the goal (0 when done or over). */
  neededPerDayCents: number;
  /** "ahead" / "behind" / "on" (within 2% of the goal line) / "done" (goal reached) / "none" (no goal). */
  status: "ahead" | "behind" | "on" | "done" | "none";
}

export function pace(productionCents: number, goalCents: number, clock: MonthClock): Pace {
  const projectedCents = clock.elapsed > 0 ? Math.round((productionCents / clock.elapsed) * clock.businessDays) : 0;
  if (goalCents <= 0) return { projectedCents, expectedCents: 0, aheadCents: 0, neededPerDayCents: 0, status: "none" };
  const expectedCents = Math.round(goalCents * clock.progress);
  const aheadCents = productionCents - expectedCents;
  const left = Math.max(0, goalCents - productionCents);
  const neededPerDayCents = left === 0 ? 0 : clock.remaining > 0 ? Math.ceil(left / clock.remaining) : left;
  let status: Pace["status"];
  if (productionCents >= goalCents) status = "done";
  else if (Math.abs(aheadCents) <= goalCents * 0.02) status = "on";
  else status = aheadCents > 0 ? "ahead" : "behind";
  return { projectedCents, expectedCents, aheadCents, neededPerDayCents, status };
}
