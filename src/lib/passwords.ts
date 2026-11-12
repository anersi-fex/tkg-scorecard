import "server-only";
import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from "node:crypto";

/**
 * A person's own password (owner, 2026-11-12: everyone gets their own sign-in). Only a scrypt
 * hash is ever stored (agents.pass_hash), never the password:
 *   scrypt$<N>$<r>$<p>$<salt base64>$<hash base64>
 * N = 2^15, r = 8, p = 3 (an OWASP-equivalent setting, about 32 MB and a tenth of a second, which
 * fits a serverless function), a random 16-byte salt and a 32-byte key. The settings ride in the
 * stored value, so they can be raised later without breaking older hashes.
 */
const N = 2 ** 15;
const R = 8;
const P = 3;
const SALT_BYTES = 16;
const KEY_BYTES = 32;
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 200;

function derive(password: string, salt: Buffer, keyLength: number, options: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password.normalize("NFKC"), salt, keyLength, options, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

/** Memory scrypt needs for these settings, with room to spare (Node refuses past maxmem). */
const maxmem = (n: number, r: number, p: number) => 128 * n * r + 128 * r * p + 1024 * 1024;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const key = await derive(password, salt, KEY_BYTES, { N, r: R, p: P, maxmem: maxmem(N, R, P) });
  return `scrypt$${N}$${R}$${P}$${salt.toString("base64")}$${key.toString("base64")}`;
}

/** The parts of a stored value, or null when it is not one of ours (wrong shape, odd settings). */
function parse(stored: unknown): { n: number; r: number; p: number; salt: Buffer; hash: Buffer } | null {
  if (typeof stored !== "string" || stored.length > 400) return null;
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return null;
  const [n, r, p] = [parts[1], parts[2], parts[3]].map((v) => (/^[1-9]\d{0,7}$/.test(v) ? Number(v) : NaN));
  // Bounds: a power of two between 2^14 and 2^17, and r and p small, so a strange row can never ask for gigabytes.
  if (!Number.isInteger(n) || n < 2 ** 14 || n > 2 ** 17 || (n & (n - 1)) !== 0) return null;
  if (!Number.isInteger(r) || r < 1 || r > 16 || !Number.isInteger(p) || p < 1 || p > 8) return null;
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(parts[4]) || !/^[A-Za-z0-9+/]+={0,2}$/.test(parts[5])) return null;
  const salt = Buffer.from(parts[4], "base64");
  const hash = Buffer.from(parts[5], "base64");
  if (salt.length < 8 || salt.length > 64 || hash.length < 16 || hash.length > 64) return null;
  return { n, r, p, salt, hash };
}

/** True only for the right password. Constant time; false (never a throw) for anything malformed. */
export async function verifyPassword(password: string, stored: string | null | undefined): Promise<boolean> {
  try {
    const parts = parse(stored);
    if (!parts || typeof password !== "string" || password.length === 0 || password.length > PASSWORD_MAX) return false;
    const key = await derive(password, parts.salt, parts.hash.length, { N: parts.n, r: parts.r, p: parts.p, maxmem: maxmem(parts.n, parts.r, parts.p) });
    return key.length === parts.hash.length && timingSafeEqual(key, parts.hash);
  } catch {
    return false;
  }
}

let dummy: Promise<string> | null = null;
/**
 * The same work as a real check, for a phone number nobody has: a sign-in with an unknown number
 * takes as long as one with a wrong password, so timing never says which numbers exist.
 */
export async function burnPasswordCheck(password: string): Promise<void> {
  try {
    dummy ??= hashPassword("not a real password");
    await verifyPassword(password || "x", await dummy);
  } catch {
    dummy = null;
  }
}

/** What is wrong with a new password, in plain words; null when it is fine. */
export function passwordProblem(password: unknown): string | null {
  if (typeof password !== "string" || password.length === 0) return "Type a password.";
  if (password.length < PASSWORD_MIN) return `Use ${PASSWORD_MIN} characters or more for the password.`;
  if (password.length > PASSWORD_MAX) return `Keep the password under ${PASSWORD_MAX} characters.`;
  return null;
}
