import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { form, req, request, tables, type Row } from "./stand-in";

/**
 * The CRM's server side (src/lib/policies.ts, src/app/(app)/sale-actions.ts, the people actions'
 * joiners) against the stand-in database (tests/stand-in.ts): the rules hold on the server
 * whatever a request names, the team password never reads or writes a policy, history lines never
 * carry a client's value, and a past month's board change waits for the owner. Invented names only.
 */
const sales = req("../src/app/(app)/sale-actions") as typeof import("../src/app/(app)/sale-actions");
const people = req("../src/app/(app)/people-actions") as typeof import("../src/app/(app)/people-actions");
const policies = req("../src/lib/policies") as typeof import("../src/lib/policies");
const session = req("../src/lib/session") as typeof import("../src/lib/session");
const auth = req("../src/lib/auth") as typeof import("../src/lib/auth");
const month = req("../src/lib/month") as typeof import("../src/lib/month");
const types = req("../src/lib/policy-types") as typeof import("../src/lib/policy-types");

const address = "198.51.100.41";
const person = (name: string, extra: Row = {}): Row => ({ id: randomUUID(), name, active: true, sort: tables.agents.length + 1, pc_licensed: false, upline_id: null, upline_confirmed: true, in_office: false, role: "member", joined_at: null, phone: null, pass_hash: "scrypt$x", session_version: 1, ...extra });
const id = (row: Row) => String(row.id);
let admin: Row, mia: Row, ann: Row, ben: Row, zed: Row, jo: Row;
function reset(): void {
  for (const t of Object.keys(tables)) tables[t] = [];
  tables.agents.push(person("Olive Owner", { role: "owner" }));
  admin = person("Adam Admin", { role: "admin" });
  mia = person("Mia Lead", { role: "manager", upline_id: id(admin) });
  ann = person("Ann Agent", { upline_id: id(mia) });
  ben = person("Ben Agent", { upline_id: id(mia) });
  zed = person("Zed Agent");
  jo = person("Jo Joiner", { upline_id: id(mia), upline_confirmed: false });
  tables.agents.push(admin, mia, ann, ben, zed, jo);
  tables.settings = [{ key: "app", value: { carrierProducts: { AmAm: ["WL/FEX", "TERM"], Americo: ["WL/FEX", "TERM", "IUL"] } }, updated_at: "2026-11-01T00:00:00.000Z" }];
}
async function as<T>(who: "owner" | "team" | Row, run: () => Promise<T>): Promise<T> {
  const cookie = who === "owner" || who === "team" ? await session.createSessionToken(who, 3600) : await session.createPersonToken(id(who), Number(who.session_version), 3600);
  return request.run({ address, cookie }, run);
}
const viewer = (who: "owner" | "team" | Row) => as(who, async () => (await auth.currentViewer())!);
const today = () => month.todayInDetroit();
const CLIENT = { firstName: "Zelda", lastName: "Quarry", email: "zelda@example.com", phone: "(586) 555-0199", address: "12 Elm St, Troy, MI 48083", dob: "1958-03-14" };
const sale = (extra: Record<string, string> = {}) =>
  form({
    agentId: "",
    carrier: "AmAm",
    product: "TERM",
    effectiveDate: `${today().slice(0, 7)}-28`,
    monthly: "100",
    rateClass: "Standard",
    coverage: "50000",
    soldOn: "",
    ss: "no",
    billingCycle: "Monthly",
    billingDay: "1st",
    policyNumber: "",
    applicationNumber: "88001234567",
    leadSource: "Referral",
    notes: "",
    ...CLIENT,
    ...extra,
  });
