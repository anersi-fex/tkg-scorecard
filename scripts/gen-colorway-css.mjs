// Writes the colorway blocks of src/app/globals.css from design/colorways.mjs (the same source
// the mockup renderer uses). Run: npm run colorways
// The default colorway (Crimson) fills the base tokens; the others become html[data-colorway=…]
// blocks (light, dark by choice, dark by the phone's setting) that outrank the base blocks.
import { readFileSync, writeFileSync } from "node:fs";
import { COLORWAYS } from "../design/colorways.mjs";

const APP_COLORWAYS = ["crimson", "sky", "champion", "emerald"];
const DEFAULT = "crimson";
const FILE = new URL("../src/app/globals.css", import.meta.url).pathname;

const lines = (t, indent) =>
  [
    t.page && `--t-page: ${t.page};`,
    t.card && `--t-card: ${t.card};`,
    t.raised && `--t-raised: ${t.raised};`,
    t.line && `--t-line: ${t.line};`,
    t.track && `--t-track: ${t.track};`,
    t.segment && `--t-segment: ${t.segment};`,
    `--t-accent: ${t.accent};`,
    `--t-accent-text: ${t.accentText};`,
    `--t-tint: ${t.tint};`,
    `--t-grad-from: ${t.gradFrom};`,
    `--t-grad-to: ${t.gradTo};`,
    `--t-grad: linear-gradient(135deg, ${t.gradFrom}, ${t.gradTo});`,
    `--t-grad-strong: linear-gradient(135deg, ${t.strongFrom}, ${t.strongTo});`,
    `--t-glow: ${t.glow};`,
    `--t-bar: ${t.bar};`,
    `--t-chip-bg: ${t.chipBg};`,
    `--t-chip-text: ${t.chipText};`,
    `--t-chart-1: ${t.chart1};`,
    `--t-chart-2: ${t.chart2};`,
    t.down && `--t-down: ${t.down};`,
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
  out += `html[data-colorway="${k}"] {\n${lines(c.light, "  ")}\n}\n`;
  out += `html[data-colorway="${k}"][data-theme="dark"] {\n${lines(c.dark, "  ")}\n}\n`;
  out += `@media (prefers-color-scheme: dark) {\n  html[data-colorway="${k}"]:not([data-theme="light"]) {\n${lines(c.dark, "    ")}\n  }\n}\n`;
}
out += `/* colorways:end */`;

let css = readFileSync(FILE, "utf8");
const start = css.indexOf("/* colorways:start");
const end = css.indexOf("/* colorways:end */");
if (start < 0 || end < 0) throw new Error("globals.css has no colorways:start / colorways:end markers");
css = css.slice(0, start) + out + css.slice(end + "/* colorways:end */".length);
writeFileSync(FILE, css);

// The base tokens: print them so the one-time edit of the light/dark blocks can be checked.
const d = byKey[DEFAULT];
console.log(`wrote ${APP_COLORWAYS.length - 1} colorway blocks into src/app/globals.css (default ${d.name})`);
