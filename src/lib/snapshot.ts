import { teamTones } from "@/components/avatar";
import type { SaleWithAgent } from "./data";
import { datesOfMonth, monthClock, pace, type MonthClock, type Pace } from "./month";
import { percentOf } from "./money";
import { DEFAULT_BOARD_THEME, DEFAULT_TV_SCREENS, type Agent, type BoardTheme, type SaleKind, type TvScreens } from "./types";
import { DEFAULT_COLORWAY, type ColorwayKey } from "./colorways";
import { DEFAULT_PC_COLOR, type PcColorKey } from "./pc-colors";
import { DEFAULT_SOUND, type SoundKey } from "./sounds";
import { pcBreakdown, rankOrder, type PcCarrierCount, type PcCount } from "./views";

/**
 * Everything one screen needs for a month, computed in one place so the TV board, the Home page
 * and the month recap always agree. Numbers are cents; dates are Detroit "YYYY-MM-DD". Pure: the
 * loader lives in board.ts (server-only); tests build a snapshot here without a database.
 *
 * Three views (owner, 2026-11-04: "The goal amount ... should be life insurance sales ... a whole
 * separate leaderboard being P&C ... a total added up for the entire agency"): life is the main one
 * (the goal, the pace and the rank), P&C has its own board, and the agency total adds both up.
 */

import type { Scoreboard } from "./scoreboard-types";
import { DEFAULT_AGENCY_NAME } from "./types";
export interface AgentLine {
  id: string;
  name: string;
  /** The avatar tint class (teamTones). */
  tone: string;
  /** Place on the life leaderboard, the main one. */
  rank: number;
  /** Place on the agency total (life and P&C added up). */
  totalRank: number;
  /** Place on the P&C leaderboard; null for someone not P&C licensed with no P&C sale this month. */
  pcRank: number | null;
  /** Life and P&C added up. */
  premiumCents: number;
  policies: number;
  /** The split of `premiumCents` and `policies` (life + pc = the whole). */
  lifeCents: number;
  lifePolicies: number;
  pcCents: number;
  pcPolicies: number;
  /** P&C licensed: Log a sale offers the switch, and they are on the P&C board. */
  pcLicensed: boolean;
  /** Today, all of it, and the life and P&C parts. */
  todayCents: number;
  todayPolicies: number;
  todayLifeCents: number;
  todayPcCents: number;
  /** Their life goal (the board's measure) and their life against it, in percent (0 without one). */
  goalCents: number;
  goalPct: number;
  /** Their P&C goal (0004_pc_goals.sql) and their P&C against it. */
  pcGoalCents: number;
  pcGoalPct: number;
  /** Both goals added up, and life and P&C added up against them (the agency total screen). */
  totalGoalCents: number;
  totalGoalPct: number;
  /** This month's P&C lines, most policies first ("Auto 6 · Home 4"). */
  pcLines: { name: string; policies: number }[];
  lastSaleAt: string | null;
  active: boolean;
  /** 0005_lineage.sql: works in the office (the office group leads every board), and the upline (teams). */
  inOffice: boolean;
  uplineId: string | null;
  /** Rank inside their own group (the office group, or everyone else) by life premium; equals rank while nobody is marked in office. */
  groupRank: number;
}

export interface FeedSale {
  id: string;
  agentId: string;
  agentName: string;
  premiumCents: number;
  policies: number;
  product: string | null;
  carrier: string | null;
  kind: SaleKind;
  note: string | null;
  soldOn: string;
  createdAt: string;
}

export interface DayPoint {
  date: string;
  /** All of the day's premium, and the running total. */
  cents: number;
  policies: number;
  cumulativeCents: number;
  /** The life part of the day, and its running total (the life chart). */
  lifeCents: number;
  lifeCumulativeCents: number;
  /** True for a day the month has reached (today included). */
  reached: boolean;
  business: boolean;
}

