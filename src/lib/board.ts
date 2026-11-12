import "server-only";
import { goalsForMonth, listAgents, recentSales, salesForMonth, getSettings } from "./data";
import { datesOfMonth, monthKeyOf, todayInDetroit } from "./month";
import { db } from "./supabase";
import { buildScoreboard } from "./scoreboard";
import { salesBeforeMonth } from "./scoreboard-load";
import type { ScoreSale, Scoreboard } from "./scoreboard-types";
import { buildSnapshot, lifeOnlyInput, type MonthSnapshot, type SnapshotInput } from "./snapshot";

export { buildSnapshot } from "./snapshot";
export type { AgentLine, DayPoint, FeedSale, MonthSnapshot } from "./snapshot";

/** How long the month-before list is kept in memory. */
const BEFORE_KEEP_MS = 60_000;
let beforeKept: { month: string; at: number; rows: Promise<ScoreSale[]> } | null = null;

/**
 * The life sales of the month before `month` (what the Scoreboard compares with), read at most
 * once a minute: that month hardly ever changes and the TV asks every 5 seconds, so everyone
 * meanwhile shares one read (a fix to last month's sale reaches the TV within the minute). A read
 * that fails is forgotten at once, so the next caller tries again.
 */
function salesBeforeKept(month: string): Promise<ScoreSale[]> {
  const now = Date.now();
  if (beforeKept && beforeKept.month === month && now - beforeKept.at < BEFORE_KEEP_MS) return beforeKept.rows;
  const kept = { month, at: now, rows: salesBeforeMonth(month) };
  beforeKept = kept;
  kept.rows.catch(() => {
    if (beforeKept === kept) beforeKept = null;
  });
  return kept.rows;
}

/**
 * A cheap answer to "did anything the TV shows change?": the newest sale's time, how many of the
 * month's sales stand, and when Settings last changed. Three tiny reads instead of the whole
 * month: with 30 to 70 people a full read every 5 seconds would spend the database's monthly
 * traffic allowance. The TV sends back the stamp it holds; while it still matches, the feed
 * answers 204 and reads nothing more. A new or removed sale and a Settings change move the stamp
 * at once; a fixed sale, a goal or a person reaches the TV at its next full read (once a minute).
 */
export async function boardStamp(today: string): Promise<string> {
  const dates = datesOfMonth(monthKeyOf(today));
  const [newest, standing, settings] = await Promise.all([
    db().from("sales").select("created_at").order("created_at", { ascending: false }).limit(1).maybeSingle(),
    db().from("sales").select("id", { count: "exact", head: true }).is("deleted_at", null).gte("sold_on", dates[0]).lte("sold_on", dates[dates.length - 1]),
    db().from("settings").select("updated_at").eq("key", "app").maybeSingle(),
  ]);
  if (newest.error || standing.error || settings.error) throw new Error("board.stamp");
  // The deploy rides along, so a new build always gets a full answer (the TV then reloads itself).
  return [process.env.VERCEL_GIT_COMMIT_SHA ?? "", today, String(newest.data?.created_at ?? ""), String(standing.count ?? 0), String(settings.data?.updated_at ?? "")].join("|");
}

/**
 * The month's snapshot from the database (the TV, Home and the Wrap read it; see snapshot.ts).
 * While Settings has P&C off (the default since 2026-11-12) the P&C sales and goals are dropped
 * before any math. The current month also carries the Scoreboard (the whole agency, through
 * today); a page that does not show it passes `scoreboard: false` and gets null.
 */
export async function loadMonthSnapshot(month: string, opts: { today?: string; recentLimit?: number; scoreboard?: boolean } = {}): Promise<MonthSnapshot> {
  const today = opts.today ?? todayInDetroit();
  const limit = opts.recentLimit ?? 12;
  // The Scoreboard rides along for the running month, unless the caller does not show it.
  const withScoreboard = opts.scoreboard !== false && month === monthKeyOf(today);
  const [agents, sales, goals, newest, settings, before] = await Promise.all([
    listAgents({ includeInactive: true }),
    salesForMonth(month),
    goalsForMonth(month),
    recentSales(limit),
    getSettings(),
    // The Scoreboard compares with the month before: its life sales, beside the rest.
    withScoreboard
      ? salesBeforeKept(month).catch((err: unknown) => {
          // The class only; the leaderboard still answers without the Scoreboard.
          console.error("scoreboard_load_failed", err instanceof Error ? err.name : "error");
          return null;
        })
      : Promise.resolve(null),
  ]);
  // With P&C off the feed is life only. The newest few are all it needs unless some of them are
  // P&C: only then read further back, so the feed stays full once those are taken out.
  const recent = !settings.pcEnabled && newest.length >= limit && newest.some((s) => s.kind === "pc") ? await recentSales(limit * 4) : newest;
  let input: SnapshotInput = { month, today, agents, sales, goals, recent, message: settings.message, colorway: settings.colorway, pcColor: settings.pcColor, boardTheme: settings.boardTheme, sound: settings.sound, tvScreens: settings.tvScreens, agencyName: settings.agencyName, pcEnabled: settings.pcEnabled };
  if (!settings.pcEnabled) input = lifeOnlyInput(input);
  input = { ...input, recent: input.recent.slice(0, limit) };

  let scoreboard: Scoreboard | null = null;
  if (withScoreboard && before) {
    // The Scoreboard is life only whatever the P&C switch says; a running month ends today.
    const monthLife: ScoreSale[] = [];
    for (const s of sales) if (s.kind !== "pc" && s.sold_on <= today) monthLife.push({ agent_id: s.agent_id, premium_cents: s.premium_cents, policies: s.policies, product: s.product, carrier: s.carrier, sold_on: s.sold_on });
    scoreboard = buildScoreboard({ agents, sales: [...before, ...monthLife], from: `${month}-01`, to: today, today, agencyName: settings.agencyName });
  }
  return buildSnapshot({ ...input, scoreboard });
}
