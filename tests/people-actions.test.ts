import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { broken, form, req, request, tables, type Row } from "./stand-in";

/**
 * The people, links and approvals rules of the final review (2026-11-12), run through the REAL
 * server actions against the stand-in database (tests/stand-in.ts): links die with the people who
 * made or owned them, off the board ends old cookies for good, a fixed sale's approval names
 * every change and is checked again when it runs, names stay one per person, every change tells
 * the TV, and the database's own words never reach a screen.
 */
const actions = req("../src/app/(app)/actions") as typeof import("../src/app/(app)/actions");
const people = req("../src/app/(app)/people-actions") as typeof import("../src/app/(app)/people-actions");
const team = req("../src/app/(app)/team/actions") as typeof import("../src/app/(app)/team/actions");
const session = req("../src/lib/session") as typeof import("../src/lib/session");
const auth = req("../src/lib/auth") as typeof import("../src/lib/auth");
const data = req("../src/lib/data") as typeof import("../src/lib/data");
const invites = req("../src/lib/invites") as typeof import("../src/lib/invites");
const month = req("../src/lib/month") as typeof import("../src/lib/month");

const DIDNT_SAVE = "That didn't save. Try again.";
const address = "198.51.100.40";
const person = (name: string, extra: Row = {}): Row => ({ id: randomUUID(), name, active: true, sort: tables.agents.length + 1, pc_licensed: false, upline_id: null, in_office: false, role: "member", joined_at: null, phone: null, pass_hash: null, session_version: 1, ...extra });
const id = (row: Row) => String(row.id);
let owner: Row, admin: Row, ivy: Row, noah: Row, gone: Row;
function reset(): void {
  broken.clear();
  for (const t of Object.keys(tables)) tables[t] = [];
  owner = person("Olive Owner", { role: "owner" });
  admin = person("Adam Admin", { role: "admin", pass_hash: "scrypt$x", phone: "+12485550110" });
  ivy = person("Ivy Chen", { pass_hash: "scrypt$x", phone: "+12485550111" });
  noah = person("Noah O'Brien");
  gone = person("Gail Gone", { active: false });
  tables.agents.push(owner, admin, ivy, noah, gone);
}
/** Runs an action the way a signed-in request does. */
async function as<T>(who: "owner" | Row, run: () => Promise<T>): Promise<T> {
  const cookie = who === "owner" ? await session.createSessionToken("owner", 3600) : await session.createPersonToken(id(who), Number(who.session_version), 3600);
  return request.run({ address, cookie }, run);
}
const cookieOf = (who: Row, version = Number(who.session_version)) => session.createPersonToken(id(who), version, 3600);
const viewerWith = (cookie: string) => request.run({ address, cookie }, () => auth.currentViewer());
const link = (kind: "person" | "reset" | "agency", extra: Row = {}): Row => {
  const row: Row = { id: randomUUID(), kind, agent_id: null, upline_id: null, created_by: null, expires_at: kind === "agency" ? null : invites.oneUseExpiry(), revoked_at: null, used_at: null, uses: 0, token_hash: invites.hashToken(invites.newToken()), token: null, ...extra };
  tables.invites.push(row);
  return row;
};
const stamp = () => tables.settings.find((r) => r.key === "app")?.updated_at;

