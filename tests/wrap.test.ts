import { test } from "node:test";
import assert from "node:assert/strict";
import { buildWrap, carrierSummary, neededOnDay, periodFor, periodNav, type WrapInput } from "../src/lib/wrap";
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

/** October 2026 seen from Wednesday the 28th (22 business days, 20 of them elapsed). */
function input(sales: FeedSale[], goal = 200_000, clock = { key: "2026-10", today: "2026-10-28" }): WrapInput {
  return { clock, team: { goalCents: goal * 100 }, agents, sales };
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
  assert.equal(w.view, "day");
  assert.equal(w.current, true);
  assert.deepEqual([w.from, w.to], ["2026-10-28", "2026-10-28"]);
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
  assert.equal(w.month.productionCents, sales.reduce((s, x) => s + x.premiumCents, 0));
  // The month as it stood on an earlier day
  const earlier = buildWrap(input(sales), "2026-10-27");
  assert.equal(earlier.current, false);
  assert.equal(earlier.month.policies, 1);
  assert.equal(earlier.month.productionCents, 9000 * 100);
  assert.equal(earlier.month.goalPct, 5);
});

test("the best deal is a single policy; a day's imported total counts only when nothing else was logged", () => {
  const multi = sale("a", "Anersi Koka", "2026-10-28", 6576, { policies: 4 });
  const single = sale("b", "Alex Alekseyev", "2026-10-28", 2500);
  assert.equal(buildWrap(input([multi, single]), "2026-10-28").bestSale?.id, single.id);
  assert.equal(buildWrap(input([multi]), "2026-10-28").bestSale?.id, multi.id);
});

test("the biggest deal on a tie is the earliest one", () => {
  const sales = [sale("a", "Anersi Koka", "2026-10-28", 1000, { createdAt: "2026-10-28T20:00:00.000Z" }), sale("b", "Alex Alekseyev", "2026-10-28", 1000, { createdAt: "2026-10-28T14:00:00.000Z" })];
  assert.equal(buildWrap(input(sales), "2026-10-28").bestSale?.agentId, "b");
});

test("the day's verdict against what the goal needed", () => {
  // Before Wed Oct 28: $176,697 of $200,000; Wed, Thu, Fri left (3 days, today included) => $7,768 a day, whole dollars.
  const before = sale("a", "Anersi Koka", "2026-10-27", 176_697);
  assert.equal(neededOnDay(input([before]), "2026-10-28"), 7768 * 100);
  const short = buildWrap(input([before, sale("c", "Maira Angulo", "2026-10-28", 5000)]), "2026-10-28");
  assert.equal(short.verdict.kind, "short");
  if (short.verdict.kind === "short") assert.equal(short.verdict.shortCents, 2768 * 100);
  const won = buildWrap(input([before, sale("c", "Maira Angulo", "2026-10-28", 8000)]), "2026-10-28");
  assert.equal(won.verdict.kind, "won");
  // The last business day needs all of what is left; a sale after the goal is "goal_hit".
  assert.equal(neededOnDay(input([before]), "2026-10-30"), 23_303 * 100);
  assert.equal(buildWrap(input([sale("a", "Anersi Koka", "2026-10-27", 250_000)]), "2026-10-28").verdict.kind, "goal_hit");
  // A weekend (Saturday Oct 24) has no daily need; no goal, no verdict.
  assert.equal(buildWrap(input([before]), "2026-10-24").verdict.kind, "off_day");
  assert.equal(buildWrap(input([before], 0), "2026-10-28").verdict.kind, "no_goal");
});

