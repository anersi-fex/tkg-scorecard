/**
 * P&C's own color, which the owner picks in Settings > P&C color (owner, 2026-11-04: "just pick one
 * for me ... you can have options for it as well in the settings"): Dusty blue by default, Silver,
 * Sage and Ocean as the alternatives. The CSS lives in src/app/globals.css (Dusty blue is the base
 * tokens; the others are html[data-pc-color] blocks written by scripts/gen-colorway-css.mjs from
 * PC_COLORS in design/colorways.mjs). The swatches here are only for the picker (light pcFrom/pcTo).
 * Browser-safe.
 */
import type { ColorwayKey } from "./colorways";

export const PC_COLOR_KEYS = ["dusty", "silver", "sage", "ocean"] as const;
export type PcColorKey = (typeof PC_COLOR_KEYS)[number];
export const DEFAULT_PC_COLOR: PcColorKey = "dusty";

export const PC_COLORS: Record<PcColorKey, { name: string; idea: string; swatch: [string, string] }> = {
  dusty: { name: "Dusty blue", idea: "A soft, grayed blue.", swatch: ["#4e6f9f", "#7d9fcd"] },
  silver: { name: "Silver", idea: "Steel to silver, softly.", swatch: ["#6f7f96", "#a3b0c2"] },
  sage: { name: "Sage", idea: "A light, muted green.", swatch: ["#4f8a6e", "#86bb9f"] },
  ocean: { name: "Ocean", idea: "Sea blue, hint of teal.", swatch: ["#2f7f9e", "#6cb2cc"] },
};

export function isPcColorKey(v: unknown): v is PcColorKey {
  return typeof v === "string" && (PC_COLOR_KEYS as readonly string[]).includes(v);
}

/** A P&C color in the same family as the colorway, so P&C could pass for life (Sky is blue, Emerald green). */
export function pcLooksLikeLife(colorway: ColorwayKey, pc: PcColorKey): boolean {
  return (colorway === "sky" && (pc === "dusty" || pc === "ocean")) || (colorway === "emerald" && pc === "sage");
}
