// Writes the colorway blocks and the P&C color blocks of src/app/globals.css from
// design/colorways.mjs (the same source the mockup renderer uses). Run: npm run colorways
// The default colorway (Crimson) fills the base tokens; the others become html[data-colorway=…]
// blocks (dark, the app's default; light by choice; light on a light phone with "Auto") that
// outrank the base blocks. They re-color the accent only (never the neutrals).
// P&C's color works the same way on its own attribute: Dusty blue is the base, the others are
// html[data-pc-color=…] blocks, written after the colorways so the owner's P&C pick always wins.
import { readFileSync, writeFileSync } from "node:fs";
import { COLORWAYS, DEFAULT_PC_COLOR, PC_COLORS } from "../design/colorways.mjs";

const APP_COLORWAYS = ["crimson", "sky", "champion", "emerald"];
const DEFAULT = "crimson";
const FILE = new URL("../src/app/globals.css", import.meta.url).pathname;

/** "#c42b32" and 0.14 → "rgba(196,43,50,0.14)" (the soft accent fill and the muted share bars). */
const alpha = (hex, a) => {
  const h = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  return `rgba(${r},${g},${b},${a})`;
};

// Only the accent: since the CRM look (2026-11-12) a colorway never changes the app's neutrals
// (page, card, raised, line, track, segment), whatever design/colorways.mjs gives the mockups.
const lines = (t, indent, mode) =>
  [
    `--t-accent: ${t.accent};`,
    `--t-accent-text: ${t.accentText};`,
    `--t-tint: ${t.tint};`,
    `--t-accent-soft: ${alpha(t.accent, mode === "dark" ? 0.14 : 0.1)};`,
    `--t-grad-from: ${t.gradFrom};`,
    `--t-grad-to: ${t.gradTo};`,
    `--t-grad: linear-gradient(90deg, ${t.gradFrom}, ${t.gradTo});`,
    `--t-grad-strong: linear-gradient(90deg, ${t.strongFrom}, ${t.strongTo});`,
    `--t-bar-grad: linear-gradient(90deg, ${alpha(t.gradFrom, 0.42)}, ${alpha(t.gradTo, 0.42)});`,
    `--t-glow: ${t.glow};`,
    `--t-bar: ${t.bar};`,
    `--t-chip-bg: ${t.chipBg};`,
    `--t-chip-text: ${t.chipText};`,
    `--t-chart-1: ${t.chart1};`,
    `--t-chart-2: ${t.chart2};`,
    t.down && `--t-down: ${t.down};`,
    // P&C's color is not part of a colorway: the owner picks it on its own (PC_COLORS below).
  ]
    .filter(Boolean)
    .map((l) => indent + l)
    .join("\n");

const byKey = Object.fromEntries(COLORWAYS.map((c) => [c.key, c]));
for (const k of APP_COLORWAYS) if (!byKey[k]) throw new Error(`no colorway ${k} in design/colorways.mjs`);

let out = `/* colorways:start (written by scripts/gen-colorway-css.mjs; edit design/colorways.mjs instead) */\n`;
out += `/* The default colorway is ${byKey[DEFAULT].name}: its values are the base tokens above. The others apply through data-colorway on <html>. */\n`;
for (const k of APP_COLORWAYS.filter((k) => k !== DEFAULT)) {
  const c = byKey[k];
  out += `/* ${c.name}: ${c.idea} */\n`;
  out += `html[data-colorway="${k}"] {\n${lines(c.dark, "  ", "dark")}\n}\n`;
  out += `html[data-colorway="${k}"][data-theme="light"] {\n${lines(c.light, "  ", "light")}\n}\n`;
  out += `@media (prefers-color-scheme: light) {\n  html[data-colorway="${k}"][data-theme="auto"] {\n${lines(c.light, "    ", "light")}\n  }\n}\n`;
}
out += `/* colorways:end */`;

