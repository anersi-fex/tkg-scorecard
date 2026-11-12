import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PAGE_MS,
  SCREEN_LABEL,
  SCREEN_MS,
  boardGroups,
  compactDollars,
  isView,
  linesSummary,
  nextScreen,
  pageCount,
  pageOf,
  pcBreakdown,
  rankOrder,
  recentDays,
  rotationScreens,
  screenFacts,
  screenFor,
  screenMs,
  shortDay,
  viewOf,
  type ScreenFacts,
} from "../src/lib/views";

const facts = (over: Partial<ScreenFacts> = {}): ScreenFacts => ({ scoreboard: true, production: true, teams: true, pcEnabled: false, pc: false, ...over });
const NOTHING = facts({ scoreboard: false, production: false, teams: false });

test("the TV rotates the leaderboard, the Scoreboard, Production and Teams; the leaderboard has the most time", () => {
  assert.deepEqual(rotationScreens(facts()), ["life", "scoreboard", "production", "teams"]);
  assert.equal(nextScreen("life", facts()), "scoreboard");
  assert.equal(nextScreen("scoreboard", facts()), "production");
  assert.equal(nextScreen("production", facts()), "teams");
  assert.equal(nextScreen("teams", facts()), "life");
  assert.equal(SCREEN_MS.life, 40_000);
  for (const s of ["scoreboard", "production", "teams", "pc", "total"] as const) assert.equal(SCREEN_MS[s], 20_000);
});

test("a screen with nothing to show is skipped, and with nothing but the leaderboard the TV stays on it", () => {
  // No team sold yet: Teams drops out
  assert.deepEqual(rotationScreens(facts({ teams: false })), ["life", "scoreboard", "production"]);
  assert.equal(nextScreen("production", facts({ teams: false })), "life");
  // No scoreboard yet, or no sales: only the leaderboard
  assert.deepEqual(rotationScreens(NOTHING), ["life"]);
  assert.equal(nextScreen("life", NOTHING), "life");
  // A screen that just dropped out goes back to the leaderboard
  assert.equal(nextScreen("teams", NOTHING), "life");
  assert.equal(screenFor("rotate", "teams", facts({ teams: false })), "life");
  assert.equal(screenFor("rotate", "production", facts()), "production");
});

test("the facts of a snapshot: no scoreboard, no sales, no teams, P&C off or without P&C this month", () => {
  assert.deepEqual(screenFacts({ team: { pcCents: 0 }, scoreboard: null }), { scoreboard: false, production: false, teams: false, pcEnabled: false, pc: false });
  assert.deepEqual(screenFacts({ team: { pcCents: 0 } }), { scoreboard: false, production: false, teams: false, pcEnabled: false, pc: false });
  assert.deepEqual(screenFacts({ pcEnabled: false, team: { pcCents: 0 }, scoreboard: { rows: [], teams: [] } }), { scoreboard: false, production: false, teams: false, pcEnabled: false, pc: false });
  assert.deepEqual(screenFacts({ pcEnabled: false, team: { pcCents: 0 }, scoreboard: { rows: [1], teams: [] } }), { scoreboard: true, production: true, teams: false, pcEnabled: false, pc: false });
  // P&C money in the numbers never brings its screens back while the switch is off
  assert.deepEqual(screenFacts({ pcEnabled: false, team: { pcCents: 500_00 }, scoreboard: { rows: [1], teams: [1] } }), { scoreboard: true, production: true, teams: true, pcEnabled: false, pc: false });
  assert.deepEqual(screenFacts({ pcEnabled: true, team: { pcCents: 0 }, scoreboard: null }), { scoreboard: false, production: false, teams: false, pcEnabled: true, pc: false });
  assert.equal(screenFacts({ pcEnabled: true, team: { pcCents: 500_00 }, scoreboard: null }).pc, true);
});

