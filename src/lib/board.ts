import "server-only";
import { teamTones } from "@/components/avatar";
import { goalsForMonth, listAgents, recentSales, salesForMonth, getSettings, type SaleWithAgent } from "./data";
import { datesOfMonth, monthClock, pace, todayInDetroit, type MonthClock, type Pace } from "./month";
import { percentOf } from "./money";
import type { Agent } from "./types";
import { DEFAULT_COLORWAY, type ColorwayKey } from "./colorways";

/**
 * Everything one screen needs for a month, computed in one place so the TV board, the Home page
 * and the month recap always agree. Numbers are cents; dates are Detroit "YYYY-MM-DD".
 */

export interface AgentLine {
  id: string;
  name: string;
  /** The avatar tint class (teamTones). */
  tone: string;
  rank: number;
  premiumCents: number;
  policies: number;
  todayCents: number;
  todayPolicies: number;
  goalCents: number;
  /** Percent of their own goal (0 when they have none). */
  goalPct: number;
  /** Share of the team's production, 0 to 1. */
  share: number;
  lastSaleAt: string | null;
  active: boolean;
}

export interface FeedSale {
  id: string;
  agentId: string;
  agentName: string;
  premiumCents: number;
  policies: number;
  product: string | null;
  client: string | null;
  note: string | null;
  soldOn: string;
  createdAt: string;
}

export interface DayPoint {
  date: string;
  cents: number;
  policies: number;
  cumulativeCents: number;
  /** True for a day the month has reached (today included). */
  reached: boolean;
  business: boolean;
}

export interface MonthSnapshot {
  generatedAt: string;
  clock: MonthClock;
  team: {
    productionCents: number;
    goalCents: number;
    goalPct: number;
    policies: number;
    todayCents: number;
    todayPolicies: number;
    pace: Pace;
    /** The day with the most production so far. */
    bestDay: { date: string; cents: number } | null;
    /** Average premium per policy. */
    averageCents: number;
    salesCount: number;
  };
  agents: AgentLine[];
  /** The newest sales across every month, newest first (the board's feed and celebrations). */
  recent: FeedSale[];
  /** Every sale of this month, newest first (the Home list, where a sale is fixed or removed). */
  sales: FeedSale[];
  daily: DayPoint[];
  message: string;
  /** The colorway the owner picked (the TV applies it on each poll). */
  colorway: ColorwayKey;
}

function toFeed(s: SaleWithAgent): FeedSale {
  return {
    id: s.id,
    agentId: s.agent_id,
    agentName: s.agent_name,
    premiumCents: s.premium_cents,
    policies: s.policies,
    product: s.product,
    client: s.client,
    note: s.note,
    soldOn: s.sold_on,
    createdAt: s.created_at,
  };
}

/** The leaderboard order: most premium, then most policies, then the earliest first sale, then name. */
export function rankAgents(lines: Omit<AgentLine, "rank">[]): AgentLine[] {
  const sorted = [...lines].sort((a, b) => b.premiumCents - a.premiumCents || b.policies - a.policies || a.name.localeCompare(b.name));
  return sorted.map((l, i) => ({ ...l, rank: i + 1 }));
}

export async function loadMonthSnapshot(month: string, opts: { today?: string; recentLimit?: number } = {}): Promise<MonthSnapshot> {
  const today = opts.today ?? todayInDetroit();
  const [agents, sales, goals, recent, settings] = await Promise.all([
    listAgents({ includeInactive: true }),
    salesForMonth(month),
    goalsForMonth(month),
    recentSales(opts.recentLimit ?? 12),
    getSettings(),
  ]);
  return buildSnapshot({ month, today, agents, sales, goals, recent, message: settings.message, colorway: settings.colorway });
}

