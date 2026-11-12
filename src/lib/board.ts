import "server-only";
import { goalsForMonth, listAgents, recentSales, getSettings, type SaleWithAgent } from "./data";
import { datesOfMonth, isMonthKey, monthKeyOf, todayInDetroit } from "./month";
import { buildScoreboard } from "./scoreboard";
import { allRows, salesBeforeMonth } from "./scoreboard-load";
import type { ScoreSale, Scoreboard } from "./scoreboard-types";
import { buildSnapshot, lifeOnlyInput, type MonthSnapshot, type SnapshotInput } from "./snapshot";
import { db } from "./supabase";
import { isSaleKind, type LoggedBy } from "./types";

export { buildSnapshot } from "./snapshot";
export type { AgentLine, DayPoint, FeedSale, MonthSnapshot } from "./snapshot";

interface MonthSaleRow {
  id: string;
  agent_id: string;
  premium_cents: number | string;
  policies: number;
  product: string | null;
  carrier: string | null;
  kind: string | null;
  client: string | null;
  note: string | null;
  sold_on: string;
  logged_by: LoggedBy;
  created_at: string;
  agents: { name: string } | { name: string }[] | null;
}

/**
 * Every sale counted in a month (not deleted), oldest first, with the agent's name: the same rows
 * as `salesForMonth` in data.ts, read page after page, since a whole agency can pass the 1,000
 * rows the API hands out at a time and a short list would quietly shrink every total.
 */
async function monthSales(month: string): Promise<SaleWithAgent[]> {
  if (!isMonthKey(month)) return [];
  const dates = datesOfMonth(month);
  const rows = await allRows<MonthSaleRow>("sales.month", (a, b) =>
    db()
      .from("sales")
      .select("id, agent_id, premium_cents, policies, product, carrier, kind, client, note, sold_on, logged_by, created_at, agents(name)", { count: "exact" })
      .is("deleted_at", null)
      .gte("sold_on", dates[0])
      .lte("sold_on", dates[dates.length - 1])
      .order("sold_on")
      .order("created_at")
      .order("id")
      .range(a, b),
  );
  const seen = new Set<string>();
  const out: SaleWithAgent[] = [];
  for (const r of rows) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    const agent = Array.isArray(r.agents) ? r.agents[0] : r.agents;
    out.push({
      id: r.id,
      agent_id: r.agent_id,
      premium_cents: Number(r.premium_cents),
      policies: r.policies,
      product: r.product,
      carrier: r.carrier,
      kind: isSaleKind(r.kind) ? r.kind : "life",
      client: r.client,
      note: r.note,
      sold_on: r.sold_on,
      logged_by: r.logged_by,
      created_at: r.created_at,
      agent_name: agent?.name ?? "Someone",
    });
  }
  return out;
}

/**
 * The month's snapshot from the database (the TV, Home and the Wrap read it; see snapshot.ts).
 * While Settings has P&C off (the default since 2026-11-12) the P&C sales and goals are dropped
 * before any math. The current month also carries the Scoreboard (the whole agency, through today).
 */
export async function loadMonthSnapshot(month: string, opts: { today?: string; recentLimit?: number } = {}): Promise<MonthSnapshot> {
  const today = opts.today ?? todayInDetroit();
  const limit = opts.recentLimit ?? 12;
  const current = month === monthKeyOf(today);
  const [agents, sales, goals, recent, settings, before] = await Promise.all([
    listAgents({ includeInactive: true }),
    monthSales(month),
    goalsForMonth(month),
    // A few more than asked for, so the feed stays full once the P&C ones are taken out.
    recentSales(limit * 4),
    getSettings(),
    current
      ? salesBeforeMonth(month).catch((err: unknown) => {
          // The class only; the leaderboard still answers without the Scoreboard.
          console.error("scoreboard_load_failed", err instanceof Error ? err.name : "error");
          return null;
        })
      : Promise.resolve(null),
  ]);
  let input: SnapshotInput = { month, today, agents, sales, goals, recent, message: settings.message, colorway: settings.colorway, pcColor: settings.pcColor, boardTheme: settings.boardTheme, sound: settings.sound, tvScreens: settings.tvScreens, agencyName: settings.agencyName, pcEnabled: settings.pcEnabled };
  if (!settings.pcEnabled) input = lifeOnlyInput(input);
  input = { ...input, recent: input.recent.slice(0, limit) };

  let scoreboard: Scoreboard | null = null;
  if (current && before) {
    // The Scoreboard is life only whatever the P&C switch says.
    const monthLife: ScoreSale[] = [];
    for (const s of sales) if (s.kind !== "pc" && s.sold_on <= today) monthLife.push({ agent_id: s.agent_id, premium_cents: s.premium_cents, policies: s.policies, product: s.product, carrier: s.carrier, sold_on: s.sold_on });
    scoreboard = buildScoreboard({ agents, sales: [...before, ...monthLife], from: `${month}-01`, to: today, today, agencyName: settings.agencyName });
  }
  return buildSnapshot({ ...input, scoreboard });
}
