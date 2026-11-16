import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { lag, req, tables, type Row } from "./stand-in";
import { MockAgentSpace } from "./agentspace-mock";

/**
 * The AgentSpace sync (src/lib/agentspace.ts) driven against a mock AgentSpace over real HTTP and
 * the stand-in database: it links what is already here without adding anything, adds a new deal,
 * carries a status and a premium in, takes a gone deal off, never counts a sale twice, retries a
 * 429, reports a rejected key, stops at its budget and goes on, and two runs at once never both
 * write. Invented people only; no client value may reach a history line, the state or a log.
 */
const mock = new MockAgentSpace();
process.env.AGENTSPACE_API_KEY = "test-key";
const agentspace = req("../src/lib/agentspace") as typeof import("../src/lib/agentspace");
const month = req("../src/lib/month") as typeof import("../src/lib/month");

before(async () => {
  await mock.start();
  process.env.AGENTSPACE_BASE_URL = mock.base;
});
after(async () => {
  await mock.stop();
});

const today = () => month.todayInDetroit();
const daysAgo = (n: number) => month.addDays(today(), -n);
const FIXED = "2026-11-10T15:00:00.000Z";

const person = (name: string, extra: Row = {}): Row => ({ id: randomUUID(), name, active: true, sort: tables.agents.length + 1, pc_licensed: false, upline_id: null, upline_confirmed: true, in_office: false, role: "member", ...extra });
let ada: Row, grace: Row;
const CLIENTS = [
  ["Wanda", "Fitch"],
  ["Orrin", "Vale"],
  ["Pia", "Marsh"],
  ["Dex", "Holloway"],
] as const;
const SECRETS = ["Wanda", "Fitch", "Orrin", "Vale", "Pia", "Marsh", "Dex", "Holloway", "zyxqwv", "555-0", "Test Road", "test-key"];

let logged: string[] = [];
const realError = console.error;
function reset(): void {
  for (const t of Object.keys(tables)) tables[t] = [];
  ada = person("Ada Lovelace");
  grace = person("Grace Hopperton");
  tables.agents.push(person("Olive Owner", { role: "owner" }), ada, grace);
  tables.settings = [{ key: "app", value: {}, updated_at: "2026-11-01T00:00:00.000Z" }];
  mock.deals.clear();
  mock.hidden.clear();
  mock.key = "test-key";
  mock.queue = [];
  mock.resetCalls();
  lag.ms = 0;
  logged = [];
  console.error = (...args: unknown[]) => void logged.push(args.map(String).join(" "));
}
const restore = () => {
  console.error = realError;
};

/** A deal in AgentSpace and the policy Scorecard holds for it (as the one-time copy made it, with no deal id yet). */
function both(n: number, who: Row, asId: string, asName: string, day: string, annual: number, extra: Partial<Parameters<MockAgentSpace["add"]>[0]> = {}): string {
  const [first, last] = CLIENTS[n % CLIENTS.length];
  const id = `deal-${n}-${asId}`;
  mock.add({ id, clientFirst: first, clientLast: last, email: `${first.toLowerCase()}@example.test`, phone: `555-010${n}`, agentId: asId, agentName: asName, day, annual, createdAt: FIXED, updatedAt: FIXED, policyNumber: `PN-${n}`, ...extra });
  const sale: Row = {
    id: randomUUID(),
    agent_id: who.id,
    premium_cents: Math.round(annual * 100),
    policies: 1,
    kind: "life",
    sold_on: day,
    carrier: "Test Mutual",
    product: "WL/FEX",
    status: "Submitted",
    client_first: first,
    client_last: last,
    policy_number: `PN-${n}`,
    notes: null,
    source: "scorecard",
    logged_by: "owner",
    created_at: "2026-11-11T22:00:00.000Z",
    updated_at: FIXED,
    deleted_at: null,
    agents: { name: String(who.name) },
  };
  tables.sales.push(sale);
  return String(sale.id);
}
const sale = (id: string) => tables.sales.find((s) => s.id === id)!;
const live = () => tables.sales.filter((s) => s.deleted_at == null);
const state = () => (tables.settings.find((s) => s.key === "agentspace_sync")?.value ?? {}) as Record<string, unknown>;
const lines = (id: string) => tables.sale_events.filter((e) => e.sale_id === id).map((e) => String(e.what));
const run = (opts: Parameters<typeof agentspace.runSync>[0] = {}) => agentspace.runSync({ force: true, ...opts });
const counts = async (opts?: Parameters<typeof agentspace.runSync>[0]) => {
  const r = await run(opts);
  assert.ok(r.ran, `ran (${JSON.stringify(r)})`);
  return r;
};
function assertNoSecrets(): void {
  const text = JSON.stringify([tables.sale_events.map((e) => e.what), state(), logged, tables.approvals]);
  for (const v of SECRETS) assert.ok(!text.includes(v), `no "${v}" in history, state or logs`);
}

