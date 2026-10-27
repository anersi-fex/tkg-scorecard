import "server-only";
import { cache } from "react";
import { getSettings } from "./data";
import { dbConfigured } from "./supabase";
import { DEFAULT_COLORWAY, type ColorwayKey } from "./colorways";

/** The colorway for <html data-colorway>: the setting when the database answers, else Crimson. */
export const loadColorway = cache(async (): Promise<ColorwayKey> => {
  if (!dbConfigured()) return DEFAULT_COLORWAY;
  try {
    return (await getSettings()).colorway;
  } catch {
    return DEFAULT_COLORWAY;
  }
});
