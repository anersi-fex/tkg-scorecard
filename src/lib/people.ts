import "server-only";
import { db } from "./supabase";
import { burnPasswordCheck, hashPassword, passwordProblem, verifyPassword } from "./passwords";
import { normalizePhone } from "./phone";
import { consumeInvite, readInvite } from "./invites";
import { isAgentRole, type Agent, type AgentRole } from "./types";

/**
 * People and their own sign-ins (owner, 2026-11-12: "I would like everyone to be able to join").
 * The ONLY file that reads agents.phone or agents.pass_hash. A phone number goes on to a manager's
 * screen (owner or admin) and nowhere else; a password hash never leaves this file; neither is
 * ever logged. Callers check the session and the level first.
 */
export type Person = Agent & { phone: string | null; has_login: boolean };

const PERSON_COLUMNS = "id, name, active, sort, pc_licensed, upline_id, in_office, role, joined_at, phone";
type PersonRow = Omit<Person, "has_login">;

export const BAD_LINK = "This link isn't good anymore. Ask for a new one.";
export const PHONE_TAKEN = "That number already has a sign-in. Sign in instead.";
const PHONE_HELP = "Type your cell number with the area code, like 248 555 0100.";

function fail(where: string, error: { message: string } | null): never {
  // The table and the operation only: never a row, a number or a name.
  throw new Error(`${where}: ${error?.message ?? "unknown error"}`);
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

/** Whose team a person is on (null: the top of the tree). Refuses a loop. */
export async function setUpline(id: string, uplineId: string | null): Promise<void> {
  if (!isUuid(id) || (uplineId !== null && !isUuid(uplineId))) throw new Error("That person isn't here.");
  const person = await personForSession(id);
  if (!person) throw new Error("That person isn't here.");
  if (uplineId) {
    const upline = await personForSession(uplineId);
    if (!upline || !upline.active) throw new Error("That upline isn't on the board.");
    if (await wouldLoop(id, uplineId)) throw new Error(id === uplineId ? "A person can't be their own upline." : `${upline.name} is on ${person.name}'s team, so ${person.name} can't go under them.`);
  }
  await patchPerson(id, { upline_id: uplineId }, "people.upline");
}

export async function setInOffice(id: string, on: boolean): Promise<void> {
  if (!isUuid(id)) throw new Error("That person isn't here.");
  await patchPerson(id, { in_office: on === true }, "people.office");
}

/** Admin or member. The owner's row never changes here (the database holds exactly one owner). */
export async function setRole(id: string, role: AgentRole): Promise<void> {
  if (!isUuid(id) || (role !== "admin" && role !== "member")) throw new Error("That isn't one of the levels.");
  const { data, error } = await db().from("agents").update({ role, updated_at: new Date().toISOString() }).eq("id", id).neq("role", "owner").select("id");
  if (error) fail("people.role", error);
  if (!data?.length) throw new Error("That person's level can't be changed.");
}

/** Signs a person out everywhere: every session made before now stops working. Returns the new version. */
export async function bumpSession(id: string): Promise<number> {
  const person = await personForSession(id);
  if (!person) throw new Error("That person isn't here.");
  const next = person.sessionVersion + 1;
  await patchPerson(id, { session_version: next }, "people.session");
  return next;
}

export async function setName(id: string, name: string): Promise<void> {
  await patchPerson(id, { name }, "people.name");
}

/** A person's cell number (the name they sign in with). Refuses a number someone else has. */
export async function setPhone(id: string, phone: string | null): Promise<void> {
  if (!isUuid(id)) throw new Error("That person isn't here.");
  if (phone !== null) {
    const { data, error } = await db().from("agents").select("id").eq("phone", phone).neq("id", id).limit(1);
    if (error) fail("people.phone", error);
    if (data?.length) throw new Error("Someone else signs in with that number.");
  }
  const { error } = await db().from("agents").update({ phone, updated_at: new Date().toISOString() }).eq("id", id);
  if (error) {
    if ((error as { code?: string }).code === "23505") throw new Error("Someone else signs in with that number.");
    fail("people.phone", error);
  }
}

// Wrong passwords for one account, counted in login_attempts under "acct:<id>" (the same table and
// 15-minute window as the per-address count in auth.ts). Past 20, the account is closed to every
// address that has a wrong try of its own in the window, and to nobody else: whoever is guessing
// is stopped, and the person's own phone still gets in with the right password, so nobody can
// keep someone else from signing in. (These rows stay out of the flood cap in auth.ts.)
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

/** Closed to this address? With no address (a signed-in person checking their own password): closed past the limit. */
async function accountLocked(key: string, address?: string): Promise<boolean> {
  const [onAccount, fromAddress] = await Promise.all([recentTries(key), address ? recentTries(address) : Promise.resolve(1)]);
  return onAccount >= ACCOUNT_MAX && fromAddress > 0;
}

async function recordAccountFailure(key: string): Promise<void> {
  try {
    await db().from("login_attempts").insert({ ip: key });
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
 * same order whether the number has a sign-in or not (the row, the two counts, the password
 * check, one row written), so the time it takes never says which numbers exist. `address` is
 * where the request came from (the caller keeps the per-address throttle with it).
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
  const locked = await accountLocked(row ? acctKey(row.id) : NO_ACCOUNT, address);
  if (!row || locked) {
    await burnPasswordCheck(password);
    await recordAccountFailure(NO_ACCOUNT);
    return null;
  }
  const id = row.id;
  if (!(await verifyPassword(password, row.hash))) {
    await recordAccountFailure(acctKey(id));
    return null;
  }
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
  if (await accountLocked(acctKey(id))) return false;
  const ok = await verifyPassword(password, data.pass_hash);
  if (!ok) await recordAccountFailure(acctKey(id));
  return ok;
}

/**
 * Sets a person's password (only its hash is stored) and raises their session version, which
 * signs out every device they were on. Returns the new version, for the device that just did it.
 */
export async function setPersonPassword(id: string, password: string): Promise<number> {
  const problem = passwordProblem(password);
  if (problem) throw new Error(problem);
  const person = await personForSession(id);
  if (!person) throw new Error("That person isn't here.");
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
}
/**
 * `counts` marks a refusal that says something about who is on Scorecard (a dead link, a number or
 * a name that already has a sign-in): the join screen counts those toward the address's throttle.
 * A typo (a short password, a number that is not one) never counts.
 */
export type JoinResult = { ok: true; agentId: string; sessionVersion: number } | { ok: false; error: string; counts?: boolean };

type Roster = { id: string; name: string; active: boolean; role: AgentRole; upline_id: string | null; phone: string | null; session_version: number }[];
async function roster(): Promise<Roster> {
  const { data, error } = await db().from("agents").select("id, name, active, role, upline_id, phone, session_version");
  if (error) fail("people.roster", error);
  return (data ?? []).map((r) => ({ id: String(r.id), name: String(r.name), active: r.active === true, role: isAgentRole(r.role) ? r.role : "member", upline_id: r.upline_id ? String(r.upline_id) : null, phone: typeof r.phone === "string" ? r.phone : null, session_version: Number(r.session_version) }));
}

/**
 * Joining through a link (contract decision 5), everything checked here on the server:
 *   agency  a new person, or the claim of someone already on the board with the same name who
 *           has no sign-in yet (members only; an owner or admin row needs its own person link)
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
  const name = cleanName(input.name);
  if (!name) return { ok: false, error: "Type your first and last name." };
  if (!typedPhone) return { ok: false, error: PHONE_HELP };
  const holder = people.find((p) => p.phone === typedPhone);
  if (holder?.active) return { ok: false, error: PHONE_TAKEN, counts: true };
  // The upline they picked, when it is a real person on the board; else the leader this link belongs to.
  const picked = isUuid(input.uplineId) ? people.find((p) => p.id === input.uplineId && p.active) : undefined;
  const linkLeader = invite.upline_id ? people.find((p) => p.id === invite.upline_id && p.active) : undefined;
  const upline = picked ?? linkLeader ?? null;
  const pass_hash = await hashPassword(input.password);
  const now = new Date().toISOString();

  const matches = people.filter((p) => sameName(p.name, name));
  const match = matches.find((p) => p.active) ?? matches[0];
  if (match) {
    if (!match.active) return { ok: false, error: `${match.name} was taken off the board. Ask an admin to bring you back, then open this link again.`, counts: true };
    if (logins.has(match.id) || match.role !== "member") return { ok: false, error: `${match.name} is already on Scorecard. Sign in, or ask an admin for your own link.`, counts: true };
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
    const chose = picked && picked.id !== invite.upline_id ? picked : undefined;
    if (chose && chose.id !== match.id && !(await wouldLoop(match.id, chose.id))) patch.upline_id = chose.id;
    else if (!match.upline_id && upline && upline.id !== match.id && !(await wouldLoop(match.id, upline.id))) patch.upline_id = upline.id;
    const { data, error } = await db().from("agents").update(patch).eq("id", match.id).is("pass_hash", null).eq("role", "member").eq("active", true).select("id");
    if (error) {
      if ((error as { code?: string }).code === "23505") return { ok: false, error: PHONE_TAKEN, counts: true };
      fail("people.claim", error);
    }
    if (!data?.length) return { ok: false, error: `${match.name} is already on Scorecard. Sign in, or ask an admin for your own link.`, counts: true };
    await consumeInvite(invite);
    return { ok: true, agentId: match.id, sessionVersion: next };
  }

  if (holder) await releaseParkedPhone(holder.id, typedPhone);
  const { data: last } = await db().from("agents").select("sort").order("sort", { ascending: false }).limit(1).maybeSingle();
  const sort = ((last?.sort as number | undefined) ?? 0) + 1;
  const { data, error } = await db()
    .from("agents")
    .insert({ name, sort, role: "member", phone: typedPhone, pass_hash, in_office: input.inOffice === true, upline_id: upline?.id ?? null, joined_at: now })
    .select("id, session_version")
    .single();
  if (error) {
    if ((error as { code?: string }).code === "23505") return { ok: false, error: PHONE_TAKEN, counts: true };
    fail("people.join", error);
  }
  await consumeInvite(invite);
  return { ok: true, agentId: String(data.id), sessionVersion: Number(data.session_version) };
}
