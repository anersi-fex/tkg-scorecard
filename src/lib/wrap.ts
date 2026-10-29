import type { FeedSale } from "./board";
import { addDays, datesOfMonth, isBusinessDay, monthClock, monthKeyOf, pace, weekday } from "./month";

/**
 * The Wrap: the team's day, week or month shaped for a single iPhone screenshot sent to the group
 * chat (owner, 2026-10-29). Pure: `buildWrap` reads a MonthSnapshot (or anything shaped like
 * `WrapInput`) and never touches the database. The sales are the snapshot's `sales` (the month's
 * own list), so a period in an earlier month needs that month's snapshot; a week never crosses a
 * month's edge (the goal and the sales are the month's).
 */

export type WrapView = "day" | "week" | "month";
export const WRAP_VIEWS: readonly WrapView[] = ["day", "week", "month"];

export function isWrapView(s: unknown): s is WrapView {
  return s === "day" || s === "week" || s === "month";
}

/** The days one view covers: both ends inclusive, Detroit "YYYY-MM-DD", in one month. */
export interface WrapPeriod {
  view: WrapView;
  from: string;
  to: string;
}

/**
 * The period a view shows around `day`: the day itself; its week, Monday to Sunday, cut at the
 * month's edges; or its month. Nothing after `today` (a week or month still running shows through
 * today), and a `day` after today counts as today.
 */
export function periodFor(view: WrapView, day: string, today: string): WrapPeriod {
  if (day > today) day = today;
  const dates = datesOfMonth(monthKeyOf(day));
  const first = dates[0];
  const last = dates[dates.length - 1];
  const cap = today < last ? today : last;
  if (view === "day") return { view, from: day, to: day };
  if (view === "month") return { view, from: first, to: cap };
  const monday = addDays(day, -((weekday(day) + 6) % 7));
  const sunday = addDays(monday, 6);
  return { view, from: monday < first ? first : monday, to: sunday < cap ? sunday : cap };
}

/**
 * Where the arrows go: the day before the period and the day after it (null once the period
 * reaches today). Anchoring on the day just past an edge walks month-split weeks one at a time
 * (Sep 28 to 30, then Oct 1 to 4) and months one at a time.
 */
export function periodNav(period: WrapPeriod, today: string): { prev: string; next: string | null } {
  return { prev: addDays(period.from, -1), next: period.to < today ? addDays(period.to, 1) : null };
}

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
  /** The carriers this person wrote with in the period, most policies first. */
  carriers: WrapCount[];
  /** 1, 2, 3 … among the people who sold in the period; null for a person without a sale. */
  rank: number | null;
}

/** How the team's period went against the month's goal. */
export type WrapVerdict =
  /** A day or week that beat what the goal needed; a month that ended short says `short`. */
  | { kind: "won"; neededCents: number }
  | { kind: "short"; neededCents: number; shortCents: number }
  /** The goal was already reached before this day or week, or by the end of this month. */
  | { kind: "goal_hit" }
  /** No business day in the period (a weekend): nothing was needed, sales still count. */
  | { kind: "off_day" }
  /** A month still running, against the straight line to the goal (within 2% is `on`). */
  | { kind: "ahead"; byCents: number; expectedCents: number }
  | { kind: "behind"; byCents: number; expectedCents: number }
  | { kind: "on"; expectedCents: number }
  | { kind: "no_goal" };

