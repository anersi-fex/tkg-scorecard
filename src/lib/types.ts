/** Rows as the app reads them (cents everywhere; dates as "YYYY-MM-DD"; instants as ISO strings). */

export interface Agent {
  id: string;
  name: string;
  active: boolean;
  sort: number;
  /** P&C licensed (the owner, Moe, Maira): Log a sale offers the Life / P&C switch for them. */
  pc_licensed: boolean;
}

export type LoggedBy = "owner" | "team" | "shortcut";

/** What a sale is: life insurance (every sale before 2026-11-04) or property and casualty. */
export type SaleKind = "life" | "pc";
export const SALE_KINDS: SaleKind[] = ["life", "pc"];
export function isSaleKind(v: unknown): v is SaleKind {
  return v === "life" || v === "pc";
}
export const KIND_LABEL: Record<SaleKind, string> = { life: "Life", pc: "P&C" };

export interface Sale {
  id: string;
  agent_id: string;
  premium_cents: number;
  policies: number;
  product: string | null;
  /** The carrier the policy was written with (Settings > Carriers, or the P&C carriers for a P&C sale). */
  carrier: string | null;
  kind: SaleKind;
  /** Unused since 2026-10-27 (the screens ask for the carrier instead); kept for older rows. */
  client: string | null;
  note: string | null;
  sold_on: string;
  logged_by: LoggedBy;
  created_at: string;
}

import { DEFAULT_COLORWAY, type ColorwayKey } from "./colorways";
import { DEFAULT_PC_COLOR, type PcColorKey } from "./pc-colors";
import { DEFAULT_SOUND, type SoundKey } from "./sounds";

/** The TV's look (Settings > TV look): dark, or light. Browser-safe. */
export type BoardTheme = "dark" | "light";
/** Screen order (Light then Dark, like the app's Appearance control). */
export const BOARD_THEMES: BoardTheme[] = ["light", "dark"];
export const DEFAULT_BOARD_THEME: BoardTheme = "dark";
export function isBoardTheme(v: unknown): v is BoardTheme {
  return v === "dark" || v === "light";
}

/** What the office TV shows (owner, 2026-11-04, Settings > TV screens): the three in rotation, or one kept on. */
export type TvScreens = "rotate" | "life" | "pc" | "total";
export const TV_SCREENS: TvScreens[] = ["rotate", "life", "pc", "total"];
export const DEFAULT_TV_SCREENS: TvScreens = "rotate";
export function isTvScreens(v: unknown): v is TvScreens {
  return v === "rotate" || v === "life" || v === "pc" || v === "total";
}

export interface AppSettings {
  /** One line under the board's title ("Q4 push: every policy counts"). */
  message: string;
  /** The product chips on the Log a sale screen. */
  products: string[];
  /** The carrier chips on the Log a sale screen (a sale always names one). */
  carriers: string[];
  /** The P&C carriers and the lines each one writes (owner, 2026-11-04), for a P&C sale. */
  pcCarriers: PcCarrier[];
  /** The color story on every screen and the TV (Settings > Colorway). */
  colorway: ColorwayKey;
  /** P&C's own color on every screen and the TV (Settings > P&C color). */
  pcColor: PcColorKey;
  /** Dark or light on the TV (Settings > TV look); the TV follows it from its poll. */
  boardTheme: BoardTheme;
  /** The sound the TV plays when a sale lands (Settings > Sale sound); "off" for none. */
  sound: SoundKey;
  /** Rotate the TV's three screens, or keep it on one (Settings > TV screens). */
  tvScreens: TvScreens;
}

export interface PcCarrier {
  name: string;
  /** The lines this carrier writes (Auto, Home, Renters, Dwelling, Umbrella, ATV …). */
  lines: string[];
}

export const DEFAULT_PRODUCTS = ["Term", "Whole life", "Final expense", "IUL", "Other"];
/** The owner's P&C carriers and lines (2026-11-04). */
export const DEFAULT_PC_CARRIERS: PcCarrier[] = [
  { name: "Progressive", lines: ["Auto", "Renters", "ATV"] },
  { name: "Geico", lines: ["Auto", "Umbrella"] },
  { name: "Steadily", lines: ["Dwelling"] },
  { name: "HOAIC", lines: ["Home"] },
  { name: "Obie", lines: ["Home", "Dwelling"] },
];
/** The owner's carriers (2026-10-27). */
export const DEFAULT_CARRIERS = ["AHL", "AmAm", "Americo", "Foresters", "Newbridge", "Royal", "UHL"];

export const DEFAULT_SETTINGS: AppSettings = {
  message: "",
  products: DEFAULT_PRODUCTS,
  carriers: DEFAULT_CARRIERS,
  pcCarriers: DEFAULT_PC_CARRIERS,
  colorway: DEFAULT_COLORWAY,
  pcColor: DEFAULT_PC_COLOR,
  boardTheme: DEFAULT_BOARD_THEME,
  sound: DEFAULT_SOUND,
  tvScreens: DEFAULT_TV_SCREENS,
};
