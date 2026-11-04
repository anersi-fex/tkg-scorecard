// Scorecard colorway candidates (2026-10-27): the same Tide type, cards and layout as Sales Coach,
// a different color story each. Every colorway gives light and dark values for the tokens the
// screens use; neutrals are Tide's unless the colorway sets its own.
export const COLORWAYS = [
  {
    key: "crimson",
    name: "Crimson",
    idea: "The Koka Group's own brand red, coral on dark. Sales-floor energy; the furthest from Sales Coach's cobalt.",
    light: { accent: "#c42b32", accentText: "#a3242a", tint: "#fdecec", gradFrom: "#c42b32", gradTo: "#ff6b57", strongFrom: "#b8262d", strongTo: "#d1392c", glow: "rgba(196,43,50,0.32)", bar: "#f3a6a0", chipBg: "#fde3e1", chipText: "#9a1f26", chart1: "#c42b32", chart2: "#e59d26", down: "#b45309" },
    dark: { accent: "#ff6b57", accentText: "#ff8a78", tint: "#3a1a1a", gradFrom: "#e5484d", gradTo: "#ff8a5c", strongFrom: "#c62f36", strongTo: "#d8503f", glow: "rgba(255,107,87,0.4)", bar: "#5a2a2d", chipBg: "#3d1a16", chipText: "#fca5a5", chart1: "#ff7a66", chart2: "#f5b942", down: "#fbbf24" },
  },
  {
    key: "emerald",
    name: "Emerald",
    idea: "Deep green to mint: money, growth, in the black. Calm and premium on the same cool neutrals.",
    light: { accent: "#0f7a4f", accentText: "#0b6a44", tint: "#e3f5ec", gradFrom: "#0b7a4f", gradTo: "#22a36e", strongFrom: "#0b6e47", strongTo: "#15895a", glow: "rgba(15,122,79,0.3)", bar: "#9bdcbb", chipBg: "#dcf3e7", chipText: "#0b5a3a", chart1: "#0f8f5a", chart2: "#c98a00" },
    dark: { accent: "#34d399", accentText: "#5ee3ad", tint: "#10332a", gradFrom: "#22b37a", gradTo: "#4ad99e", strongFrom: "#138a5b", strongTo: "#1aa36c", glow: "rgba(52,211,153,0.35)", bar: "#1f4a3a", chipBg: "#143221", chipText: "#86efac", chart1: "#34d399", chart2: "#f5c451" },
  },
  {
    key: "lagoon",
    name: "Lagoon",
    idea: "Teal to aqua, the family's lagoon water. Fresh and clearly its own next to cobalt.",
    light: { accent: "#0b7a70", accentText: "#0b6a62", tint: "#dff4f2", gradFrom: "#0b7a70", gradTo: "#12b5ae", strongFrom: "#0a6f66", strongTo: "#0e857f", glow: "rgba(11,122,112,0.3)", bar: "#99dcd6", chipBg: "#d7f1ee", chipText: "#0a5c56", chart1: "#0f9a92", chart2: "#d98a00" },
    dark: { accent: "#2fd4c6", accentText: "#5fe2d6", tint: "#0f3330", gradFrom: "#14b8ad", gradTo: "#4fe0d2", strongFrom: "#0f8f88", strongTo: "#149e96", glow: "rgba(47,212,198,0.35)", bar: "#1c4a47", chipBg: "#0f3330", chipText: "#99f0e8", chart1: "#2fd4c6", chart2: "#f5c451" },
  },
  {
    key: "champion",
    name: "Champion",
    idea: "Gold to bronze on warm neutrals: trophy case, podium, awards night. The warmest of the set.",
    light: { page: "#f6f4ef", card: "#ffffff", raised: "#f7f5f0", line: "#e8e4dc", track: "#e6e2d9", segment: "#ffffff", accent: "#a86a00", accentText: "#8a5600", tint: "#fbefd6", gradFrom: "#b8741a", gradTo: "#e0a030", strongFrom: "#8a5600", strongTo: "#a86a00", glow: "rgba(168,106,0,0.3)", bar: "#f0cf86", chipBg: "#fbefd6", chipText: "#7a4d00", chart1: "#b8741a", chart2: "#5b6b8a" },
    dark: { page: "#0f0d0a", card: "#1a1712", raised: "#221e17", line: "#2e2920", track: "#221e17", segment: "#332d24", accent: "#f5b942", accentText: "#f8c75e", tint: "#3a2c10", gradFrom: "#d99a1a", gradTo: "#f5c451", strongFrom: "#a86a00", strongTo: "#c48300", glow: "rgba(245,185,66,0.35)", bar: "#5a4420", chipBg: "#3d2a0a", chipText: "#fcd34d", chart1: "#f5b942", chart2: "#8da2c4" },
  },
  {
    key: "sky",
    name: "Sky",
    idea: "Sky blue to cyan: lighter, brighter and cooler than Sales Coach's cobalt, still a blue family cousin.",
    light: { accent: "#0369a1", accentText: "#075985", tint: "#e0f2fe", gradFrom: "#0284c7", gradTo: "#06b6d4", strongFrom: "#0369a1", strongTo: "#0e7490", glow: "rgba(2,132,199,0.3)", bar: "#7dd3fc", chipBg: "#e0f2fe", chipText: "#075985", chart1: "#0284c7", chart2: "#d98a00" },
    dark: { accent: "#38bdf8", accentText: "#7dd3fc", tint: "#0c2a3d", gradFrom: "#0ea5e9", gradTo: "#22d3ee", strongFrom: "#0369a1", strongTo: "#0e7490", glow: "rgba(56,189,248,0.35)", bar: "#1e3a4f", chipBg: "#0c2a3d", chipText: "#bae6fd", chart1: "#38bdf8", chart2: "#f5c451" },
  },
  {
    key: "field",
    name: "Field",
    idea: "Electric lime on navy at night, deep green by day: a stadium scoreboard. The boldest of the set.",
    light: { accent: "#4d7c0f", accentText: "#3f6212", tint: "#ecfccb", gradFrom: "#4d7c0f", gradTo: "#16a34a", strongFrom: "#3f6212", strongTo: "#4d7c0f", glow: "rgba(77,124,15,0.3)", bar: "#bef264", chipBg: "#ecfccb", chipText: "#365314", chart1: "#65a30d", chart2: "#334155" },
    dark: { page: "#0a1020", card: "#121a2e", raised: "#192339", line: "#243049", track: "#192339", segment: "#27334d", accent: "#a3e635", accentText: "#bef264", tint: "#1f2e12", gradFrom: "#84cc16", gradTo: "#a3e635", strongFrom: "#3f6212", strongTo: "#4d7c0f", glow: "rgba(163,230,53,0.3)", bar: "#3b5a1a", chipBg: "#1f2e12", chipText: "#d9f99d", chart1: "#a3e635", chart2: "#8da2c4" },
  },
];

