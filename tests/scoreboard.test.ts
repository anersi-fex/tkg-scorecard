import { test } from "node:test";
import assert from "node:assert/strict";
import { buildScoreboard, compareRange, rangeLabel, scoreboardCsv, standOf } from "../src/lib/scoreboard";
import type { ScoreSale } from "../src/lib/scoreboard-types";
import type { Agent } from "../src/lib/types";

/**
 * The agency's board as the owner's CRM showed it on Nov 11, 2026 (25 agents; the numbers are
 * the real ones, the names are invented): [name, policies, { day of November: dollars }].
 */
const BOARD: Array<[string, number, Record<number, number>]> = [
  ["Jonah Garrick", 11, { 3: 552, 4: 4176, 5: 840, 9: 3762, 10: 4656, 11: 1428 }],
  ["Mila Serrano", 9, { 2: 1535, 3: 607, 5: 1783, 9: 4256, 10: 994, 11: 912 }],
  ["Jeremy Molina", 7, { 2: 2880, 3: 828, 4: 583, 5: 645, 6: 2177, 10: 420 }],
  ["Aden Hale", 5, { 3: 2074, 6: 1488, 10: 2007, 11: 1524 }],
  ["Mara Holt", 6, { 5: 2477, 9: 1722, 10: 1397 }],
  ["Lucas Trent", 5, { 2: 4578, 10: 447 }],
  ["Brody Chastain", 5, { 5: 974, 9: 838, 10: 917, 11: 2136 }],
  ["Wilson Mora", 5, { 3: 437, 4: 536, 6: 838, 7: 581, 10: 946 }],
  ["Ramon Lowell", 2, { 2: 1464, 10: 1815 }],
  ["Chase Hubbard", 3, { 5: 2532, 6: 660 }],
  ["Dario Reyes", 3, { 6: 2112, 9: 1044 }],
  ["Dante Calloway", 5, { 3: 588, 5: 1253, 6: 583, 9: 570 }],
  ["Mateo Clay", 3, { 2: 749, 5: 1351, 11: 444 }],
  ["Tobin Tamsin", 3, { 3: 1244, 11: 1223 }],
  ["Nico Lund", 3, { 2: 1264, 3: 601, 5: 591 }],
  ["Kieran Gable", 3, { 4: 687, 6: 887, 11: 529 }],
  ["Ira Hollis", 1, { 10: 1758 }],
  ["Jude Freeland", 2, { 5: 963, 11: 736 }],
  ["Vito Marchetti", 2, { 3: 1044, 11: 654 }],
  ["Jasper Newell", 2, { 2: 775, 5: 450 }],
  ["Tyler Goddard", 2, { 3: 687, 7: 469 }],
  ["Julian Kemble", 2, { 3: 1135 }],
  ["Devon O'Hara", 2, { 3: 564, 11: 393 }],
  ["Auggie Bianchi", 1, { 2: 444 }],
  ["Rafe Griffith", 1, { 10: 418 }],
];
/** Who is under whom (by name); the first agent is at the top. */
const UPLINE: Record<string, string> = {
  "Mila Serrano": "Jonah Garrick",
  "Jeremy Molina": "Jonah Garrick",
  "Aden Hale": "Jonah Garrick",
  "Mara Holt": "Mila Serrano",
  "Brody Chastain": "Mila Serrano",
  "Ramon Lowell": "Mila Serrano",
  "Vito Marchetti": "Mara Holt",
  "Tyler Goddard": "Mara Holt",
  "Lucas Trent": "Jeremy Molina",
  "Wilson Mora": "Jeremy Molina",
  "Julian Kemble": "Lucas Trent",
  "Rafe Griffith": "Lucas Trent",
  "Dario Reyes": "Aden Hale",
  "Mateo Clay": "Aden Hale",
};
const idOf = (name: string) => name.toLowerCase().replace(/[^a-z]+/g, "-");
const REMOTE = new Set(["Rafe Griffith", "Auggie Bianchi", "Julian Kemble"]);
const agents: Agent[] = BOARD.map(([name], i) => ({ id: idOf(name), name, active: true, sort: i + 1, pc_licensed: false, upline_id: UPLINE[name] ? idOf(UPLINE[name]) : null, in_office: !REMOTE.has(name), role: "member" }));