const saleRow = (sid: string) => tables.sales.find((s) => s.id === sid)!;
const lines = (sid: string) => tables.sale_events.filter((e) => e.sale_id === sid).map((e) => String(e.what));
/** No history line, approval or log ever holds a client's value. */
function assertNoClientValue(): void {
  const text = JSON.stringify([tables.sale_events.map((e) => e.what), tables.approvals.map((a) => [a.summary, a.payload])]);
  for (const v of [CLIENT.firstName, CLIENT.lastName, CLIENT.email, "555-0199", "Elm St", "88001234567", "AA7777777", "1958"]) assert.ok(!text.includes(v), `no "${v}" in history or approvals`);
}

test("the team password never logs, reads or changes a policy", async () => {
  reset();
  assert.deepEqual(await as("team", () => sales.logPolicy(sale({ agentId: id(ann) }))), { ok: false, error: "This needs your own sign-in." });
  assert.deepEqual(await as("team", () => sales.logSale(form({ agent_id: id(ann), premium: "1200", carrier: "AmAm" }))), { ok: false, error: "This needs your own sign-in." });
  const logged = await as(ann, () => sales.logPolicy(sale()));
  assert.ok(logged.ok && "id" in logged && logged.id);
  const sid = (logged as { id: string }).id;
  const team = await viewer("team");
  assert.deepEqual(await policies.listPoliciesFor(team, "all"), []);
  assert.equal(await policies.getPolicyFor(team, sid), null);
  assert.equal((await as("team", () => sales.setPolicyStatusAction(sid, "Issued"))).ok, false);
  assert.equal((await as("team", () => sales.removePolicyAction(sid))).ok, false);
  assert.equal((await as("team", () => sales.removeSale(sid))).ok, false);
  assert.equal(saleRow(sid).deleted_at, null);
});

test("an agent logs for themself whatever the form names; the board counts monthly x 12; the history says so", async () => {
  reset();
  const r = await as(ann, () => sales.logPolicy(sale({ agentId: id(zed), underwriting: "on" })));
  assert.equal(r.ok, true);
  const row = saleRow((r as { id: string }).id);
  assert.equal(row.agent_id, id(ann), "for themself");
  assert.equal(row.logged_by_agent, id(ann));
  assert.equal(row.monthly_cents, 10_000);
  assert.equal(row.premium_cents, 120_000);
  assert.equal(row.policies, 1);
  assert.equal(row.status, "Underwriting");
  assert.equal(row.source, "scorecard");
  assert.equal(row.client_first, "Zelda");
  assert.deepEqual(lines(String(row.id)), ["Logged the sale"]);
  // A form that does not pass says so, field by field, and writes nothing.
  const bad = await as(ann, () => sales.logPolicy(sale({ monthly: "0", phone: "123" })));
  assert.deepEqual(bad, { ok: false, error: "Fill in the 2 fields marked below.", errors: { monthly: "Enter more than $0", phone: "Enter a 10-digit number" } });
  assert.equal(tables.sales.length, 1);
  assertNoClientValue();
});

test("a manager logs for their confirmed team, never for a joiner who waits or another team", async () => {
  reset();
  const r = await as(mia, () => sales.logPolicy(sale({ agentId: id(ann) })));
  assert.equal(r.ok, true);
  const sid = (r as { id: string }).id;
  assert.equal(saleRow(sid).agent_id, id(ann));
  assert.deepEqual(lines(sid), ["Logged the sale for Ann Agent"]);
  assert.deepEqual(await as(mia, () => sales.logPolicy(sale({ agentId: id(jo) }))), { ok: false, error: "You can only log a sale for someone you're allowed to." });
  assert.deepEqual(await as(mia, () => sales.logPolicy(sale({ agentId: id(zed) }))), { ok: false, error: "You can only log a sale for someone you're allowed to." });
  assert.equal((await as(admin, () => sales.logPolicy(sale({ agentId: id(zed) })))).ok, true, "an admin logs for anyone");
});

