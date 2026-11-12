import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { attemptRow, form, freshInstance, lag, Redirect, req, request, tables } from "./stand-in";

/**
 * The sign-in and join limits, run through the REAL actions (login, signIn, join) against the
 * stand-in database (tests/stand-in.ts).
 *
 * What it proves (owner's go-live, 2026-11-12):
 *   - the two sign-in forms keep separate counts for one address (an office is one address);
 *   - a try is counted before it is looked at, so a burst cannot get more than the limit checked,
 *     on one server instance and when every request lands on an instance of its own.
 */
type Actions = { login: typeof import("../src/app/login/actions"); join: typeof import("../src/app/join/[token]/actions") };
/** One server instance: its own copy of every module (and of the in-memory counts), the same database. */
function instance(): Actions {
  freshInstance();
  return { login: req("../src/app/login/actions"), join: req("../src/app/join/[token]/actions") };
}
const one = instance();
const passwords = req("../src/lib/passwords") as typeof import("../src/lib/passwords");
const invites = req("../src/lib/invites") as typeof import("../src/lib/invites");

const SIGNED_IN = "signed in";
async function outcome(run: () => Promise<{ error: string | null }>): Promise<string> {
  try {
    return (await run()).error ?? "no error";
  } catch (err) {
    if (err instanceof Redirect) return SIGNED_IN;
    throw err;
  }
}
const shared = (address: string, password: string, on: Actions = one) => request.run({ address }, () => outcome(() => on.login.login({ error: null }, form({ password, next: "/" }))));
const personal = (address: string, phone: string, password: string, on: Actions = one) => request.run({ address }, () => outcome(() => on.login.signIn({ error: null }, form({ phone, password, next: "/" }))));
const count = (list: string[], what: string) => list.filter((o) => o === what).length;
const rowsUnder = (key: string) => tables.login_attempts.filter((r) => r.ip === key).length;

const WRONG_SHARED = "That password isn't right.";
const WRONG_PERSONAL = "That phone number and password don't match.";
const TOO_MANY = "Too many tries. Wait 15 minutes and try again.";
const TOO_MANY_PERSONAL = "Too many tries from this network. Wait a few minutes, or ask an admin for a new sign-in link.";
const TOO_MANY_JOINED = "A lot of people just joined from this Wi-Fi. Wait 15 minutes and try again.";
const PHONE_TAKEN = "That number already has a sign-in. Sign in instead.";

const PAT = "248 555 0100";
const SAM = "248 555 0101";
let patId = "";
let samId = "";
// Hashed once (a tenth of a second or two each): every test starts from the same two people.
let hashes: { pat: string; sam: string } | null = null;
/** Runs a burst with a round trip's delay on every database call, so the tries interleave. */
async function atOnce<T>(run: () => Promise<T>): Promise<T> {
  lag.ms = 3;
  try {
    return await run();
  } finally {
    lag.ms = 0;
  }
}

async function reset(): Promise<void> {
  lag.ms = 0;
  tables.login_attempts = [];
  tables.invites = [];
  tables.settings = [];
  patId = randomUUID();
  samId = randomUUID();
  hashes ??= { pat: await passwords.hashPassword("pat-right-password"), sam: await passwords.hashPassword("sam-right-password") };
  tables.agents = [
    { id: patId, name: "Pat Member", active: true, role: "member", session_version: 1, phone: "+12485550100", pass_hash: hashes.pat, upline_id: null, in_office: true, sort: 1 },
    { id: samId, name: "Sam Member", active: true, role: "member", session_version: 1, phone: "+12485550101", pass_hash: hashes.sam, upline_id: null, in_office: true, sort: 2 },
  ];
}

test("the shared-password form: 10 wrong tries from one address close it, the owner password included", async () => {
  await reset();
  const office = "198.51.100.1";
  const tries: string[] = [];
  for (let i = 0; i < 12; i++) tries.push(await shared(office, `wrong-${i}`));
  assert.equal(count(tries, WRONG_SHARED), 10);
  assert.equal(count(tries, TOO_MANY), 2);
  assert.equal(await shared(office, "owner-right-pass"), TOO_MANY);
  // A refused try is not counted: the wait is 15 minutes from the tenth wrong one.
  assert.equal(rowsUnder(office), 10);
  assert.equal(await shared("198.51.100.2", "owner-right-pass"), SIGNED_IN, "another address still signs in");
});