const APP_PC_COLORS = ["dusty", "silver", "sage", "ocean"];
const pcByKey = Object.fromEntries(PC_COLORS.map((c) => [c.key, c]));
for (const k of APP_PC_COLORS) if (!pcByKey[k]) throw new Error(`no P&C color ${k} in design/colorways.mjs`);
const pcLines = (t, indent) =>
  [`--t-pc: ${t.pc};`, `--t-pc-text: ${t.pcText};`, `--t-pc-tint: ${t.pcTint};`, `--t-pc-from: ${t.pcFrom};`, `--t-pc-to: ${t.pcTo};`].map((l) => indent + l).join("\n");

let pcOut = `/* pc-colors:start (written by scripts/gen-colorway-css.mjs; edit PC_COLORS in design/colorways.mjs instead) */\n`;
pcOut += `/* P&C's default color is ${pcByKey[DEFAULT_PC_COLOR].name}: its values are the base tokens above. The others apply through data-pc-color on <html>. */\n`;
for (const k of APP_PC_COLORS.filter((k) => k !== DEFAULT_PC_COLOR)) {
  const c = pcByKey[k];
  pcOut += `/* ${c.name}: ${c.idea} */\n`;
  pcOut += `html[data-pc-color="${k}"] {\n${pcLines(c.dark, "  ")}\n}\n`;
  pcOut += `html[data-pc-color="${k}"][data-theme="light"] {\n${pcLines(c.light, "  ")}\n}\n`;
  pcOut += `@media (prefers-color-scheme: light) {\n  html[data-pc-color="${k}"][data-theme="auto"] {\n${pcLines(c.light, "    ")}\n  }\n}\n`;
}
pcOut += `/* pc-colors:end */`;

let css = readFileSync(FILE, "utf8");
const start = css.indexOf("/* colorways:start");
const end = css.indexOf("/* colorways:end */");
if (start < 0 || end < 0) throw new Error("globals.css has no colorways:start / colorways:end markers");
css = css.slice(0, start) + out + css.slice(end + "/* colorways:end */".length);

// The P&C blocks sit right after the colorways (added there the first time).
const pcStart = css.indexOf("/* pc-colors:start");
const pcEnd = css.indexOf("/* pc-colors:end */");
if (pcStart < 0 || pcEnd < 0) {
  const at = css.indexOf("/* colorways:end */") + "/* colorways:end */".length;
  css = css.slice(0, at) + "\n" + pcOut + css.slice(at);
} else {
  css = css.slice(0, pcStart) + pcOut + css.slice(pcEnd + "/* pc-colors:end */".length);
}

// The base tokens carry the default P&C color in light and dark: refuse to write a file where they drifted.
const base = css.slice(0, css.indexOf("/* colorways:start"));
const dpc = pcByKey[DEFAULT_PC_COLOR];
for (const [mode, t] of [["light", dpc.light], ["dark", dpc.dark]]) {
  for (const [name, value] of [["pc", t.pc], ["pc-text", t.pcText], ["pc-tint", t.pcTint], ["pc-from", t.pcFrom], ["pc-to", t.pcTo]]) {
    if (!base.includes(`--t-${name}: ${value};`)) throw new Error(`globals.css base ${mode} tokens: --t-${name} should be ${value} (${dpc.name})`);
  }
}
const dc = byKey[DEFAULT];
for (const [mode, t] of [["light", dc.light], ["dark", dc.dark]]) {
  for (const [name, value] of [["accent", t.accent], ["accent-text", t.accentText], ["grad-from", t.gradFrom], ["grad-to", t.gradTo], ["chip-text", t.chipText]]) {
    if (!base.includes(`--t-${name}: ${value};`)) throw new Error(`globals.css base ${mode} tokens: --t-${name} should be ${value} (${dc.name})`);
  }
}
writeFileSync(FILE, css);

// The base tokens: print them so the one-time edit of the light/dark blocks can be checked.
const d = byKey[DEFAULT];
console.log(`wrote ${APP_COLORWAYS.length - 1} colorway blocks and ${APP_PC_COLORS.length - 1} P&C color blocks into src/app/globals.css (defaults ${d.name}, ${dpc.name})`);
