import "server-only";
import { db } from "./supabase";
import { DEFAULT_SETTINGS, type Agent, type AppSettings, type LoggedBy, type Sale } from "./types";
import { datesOfMonth, isMonthKey } from "./month";

/**
 * Every read and write, with the service key, after the caller checked the session. Rows come
 * back as plain objects in cents and "YYYY-MM-DD" strings.
 */

function fail(where: string, error: { message: string } | null): never {
  // The message names the table and the operation only: never a row.
  throw new Error(`${where}: ${error?.message ?? "unknown error"}`);
}

export interface SaleWithAgent extends Sale {
  agent_name: string;
}

type SaleRow = Omit<Sale, "premium_cents"> & { premium_cents: number | string; agents: { name: string } | { name: string }[] | null };

function toSale(r: SaleRow): SaleWithAgent {
  const agent = Array.isArray(r.agents) ? r.agents[0] : r.agents;
  return {
    id: r.id,
    agent_id: r.agent_id,
    premium_cents: Number(r.premium_cents),
    policies: r.policies,
    product: r.product,
    client: r.client,
    note: r.note,
    sold_on: r.sold_on,
    logged_by: r.logged_by,
    created_at: r.created_at,
    agent_name: agent?.name ?? "Someone",
  };
}

const SALE_COLUMNS = "id, agent_id, premium_cents, policies, product, client, note, sold_on, logged_by, created_at, agents(name)";

export async function listAgents(opts: { includeInactive?: boolean } = {}): Promise<Agent[]> {
  let q = db().from("agents").select("id, name, active, sort").order("sort").order("name");
  if (!opts.includeInactive) q = q.eq("active", true);
  const { data, error } = await q;
  if (error) fail("agents.list", error);
  return (data ?? []) as Agent[];
}

export async function getAgent(id: string): Promise<Agent | null> {
  const { data, error } = await db().from("agents").select("id, name, active, sort").eq("id", id).maybeSingle();
  if (error) fail("agents.get", error);
  return (data as Agent | null) ?? null;
}

export async function addAgent(name: string): Promise<Agent> {
  const { data: last } = await db().from("agents").select("sort").order("sort", { ascending: false }).limit(1).maybeSingle();
  const sort = ((last?.sort as number | undefined) ?? 0) + 1;
  const { data, error } = await db().from("agents").insert({ name, sort }).select("id, name, active, sort").single();
  if (error) fail("agents.add", error);
  return data as Agent;
}

export async function updateAgent(id: string, patch: Partial<Pick<Agent, "name" | "active" | "sort">>): Promise<void> {
  const { error } = await db()
    .from("agents")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) fail("agents.update", error);
}

/** Sales counted in a month (not deleted), oldest first, with the agent's name. */
export async function salesForMonth(month: string): Promise<SaleWithAgent[]> {
  if (!isMonthKey(month)) return [];
  const dates = datesOfMonth(month);
  const { data, error } = await db()
    .from("sales")
    .select(SALE_COLUMNS)
    .is("deleted_at", null)
    .gte("sold_on", dates[0])
    .lte("sold_on", dates[dates.length - 1])
    .order("sold_on")
    .order("created_at");
  if (error) fail("sales.month", error);
  return ((data ?? []) as SaleRow[]).map(toSale);
}

/** The newest sales (not deleted), newest first. */
export async function recentSales(limit = 10): Promise<SaleWithAgent[]> {
  const { data, error } = await db().from("sales").select(SALE_COLUMNS).is("deleted_at", null).order("created_at", { ascending: false }).limit(limit);
  if (error) fail("sales.recent", error);
  return ((data ?? []) as SaleRow[]).map(toSale);
}

export async function getSale(id: string): Promise<SaleWithAgent | null> {
  const { data, error } = await db().from("sales").select(SALE_COLUMNS).eq("id", id).is("deleted_at", null).maybeSingle();
  if (error) fail("sales.get", error);
  return data ? toSale(data as SaleRow) : null;
}

