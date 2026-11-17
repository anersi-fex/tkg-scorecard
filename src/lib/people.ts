import "server-only";
import { db } from "./supabase";
import { burnPasswordCheck, hashPassword, passwordProblem, verifyPassword } from "./passwords";
import { normalizePhone } from "./phone";
import { consumeInvite, readInvite } from "./invites";
import { DataError, Said } from "./data";
import { isAgentRole, type Agent, type AgentRole } from "./types";

/**
 * People and their own sign-ins (owner, 2026-11-12: "I would like everyone to be able to join").
 * The ONLY file that reads agents.phone or agents.pass_hash. A phone number goes on to a manager's
 * screen (owner or admin) and nowhere else; a password hash never leaves this file; neither is
 * ever logged. Callers check the session and the level first.
 */
export type Person = Agent & { phone: string | null; has_login: boolean };

const PERSON_COLUMNS = "id, name, active, sort, pc_licensed, upline_id, upline_confirmed, in_office, role, joined_at, phone";
type PersonRow = Omit<Person, "has_login">;

export const BAD_LINK = "This link isn't good anymore. Ask for a new one.";
export const PHONE_TAKEN = "That number already has a sign-in. Sign in instead.";
/** Someone who was taken off the board opened the agency link: an admin puts them back, the link never does. */
export const OFF_BOARD = "Ask an admin to put you back on the board.";
const PHONE_HELP = "Type your cell number with the area code, like 248 555 0100.";

function fail(where: string, error: { message: string } | null): never {
  // The table and the operation only: never a row, a number or a name. Never shown to a person (data.ts lineFor).
  throw new DataError(where, error);
}

const isUuid = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

// Every apostrophe a keyboard makes (an iPhone types the curly one) is the plain one in a name.
const APOSTROPHES = /[\u2018\u2019\u201B\u02BC\u02B9\u2032\u0060\u00B4\uFF07]/g;
/**
 * One written form of a name: a plain apostrophe, compatibility forms folded (NFKC), no invisible
 * or control characters (a zero-width space makes a second "Jack Gariglio"), single spaces.
 */
function tidyName(input: string): string {
  return input
    .replace(APOSTROPHES, "'")
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .replace(/[\p{Cf}\p{Cc}]/gu, "")
    .replace(/ +/g, " ")
    .trim();
}
/** Latin letters beside letters of another alphabet (a Cyrillic "A" in "Admin"): a look-alike, not a name. */
const mixesAlphabets = (name: string) => /\p{Script=Latin}/u.test(name) && /[^\p{Script=Latin}\P{L}]/u.test(name);

/** A name as it is stored (tidyName). Null when it is empty, over 60 characters or mixes alphabets. */
export function cleanName(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const name = tidyName(input);
  return name.length >= 1 && name.length <= 60 && !mixesAlphabets(name) ? name : null;
}
/** The same person's name, however it was typed (case, spaces, the kind of apostrophe, invisible characters). */
export const sameName = (a: string, b: string) => tidyName(a).toLowerCase() === tidyName(b).toLowerCase();

/** The ids of everyone who made a sign-in (the hash itself is never read for a list). */
async function loginIds(): Promise<Set<string>> {
  const { data, error } = await db().from("agents").select("id").not("pass_hash", "is", null);
  if (error) fail("people.logins", error);
  return new Set((data ?? []).map((r) => String(r.id)));
}

/** Has anyone made their own sign-in yet? (The sign-in screen opens on "Your sign-in" once someone has.) */
export async function anyoneHasSignIn(): Promise<boolean> {
  const { data, error } = await db().from("agents").select("id").not("pass_hash", "is", null).eq("active", true).limit(1);
  if (error) fail("people.logins", error);
  return (data?.length ?? 0) > 0;
}

/** Everyone, with the phone number: pass the phone on only to a manager's screen. */
export async function listPeople(opts: { includeInactive?: boolean } = {}): Promise<Person[]> {
  let q = db().from("agents").select(PERSON_COLUMNS).order("sort").order("name");
  if (!opts.includeInactive) q = q.eq("active", true);
  const [rows, logins] = await Promise.all([q, loginIds()]);
  if (rows.error) fail("people.list", rows.error);
  return ((rows.data ?? []) as PersonRow[]).map((r) => ({ ...r, has_login: logins.has(r.id) }));
}

export async function getPerson(id: string): Promise<Person | null> {
  if (!isUuid(id)) return null;
  const [row, login] = await Promise.all([
    db().from("agents").select(PERSON_COLUMNS).eq("id", id).maybeSingle(),
    db().from("agents").select("id").eq("id", id).not("pass_hash", "is", null).maybeSingle(),
  ]);
  if (row.error) fail("people.get", row.error);
  if (login.error) fail("people.get", login.error);
  return row.data ? { ...(row.data as PersonRow), has_login: !!login.data } : null;
}

/** What a session check needs, and nothing else. */
export interface SessionPerson {
  id: string;
  name: string;
  role: AgentRole;
  active: boolean;
  sessionVersion: number;
}

