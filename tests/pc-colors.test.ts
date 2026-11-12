import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DEFAULT_PC_COLOR, PC_COLORS, PC_COLOR_KEYS, isPcColorKey, pcLooksLikeLife } from "../src/lib/pc-colors";
import { buildSnapshot } from "../src/lib/snapshot";
import { DEFAULT_PC_COLOR as DESIGN_DEFAULT, PC_COLORS as DESIGN } from "../design/colorways.mjs";

type Tokens = { pc: string; pcText: string; pcTint: string; pcFrom: string; pcTo: string };
type DesignColor = { key: string; name: string; light: Tokens; dark: Tokens };
const design = DESIGN as DesignColor[];
const css = readFileSync(new URL("../src/app/globals.css", import.meta.url), "utf8");

test("the picker's colors are the design source's, Dusty blue first and by default", () => {
  assert.deepEqual([...PC_COLOR_KEYS], design.map((c) => c.key));
  assert.equal(DEFAULT_PC_COLOR, "dusty");
  assert.equal(DESIGN_DEFAULT, DEFAULT_PC_COLOR);
  for (const c of design) {
    const key = c.key as keyof typeof PC_COLORS;
    assert.equal(PC_COLORS[key].name, c.name);
    assert.deepEqual(PC_COLORS[key].swatch, [c.light.pcFrom, c.light.pcTo], `${c.key} swatch`);
  }
});

test("globals.css: Dusty blue in the base tokens, the others as data-pc-color blocks in light and dark", () => {
  const base = css.slice(0, css.indexOf("/* colorways:start"));
  const dusty = design.find((c) => c.key === "dusty")!;
  for (const t of [dusty.light, dusty.dark]) {
    for (const [name, value] of [["pc", t.pc], ["pc-text", t.pcText], ["pc-tint", t.pcTint], ["pc-from", t.pcFrom], ["pc-to", t.pcTo]]) {
      assert.ok(base.includes(`--t-${name}: ${value};`), `base --t-${name} ${value}`);
    }
  }
  for (const c of design.filter((c) => c.key !== "dusty")) {
    assert.ok(css.includes(`html[data-pc-color="${c.key}"] {\n  --t-pc: ${c.dark.pc};`), `${c.key} dark (the default)`);
    assert.ok(css.includes(`html[data-pc-color="${c.key}"][data-theme="light"] {\n  --t-pc: ${c.light.pc};`), `${c.key} light`);
    assert.ok(css.includes(`html[data-pc-color="${c.key}"][data-theme="auto"] {\n    --t-pc: ${c.light.pc};`), `${c.key} phone light`);
  }
  // After the colorways, so the owner's P&C pick wins over anything a colorway sets.
  assert.ok(css.indexOf("/* pc-colors:start") > css.indexOf("/* colorways:end */"));
});

test("a P&C color in the colorway's own family is flagged", () => {
  assert.equal(pcLooksLikeLife("crimson", "dusty"), false);
  assert.equal(pcLooksLikeLife("sky", "dusty"), true);
  assert.equal(pcLooksLikeLife("sky", "ocean"), true);
  assert.equal(pcLooksLikeLife("sky", "silver"), false);
  assert.equal(pcLooksLikeLife("emerald", "sage"), true);
  assert.equal(pcLooksLikeLife("emerald", "dusty"), false);
  assert.equal(isPcColorKey("ocean"), true);
  assert.equal(isPcColorKey("purple"), false);
  assert.equal(isPcColorKey(undefined), false);
});

test("the snapshot carries the P&C color to the TV, Dusty blue when none is set", () => {
  const input = { month: "2026-11", today: "2026-11-18", agents: [], sales: [], goals: { teamCents: 0, byAgent: {} }, recent: [], message: "" };
  assert.equal(buildSnapshot(input).pcColor, "dusty");
  assert.equal(buildSnapshot({ ...input, pcColor: "sage" }).pcColor, "sage");
});
