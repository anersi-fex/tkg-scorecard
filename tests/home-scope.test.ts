import { test } from "node:test";
import assert from "node:assert/strict";
import { aroundYou, comingUp, homeBoard, homeTeams, officeGroups, pickHomeScope, pipelineOf, scopeDaily, scopeSummary, teamGoalOf, type HomePerson, type HomeSale } from "../src/lib/home-scope";
import { monthClock } from "../src/lib/month";

const MONTH = "2026-11";
const TODAY = "2026-11-12";

const person = (id: string, name: string, inOffice = false, active = true): HomePerson => ({ id, name, active, inOffice });
const people: HomePerson[] = [
  person("ana", "Ana Pruitt", true),
  person("bo", "Bo Castellan"),
  person("cy", "Cy Navarro", true),
  person("dee", "Dee Whitlock"),
  person("eli", "Eli Fontaine"),
  person("off", "Off Board", false, false),
];
const sale = (agentId: string, dollars: number, soldOn: string, policies = 1): HomeSale => ({ agentId, premiumCents: dollars * 100, policies, soldOn });
const sales: HomeSale[] = [
  sale("ana", 1000, "2026-11-03"),
  sale("ana", 500, "2026-11-12"),
  sale("bo", 1200, "2026-11-05"),
  sale("cy", 900, "2026-11-11"),
  sale("cy", 900, "2026-11-12"),
  sale("dee", 300, "2026-11-12"),
  sale("off", 400, "2026-11-04"),
  sale("eli", 999, "2026-10-30"),
];

test("the board ranks sellers by production, then the rest by name, with places since yesterday", () => {
  const b = homeBoard({ people, sales, month: MONTH, today: TODAY });
  assert.deepEqual(
    b.rows.map((r) => [r.id, r.rank, r.change]),
    [
      ["cy", 1, 2],
      ["ana", 2, 0],
      ["bo", 3, -2],
      ["off", 4, 0],
      ["dee", 5, null],
      ["eli", null, undefined],
    ],
  );
  assert.equal(b.sellers, 5);
  assert.equal(b.people, 6);
  assert.equal(b.totalCents, 520_000);
  assert.equal(b.rows[0].share, 1);
  assert.equal(b.rows[0].todayCents, 90_000);
});

test("a team's board holds only its people, and the month's first day shows no arrows", () => {
  const b = homeBoard({ people, sales, month: MONTH, today: "2026-11-01", ids: new Set(["ana", "bo"]) });
  assert.deepEqual(
    b.rows.map((r) => r.id),
    ["ana", "bo"],
  );
  assert.ok(b.rows.every((r) => !r.sold));
  const b2 = homeBoard({ people, sales: [sale("ana", 10, "2026-11-01")], month: MONTH, today: "2026-11-01", ids: new Set(["ana", "bo"]) });
  assert.equal(b2.rows[0].change, 0);
});

test("the office group comes first, each group ranked among itself", () => {
  const g = officeGroups(homeBoard({ people, sales, month: MONTH, today: TODAY }));
  assert.equal(g.split, true);
  assert.deepEqual(
    g.office.map((r) => [r.id, r.groupRank]),
    [
      ["cy", 1],
      ["ana", 2],
    ],
  );
  assert.deepEqual(
    g.others.map((r) => [r.id, r.groupRank]),
    [
      ["bo", 1],
      ["off", 2],
      ["dee", 3],
      ["eli", null],
    ],
  );
  const flat = officeGroups(homeBoard({ people: people.map((p) => ({ ...p, inOffice: false })), sales, month: MONTH, today: TODAY }));
  assert.equal(flat.split, false);
  assert.equal(flat.all[0].groupRank, 1);
});

test("around you keeps the person in the middle of seven rows, inside the list", () => {
  const rows = Array.from({ length: 20 }, (_, i) => ({ id: `p${i}` }));
  assert.deepEqual(
    aroundYou(rows, "p10").map((r) => r.id),
    ["p7", "p8", "p9", "p10", "p11", "p12", "p13"],
  );
  assert.deepEqual(
    aroundYou(rows, "p0").map((r) => r.id)[0],
    "p0",
  );
  assert.equal(aroundYou(rows, "p19").at(-1)?.id, "p19");
  assert.equal(aroundYou(rows.slice(0, 3), "p1").length, 3);
});

test("a scope's summary: production, policies, average, today and the pace", () => {
  const clock = monthClock(MONTH, TODAY);
  const s = scopeSummary({ sales: sales.filter((x) => x.agentId === "ana"), month: MONTH, today: TODAY, goalCents: 1_000_000, clock });
  assert.equal(s.cents, 150_000);
  assert.equal(s.count, 2);
  assert.equal(s.avgCents, 75_000);
  assert.equal(s.todayCents, 50_000);
  assert.equal(s.todayCount, 1);
  assert.equal(s.pct, 15);
  // 9 business days through Nov 12, 21 in November
  assert.equal(s.pace.projectedCents, Math.round((150_000 / clock.elapsed) * clock.businessDays));
  const none = scopeSummary({ sales: [], month: MONTH, today: TODAY, goalCents: 0, clock });
  assert.equal(none.avgCents, 0);
  assert.equal(none.pace.status, "none");
});

