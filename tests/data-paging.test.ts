import { test } from "node:test";
import assert from "node:assert/strict";
import { req } from "./stand-in";

/** Paged reads count each sale once (src/lib/data.ts readAllPages, which salesBetween reads through). */
const { readAllPages } = req("../src/lib/data") as typeof import("../src/lib/data");

const row = (n: number) => ({ id: `sale-${n}` });
const page = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => row(from + i));

test("a sale logged between two page reads shifts the rows: the one that moved over the seam comes back once", async () => {
  const calls: [number, number][] = [];
  // Page 0 is rows 0..999. A sale lands at the front before page 1 is read, so page 1 starts with
  // row 999 again (it moved from index 999 to 1000) and holds 1000 more after it: 3 pages in all.
  const out = await readAllPages(async (a, b) => {
    calls.push([a, b]);
    if (a === 0) return page(0, 999);
    if (a === 1000) return page(999, 1998);
    return page(1999, 2100);
  });
  assert.equal(calls.length, 3);
  assert.equal(out.length, 2101, "every row once");
  assert.equal(new Set(out.map((r) => r.id)).size, out.length);
  assert.deepEqual(out.slice(995, 1003).map((r) => r.id), ["sale-995", "sale-996", "sale-997", "sale-998", "sale-999", "sale-1000", "sale-1001", "sale-1002"], "the order is kept");
});

test("a list shorter than a page is one read; an empty list is empty; every page is asked for with its own bounds", async () => {
  const seen: [number, number][] = [];
  assert.deepEqual(await readAllPages(async (a, b) => (seen.push([a, b]), page(0, 9))), page(0, 9));
  assert.deepEqual(seen, [[0, 999]]);
  assert.deepEqual(await readAllPages(async () => []), []);
});

test("a full last page is followed by one more read that finds nothing", async () => {
  const reads: number[] = [];
  const out = await readAllPages(async (a) => {
    reads.push(a);
    return a === 0 ? page(0, 999) : [];
  });
  assert.equal(out.length, 1000);
  assert.deepEqual(reads, [0, 1000]);
});