function toSessionPerson(r: { id: unknown; name: unknown; role: unknown; active: unknown; session_version: unknown }): SessionPerson {
  return { id: String(r.id), name: String(r.name), role: isAgentRole(r.role) ? r.role : "member", active: r.active === true, sessionVersion: Number(r.session_version) };
}

export async function personForSession(id: string): Promise<SessionPerson | null> {
  if (!isUuid(id)) return null;
  const { data, error } = await db().from("agents").select("id, name, role, active, session_version").eq("id", id).maybeSingle();
  if (error) fail("people.session", error);
  return data ? toSessionPerson(data) : null;
}

/** The owner's own row (role = 'owner'; the database allows one), or null before it exists. */
export async function ownerPerson(): Promise<SessionPerson | null> {
  const { data, error } = await db().from("agents").select("id, name, role, active, session_version").eq("role", "owner").limit(1);
  if (error) fail("people.owner", error);
  return data?.[0] ? toSessionPerson(data[0]) : null;
}

async function patchPerson(id: string, patch: Record<string, unknown>, where = "people.update"): Promise<void> {
  const { error } = await db()
    .from("agents")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) fail(where, error);
}

/** Would putting `id` under `uplineId` make a loop (someone under their own downline)? */
async function wouldLoop(id: string, uplineId: string): Promise<boolean> {
  if (id === uplineId) return true;
  const { data, error } = await db().from("agents").select("id, upline_id");
  if (error) fail("people.tree", error);
  const up = new Map<string, string | null>((data ?? []).map((r) => [String(r.id), r.upline_id ? String(r.upline_id) : null]));
  const seen = new Set<string>();
  for (let at: string | null = uplineId; at; at = up.get(at) ?? null) {
    if (at === id) return true;
    if (seen.has(at)) return true; // a loop already in the data: do not add to it
    seen.add(at);
  }
  return false;
}

/**
 * A row a join can claim by its name is a member's (an agent's) with no sign-in yet. Claiming a row
 * makes the claimer that person, so a row whose sign-in would open clients is never claimed by a
 * name typed on a link: an owner's, an admin's or a manager's row, a row with people under it (they
 * would see that team's clients), and a row that already holds a policy logged in the CRM (its
 * clients). Those get a one-time person link from an admin instead.
 */
export const claimableRole = (role: AgentRole | null | undefined): boolean => (role ?? "member") === "member";

/** Does this row hold a policy logged in the CRM (status set: every one since 0006)? No client value is read. */
async function holdsPolicies(id: string): Promise<boolean> {
  const { data, error } = await db().from("sales").select("id").eq("agent_id", id).not("status", "is", null).limit(1);
  if (error) fail("people.claim_check", error);
  return (data?.length ?? 0) > 0;
}

type ClaimRow = { id: string; active: boolean; role: AgentRole; upline_id: string | null; upline_confirmed?: boolean };

/**
 * The cell number AgentSpace has on file for each person (settings key `claim_phones`,
 * `{ "<agent id>": "+1XXXXXXXXXX" }`, loaded 2026-11-17 from the agency's own records). A name typed
 * on a join link claims a row that has a number on file only together with that number: the name
 * alone is something anyone in the group chat could type, and the row opens clients.
 */
async function loadClaimPhones(): Promise<Map<string, string>> {
  const { data, error } = await db().from("settings").select("value").eq("key", "claim_phones").maybeSingle();
  if (error) fail("people.claim_phones", error);
  const out = new Map<string, string>();
  if (!data) return out; // no row: nobody has a number on file, the old rule holds
  const v = data.value;
  // A row that is there but not an object is broken data: joining stops (the person sees "try again") rather than falling back to names alone.
  if (!v || typeof v !== "object" || Array.isArray(v)) fail("people.claim_phones", { message: "claim_phones is not an object" });
  for (const [id, phone] of Object.entries(v as Record<string, unknown>)) {
    if (!isUuid(id)) continue;
    // An entry that is not a +1 number still protects its row: it can never be matched, so that person gets an admin's link.
    out.set(id, typeof phone === "string" && /^\+1\d{10}$/.test(phone) ? phone : "invalid");
  }
  return out;
}

/**
 * Which rows of `rows` a name typed on a join link may claim (see claimableRole), as a map from the
 * row's id to the cell number that must be typed with the name (null: the name is enough).
 * `everyone` is the whole board (who has people under them); it defaults to `rows`.
 *
 * A row with a number on file (`phones`) is claimable by its name and that number, whatever it
 * opens: an owner's or an admin's row never is. A row without one is claimable by its name alone
 * only when it opens nothing: no policy, no team of its own, not a manager (an admin sends that
 * person their own link), the old rule. `vouchedBy` is the leader whose team link this is: that
 * person's own direct, confirmed people may be claimed even when they lead a team or are managers
 * (the link comes from the one person above them), so the rollout can go down the tree by tapping
 * names; a row that holds a policy and has no number on file still needs an admin's person link.
 */
