import { test } from "node:test";
import assert from "node:assert/strict";
import {
  EMPTY_QUERY,
  activeFilterCount,
  applyQuery,
  clearFilters,
  facet,
  isStale,
  matchesSearch,
  nextSort,
  parseQuery,
  policiesCsv,
  queryToParams,
  searchWords,
  sortRows,
  statusCounts,
  viewCounts,
  viewOf,
  viewQuery,
} from "../src/lib/policy-filter";
import { DEFAULT_CARRIER_PRODUCTS, DEFAULT_LEAD_SOURCES, DEFAULT_RATE_CLASSES, IMPORT_LABEL, type PolicyListRow, type PolicyQuery } from "../src/lib/policy-types";

/** The Policies list's search, filters, sort, counts, saved views and CSV (src/lib/policy-filter.ts) on invented rows. */
const ctx = { today: "2026-11-12" };
let n = 0;
const row = (extra: Partial<PolicyListRow> = {}): PolicyListRow => ({
  id: `p-${++n}`,
  agentId: "11111111-1111-4111-8111-111111111111",
  agentName: "Ann Agent",
  loggedByAgent: null,
  createdAt: `2026-11-${String(10 + (n % 3)).padStart(2, "0")}T15:00:00Z`,
  source: "scorecard",
  kind: "life",
  premiumCents: 113_496,
  monthlyCents: 9458,
  policies: 1,
  carrier: "Americo",
  product: "WL/FEX",
  soldOn: "2026-11-10",
  status: "Submitted",
  underwriting: false,
  effectiveDate: "2026-12-01",
  rateClass: "Standard",
  coverageCents: 1_000_000,
  ssBenefit: false,
  billingCycle: "Monthly",
  leadSource: "FEX Dialer",
  policyNumber: null,
  applicationNumber: "88001234567",
  clientFirst: "Mary",
  clientLast: "Johnson",
  clientEmail: "mary.johnson@example.com",
  clientPhone: "(248) 555-0123",
  age: 66,
  beneficiaryCount: 1,
  ...extra,
});
const BEN = "22222222-2222-4222-8222-222222222222";
const rows: PolicyListRow[] = [
  row(),
  row({ clientFirst: "José", clientLast: "Álvarez", clientEmail: "", clientPhone: "(313) 555-0144", status: "Issued", policyNumber: "AM1234567", soldOn: "2026-11-02", effectiveDate: "2026-11-20", carrier: "AHL", monthlyCents: 5000, premiumCents: 60_000, beneficiaryCount: 0 }),
  row({ agentId: BEN, agentName: "Ben Agent", clientFirst: "Robert", clientLast: "Hill", clientEmail: "rhill@example.com", clientPhone: "(586) 555-0177", status: "Underwriting", soldOn: "2026-11-11", ssBenefit: true, leadSource: "Referral", monthlyCents: 12000, premiumCents: 144_000 }),
  row({ agentId: BEN, agentName: "Ben Agent", clientFirst: "Linda", clientLast: "Wright", clientEmail: "", clientPhone: "(734) 555-0188", status: null, coverageCents: null, rateClass: null, effectiveDate: null, applicationNumber: null }),
  row({ source: "import", clientFirst: "", clientLast: "", clientEmail: "", clientPhone: "", status: null, monthlyCents: null, premiumCents: 300_000, policies: 3, carrier: null, product: null, rateClass: null, leadSource: null, applicationNumber: null, beneficiaryCount: 0, soldOn: "2026-11-03", effectiveDate: null, ssBenefit: null, billingCycle: null, coverageCents: null }),
];

test("the query reads from the address: lists repeated or comma-joined, anything unknown dropped, and writes back only what differs", () => {
  const q = parseQuery({ status: ["Issued", "Bogus"], carrier: "AHL,Americo", sub: "7d", eff: "later", sort: "monthly", dir: "asc", limit: "50", q: "mary, j", stale: "1", agent: "not-an-id" });
  assert.deepEqual(q.status, ["Issued"]);
  assert.deepEqual(q.carrier, ["AHL", "Americo"]);
  assert.equal(q.sub, "7d");
  assert.equal(q.eff, null);
  assert.deepEqual(q.sort, { by: "monthly", dir: "asc" });
  assert.equal(q.limit, 50);
  assert.equal(q.q, "mary, j", "the search keeps its commas");
  assert.equal(q.stale, true);
  assert.deepEqual(q.agent, []);
  const back = parseQuery(queryToParams(q));
  assert.deepEqual(back, q);
  assert.equal(queryToParams(EMPTY_QUERY).toString(), "");
  assert.deepEqual(parseQuery(new URLSearchParams("sort=client&dir=sideways&limit=3")).sort, EMPTY_QUERY.sort);
  assert.equal(parseQuery(new URLSearchParams("limit=3")).limit, 25);
});