test("the periods a view covers, and where the arrows go", () => {
  const today = "2026-10-28";
  assert.deepEqual(periodFor("day", "2026-10-21", today), { view: "day", from: "2026-10-21", to: "2026-10-21" });
  // This week runs through today; a past week is whole, Monday to Sunday
  assert.deepEqual(periodFor("week", "2026-10-28", today), { view: "week", from: "2026-10-26", to: "2026-10-28" });
  assert.deepEqual(periodFor("week", "2026-10-21", today), { view: "week", from: "2026-10-19", to: "2026-10-25" });
  assert.deepEqual(periodFor("week", "2026-10-25", today), { view: "week", from: "2026-10-19", to: "2026-10-25" });
  // A week never crosses the month's edges (Oct 1 is a Thursday; Oct 31 a Saturday)
  assert.deepEqual(periodFor("week", "2026-10-01", today), { view: "week", from: "2026-10-01", to: "2026-10-04" });
  assert.deepEqual(periodFor("week", "2026-10-31", "2026-11-03"), { view: "week", from: "2026-10-26", to: "2026-10-31" });
  assert.deepEqual(periodFor("week", "2026-09-29", today), { view: "week", from: "2026-09-28", to: "2026-09-30" });
  // The month runs through today; an earlier month is whole
  assert.deepEqual(periodFor("month", "2026-10-15", today), { view: "month", from: "2026-10-01", to: "2026-10-28" });
  assert.deepEqual(periodFor("month", "2026-09-10", today), { view: "month", from: "2026-09-01", to: "2026-09-30" });
  // A day after today reads as today
  assert.deepEqual(periodFor("day", "2026-10-30", today), { view: "day", from: today, to: today });
  assert.deepEqual(periodFor("week", "2026-10-30", today), { view: "week", from: "2026-10-26", to: today });
  // The arrows step past the period's edges, so split weeks and months come one at a time
  assert.deepEqual(periodNav(periodFor("week", "2026-10-01", today), today), { prev: "2026-09-30", next: "2026-10-05" });
  assert.deepEqual(periodNav(periodFor("week", "2026-09-29", today), today), { prev: "2026-09-27", next: "2026-10-01" });
  assert.deepEqual(periodNav(periodFor("week", "2026-10-28", today), today), { prev: "2026-10-25", next: null });
  assert.deepEqual(periodNav(periodFor("month", "2026-09-10", today), today), { prev: "2026-08-31", next: "2026-10-01" });
  assert.deepEqual(periodNav(periodFor("month", "2026-10-10", today), today), { prev: "2026-09-30", next: null });
  assert.deepEqual(periodNav(periodFor("day", today, today), today), { prev: "2026-10-27", next: null });
});

test("a week's wrap: everybody across the days, the best deal, and the verdict from Monday's share", () => {
  // $176,697 before Monday Oct 26: $23,303 left over Mon to Fri => $4,661 a day. Mon, Tue, Wed so far => $13,983 needed.
  const before = sale("a", "Anersi Koka", "2026-10-23", 176_697);
  assert.equal(neededOnDay(input([before]), "2026-10-26"), 4661 * 100);
  const week = [
    before,
    sale("b", "Alex Alekseyev", "2026-10-27", 5000, { carrier: "Royal" }),
    sale("c", "Maira Angulo", "2026-10-28", 3500),
    sale("c", "Maira Angulo", "2026-10-28", 2500, { carrier: "Newbridge" }),
  ];
  const w = buildWrap(input(week), "2026-10-28", "week");
  assert.equal(w.view, "week");
  assert.deepEqual([w.from, w.to, w.current], ["2026-10-26", "2026-10-28", true]);
  assert.equal(w.teamCents, 11_000 * 100);
  assert.equal(w.policies, 3);
  assert.deepEqual(
    w.lines.map((l) => [l.name, l.rank, l.premiumCents / 100]),
    [
      ["Maira Angulo", 1, 6000],
      ["Alex Alekseyev", 2, 5000],
      ["Anersi Koka", null, 0], // Friday's sale is last week
    ],
  );
  assert.equal(w.player?.name, "Maira Angulo");
  assert.equal(w.bestSale?.premiumCents, 5000 * 100);
  assert.deepEqual(w.verdict, { kind: "short", neededCents: 13_983 * 100, shortCents: 2983 * 100 });
  assert.deepEqual(w.carriers, [
    { name: "AHL", count: 1 },
    { name: "Newbridge", count: 1 },
    { name: "Royal", count: 1 },
  ]);
  // One more sale wins the week
  const won = buildWrap(input([...week, sale("a", "Anersi Koka", "2026-10-28", 3000)]), "2026-10-28", "week");
  assert.deepEqual(won.verdict, { kind: "won", neededCents: 13_983 * 100 });
  // A week that sells exactly what was left has won: the rounded share ($4,661) times five overshoots by $2, so the need is capped at the rest of the goal
  const exact = buildWrap(input([before, sale("c", "Maira Angulo", "2026-10-28", 23_303)], 200_000, { key: "2026-10", today: "2026-10-31" }), "2026-10-31", "week");
  assert.deepEqual(exact.verdict, { kind: "won", neededCents: 23_303 * 100 });
  assert.deepEqual(buildWrap(input([before, sale("c", "Maira Angulo", "2026-10-28", 23_302)], 200_000, { key: "2026-10", today: "2026-10-31" }), "2026-10-31", "week").verdict, { kind: "short", neededCents: 23_303 * 100, shortCents: 100 });
  // A past week is whole (Oct 19 to 25) and settled: $23,303 left before Monday Oct 19 over 10 business
  // days => $2,331 a day, five of them that week. The goal already hit before a week reads so.
  const past = buildWrap(input([sale("a", "Anersi Koka", "2026-10-16", 176_697), sale("b", "Alex Alekseyev", "2026-10-20", 1000)]), "2026-10-21", "week");
  assert.deepEqual([past.from, past.to, past.current], ["2026-10-19", "2026-10-25", false]);
  assert.equal(past.teamCents, 1000 * 100);
  assert.deepEqual(past.verdict, { kind: "short", neededCents: 11_655 * 100, shortCents: 10_655 * 100 });
  assert.equal(buildWrap(input([sale("a", "Anersi Koka", "2026-10-23", 250_000)]), "2026-10-28", "week").verdict.kind, "goal_hit");
  // A week slice with no business day (August 2026 opens on a Saturday) needs nothing
  const weekend = buildWrap(input([], 200_000, { key: "2026-08", today: "2026-08-05" }), "2026-08-01", "week");
  assert.deepEqual([weekend.from, weekend.to, weekend.verdict.kind], ["2026-08-01", "2026-08-02", "off_day"]);
});