test("who sees which policy: the list and the record follow the confirmed tree", async () => {
  reset();
  const ids: Record<string, string> = {};
  for (const who of [ann, ben, zed, jo, mia]) ids[String(who.name)] = ((await as(who, () => sales.logPolicy(sale()))) as { id: string }).id;
  const list = async (who: Row | "owner", scope: "mine" | "team" | "all") => (await policies.listPoliciesFor(await viewer(who), scope)).map((p) => p.agentName).sort();
  assert.deepEqual(await list(ann, "mine"), ["Ann Agent"]);
  assert.deepEqual(await list(ann, "all"), ["Ann Agent"], "an agent's other scopes fall back to their own");
  assert.deepEqual(await list(mia, "team"), ["Ann Agent", "Ben Agent", "Mia Lead"], "not the waiting joiner");
  assert.deepEqual(await list("owner", "all"), ["Ann Agent", "Ben Agent", "Jo Joiner", "Mia Lead", "Zed Agent"]);
  assert.equal(await policies.getPolicyFor(await viewer(zed), ids["Ann Agent"]), null);
  assert.equal(await policies.getPolicyFor(await viewer(mia), ids["Jo Joiner"]), null);
  assert.equal((await policies.getPolicyFor(await viewer(mia), ids["Ann Agent"]))?.client.firstName, "Zelda");
  // Confirmed: Mia sees Jo's from then on.
  assert.deepEqual(await as(mia, () => people.confirmUpline(id(jo))), { ok: true, message: "Jo Joiner is on Mia's team." });
  assert.equal(jo.upline_confirmed, true);
  assert.ok(await policies.getPolicyFor(await viewer(mia), ids["Jo Joiner"]));
});

test("the 15-minute locks on the server: a locked field the form sends unchanged is ignored, changed it is refused", async () => {
  reset();
  const sid = ((await as(ann, () => sales.logPolicy(sale()))) as { id: string }).id;
  assert.deepEqual(await as(ann, () => sales.updatePolicyAction(sid, form({ monthly: "110.00" }))), { ok: true, message: "Saved." });
  assert.equal(saleRow(sid).premium_cents, 132_000);
  assert.equal(lines(sid).at(-1), "Changed premium $100.00/mo → $110.00/mo");
  // 16 minutes later.
  saleRow(sid).created_at = new Date(Date.now() - 16 * 60_000).toISOString();
  assert.deepEqual(await as(ann, () => sales.updatePolicyAction(sid, form({ monthly: "120" }))), { ok: false, error: types.LOCK.board });
  assert.deepEqual(await as(ann, () => sales.updatePolicyAction(sid, form({ monthly: "110", carrier: "AmAm", rateClass: "Preferred" }))), { ok: true, message: "Saved." }, "unchanged board fields ride along");
  assert.equal(saleRow(sid).rate_class, "Preferred");
  assert.deepEqual(await as(ann, () => sales.updatePolicyAction(sid, form({ phone: "(248) 555-0100", policyNumber: "AA7777777" }))), { ok: true, message: "Saved." });
  assert.deepEqual(lines(sid).slice(-3), ["Changed rate class Standard → Preferred", "Added the policy number", "Updated client details"]);
  assert.deepEqual(await as(ann, () => sales.updatePolicyAction(sid, form({ agentId: id(ben) }))), { ok: false, error: types.LOCK.seller });
  assert.equal((await as(ann, () => sales.removePolicyAction(sid))).ok, false, "no Take it back after 15 minutes");
  // The manager above: status, underwriting and notes only.
  assert.deepEqual(await as(mia, () => sales.updatePolicyAction(sid, form({ firstName: "Someone" }))), { ok: false, error: "Only Ann or an admin can change this." });
  assert.deepEqual(await as(mia, () => sales.updatePolicyAction(sid, form({ notes: "Call back Friday" }))), { ok: true, message: "Saved." });
  assert.deepEqual(await as(mia, () => sales.setPolicyStatusAction(sid, "Issued")), { ok: true, message: "Status: Issued." });
  assert.deepEqual(lines(sid).slice(-2), ["Notes added", "Status: Submitted → Issued"]);
  assert.equal((await as(zed, () => sales.setPolicyStatusAction(sid, "Declined"))).ok, false, "another team's agent");
  assertNoClientValue();
});