export interface PeriodWrap extends WrapPeriod {
  /** The day the page was opened on (the arrows and the view switch keep it). */
  day: string;
  /** True while the period runs through today, so its numbers are still moving. */
  current: boolean;
  teamCents: number;
  policies: number;
  verdict: WrapVerdict;
  /** Everyone on the board, most premium first; people off the board only when they sold in the period. */
  lines: WrapLine[];
  /** The period's top producer, or null when nobody sold. */
  player: WrapLine | null;
  /** The period's biggest single policy (the earliest on a tie); a multi-policy row only when there is no single one. */
  bestSale: FeedSale | null;
  /** The period's carriers and products, most policies first. */
  carriers: WrapCount[];
  products: WrapCount[];
  /**
   * The month's three busiest carriers by policies, up to the period's end (owner, 2026-10-29:
   * "the top three carriers ... and the number of policies that we've put through them this month
   * so far"), whatever the view.
   */
  topCarriers: WrapCount[];
  /** The month up to and including the period's end (imported days and earlier months read as they stood). */
  month: { key: string; policies: number; goalPct: number; goalCents: number; productionCents: number };
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

export function buildWrap(input: WrapInput, day: string, view: WrapView = "day"): PeriodWrap {
  const { today } = input.clock;
  const { from, to } = periodFor(view, day, today);
  const current = to === today;
  const inPeriod = input.sales.filter((s) => s.soldOn >= from && s.soldOn <= to);
  const teamCents = inPeriod.reduce((sum, s) => sum + s.premiumCents, 0);
  const policies = inPeriod.reduce((sum, s) => sum + s.policies, 0);

  // Everyone on the board, plus anyone off it who still sold in the period.
  const byAgent = new Map<string, FeedSale[]>();
  for (const s of inPeriod) byAgent.set(s.agentId, [...(byAgent.get(s.agentId) ?? []), s]);
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
  // several-policy row counts only when no single policy was logged in the period.
  const singles = inPeriod.filter((s) => s.policies === 1);
  let bestSale: FeedSale | null = null;
  for (const s of singles.length ? singles : inPeriod) {
    if (!bestSale || s.premiumCents > bestSale.premiumCents || (s.premiumCents === bestSale.premiumCents && s.createdAt < bestSale.createdAt)) bestSale = s;
  }
  const toDate = input.sales.filter((s) => s.soldOn <= to);
  const productionToDate = toDate.reduce((sum, s) => sum + s.premiumCents, 0);
  const goalCents = input.team.goalCents;

  let verdict: WrapVerdict;
  const business = datesOfMonth(monthKeyOf(from)).filter((d) => d >= from && d <= to && isBusinessDay(d));
  if (goalCents <= 0) verdict = { kind: "no_goal" };
  else if (view === "month") {
    // The month against the straight line to the goal, as it stood at the period's end; a month
    // that is over reads as the whole month.
    const p = pace(productionToDate, goalCents, monthClock(input.clock.key, to));
    if (p.status === "done") verdict = { kind: "goal_hit" };
    else if (!current) verdict = { kind: "short", neededCents: goalCents, shortCents: goalCents - productionToDate };
    else if (p.status === "ahead") verdict = { kind: "ahead", byCents: p.aheadCents, expectedCents: p.expectedCents };
    else if (p.status === "behind") verdict = { kind: "behind", byCents: -p.aheadCents, expectedCents: p.expectedCents };
    else verdict = { kind: "on", expectedCents: p.expectedCents };
  } else if (business.length === 0) verdict = { kind: "off_day" };
  else {
    // A week needs its first business day's share for each of its business days so far (a week
    // still running counts through today).
    const perDay = neededOnDay(input, business[0]);
    const neededCents = perDay * business.length;
    if (perDay === 0) verdict = { kind: "goal_hit" };
    else if (teamCents >= neededCents) verdict = { kind: "won", neededCents };
    else verdict = { kind: "short", neededCents, shortCents: neededCents - teamCents };
  }

  return {
    view,
    from,
    to,
    day,
    current,
    teamCents,
    policies,
    verdict,
    lines,
    player,
    bestSale,
    carriers: tally(inPeriod.map((s) => ({ name: s.carrier, count: s.policies }))),
    products: tally(inPeriod.map((s) => ({ name: s.product, count: s.policies }))),
    topCarriers: tally(toDate.map((s) => ({ name: s.carrier, count: s.policies }))).slice(0, 3),
    month: {
      key: input.clock.key,
      policies: toDate.reduce((sum, s) => sum + s.policies, 0),
      goalPct: goalCents > 0 ? Math.round((productionToDate / goalCents) * 100) : 0,
      goalCents,
      productionCents: productionToDate,
    },
  };
}

/** "AHL ×2 · Newbridge" for a line's carriers. */
export function carrierSummary(carriers: WrapCount[]): string {
  return carriers.map((c) => (c.count > 1 ? `${c.name} ×${c.count}` : c.name)).join(" · ");
}
