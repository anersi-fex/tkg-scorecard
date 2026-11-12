import { test } from "node:test";
import assert from "node:assert/strict";
import { clockTime, dateLong, dayShort, daysBetween, firstName, listWords, monthWord, policiesWord, previewSale, rankChangeOf, rankOf, shortName, stamp, type BoardLine } from "../src/components/policy/format";

test("dates and clock times read in Detroit", () => {
  assert.equal(dayShort("2026-11-09"), "Nov 9");
  assert.equal(dayShort(""), "");
  assert.equal(dateLong("2026-12-01"), "December 1, 2026");
  assert.equal(dateLong(null), "");
  assert.equal(monthWord("2026-12"), "December");
  // 23:46 UTC on Nov 11 is 6:46 PM in Detroit (EST)
  assert.equal(clockTime("2026-11-11T23:46:00Z"), "6:46 PM");
  assert.equal(stamp("2026-11-11T23:46:00Z"), "Nov 11, 6:46 PM");
  // after midnight UTC it is still the evening before in Detroit
  assert.equal(stamp("2026-11-12T02:05:00Z"), "Nov 11, 9:05 PM");
  assert.equal(stamp("not a date"), "");
  assert.equal(daysBetween("2026-11-01", "2026-11-12"), 11);
});

test("names and counts", () => {
  assert.equal(shortName("Ada Quill Byron"), "Ada B.");
  assert.equal(shortName("Cher"), "Cher");
  assert.equal(firstName("  Ada Byron "), "Ada");
  assert.equal(listWords(["Ada"]), "Ada");
  assert.equal(listWords(["Ada", "Bo", "Cy"]), "Ada, Bo and Cy");
  assert.equal(policiesWord(1), "1 policy");
  assert.equal(policiesWord(4), "4 policies");
});

const board: BoardLine[] = [
  { id: "a", name: "Ada", cents: 500_000, policies: 4, todayCents: 0, todayPolicies: 0 },
  { id: "b", name: "Bo", cents: 300_000, policies: 3, todayCents: 250_000, todayPolicies: 2 },
  { id: "c", name: "Cy", cents: 300_000, policies: 2, todayCents: 0, todayPolicies: 0 },
  { id: "d", name: "Di", cents: 0, policies: 0 },
];

test("rank: premium, then policies, then name; nobody without a sale", () => {
  assert.equal(rankOf(board, "a"), 1);
  assert.equal(rankOf(board, "b"), 2);
  assert.equal(rankOf(board, "c"), 3);
  assert.equal(rankOf(board, "d"), null);
  assert.equal(rankOf(board, "zz"), null);
});

test("rank change since yesterday takes today's sales out", () => {
  // yesterday: a 5000, c 3000, b 500 → b was 3rd, now 2nd
  assert.equal(rankChangeOf(board, "b"), 1);
  assert.equal(rankChangeOf(board, "c"), -1);
  assert.equal(rankChangeOf(board, "a"), 0);
  assert.equal(rankChangeOf(board, "d"), null);
});

test("a sale's preview on the board", () => {
  assert.deepEqual(previewSale(board, "c", "Cy", 300_000), { before: 3, after: 1, centsBefore: 300_000, centsAfter: 600_000 });
  assert.deepEqual(previewSale(board, "d", "Di", 100_000), { before: null, after: 4, centsBefore: 0, centsAfter: 100_000 });
  assert.deepEqual(previewSale(board, "new", "Ed", 900_000), { before: null, after: 1, centsBefore: 0, centsAfter: 900_000 });
});