test("take it back in the first 15 minutes; an admin's past-month change waits for the owner (board fields only)", async () => {
  reset();
  const fresh = ((await as(ann, () => sales.logPolicy(sale()))) as { id: string }).id;
  assert.deepEqual(await as(ann, () => sales.removePolicyAction(fresh)), { ok: true, message: "Taken back. It's off the board." });
  assert.ok(saleRow(fresh).deleted_at);
  assert.deepEqual(lines(fresh).at(-1), "Took it back");

  const lastMonth = `${month.addMonths(today().slice(0, 7), -1)}-15`;
  const sid = ((await as(ann, () => sales.logPolicy(sale({ soldOn: today() })))) as { id: string }).id;
  const row = saleRow(sid);
  row.sold_on = lastMonth;
  row.created_at = new Date(Date.now() - 30 * 24 * 3600_000).toISOString();
  const r = await as(admin, () => sales.updatePolicyAction(sid, form({ monthly: "99", rateClass: "Graded", firstName: "Zora" })));
  assert.deepEqual(r, { ok: true, message: "Saved. The board numbers went to Anersi for a quick OK." });
  assert.equal(row.monthly_cents, 10_000, "the premium waits");
  assert.equal(row.rate_class, "Graded", "a tracking field saves at once");
  assert.equal(row.client_first, "Zora");
  const waiting = tables.approvals.at(-1)!;
  assert.equal(waiting.kind, "edit_past_sale");
  assert.deepEqual(waiting.payload, { sale_id: sid, patch: { monthly_cents: 9900, premium_cents: 118_800 } });
  assert.equal(waiting.summary, `Fix Ann Agent's $100.00/mo sale of ${month.dayLabel(lastMonth)} to $99.00/mo, ${month.dayLabel(lastMonth)}`);
  waiting.id = randomUUID();
  waiting.status = "pending";
  assert.deepEqual(await as("owner", () => people.decideApproval(String(waiting.id), true)), { ok: true, message: "Approved. The sale is fixed." });
  assert.equal(row.monthly_cents, 9900);
  assert.equal(row.premium_cents, 118_800);
  assert.equal(lines(sid).at(-1), "Changed premium $100.00/mo → $99.00/mo (approved)");
  // Removing it: the admin asks, the owner does it at once.
  assert.deepEqual(await as(admin, () => sales.removePolicyAction(sid)), { ok: true, message: "Sent to Anersi for a quick OK." });
  assert.equal(row.deleted_at, null);
  assert.deepEqual(await as("owner", () => sales.removePolicyAction(sid)), { ok: true, message: "Removed." });
  assert.ok(row.deleted_at);
  assertNoClientValue();
});

test("only an admin dates a sale into a past month: not when logging, not in the first 15 minutes", async () => {
  reset();
  const lastMonth = `${month.addMonths(today().slice(0, 7), -1)}-15`;
  const PAST = "A sale in a past month needs an admin.";
  const before = tables.sales.length;
  assert.deepEqual(await as(ann, () => sales.logPolicy(sale({ soldOn: lastMonth }))), { ok: false, error: "Fill in the field marked below.", errors: { soldOn: PAST } });
  assert.deepEqual(await as(mia, () => sales.logPolicy(sale({ agentId: id(ann), soldOn: lastMonth }))), { ok: false, error: "Fill in the field marked below.", errors: { soldOn: PAST } });
  assert.equal(tables.sales.length, before, "nothing written");
  // Inside the first 15 minutes the seller fixes the day, but never into a past month.
  const sid = ((await as(ann, () => sales.logPolicy(sale()))) as { id: string }).id;
  assert.deepEqual(await as(ann, () => sales.updatePolicyAction(sid, form({ soldOn: lastMonth }))), { ok: false, error: "Fill in the field marked below.", errors: { soldOn: PAST } });
  assert.equal(saleRow(sid).sold_on, today());
  // A sale that is already in a past month (logged just before the month turned): its board fields are locked.
  saleRow(sid).sold_on = lastMonth;
  assert.deepEqual(await as(ann, () => sales.updatePolicyAction(sid, form({ monthly: "120" }))), { ok: false, error: types.LOCK.pastMonth });
  assert.deepEqual(await as(ann, () => sales.updatePolicyAction(sid, form({ rateClass: "Preferred" }))), { ok: true, message: "Saved." }, "tracking fields still save");
  assert.equal(saleRow(sid).monthly_cents, 10_000);
  // An admin's past-month change still goes to the owner; the owner's saves.
  assert.deepEqual(await as(admin, () => sales.updatePolicyAction(sid, form({ monthly: "120" }))), { ok: true, message: "Sent to Anersi for a quick OK." });
  assert.deepEqual(await as("owner", () => sales.updatePolicyAction(sid, form({ monthly: "120" }))), { ok: true, message: "Saved." });
  assert.equal(saleRow(sid).monthly_cents, 12_000);
});

