import "server-only";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { timingSafeEqual, createHash } from "crypto";
import { createPersonToken, readSessionToken, SESSION_COOKIE, SESSION_TTL_SECONDS, passwordFor, type Role } from "./session";
import { ownerPerson, personForSession } from "./people";
import { isManager, isOwner, type Viewer } from "./viewer";
import { db } from "./supabase";

/**
 * Session checks. proxy.ts is only an optimistic gate (Next 16): every page calls pageViewer()
 * and every server action and route handler calls requireViewer() before touching data.
 *
 * Who is looking (src/lib/viewer.ts): the owner, an admin, a member (a person's own sign-in) or
 * the team (the shared team password: the TV, and phones that have not joined yet). The two
 * shared passwords work as they always did; the owner password signs in as the owner person.
 */
export const OWNER_NAME = "Anersi Koka";
/** The Shortcut token must be at least this long (the route refuses shorter ones; Settings says so). */
export const LOG_TOKEN_MIN = 12;

export type Need = "any" | "manager" | "owner";

async function readViewer(): Promise<Viewer | null> {
  let claim: Awaited<ReturnType<typeof readSessionToken>> = null;
  try {
    const store = await cookies();
    claim = await readSessionToken(store.get(SESSION_COOKIE)?.value);
  } catch {
    return null;
  }
  if (!claim) return null;
  if (claim.kind === "shared") {
    if (claim.role === "team") return { level: "team", agentId: null, name: null, via: "team-password" };
    // The owner password is the owner person (their row, when there is one). It still signs in
    // when the database does not answer, so the owner is never locked out of their own app.
    try {
      const owner = await ownerPerson();
      return { level: "owner", agentId: owner?.id ?? null, name: owner?.name ?? OWNER_NAME, via: "owner-password" };
    } catch {
      return { level: "owner", agentId: null, name: OWNER_NAME, via: "owner-password" };
    }
  }
  // A person's own sign-in counts only while their row is on the board and the session version
  // is the one the token was made under (Sign out everywhere and a new password raise it).
  // When the row cannot be read, nobody is signed in.
  try {
    const person = await personForSession(claim.agentId);
    if (!person || !person.active || person.sessionVersion !== claim.sessionVersion) return null;
    return { level: person.role, agentId: person.id, name: person.name, via: "person" };
  } catch {
    return null;
  }
}

/** Who is signed in on this request, or null. Read once per request. */
export const currentViewer: () => Promise<Viewer | null> = cache(readViewer);

function allowed(viewer: Viewer, need: Need): boolean {
  return need === "any" || (need === "manager" ? isManager(viewer) : isOwner(viewer));
}

/** Pages and layouts: to /login without a session, home without the level; the viewer for what to show. */
export async function pageViewer(need: Need = "any"): Promise<Viewer> {
  const viewer = await currentViewer();
  if (!viewer) redirect("/login");
  if (!allowed(viewer, need)) redirect("/");
  return viewer;
}

/** Server actions and route handlers: throw instead of redirecting. */
export async function requireViewer(need: Need = "any"): Promise<Viewer> {
  const viewer = await currentViewer();
  if (!viewer) throw new Error("Not signed in");
  if (!allowed(viewer, need)) throw new Error(need === "owner" ? "Only the owner can do that" : "Only an admin can do that");
  return viewer;
}

// The two-role view, for files that have not moved to the viewer yet: the owner and an admin
// read as "owner", a member and the team password as "team".
const roleOf = (viewer: Viewer): Role => (isManager(viewer) ? "owner" : "team");

export async function currentRole(): Promise<Role | null> {
  const viewer = await currentViewer();
  return viewer ? roleOf(viewer) : null;
}

export async function requirePage(need: Role | "any" = "any"): Promise<Role> {
  return roleOf(await pageViewer(need === "owner" ? "manager" : "any"));
}

export async function requireRole(need: Role | "any" = "any"): Promise<Role> {
  return roleOf(await requireViewer(need === "owner" ? "manager" : "any"));
}