export interface MonthSnapshot {
  generatedAt: string;
  /** The deploy that answered (Vercel's commit id; "local" elsewhere): the TV reloads once it changes. */
  build: string;
  clock: MonthClock;
  team: {
    /** Life and P&C added up. */
    productionCents: number;
    /** The life goal, the one the board measures, and life against it in percent. */
    goalCents: number;
    goalPct: number;
    /** The P&C goal (owner, 2026-11-04: "I want this to be able to have a goal as well") and P&C against it. */
    pcGoalCents: number;
    pcGoalPct: number;
    /** Both goals added up, and life and P&C added up against them ("what the numbers would look like if we added them up"). */
    totalGoalCents: number;
    totalGoalPct: number;
    policies: number;
    /** The split of production and policies. */
    lifeCents: number;
    lifePolicies: number;
    pcCents: number;
    pcPolicies: number;
    todayCents: number;
    todayPolicies: number;
    todayLifeCents: number;
    todayLifePolicies: number;
    todayPcCents: number;
    todayPcPolicies: number;
    /** Life against the straight line to its goal; P&C against its own; the total against both. */
    pace: Pace;
    pcPace: Pace;
    totalPace: Pace;
    /** The day with the most production so far, all of it; and the best day for life. */
    bestDay: { date: string; cents: number } | null;
    bestLifeDay: { date: string; cents: number } | null;
    /** Average premium per policy: all, life, P&C. */
    averageCents: number;
    lifeAverageCents: number;
    pcAverageCents: number;
    /** P&C's share of everything written this month, in percent. */
    pcSharePct: number;
    /** The month's P&C by line and by carrier, most policies first. */
    pcByLine: PcCount[];
    pcByCarrier: PcCarrierCount[];
    salesCount: number;
  };
  /** Everyone on the board, in life order (the main leaderboard); `totalRank` and `pcRank` give the others. */
  agents: AgentLine[];
  /** The newest sales across every month, newest first (the board's feed and celebrations). */
  recent: FeedSale[];
  /** This month's life sales and P&C sales, newest first, the latest few (the life and P&C screens' feeds). */
  lifeRecent: FeedSale[];
  pcRecent: FeedSale[];
  /** Every sale of this month, newest first (the Home list, where a sale is fixed or removed). */
  sales: FeedSale[];
  daily: DayPoint[];
  message: string;
  /** The colorway the owner picked (the TV applies it on each poll). */
  colorway: ColorwayKey;
  /** P&C's color the owner picked (the TV applies it on each poll). */
  pcColor: PcColorKey;
  /** The TV look the owner picked, dark or light (the TV applies it on each poll). */
  boardTheme: BoardTheme;
  /** The sound the TV plays with a celebration (Settings > Sale sound); "off" for none. */
  sound: SoundKey;
  /** Rotate the TV's three screens, or keep it on one (Settings > TV screens). */
  tvScreens: TvScreens;
  /** The agency's name (Settings); the TV header and the lockup show it. */
  agencyName: string;
  /** False: life only. No P&C or life + P&C total anywhere, and P&C sales and goals do not count (the loader drops them). */
  pcEnabled: boolean;
  /** The CRM-style analytics for this month (src/lib/scoreboard.ts); null when not loaded. */
  scoreboard: Scoreboard | null;
}

function toFeed(s: SaleWithAgent): FeedSale {
  return {
    id: s.id,
    agentId: s.agent_id,
    agentName: s.agent_name,
    premiumCents: s.premium_cents,
    policies: s.policies,
    product: s.product,
    carrier: s.carrier,
    kind: s.kind,
    note: s.note,
    soldOn: s.sold_on,
    createdAt: s.created_at,
  };
}

/** How many sales the life and P&C screens' feeds carry. */
const PC_RECENT = 6;

const sum = (rows: SaleWithAgent[], f: (s: SaleWithAgent) => number) => rows.reduce((n, s) => n + f(s), 0);