test("an AgentSpace day total: nothing editable, an admin may remove it", async () => {
  reset();
  const sid = randomUUID();
  tables.sales.push({ id: sid, agent_id: id(ann), premium_cents: 300_000, policies: 3, product: null, carrier: null, kind: "life", client: null, note: "AgentSpace import 2026-11-12: day total", sold_on: today(), logged_by: "owner", logged_by_agent: null, created_at: new Date().toISOString(), deleted_at: null, source: "import", agents: { name: "Ann Agent" } });
  assert.deepEqual(await as(ann, () => sales.setPolicyStatusAction(sid, "Issued")), { ok: false, error: types.LOCK.importRow });
  assert.deepEqual(await as("owner", () => sales.updatePolicyAction(sid, form({ monthly: "5" }))), { ok: false, error: types.LOCK.importRow });
  assert.equal((await as(ann, () => sales.removePolicyAction(sid))).ok, false);
  assert.deepEqual(await as(admin, () => sales.removePolicyAction(sid)), { ok: true, message: "Removed." });
});

test("the Shortcut's sale (no viewer): status Submitted, monthly = annual / 12, source shortcut, a history line", async () => {
  reset();
  const r = await policies.logBoardSale(null, { agentId: id(ben), premiumCents: 120_000, policies: 1, product: null, carrier: "AmAm", kind: "life", note: null, soldOn: today() });
  const row = saleRow(r.id);
  assert.equal(r.agentName, "Ben Agent");
  assert.equal(row.status, "Submitted");
  assert.equal(row.monthly_cents, 10_000);
  assert.equal(row.source, "shortcut");
  assert.equal(row.logged_by, "shortcut");
  assert.deepEqual(tables.sale_events.at(-1), { ...tables.sale_events.at(-1), by_agent: null, by_label: "shortcut", what: "Logged the sale" });
});

