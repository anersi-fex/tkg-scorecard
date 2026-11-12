import "server-only";
import { db } from "./supabase";
import { DEFAULT_SETTINGS, isBoardTheme, isSaleKind, isTvScreens, type Agent, type AppSettings, type LoggedBy, type PcCarrier, type Sale } from "./types";
import { addMonths, datesOfMonth, isMonthKey } from "./month";
import { DEFAULT_COLORWAY, isColorwayKey } from "./colorways";
import { DEFAULT_PC_COLOR, isPcColorKey } from "./pc-colors";
import { isSoundKey } from "./sounds";

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

type SaleRow = Omit<Sale, "premium_cents" | "kind" | "logged_by_agent"> & { logged_by_agent?: string | null } & { premium_cents: number | string; kind: string | null; agents: { name: string } | { name: string }[] | null };

function toSale(r: SaleRow): SaleWithAgent {
  const agent = Array.isArray(r.agents) ? r.agents[0] : r.agents;
  return {
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
    logged_by_agent: r.logged_by_agent ?? null,
    created_at: r.created_at,
    agent_name: agent?.name ?? "Someone",
  };
}

// sales points at agents twice since 0005 (agent_id: who sold it; logged_by_agent: who typed it),
// so the join names its column: a bare agents(name) is refused as ambiguous.
const SALE_COLUMNS = "id, agent_id, premium_cents, policies, product, carrier, kind, client, note, sold_on, logged_by, logged_by_agent, created_at, agents!agent_id(name)";
// pass_hash and phone are never selected here: only src/lib/people.ts reads them, for sign-in.
const AGENT_COLUMNS = "id, name, active, sort, pc_licensed, upline_id, in_office, role, joined_at";

export async function listAgents(opts: { includeInactive?: boolean } = {}): Promise<Agent[]> {
  let q = db().from("agents").select(AGENT_COLUMNS).order("sort").order("name");
  if (!opts.includeInactive) q = q.eq("active", true);
  const { data, error } = await q;
  if (error) fail("agents.list", error);
  return (data ?? []) as Agent[];
}

export async function getAgent(id: string): Promise<Agent | null> {
  const { data, error } = await db().from("agents").select(AGENT_COLUMNS).eq("id", id).maybeSingle();
  if (error) fail("agents.get", error);
  return (data as Agent | null) ?? null;
}

export async function addAgent(name: string): Promise<Agent> {
  const { data: last } = await db().from("agents").select("sort").order("sort", { ascending: false }).limit(1).maybeSingle();
  const sort = ((last?.sort as number | undefined) ?? 0) + 1;
  const { data, error } = await db().from("agents").insert({ name, sort }).select(AGENT_COLUMNS).single();
  if (error) fail("agents.add", error);
  return data as Agent;
}

export async function updateAgent(id: string, patch: Partial<Pick<Agent, "name" | "active" | "sort" | "pc_licensed">>): Promise<void> {
  const { error } = await db()
    .from("agents")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) fail("agents.update", error);
}

/** The API hands back at most 1000 rows a request: longer lists are read a page at a time. */
const PAGE = 1000;
/** A stop for the paging loops (200,000 rows): far past any month, so a bug can never loop forever. */
const MAX_PAGES = 200;

/** Sales counted in a month (not deleted), oldest first, with the agent's name. Every row, however many. */
export async function salesForMonth(month: string): Promise<SaleWithAgent[]> {
  if (!isMonthKey(month)) return [];
  const dates = datesOfMonth(month);
  return salesBetween(dates[0], dates[dates.length - 1]);
}

/** Sales counted from one day through another (both included, not deleted), oldest first. Every row, however many. */
export async function salesBetween(from: string, to: string): Promise<SaleWithAgent[]> {
  const out: SaleWithAgent[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const { data, error } = await db()
      .from("sales")
      .select(SALE_COLUMNS)
      .is("deleted_at", null)
      .gte("sold_on", from)
      .lte("sold_on", to)
      .order("sold_on")
      .order("created_at")
      // id last: two rows with the same instant keep one order across pages.
      .order("id")
      .range(page * PAGE, page * PAGE + PAGE - 1);
    if (error) fail("sales.month", error);
    const rows = (data ?? []) as unknown as SaleRow[];
    for (const r of rows) out.push(toSale(r));
    if (rows.length < PAGE) break;
  }
  return out;
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
  carrier: string | null;
  kind: Sale["kind"];
  client: string | null;
  note: string | null;
  sold_on: string;
  logged_by: LoggedBy;
  /** The person whose own sign-in logged it (0005); null for the shared passwords and the Shortcut. */
  logged_by_agent?: string | null;
}