/** The CSS that re-colors the live app for one colorway (both modes). */
export function overrideCss(c) {
  const block = (t) =>
    [
      t.page && `--t-page:${t.page}`,
      t.card && `--t-card:${t.card}`,
      t.raised && `--t-raised:${t.raised}`,
      t.line && `--t-line:${t.line}`,
      t.track && `--t-track:${t.track}`,
      t.segment && `--t-segment:${t.segment}`,
      `--t-accent:${t.accent}`,
      `--t-accent-text:${t.accentText}`,
      `--t-tint:${t.tint}`,
      `--t-grad-from:${t.gradFrom}`,
      `--t-grad-to:${t.gradTo}`,
      `--t-grad:linear-gradient(135deg,${t.gradFrom},${t.gradTo})`,
      `--t-grad-strong:linear-gradient(135deg,${t.strongFrom},${t.strongTo})`,
      `--t-glow:${t.glow}`,
      `--t-bar:${t.bar}`,
      `--t-chip-bg:${t.chipBg}`,
      `--t-chip-text:${t.chipText}`,
      `--t-chart-1:${t.chart1}`,
      `--t-chart-2:${t.chart2}`,
      t.down && `--t-down:${t.down}`,
    ]
      .filter(Boolean)
      .join(";");
  // html:root[...] outranks the theme's own :root[data-theme] blocks, so these win in both modes.
  return `html:root,html:root[data-theme="light"]{${block(c.light)}} html:root[data-theme="dark"]{${block(c.dark)}} @media (prefers-color-scheme: dark){html:root:not([data-theme="light"]){${block(c.dark)}}}`;
}