test("a right team password takes back its own try and nothing else; the owner password clears the address", async () => {
  await reset();
  const office = "198.51.100.3";
  for (let i = 0; i < 9; i++) assert.equal(await shared(office, `wrong-${i}`), WRONG_SHARED);
  for (let i = 0; i < 5; i++) assert.equal(await shared(office, "team-right-pass"), SIGNED_IN);
  assert.equal(rowsUnder(office), 9, "the team password leaves the wrong tries counted");
  assert.equal(await shared(office, "owner-right-pass"), SIGNED_IN);
  assert.equal(rowsUnder(office), 0, "the owner password clears them");
});

test("an office behind one address: wrong personal sign-ins never close the owner's or the TV's form, and the other way round", async () => {
  await reset();
  const office = "198.51.100.4";
  // Twelve typos on the personal form, spread over made-up numbers and a real one.
  for (let i = 0; i < 12; i++) assert.equal(await personal(office, i % 2 ? PAT : `248 555 02${String(i).padStart(2, "0")}`, `typo-${i}`), WRONG_PERSONAL);
  assert.equal(rowsUnder(office), 0, "nothing is counted under the shared form's key");
  assert.equal(rowsUnder(`signin:${office}`), 12);
  assert.equal(await shared(office, "team-right-pass"), SIGNED_IN, "the TV's password still works");
  assert.equal(await shared(office, "owner-right-pass"), SIGNED_IN, "the owner password still works");
  assert.equal(await personal(office, SAM, "sam-right-password"), SIGNED_IN, "a colleague still signs in");
  assert.equal(rowsUnder(`signin:${office}`), 12, "a right sign-in takes back its own try only");

  // The other way round: the shared form closed, the personal form open.
  for (let i = 0; i < 10; i++) assert.equal(await shared(office, `wrong-${i}`), WRONG_SHARED);
  assert.equal(await shared(office, "team-right-pass"), TOO_MANY);
  assert.equal(await personal(office, SAM, "sam-right-password"), SIGNED_IN, "the personal form keeps working");
});

test("the personal form: 60 wrong tries from one address close it with its own sentence; one account closes to a guesser at 20", async () => {
  await reset();
  const office = "198.51.100.5";
  // 57 wrong tries already counted, then three more typed on numbers nobody has: 60.
  for (let i = 0; i < 57; i++) tables.login_attempts.push(attemptRow(`signin:${office}`));
  for (let i = 0; i < 3; i++) assert.equal(await personal(office, `248 555 1${String(i).padStart(3, "0")}`, "typo-typo"), WRONG_PERSONAL);
  assert.equal(await personal(office, PAT, "pat-right-password"), TOO_MANY_PERSONAL);
  assert.equal(rowsUnder(`signin:${office}`), 60, "a refused try is not counted");
  assert.equal(await shared(office, "owner-right-pass"), SIGNED_IN, "the shared form is still open");
  assert.equal(await personal("198.51.100.6", PAT, "pat-right-password"), SIGNED_IN, "another address signs in");

  // One account: 20 wrong passwords, then the right one from the guessing address reads wrong too.
  const guesser = "198.51.100.7";
  for (let i = 0; i < 20; i++) assert.equal(await personal(guesser, SAM, `guess-${i}`), WRONG_PERSONAL);
  assert.equal(await personal(guesser, SAM, "sam-right-password"), WRONG_PERSONAL, "closed to the address that guessed");
  assert.equal(rowsUnder(`acct:${samId}`), 20, "a try on a closed account is not counted");
  assert.equal(await personal("198.51.100.8", SAM, "sam-right-password"), SIGNED_IN, "the person's own phone still gets in");
});

test("tries sent at the same moment: the shared form checks at most 10, on one instance", async (t) => {
  await reset();
  const address = "198.51.100.9";
  const burst = await atOnce(() => Promise.all(Array.from({ length: 60 }, (_, i) => shared(address, i === 37 ? "owner-right-pass" : `guess-${i}`))));
  const looked = count(burst, WRONG_SHARED) + count(burst, SIGNED_IN);
  t.diagnostic(`60 at once, one instance: ${looked} looked at, ${count(burst, TOO_MANY)} refused, the owner password among them: ${burst[37]}`);
  assert.ok(looked <= 10, `${looked} passwords were looked at (limit 10)`);
  assert.equal(count(burst, TOO_MANY), 60 - looked);
  assert.ok(rowsUnder(address) <= 10, "refused tries took their rows back");
});