test("P&C and the agency total exist only while P&C is on", () => {
  const on = facts({ pcEnabled: true, pc: true });
  assert.deepEqual(rotationScreens(on), ["life", "scoreboard", "production", "teams", "pc", "total"]);
  assert.equal(nextScreen("teams", on), "pc");
  assert.equal(nextScreen("pc", on), "total");
  assert.equal(nextScreen("total", on), "life");
  // On, but no P&C this month: its screens would only repeat the others
  assert.deepEqual(rotationScreens(facts({ pcEnabled: true })), ["life", "scoreboard", "production", "teams"]);
  // Off: never in rotation, and a TV kept on one of them shows the leaderboard
  assert.ok(!rotationScreens(facts()).some((s) => s === "pc" || s === "total"));
  assert.equal(screenFor("pc", "life", facts()), "life");
  assert.equal(screenFor("total", "scoreboard", facts()), "life");
  assert.equal(screenFor("pc", "life", facts({ pcEnabled: true })), "pc");
  assert.equal(screenFor("total", "life", on), "total");
  // With P&C off no screen's name says P&C or agency total
  for (const s of rotationScreens(facts())) assert.doesNotMatch(SCREEN_LABEL[s], /P&C|agency|total/i);
});

test("Settings > TV screens keeps the TV on one screen, even an empty one, or lets it rotate", () => {
  assert.equal(screenFor("rotate", "scoreboard", facts()), "scoreboard");
  assert.equal(screenFor("life", "teams", facts()), "life");
  assert.equal(screenFor("scoreboard", "life", facts()), "scoreboard");
  assert.equal(screenFor("production", "life", NOTHING), "production");
  assert.equal(screenFor("teams", "life", NOTHING), "teams");
  assert.ok(isView("total") && !isView("rotate") && !isView("") && !isView("scoreboard"));
  assert.deepEqual(["life", "scoreboard", "production", "teams", "pc", "total"].map((s) => viewOf(s as never)), ["life", "life", "life", "life", "pc", "total"]);
});

test("a screen stays its own time, or longer when its list has more pages than that covers", () => {
  assert.equal(PAGE_MS, 8000);
  assert.equal(screenMs("life"), 40_000);
  assert.equal(screenMs("life", 5), 40_000);
  assert.equal(screenMs("life", 6), 48_000);
  assert.equal(screenMs("production", 1), 20_000);
  assert.equal(screenMs("production", 2), 20_000);
  assert.equal(screenMs("production", 4), 32_000);
  assert.equal(screenMs("teams", 0), 20_000);
});

test("the office group first, ranked among themselves, then everyone else; people with no sale after the sellers", () => {
  const p = (name: string, inOffice: boolean, dollars: number, policies = dollars > 0 ? 1 : 0, active = true) => ({ name, inOffice, active, lifeCents: dollars * 100, lifePolicies: policies });
  const g = boardGroups([p("Remote Rae", false, 9000), p("Olive", true, 500), p("Otto", true, 4000), p("Zed", true, 0), p("Abe", true, 0), p("Rita", false, 0), p("Omar", true, 500, 2), p("Gone", false, 0, 0, false), p("Left", true, 700, 1, false)]);
  assert.equal(g.split, true);
  assert.deepEqual(
    g.office.map((a) => [a.place, a.name]),
    [
      [1, "Otto"],
      [2, "Left"],
      [3, "Omar"],
      [4, "Olive"],
      [5, "Abe"],
      [6, "Zed"],
    ],
  );
  // The best seller of the month works from home: first of "everyone else", not of the office
  assert.deepEqual(
    g.others.map((a) => [a.place, a.name]),
    [
      [1, "Remote Rae"],
      [2, "Rita"],
    ],
  );
  // Nobody marked in office: one group, everyone ranked together
  const one = boardGroups([p("Moe", false, 100), p("Alex", false, 300), p("Maira", false, 0)]);
  assert.equal(one.split, false);
  assert.deepEqual(
    one.office.map((a) => [a.place, a.name]),
    [
      [1, "Alex"],
      [2, "Moe"],
      [3, "Maira"],
    ],
  );
  assert.deepEqual(one.others, []);
  // The snapshot's own group ranks win when every person of the group has one
  const given = boardGroups([
    { ...p("Ann", true, 100), groupRank: 2 },
    { ...p("Bo", true, 100), groupRank: 1 },
    { ...p("Cy", false, 50), groupRank: 0 },
  ]);
  assert.deepEqual(
    given.office.map((a) => [a.place, a.name]),
    [
      [1, "Bo"],
      [2, "Ann"],
    ],
  );
  assert.deepEqual(given.others.map((a) => [a.place, a.name]), [[1, "Cy"]]);
});