test("the line a person sees: words thrown on purpose pass, the database's never do", () => {
  const logged: unknown[][] = [];
  const keep = console.error;
  console.error = (...args: unknown[]) => void logged.push(args);
  try {
    assert.equal(data.lineFor(new data.Said("Only an admin can do that")), "Only an admin can do that");
    assert.equal(data.lineFor(new data.DataError("agents.update", { message: 'column "upline_id" of relation "agents" does not exist' })), DIDNT_SAVE);
    assert.equal(data.lineFor(new Error("sales.insert: permission denied for table sales")), DIDNT_SAVE);
    assert.equal(data.lineFor(new TypeError("fetch failed")), DIDNT_SAVE);
    assert.equal(data.lineFor(new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not configured")), DIDNT_SAVE);
    assert.equal(data.lineFor("a string"), DIDNT_SAVE);
    assert.equal(data.lineFor(new Error("anything"), "Their team did not save."), "Their team did not save.");
  } finally {
    console.error = keep;
  }
  // The log carries the class and nothing of the message.
  assert.deepEqual(logged[0], ["action_failed", "DataError"]);
  assert.ok(logged.every((entry) => entry.length === 2 && entry[0] === "action_failed" && !String(entry[1]).includes(" ")));
});

test("an action that hits a database error says the plain line; a level refusal still reads as written", async () => {
  reset();
  const keep = console.error;
  console.error = () => {};
  try {
    broken.add("goals");
    const failed = await as("owner", () => actions.saveTeamGoal("2026-11", form({ goal: "150000" })));
    assert.deepEqual(failed, { ok: false, error: DIDNT_SAVE });
    broken.clear();
    broken.add("agents");
    const upline = await as(admin, () => people.setPersonUpline(id(ivy), id(noah)));
    // (The admin's own row cannot be read either, so nobody is signed in: still no database wording.)
    assert.equal(upline.ok, false);
    assert.ok(!/relation|agents\.|people\./.test(upline.ok ? "" : upline.error));
  } finally {
    console.error = keep;
    broken.clear();
  }
  assert.deepEqual(await as(ivy, () => actions.saveTeamGoal("2026-11", form({ goal: "150000" }))), { ok: false, error: "Only an admin can do that" });
  assert.deepEqual(await as(admin, () => people.savePcEnabled(true)), { ok: false, error: "Only the owner can do that" });
  assert.deepEqual(await as(admin, () => people.setPersonUpline(id(ivy), id(ivy))), { ok: false, error: "A person can't be their own upline." });
});

test("touchBoard moves the TV's stamp and nothing else, makes the row when it is missing, and never throws", async () => {
  reset();
  await data.touchBoard();
  assert.deepEqual(tables.settings.map((r) => [r.key, r.value]), [["app", {}]], "a missing row is made with an empty value");
  assert.equal((await data.getSettings()).agencyName, "Lineage Financial", "an empty value reads as the defaults");
  tables.settings = [{ key: "app", value: { agencyName: "Kept Name", pcEnabled: true }, updated_at: "2026-11-01T00:00:00.000Z" }];
  await data.touchBoard();
  assert.notEqual(stamp(), "2026-11-01T00:00:00.000Z");
  assert.deepEqual(tables.settings[0].value, { agencyName: "Kept Name", pcEnabled: true }, "the settings themselves are untouched");
  broken.add("settings");
  await data.touchBoard(); // no throw
  broken.clear();
});

test("a goal, an upline, an office mark, a rename and a new person each tell the TV", async () => {
  reset();
  const moved = async (what: string, run: () => Promise<{ ok: boolean }>) => {
    tables.settings = [{ key: "app", value: {}, updated_at: "2026-11-01T00:00:00.000Z" }];
    const result = await run();
    assert.equal(result.ok, true, what);
    assert.notEqual(stamp(), "2026-11-01T00:00:00.000Z", `${what} moves the stamp`);
  };
  await moved("a team goal", () => as("owner", () => actions.saveTeamGoal("2026-11", form({ goal: "150000" }))));
  await moved("a person's goal", () => as(admin, () => actions.savePersonGoal("2026-11", id(ivy), form({ goal: "20000" }))));
  await moved("an upline", () => as(admin, () => people.setPersonUpline(id(noah), id(ivy))));
  await moved("an office mark", () => as(admin, () => people.setPersonInOffice(id(noah), true)));
  await moved("a rename", () => as(admin, () => actions.renamePerson(id(noah), form({ name: "Noah Obrien" }))));
  await moved("a new person", () => as(admin, () => team.addPersonToTeam(form({ name: "Nina New", upline_id: "", in_office: "0" }))));
  await moved("a person's own office switch", () => as(ivy, () => people.updateMyProfile(form({ in_office: "1" }))));
});

test("off the board: their own unused links and the links they made are turned off, and their old cookie never works again", async () => {
  reset();
  const forIvy = link("reset", { agent_id: id(ivy), created_by: id(admin) });
  const madeByIvy = link("person", { agent_id: id(noah), created_by: id(ivy) });
  const usedForIvy = link("person", { agent_id: id(ivy), created_by: id(admin), used_at: "2026-11-10T00:00:00.000Z", uses: 1 });
  const forNoah = link("person", { agent_id: id(noah), created_by: id(admin) });
  const agency = link("agency", { created_by: id(ivy), token: invites.newToken() });
  const cookie = await cookieOf(ivy);
  assert.equal((await viewerWith(cookie))?.level, "member");

  assert.deepEqual(await as(admin, () => actions.setPersonActive(id(ivy), false)), { ok: true, message: "Off the board. Their sales stay in the history." });
  assert.equal(ivy.active, false);
  assert.equal(ivy.session_version, 2, "the session version is raised");
  assert.ok(forIvy.revoked_at, "the unused link for them is off");
  assert.ok(madeByIvy.revoked_at, "the unused link they made is off");
  assert.equal(usedForIvy.revoked_at, null, "a used link is left as it was");
  assert.equal(forNoah.revoked_at, null, "someone else's link is untouched");
  assert.equal(agency.revoked_at, null, "the agency link is untouched");
  assert.equal(await viewerWith(cookie), null);

  assert.deepEqual(await as(admin, () => actions.setPersonActive(id(ivy), true)), { ok: true, message: "Back on the board." });
  assert.equal(await viewerWith(cookie), null, "back on the board, the old cookie still signs in nobody");
  assert.equal((await viewerWith(await cookieOf(ivy)))?.level, "member", "a new sign-in works");
});

test("an admin who stops being one loses the links they made: by the owner, and through an approved request", async () => {
  reset();
  const made = link("reset", { agent_id: id(ivy), created_by: id(admin) });
  const madeByOwner = link("person", { agent_id: id(noah), created_by: id(owner) });
  assert.deepEqual(await as("owner", () => people.setPersonRole(id(admin), "member")), { ok: true, message: "Adam Admin is not an admin anymore." });
  assert.equal(admin.role, "member");
  assert.ok(made.revoked_at, "the link the admin made is off");
  assert.equal(madeByOwner.revoked_at, null);

  // The other way: another admin asks, the owner approves.
  reset();
  const second = { ...admin, id: randomUUID(), name: "Beth Admin", phone: "+12485550112" };
  tables.agents.push(second);
  const made2 = link("person", { agent_id: id(noah), created_by: id(admin) });
  assert.deepEqual(await as(second, () => people.setPersonRole(id(admin), "member")), { ok: true, message: "Sent to Anersi for a quick OK." });
  assert.equal(admin.role, "admin", "nothing changes until the owner says yes");
  assert.equal(made2.revoked_at, null);
  const waiting = tables.approvals[0];
  assert.equal(waiting.summary, "Make Adam Admin a member again (not an admin)");
  waiting.id = randomUUID();
  waiting.status = "pending";
  assert.deepEqual(await as("owner", () => people.decideApproval(String(waiting.id), true)), { ok: true, message: "Adam Admin is not an admin anymore." });
  assert.equal(admin.role, "member");
  assert.ok(made2.revoked_at, "the link the admin made is off");
});

const lastMonthDay = () => `${month.addMonths(month.todayInDetroit().slice(0, 7), -1)}-15`;
const pastSale = (extra: Row = {}): Row => {
  const sale: Row = { id: randomUUID(), agent_id: id(ivy), premium_cents: 77700, policies: 1, product: "Term", carrier: "AHL", kind: "life", client: null, note: null, sold_on: lastMonthDay(), logged_by: "team", logged_by_agent: null, created_at: "2026-10-15T15:00:00.000Z", deleted_at: null, agents: { name: "Ivy Chen" }, ...extra };
  tables.sales.push(sale);
  return sale;
};
const fix = (sale: Row, fields: Record<string, string>) =>
  as(admin, () => actions.editSale(id(sale), form({ premium: "777", policies: "1", product: "Term", carrier: "AHL", kind: "life", note: "", sold_on: String(sale.sold_on), agent_id: id(ivy), ...fields })));

test("an admin's fix to a past month: the owner's sentence shows cents, a changed kind and everything else that changes", async () => {
  reset();
  tables.settings = [{ key: "app", value: { pcEnabled: true }, updated_at: "2026-11-01T00:00:00.000Z" }];
  const sale = pastSale();
  const day = month.dayLabel(String(sale.sold_on));

  assert.deepEqual(await fix(sale, { premium: "777.49" }), { ok: true, message: "Sent to Anersi for a quick OK." });
  assert.equal(tables.approvals.at(-1)?.summary, `Fix Ivy Chen's $777 sale of ${day} to $777.49, ${day}`);
  assert.equal(sale.premium_cents, 77700, "nothing changes yet");

  await fix(sale, { premium: "778" });
  assert.equal(tables.approvals.at(-1)?.summary, `Fix Ivy Chen's $777 sale of ${day} to $778, ${day}`);

  await fix(sale, { kind: "pc", policies: "9", carrier: "Royal", product: "IUL", note: "called back" });
  assert.equal(tables.approvals.at(-1)?.summary, `Fix Ivy Chen's $777 sale of ${day} to $777, ${day} (now a P&C sale, 9 policies, carrier Royal, product IUL, a new note)`);

  // A line too long for the row (200 characters) is written shorter, and still names every change.
  ivy.name = "Ivy Chen-Montgomery-Featherstonehaugh of the Long Names Office";
  noah.name = "Noah O'Brien-Fitzgerald-Vandersloot of the Other Long Names";
  const long = pastSale({ agents: { name: ivy.name } });
  await fix(long, { agent_id: id(noah), kind: "pc", policies: "9", carrier: "A Carrier With A Very Long Name Indeed", product: "A Product With A Long Name Too", note: "x" });
  const summary = String(tables.approvals.at(-1)?.summary);
  assert.equal(summary, `Fix Ivy Chen-Montgomery-Feather…'s $777 sale of ${day} to Noah O'Brien-Fitzgerald-Van…, $777, ${day} (now a P&C sale, 9 policies, a new carrier, a new product, a new note)`);
  assert.ok(summary.length <= 200);
});

test("an approved fix is checked again when it runs: a P&C kind while P&C is off changes nothing and says so", async () => {
  reset();
  tables.settings = [{ key: "app", value: { pcEnabled: true }, updated_at: "2026-11-01T00:00:00.000Z" }];
  const sale = pastSale();
  await fix(sale, { kind: "pc" });
  const waiting = tables.approvals[0];
  waiting.id = randomUUID();
  waiting.status = "pending";
  // The owner turns P&C off while the request waits.
  tables.settings[0].value = { pcEnabled: false };
  assert.deepEqual(await as("owner", () => people.decideApproval(String(waiting.id), true)), { ok: true, message: "Approved, but that kind of sale is turned off, so nothing changed." });
  assert.equal(sale.kind, "life");

  // With P&C still on, the same request runs.
  await fix(sale, { kind: "pc" });
  const again = tables.approvals.at(-1)!;
  again.id = randomUUID();
  again.status = "pending";
  tables.settings[0].value = { pcEnabled: true };
  assert.deepEqual(await as("owner", () => people.decideApproval(String(again.id), true)), { ok: true, message: "Approved. The sale is fixed." });
  assert.equal(sale.kind, "pc");
});

test("one name per person on the board: rename and add both use the same test as joining", async () => {
  reset();
  assert.deepEqual(await as(admin, () => actions.renamePerson(id(noah), form({ name: "  ivy   CHEN " }))), { ok: false, error: "Someone else on the board is Ivy Chen. Add a middle initial." });
  assert.equal(noah.name, "Noah O'Brien");
  // The curly apostrophe an iPhone types is the same name.
  assert.equal((await as(admin, () => actions.renamePerson(id(ivy), form({ name: "Noah O’Brien" })))).ok, false);
  // Their own name in another case, and the name of someone who is off the board, are fine.
  assert.deepEqual(await as(admin, () => actions.renamePerson(id(noah), form({ name: "Noah O'BRIEN" }))), { ok: true, message: "Saved." });
  assert.deepEqual(await as(admin, () => actions.renamePerson(id(noah), form({ name: "Gail Gone" }))), { ok: true, message: "Saved." });

  assert.deepEqual(await as(admin, () => actions.addPerson(form({ name: "ivy  chen" }))), { ok: false, error: "Ivy Chen is already on the team." });
  assert.deepEqual(await as(admin, () => team.addPersonToTeam(form({ name: "IVY CHEN", upline_id: "", in_office: "0" }))), { ok: false, error: "Ivy Chen is already on the board." });
});
