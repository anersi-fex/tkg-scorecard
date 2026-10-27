/** Rows as the app reads them (cents everywhere; dates as "YYYY-MM-DD"; instants as ISO strings). */

export interface Agent {
  id: string;
  name: string;
  active: boolean;
  sort: number;
}

export type LoggedBy = "owner" | "team" | "shortcut";

export interface Sale {
  id: string;
  agent_id: string;
  premium_cents: number;
  policies: number;
  product: string | null;
  client: string | null;
  note: string | null;
  sold_on: string;
  logged_by: LoggedBy;
  created_at: string;
}

import { DEFAULT_COLORWAY, type ColorwayKey } from "./colorways";

export interface AppSettings {
  /** One line under the board's title ("Q4 push: every policy counts"). */
  message: string;
  /** The product chips on the Log a sale screen. */
  products: string[];
  /** The color story on every screen and the TV (Settings > Colorway). */
  colorway: ColorwayKey;
}

export const DEFAULT_PRODUCTS = ["Term", "Whole life", "Final expense", "IUL", "Other"];

export const DEFAULT_SETTINGS: AppSettings = { message: "", products: DEFAULT_PRODUCTS, colorway: DEFAULT_COLORWAY };