test("without a key the sync is off and touches nothing", async () => {
  reset();
  delete process.env.AGENTSPACE_API_KEY;
  assert.deepEqual(await agentspace.runSync({ force: true }), { ran: false, why: "not_connected" });
  assert.equal(agentspace.connected(), false);
  assert.equal(tables.settings.length, 1);
  process.env.AGENTSPACE_API_KEY = "test-key";
  restore();
});

test("the first run links what is already here and adds nothing; the second changes nothing", async () => {
  reset();
  // Scorecard spells her name the way the board does; AgentSpace's is one letter off.
  const a = both(0, ada, "as-ada", "Ada Lovelace", daysAgo(3), 1200);
  const b = both(1, ada, "as-ada", "Ada Lovelace", daysAgo(3), 600);
  const c = both(2, grace, "as-grace", "Grace Hoppertun", daysAgo(2), 2400);
  const d = both(3, grace, "as-grace", "Grace Hoppertun", daysAgo(1), 960);
  // A sale only Scorecard has (nobody posted it in AgentSpace): left alone.
  const only = randomUUID();
  tables.sales.push({ id: only, agent_id: ada.id, premium_cents: 55500, policies: 1, kind: "life", sold_on: daysAgo(1), source: "scorecard", logged_by: "team", created_at: FIXED, deleted_at: null, agents: { name: "Ada Lovelace" } });
  const before = tables.sales.length;
  const first = await counts();
  assert.ok(first.ok);
  if (!first.ok) return;
  assert.equal(first.counts.linked, 4);
  assert.equal(first.counts.inserted, 0);
  assert.equal(first.counts.newAgents, 0);
  assert.equal(tables.sales.length, before);
  for (const id of [a, b, c, d]) assert.ok(String(sale(id).agentspace_deal_id).startsWith("deal-"));
  assert.equal(sale(only).agentspace_deal_id ?? null, null);
  assert.equal((state().unresolved_total as number) ?? 0, 0);
  assert.equal((state().agent_map as Record<string, string>)["as-grace"], grace.id, "the spelling match is remembered");
  const events = tables.sale_events.length;
  const second = await counts();
  assert.ok(second.ok);
  if (!second.ok) return;
  assert.deepEqual([second.counts.linked, second.counts.inserted, second.counts.updated, second.counts.removed, second.counts.newAgents], [0, 0, 0, 0, 0]);
  assert.equal(tables.sale_events.length, events, "no history line for nothing");
  assert.equal(tables.sales.length, before);
  assert.equal(state().last_error_class, null);
  assertNoSecrets();
  restore();
});

test("a deal posted in AgentSpace appears on its own: fresh ones celebrate, older ones stay quiet", async () => {
  reset();
  both(0, ada, "as-ada", "Ada Lovelace", daysAgo(3), 1200);
  await counts();
  const start = Date.now();
  mock.add({ id: "deal-new", clientFirst: "Orrin", clientLast: "Vale", email: "zyxqwv@zzz.zz", phone: "555-0150", agentId: "as-grace", agentName: "Grace Hopperton", day: today(), annual: 3000, createdAt: new Date().toISOString(), product: "TERM", carrier: "Other Life" });
  mock.add({ id: "deal-old", clientFirst: "Pia", clientLast: "Marsh", email: "pia@example.test", phone: "555-0152", agentId: "as-grace", agentName: "Grace Hopperton", day: daysAgo(4), annual: 1800, createdAt: "2026-11-09T12:00:00.000Z" });
  const r = await counts();
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(r.counts.inserted, 2);
  const fresh = tables.sales.find((s) => s.agentspace_deal_id === "deal-new")!;
  const old = tables.sales.find((s) => s.agentspace_deal_id === "deal-old")!;
  assert.equal(fresh.agent_id, grace.id);
  assert.equal(fresh.premium_cents, 300000);
  assert.equal(fresh.kind, "life");
  assert.equal(fresh.logged_by, "owner");
  assert.equal(fresh.logged_by_agent, null);
  assert.equal(fresh.source, "scorecard");
  assert.equal(fresh.policies, 1);
  assert.equal(fresh.product, "TERM");
  assert.equal(fresh.client_last, "Vale");
  assert.ok(Date.parse(String(fresh.created_at)) >= start, "a deal created in the last day is new on the TV");
  assert.equal(String(old.created_at), "2026-11-09T12:00:00.000Z", "an older one keeps AgentSpace's own time");
  assert.deepEqual(lines(String(fresh.id)), ["Copied from AgentSpace"]);
  assert.equal((tables.sale_events.find((e) => e.sale_id === fresh.id)!.by_label), "agentspace");
  assert.equal(state().unresolved_total, 0);
  const again = await counts();
  assert.ok(again.ok);
  if (again.ok) assert.deepEqual([again.counts.inserted, again.counts.updated, again.counts.linked], [0, 0, 0]);
  assertNoSecrets();
  restore();
});

