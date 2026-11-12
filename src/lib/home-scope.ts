import { addDays, pace as paceOf, type MonthClock, type Pace } from "./month";

/**
 * Home's numbers for one scope: Me, a team, the agency (the demo the owner approved on
 * 2026-11-12, its Metrics.board / summary / teams / teamGoalOf, ported). Pure and browser-safe;
 * the page reads the month's life sales once (loadMonthSnapshot) and every card is cut from them
 * here, so Me, the team and the agency always add up the same way.
 *
 * A leaderboard ranks the people who sold (production, then policies, then name); the people on
 * the board without a sale follow by name, unranked. Arrows compare today's ranking with the
 * ranking through yesterday (0 for everyone on the month's first day, null "new" for someone who
 * had not sold by yesterday).
 */

export interface HomePerson {
  id: string;
  name: string;
  active: boolean;
  inOffice: boolean;
}

export interface HomeSale {
  agentId: string;
  premiumCents: number;
  policies: number;
  soldOn: string;
  createdAt?: string;
}

export interface BoardRow {
  id: string;
  name: string;
  active: boolean;
  inOffice: boolean;
  cents: number;
  policies: number;
  todayCents: number;
  todayPolicies: number;
  /** Through yesterday (the arrows). */
  yCents: number;
  yPolicies: number;
  ySold: boolean;
  sold: boolean;
  /** Place among the sellers (null without a sale). */
  rank: number | null;
  /** 1..N over everyone listed (sellers first). */
  place: number;
  /** Places since yesterday: 0 none, +n up, -n down, null "new"; undefined without a sale. */
  change: number | null | undefined;
  /** cents / the leader's cents, 0..1. */
  share: number;
}

export interface HomeBoard {
  rows: BoardRow[];
  sellers: number;
  people: number;
  leaderCents: number;
  totalCents: number;
  totalPolicies: number;
}

const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);

/** Production, then policies, then name (the order every board uses). */
export function rankedBy<T extends { name: string }>(items: T[], cents: (t: T) => number, policies: (t: T) => number): T[] {
  return [...items].sort((a, b) => cents(b) - cents(a) || policies(b) - policies(a) || byName(a, b));
}

/** True for a sale that counts on this month's board as of today. */
const inMonth = (s: HomeSale, month: string, today: string) => s.soldOn.slice(0, 7) === month && s.soldOn <= today;

/**
 * The leaderboard for `ids` (null: everyone): the people on the board, and anyone with a sale this
 * month. `sales` are the month's sales that count (life only while P&C is off).
 */
export function homeBoard({ people, sales, month, today, ids = null }: { people: HomePerson[]; sales: HomeSale[]; month: string; today: string; ids?: Set<string> | null }): HomeBoard {
  const yesterday = addDays(today, -1);
  const firstDay = today <= `${month}-01`;
  const byId = new Map(people.map((p) => [p.id, p]));
  const tally = new Map<string, BoardRow>();
  const get = (p: HomePerson): BoardRow => {
    let t = tally.get(p.id);
    if (!t) {
      t = { id: p.id, name: p.name, active: p.active, inOffice: p.inOffice, cents: 0, policies: 0, todayCents: 0, todayPolicies: 0, yCents: 0, yPolicies: 0, ySold: false, sold: false, rank: null, place: 0, change: undefined, share: 0 };
      tally.set(p.id, t);
    }
    return t;
  };
  for (const p of people) if (p.active && (!ids || ids.has(p.id))) get(p);
  for (const s of sales) {
    if (!inMonth(s, month, today) || (ids && !ids.has(s.agentId))) continue;
    const p = byId.get(s.agentId);
    if (!p) continue;
    const t = get(p);
    const n = s.policies > 0 ? s.policies : 1;
    t.cents += s.premiumCents;
    t.policies += n;
    if (s.soldOn === today) {
      t.todayCents += s.premiumCents;
      t.todayPolicies += n;
    }
    if (s.soldOn <= yesterday) {
      t.yCents += s.premiumCents;
      t.yPolicies += n;
      t.ySold = true;
    }
  }
  const all = [...tally.values()];
  const sellers = rankedBy(
    all.filter((t) => t.policies > 0 || t.cents > 0),
    (t) => t.cents,
    (t) => t.policies,
  );
  const before = new Map<string, number>();
  rankedBy(
    all.filter((t) => t.ySold),
    (t) => t.yCents,
    (t) => t.yPolicies,
  ).forEach((t, i) => before.set(t.id, i + 1));
  const sold = new Set(sellers.map((t) => t.id));
  const none = all.filter((t) => !sold.has(t.id)).sort(byName);
  const lead = sellers.length ? sellers[0].cents : 0;
  const rows: BoardRow[] = [];
  sellers.forEach((t, i) => {
    const was = before.get(t.id);
    rows.push({ ...t, sold: true, rank: i + 1, place: i + 1, change: firstDay ? 0 : was == null ? null : was - (i + 1), share: lead > 0 ? t.cents / lead : 0 });
  });
  none.forEach((t, i) => rows.push({ ...t, sold: false, rank: null, place: sellers.length + i + 1, change: undefined, share: 0 }));
  return {
    rows,
    sellers: sellers.length,
    people: rows.length,
    leaderCents: lead,
    totalCents: sellers.reduce((n, t) => n + t.cents, 0),
    totalPolicies: sellers.reduce((n, t) => n + t.policies, 0),
  };
}