const CARRIERS = ["AHL", "AmAm", "Americo"];
const PRODUCTS = ["Term", "Whole life", "Final expense"];
const day = (month: string, d: number) => `${month}-${String(d).padStart(2, "0")}`;
/** One sale per selling day; the first day carries the policies the other days do not account for. */
function salesOf(month = "2026-11"): ScoreSale[] {
  const out: ScoreSale[] = [];
  BOARD.forEach(([name, policies, days], i) => {
    const list = Object.keys(days).map(Number);
    list.forEach((d, k) => out.push({ agent_id: idOf(name), premium_cents: days[d] * 100, policies: k === 0 ? policies - (list.length - 1) : 1, product: PRODUCTS[(i + k) % 3], carrier: CARRIERS[(i + d) % 3], sold_on: day(month, d) }));
  });
  return out;
}
const sale = (name: string, soldOn: string, dollars: number, extra: Partial<ScoreSale> = {}): ScoreSale => ({ agent_id: idOf(name), premium_cents: dollars * 100, policies: 1, product: "Term", carrier: "AHL", sold_on: soldOn, ...extra });
const nov11 = (extra: Partial<Parameters<typeof buildScoreboard>[0]> = {}) => buildScoreboard({ agents, sales: salesOf(), from: "2026-11-01", to: "2026-11-11", today: "2026-11-11", agencyName: "Lineage Financial", generatedAt: "t", ...extra });

test("Nov 1 – 11 as the owner's screenshots show it: the three top numbers", () => {
  const sb = nov11();
  assert.equal(sb.scope, "agency");
  assert.equal(sb.scopeName, "Lineage Financial");
  assert.equal(sb.range.label, "Nov 1 – 11");
  assert.equal(sb.range.days.length, 11);
  assert.equal(sb.range.days[0], "2026-11-01");
  assert.equal(sb.range.days[10], "2026-11-11");
  assert.equal(sb.compare.label, "Oct 1 – 11");
  assert.deepEqual([sb.compare.from, sb.compare.to], ["2026-10-01", "2026-10-11"]);
  assert.equal(sb.kpis.productionCents, 91_632 * 100);
  assert.equal(sb.kpis.policies, 93);
  assert.equal(sb.kpis.activeAgents, 25);
  assert.deepEqual([sb.kpis.prevProductionCents, sb.kpis.prevPolicies, sb.kpis.prevActiveAgents], [0, 0, 0]);
  // The CRM's team row: Nov 2 $13,689, Nov 3 $10,360, Nov 4 $5,982, Nov 5 $13,860 (it rounds each
  // cell from cents; the fixture holds whole dollars, so two days sit a dollar away).
  assert.deepEqual(sb.kpis.dailyCents.slice(0, 5), [0, 13_689, 10_361, 5_982, 13_859].map((d) => d * 100));
  assert.equal(sb.kpis.dailyCents.reduce((a, b) => a + b, 0), sb.kpis.productionCents);
  assert.equal(sb.kpis.dailyActiveAgents[0], 0);
  assert.equal(sb.kpis.dailyActiveAgents[1], 8); // eight agents sold on Nov 2
});

test("where agents stand: the middle agent at $2,544 and the ranges 9 / 9 / 3 / 2 / 2", () => {
  const { stand } = nov11();
  assert.equal(stand.agents, 25);
  assert.equal(stand.medianCents, 2_544 * 100);
  assert.deepEqual(stand.buckets, [
    { label: "Under $2K", count: 9 },
    { label: "$2K–$4K", count: 9 },
    { label: "$4K–$6K", count: 3 },
    { label: "$6K–$8K", count: 2 },
    { label: "$8K+", count: 2 },
  ]);
});

