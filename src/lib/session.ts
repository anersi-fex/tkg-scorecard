// Session tokens: HMAC-SHA256 signed, stateless, Web Crypto only (runs in proxy.ts too).
// Two kinds, one cookie, one signing key:
//   v1.<role>.<expiresEpochSec>.<pwtag>.<base64url signature>            a shared password
//   v2.<agent id>.<expiresEpochSec>.<sessionVersion>.<base64url signature>  a person's own sign-in
// v1 format: v1.<role>.<expiresEpochSec>.<pwtag>.<base64url signature>
// role: "owner" (Anersi, full control) or "team" (anyone on the team: log sales, see the board).
// pwtag (first 8 hex of SHA-256 of that role's password) ties a token to the password that made
// it: changing a password signs out every device that used it. Signing key: SESSION_SECRET (32+
// chars), else derived from the Supabase service key. The same design as Text Assist.

export type Role = "owner" | "team";

const VERSION = "v1";
const enc = (s: string) => new TextEncoder().encode(s);

async function secretBytes(): Promise<Uint8Array> {
  const s = process.env.SESSION_SECRET;
  if (s && s.length >= 32) return enc(s);
  const base = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base || base.length < 20) throw new Error("No SESSION_SECRET and no SUPABASE_SERVICE_ROLE_KEY to derive one from");
  const k = await crypto.subtle.importKey("raw", enc(base), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", k, enc("scorecard/session/v1")));
}

async function hmacKey(usage: KeyUsage): Promise<CryptoKey> {
  const bytes = await secretBytes();
  return crypto.subtle.importKey("raw", bytes.slice().buffer, { name: "HMAC", hash: "SHA-256" }, false, [usage]);
}

function toBase64Url(bytes: ArrayBuffer): string {
  let bin = "";
  for (const b of new Uint8Array(bytes)) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(s: string): Uint8Array | null {
  try {
    const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
    const bin = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
    return Uint8Array.from(bin, (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

export function passwordFor(role: Role): string | undefined {
  const value = role === "owner" ? process.env.OWNER_PASSWORD : process.env.TEAM_PASSWORD;
  return value && value.length > 0 ? value : undefined;
}

async function passwordTag(role: Role): Promise<string | null> {
  const password = passwordFor(role);
  if (!password) return null;
  const digest = await crypto.subtle.digest("SHA-256", enc(password));
  return Array.from(new Uint8Array(digest).slice(0, 4))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function createSessionToken(role: Role, ttlSeconds: number): Promise<string> {
  const tag = await passwordTag(role);
  if (!tag) throw new Error(`${role === "owner" ? "OWNER_PASSWORD" : "TEAM_PASSWORD"} is not configured`);
  const expires = Math.floor(Date.now() / 1000) + ttlSeconds;
  const payload = `${VERSION}.${role}.${expires}.${tag}`;
  const sig = await crypto.subtle.sign("HMAC", await hmacKey("sign"), enc(payload));
  return `${payload}.${toBase64Url(sig)}`;
}

/** The role of a valid, unexpired token made under that role's current password; null otherwise. */
export async function verifySessionToken(token: string | undefined | null): Promise<Role | null> {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 5) return null;
  const [version, role, expiresStr, tag, sigStr] = parts;
  if (version !== VERSION || (role !== "owner" && role !== "team")) return null;
  if (!/^\d{1,12}$/.test(expiresStr) || !/^[0-9a-f]{8}$/.test(tag)) return null;
  const sig = fromBase64Url(sigStr);
  if (!sig || sig.length !== 32) return null;
  // crypto.subtle.verify is constant-time; never compare signatures by hand.
  const valid = await crypto.subtle.verify("HMAC", await hmacKey("verify"), sig.slice().buffer, enc(`${version}.${role}.${expiresStr}.${tag}`));
  if (!valid) return null;
  if (Number(expiresStr) <= Math.floor(Date.now() / 1000)) return null;
  return (await passwordTag(role)) === tag ? role : null;
}

// A person's own sign-in (owner, 2026-11-12). The token names the person and the session version
// it was made under; whoever reads it checks the person's row (active, the same version) before
// trusting it, so "Sign out everywhere", a new password or taking someone off the board ends it.
const PERSON_VERSION = "v2";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export async function createPersonToken(agentId: string, sessionVersion: number, ttlSeconds: number): Promise<string> {
  const id = String(agentId).toLowerCase();
  if (!UUID.test(id)) throw new Error("A person's session needs their id");
  if (!Number.isInteger(sessionVersion) || sessionVersion < 1 || sessionVersion > 999_999_999) throw new Error("A person's session needs their session version");
  const expires = Math.floor(Date.now() / 1000) + ttlSeconds;
  const payload = `${PERSON_VERSION}.${id}.${expires}.${sessionVersion}`;
  const sig = await crypto.subtle.sign("HMAC", await hmacKey("sign"), enc(payload));
  return `${payload}.${toBase64Url(sig)}`;
}

export type SessionClaim = { kind: "shared"; role: Role } | { kind: "person"; agentId: string; sessionVersion: number };

/**
 * What a cookie says, after its signature and its expiry were checked: a shared password's role
 * (the v1 check, password tag included), or a person and their session version. A person's claim
 * is not yet a session: src/lib/auth.ts checks the row. Null for anything else. Each kind signs
 * its own label, so a v1 token relabeled v2 (or the reverse) fails the signature.
 */
export async function readSessionToken(token: string | undefined | null): Promise<SessionClaim | null> {
  if (!token || token.length > 400) return null;
  if (token.startsWith(`${VERSION}.`)) {
    const role = await verifySessionToken(token);
    return role ? { kind: "shared", role } : null;
  }
  if (!token.startsWith(`${PERSON_VERSION}.`)) return null;
  const parts = token.split(".");
  if (parts.length !== 5) return null;
  const [version, agentId, expiresStr, versionStr, sigStr] = parts;
  if (version !== PERSON_VERSION || !UUID.test(agentId)) return null;
  if (!/^\d{1,12}$/.test(expiresStr) || !/^[1-9]\d{0,8}$/.test(versionStr)) return null;
  const sig = fromBase64Url(sigStr);
  if (!sig || sig.length !== 32) return null;
  const valid = await crypto.subtle.verify("HMAC", await hmacKey("verify"), sig.slice().buffer, enc(`${version}.${agentId}.${expiresStr}.${versionStr}`));
  if (!valid) return null;
  if (Number(expiresStr) <= Math.floor(Date.now() / 1000)) return null;
  return { kind: "person", agentId, sessionVersion: Number(versionStr) };
}

export const SESSION_COOKIE = "sc_session";
/** 180 days: the TV's browser and everyone's phone stay signed in; the cookie is httpOnly, secure, SameSite=Lax. */
export const SESSION_TTL_SECONDS = 180 * 24 * 60 * 60;
