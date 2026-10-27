import "server-only";
import { cache } from "react";
import { getSettings } from "./data";
import { dbConfigured } from "./supabase";
import { DEFAULT_COLORWAY, type ColorwayKey } from "./colorways";
import { DEFAULT_BOARD_THEME, type BoardTheme } from "./types";

export interface Look {
  /** For <html data-colorway>: the setting when the database answers, else Crimson. */
  colorway: ColorwayKey;
  /** For <html data-board-theme>: what the TV opens in (theme-script.ts reads it before paint). */
  boardTheme: BoardTheme;
}

const FALLBACK: Look = { colorway: DEFAULT_COLORWAY, boardTheme: DEFAULT_BOARD_THEME };

/** The owner's look settings for the root layout, once per request; the defaults when the database does not answer. */
export const loadLook = cache(async (): Promise<Look> => {
  if (!dbConfigured()) return FALLBACK;
  try {
    const s = await getSettings();
    return { colorway: s.colorway, boardTheme: s.boardTheme };
  } catch {
    return FALLBACK;
  }
});