test("the ranges' step is the smallest nice one whose four steps reach the 90th percentile", () => {
  const labels = (dollars: number[]) => standOf(dollars.map((d) => d * 100)).buckets.map((b) => b.label);
  assert.deepEqual(labels([100, 300, 900, 1_900]), ["Under $500", "$500–$1K", "$1K–$1.5K", "$1.5K–$2K", "$2K+"]);
  assert.deepEqual(labels([9_000, 9_500]), ["Under $2.5K", "$2.5K–$5K", "$5K–$7.5K", "$7.5K–$10K", "$10K+"]);
  assert.deepEqual(labels([150_000, 390_000]), ["Under $100K", "$100K–$200K", "$200K–$300K", "$300K–$400K", "$400K+"]);
  assert.deepEqual(labels([3_000_000]), ["Under $1M", "$1M–$2M", "$2M–$3M", "$3M–$4M", "$4M+"]);
  // An even count: the lower of the two middle agents, a real person's number.
  assert.equal(standOf([100, 200, 300, 400]).medianCents, 200);
  assert.equal(standOf([700]).medianCents, 700);
  // A total right on an edge belongs to the range that starts there.
  assert.deepEqual(standOf([2_000 * 100, 7_999 * 100, 8_000 * 100]).buckets.map((b) => b.count), [0, 1, 0, 1, 1]);
  // Nobody sold: five empty ranges, no middle.
  assert.deepEqual(standOf([]), { agents: 0, medianCents: 0, buckets: ["Under $2K", "$2K–$4K", "$4K–$6K", "$6K–$8K", "$8K+"].map((label) => ({ label, count: 0 })) });
});

test("the leaderboard: ranks, totals, policies and the places gained or lost since yesterday", () => {
  const { rows } = nov11();
  assert.equal(rows.length, 25);
  assert.deepEqual(
    rows.slice(0, 3).map((r) => [r.rank, r.name, r.policies, r.totalCents / 100, r.rankChange]),
    [
      [1, "Jonah Garrick", 11, 15_414, 0],
      [2, "Mila Serrano", 9, 10_087, 0], // $10,088 on the CRM, which adds cents the fixture does not hold
      [3, "Jeremy Molina", 7, 7_533, 0],
    ],
  );
  // The CRM's arrows on Nov 11, rank by rank.
  assert.deepEqual(
    rows.map((r) => r.rankChange),
    [0, 0, 0, 1, -1, 0, 5, -1, -1, -1, -1, -1, 1, 3, -2, 0, -2, 4, 2, -2, -2, -2, 0, 0, 0],
  );
  assert.deepEqual(rows.map((r) => r.rank), Array.from({ length: 25 }, (_, i) => i + 1));
  const jonah = rows[0];
  assert.deepEqual(jonah.byDay, { "2026-11-03": 55_200, "2026-11-04": 417_600, "2026-11-05": 84_000, "2026-11-09": 376_200, "2026-11-10": 465_600, "2026-11-11": 142_800 });
  assert.equal(Object.values(jonah.byProduct).reduce((a, b) => a + b, 0), jonah.totalCents);
  assert.equal(Object.values(jonah.byCarrier).reduce((a, b) => a + b, 0), jonah.totalCents);
  assert.equal(jonah.uplineName, null);
  assert.equal(rows[1].uplineName, "Jonah Garrick");
  assert.equal(rows[1].uplineId, idOf("Jonah Garrick"));
  assert.equal(rows[24].inOffice, false);
  assert.ok(rows.every((r) => r.tone.length > 0));
});

test("ties rank by policies, then by name; someone new today has no arrow", () => {
  const people: Agent[] = ["Zed Abel", "Amy Zorn", "Bea Young", "New Today"].map((name, i) => ({ id: idOf(name), name, active: true, sort: i, pc_licensed: false }));
  const sb = buildScoreboard({
    agents: people,
    sales: [sale("Zed Abel", "2026-11-03", 1_000), sale("Amy Zorn", "2026-11-03", 1_000), sale("Bea Young", "2026-11-04", 1_000, { policies: 2 }), sale("New Today", "2026-11-05", 5_000)],
    from: "2026-11-01",
    to: "2026-11-05",
    today: "2026-11-05",
    agencyName: "A",
  });
  assert.deepEqual(sb.rows.map((r) => [r.name, r.rankChange]), [["New Today", null], ["Bea Young", -1], ["Amy Zorn", -1], ["Zed Abel", -1]]);
});