test("search: every word somewhere, accents and case ignored, phones and numbers by their digits, the seller only on a team's list", () => {
  const words = (q: string) => searchWords(q);
  const find = (q: string, withAgent = false) => rows.filter((p) => matchesSearch(p, words(q), withAgent)).map((p) => p.clientFirst || "import");
  assert.deepEqual(find("jose"), ["José"]);
  assert.deepEqual(find("ALVAREZ jos"), ["José"]);
  assert.deepEqual(find("313-555"), ["José"], "a phone by its digits");
  assert.deepEqual(find("am123"), ["José"], "a policy number");
  assert.deepEqual(find("(313) 5550144"), ["José"], "a phone typed another way");
  assert.deepEqual(find("mary.johnson@"), ["Mary"]);
  assert.deepEqual(find("ben"), [], "the seller is not searched on your own list");
  assert.deepEqual(find("ben agent", true), ["Robert", "Linda"]);
  assert.deepEqual(find("day total"), ["import"], "an import matches its label");
  assert.deepEqual(find("99"), [], "two digits are not a number search");
});

test("filters, the date presets and Needs attention", () => {
  const list = (q: Partial<PolicyQuery>) => applyQuery(rows, { ...EMPTY_QUERY, ...q }, ctx, { withAgent: true }).rows.map((p) => p.clientFirst || "import");
  assert.deepEqual(list({ status: ["Issued", "Underwriting"] }).sort(), ["José", "Robert"]);
  assert.deepEqual(list({ carrier: ["AHL"] }), ["José"]);
  assert.deepEqual(list({ ss: "yes" }), ["Robert"]);
  assert.deepEqual(list({ benef: "no" }).sort(), ["José", "import"]);
  assert.deepEqual(list({ sub: "7d" }).sort(), ["Linda", "Mary", "Robert"], "Nov 6 to Nov 12");
  assert.deepEqual(list({ sub: "custom", subFrom: "2026-11-02", subTo: "2026-11-03" }).sort(), ["José", "import"]);
  assert.deepEqual(list({ eff: "month" }), ["José"]);
  assert.deepEqual(list({ eff: "next" }).sort(), ["Mary", "Robert"]);
  assert.deepEqual(list({ agent: [BEN] }).sort(), ["Linda", "Robert"]);
  assert.deepEqual(list({ nonum: true }).sort(), ["Linda", "Mary", "Robert"], "an import has no number to miss");
  assert.equal(isStale({ status: "Submitted", soldOn: "2026-11-06" }, "2026-11-12"), true, "6 days");
  assert.equal(isStale({ status: "Submitted", soldOn: "2026-11-07" }, "2026-11-12"), false, "5 days is not more than 5");
  assert.equal(isStale({ status: "Issued", soldOn: "2026-11-01" }, "2026-11-12"), false);
  assert.deepEqual(list({ stale: true }), [], "nothing in these rows is older than 5 days and still open");
  assert.equal(activeFilterCount({ ...EMPTY_QUERY, status: ["Issued"], ss: "yes", stale: true }), 3);
  assert.deepEqual(clearFilters({ ...EMPTY_QUERY, q: "x", status: ["Issued"], scope: "team" }), { ...EMPTY_QUERY, q: "x", scope: "team" });
  // On your own list the Agent filter does nothing.
  assert.equal(applyQuery(rows, { ...EMPTY_QUERY, agent: [BEN] }, ctx, { withAgent: false, scope: "mine" }).rows.length, rows.length);
});