/** The day with the most premium among `rows`, or null. */
function bestDayOf(rows: SaleWithAgent[]): { date: string; cents: number } | null {
  const byDay = new Map<string, number>();
  for (const s of rows) byDay.set(s.sold_on, (byDay.get(s.sold_on) ?? 0) + s.premium_cents);
  let best: { date: string; cents: number } | null = null;
  for (const [date, cents] of byDay) if (cents > 0 && (!best || cents > best.cents || (cents === best.cents && date < best.date))) best = { date, cents };
  return best;
}

/** What `buildSnapshot` reads: the month's loaded rows and the settings that ride the snapshot. */
export interface SnapshotInput {
  month: string;
  today: string;
  agents: Agent[];
  sales: SaleWithAgent[];
  goals: { teamCents: number; byAgent: Record<string, number>; pcTeamCents?: number; pcByAgent?: Record<string, number> };
  recent: SaleWithAgent[];
  message: string;
  colorway?: ColorwayKey;
  pcColor?: PcColorKey;
  boardTheme?: BoardTheme;
  sound?: SoundKey;
  tvScreens?: TvScreens;
  agencyName?: string;
  pcEnabled?: boolean;
  scoreboard?: Scoreboard | null;
  generatedAt?: string;
}

/**
 * Life only (owner, 2026-11-12: "This is only gonna be life insurance"): the same input with
 * every P&C sale (the month's and the recent ones), every P&C goal and the P&C licensing taken
 * out before any math, and a TV kept on the P&C or the total screen sent back to the leaderboard.
 * The loader runs it while Settings has P&C off; the P&C rows stay in the database.
 */
export function lifeOnlyInput<T extends SnapshotInput>(input: T): T {
  const life = (s: SaleWithAgent) => s.kind !== "pc";
  return {
    ...input,
    agents: input.agents.map((a) => (a.pc_licensed ? { ...a, pc_licensed: false } : a)),
    sales: input.sales.filter(life),
    recent: input.recent.filter(life),
    goals: { teamCents: input.goals.teamCents, byAgent: input.goals.byAgent, pcTeamCents: 0, pcByAgent: {} },
    tvScreens: input.tvScreens === "pc" || input.tvScreens === "total" ? "life" : input.tvScreens,
    pcEnabled: false,
  };
}

