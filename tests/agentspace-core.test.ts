import { test } from "node:test";
import assert from "node:assert/strict";
import {
  cellsOf,
  centsOf,
  dealToPolicy,
  diffCells,
  findPerson,
  mapStatus,
  needsOf,
  normName,
  phoneText,
  sameSale,
  searchQueries,
  tidyAgentName,
  worthFetching,
  type AsDeal,
  type AsScoreRow,
  type LinkedPolicy,
} from "../src/lib/agentspace-core";

/** The sync's pure part: mapping a deal to a policy, who an agent is, the Scoreboard against the board, the search plan. Invented people only. */
const deal = (extra: Partial<AsDeal> = {}): AsDeal => ({
  id: "d1",
  client: { first_name: "Wanda", last_name: "Fitch", email: "wanda@example.com", phone: "1-555-010-0199", address: "1 Test Rd", date_of_birth: "1950-02-03" },
  agent: { id: "a1", name: "Ada Lovelace" },
  carrier: { display_name: "Test Mutual", name: "TM" },
  product: { name: "WL/FEX" },
  policy_number: "P-1",
  application_number: null,
  status: { code: "pending", raw: "SUBMITTED", label: "Pending", portfolio_bucket: "pipeline" },
  annual_premium: "1135.00",
  monthly_premium: "94.58",
  face_value: "10000.00",
  policy_effective_date: "2026-11-20",
  submission_date: "2026-11-10",
  billing_cycle: "monthly",
  billing_day_of_month: "5th",
  billing_weekday: null,
  lead_source: "Referral",
  rate_class: "Standard",
  notes: "  a note ",
  post_a_deal: true,
  beneficiaries: [{ name: "Pia Fitch", relationship: "Daughter" }],
  created_at: "2026-11-10T14:00:00.123456Z",
  updated_at: "2026-11-10T15:00:00.000000Z",
  ...extra,
});

test("a deal becomes a policy the way the one-time copy made it", () => {
  const r = dealToPolicy(deal());
  assert.ok(r.ok);
  if (!r.ok) return;
  const p = r.policy;
  assert.equal(p.premiumCents, 113500);
  assert.equal(p.monthlyCents, 9458);
  assert.equal(p.coverageCents, 1000000);
  assert.equal(p.status, "Submitted");
  assert.equal(p.carrier, "Test Mutual");
  assert.equal(p.billingCycle, "Monthly");
  assert.equal(p.billingDay, "5th");
  assert.equal(p.ssBenefit, false);
  assert.equal(p.clientPhone, "(555) 010-0199");
  assert.equal(p.notes, "a note");
  assert.deepEqual(p.beneficiaries, [{ name: "Pia Fitch", relationship: "Daughter" }]);
  const ss = dealToPolicy(deal({ billing_weekday: "Wednesday", billing_day_of_month: "3rd" }));
  assert.ok(ss.ok && ss.policy.ssBenefit && ss.policy.billingDay === "3rd Wednesday");
});

test("a deal with no agent, no day or no premium is never copied", () => {
  assert.deepEqual(dealToPolicy(deal({ agent: null })), { ok: false, reason: "no_agent" });
  assert.deepEqual(dealToPolicy(deal({ submission_date: null })), { ok: false, reason: "no_date" });
  assert.deepEqual(dealToPolicy(deal({ annual_premium: "0.00" })), { ok: false, reason: "no_premium" });
  assert.deepEqual(dealToPolicy(deal({ annual_premium: null })), { ok: false, reason: "no_premium" });
});

test("field lengths are cut to the database's limits", () => {
  const r = dealToPolicy(deal({ notes: "x".repeat(5000), rate_class: "r".repeat(90), policy_number: "9".repeat(90), client: { first_name: "f".repeat(90), last_name: "l", address: "a".repeat(400) } }));
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(r.policy.notes!.length, 2000);
  assert.equal(r.policy.rateClass!.length, 40);
  assert.equal(r.policy.policyNumber!.length, 60);
  assert.equal(r.policy.clientFirst!.length, 60);
  assert.equal(r.policy.clientAddress!.length, 200);
});