async function claimPlan(rows: ClaimRow[], logins: Set<string>, opts: { vouchedBy?: string | null; everyone?: ClaimRow[]; phones?: Map<string, string> } = {}): Promise<Map<string, string | null>> {
  const leads = new Set((opts.everyone ?? rows).filter((r) => r.active && r.upline_id && r.upline_id !== r.id).map((r) => r.upline_id as string));
  const vouched = (r: ClaimRow) => !!opts.vouchedBy && r.id !== opts.vouchedBy && r.upline_id === opts.vouchedBy && r.upline_confirmed !== false;
  const phones = opts.phones ?? new Map<string, string>();
  const plan = new Map<string, string | null>();
  const open = rows.filter((r) => r.active && !logins.has(r.id) && (r.role === "member" || r.role === "manager"));
  const rest: ClaimRow[] = [];
  for (const r of open) {
    const on = phones.get(r.id);
    if (on) plan.set(r.id, on);
    else if ((claimableRole(r.role) || (r.role === "manager" && vouched(r))) && (!leads.has(r.id) || vouched(r))) rest.push(r);
  }
  const held = await Promise.all(rest.map((r) => holdsPolicies(r.id)));
  rest.forEach((r, i) => {
    if (!held[i]) plan.set(r.id, null);
  });
  return plan;
}

/**
 * The names the join card offers to tap ("Already on the board? Tap your name."): the rows a typed
 * name may claim, names only (no id, no number), sorted. On a leader's team link (`leaderId`) that
 * leader's own people are in the list too.
 */
export async function claimableNames(leaderId?: string | null): Promise<string[]> {
  // The join page is opened by about 50 people within minutes and each open costs a database read
  // per unclaimed name: one answer is kept for 30 seconds per link (the chips are a nudge; the
  // server's rule is checked again when someone submits, so a stale chip is harmless).
  const key = leaderId ?? "";
  const hit = claimableKept.get(key);
  if (hit && Date.now() - hit.at < CLAIMABLE_KEEP_MS) return hit.names;
  const [people, logins, phones] = await Promise.all([roster(), loginIds(), loadClaimPhones()]);
  const ok = await claimPlan(people, logins, { vouchedBy: leaderId ?? null, everyone: people, phones });
  // Only the names a tap alone can claim: someone with a number on file is found by their number (lookupJoinPhone).
  const names = [...new Set(people.filter((p) => ok.has(p.id) && ok.get(p.id) === null && !p.phone).map((p) => p.name))].sort((x, y) => x.localeCompare(y));
  claimableKept.set(key, { at: Date.now(), names });
  if (claimableKept.size > 200) claimableKept.clear();
  return names;
}
const CLAIMABLE_KEEP_MS = 30_000;
const claimableKept = new Map<string, { at: number; names: string[] }>();

/** Whose team a person is on (null: the top of the tree). Refuses a loop. An admin setting it confirms it (0006). */
export async function setUpline(id: string, uplineId: string | null): Promise<void> {
  if (!isUuid(id) || (uplineId !== null && !isUuid(uplineId))) throw new Said("That person isn't here.");
  const person = await personForSession(id);
  if (!person) throw new Said("That person isn't here.");
  if (uplineId) {
    const upline = await personForSession(uplineId);
    if (!upline || !upline.active) throw new Said("That upline isn't on the board.");
    if (await wouldLoop(id, uplineId)) throw new Said(id === uplineId ? "A person can't be their own upline." : `${upline.name} is on ${person.name}'s team, so ${person.name} can't go under them.`);
  }
  await patchPerson(id, { upline_id: uplineId, upline_confirmed: true }, "people.upline");
}

/**
 * The upline a joiner picked is confirmed (by that upline, a manager above them, or an admin: the
 * caller checks who, rules.canConfirmJoiner). Only while it is still waiting; false when there was
 * nothing to confirm (already confirmed, declined, or the upline changed meanwhile).
 */