export interface GroupedRow extends BoardRow {
  /** Rank inside its group (the office group, or everyone else); null without a sale. */
  groupRank: number | null;
}

/**
 * In the office first (owner, 2026-11-12: "their numbers should be showing at the top"): the
 * board's rows in two groups, each ranked among itself. `split` is false while nobody listed is
 * marked in the office (one list, "Leaderboard").
 */
export function officeGroups(board: HomeBoard): { split: boolean; office: GroupedRow[]; others: GroupedRow[]; all: GroupedRow[] } {
  const number = (rows: BoardRow[]): GroupedRow[] => {
    let n = 0;
    return rows.map((r) => ({ ...r, groupRank: r.sold ? ++n : null }));
  };
  const split = board.rows.some((r) => r.inOffice);
  if (!split) {
    const all = number(board.rows);
    return { split, office: [], others: all, all };
  }
  const office = number(board.rows.filter((r) => r.inOffice));
  const others = number(board.rows.filter((r) => !r.inOffice));
  return { split, office, others, all: [...office, ...others] };
}

/** The rows around a person on a board: `n` rows, them in the middle where the list allows (Home's "Around you"). */
export function aroundYou<T extends { id: string }>(rows: T[], id: string, n = 7): T[] {
  const at = Math.max(0, rows.findIndex((r) => r.id === id));
  const from = Math.max(0, Math.min(at - Math.floor((n - 1) / 2), rows.length - n));
  return rows.slice(from, from + n);
}

export interface ScopeSummary {
  cents: number;
  /** Policies (a day total from AgentSpace counts its policies). */
  count: number;
  /** Average premium a policy, per year. */
  avgCents: number;
  todayCents: number;
  todayCount: number;
  goalCents: number;
  pace: Pace;
  /** Production against the goal in percent (0 without one; up to 999). */
  pct: number;
}

/** Production, policies, the average, today's part and the pace for the sales of one scope. */
export function scopeSummary({ sales, month, today, goalCents, clock }: { sales: HomeSale[]; month: string; today: string; goalCents: number; clock: MonthClock }): ScopeSummary {
  let cents = 0;
  let count = 0;
  let todayCents = 0;
  let todayCount = 0;
  for (const s of sales) {
    if (!inMonth(s, month, today)) continue;
    const n = s.policies > 0 ? s.policies : 1;
    cents += s.premiumCents;
    count += n;
    if (s.soldOn === today) {
      todayCents += s.premiumCents;
      todayCount += n;
    }
  }
  return {
    cents,
    count,
    avgCents: count ? Math.round(cents / count) : 0,
    todayCents,
    todayCount,
    goalCents,
    pace: paceOf(cents, goalCents, clock),
    pct: goalCents > 0 ? Math.min(999, Math.round((cents / goalCents) * 100)) : 0,
  };
}

/**
 * The goal a team is measured against (the demo's teamGoalOf): the agency's goal when the team is
 * everyone on the board; else its people's goals added up, but only once every one of them has a
 * goal (a partial sum would make the team look further ahead than it is); else none.
 */
