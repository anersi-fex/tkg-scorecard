import { test } from "node:test";
import assert from "node:assert/strict";
import { buildWrap, carrierSummary, neededOnDay, periodFor, periodNav, wrapRoster, WRAP_QUIET_NAMES, WRAP_ROWS, type WrapInput } from "../src/lib/wrap";
import type { FeedSale } from "../src/lib/board";

let n = 0;
function sale(agentId: string, agentName: string, soldOn: string, premium: number, extra: Partial<FeedSale> = {}): FeedSale {
  n++;
  return { id: `s${n}`, agentId, agentName, premiumCents: premium * 100, policies: 1, product: "Whole life", carrier: "AHL", kind: "life", note: null, soldOn, createdAt: `${soldOn}T${String(10 + n).padStart(2, "0")}:00:00.000Z`, ...extra };
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
    { name: "Newbridge", count: 3, pc: false },
    { name: "AHL", count: 2, pc: false },
  ]);
  assert.deepEqual(w.products, [
    { name: "Whole life", count: 4, pc: false }, // the off-board sale has no product
    { name: "Term", count: 1, pc: false },
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
    { name: "AHL", count: 1, pc: false },
    { name: "Newbridge", count: 1, pc: false },
    { name: "Royal", count: 1, pc: false },
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
    { name: "AHL", count: 3, pc: false },
    { name: "Newbridge", count: 2, pc: false },
    { name: "Americo", count: 1, pc: false }, // ties go by name; a sale without a carrier counts for none
  ]);
  assert.deepEqual(buildWrap(input(sales), "2026-10-22", "week").topCarriers, [
    { name: "Newbridge", count: 2, pc: false },
    { name: "Americo", count: 1, pc: false },
    { name: "Royal", count: 1, pc: false },
  ]);
  assert.deepEqual(buildWrap(input(sales), "2026-10-28", "month").topCarriers, w.topCarriers);
  // The squares cover only the policies that name a carrier
  assert.equal(w.month.policies, 8);
  assert.equal(w.month.withCarrier, 7);
  assert.deepEqual(buildWrap(input([]), "2026-10-28").topCarriers, []);
});

