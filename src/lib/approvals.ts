import "server-only";
import { db } from "./supabase";
import { DataError, Said, getAgent, getSale, getSettings } from "./data";
import { personForSession, setRole } from "./people";
import { revokeInvitesMadeBy, revokeOwnTeamLinks, revokePersonInvites } from "./invites";
import { applyApprovedFix, applyApprovedRemove, parseBoardPatch } from "./policies";
import { APPROVAL_KINDS, isOwner, type ApprovalKind, type Viewer } from "./viewer";

/**
 * What an admin asked for that waits for the owner's yes (owner, 2026-11-12: "if unsure about
 * privileges or permissions, then make it so that that's something that I need to approve"):
 * making or removing an admin, and fixing or removing a sale of a past month. A row holds ids
 * and the new values only, and a plain-words line with names and amounts; never a client's
 * details. Only the owner decides, once: the status changes with a guarded update, so a double
 * tap runs the change one time, and the change is checked again at that moment.
 */
export type ApprovalStatus = "pending" | "approved" | "declined";

export interface Approval {
  id: string;
  kind: ApprovalKind;
  payload: Record<string, unknown>;
  /** Plain words: "Make Dana Reyes an admin". */
  summary: string;
  requested_by: string | null;
  /** Who asked, by name (null when that person is gone). */
  requested_by_name: string | null;
  requested_at: string;
  status: ApprovalStatus;
  decided_at: string | null;
}

/**
 * The new values of a sale an admin wants to change in a past month: its board fields only (who
 * sold it, the premium, the day, the carrier, the product; and on an older sale the policy count,
 * the kind and the note), never a client's value. policies.ts BoardPatch; a row filed before 0006
 * holds every one of them, a newer one only what changes.
 */
export type { BoardPatch as SalePatch } from "./policies";

const COLUMNS = "id, kind, payload, summary, requested_by, requested_at, status, decided_at, agents!requested_by(name)";
type Row = Omit<Approval, "requested_by_name" | "kind"> & { kind: string; agents: { name: string } | { name: string }[] | null };

function fail(where: string, error: { message: string } | null): never {
  throw new DataError(where, error);
}

const isKind = (v: unknown): v is ApprovalKind => typeof v === "string" && (APPROVAL_KINDS as string[]).includes(v);
const isUuid = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

function toApproval(r: Row): Approval | null {
  if (!isKind(r.kind)) return null;
  const who = Array.isArray(r.agents) ? r.agents[0] : r.agents;
  return {
    id: r.id,
    kind: r.kind,
    payload: r.payload && typeof r.payload === "object" ? r.payload : {},
    summary: r.summary,
    requested_by: r.requested_by,
    requested_by_name: who?.name ?? null,
    requested_at: r.requested_at,
    status: r.status,
    decided_at: r.decided_at,
  };
}

/** Added to a waiting request's line when a newer request for the same thing takes its place. */
const REPLACED = " (replaced by a newer request)";

/** What the request is about: the person for an admin change, the sale for a sale change. */
const targetKey = (kind: ApprovalKind) => (kind === "make_admin" || kind === "remove_admin" ? "agent_id" : "sale_id");

/**
 * Files a request for the owner. Asking twice for the same thing keeps one waiting request: the
 * earlier one is closed (it reads "replaced by a newer request") and a NEW row is made, so a
 * request the owner has on screen never changes under his finger: his yes to the old one finds
 * it already answered, and he reads the new one before he approves it.
 */
export async function requestApproval(input: { kind: ApprovalKind; payload: Record<string, unknown>; summary: string; requestedBy: string | null }): Promise<void> {
  if (!isKind(input.kind)) throw new Said("That isn't something to ask for.");
  const key = targetKey(input.kind);
  const target = input.payload[key];
  if (!isUuid(target)) throw new Said("That request is missing what it is about.");
  const summary = input.summary.replace(/\s+/g, " ").trim().slice(0, 200);
  const waiting = await db().from("approvals").select("id, summary").eq("status", "pending").eq("kind", input.kind).eq(`payload->>${key}`, target);
  if (waiting.error) fail("approvals.find", waiting.error);
  for (const old of waiting.data ?? []) {
    const { error } = await db()
      .from("approvals")
      .update({ status: "declined", decided_at: new Date().toISOString(), summary: `${String(old.summary).slice(0, 200 - REPLACED.length)}${REPLACED}` })
      .eq("id", old.id)
      .eq("status", "pending");
    if (error) fail("approvals.replace", error);
  }
  const { error } = await db().from("approvals").insert({ kind: input.kind, payload: input.payload, summary, requested_by: input.requestedBy });
  if (error) fail("approvals.request", error);
}

