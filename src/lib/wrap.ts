import type { FeedSale } from "./board";
import { addDays, datesOfMonth, isBusinessDay, monthKeyOf } from "./month";

/**
 * The Wrap: one day of the team's month, shaped for a single iPhone screenshot sent to the group
 * chat (owner, 2026-10-29). Pure: `buildWrap` reads a MonthSnapshot (or anything shaped like
 * `WrapInput`) and never touches the database. The day's sales are the snapshot's `sales` (the
 * month's own list), so a day in an earlier month needs that month's snapshot.
 */

/** What `buildWrap` reads from a MonthSnapshot (structurally; tests build it by hand). */
export interface WrapInput {
  clock: { key: string; today: string };
  team: { goalCents: number };
  agents: Array<{ id: string; name: string; tone: string; active: boolean }>;
  sales: FeedSale[];
}

export interface WrapCount {
  name: string;
  count: number;
}

export interface WrapLine {
  id: string;
  name: string;
  tone: string;
  premiumCents: number;
  policies: number;
  /** The carriers this person wrote with that day, most policies first. */
  carriers: WrapCount[];
  /** 1, 2, 3 … among the people who sold that day; null for a day without a sale. */
  rank: number | null;
}

/** How the team's day went against the month's goal. */
export type WrapVerdict =
  | { kind: "won"; neededCents: number }
  | { kind: "short"; neededCents: number; shortCents: number }
  /** The goal was already reached before this day. */
  | { kind: "goal_hit" }
  /** A weekend: no daily need (sales still count). */
  | { kind: "off_day" }
  | { kind: "no_goal" };

export interface DayWrap {
  day: string;
  when: "today" | "past" | "future";
  teamCents: number;
  policies: number;
  verdict: WrapVerdict;
  /** Everyone on the board, most premium first; people off the board only when they sold that day. */
  lines: WrapLine[];
  /** The day's top producer, or null when nobody sold. */
  player: WrapLine | null;
  /** The day's biggest single policy (the earliest on a tie); a multi-policy row only when there is no single one. */
  bestSale: FeedSale | null;
  carriers: WrapCount[];
  products: WrapCount[];
  /** The month up to and including this day (imported days and earlier months read as they stood). */
  month: { key: string; policies: number; goalPct: number; goalCents: number; productionCents: number };
  /**
   * Where this day stands among the month's selling days so far (1 = the best day), and how many
   * such days there are; null when nothing sold that day.
   */
  dayRank: { rank: number; of: number } | null;
  /**
   * The team's hot streak: business days in a row with at least one sale, ending on this day, or on
   * the business day before it while this day has none yet. `since` is the streak's first day.
   * Weekends neither extend nor break it. Counted within the month only.
   */
  streak: { days: number; since: string | null; alive: boolean };
}