const cookieFlags = () => ({ httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax" as const, path: "/", maxAge: SESSION_TTL_SECONDS });

/** Signs this device in as a person (after a right phone number and password, or a join): the same cookie and flags as the shared passwords. */
export async function startPersonSession(agentId: string, sessionVersion: number): Promise<void> {
  const token = await createPersonToken(agentId, sessionVersion, SESSION_TTL_SECONDS);
  (await cookies()).set(SESSION_COOKIE, token, cookieFlags());
}

/** Signs this device out. */
export async function endSession(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE);
}

/**
 * Which role a typed password unlocks, in constant time (both sides hashed first, so lengths
 * never leak; both passwords are always checked, so a right owner password takes as long as a
 * right team one). The owner's password wins when the two are the same.
 */
export function roleForPassword(supplied: string): Role | null {
  if (!supplied) return null;
  const a = createHash("sha256").update(supplied).digest();
  let found: Role | null = null;
  for (const role of ["team", "owner"] as const) {
    const expected = passwordFor(role);
    if (!expected) continue;
    const b = createHash("sha256").update(expected).digest();
    if (timingSafeEqual(a, b)) found = role;
  }
  return found;
}

// Login throttle: a per-instance map plus a shared per-address count in login_attempts (holds
// across serverless instances), and a high flood cap across every address, so one stranger
// typing wrong passwords locks only themselves out, never the owner or the TV. The same count
// guards the personal sign-in and the join links. A wrong try stays counted for 15 minutes: a
// right team password or a person's own sign-in never clears it (anyone on the team has those,
// and could guess at the owner password without limit otherwise); only the owner password does.
// A personal sign-in also counts wrong passwords per account, in the same table under
// "acct:<id>" (verifyPersonLogin in people.ts); those rows, and the "joined:" rows that count
// people who joined, stay out of the flood cap, so a locked account never closes sign-in for all.
const WINDOW_MS = 15 * 60 * 1000;
const MAX_PER_IP = 10;
const MAX_GLOBAL = 500;
const failures = new Map<string, { count: number; resetAt: number }>();

/** The address a request came from, for the throttle (never logged; "unknown" when the host does not say). */
export async function clientAddress(): Promise<string> {
  const h = await headers();
  return (h.get("x-forwarded-for")?.split(",")[0] || h.get("x-real-ip") || "unknown").trim().slice(0, 64);
}

/**
 * The key a join link's wrong tries are counted under: beside the sign-in count, never in it, so
 * a bad link opened in the office cannot lock the office's sign-ins (and the other way round).
 */
export const joinKey = (ip: string): string => `join:${ip}`.slice(0, 64);
/** A whole office joins from one address on the first day, so the join count allows more wrong tries. */
export const JOIN_MAX_PER_IP = 30;
/**
 * People who joined through the agency link from one address, counted under their own key, so a
 * link that got out cannot fill the board with made-up people at full speed. The limit sits well
 * above one office's first day.
 */
export const joinedKey = (ip: string): string => `joined:${ip}`.slice(0, 64);
export const JOINED_MAX_PER_IP = 60;

export async function loginThrottled(ip: string, max: number = MAX_PER_IP): Promise<boolean> {
  const entry = failures.get(ip);
  if (entry && entry.resetAt >= Date.now() && entry.count >= max) return true;
  try {
    const since = new Date(Date.now() - WINDOW_MS).toISOString();
    const recent = () => db().from("login_attempts").select("id", { count: "exact", head: true }).gte("at", since);
    const mine = await recent().eq("ip", ip.slice(0, 64));
    if (!mine.error && mine.count != null && mine.count >= max) return true;
    // The flood cap counts wrong tries by address only: not the per-account rows, not the joins.
    const all = await recent().not("ip", "like", "acct:%").not("ip", "like", "joined:%");
    if (all.error || all.count == null) return false;
    return all.count >= MAX_GLOBAL;
  } catch {
    return false;
  }
}

export async function recordLoginFailure(ip: string): Promise<void> {
  const now = Date.now();
  const entry = failures.get(ip);
  // The window runs from the first wrong try and is never pushed forward: 15 minutes, like the table's.
  if (!entry || entry.resetAt < now) failures.set(ip, { count: 1, resetAt: now + WINDOW_MS });
  else entry.count += 1;
  if (failures.size > 5000) for (const [k, v] of failures) if (v.resetAt < now) failures.delete(k);
  try {
    await db().from("login_attempts").insert({ ip: ip.slice(0, 64) });
  } catch {
    /* best effort */
  }
}

/** Clears an address's count (here and in the table). Only a right owner password does this. */
export async function clearLoginFailures(ip: string): Promise<void> {
  failures.delete(ip);
  try {
    await db().from("login_attempts").delete().eq("ip", ip.slice(0, 64));
  } catch {
    /* best effort */
  }
}
