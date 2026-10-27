/**
 * The colorways the owner can pick in Settings (owner pick 2026-10-27: Crimson by default; Sky,
 * Champion and Emerald as the alternatives). The CSS for each lives in src/app/globals.css
 * (Crimson is the base; the others are html[data-colorway] blocks written by
 * scripts/gen-colorway-css.mjs from design/colorways.mjs). The swatches here are only for the
 * picker; the app icons in public/ are drawn in Crimson and do not change with the setting.
 */
export const COLORWAY_KEYS = ["crimson", "sky", "champion", "emerald"] as const;
export type ColorwayKey = (typeof COLORWAY_KEYS)[number];
export const DEFAULT_COLORWAY: ColorwayKey = "crimson";

export const COLORWAYS: Record<ColorwayKey, { name: string; idea: string; swatch: [string, string] }> = {
  crimson: { name: "Crimson", idea: "The Koka Group's red, coral on dark.", swatch: ["#c42b32", "#ff6b57"] },
  sky: { name: "Sky", idea: "Sky blue to cyan, light and cool.", swatch: ["#0284c7", "#06b6d4"] },
  champion: { name: "Champion", idea: "Gold to bronze on warm neutrals.", swatch: ["#b8741a", "#e0a030"] },
  emerald: { name: "Emerald", idea: "Deep green to mint, money and growth.", swatch: ["#0b7a4f", "#22a36e"] },
};

export function isColorwayKey(v: unknown): v is ColorwayKey {
  return typeof v === "string" && (COLORWAY_KEYS as readonly string[]).includes(v);
}