export function teamGoalOf({ people, ids, agencyGoalCents, goals }: { people: HomePerson[]; ids: Set<string>; agencyGoalCents: number; goals: Record<string, number> }): { cents: number; people: number; withGoal: number; everyone: boolean } {
  const active = people.filter((p) => p.active);
  const members = active.filter((p) => ids.has(p.id));
  const withGoal = members.filter((p) => (goals[p.id] ?? 0) > 0).length;
  const everyone = members.length > 0 && members.length === active.length;
  let cents = 0;
  if (everyone) cents = agencyGoalCents;
  else if (members.length && withGoal === members.length) cents = members.reduce((n, p) => n + (goals[p.id] ?? 0), 0);
  return { cents, people: members.length, withGoal, everyone };
}

/** A day of the month chart (the shape MonthChart draws: src/lib/snapshot.ts DayPoint). */
export interface ChartDay {
  date: string;
  cents: number;
  policies: number;
  cumulativeCents: number;
  lifeCents: number;
  lifeCumulativeCents: number;
  reached: boolean;
  business: boolean;
}

/** The month chart for one scope: the month's days as given, the running total of `sales` only. */
export function scopeDaily<T extends ChartDay>(days: T[], sales: HomeSale[]): T[] {
  const byDay = new Map<string, { cents: number; policies: number }>();
  for (const s of sales) {
    const d = byDay.get(s.soldOn) ?? { cents: 0, policies: 0 };
    d.cents += s.premiumCents;
    d.policies += s.policies > 0 ? s.policies : 1;
    byDay.set(s.soldOn, d);
  }
  let run = 0;
  return days.map((day) => {
    const d = day.reached ? byDay.get(day.date) : undefined;
    run += d?.cents ?? 0;
    return { ...day, cents: d?.cents ?? 0, policies: d?.policies ?? 0, cumulativeCents: run, lifeCents: d?.cents ?? 0, lifeCumulativeCents: run };
  });
}

export interface TeamRow {
  leaderId: string;
  name: string;
  members: number;
  sellers: number;
  cents: number;
  policies: number;
  rank: number;
  change: number | null;
  share: number;
}

/**
 * Teams (each leader with everyone under them, all levels; the caller passes the confirmed tree's
 * teams): those with a sale this month, ranked like the leaderboard, with places since yesterday.
 */
export function homeTeams({ board, teams, month, today }: { board: HomeBoard; teams: Array<{ leaderId: string; name: string; ids: string[]; members: number }>; month: string; today: string }): TeamRow[] {
  const firstDay = today <= `${month}-01`;
  const byId = new Map(board.rows.map((r) => [r.id, r]));
  const list: Array<Omit<TeamRow, "rank" | "change" | "share"> & { yCents: number; yPolicies: number; ySold: boolean }> = [];
  for (const t of teams) {
    const team = { leaderId: t.leaderId, name: t.name, members: t.members, sellers: 0, cents: 0, policies: 0, yCents: 0, yPolicies: 0, ySold: false };
    for (const id of t.ids) {
      const r = byId.get(id);
      if (!r) continue;
      if (r.sold) {
        team.sellers++;
        team.cents += r.cents;
        team.policies += r.policies;
      }
      if (r.ySold) {
        team.ySold = true;
        team.yCents += r.yCents;
        team.yPolicies += r.yPolicies;
      }
    }
    if (team.sellers > 0) list.push(team);
  }
  const before = new Map<string, number>();
  rankedBy(
    list.filter((t) => t.ySold),
    (t) => t.yCents,
    (t) => t.yPolicies,
  ).forEach((t, i) => before.set(t.leaderId, i + 1));
  const out = rankedBy(
    list,
    (t) => t.cents,
    (t) => t.policies,
  );
  const lead = out.length ? out[0].cents : 0;
  return out.map((t, i) => {
    const was = before.get(t.leaderId);
    return { leaderId: t.leaderId, name: t.name, members: t.members, sellers: t.sellers, cents: t.cents, policies: t.policies, rank: i + 1, change: firstDay ? 0 : was == null ? null : was - (i + 1), share: lead > 0 ? t.cents / lead : 0 };
  });
}

export const PIPELINE_STATUSES = ["Submitted", "Underwriting", "Approved", "Issued", "Declined", "Cancelled"] as const;
export type PipelineStatus = (typeof PIPELINE_STATUSES)[number];