test("joiners and levels: who confirms, Not on my team, a manager's own team link, agent <-> manager at once", async () => {
  reset();
  assert.deepEqual(await as(ann, () => people.confirmUpline(id(jo))), { ok: false, error: "Only their upline's managers or an admin can confirm them." });
  assert.deepEqual(await as(zed, () => people.declineUpline(id(jo))), { ok: false, error: "Only their upline's managers or an admin can confirm them." });
  assert.deepEqual(await as(mia, () => people.declineUpline(id(jo))), { ok: true, message: "Jo Joiner isn't on a team now. An admin can set their upline." });
  assert.equal(jo.upline_id, null);
  assert.equal(jo.upline_confirmed, true);
  assert.deepEqual(await as(mia, () => people.confirmUpline(id(jo))), { ok: true, message: "Jo Joiner isn't waiting anymore." });
  // An admin setting an upline confirms it.
  jo.upline_id = id(mia);
  jo.upline_confirmed = false;
  assert.equal((await as(admin, () => people.setPersonUpline(id(jo), id(mia)))).ok, true);
  assert.equal(jo.upline_confirmed, true);
  // Levels.
  assert.deepEqual(await as(admin, () => people.setPersonRole(id(ann), "manager")), { ok: true, message: "Ann Agent is a manager now." });
  assert.equal(ann.role, "manager");
  assert.deepEqual(await as(admin, () => people.setPersonRole(id(ann), "member")), { ok: true, message: "Ann Agent is an agent now." });
  assert.deepEqual(await as(admin, () => people.setPersonRole(id(ann), "admin")), { ok: true, message: "Sent to Anersi for a quick OK." });
  assert.equal(ann.role, "member");
  assert.deepEqual(await as(admin, () => people.setPersonRole(id(admin), "member")), { ok: false, error: "Ask someone else to change your own level." });
  assert.deepEqual(await as(mia, () => people.setPersonRole(id(ann), "manager")), { ok: false, error: "Only an admin can do that" });
  // Join links: a manager their own team's only.
  assert.deepEqual(await as(mia, () => people.getJoinLink(null)), { ok: false, error: "You can share your own team's link." });
  assert.deepEqual(await as(mia, () => people.getJoinLink(id(zed))), { ok: false, error: "You can share your own team's link." });
  assert.equal((await as(ann, () => people.getJoinLink(id(ann)))).ok, false);
  const mine = await as(mia, () => people.getJoinLink(id(mia)));
  assert.equal(mine.ok, true);
  assert.equal(tables.invites.at(-1)?.upline_id, id(mia));
  assert.equal(tables.invites.at(-1)?.kind, "agency");
  // Back to an agent: the team link Mia made for her own team stops; one an admin made for her stays.
  const adminMade: Row = { ...tables.invites.at(-1)!, id: randomUUID(), token_hash: "x", token: null, created_by: id(admin) };
  tables.invites.push(adminMade);
  assert.equal((await as(admin, () => people.setPersonRole(id(mia), "member"))).ok, true);
  assert.ok(tables.invites.find((i) => i.upline_id === id(mia) && i.created_by === id(mia))?.revoked_at, "her own link is off");
  assert.equal(adminMade.revoked_at ?? null, null, "an admin's link for her team stays");
});

test("a team link made by a manager who is an agent now places joiners waiting, not confirmed", async () => {
  reset();
  const peopleLib = req("../src/lib/people") as typeof import("../src/lib/people");
  const invites = req("../src/lib/invites") as typeof import("../src/lib/invites");
  const miaLink = await invites.createInvite({ kind: "agency", uplineId: id(mia), createdBy: id(mia) });
  const adminLink = await invites.createInvite({ kind: "agency", uplineId: id(mia), createdBy: id(admin) });
  mia.role = "member"; // demoted by a path that left the link on
  const late = await peopleLib.joinWithInvite({ token: miaLink.token, name: "Lou Late", phone: "248 555 0141", password: "a long password", uplineId: id(mia), inOffice: false });
  assert.ok(late.ok);
  const lou = tables.agents.find((a) => a.id === late.agentId)!;
  assert.equal(lou.upline_id, id(mia));
  assert.equal(lou.upline_confirmed, false, "she can't hand out a team link as an agent");
  const viaAdmin = await peopleLib.joinWithInvite({ token: adminLink.token, name: "Vi Admin", phone: "248 555 0142", password: "a long password", uplineId: id(mia), inOffice: false });
  assert.ok(viaAdmin.ok);
  assert.equal(tables.agents.find((a) => a.id === viaAdmin.agentId)!.upline_confirmed, true, "an admin's link for her team is confirmed");
});

