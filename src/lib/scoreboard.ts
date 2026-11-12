import { teamTones } from "@/components/avatar";
import { addDays, addMonths, daysInMonth, monthKeyOf } from "./month";
import { buildOrg } from "./org";
import type { Agent } from "./types";
import type { ScoreBucket, ScoreMover, ScoreRow, ScoreSale, ScoreStand, ScoreTeam, Scoreboard } from "./scoreboard-types";

/**
 * The Scoreboard's numbers (owner, 2026-11-12: the agency's CRM analytics, "matched exactly"):
 * the three top numbers against the same days of the month before, where agents stand, who moved
 * most this week, the production leaderboard by day, product and carrier, and the teams.
 * Pure: one pass over the sales, maps by id (70 people and 6,000 sales build in a few
 * milliseconds). Money is cents, dates are Detroit "YYYY-MM-DD". Life sales only reach it.
 */

const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Nov 1": a day column's header. */
export function shortDay(date: string): string {
  return `${MONTHS_SHORT[Number(date.slice(5, 7)) - 1]} ${Number(date.slice(8, 10))}`;
}

/** "Nov 1 – 11"; one day "Nov 1"; across two months "Oct 28 – Nov 3". */
export function rangeLabel(from: string, to: string): string {
  if (from === to) return shortDay(from);
  if (from.slice(0, 7) === to.slice(0, 7)) return `${shortDay(from)} – ${Number(to.slice(8, 10))}`;
  return `${shortDay(from)} – ${shortDay(to)}`;
}

/** Every day from..to, oldest first (empty when `to` is before `from`). */
export function daysOfRange(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to && out.length < 400; d = addDays(d, 1)) out.push(d);
  return out;
}

/**
 * The range to compare with: the same day numbers of the month before, cut at that month's end
 * (Oct 1 – 31 compares with Sep 1 – 30). A range that crosses a month edge compares with the
 * same number of days just before it.
 */
export function compareRange(from: string, to: string): { from: string; to: string; label: string } {
  if (from.slice(0, 7) !== to.slice(0, 7)) {
    const n = daysOfRange(from, to).length;
    const cTo = addDays(from, -1);
    const cFrom = addDays(cTo, -(Math.max(1, n) - 1));
    return { from: cFrom, to: cTo, label: rangeLabel(cFrom, cTo) };
  }
  const prev = addMonths(monthKeyOf(from), -1);
  const [y, m] = prev.split("-").map(Number);
  const last = daysInMonth(y, m);
  const d1 = Math.min(Number(from.slice(8, 10)), last);
  const d2 = Math.max(d1, Math.min(Number(to.slice(8, 10)), last));
  const day = (d: number) => `${prev}-${String(d).padStart(2, "0")}`;
  return { from: day(d1), to: day(d2), label: rangeLabel(day(d1), day(d2)) };
}

/** The ranges' steps, in dollars: the smallest one whose four steps reach the 90th percentile is used. */
const NICE_STEPS = [500, 1_000, 2_000, 2_500, 5_000, 10_000, 20_000, 25_000, 50_000, 100_000];

function niceStep(dollars: number): number {
  for (const s of NICE_STEPS) if (s * 4 >= dollars) return s;
  // Past $400K a person: keep the same 2 / 2.5 / 5 / 10 ladder, a power of ten at a time.
  for (let unit = 100_000; unit < 1e12; unit *= 10) for (const k of [2, 2.5, 5, 10]) if (unit * k * 4 >= dollars) return unit * k;
  return 1e12;
}

/** "$2K", "$2.5K", "$500", "$1M": the ranges' edges, like the CRM. */
function edgeLabel(dollars: number): string {
  const trim = (n: number) => String(Math.round(n * 100) / 100);
  if (dollars >= 1_000_000) return `$${trim(dollars / 1_000_000)}M`;
  if (dollars >= 1_000) return `$${trim(dollars / 1_000)}K`;
  return `$${dollars}`;
}

/**
 * "Where agents stand": the sellers' totals (cents) in five ranges, and the middle agent. The
 * middle of an even count is the lower of the two middle agents, so it is a real person's number.
 */
export function standOf(totalsCents: number[]): ScoreStand {
  const sorted = [...totalsCents].sort((a, b) => a - b);
  const n = sorted.length;
  const medianCents = n ? sorted[Math.floor((n - 1) / 2)] : 0;
  const p90 = n ? sorted[Math.max(0, Math.ceil(n * 0.9) - 1)] : 0;
  const step = n ? niceStep(p90 / 100) : 2_000;
  const counts = [0, 0, 0, 0, 0];
  for (const t of sorted) counts[Math.min(4, Math.max(0, Math.floor(t / (step * 100))))]++;
  const buckets: ScoreBucket[] = counts.map((count, i) => ({
    label: i === 0 ? `Under ${edgeLabel(step)}` : i === 4 ? `${edgeLabel(step * 4)}+` : `${edgeLabel(step * i)}–${edgeLabel(step * (i + 1))}`,
    count,
  }));
  return { agents: n, medianCents, buckets };
}