export async function insertSale(sale: NewSale): Promise<SaleWithAgent> {
  const { data, error } = await db().from("sales").insert(sale).select(SALE_COLUMNS).single();
  if (error) fail("sales.insert", error);
  return toSale(data as SaleRow);
}

/** Returns false when the sale is gone (deleted meanwhile), so the screen can say so. */
export async function updateSale(id: string, patch: Partial<Omit<NewSale, "logged_by" | "logged_by_agent">>): Promise<boolean> {
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

/**
 * Months that have sales (not deleted), newest first, as "YYYY-MM". Never reads the sales
 * themselves: the oldest and the newest day, then one "is there a sale" question per month between.
 */
export async function monthsWithSales(): Promise<string[]> {
  const edge = (ascending: boolean) => db().from("sales").select("sold_on").is("deleted_at", null).order("sold_on", { ascending }).limit(1).maybeSingle();
  const [oldest, newest] = await Promise.all([edge(true), edge(false)]);
  if (oldest.error) fail("sales.months", oldest.error);
  if (newest.error) fail("sales.months", newest.error);
  if (!oldest.data || !newest.data) return [];
  const first = String(oldest.data.sold_on).slice(0, 7);
  const last = String(newest.data.sold_on).slice(0, 7);
  if (!isMonthKey(first) || !isMonthKey(last)) return [];
  // Newest first; at most 20 years, so an odd old row never asks hundreds of questions.
  const months: string[] = [];
  for (let m = last; m >= first && months.length < 240; m = addMonths(m, -1)) months.push(m);
  const has = await Promise.all(
    months.map(async (m) => {
      if (m === first || m === last) return true;
      const dates = datesOfMonth(m);
      const { data, error } = await db()
        .from("sales")
        .select("id")
        .is("deleted_at", null)
        .gte("sold_on", dates[0])
        .lte("sold_on", dates[dates.length - 1])
        .limit(1);
      if (error) fail("sales.months", error);
      return (data?.length ?? 0) > 0;
    }),
  );
  return months.filter((_, i) => has[i]);
}

export interface MonthGoals {
  /** The life goal: the one the board measures (owner, 2026-11-04). */
  teamCents: number;
  byAgent: Record<string, number>;
  /** The P&C goals (0004_pc_goals.sql): the team's and each person's. */
  pcTeamCents: number;
  pcByAgent: Record<string, number>;
}

export async function goalsForMonth(month: string): Promise<MonthGoals> {
  if (!isMonthKey(month)) return { teamCents: 0, byAgent: {}, pcTeamCents: 0, pcByAgent: {} };
  const [team, agents] = await Promise.all([
    db().from("goals").select("team_cents, pc_cents").eq("month", month).maybeSingle(),
    db().from("agent_goals").select("agent_id, cents, pc_cents").eq("month", month),
  ]);
  if (team.error) fail("goals.team", team.error);
  if (agents.error) fail("goals.agents", agents.error);
  const byAgent: Record<string, number> = {};
  const pcByAgent: Record<string, number> = {};
  for (const r of agents.data ?? []) {
    if (Number(r.cents) > 0) byAgent[String(r.agent_id)] = Number(r.cents);
    if (Number(r.pc_cents) > 0) pcByAgent[String(r.agent_id)] = Number(r.pc_cents);
  }
  return { teamCents: Number(team.data?.team_cents ?? 0), byAgent, pcTeamCents: Number(team.data?.pc_cents ?? 0), pcByAgent };
}

/** The team's life goal for a month (the P&C goal in the same row is kept). */
export async function setTeamGoal(month: string, cents: number): Promise<void> {
  const { error } = await db().from("goals").upsert({ month, team_cents: cents, updated_at: new Date().toISOString() });
  if (error) fail("goals.set", error);
}

/** The team's P&C goal for a month (the life goal in the same row is kept). */
export async function setTeamPcGoal(month: string, cents: number): Promise<void> {
  const { error } = await db().from("goals").upsert({ month, pc_cents: cents, updated_at: new Date().toISOString() });
  if (error) fail("goals.pc.set", error);
}

/** A person's row holds their life goal and their P&C goal: clearing one keeps the other; a row with neither goes. */
async function setAgentGoalColumn(month: string, agentId: string, column: "cents" | "pc_cents", cents: number): Promise<void> {
  const { error } = await db()
    .from("agent_goals")
    .upsert({ month, agent_id: agentId, [column]: Math.max(0, cents), updated_at: new Date().toISOString() });
  if (error) fail("goals.agent.set", error);
  const { error: clear } = await db().from("agent_goals").delete().eq("month", month).eq("agent_id", agentId).eq("cents", 0).eq("pc_cents", 0);
  if (clear) fail("goals.agent.clear", clear);
}

export async function setAgentGoal(month: string, agentId: string, cents: number): Promise<void> {
  await setAgentGoalColumn(month, agentId, "cents", cents);
}

export async function setAgentPcGoal(month: string, agentId: string, cents: number): Promise<void> {
  await setAgentGoalColumn(month, agentId, "pc_cents", cents);
}

export async function getSettings(): Promise<AppSettings> {
  const { data, error } = await db().from("settings").select("value").eq("key", "app").maybeSingle();
  if (error) fail("settings.get", error);
  const v = (data?.value ?? {}) as Partial<AppSettings>;
  const list = (raw: unknown, fallback: string[]) => {
    const items = Array.isArray(raw) ? raw.filter((p): p is string => typeof p === "string" && p.trim().length > 0).slice(0, 20) : fallback;
    return items.length ? items : fallback;
  };
  return {
    message: typeof v.message === "string" ? v.message.slice(0, 120) : "",
    products: list(v.products, DEFAULT_SETTINGS.products),
    carriers: list(v.carriers, DEFAULT_SETTINGS.carriers),
    pcCarriers: pcCarrierList(v.pcCarriers),
    colorway: isColorwayKey(v.colorway) ? v.colorway : DEFAULT_COLORWAY,
    pcColor: isPcColorKey(v.pcColor) ? v.pcColor : DEFAULT_PC_COLOR,
    boardTheme: isBoardTheme(v.boardTheme) ? v.boardTheme : DEFAULT_SETTINGS.boardTheme,
    sound: isSoundKey(v.sound) ? v.sound : DEFAULT_SETTINGS.sound,
    tvScreens: isTvScreens(v.tvScreens) ? v.tvScreens : DEFAULT_SETTINGS.tvScreens,
    agencyName: typeof v.agencyName === "string" && v.agencyName.trim() ? v.agencyName.trim().slice(0, 40) : DEFAULT_SETTINGS.agencyName,
    pcEnabled: v.pcEnabled === true,
    teamPasswordLogs: v.teamPasswordLogs !== false,
  };
}

/** The stored P&C carriers, each with its lines; the owner's defaults when the row has none. */
function pcCarrierList(raw: unknown): PcCarrier[] {
  if (!Array.isArray(raw)) return DEFAULT_SETTINGS.pcCarriers;
  const out: PcCarrier[] = [];
  for (const item of raw.slice(0, 20)) {
    if (!item || typeof item !== "object") continue;
    const name = typeof (item as PcCarrier).name === "string" ? (item as PcCarrier).name.trim().slice(0, 40) : "";
    if (!name || out.some((c) => c.name.toLowerCase() === name.toLowerCase())) continue;
    const lines = Array.isArray((item as PcCarrier).lines) ? (item as PcCarrier).lines.filter((l): l is string => typeof l === "string" && l.trim().length > 0).map((l) => l.trim().slice(0, 40)).slice(0, 12) : [];
    out.push({ name, lines });
  }
  return out.length ? out : DEFAULT_SETTINGS.pcCarriers;
}

export async function saveSettings(next: AppSettings): Promise<void> {
  const { error } = await db().from("settings").upsert({ key: "app", value: next, updated_at: new Date().toISOString() });
  if (error) fail("settings.save", error);
}
