import { test } from "node:test";
import assert from "node:assert/strict";
import { addDays, addMonths, datesOfMonth, isBusinessDay, isDateKey, isMonthKey, monthClock, monthLabel, pace, todayInDetroit } from "../src/lib/month";
import { formatCompact, formatDollars, formatMoney, parseDollars, percentOf } from "../src/lib/money";

test("today in Detroit rolls over at midnight Eastern, not UTC", () => {
  // 03:30 UTC on Oct 28 is 23:30 on Oct 27 in Detroit (EDT).
  assert.equal(todayInDetroit(new Date("2026-10-28T03:30:00Z")), "2026-10-27");
  assert.equal(todayInDetroit(new Date("2026-10-28T04:30:00Z")), "2026-10-28");
  // In winter (EST) the line moves to 05:00 UTC.
  assert.equal(todayInDetroit(new Date("2026-12-10T04:30:00Z")), "2026-12-09");
});

test("date and month keys", () => {
  assert.ok(isDateKey("2026-02-28"));
  assert.ok(!isDateKey("2026-02-30"));
  assert.ok(!isDateKey("2026-13-01"));
  assert.ok(isMonthKey("2026-12"));
  assert.ok(!isMonthKey("2026-00"));
  assert.equal(addMonths("2026-12", 1), "2027-01");
  assert.equal(addMonths("2026-01", -1), "2025-12");
  assert.equal(addDays("2026-10-31", 1), "2026-11-01");
  assert.equal(monthLabel("2026-10"), "October 2026");
  assert.equal(datesOfMonth("2024-02").length, 29);
});

test("business days", () => {
  assert.ok(isBusinessDay("2026-10-27")); // Tuesday
  assert.ok(!isBusinessDay("2026-10-31")); // Saturday
  const c = monthClock("2026-10", "2026-10-27");
  assert.equal(c.businessDays, 22);
  assert.equal(c.elapsed, 19); // Oct 1 to Oct 27, weekdays, today included
  assert.equal(c.remaining, 4); // Oct 27, 28, 29, 30
  assert.equal(c.calendarRemaining, 5);
  assert.equal(c.position, "current");
});

test("the clock on a weekend and outside the month", () => {
  const sat = monthClock("2026-10", "2026-10-31");
  assert.equal(sat.elapsed, 22);
  assert.equal(sat.remaining, 0);
  assert.equal(sat.calendarRemaining, 1);
  const past = monthClock("2026-09", "2026-10-27");
  assert.equal(past.position, "past");
  assert.equal(past.elapsed, past.businessDays);
  assert.equal(past.remaining, 0);
  const future = monthClock("2026-11", "2026-10-27");
  assert.equal(future.position, "future");
  assert.equal(future.elapsed, 0);
  assert.equal(future.remaining, future.businessDays);
});

test("pace", () => {
  const c = monthClock("2026-10", "2026-10-27");
  const p = pace(100_000_00, 150_000_00, c); // $100k of $150k with 19 of 22 days gone
  assert.equal(p.projectedCents, Math.round((100_000_00 / 19) * 22));
  assert.equal(p.expectedCents, Math.round(150_000_00 * (19 / 22)));
  assert.equal(p.status, "behind");
  assert.equal(p.neededPerDayCents, Math.ceil(50_000_00 / 4));
  assert.equal(pace(160_000_00, 150_000_00, c).status, "done");
  assert.equal(pace(0, 0, c).status, "none");
  const start = monthClock("2026-11", "2026-10-27");
  assert.equal(pace(0, 100_00, start).projectedCents, 0);
  assert.equal(pace(0, 100_00, start).neededPerDayCents, Math.ceil(100_00 / start.businessDays));
});

test("money", () => {
  assert.equal(formatDollars(1245050), "$12,451");
  assert.equal(formatMoney(1245050), "$12,450.50");
  assert.equal(formatMoney(1200000), "$12,000");
  assert.equal(formatCompact(1245050), "$12k");
  assert.equal(formatCompact(125000), "$1.3k");
  assert.equal(formatCompact(150000000), "$1.5M");
  assert.equal(parseDollars("$1,250.5"), 125050);
  assert.equal(parseDollars("1250"), 125000);
  assert.equal(parseDollars("abc"), null);
  assert.equal(parseDollars("-5"), null);
  assert.equal(parseDollars("99999999"), null);
  assert.equal(percentOf(50, 200), 25);
  assert.equal(percentOf(50, 0), 0);
});
