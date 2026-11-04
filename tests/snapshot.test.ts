import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSnapshot } from "../src/lib/snapshot";
import type { SaleWithAgent } from "../src/lib/data";
import type { Agent } from "../src/lib/types";

const agents: Agent[] = [
  { id: "ak", name: "Anersi Koka", active: true, sort: 1, pc_licensed: true },
  { id: "aa", name: "Alex Alekseyev", active: true, sort: 2, pc_licensed: false },
  { id: "mk", name: "Moe Karim", active: true, sort: 3, pc_licensed: true },
  { id: "tk", name: "Tina Kehrig", active: true, sort: 4, pc_licensed: false },
];

let n = 0;
function sale(agent: Agent, soldOn: string, premium: number, extra: Partial<SaleWithAgent> = {}): SaleWithAgent {
  n++;
  return {
    id: `s${n}`,
    agent_id: agent.id,
    agent_name: agent.name,
    premium_cents: premium * 100,
    policies: 1,
    product: "Term",
    carrier: "AHL",
    kind: "life",
    client: null,
    note: null,
    sold_on: soldOn,
    logged_by: "team",
    created_at: `${soldOn}T${String(10 + (n % 10)).padStart(2, "0")}:00:00.000Z`,
    ...extra,
  };
}
const [ak, aa, mk, tk] = agents;

/** November 2026 seen from Wednesday the 18th: 13 of 21 business days have run (today counts). */
function snap(sales: SaleWithAgent[], goals: { teamCents: number; byAgent: Record<string, number>; pcTeamCents?: number; pcByAgent?: Record<string, number> } = { teamCents: 200_000 * 100, byAgent: { ak: 70_000 * 100, aa: 50_000 * 100, mk: 35_000 * 100 } }) {
  return buildSnapshot({ month: "2026-11", today: "2026-11-18", agents, sales, goals, recent: [...sales].reverse(), message: "" });
}

test("the goal, the pace and the rank count life; P&C has its own board; the total adds both up", () => {
  const sales = [
    sale(aa, "2026-11-10", 38_420, { policies: 26 }),
    sale(ak, "2026-11-12", 36_900, { policies: 24 }),
    sale(ak, "2026-11-17", 9_840, { kind: "pc", carrier: "HOAIC", product: "Home", policies: 14 }),
    sale(mk, "2026-11-16", 24_310, { policies: 15 }),
    sale(mk, "2026-11-18", 3_960, { kind: "pc", carrier: "Obie", product: "Dwelling", policies: 5 }),
    sale(tk, "2026-11-18", 1_000),
  ];
  const s = snap(sales);
  const life = 38_420 + 36_900 + 24_310 + 1_000;
  const pc = 9_840 + 3_960;
  assert.equal(s.team.lifeCents, life * 100);
  assert.equal(s.team.pcCents, pc * 100);
  assert.equal(s.team.productionCents, (life + pc) * 100);
  // Life against the goal; the total "with P&C added"
  assert.equal(s.team.goalPct, Math.round((life / 200_000) * 100));
  assert.equal(s.team.totalGoalPct, Math.round(((life + pc) / 200_000) * 100));
  const expected = Math.round(200_000 * 100 * (13 / 21));
  assert.equal(s.team.pace.aheadCents, life * 100 - expected);
  assert.equal(s.team.totalPace.aheadCents, (life + pc) * 100 - expected);
  // The main board is life: Alex leads; the total puts Anersi first
  assert.deepEqual(
    s.agents.map((a) => [a.name, a.rank, a.totalRank, a.pcRank]),
    [
      ["Alex Alekseyev", 1, 2, null],
      ["Anersi Koka", 2, 1, 1],
      ["Moe Karim", 3, 3, 2],
      ["Tina Kehrig", 4, 4, null],
    ],
  );
  const anersi = s.agents.find((a) => a.id === "ak")!;
  assert.equal(anersi.goalPct, Math.round((36_900 / 70_000) * 100));
  assert.equal(anersi.totalGoalPct, Math.round(((36_900 + 9_840) / 70_000) * 100));
  assert.deepEqual(anersi.pcLines, [{ name: "Home", policies: 14 }]);
  // Today: Moe's P&C and Tina's life
  assert.equal(s.team.todayCents, (3_960 + 1_000) * 100);
  assert.equal(s.team.todayLifeCents, 1_000 * 100);
  assert.equal(s.team.todayPcCents, 3_960 * 100);
  const moe = s.agents.find((a) => a.id === "mk")!;
  assert.deepEqual([moe.todayLifeCents, moe.todayPcCents], [0, 3_960 * 100]);
  // P&C by line and carrier, its share, and its own feed, newest first
  assert.deepEqual(
    s.team.pcByLine.map((l) => [l.name, l.policies]),
    [
      ["Home", 14],
      ["Dwelling", 5],
    ],
  );
  assert.deepEqual(
    s.team.pcByCarrier.map((c) => c.name),
    ["HOAIC", "Obie"],
  );
  assert.equal(s.team.pcSharePct, Math.round((pc / (life + pc)) * 100));
  assert.deepEqual(
    s.pcRecent.map((r) => r.premiumCents / 100),
    [3_960, 9_840],
  );
  // The life chart's running total skips P&C
  const day17 = s.daily.find((d) => d.date === "2026-11-17")!;
  assert.equal(day17.lifeCumulativeCents, (38_420 + 36_900 + 24_310) * 100);
  assert.equal(day17.cumulativeCents, (38_420 + 36_900 + 24_310 + 9_840) * 100);
  assert.equal(s.tvScreens, "rotate");
});

