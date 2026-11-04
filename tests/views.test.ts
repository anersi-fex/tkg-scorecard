import { test } from "node:test";
import assert from "node:assert/strict";
import { SCREEN_MS, isView, linesSummary, nextScreen, pcBreakdown, rankOrder, screenFor } from "../src/lib/views";

test("the TV rotates life, P&C, agency total, and life has the most time on screen", () => {
  assert.equal(nextScreen("life", true), "pc");
  assert.equal(nextScreen("pc", true), "total");
  assert.equal(nextScreen("total", true), "life");
  // No P&C this month: the other two would only repeat life, so the TV stays there
  assert.equal(nextScreen("life", false), "life");
  assert.equal(nextScreen("pc", false), "life");
  assert.ok(SCREEN_MS.life > SCREEN_MS.pc + SCREEN_MS.total);
});

test("Settings > TV screens keeps the TV on one screen, or lets it rotate", () => {
  assert.equal(screenFor("rotate", "pc"), "pc");
  assert.equal(screenFor("life", "pc"), "life");
  assert.equal(screenFor("pc", "life"), "pc");
  assert.equal(screenFor("total", "life"), "total");
  assert.ok(isView("total") && !isView("rotate") && !isView(""));
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