test("moved most this week: the last 7 days against the 7 days before, three up and three down", () => {
  const { movers } = nov11();
  assert.equal(movers.label, "Last 7 days vs the 7 days before");
  // Nov 5 – 11 against Oct 29 – Nov 4 (no October sales in this fixture).
  assert.deepEqual(movers.up.map((m) => [m.name, m.nowCents / 100, m.wasCents / 100, m.deltaCents / 100]), [
    ["Jonah Garrick", 10_686, 4_728, 5_958],
    ["Mila Serrano", 7_945, 2_142, 5_803],
    ["Mara Holt", 5_596, 0, 5_596],
  ]);
  // The CRM's "Slipping" leader: $447, was $4,578, −$4,131.
  assert.deepEqual([movers.down[0].name, movers.down[0].nowCents / 100, movers.down[0].wasCents / 100, movers.down[0].deltaCents / 100], ["Lucas Trent", 447, 4_578, -4_131]);
  assert.equal(movers.down.length, 3);
  assert.ok(movers.down.every((m) => m.deltaCents < 0) && movers.up.every((m) => m.deltaCents > 0));
  assert.ok(movers.down[0].deltaCents <= movers.down[1].deltaCents && movers.down[1].deltaCents <= movers.down[2].deltaCents);
  const both = new Set([...movers.up, ...movers.down].map((m) => m.agentId));
  assert.equal(both.size, 6);
});

test("moved most reaches into the month before, and leaves out anyone who did not move", () => {
  const sb = buildScoreboard({
    agents,
    sales: [
      sale("Jonah Garrick", "2026-10-28", 3_000), // the 7 days before: Oct 22 – 28
      sale("Jonah Garrick", "2026-11-02", 1_000), // the last 7 days: Oct 29 – Nov 4
      sale("Mila Serrano", "2026-10-27", 500),
      sale("Mila Serrano", "2026-11-01", 500), // the same both weeks: not a move
      sale("Aden Hale", "2026-10-21", 9_000), // too old to count
      sale("Aden Hale", "2026-11-04", 250),
    ],
    from: "2026-11-01",
    to: "2026-11-04",
    today: "2026-11-04",
    agencyName: "A",
  });
  assert.deepEqual(sb.movers.up.map((m) => [m.name, m.deltaCents]), [["Aden Hale", 25_000]]);
  assert.deepEqual(sb.movers.down.map((m) => [m.name, m.nowCents, m.wasCents, m.deltaCents]), [["Jonah Garrick", 100_000, 300_000, -200_000]]);
});

test("the comparison: the same day numbers of the month before", () => {
  const october = salesOf("2026-10").filter((s) => s.sold_on <= "2026-10-11");
  const sb = nov11({ sales: [...october, ...salesOf()] });
  assert.equal(sb.kpis.prevProductionCents, sb.kpis.productionCents);
  assert.equal(sb.kpis.prevPolicies, 93);
  assert.equal(sb.kpis.prevActiveAgents, 25);
  // A sale on Oct 12 is past the compared days.
  const later = nov11({ sales: [sale("Ira Hollis", "2026-10-12", 9_999), ...salesOf()] });
  assert.equal(later.kpis.prevProductionCents, 0);
  // October's sales never land in November's rows.
  assert.equal(sb.rows[0].totalCents, 15_414 * 100);
});

test("a 31-day month compares with the 30 days before it; March with February", () => {
  assert.deepEqual(compareRange("2026-10-01", "2026-10-31"), { from: "2026-09-01", to: "2026-09-30", label: "Sep 1 – 30" });
  assert.deepEqual(compareRange("2026-03-01", "2026-03-31"), { from: "2026-02-01", to: "2026-02-28", label: "Feb 1 – 28" });
  assert.deepEqual(compareRange("2028-03-01", "2028-03-30"), { from: "2028-02-01", to: "2028-02-29", label: "Feb 1 – 29" });
  assert.deepEqual(compareRange("2026-01-01", "2026-01-09"), { from: "2025-12-01", to: "2025-12-09", label: "Dec 1 – 9" });
  assert.equal(rangeLabel("2026-11-01", "2026-11-01"), "Nov 1");
  assert.equal(rangeLabel("2026-11-01", "2026-11-30"), "Nov 1 – 30");
  const sb = buildScoreboard({
    agents,
    sales: [sale("Jonah Garrick", "2026-09-30", 700), sale("Jonah Garrick", "2026-10-31", 900)],
    from: "2026-10-01",
    to: "2026-10-31",
    today: "2026-11-12",
    agencyName: "A",
  });
  assert.equal(sb.range.label, "Oct 1 – 31");
  assert.equal(sb.range.days.length, 31);
  assert.equal(sb.compare.label, "Sep 1 – 30");
  assert.deepEqual([sb.kpis.productionCents, sb.kpis.prevProductionCents], [90_000, 70_000]);
});