test("a month's wrap against the line to the goal; a finished month reads whole", () => {
  // 20 of 22 business days elapsed by Wed Oct 28: the line expects $181,818.18 of $200,000.
  const behind = buildWrap(input([sale("a", "Anersi Koka", "2026-10-27", 176_697)]), "2026-10-28", "month");
  assert.deepEqual([behind.from, behind.to, behind.current], ["2026-10-01", "2026-10-28", true]);
  assert.deepEqual(behind.verdict, { kind: "behind", byCents: 512_118, expectedCents: 18_181_818 });
  assert.deepEqual(buildWrap(input([sale("a", "Anersi Koka", "2026-10-27", 190_000)]), "2026-10-28", "month").verdict, { kind: "ahead", byCents: 818_182, expectedCents: 18_181_818 });
  assert.deepEqual(buildWrap(input([sale("a", "Anersi Koka", "2026-10-27", 181_000)]), "2026-10-28", "month").verdict, { kind: "on", expectedCents: 18_181_818 });
  assert.equal(buildWrap(input([sale("a", "Anersi Koka", "2026-10-27", 250_000)]), "2026-10-28", "month").verdict.kind, "goal_hit");
  assert.equal(buildWrap(input([sale("a", "Anersi Koka", "2026-10-27", 1000)], 0), "2026-10-28", "month").verdict.kind, "no_goal");
  // September seen from October: whole, and short by what was left
  const sept = buildWrap(input([sale("a", "Anersi Koka", "2026-09-15", 150_000), sale("b", "Alex Alekseyev", "2026-09-02", 20_000)], 200_000, { key: "2026-09", today: "2026-10-28" }), "2026-09-10", "month");
  assert.deepEqual([sept.from, sept.to, sept.current], ["2026-09-01", "2026-09-30", false]);
  assert.equal(sept.teamCents, 170_000 * 100);
  assert.deepEqual(sept.verdict, { kind: "short", neededCents: 200_000 * 100, shortCents: 30_000 * 100 });
  assert.equal(sept.player?.name, "Anersi Koka");
  assert.deepEqual(
    sept.lines.map((l) => [l.name, l.rank]),
    [
      ["Anersi Koka", 1],
      ["Alex Alekseyev", 2],
      ["Maira Angulo", null],
    ],
  );
  // A month view's month block is the same month
  assert.equal(sept.month.productionCents, sept.teamCents);
  assert.equal(sept.month.goalPct, 85);
});

test("the month's top three carriers by policies, as they stood at the period's end", () => {
  const sales = [
    sale("a", "Anersi Koka", "2026-10-20", 1000, { carrier: "Royal" }),
    sale("a", "Anersi Koka", "2026-10-21", 1000, { carrier: "Americo" }),
    sale("b", "Alex Alekseyev", "2026-10-22", 1000, { carrier: "Newbridge", policies: 2 }),
    sale("c", "Maira Angulo", "2026-10-27", 1000, { carrier: "AHL", policies: 3 }),
    sale("c", "Maira Angulo", "2026-10-28", 1000, { carrier: null }),
  ];
  const w = buildWrap(input(sales), "2026-10-28");
  assert.deepEqual(w.topCarriers, [
    { name: "AHL", count: 3 },
    { name: "Newbridge", count: 2 },
    { name: "Americo", count: 1 }, // ties go by name; a sale without a carrier counts for none
  ]);
  assert.deepEqual(buildWrap(input(sales), "2026-10-22", "week").topCarriers, [
    { name: "Newbridge", count: 2 },
    { name: "Americo", count: 1 },
    { name: "Royal", count: 1 },
  ]);
  assert.deepEqual(buildWrap(input(sales), "2026-10-28", "month").topCarriers, w.topCarriers);
  // The squares cover only the policies that name a carrier
  assert.equal(w.month.policies, 8);
  assert.equal(w.month.withCarrier, 7);
  assert.deepEqual(buildWrap(input([]), "2026-10-28").topCarriers, []);
});

test("a day with nobody: no player, no best deal, everyone unranked", () => {
  const w = buildWrap(input([sale("a", "Anersi Koka", "2026-10-20", 500)]), "2026-10-27");
  assert.equal(w.current, false);
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