test("a status, a premium and a note changed in AgentSpace flow in; an edit made here since is not wiped", async () => {
  reset();
  const s1 = both(0, ada, "as-ada", "Ada Lovelace", daysAgo(5), 1200);
  const s2 = both(1, ada, "as-ada", "Ada Lovelace", daysAgo(4), 600);
  await counts();
  // Status, in a quiet run (the rotation looks at the deal).
  const d1 = mock.deals.get("deal-0-as-ada")!;
  d1.status = "active";
  d1.updatedAt = "2026-11-12T09:00:00.000Z";
  d1.notes = "Approved by the carrier";
  // A premium (the Scoreboard cell moves, so the deal is looked at first).
  const d2 = mock.deals.get("deal-1-as-ada")!;
  d2.annual = 720;
  d2.monthly = 60;
  d2.updatedAt = "2026-11-12T09:30:00.000Z";
  // A note someone typed here after the copy: newer than AgentSpace's own last change.
  sale(s2).notes = "mine";
  sale(s2).updated_at = "2026-11-13T10:00:00.000Z";
  const r = await counts();
  assert.ok(r.ok);
  assert.equal(sale(s1).status, "Issued");
  assert.equal(sale(s1).notes, "Approved by the carrier");
  assert.ok(lines(s1).includes("Status from AgentSpace: Submitted → Issued"));
  assert.ok(lines(s1).includes("Notes updated from AgentSpace"));
  assert.equal(sale(s2).premium_cents, 72000);
  assert.equal(sale(s2).monthly_cents, 6000);
  assert.ok(lines(s2).includes("Premium from AgentSpace: $600 → $720 a year"));
  assert.equal(sale(s2).notes, "mine", "an edit newer than AgentSpace's is kept");
  assert.equal(state().unresolved_total, 0);
  const again = await counts();
  assert.ok(again.ok);
  if (again.ok) assert.equal(again.counts.updated, 0);
  assertNoSecrets();
  restore();
});

test("a deal that is gone, or no longer counts, comes off the board; one that counts again comes back", async () => {
  reset();
  const s1 = both(0, ada, "as-ada", "Ada Lovelace", daysAgo(5), 1200);
  const s2 = both(1, ada, "as-ada", "Ada Lovelace", daysAgo(4), 600);
  const s3 = both(2, grace, "as-grace", "Grace Hopperton", daysAgo(3), 900);
  await counts();
  mock.deals.delete("deal-0-as-ada");
  mock.deals.get("deal-1-as-ada")!.post = false;
  const r = await counts();
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(r.counts.removed, 2);
  assert.notEqual(sale(s1).deleted_at, null);
  assert.notEqual(sale(s2).deleted_at, null);
  assert.equal(sale(s3).deleted_at, null);
  assert.ok(lines(s1).includes("Removed: the deal is gone from AgentSpace"));
  assert.ok(lines(s2).includes("Removed: AgentSpace no longer counts this deal"));
  assert.equal(state().unresolved_total, 0);
  const quiet = await counts();
  assert.ok(quiet.ok);
  if (quiet.ok) assert.deepEqual([quiet.counts.removed, quiet.counts.revived, quiet.counts.inserted], [0, 0, 0]);
  // Counting again: the same policy comes back (the sync took it off, so the sync may put it back).
  mock.deals.get("deal-1-as-ada")!.post = true;
  const back = await counts();
  assert.ok(back.ok);
  if (!back.ok) return;
  assert.equal(back.counts.revived, 1);
  assert.equal(sale(s2).deleted_at, null);
  assert.equal(back.counts.inserted, 0);
  assertNoSecrets();
  restore();
});