/** The pipeline card: each status's policies and their yearly premium, this month's policies only (a day total from AgentSpace has no status). */
export function pipelineOf(rows: Array<{ status: string | null; premiumCents: number; soldOn: string }>, month: string): { total: number; rows: Array<{ status: PipelineStatus; count: number; cents: number }> } {
  const counts = new Map<string, { count: number; cents: number }>();
  let total = 0;
  for (const r of rows) {
    if (r.soldOn.slice(0, 7) !== month) continue;
    total++;
    if (!r.status) continue;
    const c = counts.get(r.status) ?? { count: 0, cents: 0 };
    c.count++;
    c.cents += r.premiumCents;
    counts.set(r.status, c);
  }
  return { total, rows: PIPELINE_STATUSES.map((status) => ({ status, count: counts.get(status)?.count ?? 0, cents: counts.get(status)?.cents ?? 0 })) };
}

export interface ComingItem<T> {
  policy: T;
  kind: "effective" | "underwriting";
  /** Days until it takes effect, or days in underwriting. */
  days: number;
}

/**
 * "Coming up" on Me: the viewer's policies taking effect in the next 7 days, and the ones in
 * underwriting more than 5 days after they were submitted (those first, the longest first).
 * Declined and cancelled policies are left out.
 */
export function comingUp<T extends { status: string | null; effectiveDate: string | null; soldOn: string }>(rows: T[], today: string): Array<ComingItem<T>> {
  const until = addDays(today, 7);
  const span = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
  const out: Array<ComingItem<T> & { key: string }> = [];
  for (const p of rows) {
    if (p.status === "Declined" || p.status === "Cancelled") continue;
    if (p.effectiveDate && p.effectiveDate >= today && p.effectiveDate <= until) out.push({ policy: p, kind: "effective", days: span(today, p.effectiveDate), key: `1-${p.effectiveDate}` });
    if (p.status === "Underwriting") {
      const n = span(p.soldOn, today);
      if (n > 5) out.push({ policy: p, kind: "underwriting", days: n, key: `0-${String(9999 - n).padStart(4, "0")}` });
    }
  }
  out.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return out.map(({ policy, kind, days }) => ({ policy, kind, days }));
}

export type HomeScopeId = "me" | "team" | "agency";

/**
 * Which scope Home shows (?scope=), and for a team which leader: the viewer's own team, or (an
 * admin) any leader named by ?team=. A scope the viewer does not have falls back to their first.
 */
export function pickHomeScope({
  asked,
  askedTeam,
  scopes,
  pickAnyTeam,
  leaders,
}: {
  asked: unknown;
  askedTeam: unknown;
  scopes: Array<{ id: HomeScopeId; leaderId?: string | null }>;
  pickAnyTeam: boolean;
  leaders: string[];
}): { id: HomeScopeId; leaderId: string | null } {
  const ids = scopes.map((s) => s.id);
  const id: HomeScopeId = typeof asked === "string" && (ids as string[]).includes(asked) ? (asked as HomeScopeId) : ids[0];
  if (id !== "team") return { id, leaderId: null };
  const own = scopes.find((s) => s.id === "team")?.leaderId ?? null;
  if (pickAnyTeam && typeof askedTeam === "string" && leaders.includes(askedTeam)) return { id, leaderId: askedTeam };
  return { id, leaderId: own ?? (pickAnyTeam ? (leaders[0] ?? null) : null) };
}

/** The day with the most premium among `sales` (the earliest on a tie), or null. */
export function bestDayOf(sales: HomeSale[]): { date: string; cents: number } | null {
  const byDay = new Map<string, number>();
  for (const s of sales) byDay.set(s.soldOn, (byDay.get(s.soldOn) ?? 0) + s.premiumCents);
  let best: { date: string; cents: number } | null = null;
  for (const [date, cents] of byDay) if (cents > 0 && (!best || cents > best.cents || (cents === best.cents && date < best.date))) best = { date, cents };
  return best;
}

/** "Nov 1 – 12" (through today in a running month), "Oct 1 – 31" for a finished one. */
export function rangeLabel(month: string, today: string): string {
  const [y, m] = month.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const end = today.slice(0, 7) === month ? Number(today.slice(8)) : today < `${month}-01` ? 1 : last;
  const short = new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-US", { month: "short", timeZone: "UTC" });
  return end === 1 ? `${short} 1` : `${short} 1 – ${end}`;
}