test("tries sent at the same moment: the shared form checks at most 10 when every request lands on its own instance", async (t) => {
  await reset();
  const address = "198.51.100.10";
  // 60 requests, each on a fresh copy of the modules: no in-memory count helps, only the table.
  const instances = Array.from({ length: 60 }, () => instance());
  const burst = await atOnce(() => Promise.all(instances.map((on, i) => shared(address, i === 37 ? "owner-right-pass" : `guess-${i}`, on))));
  const looked = count(burst, WRONG_SHARED) + count(burst, SIGNED_IN);
  t.diagnostic(`60 at once, 60 instances: ${looked} looked at, ${count(burst, TOO_MANY)} refused, the owner password among them: ${burst[37]}`);
  assert.ok(looked <= 10, `${looked} passwords were looked at (limit 10)`);
  assert.equal(count(burst, TOO_MANY), 60 - looked);
  assert.ok(rowsUnder(address) <= 10);
});

test("tries sent at the same moment: a person's password gets at most 20 guesses checked, the address at most 60", async (t) => {
  await reset();
  const address = "198.51.100.11";
  const instances = Array.from({ length: 8 }, () => instance());
  // 90 guesses at one account at once, spread over 8 instances.
  const burst = await atOnce(() => Promise.all(Array.from({ length: 90 }, (_, i) => personal(address, PAT, `guess-${i}`, instances[i % instances.length]))));
  assert.equal(count(burst, SIGNED_IN), 0);
  const answered = count(burst, WRONG_PERSONAL);
  assert.ok(answered <= 60, `${answered} tries got past the address's limit (60)`);
  assert.equal(count(burst, TOO_MANY_PERSONAL), 90 - answered);
  // A wrong password that was really checked leaves its row under the account: that is the number of guesses.
  const checked = rowsUnder(`acct:${patId}`);
  t.diagnostic(`90 guesses at one account at once, 8 instances: ${answered} got past the address's count, ${checked} passwords checked, ${count(burst, TOO_MANY_PERSONAL)} refused as too many`);
  assert.ok(checked <= 20, `${checked} passwords were checked against the account (limit 20)`);
  assert.ok(rowsUnder(`signin:${address}`) <= 60);

  // Under the address's limit, so only the account's count is in play: 50 guesses at once at one account.
  const second = "198.51.100.12";
  const fifty = await atOnce(() => Promise.all(Array.from({ length: 50 }, (_, i) => personal(second, SAM, `guess-${i}`, instances[i % instances.length]))));
  assert.equal(count(fifty, WRONG_PERSONAL), 50, "every one reads the same neutral line");
  const checkedSam = rowsUnder(`acct:${samId}`);
  t.diagnostic(`50 guesses at one account at once (under the address's limit): ${checkedSam} passwords checked (limit 20)`);
  assert.ok(checkedSam <= 20, `${checkedSam} passwords were checked against the account (limit 20)`);
});

// ---- the join link ----------------------------------------------------------------------------
function agencyLink(): string {
  const token = invites.newToken();
  tables.invites.push({ id: randomUUID(), kind: "agency", agent_id: null, upline_id: null, created_by: null, expires_at: null, revoked_at: null, used_at: null, uses: 0, token_hash: invites.hashToken(token), token });
  return token;
}
const joinWith = (address: string, token: string, name: string, phone: string, password = "a-long-password", on: Actions = one) =>
  request.run({ address }, () => outcome(() => on.join.join(form({ token, name, phone, password, upline_id: "", in_office: "0" }))));
const letters = (i: number) => String.fromCharCode(65 + (i % 26)) + String.fromCharCode(97 + (Math.floor(i / 26) % 26));

