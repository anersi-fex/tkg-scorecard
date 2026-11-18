import "server-only";
import { db } from "./supabase";
import { addAgent, listAgents, touchBoard } from "./data";
import { todayInDetroit } from "./month";
import { postDeal } from "./discord";
import {
  ERROR_LINE,
  FRESH_MS,
  MAX_CELEBRATIONS,
  cellsOf,
  dealToPolicy,
  diffCells,
  findPerson,
  needsOf,
  searchQueries,
  tidyAgentName,
  worthFetching,
  type AsClientPage,
  type AsDeal,
  type AsScoreRow,
  type ErrorClass,
  type RunCounts,
  type SyncCard,
  type Unresolved,
  type BoardPerson,
  type CellDiff,
  type LinkedPolicy,
  type SyncedPolicy,
} from "./agentspace-core";
import { applyDealToSale, findLinkableSale, insertSyncedPolicy, linkSaleToDeal, listLinkedPolicies, removeSyncedSale, reviveSyncedSale } from "./policies";

/**
 * The AgentSpace live sync (owner, 2026-11-16: a deal logged in AgentSpace "by mistake or by habit"
 * shows up here on its own, within minutes, with its status and premium kept in step).
 *
 * How it works. AgentSpace has no list of deals and no webhook. Its Scoreboard answers in one call
 * with every agent's production for every day, which is what AgentSpace shows leadership, so that
 * one call is the change detector: each agent-day is compared with the sum of the policies here that
 * are linked to a deal (sales.agentspace_deal_id). Where they differ, client search finds the
 * deals (the common two-letter name fragments first), and each is linked to the policy already here
 * (same seller, day, annual premium and client) or added as a new life policy. Where they agree the
 * run refreshes a rotating slice of linked deals, so a status, a premium, a policy number or a note
 * changed in AgentSpace flows in, and a deal that is gone (404) or no longer counts as production
 * (post_a_deal false) comes off the board. GET requests only: nothing is ever written to AgentSpace.
 *
 * The key is AGENTSPACE_API_KEY (an agency key), read here and nowhere else, never logged and never
 * sent to a browser. Without it the sync is off ("Not connected"). The sync's state (when it ran,
 * what it found, where its search stopped) is one row in `settings` under its own key. A run is
 * claimed with a lock in that row (a compare-and-swap on its updated_at), so two instances never run
 * at once. Logs carry counts and error classes only, never a deal, a client or a name.
 */

export const SYNC_KEY = "agentspace_sync";
/** Everything since September 2026 (the one-time copy's start). */
export const SYNC_FROM = "2026-09-01";
const DEFAULT_BASE = "https://api.useagentspace.com/api/v1/";
/** The least time between two runs; longer after an error. */
export const MIN_GAP_MS = 4 * 60_000;
const ERROR_GAP_MS = 8 * 60_000;
const KEY_GAP_MS = 30 * 60_000;
/** A run claims the lock for this long; a run that dies leaves it to run out. */
export const LOCK_MS = 90_000;
/** A run stops starting new calls after this long and saves where it was. */
const BUDGET_MS = 45_000;
/** AgentSpace allows about 120 calls a minute (measured 2026-11-16: the 121st is refused with a Retry-After of about 20 seconds); a run keeps under that, and waits out a refusal only while it has the time. */
const BUDGET_CALLS = 110;
const CALL_TIMEOUT_MS = 20_000;
/** Linked deals the rotation looks at again in a quiet run (a little less while something is missing). */
const ROTATE = 20;
const ROTATE_BUSY = 6;
/** After the search has walked every query without finding what is missing, it waits this long before walking again (a new gap starts it at once). */
const SEARCH_COOLDOWN_MS = 6 * 3_600_000;
const NONPROD_CAP = 1500;

export const connected = (): boolean => !!process.env.AGENTSPACE_API_KEY;

// ---- the HTTP client ---------------------------------------------------------------------------------------

/** An AgentSpace call that did not work: only its kind and status, never a body (it may hold a client). */
export class AsError extends Error {
  constructor(
    readonly kind: "key" | "bad_request" | "not_found" | "rate" | "server" | "network" | "budget",
    readonly status: number = 0,
  ) {
    super(`agentspace.${kind}${status ? `.${status}` : ""}`);
    this.name = "AsError";
  }
}