test("a policy an admin took off on purpose stays off, and the board does not look short", async () => {
  reset();
  const s1 = both(0, ada, "as-ada", "Ada Lovelace", daysAgo(5), 1200);
  both(1, ada, "as-ada", "Ada Lovelace", daysAgo(4), 600);
  await counts();
  sale(s1).deleted_at = new Date().toISOString();
  tables.sale_events.push({ id: 9001, sale_id: s1, at: new Date().toISOString(), by_agent: null, by_label: "owner", what: "Removed the policy" });
  const r = await counts();
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(r.counts.revived, 0);
  assert.notEqual(sale(s1).deleted_at, null);
  assert.equal(state().unresolved_total, 0);
  const again = await counts();
  assert.ok(again.ok);
  if (again.ok) assert.deepEqual([again.counts.revived, again.counts.inserted, again.counts.updated], [0, 0, 0]);
  restore();
});

test("a deal entered in both apps is linked, never counted twice (with the client's name, or from the Shortcut without one)", async () => {
  reset();
  // The same sale typed here by hand (client named), another through the Shortcut (no client), one with a different premium.
  const typed = both(0, ada, "as-ada", "Ada Lovelace", daysAgo(3), 1200);
  sale(typed).client_first = "wanda";
  sale(typed).client_last = "FITCH";
  const short = both(1, ada, "as-ada", "Ada Lovelace", daysAgo(2), 600);
  sale(short).client_first = null;
  sale(short).client_last = null;
  sale(short).source = "shortcut";
  const different = both(2, grace, "as-grace", "Grace Hopperton", daysAgo(2), 900);
  sale(different).premium_cents = 95000;
  const r = await counts();
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(r.counts.linked, 2);
  assert.equal(r.counts.inserted, 1, "the one with another premium is a different sale");
  assert.equal(live().length, 4);
  assert.ok(sale(typed).agentspace_deal_id && sale(short).agentspace_deal_id);
  assert.equal(sale(different).agentspace_deal_id ?? null, null);
  // The board adds up to AgentSpace's for the linked days.
  const total = live().filter((s) => s.agentspace_deal_id).reduce((n, s) => n + Number(s.premium_cents), 0);
  assert.equal(total, 120000 + 60000 + 90000);
  assertNoSecrets();
  restore();
});

test("an agent AgentSpace has and the board does not is added as a member with no upline", async () => {
  reset();
  mock.add({ id: "deal-q", clientFirst: "Pia", clientLast: "Marsh", email: "pia@example.test", phone: "555-0152", agentId: "as-mae", agentName: "mae quillfeather", day: daysAgo(1), annual: 1500, createdAt: FIXED });
  const r = await counts();
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(r.counts.newAgents, 1);
  const mae = tables.agents.find((a) => a.name === "Mae Quillfeather")!;
  assert.ok(mae);
  assert.equal(mae.active, true);
  assert.equal(mae.role, "member");
  assert.equal(mae.upline_id ?? null, null);
  assert.equal(tables.sales.find((s) => s.agentspace_deal_id === "deal-q")!.agent_id, mae.id);
  assert.deepEqual((state().new_agents as { name: string }[]).map((n) => n.name), ["Mae Quillfeather"]);
  const again = await counts();
  assert.ok(again.ok);
  if (again.ok) assert.deepEqual([again.counts.newAgents, again.counts.inserted], [0, 0]);
  assert.equal(tables.agents.filter((a) => a.name === "Mae Quillfeather").length, 1);
  restore();
});

test("a 429 is waited out and tried again, honoring Retry-After", async () => {
  reset();
  both(0, ada, "as-ada", "Ada Lovelace", daysAgo(3), 1200);
  mock.queue = ["429:0", "429:0", "500"];
  const r = await counts();
  assert.ok(r.ok, "the run still finishes");
  assert.ok(mock.total > 3 + 1, "the refused calls were made again");
  assert.equal(live().filter((s) => s.agentspace_deal_id).length, 1);
  // A wait longer than the run can afford, before AgentSpace has answered at all: an error class, not a crash.
  mock.queue = ["429:600"];
  const slow = await run();
  assert.ok(slow.ran && !slow.ok);
  if (slow.ran && !slow.ok) assert.equal(slow.error, "rate_limited");
  assert.equal(state().last_error_class, "rate_limited");
  // The same ask in the middle of a run that already has its numbers: saved, said so, not an error.
  mock.add({ id: "deal-slow", clientFirst: "Pia", clientLast: "Marsh", email: "pia@example.test", phone: "555-0152", agentId: "as-ada", agentName: "Ada Lovelace", day: daysAgo(1), annual: 700, createdAt: FIXED });
  mock.afterScoreboard = "429:600";
  const mid = await run();
  mock.afterScoreboard = null;
  assert.ok(mid.ran && mid.ok);
  if (mid.ran && mid.ok) assert.equal(mid.counts.stopped, "rate");
  assert.equal(state().last_error_class, null);
  const done = await run();
  assert.ok(done.ran && done.ok);
  assert.equal(tables.sales.filter((s) => s.agentspace_deal_id === "deal-slow").length, 1);
  restore();
});

