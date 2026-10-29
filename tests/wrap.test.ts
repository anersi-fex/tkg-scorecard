import { test } from "node:test";
import assert from "node:assert/strict";
import { buildWrap, carrierSummary, neededOnDay, type WrapInput } from "../src/lib/wrap";
import type { FeedSale } from "../src/lib/board";

let n = 0;
function sale(agentId: string, agentName: string, soldOn: string, premium: number, extra: Partial<FeedSale> = {}): FeedSale {
  n++;
  return { id: `s${n}`, agentId, agentName, premiumCents: premium * 100, policies: 1, product: "Whole life", carrier: "AHL", note: null, soldOn, createdAt: `${soldOn}T${String(10 + n).padStart(2, "0")}:00:00.000Z`, ...extra };
}

const agents = [
  { id: "a", name: "Anersi Koka", tone: "t1", active: true },
  { id: "b", name: "Alex Alekseyev", tone: "t2", active: true },
  { id: "c", name: "Maira Angulo", tone: "t3", active: true },
  { id: "d", name: "Gone Person", tone: "t4", active: false },
];

function input(sales: FeedSale[], goal = 200_000): WrapInput {
  const productionCents = sales.reduce((s, x) => s + x.premiumCents, 0);
  return { clock: { key: "2026-10", today: "2026-10-28" }, team: { goalCents: goal * 100, productionCents, policies: sales.length, goalPct: 94 }, agents, sales };
}

test("a day's wrap: ranks, player, best deal, carriers, products", () => {
  const sales = [
    sale("c", "Maira Angulo", "2026-10-28", 2700, { createdAt: "2026-10-28T19:27:00.000Z" }),
    sale("c", "Maira Angulo", "2026-10-28", 2196, { createdAt: "2026-10-28T21:24:00.000Z" }),
    sale("c", "Maira Angulo", "2026-10-28", 528, { carrier: "Newbridge" }),
    sale("a", "Anersi Koka", "2026-10-28", 2688, { carrier: "Newbridge" }),
    sale("a", "Anersi Koka", "2026-10-28", 2112, { carrier: "Newbridge", product: "Term" }),
    sale("d", "Gone Person", "2026-10-28", 100, { carrier: null, product: null }),
    sale("b", "Alex Alekseyev", "2026-10-27", 9000),
  ];
  const w = buildWrap(input(sales), "2026-10-28");
  assert.equal(w.when, "today");
  assert.equal(w.teamCents, (2700 + 2196 + 528 + 2688 + 2112 + 100) * 100);
  assert.equal(w.policies, 6);
  assert.deepEqual(
    w.lines.map((l) => [l.name, l.rank, l.premiumCents / 100]),
    [
      ["Maira Angulo", 1, 5424],
      ["Anersi Koka", 2, 4800],
      ["Gone Person", 3, 100], // off the board, but sold that day
      ["Alex Alekseyev", null, 0],
    ],
  );
  assert.equal(w.player?.name, "Maira Angulo");
  assert.equal(carrierSummary(w.player!.carriers), "AHL ×2 · Newbridge");
  assert.equal(w.bestSale?.premiumCents, 2700 * 100);
  assert.deepEqual(w.carriers, [
    { name: "Newbridge", count: 3 },
    { name: "AHL", count: 2 },
  ]);
  assert.deepEqual(w.products, [
    { name: "Whole life", count: 4 }, // the off-board sale has no product
    { name: "Term", count: 1 },
  ]);
  assert.equal(w.month.policies, 7);
});

test("the biggest deal on a tie is the earliest one", () => {
  const sales = [sale("a", "Anersi Koka", "2026-10-28", 1000, { createdAt: "2026-10-28T20:00:00.000Z" }), sale("b", "Alex Alekseyev", "2026-10-28", 1000, { createdAt: "2026-10-28T14:00:00.000Z" })];
  assert.equal(buildWrap(input(sales), "2026-10-28").bestSale?.agentId, "b");
});

test("the day's verdict against what the goal needed", () => {
  // Before Wed Oct 28: $176,697 of $200,000; Wed, Thu, Fri left (3 days, today included) => $7,768 a day.
  const before = sale("a", "Anersi Koka", "2026-10-27", 176_697);
  assert.equal(neededOnDay(input([before]), "2026-10-28"), Math.ceil((23_303 * 100) / 3));
  const short = buildWrap(input([before, sale("c", "Maira Angulo", "2026-10-28", 5000)]), "2026-10-28");
  assert.equal(short.verdict.kind, "short");
  if (short.verdict.kind === "short") assert.equal(short.verdict.shortCents, Math.ceil((23_303 * 100) / 3) - 5000 * 100);
  const won = buildWrap(input([before, sale("c", "Maira Angulo", "2026-10-28", 8000)]), "2026-10-28");
  assert.equal(won.verdict.kind, "won");
  // The last business day needs all of what is left; a sale after the goal is "goal_hit".
  assert.equal(neededOnDay(input([before]), "2026-10-30"), 23_303 * 100);
  assert.equal(buildWrap(input([sale("a", "Anersi Koka", "2026-10-27", 250_000)]), "2026-10-28").verdict.kind, "goal_hit");
  // A weekend has no daily need; no goal, no verdict.
  assert.equal(buildWrap(input([before]), "2026-10-31").verdict.kind, "off_day");
  assert.equal(buildWrap(input([before], 0), "2026-10-28").verdict.kind, "no_goal");
});

test("a day with nobody: no player, no best deal, everyone unranked", () => {
  const w = buildWrap(input([sale("a", "Anersi Koka", "2026-10-20", 500)]), "2026-10-27");
  assert.equal(w.when, "past");
  assert.equal(w.player, null);
  assert.equal(w.bestSale, null);
  assert.deepEqual(
    w.lines.map((l) => [l.name, l.rank]),
    [
      ["Alex Alekseyev", null],
      ["Anersi Koka", null],
      ["Maira Angulo", null],
    ],
  );
  assert.equal(w.carriers.length, 0);
});