/** Pure: the snapshot from loaded rows (tests build it without a database). */
export function buildSnapshot(input: SnapshotInput): MonthSnapshot {
  const { month, today, agents, sales, goals, recent, message } = input;
  const clock = monthClock(month, today);
  const tones = teamTones(agents);

  const lifeSales = sales.filter((s) => s.kind !== "pc");
  const pcSales = sales.filter((s) => s.kind === "pc");
  const productionCents = sum(sales, (s) => s.premium_cents);
  const policies = sum(sales, (s) => s.policies);
  const lifeCents = sum(lifeSales, (s) => s.premium_cents);
  const lifePolicies = sum(lifeSales, (s) => s.policies);
  const pcCents = productionCents - lifeCents;
  const pcPolicies = policies - lifePolicies;
  const todaySales = sales.filter((s) => s.sold_on === today);
  const todayPc = todaySales.filter((s) => s.kind === "pc");

  const byDay = new Map<string, { cents: number; policies: number; life: number }>();
  for (const s of sales) {
    const d = byDay.get(s.sold_on) ?? { cents: 0, policies: 0, life: 0 };
    d.cents += s.premium_cents;
    d.policies += s.policies;
    if (s.kind !== "pc") d.life += s.premium_cents;
    byDay.set(s.sold_on, d);
  }
  let running = 0;
  let lifeRunning = 0;
  const daily: DayPoint[] = datesOfMonth(month).map((date) => {
    const d = byDay.get(date) ?? { cents: 0, policies: 0, life: 0 };
    running += d.cents;
    lifeRunning += d.life;
    const w = new Date(`${date}T12:00:00Z`).getUTCDay();
    return { date, cents: d.cents, policies: d.policies, cumulativeCents: running, lifeCents: d.life, lifeCumulativeCents: lifeRunning, reached: date <= today, business: w >= 1 && w <= 5 };
  });

  interface Tally {
    premium: number;
    policies: number;
    pcCents: number;
    pcPolicies: number;
    todayCents: number;
    todayPolicies: number;
    todayPcCents: number;
    pcLines: Map<string, number>;
    last: string | null;
  }
  const empty = (): Tally => ({ premium: 0, policies: 0, pcCents: 0, pcPolicies: 0, todayCents: 0, todayPolicies: 0, todayPcCents: 0, pcLines: new Map(), last: null });
  const perAgent = new Map<string, Tally>();
  for (const s of sales) {
    const a = perAgent.get(s.agent_id) ?? empty();
    a.premium += s.premium_cents;
    a.policies += s.policies;
    if (s.kind === "pc") {
      a.pcCents += s.premium_cents;
      a.pcPolicies += s.policies;
      const line = s.product?.trim() || "Other";
      a.pcLines.set(line, (a.pcLines.get(line) ?? 0) + s.policies);
    }
    if (s.sold_on === today) {
      a.todayCents += s.premium_cents;
      a.todayPolicies += s.policies;
      if (s.kind === "pc") a.todayPcCents += s.premium_cents;
    }
    if (!a.last || s.created_at > a.last) a.last = s.created_at;
    perAgent.set(s.agent_id, a);
  }
  // Active people always have a line (a zero is a line too); a removed person only while they have sales this month.
  const lines = agents
    .filter((a) => a.active || perAgent.has(a.id))
    .map((a) => {
      const p = perAgent.get(a.id) ?? empty();
      const goalCents = goals.byAgent[a.id] ?? 0;
      const pcGoalCents = goals.pcByAgent?.[a.id] ?? 0;
      return {
        id: a.id,
        name: a.name,
        tone: tones[a.id],
        premiumCents: p.premium,
        policies: p.policies,
        lifeCents: p.premium - p.pcCents,
        lifePolicies: p.policies - p.pcPolicies,
        pcCents: p.pcCents,
        pcPolicies: p.pcPolicies,
        pcLicensed: a.pc_licensed,
        todayCents: p.todayCents,
        todayPolicies: p.todayPolicies,
        todayLifeCents: p.todayCents - p.todayPcCents,
        todayPcCents: p.todayPcCents,
        goalCents,
        goalPct: percentOf(p.premium - p.pcCents, goalCents),
        pcGoalCents,
        pcGoalPct: percentOf(p.pcCents, pcGoalCents),
        totalGoalCents: goalCents + pcGoalCents,
        totalGoalPct: percentOf(p.premium, goalCents + pcGoalCents),
        pcLines: [...p.pcLines.entries()].map(([name, n]) => ({ name, policies: n })).sort((x, y) => y.policies - x.policies || x.name.localeCompare(y.name)),
        lastSaleAt: p.last,
        active: a.active,
        inOffice: a.in_office === true,
        // A picked upline that waits to be confirmed puts nobody on a team (0006).
        uplineId: a.upline_confirmed === false ? null : (a.upline_id ?? null),
      };
    });
  // Three orders: life (the main board), all of it added up, and P&C for the people who write it.
  // The life board shows the people on the board and anyone with life this month; someone off the
  // board with only P&C ranks after them, so the numbers it shows never skip one.
  const onLife = (l: (typeof lines)[number]) => l.active || l.lifeCents > 0;
  const lifeOrder = [...rankOrder(lines.filter(onLife), (l) => l.lifeCents, (l) => l.lifePolicies), ...rankOrder(lines.filter((l) => !onLife(l)), (l) => l.lifeCents, (l) => l.lifePolicies)];
  const totalRank = new Map(rankOrder(lines, (l) => l.premiumCents, (l) => l.policies).map((l, i) => [l.id, i + 1]));
  const pcRank = new Map(
    rankOrder(
      lines.filter((l) => (l.pcLicensed && l.active) || l.pcCents > 0 || l.pcPolicies > 0),
      (l) => l.pcCents,
      (l) => l.pcPolicies,
    ).map((l, i) => [l.id, i + 1]),
  );
  // In the office first (owner, 2026-11-12): the office group is ranked 1..n among themselves, then
  // everyone else among themselves. While nobody is marked in office, everyone is one group.
  const anyOffice = lifeOrder.some((l) => l.inOffice);
  let officeSeen = 0;
  let restSeen = 0;
  const agentLines: AgentLine[] = lifeOrder.map((l, i) => ({
    ...l,
    rank: i + 1,
    groupRank: !anyOffice ? i + 1 : l.inOffice ? ++officeSeen : ++restSeen,
    totalRank: totalRank.get(l.id) ?? i + 1,
    pcRank: pcRank.get(l.id) ?? null,
  }));

  const pcGoalCents = goals.pcTeamCents ?? 0;
  const pc = pcBreakdown(pcSales.map((s) => ({ kind: s.kind, carrier: s.carrier, product: s.product, policies: s.policies, premiumCents: s.premium_cents })));
  const newestFirst = (a: SaleWithAgent, b: SaleWithAgent) => b.created_at.localeCompare(a.created_at);

  return {
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    build: process.env.VERCEL_GIT_COMMIT_SHA || process.env.VERCEL_DEPLOYMENT_ID || "local",
    clock,
    team: {
      productionCents,
      goalCents: goals.teamCents,
      goalPct: percentOf(lifeCents, goals.teamCents),
      pcGoalCents,
      pcGoalPct: percentOf(pcCents, pcGoalCents),
      totalGoalCents: goals.teamCents + pcGoalCents,
      totalGoalPct: percentOf(productionCents, goals.teamCents + pcGoalCents),
      policies,
      lifeCents,
      lifePolicies,
      pcCents,
      pcPolicies,
      todayCents: sum(todaySales, (s) => s.premium_cents),
      todayPolicies: sum(todaySales, (s) => s.policies),
      todayLifeCents: sum(todaySales, (s) => s.premium_cents) - sum(todayPc, (s) => s.premium_cents),
      todayLifePolicies: sum(todaySales, (s) => s.policies) - sum(todayPc, (s) => s.policies),
      todayPcCents: sum(todayPc, (s) => s.premium_cents),
      todayPcPolicies: sum(todayPc, (s) => s.policies),
      pace: pace(lifeCents, goals.teamCents, clock),
      pcPace: pace(pcCents, pcGoalCents, clock),
      totalPace: pace(productionCents, goals.teamCents + pcGoalCents, clock),
      bestDay: bestDayOf(sales),
      bestLifeDay: bestDayOf(lifeSales),
      averageCents: policies > 0 ? Math.round(productionCents / policies) : 0,
      lifeAverageCents: lifePolicies > 0 ? Math.round(lifeCents / lifePolicies) : 0,
      pcAverageCents: pcPolicies > 0 ? Math.round(pcCents / pcPolicies) : 0,
      pcSharePct: productionCents > 0 ? Math.round((pcCents / productionCents) * 100) : 0,
      pcByLine: pc.lines,
      pcByCarrier: pc.carriers,
      salesCount: sales.length,
    },
    agents: agentLines,
    recent: recent.map(toFeed),
    lifeRecent: [...lifeSales].sort(newestFirst).slice(0, PC_RECENT).map(toFeed),
    pcRecent: [...pcSales].sort(newestFirst).slice(0, PC_RECENT).map(toFeed),
    sales: [...sales].sort(newestFirst).map(toFeed),
    daily,
    message,
    colorway: input.colorway ?? DEFAULT_COLORWAY,
    pcColor: input.pcColor ?? DEFAULT_PC_COLOR,
    boardTheme: input.boardTheme ?? DEFAULT_BOARD_THEME,
    sound: input.sound ?? DEFAULT_SOUND,
    tvScreens: input.tvScreens ?? DEFAULT_TV_SCREENS,
    agencyName: input.agencyName ?? DEFAULT_AGENCY_NAME,
    pcEnabled: input.pcEnabled ?? false,
    scoreboard: input.scoreboard ?? null,
  };
}