test("a long list pages: never a cut row, the last page holds the rest, the page wraps around", () => {
  const people = Array.from({ length: 43 }, (_, i) => i + 1);
  assert.equal(pageCount(43, 16), 3);
  assert.equal(pageCount(16, 16), 1);
  assert.equal(pageCount(0, 16), 1);
  assert.equal(pageCount(5, 0), 5);
  assert.deepEqual(pageOf(people, 0, 16), people.slice(0, 16));
  assert.deepEqual(pageOf(people, 2, 16), people.slice(32));
  assert.deepEqual(pageOf(people, 3, 16), people.slice(0, 16));
  assert.deepEqual(pageOf([], 4, 16), []);
  // Every person is on exactly one page
  assert.deepEqual([0, 1, 2].flatMap((n) => pageOf(people, n, 16)), people);
});

test("the Production table shows the most recent days that fit, and prints them the way the CRM does", () => {
  const days = Array.from({ length: 30 }, (_, i) => `2026-11-${String(i + 1).padStart(2, "0")}`);
  assert.deepEqual(recentDays(days.slice(0, 11), 12), days.slice(0, 11));
  assert.deepEqual(recentDays(days, 3), ["2026-11-28", "2026-11-29", "2026-11-30"]);
  assert.deepEqual(recentDays(days, 0), ["2026-11-30"]);
  assert.equal(shortDay("2026-11-03"), "Nov 3");
  assert.equal(shortDay("2026-01-31"), "Jan 31");
  assert.equal(compactDollars(91_632_00), "$91.6K");
  assert.equal(compactDollars(90_100_00), "$90.1K");
  assert.equal(compactDollars(950_00), "$950");
  assert.equal(compactDollars(1_234_567_00), "$1.2M");
  assert.equal(compactDollars(999_960_00), "$1.0M");
  assert.equal(compactDollars(0), "$0");
  assert.equal(compactDollars(-2_100_00), "−$2.1K");
});

test("P&C by line and by carrier: most policies first, then premium, then the name; life left out", () => {
  const pc = (carrier: string | null, product: string | null, premium: number, policies = 1) => ({ kind: "pc" as const, carrier, product, policies, premiumCents: premium * 100 });
  const { lines, carriers } = pcBreakdown([
    pc("Progressive", "Auto", 600),
    pc("Progressive", "Auto", 650),
    pc("Progressive", "Renters", 190),
    pc("Geico", "Auto", 620),
    pc("Geico", "Umbrella", 450),
    pc("HOAIC", "Home", 1300),
    pc("Obie", "Home", 1200),
    pc(null, null, 100),
    { kind: "life" as const, carrier: "AHL", product: "Term", policies: 1, premiumCents: 999_900 },
  ]);
  assert.deepEqual(
    lines.map((l) => [l.name, l.policies, l.cents / 100]),
    [
      ["Auto", 3, 1870],
      ["Home", 2, 2500],
      ["Umbrella", 1, 450],
      ["Renters", 1, 190],
      ["Other", 1, 100],
    ],
  );
  assert.deepEqual(
    carriers.map((c) => [c.name, c.policies, c.cents / 100, linesSummary(c.lines)]),
    [
      ["Progressive", 3, 1440, "Auto 2 · Renters 1"],
      ["Geico", 2, 1070, "Auto 1 · Umbrella 1"],
      ["HOAIC", 1, 1300, "Home 1"],
      ["Obie", 1, 1200, "Home 1"],
      ["Other", 1, 100, "Other 1"],
    ],
  );
});

test("every leaderboard: most premium, then most policies, then the name", () => {
  const people = [
    { name: "Moe", cents: 100, policies: 1 },
    { name: "Alex", cents: 100, policies: 2 },
    { name: "Anersi", cents: 100, policies: 2 },
    { name: "Maira", cents: 300, policies: 1 },
  ];
  assert.deepEqual(
    rankOrder(people, (p) => p.cents, (p) => p.policies).map((p) => p.name),
    ["Maira", "Alex", "Anersi", "Moe"],
  );
});