/** The requests, newest first: every one of a status, or (no status) the waiting ones then the last 30 answered. */
export async function listApprovals(status?: ApprovalStatus): Promise<Approval[]> {
  const read = async (s: ApprovalStatus | "answered", limit: number) => {
    let q = db().from("approvals").select(COLUMNS).order("requested_at", { ascending: false }).limit(limit);
    q = s === "answered" ? q.neq("status", "pending") : q.eq("status", s);
    const { data, error } = await q;
    if (error) fail("approvals.list", error);
    return ((data ?? []) as unknown as Row[]).map(toApproval).filter((a): a is Approval => a !== null);
  };
  if (status) return read(status, 200);
  const [pending, answered] = await Promise.all([read("pending", 200), read("answered", 30)]);
  return [...pending, ...answered];
}

/** How many wait for the owner (the badge on the owner's menu). 0 when the table cannot be read. */
export async function countPendingApprovals(): Promise<number> {
  try {
    const { count, error } = await db().from("approvals").select("id", { count: "exact", head: true }).eq("status", "pending");
    return error || count == null ? 0 : count;
  } catch {
    return 0;
  }
}

/** Runs an approved change, checked again now. Returns what happened, in plain words. */
async function carryOut(a: Approval, viewer: Viewer): Promise<string> {
  if (a.kind === "make_admin" || a.kind === "remove_admin") {
    const id = a.payload.agent_id;
    const person = isUuid(id) ? await personForSession(id) : null;
    if (!person) return "Approved, but that person is gone, so nothing changed.";
    if (person.role === "owner") return "Approved, but the owner's level never changes, so nothing changed.";
    if (a.kind === "make_admin") {
      if (!person.active) return `Approved, but ${person.name} is off the board, so nothing changed.`;
      if (person.role === "admin") return `${person.name} is already an admin.`;
      await setRole(person.id, "admin");
      // A link made while they were a member must not hand out an admin's sign-in.
      await revokePersonInvites(person.id);
      return `${person.name} is an admin now.`;
    }
    if (person.role !== "admin") return `${person.name} is not an admin anymore already.`;
    // The one-time links they made as an admin stop with the level. First, so a try that fails
    // halfway leaves the level as it was and the next try does both. They land on the level asked
    // for (a manager, or an agent: every request before 0006 asked for an agent).
    await revokeInvitesMadeBy(person.id);
    if (a.payload.role !== "manager") await revokeOwnTeamLinks(person.id);
    await setRole(person.id, a.payload.role === "manager" ? "manager" : "member");
    return `${person.name} is not an admin anymore.`;
  }
  const saleId = a.payload.sale_id;
  const sale = isUuid(saleId) ? await getSale(saleId) : null;
  if (!sale) return "Approved, but that sale is already gone, so nothing changed.";
  if (a.kind === "remove_past_sale") {
    return (await applyApprovedRemove(sale.id, viewer)) ? "Approved. The sale is removed." : "Approved, but that sale is already gone, so nothing changed.";
  }
  const patch = parseBoardPatch(a.payload.patch);
  if (!patch) return "Approved, but the new numbers could not be read, so nothing changed.";
  // Checked again now, like the fix was when it was asked for: Settings may have changed while it waited.
  if (patch.kind === "pc" && !(await getSettings()).pcEnabled) return "Approved, but that kind of sale is turned off, so nothing changed.";
  if (patch.agent_id && !(await getAgent(patch.agent_id))) return "Approved, but that person is gone, so nothing changed.";
  const found = await applyApprovedFix(sale.id, patch, viewer);
  return found ? "Approved. The sale is fixed." : "Approved, but that sale is already gone, so nothing changed.";
}

/**
 * The owner's yes or no. Owner only. The status moves from pending with one guarded update, so
 * a second tap (or a second phone) finds nothing left to do; a yes then runs the change. If the
 * change itself fails (the database did not answer), the request goes back to waiting.
 */
export async function decideApproval(id: string, approve: boolean, viewer: Viewer): Promise<{ ok: true; message: string } | { ok: false; error: string }> {
  if (!isOwner(viewer)) throw new Said("Only the owner can do that");
  if (!isUuid(id)) return { ok: false, error: "That request isn't here." };
  const decided_at = new Date().toISOString();
  const { data, error } = await db()
    .from("approvals")
    .update({ status: approve ? "approved" : "declined", decided_by: viewer.agentId, decided_at })
    .eq("id", id)
    .eq("status", "pending")
    .select(COLUMNS);
  if (error) fail("approvals.decide", error);
  const row = data?.[0] ? toApproval(data[0] as unknown as Row) : null;
  if (!row) return { ok: false, error: "That one was already answered." };
  if (!approve) return { ok: true, message: "Declined. Nothing changed." };
  try {
    return { ok: true, message: await carryOut(row, viewer) };
  } catch (err) {
    await db().from("approvals").update({ status: "pending", decided_by: null, decided_at: null }).eq("id", id).eq("status", "approved").eq("decided_at", decided_at);
    throw err;
  }
}