test("the join link, one at a time: 30 tries that say who is on Scorecard, then it waits; a typo is not counted", async () => {
  await reset();
  const token = agencyLink();
  const address = "198.51.100.20";
  // Typos (a short password) are free.
  for (let i = 0; i < 35; i++) assert.match(await joinWith(address, token, "New Person", "248 555 7000", "short"), /8 characters|at least/i);
  assert.equal(rowsUnder(`join:${address}`), 0);
  assert.equal(rowsUnder(`joined:${address}`), 0);
  const probes: string[] = [];
  for (let i = 0; i < 32; i++) probes.push(await joinWith(address, token, `Probe ${letters(i)}`, PAT));
  assert.equal(count(probes, PHONE_TAKEN), 30);
  assert.equal(count(probes, TOO_MANY), 2);
  assert.equal(rowsUnder(`joined:${address}`), 0, "a try that made nobody is not counted as a person");
});

test("the join link, at the same moment: at most 30 probes are answered and at most 60 people are made", async (t) => {
  await reset();
  const token = agencyLink();
  const instances = Array.from({ length: 8 }, () => instance());
  const prober = "198.51.100.21";
  const probes = await atOnce(() => Promise.all(Array.from({ length: 90 }, (_, i) => joinWith(prober, token, `Probe ${letters(i)}`, PAT, "a-long-password", instances[i % instances.length]))));
  const told = count(probes, PHONE_TAKEN);
  assert.ok(told <= 30, `${told} probes were answered (limit 30)`);
  assert.equal(count(probes, TOO_MANY), 90 - told);

  // 45 people already joined from this address; 25 more joins at the same moment: room for 15.
  const flooder = "198.51.100.22";
  for (let i = 0; i < 45; i++) tables.login_attempts.push(attemptRow(`joined:${flooder}`));
  const before = tables.agents.length;
  const joins = await atOnce(() => Promise.all(Array.from({ length: 25 }, (_, i) => joinWith(flooder, token, `Made Up ${letters(i)}`, `248 556 ${String(1000 + i)}`, "a-long-password", instances[i % instances.length]))));
  const made = tables.agents.length - before;
  t.diagnostic(`90 probes at once: ${told} answered (limit 30); 25 joins at once with 45 already joined: ${made} people made (room for 15), ${count(joins, TOO_MANY_JOINED)} told to wait`);
  assert.equal(count(joins, SIGNED_IN), made);
  assert.ok(made <= 15, `${made} people were made past the limit of 60`);
  assert.equal(count(joins, TOO_MANY_JOINED), 25 - made);
  assert.equal(rowsUnder(`joined:${flooder}`), 45 + made, "a join that was told to wait is not counted");
});

test("the join link, one at a time: 60 people from one address, then it waits", async () => {
  await reset();
  const token = agencyLink();
  const address = "198.51.100.23";
  // The count is the people made: write 60 rows the way 60 joins leave them, then join twice more.
  const first = await joinWith(address, token, "First Joiner", "248 557 0001");
  assert.equal(first, SIGNED_IN);
  assert.equal(rowsUnder(`joined:${address}`), 1, "a person made stays counted");
  assert.equal(rowsUnder(`join:${address}`), 0, "a join that worked takes back its try");
  for (let i = 0; i < 59; i++) tables.login_attempts.push(attemptRow(`joined:${address}`));
  assert.equal(await joinWith(address, token, "One Too Many", "248 557 0002"), TOO_MANY_JOINED);
  assert.equal(rowsUnder(`joined:${address}`), 60, "a refused try is not counted");
  assert.equal(await joinWith("198.51.100.24", token, "Other Office", "248 557 0003"), SIGNED_IN);
});

test("someone taken off the board does not come back through the agency link, under their name or as a second row", async () => {
  await reset();
  const token = agencyLink();
  const gone = tables.agents.find((a) => a.id === samId)!;
  gone.active = false;
  const before = tables.agents.length;
  const OFF = "Ask an admin to put you back on the board.";
  assert.equal(await joinWith("198.51.100.30", token, "sam  MEMBER", "248 558 0001"), OFF, "the same name");
  assert.equal(await joinWith("198.51.100.30", token, "Samuel Q Member", SAM), OFF, "another name with the number their old row holds");
  assert.equal(tables.agents.length, before, "nobody was made");
  assert.equal(gone.phone, "+12485550101", "the old row keeps its number");
});
