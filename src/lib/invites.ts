import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { db } from "./supabase";
import { appBase } from "./app-url";

/**
 * Join links (owner, 2026-11-12: "send everyone something, and it automatically makes them sign
 * up"). A link holds 32 random bytes; the database keeps only their SHA-256, so reading the table
 * never yields a working link. The one exception is the agency link, kept as it is so an admin
 * can copy it again.
 *   agency  anyone with the link signs up (many uses); with upline_id, onto that leader's team
 *   person  for one person already on the board (one use, 7 days): they set their own sign-in
 *   reset   a person who forgot their password sets a new one (one use, 7 days)
 */
export type InviteKind = "agency" | "person" | "reset";

export interface Invite {
  id: string;
  kind: InviteKind;
  /** The person a person or reset link is for. */
  agent_id: string | null;
  /** An agency link for one leader's team. */
  upline_id: string | null;
  expires_at: string | null;
  uses: number;
}

const INVITE_COLUMNS = "id, kind, agent_id, upline_id, expires_at, revoked_at, used_at, uses";
type InviteRow = Invite & { revoked_at: string | null; used_at: string | null };
const ONE_USE_DAYS = 7;

function fail(where: string, error: { message: string } | null): never {
  throw new Error(`${where}: ${error?.message ?? "unknown error"}`);
}

/** A new link token: 32 random bytes as base64url (43 characters, nothing to escape in an address). */
export function newToken(): string {
  return randomBytes(32).toString("base64url");
}

/** True for something shaped like one of our tokens (checked before the database is asked). */
export function tokenShapeOk(token: unknown): token is string {
  return typeof token === "string" && /^[A-Za-z0-9_-]{43}$/.test(token);
}

/** What the database stores and looks a link up by: the token's SHA-256, in hex. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** When a one-use link stops working: 7 days after it was made. */
export function oneUseExpiry(from: Date = new Date()): string {
  return new Date(from.getTime() + ONE_USE_DAYS * 24 * 60 * 60 * 1000).toISOString();
}

/** A link that can still be used, as of `now`: not turned off, not expired and, for a one-use kind, not used. */
export function inviteLive(row: Pick<InviteRow, "kind" | "revoked_at" | "used_at" | "expires_at">, now: Date = new Date()): boolean {
  if (row.revoked_at) return false;
  if (row.expires_at && new Date(row.expires_at).getTime() <= now.getTime()) return false;
  if (row.kind !== "agency" && row.used_at) return false;
  return true;
}

function strip(row: InviteRow): Invite {
  return { id: row.id, kind: row.kind, agent_id: row.agent_id, upline_id: row.upline_id, expires_at: row.expires_at, uses: row.uses };
}

/**
 * Makes a link and returns its token (the only time a person or reset token exists outside the
 * person's own phone). A new person or reset link turns off the earlier unused ones for that person.
 */
export async function createInvite(input: { kind: InviteKind; agentId?: string | null; uplineId?: string | null; createdBy?: string | null }): Promise<{ id: string; token: string }> {
  const oneUse = input.kind !== "agency";
  if (oneUse && !input.agentId) throw new Error("A personal link needs its person.");
  if (oneUse) {
    const { error } = await db().from("invites").update({ revoked_at: new Date().toISOString() }).eq("agent_id", input.agentId).in("kind", ["person", "reset"]).is("used_at", null).is("revoked_at", null);
    if (error) fail("invites.replace", error);
  }
  const token = newToken();
  const { data, error } = await db()
    .from("invites")
    .insert({
      token_hash: hashToken(token),
      token: oneUse ? null : token,
      kind: input.kind,
      agent_id: oneUse ? input.agentId : null,
      upline_id: oneUse ? null : (input.uplineId ?? null),
      created_by: input.createdBy ?? null,
      expires_at: oneUse ? oneUseExpiry() : null,
    })
    .select("id")
    .single();
  if (error) fail("invites.create", error);
  return { id: String(data.id), token };
}

/** The link a token opens, or null when it is unknown, turned off, expired or (a one-use kind) used. Looked up by hash. */
export async function readInvite(token: unknown): Promise<Invite | null> {
  if (!tokenShapeOk(token)) return null;
  const { data, error } = await db().from("invites").select(INVITE_COLUMNS).eq("token_hash", hashToken(token)).maybeSingle();
  if (error) fail("invites.read", error);
  const row = data as InviteRow | null;
  return row && inviteLive(row) ? strip(row) : null;
}

/**
 * Uses a link. A one-use link is taken with one guarded update (only while unused and not turned
 * off), so two phones opening it at the same moment cannot both use it: false for the second.
 * The agency link just counts.
 */
export async function consumeInvite(invite: Pick<Invite, "id" | "kind" | "uses">): Promise<boolean> {
  const now = new Date().toISOString();
  if (invite.kind === "agency") {
    const { data, error } = await db().from("invites").update({ uses: invite.uses + 1, used_at: now }).eq("id", invite.id).is("revoked_at", null).select("id");
    if (error) fail("invites.use", error);
    return (data?.length ?? 0) > 0;
  }
  const { data, error } = await db().from("invites").update({ used_at: now, uses: 1 }).eq("id", invite.id).is("used_at", null).is("revoked_at", null).gt("expires_at", now).select("id");
  if (error) fail("invites.use", error);
  return (data?.length ?? 0) > 0;
}

export async function revokeInvite(id: string): Promise<void> {
  const { error } = await db().from("invites").update({ revoked_at: new Date().toISOString() }).eq("id", id).is("revoked_at", null);
  if (error) fail("invites.revoke", error);
}

/** Turns off every agency link (the main one and each leader's), so a link that got out stops working. */
export async function revokeAgencyInvites(): Promise<void> {
  const { error } = await db().from("invites").update({ revoked_at: new Date().toISOString() }).eq("kind", "agency").is("revoked_at", null);
  if (error) fail("invites.revoke", error);
}

/** Turns off a person's unused personal links (they were taken off the board, or made an admin). */
export async function revokePersonInvites(agentId: string): Promise<void> {
  const { error } = await db().from("invites").update({ revoked_at: new Date().toISOString() }).eq("agent_id", agentId).in("kind", ["person", "reset"]).is("used_at", null).is("revoked_at", null);
  if (error) fail("invites.revoke", error);
}

/** The agency link's token (for one leader's team with uplineId), made the first time it is asked for. */
export async function agencyToken(uplineId: string | null, createdBy: string | null): Promise<string> {
  let q = db().from("invites").select("token").eq("kind", "agency").is("revoked_at", null).not("token", "is", null).order("created_at", { ascending: false }).limit(1);
  q = uplineId ? q.eq("upline_id", uplineId) : q.is("upline_id", null);
  const { data, error } = await q;
  if (error) fail("invites.agency", error);
  const found = data?.[0]?.token;
  if (typeof found === "string" && tokenShapeOk(found)) return found;
  return (await createInvite({ kind: "agency", uplineId, createdBy })).token;
}

/** The address to send someone: <app>/join/<token>. */
export async function joinUrl(token: string): Promise<string> {
  return `${await appBase()}/join/${token}`;
}