test("a month that is over: no arrows move, and the week is the month's last one", () => {
  const sb = buildScoreboard({ agents, sales: [...salesOf("2026-10")], from: "2026-10-01", to: "2026-10-31", today: "2026-11-12", agencyName: "A" });
  assert.equal(sb.rows.length, 25);
  assert.ok(sb.rows.every((r) => r.rankChange === 0));
  assert.ok(sb.teams.every((t) => t.rankChange === 0));
  assert.equal(sb.movers.label, "Oct 25 – 31 vs Oct 18 – 24");
});

test("the first day of a month: everyone reads no change, the range is one day", () => {
  const sb = buildScoreboard({
    agents,
    sales: [sale("Mila Serrano", "2026-10-01", 400), sale("Mila Serrano", "2026-10-31", 2_000), sale("Jonah Garrick", "2026-11-01", 1_200), sale("Mila Serrano", "2026-11-01", 800)],
    from: "2026-11-01",
    to: "2026-11-01",
    today: "2026-11-01",
    agencyName: "A",
  });
  assert.equal(sb.range.label, "Nov 1");
  assert.deepEqual(sb.range.days, ["2026-11-01"]);
  assert.equal(sb.compare.label, "Oct 1");
  assert.equal(sb.kpis.prevProductionCents, 40_000);
  assert.deepEqual(sb.rows.map((r) => [r.name, r.rank, r.rankChange]), [["Jonah Garrick", 1, 0], ["Mila Serrano", 2, 0]]);
  assert.ok(sb.teams.every((t) => t.rankChange === 0));
  // Oct 26 – Nov 1 against Oct 19 – 25.
  assert.deepEqual(sb.movers.up.map((m) => [m.name, m.deltaCents]), [["Mila Serrano", 280_000], ["Jonah Garrick", 120_000]]);
});

test("an empty month", () => {
  const sb = buildScoreboard({ agents, sales: [], from: "2026-11-01", to: "2026-11-11", today: "2026-11-11", agencyName: "Lineage Financial" });
  assert.deepEqual([sb.kpis.productionCents, sb.kpis.policies, sb.kpis.activeAgents], [0, 0, 0]);
  assert.deepEqual(sb.kpis.dailyCents, Array(11).fill(0));
  assert.deepEqual(sb.kpis.dailyActiveAgents, Array(11).fill(0));
  assert.deepEqual([sb.rows, sb.teams, sb.movers.up, sb.movers.down, sb.products, sb.carriers], [[], [], [], [], [], []]);
  assert.equal(sb.stand.agents, 0);
  assert.equal(sb.stand.buckets.length, 5);
  // Nobody on the list at all.
  const none = buildScoreboard({ agents: [], sales: [], from: "2026-11-01", to: "2026-11-11", today: "2026-11-11", agencyName: "A" });
  assert.equal(none.rows.length, 0);
});

