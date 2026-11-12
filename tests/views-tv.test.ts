import { test } from "node:test";
import assert from "node:assert/strict";
import { firstCompare, quietTeams, shareOf, sparkValues, tableDays, teamLabel } from "../src/lib/views";

// The Scoreboard's and the TV's helpers for the CRM look (2026-11-12). Invented names only.

test("firstCompare: only an empty comparison says First month on Scorecard", () => {
  assert.equal(firstCompare({ prevProductionCents: 0, prevPolicies: 0, prevActiveAgents: 0 }), true);
  assert.equal(firstCompare({ prevProductionCents: 0, prevPolicies: 1, prevActiveAgents: 0 }), false);
  assert.equal(firstCompare({ prevProductionCents: 500, prevPolicies: 0, prevActiveAgents: 0 }), false);
});

test("sparkValues: business days through yesterday, today once it has something", () => {
  // 2026-11-06 is a Friday, 07 and 08 the weekend, 09 a Monday.
  const days = ["2026-11-05", "2026-11-06", "2026-11-07", "2026-11-08", "2026-11-09"];
  assert.deepEqual(sparkValues(days, [1, 2, 3, 4, 0], "2026-11-09"), [1, 2]);
  assert.deepEqual(sparkValues(days, [1, 2, 3, 4, 7], "2026-11-09"), [1, 2, 7]);
  // A finished month: every business day.
  assert.deepEqual(sparkValues(days, [1, 2, 3, 4, 0], "9999-12-31"), [1, 2, 0]);
});

test("tableDays: the last days that count, a weekend day only when someone sold on it", () => {
  const days = ["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06", "2026-11-07", "2026-11-08", "2026-11-09"];
  const sold = new Set(["2026-11-07"]);
  assert.deepEqual(tableDays(days, (d) => sold.has(d), "2026-11-09", 5), ["2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06", "2026-11-07"]);
  sold.add("2026-11-09");
  assert.deepEqual(tableDays(days, (d) => sold.has(d), "2026-11-09", 3), ["2026-11-06", "2026-11-07", "2026-11-09"]);
});

test("quietTeams: leaders with no sale yet, all levels, a loop never hangs", () => {
  const people = [
    { id: "a", name: "Avery Stone", active: true, uplineId: null },
    { id: "b", name: "Blake Reed", active: true, uplineId: "a" },
    { id: "c", name: "Casey Lane", active: true, uplineId: "b" },
    { id: "d", name: "Drew Park", active: false, uplineId: "c" },
    { id: "e", name: "Emery Fox", active: true, uplineId: "f" },
    { id: "f", name: "Finley Moss", active: true, uplineId: "e" },
  ];
  const quiet = quietTeams(people, ["a"]);
  assert.deepEqual(
    quiet.map((t) => [t.leaderId, t.members]),
    [
      ["b", 2],
      ["e", 2],
      ["f", 2],
    ],
  );
});

test("teamLabel and shareOf", () => {
  assert.equal(teamLabel("Nora Quill"), "Nora Quill’s team");
  assert.equal(teamLabel("Lucas"), "Lucas’ team");
  assert.equal(shareOf(0, 100), 2);
  assert.equal(shareOf(50, 100), 50);
  assert.equal(shareOf(500, 100), 100);
});