interface Tally {
  id: string;
  name: string;
  /** In the range. */
  cents: number;
  policies: number;
  sold: boolean;
  byDay: Record<string, number>;
  byProduct: Record<string, number>;
  byCarrier: Record<string, number>;
  /** In the range, through yesterday (the ranking the arrows compare with). */
  yCents: number;
  yPolicies: number;
  ySold: boolean;
  /** In the comparison range. */
  prevCents: number;
  prevPolicies: number;
  prevSold: boolean;
  /** The 7 days ending today, and the 7 days before them. */
  nowCents: number;
  wasCents: number;
}

const add = (into: Record<string, number>, key: string, cents: number) => {
  into[key] = (into[key] ?? 0) + cents;
};

/** Most production, then most policies, then the name: every leaderboard's order. */
function ranked<T extends { name: string }>(items: T[], cents: (t: T) => number, policies: (t: T) => number): T[] {
  return [...items].sort((a, b) => cents(b) - cents(a) || policies(b) - policies(a) || a.name.localeCompare(b.name));
}

/** Column order for a category: most production first, then the name. */
function columnOrder(totals: Record<string, number>): string[] {
  return Object.keys(totals).sort((a, b) => totals[b] - totals[a] || a.localeCompare(b));
}

export function buildScoreboard(input: {
  /** Everyone, removed people included (their sales still count for their team). */
  agents: Agent[];
  /** Life sales, not deleted, from the first day of the month before `from` through `to`. */
  sales: ScoreSale[];
  from: string;
  to: string;
  today: string;
  /** A leader's id: everything (the top numbers too) narrows to that leader and everyone below. */
  leaderId?: string | null;
  agencyName: string;
  generatedAt?: string;
}): Scoreboard {
  const { agents, sales, from, to, today } = input;
  const org = buildOrg(agents);
  const tones = teamTones(agents);
  const byId = new Map<string, Agent>();
  for (const a of agents) byId.set(a.id, a);

  const leaderId = input.leaderId || null;
  const leader = leaderId ? byId.get(leaderId) : undefined;
  const scope: Scoreboard["scope"] = leaderId ? "team" : "agency";
  const inScope: Set<string> | null = leaderId ? new Set(leader ? org.teamOf(leaderId) : []) : null;
  const scopeName = leaderId ? (leader ? `${leader.name}'s team` : "This team") : input.agencyName;

  const days = daysOfRange(from, to);
  const dayIndex = new Map<string, number>();
  days.forEach((d, i) => dayIndex.set(d, i));
  const compare = compareRange(from, to);

  // The arrows: the ranking through yesterday. On the range's first day there is no yesterday to
  // compare with (everyone reads "no change"); once the range is over, yesterday's ranking is the final one.
  const yesterday = addDays(today, -1);
  const firstDay = today <= from;
  // "This week" ends today, or on the range's last day for a month that is over.
  const anchor = today < to ? today : to;
  const nowFrom = addDays(anchor, -6);
  const wasFrom = addDays(anchor, -13);

  const tallies = new Map<string, Tally>();
  const dailyCents = days.map(() => 0);
  const productTotals: Record<string, number> = {};
  const carrierTotals: Record<string, number> = {};

  for (const s of sales) {
    if (inScope ? !inScope.has(s.agent_id) : !byId.has(s.agent_id)) continue;
    const d = s.sold_on;
    const counts = s.premium_cents > 0 || s.policies > 0;
    let t = tallies.get(s.agent_id);
    if (!t) {
      t = { id: s.agent_id, name: byId.get(s.agent_id)?.name ?? "Someone", cents: 0, policies: 0, sold: false, byDay: {}, byProduct: {}, byCarrier: {}, yCents: 0, yPolicies: 0, ySold: false, prevCents: 0, prevPolicies: 0, prevSold: false, nowCents: 0, wasCents: 0 };
      tallies.set(s.agent_id, t);
    }
    if (d >= from && d <= to) {
      t.cents += s.premium_cents;
      t.policies += s.policies;
      if (counts) t.sold = true;
      if (s.premium_cents !== 0) {
        add(t.byDay, d, s.premium_cents);
        const product = s.product?.trim() || "Other";
        const carrier = s.carrier?.trim() || "Other";
        add(t.byProduct, product, s.premium_cents);
        add(t.byCarrier, carrier, s.premium_cents);
        add(productTotals, product, s.premium_cents);
        add(carrierTotals, carrier, s.premium_cents);
        dailyCents[dayIndex.get(d)!] += s.premium_cents;
      }
      if (d <= yesterday) {
        t.yCents += s.premium_cents;
        t.yPolicies += s.policies;
        if (counts) t.ySold = true;
      }
    }
    if (d >= compare.from && d <= compare.to) {
      t.prevCents += s.premium_cents;
      t.prevPolicies += s.policies;
      if (counts) t.prevSold = true;
    }
    if (d >= wasFrom && d <= anchor) {
      if (d >= nowFrom) t.nowCents += s.premium_cents;
      else t.wasCents += s.premium_cents;
    }
  }

  const all = [...tallies.values()];
  const sellers = ranked(all.filter((t) => t.sold), (t) => t.cents, (t) => t.policies);
  const rankNow = new Map<string, number>();
  sellers.forEach((t, i) => rankNow.set(t.id, i + 1));
  const rankBefore = new Map<string, number>();
  ranked(all.filter((t) => t.ySold), (t) => t.yCents, (t) => t.yPolicies).forEach((t, i) => rankBefore.set(t.id, i + 1));
  const changeOf = (id: string, now: number, before: Map<string, number>): number | null => {
    if (firstDay) return 0;
    const was = before.get(id);
    return was == null ? null : was - now;
  };

  const rows: ScoreRow[] = sellers.map((t, i) => {
    const a = byId.get(t.id);
    const uplineId = a ? org.uplineOf(t.id) : null;
    return {
      agentId: t.id,
      name: t.name,
      tone: tones[t.id] ?? "",
      inOffice: a?.in_office === true,
      uplineId,
      uplineName: uplineId ? org.nameOf(uplineId) : null,
      rank: i + 1,
      rankChange: changeOf(t.id, i + 1, rankBefore),
      policies: t.policies,
      totalCents: t.cents,
      byDay: t.byDay,
      byProduct: t.byProduct,
      byCarrier: t.byCarrier,
    };
  });

  // The top numbers and the two small charts.
  let productionCents = 0;
  let policies = 0;
  let prevProductionCents = 0;
  let prevPolicies = 0;
  let prevActiveAgents = 0;
  const dailyActiveAgents = days.map(() => 0);
  for (const t of all) {
    productionCents += t.cents;
    policies += t.policies;
    prevProductionCents += t.prevCents;
    prevPolicies += t.prevPolicies;
    if (t.prevSold) prevActiveAgents++;
    for (const d in t.byDay) if (t.byDay[d] > 0) dailyActiveAgents[dayIndex.get(d)!]++;
  }

  // Moved most: the biggest gains and the biggest drops, three each; someone who did not move is in neither.
  const moved: ScoreMover[] = all
    .filter((t) => t.nowCents !== t.wasCents)
    .map((t) => ({ agentId: t.id, name: t.name, nowCents: t.nowCents, wasCents: t.wasCents, deltaCents: t.nowCents - t.wasCents }));
  const up = moved.filter((m) => m.deltaCents > 0).sort((a, b) => b.deltaCents - a.deltaCents || a.name.localeCompare(b.name)).slice(0, 3);
  const down = moved.filter((m) => m.deltaCents < 0).sort((a, b) => a.deltaCents - b.deltaCents || a.name.localeCompare(b.name)).slice(0, 3);
  const moversLabel = anchor === today ? "Last 7 days vs the 7 days before" : `${rangeLabel(nowFrom, anchor)} vs ${rangeLabel(wasFrom, addDays(nowFrom, -1))}`;

  // Teams: each leader in scope with everyone below, all levels, added up.
  interface TeamTally { leaderId: string; name: string; members: number; activeAgents: number; cents: number; policies: number; yCents: number; yPolicies: number; ySold: boolean; byDay: Record<string, number>; byProduct: Record<string, number>; byCarrier: Record<string, number>; memberIds: string[] }
  const teamTallies: TeamTally[] = [];
  for (const id of org.leaders()) {
    if (inScope && !inScope.has(id)) continue;
    const team: TeamTally = { leaderId: id, name: org.nameOf(id) ?? "Someone", members: org.membersOf(id).length, activeAgents: 0, cents: 0, policies: 0, yCents: 0, yPolicies: 0, ySold: false, byDay: {}, byProduct: {}, byCarrier: {}, memberIds: [] };
    for (const m of org.teamOf(id)) {
      const t = tallies.get(m);
      if (!t) continue;
      if (t.ySold) {
        team.ySold = true;
        team.yCents += t.yCents;
        team.yPolicies += t.yPolicies;
      }
      if (!t.sold) continue;
      team.activeAgents++;
      team.cents += t.cents;
      team.policies += t.policies;
      team.memberIds.push(m);
      for (const d in t.byDay) add(team.byDay, d, t.byDay[d]);
      for (const p in t.byProduct) add(team.byProduct, p, t.byProduct[p]);
      for (const c in t.byCarrier) add(team.byCarrier, c, t.byCarrier[c]);
    }
    if (team.activeAgents === 0) continue;
    team.memberIds.sort((a, b) => rankNow.get(a)! - rankNow.get(b)!);
    teamTallies.push(team);
  }
  const teamBefore = new Map<string, number>();
  ranked(teamTallies.filter((t) => t.ySold), (t) => t.yCents, (t) => t.yPolicies).forEach((t, i) => teamBefore.set(t.leaderId, i + 1));
  const teams: ScoreTeam[] = ranked(teamTallies, (t) => t.cents, (t) => t.policies).map((t, i) => ({
    leaderId: t.leaderId,
    name: t.name,
    members: t.members,
    activeAgents: t.activeAgents,
    rank: i + 1,
    rankChange: changeOf(t.leaderId, i + 1, teamBefore),
    policies: t.policies,
    totalCents: t.cents,
    byDay: t.byDay,
    byProduct: t.byProduct,
    byCarrier: t.byCarrier,
    memberIds: t.memberIds,
  }));

  return {
    scope,
    scopeLeaderId: leaderId,
    scopeName,
    range: { from, to, label: rangeLabel(from, to), days },
    compare,
    kpis: { productionCents, prevProductionCents, policies, prevPolicies, activeAgents: sellers.length, prevActiveAgents, dailyCents, dailyActiveAgents },
    stand: standOf(sellers.map((t) => t.cents)),
    movers: { label: moversLabel, up, down },
    rows,
    teams,
    products: columnOrder(productTotals),
    carriers: columnOrder(carrierTotals),
    generatedAt: input.generatedAt ?? new Date().toISOString(),
  };
}