export interface NewSale {
  agent_id: string;
  premium_cents: number;
  policies: number;
  product: string | null;
  client: string | null;
  note: string | null;
  sold_on: string;
  logged_by: LoggedBy;
}

export async function insertSale(sale: NewSale): Promise<SaleWithAgent> {
  const { data, error } = await db().from("sales").insert(sale).select(SALE_COLUMNS).single();
  if (error) fail("sales.insert", error);
  return toSale(data as SaleRow);
}

/** Returns false when the sale is gone (deleted meanwhile), so the screen can say so. */
export async function updateSale(id: string, patch: Partial<Omit<NewSale, "logged_by">>): Promise<boolean> {
  const { data, error } = await db().from("sales").update(patch).eq("id", id).is("deleted_at", null).select("id");
  if (error) fail("sales.update", error);
  return (data?.length ?? 0) > 0;
}

/** Soft delete: the row stays with deleted_at set. Returns false when there was nothing to delete. */
export async function deleteSale(id: string): Promise<boolean> {
  const { data, error } = await db().from("sales").update({ deleted_at: new Date().toISOString() }).eq("id", id).is("deleted_at", null).select("id");
  if (error) fail("sales.delete", error);
  return (data?.length ?? 0) > 0;
}

/** Months that have sales (not deleted), newest first, as "YYYY-MM". */
export async function monthsWithSales(): Promise<string[]> {
  const { data, error } = await db().from("sales").select("sold_on").is("deleted_at", null).order("sold_on", { ascending: false });
  if (error) fail("sales.months", error);
  const seen = new Set<string>();
  for (const r of data ?? []) seen.add(String(r.sold_on).slice(0, 7));
  return [...seen];
}

export interface MonthGoals {
  teamCents: number;
  byAgent: Record<string, number>;
}

export async function goalsForMonth(month: string): Promise<MonthGoals> {
  if (!isMonthKey(month)) return { teamCents: 0, byAgent: {} };
  const [team, agents] = await Promise.all([
    db().from("goals").select("team_cents").eq("month", month).maybeSingle(),
    db().from("agent_goals").select("agent_id, cents").eq("month", month),
  ]);
  if (team.error) fail("goals.team", team.error);
  if (agents.error) fail("goals.agents", agents.error);
  const byAgent: Record<string, number> = {};
  for (const r of agents.data ?? []) byAgent[String(r.agent_id)] = Number(r.cents);
  return { teamCents: Number(team.data?.team_cents ?? 0), byAgent };
}

export async function setTeamGoal(month: string, cents: number): Promise<void> {
  const { error } = await db().from("goals").upsert({ month, team_cents: cents, updated_at: new Date().toISOString() });
  if (error) fail("goals.set", error);
}

export async function setAgentGoal(month: string, agentId: string, cents: number): Promise<void> {
  if (cents <= 0) {
    const { error } = await db().from("agent_goals").delete().eq("month", month).eq("agent_id", agentId);
    if (error) fail("goals.agent.clear", error);
    return;
  }
  const { error } = await db().from("agent_goals").upsert({ month, agent_id: agentId, cents, updated_at: new Date().toISOString() });
  if (error) fail("goals.agent.set", error);
}

export async function getSettings(): Promise<AppSettings> {
  const { data, error } = await db().from("settings").select("value").eq("key", "app").maybeSingle();
  if (error) fail("settings.get", error);
  const v = (data?.value ?? {}) as Partial<AppSettings>;
  const products = Array.isArray(v.products) ? v.products.filter((p): p is string => typeof p === "string" && p.trim().length > 0).slice(0, 12) : DEFAULT_SETTINGS.products;
  return {
    message: typeof v.message === "string" ? v.message.slice(0, 120) : "",
    products: products.length ? products : DEFAULT_SETTINGS.products,
  };
}

export async function saveSettings(next: AppSettings): Promise<void> {
  const { error } = await db().from("settings").upsert({ key: "app", value: next, updated_at: new Date().toISOString() });
  if (error) fail("settings.save", error);
}