test("statuses: the four the copy knew, the ones a deal moves to, and the unknown", () => {
  const code = (c: string, extra = {}) => mapStatus({ code: c, ...extra });
  assert.equal(code("pending"), "Submitted");
  assert.equal(code("underwriter_review"), "Underwriting");
  assert.equal(code("issued_not_in_force"), "Approved");
  assert.equal(code("active"), "Issued");
  assert.equal(code("declined"), "Declined");
  assert.equal(code("not_taken"), "Cancelled");
  assert.equal(code("lapsed"), "Cancelled");
  assert.equal(code("closed"), "Cancelled");
  assert.equal(code("cancelled"), "Cancelled");
  assert.equal(code("who_knows", { portfolio_bucket: "pipeline" }), "Submitted");
  assert.equal(code("who_knows"), null);
});

test("names compare without case, spacing or the kind of apostrophe", () => {
  assert.equal(normName("  Pat  O’Neil "), normName("pat o'neil"));
  assert.equal(tidyAgentName("troy t"), "Troy T");
  assert.equal(tidyAgentName("Mary-Ann O'Neil"), "Mary-Ann O'Neil");
  assert.equal(centsOf("1,234.50"), 123450);
  assert.equal(centsOf(2364), 236400);
  assert.equal(centsOf("x"), null);
  assert.equal(phoneText("5550100199"), "(555) 010-0199");
});

test("who an AgentSpace agent is on the board: link, name, alias, one-letter spelling, nobody", () => {
  const people = [
    { id: "s1", name: "Ada Lovelace", active: true },
    { id: "s2", name: "Grace Hopperton", active: true },
    { id: "s3", name: "Alan Turing", active: false },
    { id: "s4", name: "Alan  Turing", active: true },
  ];
  const lookup = { map: { a9: "s2" }, aliases: { "bob smith": "Alan Turing" } };
  assert.equal(findPerson("a9", "Whatever Name", people, lookup)?.how, "link");
  assert.equal(findPerson("a1", "ADA LOVELACE", people, lookup)?.person.id, "s1");
  // Two with one name: the one on the board.
  assert.equal(findPerson("a3", "alan turing", people, lookup)?.person.id, "s4");
  assert.equal(findPerson("a4", "Bob Smith", people, lookup)?.how, "alias");
  // One letter off, and the only one so close.
  assert.deepEqual([findPerson("a5", "Grace Hoppertun", people, lookup)?.person.id, findPerson("a5", "Grace Hoppertun", people, lookup)?.how], ["s2", "spelling"]);
  // Two letters off, or two people close: nobody.
  assert.equal(findPerson("a6", "Grace Hopperxxn", people, lookup), null);
  assert.equal(findPerson("a7", "Ada Lovelaxe", [...people, { id: "s5", name: "Ada Lovelaze", active: true }], lookup), null);
  assert.equal(findPerson("a8", "Zed Quill", people, lookup), null);
});

const rows: AsScoreRow[] = [
  { agentId: "a1", entityId: "a1", name: "Ada Lovelace", rowType: "producer", dailyBreakdown: { "2026-11-02": 1000, "2026-11-03": 250.5, "2026-08-30": 99, "2026-11-04": 0 } },
  { agentId: "a2", name: "Grace Hopperton", rowType: "producer", dailyBreakdown: { "2026-11-02": 400 } },
  { agentId: "ag", name: "Agency", rowType: "agency", dailyBreakdown: { "2026-11-02": 9999 } },
];

test("the Scoreboard as cells: producers only, since the start, no zeros", () => {
  const cells = cellsOf(rows, "2026-09-01", "2026-11-16");
  assert.deepEqual(cells.map((c) => [c.asAgentId, c.day, c.cents]), [
    ["a1", "2026-11-02", 100000],
    ["a1", "2026-11-03", 25050],
    ["a2", "2026-11-02", 40000],
  ]);
});