test("a team's goal: the agency's for everyone, the people's added up once each has one, else none", () => {
  const goals = { ana: 100_000, bo: 200_000 };
  assert.equal(teamGoalOf({ people, ids: new Set(["ana", "bo"]), agencyGoalCents: 9, goals }).cents, 300_000);
  const partial = teamGoalOf({ people, ids: new Set(["ana", "cy"]), agencyGoalCents: 9, goals });
  assert.deepEqual([partial.cents, partial.withGoal, partial.people], [0, 1, 2]);
  assert.equal(teamGoalOf({ people, ids: new Set(["ana", "bo", "cy", "dee", "eli"]), agencyGoalCents: 9, goals }).cents, 9);
});

test("the chart's running total for one scope", () => {
  const days = ["2026-11-02", "2026-11-03", "2026-11-04"].map((date, i) => ({ date, cents: 7, policies: 7, cumulativeCents: 7, lifeCents: 7, lifeCumulativeCents: 7, reached: i < 2, business: true }));
  const out = scopeDaily(days, [sale("ana", 1, "2026-11-02"), sale("ana", 2, "2026-11-03"), sale("ana", 4, "2026-11-04")]);
  assert.deepEqual(
    out.map((d) => d.cumulativeCents),
    [100, 300, 300],
  );
  assert.equal(out[1].lifeCents, 200);
});

test("teams rank by their people's production, with places since yesterday", () => {
  const board = homeBoard({ people, sales, month: MONTH, today: TODAY });
  const t = homeTeams({
    board,
    month: MONTH,
    today: TODAY,
    teams: [
      { leaderId: "ana", name: "Ana's team", ids: ["ana", "bo"], members: 2 },
      { leaderId: "cy", name: "Cy's team", ids: ["cy", "dee"], members: 2 },
      { leaderId: "eli", name: "Eli's team", ids: ["eli"], members: 1 },
    ],
  });
  assert.deepEqual(
    t.map((x) => [x.leaderId, x.rank, x.cents, x.change, x.sellers]),
    [
      ["ana", 1, 270_000, 0, 2],
      ["cy", 2, 210_000, 0, 2],
    ],
  );
});

test("the pipeline counts this month's policies by status, with their premium", () => {
  const p = pipelineOf(
    [
      { status: "Submitted", premiumCents: 100, soldOn: "2026-11-02" },
      { status: "Submitted", premiumCents: 50, soldOn: "2026-11-03" },
      { status: "Issued", premiumCents: 70, soldOn: "2026-11-03" },
      { status: null, premiumCents: 70, soldOn: "2026-11-03" },
      { status: "Issued", premiumCents: 70, soldOn: "2026-10-03" },
    ],
    MONTH,
  );
  assert.equal(p.total, 4);
  assert.deepEqual(p.rows.find((r) => r.status === "Submitted"), { status: "Submitted", count: 2, cents: 150 });
  assert.deepEqual(p.rows.find((r) => r.status === "Issued"), { status: "Issued", count: 1, cents: 70 });
  assert.equal(p.rows.length, 6);
});

test("coming up: long underwriting first, then what takes effect this week", () => {
  const rows = [
    { id: "a", status: "Approved", effectiveDate: "2026-11-15", soldOn: "2026-11-02" },
    { id: "b", status: "Underwriting", effectiveDate: null, soldOn: "2026-11-02" },
    { id: "c", status: "Underwriting", effectiveDate: null, soldOn: "2026-11-10" },
    { id: "d", status: "Declined", effectiveDate: "2026-11-13", soldOn: "2026-11-02" },
    { id: "e", status: "Submitted", effectiveDate: "2026-11-12", soldOn: "2026-11-02" },
    { id: "f", status: "Issued", effectiveDate: "2026-12-01", soldOn: "2026-11-02" },
  ];
  assert.deepEqual(
    comingUp(rows, TODAY).map((c) => [c.policy.id, c.kind, c.days]),
    [
      ["b", "underwriting", 10],
      ["e", "effective", 0],
      ["a", "effective", 3],
    ],
  );
});

test("the scope from the address: an admin may pick any team, a person their own", () => {
  const scopes = [{ id: "me" as const }, { id: "team" as const, leaderId: "ana" }, { id: "agency" as const }];
  assert.deepEqual(pickHomeScope({ asked: "nope", askedTeam: null, scopes, pickAnyTeam: false, leaders: ["ana", "cy"] }), { id: "me", leaderId: null });
  assert.deepEqual(pickHomeScope({ asked: "team", askedTeam: "cy", scopes, pickAnyTeam: false, leaders: ["ana", "cy"] }), { id: "team", leaderId: "ana" });
  assert.deepEqual(pickHomeScope({ asked: "team", askedTeam: "cy", scopes, pickAnyTeam: true, leaders: ["ana", "cy"] }), { id: "team", leaderId: "cy" });
  assert.deepEqual(pickHomeScope({ asked: "team", askedTeam: null, scopes: [{ id: "agency" }], pickAnyTeam: false, leaders: [] }), { id: "agency", leaderId: null });
});

test("the best day and the range label", async () => {
  const { bestDayOf, rangeLabel } = await import("../src/lib/home-scope");
  assert.deepEqual(bestDayOf([sale("ana", 5, "2026-11-03"), sale("bo", 5, "2026-11-02"), sale("ana", 3, "2026-11-04"), sale("bo", 2, "2026-11-04")]), { date: "2026-11-02", cents: 500 });
  assert.equal(bestDayOf([]), null);
  assert.equal(rangeLabel("2026-11", "2026-11-12"), "Nov 1 – 12");
  assert.equal(rangeLabel("2026-10", "2026-11-12"), "Oct 1 – 31");
  assert.equal(rangeLabel("2026-11", "2026-11-01"), "Nov 1");
});