test("teams: each leader with everyone below, all levels, added up and ranked", () => {
  const sb = nov11();
  // Six leaders in the tree; the top one's team is the whole tree under them.
  assert.deepEqual(sb.teams.map((t) => t.name), ["Jonah Garrick", "Mila Serrano", "Jeremy Molina", "Aden Hale", "Mara Holt", "Lucas Trent"]);
  const top = sb.teams[0];
  const tree = ["Jonah Garrick", ...Object.keys(UPLINE)];
  assert.equal(top.members, tree.length);
  assert.equal(top.activeAgents, tree.length);
  const sumOf = (names: string[]) => names.reduce((n, name) => n + Object.values(BOARD.find((b) => b[0] === name)![2]).reduce((a, b) => a + b, 0), 0) * 100;
  assert.equal(top.totalCents, sumOf(tree));
  const mila = sb.teams[1];
  const milaTeam = ["Mila Serrano", "Mara Holt", "Brody Chastain", "Ramon Lowell", "Vito Marchetti", "Tyler Goddard"];
  assert.equal(mila.totalCents, sumOf(milaTeam));
  assert.equal(mila.policies, 9 + 6 + 5 + 2 + 2 + 2);
  assert.equal(mila.members, 6);
  // The team's people who sold, most production first.
  assert.deepEqual(mila.memberIds, ["Mila Serrano", "Mara Holt", "Brody Chastain", "Ramon Lowell", "Vito Marchetti", "Tyler Goddard"].map(idOf));
  assert.equal(Object.values(mila.byDay).reduce((a, b) => a + b, 0), mila.totalCents);
  assert.equal(Object.values(mila.byProduct).reduce((a, b) => a + b, 0), mila.totalCents);
  assert.equal(Object.values(mila.byCarrier).reduce((a, b) => a + b, 0), mila.totalCents);
  assert.deepEqual(sb.teams.map((t) => t.rank), [1, 2, 3, 4, 5, 6]);
  assert.ok(sb.teams.every((t) => typeof t.rankChange === "number"));
  // The columns for the category view: most production first, every dollar accounted for.
  assert.equal(sb.products.length, 3);
  assert.equal(sb.carriers.length, 3);
});

test("a team scope narrows everything to the leader and all levels below", () => {
  const sb = nov11({ leaderId: idOf("Mila Serrano") });
  assert.equal(sb.scope, "team");
  assert.equal(sb.scopeLeaderId, idOf("Mila Serrano"));
  assert.equal(sb.scopeName, "Mila Serrano's team");
  assert.deepEqual(sb.rows.map((r) => r.name), ["Mila Serrano", "Mara Holt", "Brody Chastain", "Ramon Lowell", "Vito Marchetti", "Tyler Goddard"]);
  assert.deepEqual(sb.rows.map((r) => r.rank), [1, 2, 3, 4, 5, 6]);
  assert.equal(sb.kpis.activeAgents, 6);
  assert.equal(sb.kpis.policies, 26);
  assert.equal(sb.kpis.productionCents, sb.rows.reduce((n, r) => n + r.totalCents, 0));
  assert.equal(sb.stand.agents, 6);
  // The teams inside it: the leader's own, and the one a level down.
  assert.deepEqual(sb.teams.map((t) => t.name), ["Mila Serrano", "Mara Holt"]);
  assert.ok([...sb.movers.up, ...sb.movers.down].every((m) => sb.rows.some((r) => r.agentId === m.agentId)));
  // A leader id nobody has: an empty board, not everyone's.
  const nobody = nov11({ leaderId: "ghost" });
  assert.equal(nobody.rows.length, 0);
  assert.equal(nobody.kpis.productionCents, 0);
});

test("someone off the board: not one of the team's people, but their sales still count for it", () => {
  const people = agents.map((a) => (a.name === "Tyler Goddard" ? { ...a, active: false } : a));
  const sb = nov11({ agents: people, leaderId: idOf("Mara Holt") });
  const team = sb.teams[0];
  assert.equal(team.members, 2); // Mara and Vito
  assert.equal(team.activeAgents, 3); // all three sold
  assert.equal(team.totalCents, (5_596 + 1_698 + 1_156) * 100);
  assert.ok(sb.rows.some((r) => r.name === "Tyler Goddard"));
});

test("nothing private rides along: only the fields the screens need", () => {
  const people = agents.map((a) => ({ ...a, phone: "+15550001111", pass_hash: "scrypt$secret" }) as Agent);
  const text = JSON.stringify(nov11({ agents: people }));
  assert.ok(!text.includes("5550001111"));
  assert.ok(!text.includes("scrypt"));
  assert.ok(!text.includes("pass_hash") && !text.includes("phone"));
});