/** What the export holds: the agents or the teams, by day, by product or by carrier. */
export type CsvWho = "agents" | "teams";
export type CsvView = "dates" | "product" | "carrier";
export const CSV_WHO: CsvWho[] = ["agents", "teams"];
export const CSV_VIEWS: CsvView[] = ["dates", "product", "carrier"];

/** A text cell: quoted, and never a formula (a leading = + - @ gets an apostrophe in front). */
function csvText(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return `"${safe.replace(/"/g, '""')}"`;
}

/** Plain dollars with two decimals ("1234.50"). */
function csvMoney(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(Math.round(cents));
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

/**
 * The leaderboard as a CSV file: a header row, then one row per agent (or team) in rank order,
 * with the columns the screen shows (a column per day, per product or per carrier, then the total).
 */
export function scoreboardCsv(sb: Scoreboard, who: CsvWho, view: CsvView): string {
  const keys = view === "dates" ? sb.range.days : view === "product" ? sb.products : sb.carriers;
  const heads = view === "dates" ? keys.map(shortDay) : keys;
  const pick = (r: { byDay: Record<string, number>; byProduct: Record<string, number>; byCarrier: Record<string, number> }) => (view === "dates" ? r.byDay : view === "product" ? r.byProduct : r.byCarrier);
  const lines: string[] = [];
  if (who === "teams") {
    lines.push(["Rank", "Team", "People", "Agents who sold", "Policies", ...heads, "Total"].map(csvText).join(","));
    for (const t of sb.teams) {
      const by = pick(t);
      lines.push([String(t.rank), csvText(`${t.name}'s team`), String(t.members), String(t.activeAgents), String(t.policies), ...keys.map((k) => csvMoney(by[k] ?? 0)), csvMoney(t.totalCents)].join(","));
    }
  } else {
    lines.push(["Rank", "Name", "Upline", "In office", "Policies", ...heads, "Total"].map(csvText).join(","));
    for (const r of sb.rows) {
      const by = pick(r);
      lines.push([String(r.rank), csvText(r.name), csvText(r.uplineName ?? ""), csvText(r.inOffice ? "Yes" : "No"), String(r.policies), ...keys.map((k) => csvMoney(by[k] ?? 0)), csvMoney(r.totalCents)].join(","));
    }
  }
  return lines.join("\r\n") + "\r\n";
}