test("the P&C board: licensed people, plus anyone with a P&C sale; a past best day counts life apart", () => {
  const sales = [
    sale(aa, "2026-11-03", 500, { kind: "pc", carrier: "Progressive", product: "Auto" }), // logged before a license was turned off
    sale(aa, "2026-11-04", 300),
    sale(tk, "2026-11-03", 200),
  ];
  const s = snap(sales);
  assert.deepEqual(
    s.agents.filter((a) => a.pcRank !== null).map((a) => [a.name, a.pcRank]),
    [
      ["Alex Alekseyev", 1],
      ["Anersi Koka", 2], // licensed, nothing yet: on the board with a zero
      ["Moe Karim", 3],
    ],
  );
  assert.deepEqual(s.team.bestDay, { date: "2026-11-03", cents: 700 * 100 });
  assert.deepEqual(s.team.bestLifeDay, { date: "2026-11-04", cents: 300 * 100 });
  assert.equal(s.team.pcAverageCents, 500 * 100);
});

test("P&C has a goal of its own; the agency total measures life and P&C against both goals added up", () => {
  const sales = [
    sale(aa, "2026-11-10", 20_000),
    sale(ak, "2026-11-12", 10_000),
    sale(ak, "2026-11-17", 6_000, { kind: "pc", carrier: "Progressive", product: "Auto" }),
    sale(mk, "2026-11-18", 3_000, { kind: "pc", carrier: "Geico", product: "Auto" }),
  ];
  const s = snap(sales, { teamCents: 200_000 * 100, byAgent: { ak: 70_000 * 100 }, pcTeamCents: 30_000 * 100, pcByAgent: { ak: 20_000 * 100, mk: 10_000 * 100 } });
  // The life goal ignores P&C; P&C against its own goal; the total against both
  assert.equal(s.team.goalPct, Math.round((30_000 / 200_000) * 100));
  assert.equal(s.team.pcGoalCents, 30_000 * 100);
  assert.equal(s.team.pcGoalPct, Math.round((9_000 / 30_000) * 100));
  assert.equal(s.team.totalGoalCents, 230_000 * 100);
  assert.equal(s.team.totalGoalPct, Math.round((39_000 / 230_000) * 100));
  const expected = (goal: number) => Math.round(goal * 100 * (13 / 21));
  assert.equal(s.team.pcPace.aheadCents, 9_000 * 100 - expected(30_000));
  assert.equal(s.team.totalPace.aheadCents, 39_000 * 100 - expected(230_000));
  const anersi = s.agents.find((a) => a.id === "ak")!;
  assert.deepEqual([anersi.goalPct, anersi.pcGoalPct, anersi.totalGoalCents, anersi.totalGoalPct], [14, 30, 90_000 * 100, Math.round((16_000 / 90_000) * 100)]);
  const moe = s.agents.find((a) => a.id === "mk")!;
  assert.deepEqual([moe.goalCents, moe.pcGoalCents, moe.pcGoalPct], [0, 10_000 * 100, 30]);
});

test("the life board's ranks never skip: someone off the board with only P&C ranks after everyone it shows", () => {
  const gone: Agent = { id: "bo", name: "Bo Aaron", active: false, sort: 9, pc_licensed: true };
  const s = buildSnapshot({
    month: "2026-11",
    today: "2026-11-18",
    agents: [...agents, gone],
    sales: [sale(aa, "2026-11-10", 5_000), sale(gone, "2026-11-05", 1_200, { kind: "pc", carrier: "Progressive", product: "Auto" })],
    goals: { teamCents: 0, byAgent: {} },
    recent: [],
    message: "",
  });
  const shown = s.agents.filter((a) => a.active || a.lifeCents > 0);
  assert.deepEqual(shown.map((a) => a.rank), [1, 2, 3, 4]);
  assert.equal(s.agents.find((a) => a.id === "bo")!.rank, 5);
  assert.deepEqual(s.lifeRecent.map((r) => r.premiumCents / 100), [5_000]);
});