test("a key AgentSpace does not accept is reported, nothing is changed, and the next try waits longer", async () => {
  reset();
  both(0, ada, "as-ada", "Ada Lovelace", daysAgo(3), 1200);
  mock.key = "another-key";
  const before = JSON.stringify(tables.sales);
  const r = await run();
  assert.ok(r.ran && !r.ok);
  if (r.ran && !r.ok) assert.equal(r.error, "key_rejected");
  assert.equal(JSON.stringify(tables.sales), before);
  assert.equal(state().last_error_class, "key_rejected");
  assert.equal(state().last_ok_at, null);
  assert.equal(state().lock_until, null, "the lock is let go");
  // Not forced: it is not due for a while.
  const next = await agentspace.runSync();
  assert.deepEqual(next.ran, false);
  assert.ok(!next.ran && next.why === "not_due");
  assertNoSecrets();
  restore();
});

test("a long search stops at its budget, saves where it was, and goes on at the next run", async () => {
  reset();
  both(0, ada, "as-ada", "Ada Lovelace", daysAgo(3), 1200);
  await counts();
  // A client no common name fragment finds: the search has to walk far.
  mock.add({ id: "deal-far", clientFirst: "Zyxqwv", clientLast: "Qwvzyx", email: "zyxqwv@zzz.zz", phone: "555-0160", agentId: "as-ada", agentName: "Ada Lovelace", day: daysAgo(1), annual: 2000, createdAt: FIXED });
  const first = await counts({ budget: agentspace.newBudget(45_000, 30) });
  assert.ok(first.ok);
  if (!first.ok) return;
  assert.equal(first.counts.stopped, "budget");
  assert.equal(first.counts.inserted, 0);
  const at = (state().search as { i: number }).i;
  assert.ok(at > 0, "it saved where it was");
  let inserted = 0;
  let runs = 1;
  for (; runs < 40 && !inserted; runs++) {
    const r = await counts({ budget: agentspace.newBudget(45_000, 60) });
    assert.ok(r.ok);
    if (r.ok) inserted += r.counts.inserted;
  }
  assert.equal(inserted, 1);
  assert.ok(runs > 2, "it took more than one run");
  assert.equal(tables.sales.filter((s) => s.agentspace_deal_id === "deal-far").length, 1);
  assert.equal(state().unresolved_total, 0);
  assert.deepEqual(state().search, { i: 0, keys: [], exhausted_at: null });
  // What the walk could not match is shown, not guessed: a deal no query finds.
  assertNoSecrets();
  restore();
});

test("two runs at the same moment never both write", async () => {
  for (const withRow of [false, true]) {
    reset();
    both(0, ada, "as-ada", "Ada Lovelace", daysAgo(3), 1200);
    if (withRow) await counts();
    mock.add({ id: "deal-race", clientFirst: "Dex", clientLast: "Holloway", email: "dex@example.test", phone: "555-0153", agentId: "as-ada", agentName: "Ada Lovelace", day: daysAgo(1), annual: 1800, createdAt: FIXED });
    lag.ms = 4;
    const results = await Promise.all([run(), run(), run()]);
    lag.ms = 0;
    const ran = results.filter((r) => r.ran);
    assert.equal(ran.length, 1, `one run wins (${withRow ? "row there" : "no row yet"})`);
    assert.equal(results.filter((r) => !r.ran && r.why === "busy").length, 2);
    assert.equal(tables.sales.filter((s) => s.agentspace_deal_id === "deal-race").length, 1);
    assert.equal(state().lock_until, null);
  }
  restore();
});