/** Pure: the snapshot from loaded rows (tests build it without a database). */
export function buildSnapshot(input: {
  month: string;
  today: string;
  agents: Agent[];
  sales: SaleWithAgent[];
  goals: { teamCents: number; byAgent: Record<string, number> };
  recent: SaleWithAgent[];
  message: string;
  colorway?: ColorwayKey;
  generatedAt?: string;
}): MonthSnapshot {
  const { month, today, agents, sales, goals, recent, message } = input;
  const clock = monthClock(month, today);
  const tones = teamTones(agents);

  const productionCents = sales.reduce((n, s) => n + s.premium_cents, 0);
  const policies = sales.reduce((n, s) => n + s.policies, 0);
  const todaySales = sales.filter((s) => s.sold_on === today);
  const todayCents = todaySales.reduce((n, s) => n + s.premium_cents, 0);
  const todayPolicies = todaySales.reduce((n, s) => n + s.policies, 0);

  const byDay = new Map<string, { cents: number; policies: number }>();
  for (const s of sales) {
    const d = byDay.get(s.sold_on) ?? { cents: 0, policies: 0 };
    d.cents += s.premium_cents;
    d.policies += s.policies;
    byDay.set(s.sold_on, d);
  }
  let running = 0;
  const daily: DayPoint[] = datesOfMonth(month).map((date) => {
    const d = byDay.get(date) ?? { cents: 0, policies: 0 };
    running += d.cents;
    const w = new Date(`${date}T12:00:00Z`).getUTCDay();
    return { date, cents: d.cents, policies: d.policies, cumulativeCents: running, reached: date <= today, business: w >= 1 && w <= 5 };
  });
  let bestDay: MonthSnapshot["team"]["bestDay"] = null;
  for (const [date, d] of byDay) if (d.cents > 0 && (!bestDay || d.cents > bestDay.cents)) bestDay = { date, cents: d.cents };

  const perAgent = new Map<string, { premium: number; policies: number; todayCents: number; todayPolicies: number; last: string | null }>();
  for (const s of sales) {
    const a = perAgent.get(s.agent_id) ?? { premium: 0, policies: 0, todayCents: 0, todayPolicies: 0, last: null };
    a.premium += s.premium_cents;
    a.policies += s.policies;
    if (s.sold_on === today) {
      a.todayCents += s.premium_cents;
      a.todayPolicies += s.policies;
    }
    if (!a.last || s.created_at > a.last) a.last = s.created_at;
    perAgent.set(s.agent_id, a);
  }
  // Active people always have a line (a zero is a line too); a removed person only while they have sales this month.
  const lines = agents
    .filter((a) => a.active || perAgent.has(a.id))
    .map((a) => {
      const p = perAgent.get(a.id) ?? { premium: 0, policies: 0, todayCents: 0, todayPolicies: 0, last: null };
      const goalCents = goals.byAgent[a.id] ?? 0;
      return {
        id: a.id,
        name: a.name,
        tone: tones[a.id],
        premiumCents: p.premium,
        policies: p.policies,
        todayCents: p.todayCents,
        todayPolicies: p.todayPolicies,
        goalCents,
        goalPct: percentOf(p.premium, goalCents),
        share: productionCents > 0 ? p.premium / productionCents : 0,
        lastSaleAt: p.last,
        active: a.active,
      };
    });

  return {
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    clock,
    team: {
      productionCents,
      goalCents: goals.teamCents,
      goalPct: percentOf(productionCents, goals.teamCents),
      policies,
      todayCents,
      todayPolicies,
      pace: pace(productionCents, goals.teamCents, clock),
      bestDay,
      averageCents: policies > 0 ? Math.round(productionCents / policies) : 0,
      salesCount: sales.length,
    },
    agents: rankAgents(lines),
    recent: recent.map(toFeed),
    sales: [...sales].sort((a, b) => b.created_at.localeCompare(a.created_at)).map(toFeed),
    daily,
    message,
    colorway: input.colorway ?? DEFAULT_COLORWAY,
  };
}