test("cells against the board: only the days that differ, deleted rows left out, kept-off rows counted", () => {
  const cells = cellsOf(rows, "2026-09-01", "2026-11-16");
  const link = (saleId: string, dealId: string, agentId: string, day: string, cents: number, deleted = false): LinkedPolicy => ({ saleId, dealId, agentId, day, cents, deleted });
  const rev = new Map([["s1", "a1"], ["s2", "a2"]]);
  const asIdOf = (id: string) => rev.get(id) ?? null;
  const linked = [link("x1", "d1", "s1", "2026-11-02", 100000), link("x2", "d2", "s1", "2026-11-03", 20000), link("x3", "d3", "s2", "2026-11-02", 40000, true)];
  const diffs = diffCells(cells, linked, [], asIdOf);
  assert.deepEqual(diffs.map((d) => [d.key, d.delta]), [
    ["a2|2026-11-02", 40000],
    ["a1|2026-11-03", 5050],
  ]);
  // An admin's removal that stays still counts on this side.
  const kept = diffCells(cells, linked, [{ agentId: "s2", day: "2026-11-02", cents: 40000 }], asIdOf);
  assert.deepEqual(kept.map((d) => d.key), ["a1|2026-11-03"]);
  // A row Scorecard holds where AgentSpace shows nothing is a negative gap, and not something to search for.
  const extra = diffCells(cells, [...linked, link("x4", "d4", "s2", "2026-11-05", 7000)], [{ agentId: "s2", day: "2026-11-02", cents: 40000 }], asIdOf);
  assert.equal(extra.find((d) => d.key === "a2|2026-11-05")?.delta, -7000);
  assert.deepEqual([...needsOf(extra).keys()], ["a1|2026-11-03"]);
  // A person not linked to an AgentSpace agent yet: AgentSpace's whole cell is missing.
  const none = diffCells(cells, [], [], () => null);
  assert.equal(none.length, 3);
});

test("which found deals are worth a look", () => {
  const cells = cellsOf(rows, "2026-09-01", "2026-11-16");
  const needs = needsOf(diffCells(cells, [], [], () => null));
  const summary = { id: "d1", agent: { id: "a1" }, submission_date: "2026-11-02", updated_at: "u1" };
  assert.equal(worthFetching(summary, needs, new Set(), {}), true);
  assert.equal(worthFetching(summary, needs, new Set(["d1"]), {}), false, "already linked");
  assert.equal(worthFetching({ ...summary, submission_date: "2026-11-09" }, needs, new Set(), {}), false, "a cell that is not missing anything");
  assert.equal(worthFetching(summary, needs, new Set(), { d1: "u1" }), false, "seen as not counting, unchanged");
  assert.equal(worthFetching(summary, needs, new Set(), { d1: "older" }), true, "seen as not counting, changed since");
});

test("the same sale: seller, day, annual premium and client name; a row with no client name matches on the first three", () => {
  const a = { agentId: "s1", soldOn: "2026-11-02", premiumCents: 100000, clientFirst: "Wanda", clientLast: "Fitch" };
  assert.equal(sameSale({ ...a, clientFirst: " wanda", clientLast: "FITCH" }, a), true);
  assert.equal(sameSale({ ...a, clientLast: "Fitz" }, a), false);
  assert.equal(sameSale({ ...a, premiumCents: 100001 }, a), false);
  assert.equal(sameSale({ ...a, soldOn: "2026-11-03" }, a), false);
  assert.equal(sameSale({ ...a, agentId: "s2" }, a), false);
  assert.equal(sameSale({ ...a, clientFirst: null, clientLast: null }, a), true);
});

test("the search walks the common pairs first, then every pair, then the phone prefixes, each once", () => {
  const q = searchQueries();
  assert.deepEqual(q.slice(0, 4), ["co", "an", "ar", "er"]);
  assert.equal(new Set(q).size, q.length);
  assert.equal(q.filter((x) => /^[a-z]{2}$/.test(x)).length, 676);
  assert.equal(q.filter((x) => /^\d{3}$/.test(x)).length, 1000);
  assert.ok(q.indexOf("zz") > q.indexOf("co"));
});