test("a run that finds one already going does nothing; a lock that ran out is taken over", async () => {
  reset();
  both(0, ada, "as-ada", "Ada Lovelace", daysAgo(3), 1200);
  tables.settings.push({ key: "agentspace_sync", value: { v: 1, lock_until: new Date(Date.now() + 60_000).toISOString() }, updated_at: new Date().toISOString() });
  const busy = await run();
  assert.deepEqual(busy.ran, false);
  assert.equal(mock.total, 0, "AgentSpace is not even asked");
  (tables.settings[1].value as Record<string, unknown>).lock_until = new Date(Date.now() - 1000).toISOString();
  const taken = await run();
  assert.ok(taken.ran && taken.ok);
  restore();
});

test("the runs follow the minimum gap unless forced", async () => {
  reset();
  both(0, ada, "as-ada", "Ada Lovelace", daysAgo(3), 1200);
  const a = await agentspace.runSync();
  assert.ok(a.ran);
  const b = await agentspace.runSync();
  assert.ok(!b.ran && b.why === "not_due");
  const c = await agentspace.runSync({ now: () => new Date(Date.now() + 5 * 60_000) });
  assert.ok(c.ran);
  restore();
});

test("the status the Settings card reads holds counts and times, never a key or a client", async () => {
  reset();
  both(0, ada, "as-ada", "Ada Lovelace", daysAgo(3), 1200);
  mock.add({ id: "deal-x", clientFirst: "Pia", clientLast: "Marsh", email: "pia@example.test", phone: "555-0152", agentId: "as-ada", agentName: "Ada Lovelace", day: daysAgo(2), annual: 800, createdAt: FIXED });
  await counts();
  const card = await agentspace.syncStatus();
  assert.equal(card.connected, true);
  assert.equal(card.linked, 2);
  assert.ok(card.lastOkAt);
  assert.equal(card.unresolvedTotal, 0);
  assert.ok(!JSON.stringify(card).includes("test-key"));
  assertNoSecrets();
  restore();
});

test("a deal answer without its flag, or a 404 the Scoreboard does not back, takes nothing off the board", async () => {
  reset();
  const s1 = both(0, ada, "as-ada", "Ada Lovelace", daysAgo(5), 1200);
  const s2 = both(1, ada, "as-ada", "Ada Lovelace", daysAgo(4), 600);
  await counts();
  mock.deals.get("deal-0-as-ada")!.omitFlag = true;
  mock.hidden.add("deal-1-as-ada");
  const r = await counts();
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(r.counts.removed, 0);
  assert.equal(r.counts.skipped, 2);
  assert.equal(sale(s1).deleted_at, null);
  assert.equal(sale(s2).deleted_at, null);
  restore();
});

test("a note typed here is not blanked by a deal that changes elsewhere and has no note", async () => {
  reset();
  const s1 = both(0, ada, "as-ada", "Ada Lovelace", daysAgo(5), 1200);
  await counts();
  sale(s1).notes = "mine";
  sale(s1).updated_at = "2026-11-11T10:00:00.000Z";
  const d = mock.deals.get("deal-0-as-ada")!;
  d.status = "active";
  d.updatedAt = "2026-11-12T09:00:00.000Z";
  const r = await counts();
  assert.ok(r.ok);
  assert.equal(sale(s1).status, "Issued");
  assert.equal(sale(s1).notes, "mine");
  restore();
});

test("one deal the database refuses does not stop the others", async () => {
  reset();
  both(0, ada, "as-ada", "Ada Lovelace", daysAgo(3), 1200);
  mock.add({ id: "poison", clientFirst: "Pia", clientLast: "Marsh", email: "p@example.test", phone: "555-0105", agentId: "as-ada", agentName: "Ada Lovelace", day: daysAgo(2), annual: 500, createdAt: FIXED, updatedAt: FIXED, notes: "bad\u0000note" });
  mock.add({ id: "fine", clientFirst: "Dex", clientLast: "Holloway", email: "d@example.test", phone: "555-0106", agentId: "as-ada", agentName: "Ada Lovelace", day: daysAgo(1), annual: 700, createdAt: FIXED, updatedAt: FIXED });
  const r = await counts();
  assert.ok(r.ok, JSON.stringify(r));
  if (!r.ok) return;
  assert.equal(r.counts.inserted, 1);
  assert.ok(r.counts.skipped >= 1);
  assert.ok(live().some((s) => s.agentspace_deal_id === "fine"));
  assert.ok(!live().some((s) => s.agentspace_deal_id === "poison"));
  restore();
});