test("sort: newest submitted first by default; empty values last either way; the third click goes back", () => {
  const order = (by: PolicyQuery["sort"]) => sortRows(rows, by).map((p) => p.clientFirst || "import");
  assert.deepEqual(order({ by: "submitted", dir: "desc" }).slice(3), ["import", "José"]);
  assert.equal(order({ by: "submitted", dir: "desc" })[0], "Robert");
  assert.equal(order({ by: "submitted", dir: "desc" }).at(-1), "José");
  assert.deepEqual(order({ by: "monthly", dir: "desc" }), ["Robert", "Mary", "Linda", "José", "import"]);
  assert.equal(order({ by: "monthly", dir: "asc" }).at(-1), "import", "no monthly amount: last");
  assert.equal(order({ by: "client", dir: "asc" })[0], "import", "the import's label sorts as text");
  assert.deepEqual(order({ by: "status", dir: "asc" }).slice(0, 3), ["Mary", "Robert", "José"]);
  assert.deepEqual(nextSort(EMPTY_QUERY.sort, "client"), { by: "client", dir: "asc" });
  assert.deepEqual(nextSort({ by: "client", dir: "asc" }, "client"), { by: "client", dir: "desc" });
  assert.deepEqual(nextSort({ by: "client", dir: "desc" }, "client"), EMPTY_QUERY.sort);
  assert.deepEqual(nextSort(EMPTY_QUERY.sort, "monthly"), { by: "monthly", dir: "desc" });
});

test("the status strip and the facets count with every other filter on, and agree with the rows", () => {
  const q = { ...EMPTY_QUERY, status: ["Issued"], carrier: ["Americo"] };
  const { searched, rows: shown } = applyQuery(rows, q, ctx, { withAgent: true });
  assert.equal(shown.length, 0);
  const counts = statusCounts(searched, q, ctx);
  assert.equal(counts.all, 3, "Americo rows, any status");
  assert.equal(counts.byStatus.Submitted, 1);
  assert.equal(counts.byStatus.Underwriting, 1);
  assert.equal(counts.noStatus, 1);
  const lists = { carrierProducts: DEFAULT_CARRIER_PRODUCTS, rateClasses: DEFAULT_RATE_CLASSES, leadSources: DEFAULT_LEAD_SOURCES };
  const carriers = facet("carrier", rows, searched, q, ctx, lists);
  assert.equal(carriers.find((c) => c.value === "AHL")?.n, 1, "Issued AHL rows");
  assert.equal(carriers.find((c) => c.value === "Americo")?.n, 0);
  assert.ok(carriers.some((c) => c.value === "Corebridge"), "every carrier in Settings is an option");
  for (const c of carriers) {
    const n2 = applyQuery(rows, { ...q, carrier: [c.value] }, ctx, { withAgent: true }).rows.length;
    assert.equal(c.n, n2, `the count beside ${c.value} equals its rows`);
  }
  const agentsFacet = facet("agent", rows, searched, EMPTY_QUERY, ctx, lists);
  assert.deepEqual(agentsFacet.map((a) => a.label), ["Ann Agent", "Ben Agent"]);
});

test("saved views: each is a preset over a clear query, recognised back, with its count", () => {
  const q = { ...EMPTY_QUERY, q: "a" };
  assert.equal(viewOf(EMPTY_QUERY), "all");
  assert.equal(viewOf(viewQuery("issued", q)), "issued");
  assert.equal(viewOf(viewQuery("attention", q)), "attention");
  assert.equal(viewOf({ ...EMPTY_QUERY, status: ["Issued", "Approved"] }), null);
  assert.equal(viewQuery("effective", q).q, "a", "the search stays");
  const counts = viewCounts(rows, EMPTY_QUERY, ctx);
  assert.deepEqual(counts, { all: 5, attention: 0, effective: 1, issued: 1, nonum: 3 });
});

test("the CSV: the visible columns, quoted, formula-safe, the Agent column only on a team's list", () => {
  const evil = row({ clientFirst: "=HYPERLINK(\"x\")", clientLast: "Doe", clientPhone: "+1 248", policyNumber: "@SUM" });
  const csv = policiesCsv([rows[0], rows[4], evil], { withAgent: false });
  const lines = csv.trimEnd().split("\r\n");
  assert.equal(lines.length, 4);
  assert.ok(lines[0].startsWith('"Client","Client email","Client phone","Carrier"'), "no Agent column on your own list");
  assert.ok(lines[1].startsWith('"Mary Johnson","mary.johnson@example.com","(248) 555-0123","Americo","WL/FEX",94.58,1134.96,1,10000.00,"Submitted","2026-11-10"'));
  assert.ok(lines[2].startsWith(`"${IMPORT_LABEL}","","","","",,3000.00,3,`), "an import: its label and policy count, no client");
  assert.ok(lines[3].includes(`"'=HYPERLINK(""x"") Doe"`) && lines[3].includes(`"'+1 248"`) && lines[3].includes(`"'@SUM"`));
  assert.ok(policiesCsv(rows, { withAgent: true }).startsWith('"Client","Client email","Client phone","Agent",'));
});