export async function confirmUpline(id: string, uplineId: string): Promise<boolean> {
  if (!isUuid(id) || !isUuid(uplineId)) return false;
  const { data, error } = await db()
    .from("agents")
    .update({ upline_confirmed: true, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("upline_id", uplineId)
    .eq("upline_confirmed", false)
    .select("id");
  if (error) fail("people.confirm", error);
  return (data?.length ?? 0) > 0;
}

/** "Not on my team": the waiting upline is cleared (the person stays on the board, on nobody's team). */
export async function declineUpline(id: string, uplineId: string): Promise<boolean> {
  if (!isUuid(id) || !isUuid(uplineId)) return false;
  const { data, error } = await db()
    .from("agents")
    .update({ upline_id: null, upline_confirmed: true, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("upline_id", uplineId)
    .eq("upline_confirmed", false)
    .select("id");
  if (error) fail("people.decline", error);
  return (data?.length ?? 0) > 0;
}

export async function setInOffice(id: string, on: boolean): Promise<void> {
  if (!isUuid(id)) throw new Said("That person isn't here.");
  await patchPerson(id, { in_office: on === true }, "people.office");
}

/** Admin, manager or member. The owner's row never changes here (the database holds exactly one owner). */
export async function setRole(id: string, role: AgentRole): Promise<void> {
  if (!isUuid(id) || (role !== "admin" && role !== "manager" && role !== "member")) throw new Said("That isn't one of the levels.");
  const { data, error } = await db().from("agents").update({ role, updated_at: new Date().toISOString() }).eq("id", id).neq("role", "owner").select("id");
  if (error) fail("people.role", error);
  if (!data?.length) throw new Said("That person's level can't be changed.");
}

/** Signs a person out everywhere: every session made before now stops working. Returns the new version. */
export async function bumpSession(id: string): Promise<number> {
  const person = await personForSession(id);
  if (!person) throw new Said("That person isn't here.");
  const next = person.sessionVersion + 1;
  await patchPerson(id, { session_version: next }, "people.session");
  return next;
}

export async function setName(id: string, name: string): Promise<void> {
  await patchPerson(id, { name }, "people.name");
}

/** A person's cell number (the name they sign in with). Refuses a number someone else has. */
export async function setPhone(id: string, phone: string | null): Promise<void> {
  if (!isUuid(id)) throw new Said("That person isn't here.");
  if (phone !== null) {
    const { data, error } = await db().from("agents").select("id").eq("phone", phone).neq("id", id).limit(1);
    if (error) fail("people.phone", error);
    if (data?.length) throw new Said("Someone else signs in with that number.");
  }
  const { error } = await db().from("agents").update({ phone, updated_at: new Date().toISOString() }).eq("id", id);
  if (error) {
    if ((error as { code?: string }).code === "23505") throw new Said("Someone else signs in with that number.");
    fail("people.phone", error);
  }
}

// Wrong passwords for one account, counted in login_attempts under "acct:<id>" (the same table and
// 15-minute window as the per-address counts in auth.ts). Past 20, the account is closed to every
// address that has another wrong try of its own in the window, and to nobody else: whoever is
// guessing is stopped, and the person's own phone still gets in with the right password, so
// nobody can keep someone else from signing in. (These rows stay out of the flood cap in auth.ts.)
// Like the address's count, a try is written BEFORE the password is looked at and counted with
// its own row in, so tries sent at the same moment cannot all get under the limit; a right
// password takes the account's rows back, and a try that finds the account closed takes back its own.
const ACCOUNT_WINDOW_MS = 15 * 60 * 1000;
const ACCOUNT_MAX = 20;
const acctKey = (id: string) => `acct:${id}`;
/** The key an unknown number's wrong try is counted under, so it costs what a known one costs. */
const NO_ACCOUNT = "acct:none";

/** Rows in the window under one key (0 when the table cannot be read). */
async function recentTries(key: string): Promise<number> {
  try {
    const since = new Date(Date.now() - ACCOUNT_WINDOW_MS).toISOString();
    const { count, error } = await db().from("login_attempts").select("id", { count: "exact", head: true }).eq("ip", key.slice(0, 64)).gte("at", since);
    return !error && count != null ? count : 0;
  } catch {
    return 0;
  }
}

/**
 * Closed to this try? Asked AFTER the try's own row is written (under the account's key, and by
 * the caller under the address's), so both counts hold this try: closed means more than 20 on the
 * account and another try from this address besides this one. With no address (a signed-in person
 * checking their own password): closed past the limit.
 */
async function accountLocked(key: string, address?: string): Promise<boolean> {
  const [onAccount, fromAddress] = await Promise.all([recentTries(key), address ? recentTries(address) : Promise.resolve(2)]);
  return onAccount > ACCOUNT_MAX && fromAddress > 1;
}

/** Writes one try under an account's key. Returns the row's id, to take it back (null when the table did not answer). */
async function recordAccountTry(key: string): Promise<number | null> {
  try {
    const { data, error } = await db().from("login_attempts").insert({ ip: key }).select("id").single();
    const id = Number(data?.id);
    return !error && Number.isSafeInteger(id) ? id : null;
  } catch {
    return null; // best effort
  }
}

/** Takes one try's own row back (the account was closed to it, or the password was right). */
async function takeBackAccountTry(id: number | null): Promise<void> {
  if (id == null) return;
  try {
    await db().from("login_attempts").delete().eq("id", id);
  } catch {
    /* best effort */
  }
}

async function clearAccountFailures(id: string): Promise<void> {
  try {
    await db().from("login_attempts").delete().eq("ip", acctKey(id));
  } catch {
    /* best effort */
  }
}

/**
 * A personal sign-in: the person's id and session version for a right phone number and password,
 * null for anything else (unknown number, wrong password, off the board, no sign-in yet, an
 * account closed to this address by too many wrong tries). A wrong try does the same work in the
 * same order whether the number has a sign-in or not (the row, one row written, the two counts,
 * the password check), so the time it takes never says which numbers exist. `address` is the key
 * the caller already counted this try under (login/actions.ts: "signin:<address>").
 */
export async function verifyPersonLogin(phone: string, password: string, address?: string): Promise<{ id: string; sessionVersion: number } | null> {
  const e164 = normalizePhone(phone);
  if (!e164 || typeof password !== "string" || !password) {
    await burnPasswordCheck(typeof password === "string" ? password : "");
    return null;
  }
  const { data, error } = await db().from("agents").select("id, pass_hash, session_version, active").eq("phone", e164).maybeSingle();
  if (error) fail("people.signin", error);
  const row = data && data.active === true && typeof data.pass_hash === "string" ? { id: String(data.id), hash: data.pass_hash, sessionVersion: Number(data.session_version) } : null;
  // Counted before the password is looked at: tries sent at the same moment each see the others.
  const key = row ? acctKey(row.id) : NO_ACCOUNT;
  const mine = await recordAccountTry(key);
  const locked = await accountLocked(key, address);
  if (!row || locked) {
    await burnPasswordCheck(password);
    // A try that found the account closed is not counted, so the lock ends 15 minutes after the last real guess.
    if (locked) await takeBackAccountTry(mine);
    return null;
  }
  const id = row.id;
  // A wrong password leaves its row.
  if (!(await verifyPassword(password, row.hash))) return null;
  await clearAccountFailures(id);
  // Best effort: when they were last here (the People list shows it).
  await db().from("agents").update({ last_seen_at: new Date().toISOString() }).eq("id", id);
  return { id, sessionVersion: row.sessionVersion };
}

/** Is this the person's own current password? (Change password asks for it first.) False when they have none. */
export async function checkOwnPassword(id: string, password: string): Promise<boolean> {
  if (!isUuid(id)) return false;
  const { data, error } = await db().from("agents").select("pass_hash").eq("id", id).maybeSingle();
  if (error) fail("people.password", error);
  if (typeof data?.pass_hash !== "string") {
    await burnPasswordCheck(password);
    return false;
  }
  // Counted first, like a sign-in: a right password takes its own row back, a wrong one leaves it.
  const mine = await recordAccountTry(acctKey(id));
  if (await accountLocked(acctKey(id))) {
    await takeBackAccountTry(mine);
    return false;
  }
  const ok = await verifyPassword(password, data.pass_hash);
  if (ok) await takeBackAccountTry(mine);
  return ok;
}

/**
 * Sets a person's password (only its hash is stored) and raises their session version, which
 * signs out every device they were on. Returns the new version, for the device that just did it.
 */
export async function setPersonPassword(id: string, password: string): Promise<number> {
  const problem = passwordProblem(password);
  if (problem) throw new Said(problem);
  const person = await personForSession(id);
  if (!person) throw new Said("That person isn't here.");
  const next = person.sessionVersion + 1;
  await patchPerson(id, { pass_hash: await hashPassword(password), session_version: next }, "people.password");
  await clearAccountFailures(id);
  return next;
}

/**
 * A number held by someone who is off the board is given up to the person joining with it (their
 * own number, parked on a row that can no longer sign in); a person on the board keeps theirs.
 */
async function releaseParkedPhone(id: string, phone: string): Promise<void> {
  const { error } = await db().from("agents").update({ phone: null, updated_at: new Date().toISOString() }).eq("id", id).eq("phone", phone).eq("active", false);
  if (error) fail("people.phone", error);
}

export interface JoinInput {
  token: string;
  name: string;
  phone: string;
  password: string;
  uplineId: string | null;
  inOffice: boolean;
  /** The person said "No, I'm someone new" to "Is this you?": a look-alike name no longer stops them. */
  notThem?: boolean;
}
/**
 * `counts` marks a refusal that says something about who is on Scorecard (a dead link, a number or
 * a name that already has a sign-in): the join screen counts those toward the address's throttle.
 * A typo (a short password, a number that is not one) never counts.
 */
export type JoinResult = { ok: true; agentId: string; sessionVersion: number } | { ok: false; error: string; counts?: boolean; maybe?: string };

const nameWords = (n: string) =>
  n
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/['\u2018\u2019.]/g, "")
    .replace(/[^a-z\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
/** Two words that are likely the same name written two ways: one starts the other ("matt", "matthew"), or they share their first three letters. */
const wordAlike = (a: string, b: string) => a.startsWith(b) || b.startsWith(a) || (a.length >= 3 && b.length >= 3 && a.slice(0, 3) === b.slice(0, 3));

/**
 * Is `typed` probably the person already on the board as `board`? (2026-11-17: "Jeremiah" typed
 * made a second row next to "Jeremiah Moe".) One word typed: it is their first or last name. Two
 * or more: the first names are alike and the last names are alike ("Matthew Clayton" and "Matt
 * Clayton", "Troy Tymchuck" and "Troy Tymchuk"). Pure; tested.
 */
export function looksLike(typed: string, board: string): boolean {
  const t = nameWords(typed);
  const b = nameWords(board);
  if (!t.length || !b.length) return false;
  if (t.join(" ") === b.join(" ")) return true;
  if (t.length === 1) return t[0] === b[0] || t[0] === b[b.length - 1] || (b.length === 1 && wordAlike(t[0], b[0]));
  if (b.length === 1) return wordAlike(b[0], t[0]) && t.length === 1;
  return wordAlike(t[0], b[0]) && wordAlike(t[t.length - 1], b[b.length - 1]);
}

/**
 * The number a person's row may be claimed with: the one AgentSpace has on file (claim_phones), or
 * the one already stored on a row that has no sign-in yet (an admin typed it). Members and
 * managers only: an owner's or an admin's row is never claimed through a join link.
 */
function claimNumbers(people: Roster, logins: Set<string>, claimPhones: Map<string, string>): Map<string, string> {
  const out = new Map<string, string>();
  for (const p of people) {
    if (!p.active || logins.has(p.id) || (p.role !== "member" && p.role !== "manager")) continue;
    const n = claimPhones.get(p.id) ?? p.phone ?? null;
    if (n && n !== "invalid") out.set(p.id, n);
  }
  return out;
}

export type PhoneLookup =
  | { kind: "bad_link" }
  | { kind: "bad_phone"; error: string }
  | { kind: "signin" }
  | { kind: "off"; error: string }
  | { kind: "ask_admin"; error: string }
  | { kind: "claim"; name: string; upline: string | null }
  | { kind: "new"; names: string[] };

/**
 * Step one of the agency or team link (owner, 2026-11-17: "if somebody signs up with the phone
 * number that's already on file ... then it simply asks them to create a password"): what the
 * typed cell number says. A number on file for someone on the board with no sign-in is them
 * ("claim", with their name as the board spells it and their upline's name); a number that already
 * has a sign-in is told to sign in; anything else is a new person ("new", with the names on the
 * board that may still be claimed by name alone). Nothing is written.
 */
export async function lookupJoinPhone(token: string, phone: string): Promise<PhoneLookup> {
  const invite = await readInvite(token);
  if (!invite || invite.kind !== "agency") return { kind: "bad_link" };
  const typed = normalizePhone(phone);
  if (!typed) return { kind: "bad_phone", error: PHONE_HELP };
  const [people, logins, claimPhones] = await Promise.all([roster(), loginIds(), loadClaimPhones()]);
  if (invite.upline_id && !people.some((p) => p.id === invite.upline_id && p.active)) return { kind: "bad_link" };
  const holder = people.find((p) => p.phone === typed);
  if (holder && !holder.active) return { kind: "off", error: OFF_BOARD };
  if (holder && logins.has(holder.id)) return { kind: "signin" };
  const numbers = claimNumbers(people, logins, claimPhones);
  const mine = people.find((p) => numbers.get(p.id) === typed);
  if (mine) {
    const up = mine.upline_id ? people.find((p) => p.id === mine.upline_id && p.active) : undefined;
    const leader = invite.upline_id ? people.find((p) => p.id === invite.upline_id) : undefined;
    return { kind: "claim", name: mine.name, upline: up?.name ?? leader?.name ?? null };
  }
  // A number stored on an owner's or an admin's row that has no sign-in yet: that person gets their own link.
  if (holder) return { kind: "ask_admin", error: `${holder.name} is already on the board. Ask Anersi for your own sign-in link.` };
  return { kind: "new", names: await claimableNames(invite.upline_id) };
}

type Roster = { id: string; name: string; active: boolean; role: AgentRole; upline_id: string | null; upline_confirmed: boolean; phone: string | null; session_version: number }[];
async function roster(): Promise<Roster> {
  const { data, error } = await db().from("agents").select("id, name, active, role, upline_id, upline_confirmed, phone, session_version");
  if (error) fail("people.roster", error);
  return (data ?? []).map((r) => ({
    id: String(r.id),
    name: String(r.name),
    active: r.active === true,
    role: isAgentRole(r.role) ? r.role : "member",
    upline_id: r.upline_id ? String(r.upline_id) : null,
    upline_confirmed: r.upline_confirmed !== false,
    phone: typeof r.phone === "string" ? r.phone : null,
    session_version: Number(r.session_version),
  }));
}

/**
 * Joining through a link (contract decision 5), everything checked here on the server:
 *   agency  a new person, or the claim of someone already on the board with the same name who
 *           has no sign-in yet (members and managers only; an owner or admin row needs its own
 *           person link), a row that opens clients only together with its AgentSpace number
 *           (claimPlan). An upline picked on the agency link counts at once; the leader a leader's
 *           link names is confirmed at once (the leader or an admin made that link).
 *   person  that one person sets their number, their password and the office mark
 *   reset   that one person sets a new password
 * One-use links are taken with a guarded update before anything is written, so a link works once.
 */
export async function joinWithInvite(input: JoinInput): Promise<JoinResult> {
  const invite = await readInvite(input.token);
  if (!invite) return { ok: false, error: BAD_LINK, counts: true };
  const problem = passwordProblem(input.password);
  if (problem) return { ok: false, error: problem };
  const people = await roster();
  const logins = await loginIds();
  const typedPhone = typeof input.phone === "string" && input.phone.trim() ? normalizePhone(input.phone) : null;
  const phoneTyped = typeof input.phone === "string" && input.phone.trim().length > 0;

  if (invite.kind === "reset" || invite.kind === "person") {
    const person = people.find((p) => p.id === invite.agent_id);
    if (!person || !person.active) return { ok: false, error: BAD_LINK, counts: true };
    // A reset keeps the number they have; a person link (and a reset for someone with no number) asks for it.
    let phone = person.phone;
    let parked: string | null = null;
    if (invite.kind === "person" || !phone) {
      if (!typedPhone) return { ok: false, error: PHONE_HELP };
      const holder = people.find((p) => p.id !== person.id && p.phone === typedPhone);
      if (holder?.active) return { ok: false, error: PHONE_TAKEN, counts: true };
      parked = holder?.id ?? null;
      phone = typedPhone;
    } else if (phoneTyped && typedPhone && typedPhone !== phone) {
      // Typed a different number on a reset: the link is for one person, so their number stays.
      return { ok: false, error: "That isn't the number this link is for.", counts: true };
    }
    if (!(await consumeInvite(invite))) return { ok: false, error: BAD_LINK, counts: true };
    if (parked && phone) await releaseParkedPhone(parked, phone);
    const next = person.session_version + 1;
    const patch: Record<string, unknown> = { phone, pass_hash: await hashPassword(input.password), session_version: next, updated_at: new Date().toISOString() };
    if (invite.kind === "person") patch.in_office = input.inOffice === true;
    if (!logins.has(person.id)) patch.joined_at = new Date().toISOString();
    const { error } = await db().from("agents").update(patch).eq("id", person.id);
    if (error) {
      if ((error as { code?: string }).code === "23505") return { ok: false, error: PHONE_TAKEN, counts: true };
      fail("people.join", error);
    }
    await clearAccountFailures(person.id);
    return { ok: true, agentId: person.id, sessionVersion: next };
  }

  // The agency link.
  if (!typedPhone) return { ok: false, error: PHONE_HELP };
  const claimPhones = await loadClaimPhones();
  const numbers = claimNumbers(people, logins, claimPhones);
  // The number decides first: a number on file for someone on the board with no sign-in is that
  // person, whatever name was typed (or none), so nobody makes a second row of themself.
  const byNumber = people.find((p) => numbers.get(p.id) === typedPhone);
  const name = byNumber ? byNumber.name : cleanName(input.name);
  if (!name) return { ok: false, error: "Type your first and last name." };
  const holder = people.find((p) => p.phone === typedPhone);
  const matches = byNumber ? [byNumber] : people.filter((p) => sameName(p.name, name));
  // A row with no sign-in yet is the one a name means, even when another row of the same name has one.
  const match = matches.find((p) => p.active && !logins.has(p.id)) ?? matches.find((p) => p.active) ?? matches[0];
  if (!match) {
    // A name like someone already on the board ("Jeremiah" for "Jeremiah Moe") asks first instead
    // of making a second row: "Is this you?" A yes sends the board's spelling; a no sends notThem.
    if (!input.notThem) {
      const like = people.find((p) => p.active && looksLike(name, p.name));
      if (like) return { ok: false, error: `Is this you: ${like.name}?`, maybe: like.name };
    }
    if (nameWords(name).length < 2) return { ok: false, error: "Type your first and last name." };
  }
  // A number held by a row that has no sign-in because it was stored there is that row's own: its claim is not blocked by it.
  if (holder?.active && !(match && holder.id === match.id && !logins.has(holder.id))) return { ok: false, error: PHONE_TAKEN, counts: true };
  // A number AgentSpace has on file for somebody who has not joined yet is theirs: a stranger cannot take it
  // (under a new name, or with another person's name) and so lock that person out.
  const onFileFor = [...claimPhones].find(([id, ph]) => ph === typedPhone && people.some((p) => p.id === id && p.active && !logins.has(p.id)))?.[0];
  if (onFileFor && onFileFor !== match?.id) return { ok: false, error: "That cell number is already on the board under another name. Check it, or ask an admin for your own sign-in link.", counts: true };
  // Someone who was taken off the board does not come back through the link: not as themself
  // (their name), and not as a second row (another spelling of the name, with the number their
  // old row still holds). An admin puts them back.
  if (match ? !match.active : !!holder) return { ok: false, error: OFF_BOARD, counts: true };
  // A leader's team link puts people on that leader's team and nowhere else: what the form posts
  // as an upline is ignored (a claimed row keeps its own upline, a new row gets the leader). The
  // agency link lets a person pick; that pick waits to be confirmed.
  const linkLeader = invite.upline_id ? people.find((p) => p.id === invite.upline_id && p.active) : undefined;
  if (invite.upline_id && !linkLeader) return { ok: false, error: BAD_LINK, counts: true };
  const picked = !invite.upline_id && isUuid(input.uplineId) ? people.find((p) => p.id === input.uplineId && p.active) : undefined;
  const upline = picked ?? linkLeader ?? null;
  // A team link places people confirmed, the leader having made it for their own team or an admin
  // for them (a link an admin made stops being confirmed if that person is no longer an admin).
  const creator = invite.created_by ? people.find((p) => p.id === invite.created_by) : undefined;
  const standsFor = !invite.created_by || invite.created_by === linkLeader?.id || (!!creator && creator.active && (creator.role === "admin" || creator.role === "owner"));
  // An upline picked on the agency link counts at once (owner, 2026-11-17: "just click and select who their upline is, and they can just join like that"); an admin fixes a wrong pick on People.
  const confirmed = !upline || !!picked || (!!linkLeader && standsFor);
  const pass_hash = await hashPassword(input.password);
  const now = new Date().toISOString();

  if (match) {
    if (logins.has(match.id)) return { ok: false, error: `${match.name} is already on Scorecard. Sign in, or ask an admin for your own link.`, counts: true };
    // A row whose sign-in opens clients (a manager's, a leader's, one holding policies) is claimed
    // only with the cell number AgentSpace has on file for it; with none on file an admin sends
    // that person their own link. A row that opens nothing is claimed by its name.
    const plan = await claimPlan([match], logins, { vouchedBy: linkLeader?.id ?? null, everyone: people, phones: new Map([...claimPhones, ...numbers]) });
    if (!plan.has(match.id)) {
      return { ok: false, error: `${match.name} is already on the board. Ask an admin for your own sign-in link.`, counts: true };
    }
    const need = plan.get(match.id);
    if (need && typedPhone !== need) {
      return { ok: false, error: `That cell number isn't the one on file for ${match.name}. Check it, or ask an admin for your own sign-in link.`, counts: true };
    }
    if (holder) await releaseParkedPhone(holder.id, typedPhone);
    // The claim: only while the row still has no sign-in (two phones at once: one wins).
    const next = match.session_version + 1;
    const patch: Record<string, unknown> = { phone: typedPhone, pass_hash, session_version: next, joined_at: now, updated_at: now };
    // The office mark an admin set stays: the switch on this card starts off for everyone (the card
    // cannot know who is typing), so it only ever turns the mark on. /me turns it off.
    if (input.inOffice === true) patch.in_office = true;
    // Their pick replaces the upline an admin set only when they made one, and never into a loop.
    // A leader's link opens with that leader already picked: that is the link's default, not a
    // pick, so it never moves someone an admin already placed (it fills an empty upline, below).
    const chose = picked;
    // Their own pick counts at once; a row that keeps its upline keeps its confirmed state.
    if (chose && chose.id !== match.id && !(await wouldLoop(match.id, chose.id))) {
      patch.upline_id = chose.id;
      patch.upline_confirmed = true;
    } else if (!match.upline_id && upline && upline.id !== match.id && !(await wouldLoop(match.id, upline.id))) {
      patch.upline_id = upline.id;
      patch.upline_confirmed = confirmed;
    }
    const { data, error } = await db().from("agents").update(patch).eq("id", match.id).is("pass_hash", null).in("role", ["member", "manager"]).eq("active", true).select("id");
    if (error) {
      if ((error as { code?: string }).code === "23505") return { ok: false, error: PHONE_TAKEN, counts: true };
      fail("people.claim", error);
    }
    if (!data?.length) return { ok: false, error: `${match.name} is already on Scorecard. Sign in, or ask an admin for your own link.`, counts: true };
    await consumeInvite(invite);
    claimableKept.clear(); // this instance's chips drop the person who just signed up
    return { ok: true, agentId: match.id, sessionVersion: next };
  }

  // A new person (nobody holds their number: a number parked on an off-board row was refused above).
  const { data: last } = await db().from("agents").select("sort").order("sort", { ascending: false }).limit(1).maybeSingle();
  const sort = ((last?.sort as number | undefined) ?? 0) + 1;
  const { data, error } = await db()
    .from("agents")
    .insert({ name, sort, role: "member", phone: typedPhone, pass_hash, in_office: input.inOffice === true, upline_id: upline?.id ?? null, upline_confirmed: confirmed, joined_at: now })
    .select("id, session_version")
    .single();
  if (error) {
    if ((error as { code?: string }).code === "23505") return { ok: false, error: PHONE_TAKEN, counts: true };
    fail("people.join", error);
  }
  await consumeInvite(invite);
  claimableKept.clear();
  return { ok: true, agentId: String(data.id), sessionVersion: Number(data.session_version) };
}
