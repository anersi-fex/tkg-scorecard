import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { timingSafeEqual, createHash } from "crypto";
import { verifySessionToken, SESSION_COOKIE, passwordFor, type Role } from "./session";
import { db } from "./supabase";

/**
 * Session checks. proxy.ts is only an optimistic gate (Next 16): every page calls requirePage()
 * and every server action and route handler calls requireRole() before touching data.
 * Two roles: the owner (full control) and the team (log sales, see everything).
 */
export const OWNER_NAME = "Anersi Koka";

export async function currentRole(): Promise<Role | null> {
  try {
    const store = await cookies();
    return await verifySessionToken(store.get(SESSION_COOKIE)?.value);
  } catch {
    return null;
  }
}

/** Pages and layouts: bounce to /login without a valid session; the role for what to show. */
export async function requirePage(need: Role | "any" = "any"): Promise<Role> {
  const role = await currentRole();
  if (!role) redirect("/login");
  if (need === "owner" && role !== "owner") redirect("/");
  return role;
}

/** Server actions and route handlers: throw instead of redirecting. */
export async function requireRole(need: Role | "any" = "any"): Promise<Role> {
  const role = await currentRole();
  if (!role) throw new Error("Not signed in");
  if (need === "owner" && role !== "owner") throw new Error("Only the owner can do that");
  return role;
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

// Login throttle: a per-instance map plus a shared count in login_attempts (holds across
// serverless instances). A team of seven never fails this often by accident.
const WINDOW_MS = 15 * 60 * 1000;
const MAX_PER_IP = 10;
const MAX_GLOBAL = 40;
const failures = new Map<string, { count: number; resetAt: number }>();

export async function loginThrottled(ip: string): Promise<boolean> {
  const entry = failures.get(ip);
  if (entry && entry.resetAt >= Date.now() && entry.count >= MAX_PER_IP) return true;
  try {
    const since = new Date(Date.now() - WINDOW_MS).toISOString();
    const { count, error } = await db().from("login_attempts").select("id", { count: "exact", head: true }).gte("at", since);
    if (error || count == null) return false;
    return count >= MAX_GLOBAL;
  } catch {
    return false;
  }
}

export async function recordLoginFailure(ip: string): Promise<void> {
  const now = Date.now();
  const entry = failures.get(ip);
  if (!entry || entry.resetAt < now) failures.set(ip, { count: 1, resetAt: now + WINDOW_MS });
  else {
    entry.count += 1;
    entry.resetAt = now + WINDOW_MS;
  }
  if (failures.size > 5000) for (const [k, v] of failures) if (v.resetAt < now) failures.delete(k);
  try {
    await db().from("login_attempts").insert({ ip: ip.slice(0, 64) });
  } catch {
    /* best effort */
  }
}

export function clearLoginFailures(ip: string): void {
  failures.delete(ip);
}