function tally(items: Array<{ name: string | null; count: number }>): WrapCount[] {
  const counts = new Map<string, number>();
  for (const it of items) {
    const name = it.name?.trim();
    if (!name) continue;
    counts.set(name, (counts.get(name) ?? 0) + it.count);
  }
  return [...counts.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

/**
 * What the team needed on `day` to stay on the line to the goal: what was left before that day,
 * spread over the business days from that day on (that day included). 0 when the goal was reached.
 */
export function neededOnDay(input: Pick<WrapInput, "sales" | "team">, day: string): number {
  if (input.team.goalCents <= 0) return 0;
  const before = input.sales.filter((s) => s.soldOn < day).reduce((sum, s) => sum + s.premiumCents, 0);
  const left = input.team.goalCents - before;
  if (left <= 0) return 0;
  const businessFrom = datesOfMonth(monthKeyOf(day)).filter((d) => d >= day && isBusinessDay(d)).length;
  // Whole dollars, rounded up, so the verdict agrees with the dollars the badge shows.
  return Math.ceil(left / Math.max(1, businessFrom) / 100) * 100;
}

export function buildWrap(input: WrapInput, day: string): DayWrap {
  const { today } = input.clock;
  const when: DayWrap["when"] = day === today ? "today" : day < today ? "past" : "future";
  const daySales = input.sales.filter((s) => s.soldOn === day);
  const teamCents = daySales.reduce((sum, s) => sum + s.premiumCents, 0);
  const policies = daySales.reduce((sum, s) => sum + s.policies, 0);

  // Everyone on the board, plus anyone off it who still sold that day.
  const byAgent = new Map<string, FeedSale[]>();
  for (const s of daySales) byAgent.set(s.agentId, [...(byAgent.get(s.agentId) ?? []), s]);
  const people = input.agents.filter((a) => a.active || byAgent.has(a.id));
  for (const [id, sales] of byAgent) {
    if (!people.some((p) => p.id === id)) people.push({ id, name: sales[0].agentName, tone: "", active: false });
  }
  const unranked = people.map((a) => {
    const sales = byAgent.get(a.id) ?? [];
    return {
      id: a.id,
      name: a.name,
      tone: a.tone,
      premiumCents: sales.reduce((sum, s) => sum + s.premiumCents, 0),
      policies: sales.reduce((sum, s) => sum + s.policies, 0),
      carriers: tally(sales.map((s) => ({ name: s.carrier, count: s.policies }))),
    };
  });
  unranked.sort((a, b) => b.premiumCents - a.premiumCents || b.policies - a.policies || a.name.localeCompare(b.name));
  let rank = 0;
  const lines: WrapLine[] = unranked.map((l) => ({ ...l, rank: l.premiumCents > 0 ? ++rank : null }));
  const player = lines[0] && lines[0].premiumCents > 0 ? lines[0] : null;

  // The best deal is one policy; an imported day (one row per person, the day's total) or a
  // several-policy row counts only when no single policy was logged that day.
  const singles = daySales.filter((s) => s.policies === 1);
  let bestSale: FeedSale | null = null;
  for (const s of singles.length ? singles : daySales) {
    if (!bestSale || s.premiumCents > bestSale.premiumCents || (s.premiumCents === bestSale.premiumCents && s.createdAt < bestSale.createdAt)) bestSale = s;
  }
  const toDate = input.sales.filter((s) => s.soldOn <= day);
  const productionToDate = toDate.reduce((sum, s) => sum + s.premiumCents, 0);

  // The day's rank among the month's selling days so far (competition ranking: ties share a rank).
  const byDay = new Map<string, number>();
  for (const s of toDate) byDay.set(s.soldOn, (byDay.get(s.soldOn) ?? 0) + s.premiumCents);
  const dayRank = teamCents > 0 ? { rank: 1 + [...byDay.values()].filter((c) => c > teamCents).length, of: byDay.size } : null;

  // The hot streak: walk back over business days from this day (or the one before it while this
  // day is still empty) while each had a sale; weekends are skipped.
  const first = `${monthKeyOf(day)}-01`;
  const soldDays = new Set(byDay.keys());
  const previousBusiness = (d: string) => {
    let p = addDays(d, -1);
    while (!isBusinessDay(p)) p = addDays(p, -1);
    return p;
  };
  let cursor = isBusinessDay(day) ? day : previousBusiness(day);
  const alive = soldDays.has(cursor);
  if (!alive) cursor = previousBusiness(cursor);
  let streakDays = 0;
  let since: string | null = null;
  while (cursor >= first && soldDays.has(cursor)) {
    streakDays++;
    since = cursor;
    cursor = previousBusiness(cursor);
  }

  let verdict: WrapVerdict;
  if (input.team.goalCents <= 0) verdict = { kind: "no_goal" };
  else if (!isBusinessDay(day)) verdict = { kind: "off_day" };
  else {
    const neededCents = neededOnDay(input, day);
    if (neededCents === 0) verdict = { kind: "goal_hit" };
    else if (teamCents >= neededCents) verdict = { kind: "won", neededCents };
    else verdict = { kind: "short", neededCents, shortCents: neededCents - teamCents };
  }

  return {
    day,
    when,
    teamCents,
    policies,
    verdict,
    lines,
    player,
    bestSale,
    carriers: tally(daySales.map((s) => ({ name: s.carrier, count: s.policies }))),
    products: tally(daySales.map((s) => ({ name: s.product, count: s.policies }))),
    month: {
      key: input.clock.key,
      policies: toDate.reduce((sum, s) => sum + s.policies, 0),
      goalPct: input.team.goalCents > 0 ? Math.round((productionToDate / input.team.goalCents) * 100) : 0,
      goalCents: input.team.goalCents,
      productionCents: productionToDate,
    },
    dayRank,
    streak: { days: streakDays, since, alive },
  };
}

/** "Best day", "2nd best day", "3rd best day", "4th best day" … */
export function dayRankLabel(rank: number): string {
  if (rank === 1) return "Best day";
  const mod10 = rank % 10;
  const mod100 = rank % 100;
  const suffix = mod10 === 1 && mod100 !== 11 ? "st" : mod10 === 2 && mod100 !== 12 ? "nd" : mod10 === 3 && mod100 !== 13 ? "rd" : "th";
  return `${rank}${suffix} best day`;
}

/** "AHL ×2 · Newbridge" for a line's carriers. */
export function carrierSummary(carriers: WrapCount[]): string {
  return carriers.map((c) => (c.count > 1 ? `${c.name} ×${c.count}` : c.name)).join(" · ");
}