test("P&C counts with life, and reads apart: the split on a line, a P&C carrier, the period's P&C", () => {
  const sales = [
    sale("a", "Anersi Koka", "2026-10-28", 1500, { carrier: "AHL" }),
    sale("a", "Anersi Koka", "2026-10-28", 1860, { kind: "pc", carrier: "Progressive", product: "Auto" }),
    sale("a", "Anersi Koka", "2026-10-28", 640, { kind: "pc", carrier: "Progressive", product: "Renters" }),
    sale("b", "Alex Alekseyev", "2026-10-28", 2000),
  ];
  const w = buildWrap(input(sales), "2026-10-28");
  // Combined: Anersi $4,000 leads Alex's $2,000; the P&C part reads apart
  assert.deepEqual(
    w.lines.map((l) => [l.name, l.rank, l.premiumCents / 100, l.pcCents / 100, l.pcPolicies]),
    [
      ["Anersi Koka", 1, 4000, 2500, 2],
      ["Alex Alekseyev", 2, 2000, 0, 0],
      ["Maira Angulo", null, 0, 0, 0],
    ],
  );
  assert.equal(w.teamCents, 6000 * 100);
  assert.equal(w.pcCents, 2500 * 100);
  assert.equal(w.pcPolicies, 2);
  assert.equal(w.month.pcCents, 2500 * 100);
  // The best deal counts whatever kind it is, and says so through its kind
  assert.equal(w.bestSale?.premiumCents, 2000 * 100);
  assert.deepEqual(w.carriers, [
    { name: "AHL", count: 2, pc: false }, // ties go by name
    { name: "Progressive", count: 2, pc: true },
  ]);
  assert.deepEqual(w.products, [
    { name: "Whole life", count: 2, pc: false },
    { name: "Auto", count: 1, pc: true },
    { name: "Renters", count: 1, pc: true },
  ]);
  assert.equal(carrierSummary(w.player!.carriers), "Progressive ×2 · AHL");
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

test("the goal is life: P&C fills the totals but never wins a day or moves the month's percent", () => {
  const sales = [
    sale("b", "Alex Alekseyev", "2026-10-01", 190_000),
    sale("a", "Anersi Koka", "2026-10-02", 5_000, { kind: "pc", carrier: "Progressive", product: "Auto" }), // not counted toward the goal
    sale("a", "Anersi Koka", "2026-10-28", 3_000),
    sale("a", "Anersi Koka", "2026-10-28", 2_000, { kind: "pc", carrier: "Geico", product: "Auto" }),
  ];
  // What was left of the goal in life, $10,000, over Oct 28, 29 and 30
  assert.equal(neededOnDay(input(sales), "2026-10-28"), 333_400);
  const w = buildWrap(input(sales), "2026-10-28");
  assert.equal(w.teamCents, 5_000 * 100);
  assert.equal(w.lifeCents, 3_000 * 100);
  // $5,000 written, but only $3,000 of it is life: $334 short of the $3,334 the goal needed
  assert.deepEqual(w.verdict, { kind: "short", neededCents: 333_400, shortCents: 33_400 });
  assert.equal(w.month.goalPct, 97); // $193,000 of life against $200,000
  assert.equal(w.month.lifeCents, 193_000 * 100);
  assert.equal(w.month.productionCents, 200_000 * 100);
  // The month view: life against the straight line, not the $200,000 written in all
  assert.notEqual(buildWrap(input(sales), "2026-10-28", "month").verdict.kind, "goal_hit");
});

test("life only: when only life sales reach the Wrap, nothing on it is P&C", () => {
  // The loader drops P&C sales while Settings has P&C off (lifeOnlyInput in snapshot.ts).
  const all = [
    sale("a", "Anersi Koka", "2026-10-28", 4000, { carrier: "Newbridge" }),
    sale("a", "Anersi Koka", "2026-10-28", 1500, { kind: "pc", carrier: "Progressive", product: "Auto" }),
    sale("c", "Maira Angulo", "2026-10-27", 2500),
  ];
  const life = all.filter((s) => s.kind !== "pc");
  for (const view of ["day", "week", "month"] as const) {
    const w = buildWrap(input(life), "2026-10-28", view);
    assert.deepEqual([w.pcCents, w.pcPolicies, w.month.pcCents], [0, 0, 0], view);
    assert.equal(w.teamCents, w.lifeCents, view);
    assert.equal(w.month.productionCents, w.month.lifeCents, view);
    assert.ok([...w.carriers, ...w.products, ...w.topCarriers].every((c) => !c.pc), view);
    assert.ok(w.lines.every((l) => l.pcCents === 0 && l.pcPolicies === 0 && l.carriers.every((c) => !c.pc)), view);
    assert.ok(!w.carriers.some((c) => c.name === "Progressive"), view);
  }
  // The verdict is the same with or without the P&C sale: it always measured life.
  assert.deepEqual(buildWrap(input(life), "2026-10-28").verdict, buildWrap(input(all), "2026-10-28").verdict);
  assert.equal(buildWrap(input(life), "2026-10-28").teamCents, 4000 * 100);
});

test("everybody's period stays one screenshot: the top rows, then the rest of the sellers and the no-sale people on one line", () => {
  // An agency: `people` on the board, the first `sellers` of them sell on the 28th ($100 more each, so the order is known).
  const roster = (people: number, sellers: number) => {
    const team = Array.from({ length: people }, (_, i) => ({ id: `p${i}`, name: `Person ${String(i).padStart(2, "0")}`, tone: "t1", active: true }));
    const sales = team.slice(0, sellers).map((a, i) => sale(a.id, a.name, "2026-10-28", 1000 + i * 100));
    const w = buildWrap({ clock: { key: "2026-10", today: "2026-10-28" }, team: { goalCents: 0 }, agents: team, sales }, "2026-10-28");
    return { w, r: wrapRoster(w.lines) };
  };
  assert.equal(WRAP_ROWS, 7);
  assert.equal(WRAP_QUIET_NAMES, 6);

  // Seven people or fewer: everyone is a row, the ones without a sale included; no line under them.
  let { w, r } = roster(7, 3);
  assert.equal(r.rows.length, 7);
  assert.deepEqual(r.rows, w.lines);
  assert.deepEqual([r.more, r.quiet.length, r.quietNamed], [null, 0, false]);

  // Eight people, seven of them selling (the smoke test's team): seven rows and "No sale: <name>", as before.
  ({ w, r } = roster(8, 7));
  assert.deepEqual(r.rows.map((l) => l.rank), [1, 2, 3, 4, 5, 6, 7]);
  assert.equal(r.more, null);
  assert.deepEqual([r.quiet.map((l) => l.name), r.quietNamed], [["Person 07"], true]);

  // Eight sellers: the rows stop at the top six and the other two share the line.
  ({ w, r } = roster(8, 8));
  assert.deepEqual(r.rows.map((l) => [l.rank, l.premiumCents / 100]), [[1, 1700], [2, 1600], [3, 1500], [4, 1400], [5, 1300], [6, 1200]]);
  assert.deepEqual(r.more, { count: 2, premiumCents: (1100 + 1000) * 100, policies: 2 });
  assert.deepEqual([r.quiet.length, r.quietNamed], [0, false]);

  // The agency: 60 on the board, 27 sold. Six rows, "and 21 more sold $...", and 33 without a sale as a count.
  ({ w, r } = roster(60, 27));
  assert.equal(r.rows.length, 6);
  assert.equal(r.rows[0].premiumCents, 3600 * 100);
  assert.equal(r.more?.count, 21);
  assert.equal(r.more?.policies, 21);
  // The rows and the line add up to the period's total: nobody's sale is dropped.
  assert.equal(r.rows.reduce((sum, l) => sum + l.premiumCents, 0) + (r.more?.premiumCents ?? 0), w.teamCents);
  assert.equal(r.rows.reduce((sum, l) => sum + l.policies, 0) + (r.more?.policies ?? 0), w.policies);
  assert.deepEqual([r.quiet.length, r.quietNamed], [33, false]);

  // Up to six people without a sale are named; the seventh makes it a count.
  assert.equal(roster(13, 7).r.quietNamed, true);
  assert.equal(roster(14, 7).r.quietNamed, false);
  // Nobody sold yet: no rows past seven people, only the count.
  ({ r } = roster(30, 0));
  assert.deepEqual([r.rows.length, r.more, r.quiet.length, r.quietNamed], [0, null, 30, false]);
  // Nobody on the board.
  assert.deepEqual(wrapRoster([]), { rows: [], more: null, quiet: [], quietNamed: false });
});
