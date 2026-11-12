import { TEAM_TIME_ZONE } from "../../lib/timezone";
import { isDateKey } from "../../lib/month";

/**
 * Words and numbers the policy screens print (Log a sale, Policies, one policy). Pure and
 * browser-safe; every clock reading is America/Detroit. Never holds or logs a client value.
 */

const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** "Nov 11" from "2026-11-11"; "" for none. */
export function dayShort(date: string | null | undefined): string {
  if (!date || !isDateKey(date)) return "";
  const [, m, d] = date.split("-").map(Number);
  return `${MONTHS_SHORT[m - 1]} ${d}`;
}

/** "November 11, 2026" from "2026-11-11"; "" for none. */
export function dateLong(date: string | null | undefined): string {
  if (!date || !isDateKey(date)) return "";
  const [y, m, d] = date.split("-").map(Number);
  return `${MONTHS_LONG[m - 1]} ${d}, ${y}`;
}

/** "December" from "2026-12". */
export function monthWord(monthKey: string): string {
  return MONTHS_LONG[Number(monthKey.slice(5, 7)) - 1] ?? "";
}

function parts(at: string | number | Date): Record<string, string> | null {
  const t = at instanceof Date ? at : new Date(at);
  if (!Number.isFinite(t.getTime())) return null;
  const out: Record<string, string> = {};
  for (const p of new Intl.DateTimeFormat("en-US", { timeZone: TEAM_TIME_ZONE, month: "short", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true }).formatToParts(t)) out[p.type] = p.value;
  return out;
}

/** "6:46 PM" in Detroit. */
export function clockTime(at: string | number | Date): string {
  const p = parts(at);
  return p ? `${p.hour}:${p.minute} ${String(p.dayPeriod ?? "").toUpperCase()}`.trim() : "";
}

/** "Nov 11, 6:46 PM" in Detroit (the history lines, "Logged ..."). */
export function stamp(at: string | number | Date): string {
  const p = parts(at);
  return p ? `${p.month} ${p.day}, ${clockTime(at)}` : "";
}

/** "Jack G." (a table cell); one word stays as it is. */
export function shortName(name: string): string {
  const w = String(name ?? "").trim().split(/\s+/).filter(Boolean);
  if (w.length < 2) return w[0] ?? "";
  return `${w[0]} ${w[w.length - 1][0]}.`;
}

/** "Jack" */
export function firstName(name: string | null | undefined): string {
  return String(name ?? "").trim().split(/\s+/)[0] ?? "";
}

/** "Brady, Mikal and Jack" */
export function listWords(xs: string[]): string {
  if (xs.length <= 1) return xs.join("");
  return `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`;
}

/** Whole days from one "YYYY-MM-DD" to another. */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** "1 policy" / "3 policies" */
export const policiesWord = (n: number): string => `${n} ${n === 1 ? "policy" : "policies"}`;

// ---- where a seller stands on the month's board (Log a sale's preview and its done panel) --------

/** One person's month on the board: life premium and policies, today's part of them. */
export interface BoardLine {
  id: string;
  name: string;
  cents: number;
  policies: number;
  todayCents?: number;
  todayPolicies?: number;
}

function order(lines: BoardLine[], cents: (l: BoardLine) => number, policies: (l: BoardLine) => number): BoardLine[] {
  return lines
    .filter((l) => cents(l) > 0)
    .sort((a, b) => cents(b) - cents(a) || policies(b) - policies(a) || a.name.localeCompare(b.name));
}

/** The seller's place among the people who sold this month (null: no sale yet). Premium, then policies, then name. */
export function rankOf(lines: BoardLine[], id: string): number | null {
  const i = order(lines, (l) => l.cents, (l) => l.policies).findIndex((l) => l.id === id);
  return i < 0 ? null : i + 1;
}

/** Places gained (+) or lost (−) since yesterday (today's sales taken out); null for someone with no sale before today. */
export function rankChangeOf(lines: BoardLine[], id: string): number | null {
  const now = rankOf(lines, id);
  const before = order(
    lines,
    (l) => l.cents - (l.todayCents ?? 0),
    (l) => l.policies - (l.todayPolicies ?? 0),
  ).findIndex((l) => l.id === id);
  if (now == null || before < 0) return null;
  return before + 1 - now;
}

/**
 * The board with one more sale for `id` (Log a sale's "On the board" line): where they were, where
 * they would be, and their month before and after.
 */
export function previewSale(lines: BoardLine[], id: string, name: string, annualCents: number): { before: number | null; after: number; centsBefore: number; centsAfter: number } {
  const mine = lines.find((l) => l.id === id);
  const centsBefore = mine?.cents ?? 0;
  const next = mine ? lines.map((l) => (l.id === id ? { ...l, cents: l.cents + annualCents, policies: l.policies + 1 } : l)) : [...lines, { id, name, cents: annualCents, policies: 1 }];
  return { before: rankOf(lines, id), after: rankOf(next, id) ?? 1, centsBefore, centsAfter: centsBefore + annualCents };
}
