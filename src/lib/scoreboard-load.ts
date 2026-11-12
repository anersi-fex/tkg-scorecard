import "server-only";
import { getSettings, listAgents } from "./data";
import { addDays, addMonths, datesOfMonth, isMonthKey, monthKeyOf, todayInDetroit } from "./month";
import { buildScoreboard } from "./scoreboard";
import type { ScoreSale, Scoreboard } from "./scoreboard-types";
import { db } from "./supabase";

export { scoreboardCsv } from "./scoreboard";
export type { CsvView, CsvWho } from "./scoreboard";

/** One page as supabase-js answers it. */
interface Page<T> {
  data: T[] | null;
  error: { message: string } | null;
  count: number | null;
}

/**
 * Every row of a query, however many: the API hands out at most 1,000 rows at a time (fewer if the
 * project says so), so this asks page after page until the count it was told is reached. `page`
 * must keep one order (end it with a unique column) and ask for `{ count: "exact" }`.
 */
export async function allRows<T>(where: string, page: (from: number, to: number) => PromiseLike<Page<T>>, SIZE = 1000): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < 500; i++) {
    const { data, error, count } = await page(out.length, out.length + SIZE - 1);
    // The table and the step only: never a row.
    if (error) throw new Error(`${where}: ${error.message}`);
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length === 0 || (count != null ? out.length >= count : rows.length < SIZE)) break;
  }
  return out;
}

/** Life sales, not deleted, sold from..to (both days included): only what the Scoreboard needs. */
export async function lifeSalesBetween(from: string, to: string): Promise<ScoreSale[]> {
  if (to < from) return [];
  const rows = await allRows<{ id: string; agent_id: string; premium_cents: number | string; policies: number; product: string | null; carrier: string | null; sold_on: string }>("sales.scoreboard", (a, b) =>
    db()
      .from("sales")
      .select("id, agent_id, premium_cents, policies, product, carrier, sold_on", { count: "exact" })
      .is("deleted_at", null)
      .neq("kind", "pc")
      .gte("sold_on", from)
      .lte("sold_on", to)
      .order("sold_on")
      .order("id")
      .range(a, b),
  );
  // A sale logged between two pages can come back twice: count each once.
  const seen = new Set<string>();
  const out: ScoreSale[] = [];
  for (const r of rows) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    out.push({ agent_id: r.agent_id, premium_cents: Number(r.premium_cents), policies: r.policies, product: r.product, carrier: r.carrier, sold_on: r.sold_on });
  }
  return out;
}

/** The days a month's Scoreboard covers: a running month ends today, any other month is whole. */
export function scoreboardRange(month: string, today: string): { from: string; to: string; salesFrom: string } {
  const dates = datesOfMonth(month);
  const from = dates[0];
  const to = month === monthKeyOf(today) ? today : dates[dates.length - 1];
  return { from, to, salesFrom: `${addMonths(month, -1)}-01` };
}

/**
 * The Scoreboard for a month (this month when none is named), for the whole agency or one
 * leader's team. Reads the people and two months of life sales; the caller checked the session.
 */
export async function loadScoreboard(opts: { month?: string; leaderId?: string | null; today?: string } = {}): Promise<Scoreboard> {
  const today = opts.today ?? todayInDetroit();
  const month = opts.month && isMonthKey(opts.month) ? opts.month : monthKeyOf(today);
  const { from, to, salesFrom } = scoreboardRange(month, today);
  const [agents, settings, sales] = await Promise.all([listAgents({ includeInactive: true }), getSettings(), lifeSalesBetween(salesFrom, to)]);
  return buildScoreboard({ agents, sales, from, to, today, leaderId: opts.leaderId ?? null, agencyName: settings.agencyName });
}

/** The life sales of the days before a month's first day that its Scoreboard compares with (the month before). */
export async function salesBeforeMonth(month: string): Promise<ScoreSale[]> {
  const first = `${month}-01`;
  return lifeSalesBetween(`${addMonths(month, -1)}-01`, addDays(first, -1));
}