test("joining: a picked upline waits to be confirmed; a leader's own link is confirmed at once; a claimed row keeps its own", async () => {
  reset();
  const peopleLib = req("../src/lib/people") as typeof import("../src/lib/people");
  const invites = req("../src/lib/invites") as typeof import("../src/lib/invites");
  const agency = await invites.createInvite({ kind: "agency" });
  const miaLink = await invites.createInvite({ kind: "agency", uplineId: id(mia), createdBy: id(mia) });
  const join = (token: string, name: string, phone: string, uplineId: string | null) => peopleLib.joinWithInvite({ token, name, phone, password: "a long password", uplineId, inOffice: false });
  const row = (agentId: string) => tables.agents.find((a) => a.id === agentId)!;

  const picked = await join(agency.token, "Pat Picker", "248 555 0131", id(mia));
  assert.ok(picked.ok);
  assert.equal(row(picked.agentId).upline_id, id(mia));
  assert.equal(row(picked.agentId).upline_confirmed, false, "a pick on the agency link waits");

  const viaLink = await join(miaLink.token, "Lee Linked", "248 555 0132", id(mia));
  assert.ok(viaLink.ok);
  assert.equal(row(viaLink.agentId).upline_confirmed, true, "the leader's own link: confirmed");

  const elsewhere = await join(miaLink.token, "Kim Elsewhere", "248 555 0133", id(admin));
  assert.ok(elsewhere.ok);
  assert.equal(row(elsewhere.agentId).upline_id, id(admin));
  assert.equal(row(elsewhere.agentId).upline_confirmed, false, "someone other than the link's leader waits");

  const alone = await join(agency.token, "Al Alone", "248 555 0134", null);
  assert.ok(alone.ok);
  assert.equal(row(alone.agentId).upline_confirmed, true, "nothing to confirm");

  // A manager's row with no sign-in is never claimed by a typed name: it would open the team's clients.
  const roy = person("Roy Rowkeeper", { role: "manager", upline_id: id(admin), pass_hash: null });
  tables.agents.push(roy);
  const asManager = await join(agency.token, "roy rowkeeper", "248 555 0135", null);
  assert.equal(asManager.ok, false);
  assert.equal(roy.pass_hash, null);
  // Nor an agent's row with people under it, nor one that already holds a CRM policy.
  const lea = person("Lea Leader", { pass_hash: null });
  tables.agents.push(lea, person("Tim Underlea", { upline_id: id(lea) }));
  assert.equal((await join(agency.token, "Lea Leader", "248 555 0137", null)).ok, false);
  assert.equal(lea.pass_hash, null);
  const pam = person("Pam Policyrow", { pass_hash: null });
  tables.agents.push(pam);
  tables.sales.push({ id: randomUUID(), agent_id: id(pam), status: "Submitted", premium_cents: 120_000, policies: 1, sold_on: today(), created_at: new Date().toISOString(), deleted_at: null });
  assert.equal((await join(agency.token, "Pam Policyrow", "248 555 0138", null)).ok, false);
  assert.equal(pam.pass_hash, null);
  // An agent's row with no team and no policies is claimed, and keeps its upline and its confirmed state.
  const ray = person("Ray Rowkeeper", { upline_id: id(admin), pass_hash: null });
  tables.agents.push(ray);
  const claimed = await join(agency.token, "ray rowkeeper", "248 555 0139", null);
  assert.ok(claimed.ok);
  assert.equal(claimed.agentId, id(ray));
  assert.equal(ray.upline_id, id(admin));
  assert.equal(ray.upline_confirmed, true);
  // The card's names: only the rows a typed name may claim.
  const names = await peopleLib.claimableNames();
  for (const n of ["Roy Rowkeeper", "Lea Leader", "Pam Policyrow", "Ray Rowkeeper", "Ada Adminrow"]) assert.ok(!names.includes(n), n);
  // An admin's row is never claimed by its name.
  tables.agents.push(person("Ada Adminrow", { role: "admin", pass_hash: null }));
  const refused = await join(agency.token, "Ada Adminrow", "248 555 0136", null);
  assert.equal(refused.ok, false);
  assert.equal(peopleLib.claimableRole("manager"), false);
  assert.equal(peopleLib.claimableRole("admin"), false);
});