export interface Budget {
  deadline: number;
  maxCalls: number;
  calls: number;
}
export const newBudget = (ms = BUDGET_MS, maxCalls = BUDGET_CALLS, now = Date.now()): Budget => ({ deadline: now + ms, maxCalls, calls: 0 });
const timeLeft = (b: Budget) => b.deadline - Date.now();
export const budgetSpent = (b: Budget) => timeLeft(b) <= 0 || b.calls >= b.maxCalls;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Seconds from a Retry-After header ("12", or a date); null when it is neither. */
export function retryAfterMs(header: string | null): number | null {
  if (!header) return null;
  const n = Number(header);
  if (Number.isFinite(n) && n >= 0) return Math.round(n * 1000);
  const at = Date.parse(header);
  return Number.isFinite(at) ? Math.max(0, at - Date.now()) : null;
}

export class AgentSpaceClient {
  constructor(
    private readonly key: string,
    private readonly budget: Budget,
    private readonly base: string = (process.env.AGENTSPACE_BASE_URL || DEFAULT_BASE).replace(/\/?$/, "/"),
  ) {}

  /**
   * GET one resource. 429 and 5xx (and a dropped connection) are tried again, up to four calls, after
   * the Retry-After the server names (else 1, 2, 4 seconds), as long as the run has the time for it:
   * a wait past the run's budget stops the run instead. 401 is "key", 404 "not_found", other 4xx
   * "bad_request". Every call counts against the run's budget.
   */
  async get<T>(path: string, params: Record<string, string | number | undefined> = {}): Promise<T> {
    const url = new URL(path.replace(/^\//, ""), this.base);
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") url.searchParams.set(k, String(v));
    let last: AsError = new AsError("network");
    for (let attempt = 0; attempt < 4; attempt++) {
      if (budgetSpent(this.budget)) throw new AsError("budget");
      this.budget.calls++;
      let wait = 1000 * 2 ** attempt;
      let res: Response | null = null;
      try {
        res = await fetch(url, {
          method: "GET",
          headers: { Authorization: `Bearer ${this.key}`, Accept: "application/json" },
          signal: AbortSignal.timeout(Math.max(1000, Math.min(CALL_TIMEOUT_MS, timeLeft(this.budget) + 2000))),
          cache: "no-store",
        });
      } catch {
        last = new AsError("network");
      }
      if (res) {
        if (res.ok) {
          try {
            return (await res.json()) as T;
          } catch {
            last = new AsError("server", res.status);
          }
        } else {
          // The body is never read for an error: it can hold a client.
          void res.body?.cancel().catch(() => {});
          if (res.status === 401 || res.status === 403) throw new AsError("key", res.status);
          if (res.status === 404) throw new AsError("not_found", 404);
          if (res.status !== 429 && res.status < 500) throw new AsError("bad_request", res.status);
          last = new AsError(res.status === 429 ? "rate" : "server", res.status);
          wait = retryAfterMs(res.headers.get("retry-after")) ?? wait;
        }
      }
      if (attempt === 3) break;
      // A wait the run cannot afford ends the run (it tries again at its next turn).
      if (wait > timeLeft(this.budget) - 500) throw last;
      await sleep(wait);
    }
    throw last;
  }
}

// ---- the sync's state (settings row `agentspace_sync`) ------------------------------------------------------

const zeroCounts = (): RunCounts => ({ cells: 0, differing: 0, linked: 0, inserted: 0, updated: 0, checked: 0, removed: 0, revived: 0, newAgents: 0, skipped: 0, calls: 0, ms: 0, stopped: null });

export interface SyncState {
  v: 1;
  last_run_at: string | null;
  last_ok_at: string | null;
  last_error_class: ErrorClass | null;
  lock_until: string | null;
  last_counts: RunCounts | null;
  /** The cells still different after the last run (at most 20), and how many there are. */
  unresolved: Unresolved[];
  unresolved_total: number;
  /** The finder: the next query to walk, the cells it was looking for, and when it last walked them all for nothing. */
  search: { i: number; keys: string[]; exhausted_at: string | null };
  /** Deals seen not to count in AgentSpace: id to the updated_at they had (looked at again only when it changes). */
  nonprod: Record<string, string>;
  /** The rotation's place: the last deal id it refreshed. */
  refresh_cursor: string | null;
  /** AgentSpace agent id to the board person's id. */
  agent_map: Record<string, string>;
  /** A name AgentSpace spells differently from the board: normalized AgentSpace name to the board's name. */
  aliases: Record<string, string>;
  /** Deals an admin took off on purpose: they still count on Scorecard's side of the comparison. */
  kept_removed: Record<string, { agent_id: string; day: string; cents: number }>;
  /** People the sync added from AgentSpace, newest last (names only). */
  new_agents: { name: string; at: string }[];
  linked_total: number;
}

const emptyState = (): SyncState => ({
  v: 1,
  last_run_at: null,
  last_ok_at: null,
  last_error_class: null,
  lock_until: null,
  last_counts: null,
  unresolved: [],
  unresolved_total: 0,
  search: { i: 0, keys: [], exhausted_at: null },
  nonprod: {},
  refresh_cursor: null,
  agent_map: {},
  aliases: {},
  kept_removed: {},
  new_agents: [],
  linked_total: 0,
});

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const stringMap = (v: unknown): Record<string, string> => {
  const out: Record<string, string> = {};
  if (isObj(v)) for (const [k, x] of Object.entries(v)) if (typeof x === "string") out[k] = x;
  return out;
};

/** The stored state, read defensively: a field that is missing or the wrong shape reads as its empty value. */
export function parseState(raw: unknown): SyncState {
  const s = emptyState();
  if (!isObj(raw)) return s;
  s.last_run_at = str(raw.last_run_at);
  s.last_ok_at = str(raw.last_ok_at);
  const ec = str(raw.last_error_class);
  s.last_error_class = ec ? (ec as ErrorClass) : null;
  s.lock_until = str(raw.lock_until);
  if (isObj(raw.last_counts)) s.last_counts = { ...zeroCounts(), ...(raw.last_counts as Partial<RunCounts>) };
  if (Array.isArray(raw.unresolved)) s.unresolved = raw.unresolved.filter(isObj).map((u) => ({ agent: String(u.agent ?? ""), day: String(u.day ?? ""), asCents: Number(u.asCents) || 0, scCents: Number(u.scCents) || 0 })).slice(0, 20);
  s.unresolved_total = Number(raw.unresolved_total) || 0;
  if (isObj(raw.search)) s.search = { i: Math.max(0, Number(raw.search.i) || 0), keys: Array.isArray(raw.search.keys) ? raw.search.keys.filter((k): k is string => typeof k === "string").slice(0, 200) : [], exhausted_at: str(raw.search.exhausted_at) };
  s.nonprod = stringMap(raw.nonprod);
  s.refresh_cursor = str(raw.refresh_cursor);
  s.agent_map = stringMap(raw.agent_map);
  s.aliases = stringMap(raw.aliases);
  if (isObj(raw.kept_removed)) for (const [k, v] of Object.entries(raw.kept_removed)) if (isObj(v) && typeof v.agent_id === "string" && typeof v.day === "string") s.kept_removed[k] = { agent_id: v.agent_id, day: v.day, cents: Number(v.cents) || 0 };
  if (Array.isArray(raw.new_agents)) s.new_agents = raw.new_agents.filter(isObj).map((n) => ({ name: String(n.name ?? ""), at: String(n.at ?? "") })).slice(-10);
  s.linked_total = Number(raw.linked_total) || 0;
  return s;
}

interface Stored {
  state: SyncState;
  /** The row's updated_at as read: the version a write must still find (null: no row yet). */
  version: string | null;
}

async function readStored(): Promise<Stored> {
  const { data, error } = await db().from("settings").select("value, updated_at").eq("key", SYNC_KEY).maybeSingle();
  if (error) throw new AsDatabaseError();
  return { state: parseState(data?.value), version: data ? String(data.updated_at) : null };
}

class AsDatabaseError extends Error {
  constructor() {
    super("agentspace.database");
    this.name = "AsDatabaseError";
  }
}
class LockLost extends Error {
  constructor() {
    super("agentspace.lock_lost");
    this.name = "LockLost";
  }
}

/**
 * Writes the state only if the row is still the version this run read (a compare-and-swap on
 * updated_at: the first of two writers wins, the other changes nothing). Returns the new version, or
 * null when someone else got there first (or, for a first write, the row already exists).
 */
async function writeStored(state: SyncState, version: string | null): Promise<string | null> {
  const updated_at = new Date().toISOString();
  if (version === null) {
    const { error } = await db().from("settings").insert({ key: SYNC_KEY, value: state, updated_at });
    if (error) {
      if ((error as { code?: string }).code === "23505") return null;
      throw new AsDatabaseError();
    }
    return updated_at;
  }
  const { data, error } = await db().from("settings").update({ value: state, updated_at }).eq("key", SYNC_KEY).eq("updated_at", version).select("key");
  if (error) throw new AsDatabaseError();
  return data?.length ? updated_at : null;
}

/** The gap a state asks for before the next run. */
export function gapFor(state: SyncState): number {
  if (state.last_error_class === "key_rejected") return KEY_GAP_MS;
  return state.last_error_class ? ERROR_GAP_MS : MIN_GAP_MS;
}

/** When the next run is due (ms since the epoch), from a state. */
export function dueAt(state: SyncState): number {
  return state.last_run_at ? Date.parse(state.last_run_at) + gapFor(state) : 0;
}

// ---- one run -----------------------------------------------------------------------------------------------

export type SyncResult =
  | { ran: false; why: "not_connected" | "busy" | "not_due"; dueAt?: number }
  | { ran: true; ok: true; counts: RunCounts }
  | { ran: true; ok: false; error: ErrorClass; counts: RunCounts };

function errorClassOf(err: unknown): ErrorClass {
  if (err instanceof AsError) {
    if (err.kind === "key") return "key_rejected";
    if (err.kind === "rate") return "rate_limited";
    if (err.kind === "server") return "server";
    if (err.kind === "network") return "network";
    if (err.kind === "bad_request" || err.kind === "not_found") return "bad_request";
    return "error";
  }
  if (err instanceof AsDatabaseError || (err instanceof Error && err.name === "DataError")) return "database";
  return "error";
}

/**
 * Runs one sync unless one is not due or already running. `force` (Sync now, the cron route) ignores
 * the minimum gap but never the lock. Returns counts only. A run that fails records its error class
 * (and a longer gap) and never throws; a run that runs out of its budget saves where it was and says
 * so (`stopped: "budget"`), and the next run goes on from there.
 */
export async function runSync(opts: { force?: boolean; client?: AgentSpaceClient; budget?: Budget; now?: () => Date } = {}): Promise<SyncResult> {
  const key = process.env.AGENTSPACE_API_KEY;
  if (!key) return { ran: false, why: "not_connected" };
  const now = opts.now ?? (() => new Date());
  let stored: Stored;
  try {
    stored = await readStored();
  } catch {
    console.error("agentspace_sync_failed", "database");
    return { ran: true, ok: false, error: "database", counts: zeroCounts() };
  }
  const t0 = now().getTime();
  const lockUntil = stored.state.lock_until ? Date.parse(stored.state.lock_until) : 0;
  if (lockUntil > t0) return { ran: false, why: "busy", dueAt: lockUntil };
  if (!opts.force && dueAt(stored.state) > t0) return { ran: false, why: "not_due", dueAt: dueAt(stored.state) };

  // Claim the run: the row says who holds it, and the write only lands if nobody else wrote first.
  const state = stored.state;
  state.lock_until = new Date(t0 + LOCK_MS).toISOString();
  state.last_run_at = new Date(t0).toISOString();
  let version: string | null;
  try {
    version = await writeStored(state, stored.version);
  } catch {
    console.error("agentspace_sync_failed", "database");
    return { ran: true, ok: false, error: "database", counts: zeroCounts() };
  }
  if (version === null) return { ran: false, why: "busy" };

  const budget = opts.budget ?? newBudget();
  const client = opts.client ?? new AgentSpaceClient(key, budget);
  const counts = zeroCounts();
  let error: ErrorClass | null = null;
  let held = true;
  const flags = { reached: false, dbFails: 0 };
  const checkpoint = async () => {
    const next = await writeStored(state, version);
    if (next === null) throw new LockLost();
    version = next;
  };
  try {
    await execute({ client, budget, state, counts, checkpoint, now, flags });
    if (budgetSpent(budget)) counts.stopped = "budget";
  } catch (err) {
    if (err instanceof LockLost) held = false;
    else if (err instanceof AsError && err.kind === "budget") counts.stopped = "budget";
    // AgentSpace asked it to slow down after it had its numbers: what it did is saved, and the next run goes on.
    else if (err instanceof AsError && err.kind === "rate" && flags.reached) counts.stopped = "rate";
    else {
      error = errorClassOf(err);
      console.error("agentspace_sync_failed", error);
    }
  }
  counts.calls = budget.calls;
  counts.ms = now().getTime() - t0;
  if (!held) return { ran: true, ok: false, error: "error", counts };
  state.lock_until = null;
  state.last_counts = counts;
  state.last_error_class = error;
  // "Last synced" means AgentSpace answered with its numbers, not only that a run started.
  if (!error && flags.reached) state.last_ok_at = now().toISOString();
  try {
    const next = await writeStored(state, version);
    if (next === null) console.error("agentspace_sync_failed", "lock_lost");
  } catch {
    console.error("agentspace_sync_failed", "database");
  }
  return error ? { ran: true, ok: false, error, counts } : { ran: true, ok: true, counts };
}

interface Ctx {
  client: AgentSpaceClient;
  budget: Budget;
  state: SyncState;
  counts: RunCounts;
  checkpoint: () => Promise<void>;
  now: () => Date;
  /** reached: set once AgentSpace has answered with its Scoreboard. dbFails: deals the database refused in this run (a run gives up at three). */
  flags: { reached: boolean; dbFails: number };
}

/** The people the run knows, kept in step as it adds some. */
class People {
  list: BoardPerson[] = [];
  constructor(
    private readonly state: SyncState,
    private readonly counts: RunCounts,
    private readonly now: () => Date,
  ) {}
  async load(): Promise<void> {
    this.list = (await listAgents({ includeInactive: true })).map((a) => ({ id: a.id, name: a.name, active: a.active }));
  }
  names(): Map<string, string> {
    return new Map(this.list.map((p) => [p.id, p.name]));
  }
  /** The board person for an AgentSpace agent, remembered; null when nobody fits and `create` is off. */
  async personFor(asId: string, asName: string, create: boolean): Promise<string | null> {
    const found = findPerson(asId, asName, this.list, { map: this.state.agent_map, aliases: this.state.aliases });
    if (found) {
      if (found.how !== "link") this.state.agent_map[asId] = found.person.id;
      return found.person.id;
    }
    if (!create) return null;
    const name = tidyAgentName(asName);
    if (!name) return null;
    const added = await addAgent(name);
    this.list.push({ id: added.id, name: added.name, active: true });
    this.state.agent_map[asId] = added.id;
    this.state.new_agents = [...this.state.new_agents, { name: added.name, at: this.now().toISOString() }].slice(-10);
    this.counts.newAgents++;
    return added.id;
  }
  /** Board person id to AgentSpace agent id, from what the run remembers. */
  reverse(): Map<string, string> {
    const r = new Map<string, string>();
    for (const [asId, scId] of Object.entries(this.state.agent_map)) if (!r.has(scId)) r.set(scId, asId);
    return r;
  }
}

/**
 * Runs one deal's database work. A deal the database refuses (a value it cannot hold) is counted
 * as skipped and the run goes on, so one bad deal never stops the others; three refusals in one
 * run mean the database itself is the trouble, and the error goes on up (the run reports it).
 */
async function tolerate(ctx: Ctx, work: () => Promise<void>): Promise<boolean> {
  try {
    await work();
    return true;
  } catch (err) {
    if (!(err instanceof Error && err.name === "DataError") || ++ctx.flags.dbFails >= 3) throw err;
    ctx.counts.skipped++;
    return false;
  }
}

async function execute(ctx: Ctx): Promise<void> {
  const { client, budget, state, counts } = ctx;
  const today = todayInDetroit(ctx.now());
  const people = new People(state, counts, ctx.now);
  const celebrate = { left: MAX_CELEBRATIONS };
  let boardChanged = false;

  // 1. AgentSpace's Scoreboard: the whole agency, every day since September, in one call.
  const sb = await client.get<{ leaderboard?: AsScoreRow[] }>("scoreboard/", { start_date: SYNC_FROM, end_date: today });
  ctx.flags.reached = true;
  const cells = cellsOf(sb.leaderboard ?? [], SYNC_FROM, today);
  counts.cells = cells.length;

  // 2. Scorecard's side, and who is who.
  await people.load();
  let linked = await listLinkedPolicies();
  for (const c of cells) await people.personFor(c.asAgentId, c.agentName, false);
  const compare = (): CellDiff[] => {
    const rev = people.reverse();
    return diffCells(cells, linked, Object.values(state.kept_removed).map((k) => ({ agentId: k.agent_id, day: k.day, cents: k.cents })), (id) => rev.get(id) ?? null);
  };
  let diffs = compare();
  counts.differing = diffs.length;
  const touched = new Set<string>();

  // Whether AgentSpace's own Scoreboard disagrees in this policy's agent-day: a policy comes off only when it does.
  const cellDiffers = (row: LinkedPolicy): boolean => {
    const key = `${people.reverse().get(row.agentId) ?? `sc:${row.agentId}`}|${row.day}`;
    return diffs.some((d) => d.key === key);
  };
  const refreshOne = async (row: LinkedPolicy, needScoreboard = false): Promise<void> => {
    touched.add(row.dealId);
    let deal: AsDeal;
    try {
      deal = await client.get<AsDeal>(`deals/${encodeURIComponent(row.dealId)}/`);
    } catch (err) {
      if (err instanceof AsError && err.kind === "not_found") {
        // A deal that 404s while the Scoreboard still counts its day is an answer to doubt, not to act on.
        if (needScoreboard && !cellDiffers(row)) {
          counts.skipped++;
          return;
        }
        delete state.kept_removed[row.dealId];
        if (!row.deleted && (await removeSyncedSale(row.saleId, "gone"))) {
          counts.removed++;
          boardChanged = true;
        }
        counts.checked++;
        return;
      }
      throw err;
    }
    counts.checked++;
    // An answer without the flag says nothing (a changed or partial answer must never empty the board).
    if (typeof deal.post_a_deal !== "boolean") {
      counts.skipped++;
      return;
    }
    if (deal.post_a_deal === false) {
      // Not production in AgentSpace (a carrier report only, or taken off Post a Deal).
      if (needScoreboard && !cellDiffers(row)) {
        counts.skipped++;
        return;
      }
      delete state.kept_removed[row.dealId];
      if (!row.deleted && (await removeSyncedSale(row.saleId, "not_counted"))) {
        counts.removed++;
        boardChanged = true;
      }
      return;
    }
    const made = dealToPolicy(deal);
    if (!made.ok) {
      counts.skipped++;
      return;
    }
    const agentId = await people.personFor(made.policy.asAgentId, made.policy.asAgentName, true);
    if (!agentId) return;
    if (row.deleted) {
      // A policy off the board whose deal counts again: back on if the sync took it off, else an admin did it on purpose and it stays off.
      if (!(await reviveSyncedSale(row.saleId))) {
        state.kept_removed[row.dealId] = { agent_id: agentId, day: made.policy.soldOn, cents: made.policy.premiumCents };
        return;
      }
      counts.revived++;
      boardChanged = true;
      delete state.kept_removed[row.dealId];
    }
    const r = await applyDealToSale(row.saleId, made.policy, agentId, people.names());
    if (r.changed.length) {
      counts.updated++;
      if (r.board) boardChanged = true;
    }
  };

  try {
    // 3. Where the two sides differ and a linked policy sits in the cell, look at those deals first
    // (a premium or a seller changed, a deal taken off, an admin's removal).
    if (diffs.length) {
      const byCell = new Map<string, LinkedPolicy[]>();
      const rev = people.reverse();
      for (const l of linked) {
        const k = `${rev.get(l.agentId) ?? `sc:${l.agentId}`}|${l.day}`;
        byCell.set(k, [...(byCell.get(k) ?? []), l]);
      }
      let looked = 0;
      for (const d of diffs) {
        for (const l of byCell.get(d.key) ?? []) {
          if (touched.has(l.dealId) || looked >= 20 || budgetSpent(budget)) continue;
          // A removed policy only matters when it could be what is missing here.
          if (l.deleted && !(state.kept_removed[l.dealId] || (d.delta > 0 && l.cents <= d.delta))) continue;
          looked++;
          await tolerate(ctx, () => refreshOne(l));
        }
      }
      if (looked) {
        linked = await listLinkedPolicies();
        diffs = compare();
      }
    }

    // 4. Deals AgentSpace has that Scorecard does not: find them through client search.
    const needs = needsOf(diffs);
    if (needs.size && !budgetSpent(budget)) {
      await findMissing(ctx, people, needs, new Set(linked.map((l) => l.dealId)), celebrate, () => {
        boardChanged = true;
      });
      linked = await listLinkedPolicies();
      diffs = compare();
    }

    // 5. The rotation: a slice of linked deals looked at again, so a change nobody's Scoreboard shows (a status, a policy number) arrives.
    if (!budgetSpent(budget)) {
      const live = linked.filter((l) => !l.deleted && !touched.has(l.dealId)).sort((a, b) => (a.dealId < b.dealId ? -1 : 1));
      const after = live.filter((l) => !state.refresh_cursor || l.dealId > state.refresh_cursor);
      const slice = [...after, ...live.filter((l) => !after.includes(l))].slice(0, diffs.length ? ROTATE_BUSY : ROTATE);
      for (const l of slice) {
        if (budgetSpent(budget)) break;
        await tolerate(ctx, () => refreshOne(l, true));
        state.refresh_cursor = l.dealId;
      }
      if (slice.length && slice.length >= live.length) state.refresh_cursor = null;
    }

  } finally {
    // The TV hears of every change, even when the run is cut short.
    if (boardChanged || counts.inserted || counts.removed || counts.revived) await touchBoard();
    // What is still different, for the Settings card: kept up even when the run was cut short (the card then says how far it got).
    try {
      if (boardChanged || counts.inserted || counts.removed || counts.revived || counts.linked) {
        linked = await listLinkedPolicies();
        diffs = compare();
      }
      state.linked_total = linked.filter((l) => !l.deleted).length;
      state.unresolved_total = diffs.length;
      state.unresolved = diffs.slice(0, 20).map((d) => ({ agent: d.agentName || "Someone", day: d.day, asCents: d.asCents, scCents: d.scCents }));
    } catch {
      /* the card keeps what it had */
    }
  }
  await ctx.checkpoint();
}

/** Walks client search until the cells that are missing deals have them (or the budget ends), linking or adding each deal it finds. */
async function findMissing(ctx: Ctx, people: People, needs: Map<string, CellDiff>, held: Set<string>, celebrate: { left: number }, changed: () => void): Promise<void> {
  const { client, state, counts } = ctx;
  const keys = [...needs.keys()].sort();
  const known = new Set(state.search.keys);
  const fresh = keys.some((k) => !known.has(k));
  const exhausted = state.search.exhausted_at ? Date.parse(state.search.exhausted_at) : 0;
  // The same gaps a full walk already failed to fill wait for the cooldown; a new gap starts at once.
  if (!fresh && exhausted && ctx.now().getTime() - exhausted < SEARCH_COOLDOWN_MS) return;
  if (fresh) state.search = { i: 0, keys, exhausted_at: null };
  const queries = searchQueries();
  let i = state.search.i;
  const tooMany = () => Object.keys(state.nonprod).length > NONPROD_CAP;
  try {
    for (; i < queries.length && needs.size; i++) {
      let page = 1;
      for (;;) {
        let result: AsClientPage;
        try {
          result = await client.get<AsClientPage>("clients/search/", { query: queries[i], page, page_size: 100 });
        } catch (err) {
          // Past the last page AgentSpace answers 404.
          if (err instanceof AsError && err.kind === "not_found" && page > 1) break;
          // A query it refuses is skipped (the others still walk).
          if (err instanceof AsError && err.kind === "bad_request") break;
          throw err;
        }
        for (const hit of result.results ?? []) {
          for (const d of hit.deals ?? []) {
            if (!needs.size) break;
            if (!worthFetching(d, needs, held, state.nonprod)) continue;
            const deal = await client.get<AsDeal>(`deals/${encodeURIComponent(d.id)}/`).catch((err: unknown) => {
              if (err instanceof AsError && err.kind === "not_found") return null;
              throw err;
            });
            counts.checked++;
            if (!deal || deal.post_a_deal !== true) {
              if (!tooMany()) state.nonprod[d.id] = d.updated_at ?? "";
              continue;
            }
            const made = dealToPolicy(deal);
            if (!made.ok) {
              counts.skipped++;
              if (!tooMany()) state.nonprod[d.id] = d.updated_at ?? "";
              continue;
            }
            const policy = made.policy;
            let placed = false;
            const done = await tolerate(ctx, async () => {
              const agentId = await people.personFor(policy.asAgentId, policy.asAgentName, true);
              if (!agentId) return;
              const how = await place(policy, agentId, people, celebrate, counts, ctx.now);
              if (how) changed();
              placed = true;
            });
            if (!done) {
              // Not tried again until AgentSpace changes the deal (the card keeps listing the day).
              held.add(d.id);
              if (!tooMany()) state.nonprod[d.id] = d.updated_at ?? "";
              continue;
            }
            if (!placed) continue;
            held.add(policy.dealId);
            const cell = needs.get(`${policy.asAgentId}|${policy.soldOn}`);
            if (cell) {
              cell.delta -= policy.premiumCents;
              if (cell.delta <= 0) needs.delete(cell.key);
            }
          }
        }
        if (!result.next) break;
        page++;
      }
      // Progress is saved as the walk goes, so a run that is cut short loses at most a query.
      if (i % 10 === 9) {
        state.search.i = i + 1;
        await ctx.checkpoint();
      }
    }
  } finally {
    state.search.i = needs.size ? i : 0;
  }
  if (needs.size && i >= queries.length) {
    state.search = { i: 0, keys, exhausted_at: ctx.now().toISOString() };
  } else if (!needs.size) state.search = { i: 0, keys: [], exhausted_at: null };
}

/** Links a found deal to the policy already here, or adds it. Returns what it did, null when nothing changed. */
async function place(p: SyncedPolicy, agentId: string, people: People, celebrate: { left: number }, counts: RunCounts, now: () => Date): Promise<"linked" | "inserted" | null> {
  const same = await findLinkableSale(p, agentId);
  if (same) {
    if (!(await linkSaleToDeal(same, p.dealId))) return null;
    counts.linked++;
    // The deal may have moved on since the policy was copied: bring it in step now.
    const r = await applyDealToSale(same, p, agentId, people.names());
    if (r.changed.length) counts.updated++;
    return "linked";
  }
  // A deal created in the last day is new on the TV (created now); older ones keep AgentSpace's own time, so nothing celebrates for them.
  const created = p.createdAt ? Date.parse(p.createdAt) : NaN;
  const fresh = Number.isFinite(created) && now().getTime() - created < FRESH_MS && celebrate.left > 0;
  if (fresh) celebrate.left--;
  const at = fresh || !Number.isFinite(created) ? now().toISOString() : new Date(created).toISOString();
  const id = await insertSyncedPolicy(p, agentId, at);
  if (!id) return null;
  counts.inserted++;
  // A deal new today that was logged in AgentSpace instead of here is posted like one logged here; an older one is not news.
  if (fresh) await postDeal({ agent: people.names().get(agentId) ?? "An agent", carrier: p.carrier, product: p.product, annualCents: p.premiumCents });
  return "inserted";
}

// ---- for the Settings card --------------------------------------------------------------------------------

/** What the card shows: counts, times and names of board people. No key, no deal, no client. */
export async function syncStatus(): Promise<SyncCard> {
  const on = connected();
  const empty: SyncCard = { nowMs: Date.now(), connected: on, lastOkAt: null, lastRunAt: null, errorClass: null, running: false, linked: 0, counts: null, unresolved: [], unresolvedTotal: 0, newAgents: [] };
  try {
    const { state } = await readStored();
    return {
      nowMs: Date.now(),
      connected: on,
      lastOkAt: state.last_ok_at,
      lastRunAt: state.last_run_at,
      errorClass: state.last_error_class,
      running: !!state.lock_until && Date.parse(state.lock_until) > Date.now(),
      linked: state.linked_total,
      counts: state.last_counts,
      unresolved: state.unresolved,
      unresolvedTotal: state.unresolved_total,
      newAgents: state.new_agents,
    };
  } catch {
    return empty;
  }
}

export { ERROR_LINE };
export type { ErrorClass, RunCounts, SyncCard, Unresolved };