test("the CSV: a header row, one row per agent, plain dollars, quoted text, never a formula", () => {
  const people: Agent[] = [
    { id: "a", name: 'Ann "Ace" Li, Jr.', active: true, sort: 1, pc_licensed: false, in_office: true },
    { id: "b", name: "=HYPERLINK(1)", active: true, sort: 2, pc_licensed: false, upline_id: "a" },
    { id: "c", name: "@cmd", active: true, sort: 3, pc_licensed: false, upline_id: "a" },
  ];
  const sb = buildScoreboard({
    agents: people,
    sales: [sale("x", "2026-11-01", 0, { agent_id: "a", premium_cents: 123_450, product: "+Plus", carrier: "AHL" }), sale("x", "2026-11-02", 0, { agent_id: "b", premium_cents: 50_005, product: "Term", carrier: "-Dash" }), sale("x", "2026-11-02", 0, { agent_id: "c", premium_cents: 100, product: null, carrier: null })],
    from: "2026-11-01",
    to: "2026-11-02",
    today: "2026-11-02",
    agencyName: "A",
  });
  const lines = scoreboardCsv(sb, "agents", "dates").split("\r\n");
  assert.equal(lines[0], '"Rank","Name","Upline","In office","Policies","Nov 1","Nov 2","Total"');
  assert.equal(lines[1], '1,"Ann ""Ace"" Li, Jr.","","Yes",1,1234.50,0.00,1234.50');
  assert.equal(lines[2], `2,"'=HYPERLINK(1)","Ann ""Ace"" Li, Jr.","No",1,0.00,500.05,500.05`);
  assert.equal(lines[3], `3,"'@cmd","Ann ""Ace"" Li, Jr.","No",1,0.00,1.00,1.00`);
  assert.equal(lines[4], "");
  assert.equal(lines.length, 5);
  assert.equal(scoreboardCsv(sb, "agents", "product").split("\r\n")[0], `"Rank","Name","Upline","In office","Policies","'+Plus","Term","Other","Total"`);
  assert.equal(scoreboardCsv(sb, "agents", "carrier").split("\r\n")[0], `"Rank","Name","Upline","In office","Policies","AHL","'-Dash","Other","Total"`);
  const teams = scoreboardCsv(sb, "teams", "dates").split("\r\n");
  assert.equal(teams[0], '"Rank","Team","People","Agents who sold","Policies","Nov 1","Nov 2","Total"');
  assert.equal(teams[1], `1,"Ann ""Ace"" Li, Jr.'s team",3,3,3,1234.50,501.05,1735.55`);
  // Nothing sold: the header alone.
  const empty = buildScoreboard({ agents: people, sales: [], from: "2026-11-01", to: "2026-11-02", today: "2026-11-02", agencyName: "A" });
  assert.equal(scoreboardCsv(empty, "agents", "dates"), '"Rank","Name","Upline","In office","Policies","Nov 1","Nov 2","Total"\r\n');
});

test("70 people and two months of 3,000 sales build in a few milliseconds", () => {
  const people: Agent[] = Array.from({ length: 70 }, (_, i) => ({ id: `p${i}`, name: `Person ${String(i).padStart(2, "0")}`, active: true, sort: i, pc_licensed: false, upline_id: i === 0 ? null : `p${Math.floor((i - 1) / 4)}`, in_office: i < 27 }));
  const many: ScoreSale[] = [];
  for (let i = 0; i < 6_000; i++) many.push({ agent_id: `p${Math.floor(i / 2) % 70}`, premium_cents: 50_000 + ((i * 7919) % 400_000), policies: 1, product: PRODUCTS[i % 3], carrier: CARRIERS[i % 3], sold_on: day(i % 2 ? "2026-10" : "2026-11", 1 + ((i * 13) % 30)) });
  const run = () => buildScoreboard({ agents: people, sales: many, from: "2026-11-01", to: "2026-11-30", today: "2026-11-30", agencyName: "A" });
  run(); // warm up
  const t0 = performance.now();
  const rounds = 20;
  let sb = run();
  for (let i = 1; i < rounds; i++) sb = run();
  const each = (performance.now() - t0) / rounds;
  assert.equal(sb.kpis.policies, 3_000);
  assert.equal(sb.rows.length, 70);
  assert.equal(sb.teams[0].members, 70);
  console.log(`buildScoreboard: 70 people, 6,000 sales: ${each.toFixed(2)} ms each`);
  assert.ok(each < 50, `took ${each.toFixed(1)} ms`);
});
