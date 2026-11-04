import type { SaleKind, TvScreens } from "./types";

/**
 * The three views of the month (owner, 2026-11-04: "The goal amount ... should be life insurance
 * sales ... a whole separate leaderboard being P&C ... a total added up for the entire agency"):
 * life, the one the goal and the pace measure; P&C, its own board; and the agency total, both added
 * up. Pure and browser-safe: the snapshot, the TV and the phone share it.
 */
export type View = "life" | "pc" | "total";
export const VIEWS: View[] = ["life", "pc", "total"];
export function isView(v: unknown): v is View {
  return v === "life" || v === "pc" || v === "total";
}
export const VIEW_LABEL: Record<View, string> = { life: "Life", pc: "P&C", total: "Agency total" };

/** How long each screen stays on the TV while it rotates: life the longest (owner: "the most time on screen"). */
export const SCREEN_MS: Record<View, number> = { life: 60_000, pc: 15_000, total: 15_000 };

/**
 * The screen after `current` while the TV rotates: life, then P&C, then the agency total. With no
 * P&C this month the TV stays on life, since the other two would only repeat it.
 */
export function nextScreen(current: View, hasPc: boolean): View {
  if (!hasPc) return "life";
  return current === "life" ? "pc" : current === "pc" ? "total" : "life";
}

/** The screen the TV shows for the owner's setting (Settings > TV screens) and where the rotation is. */
export function screenFor(setting: TvScreens, rotating: View): View {
  return setting === "rotate" ? rotating : setting;
}

/** Most premium, then most policies, then the name: every leaderboard's order. */
export function rankOrder<T extends { name: string }>(items: T[], cents: (t: T) => number, policies: (t: T) => number): T[] {
  return [...items].sort((a, b) => cents(b) - cents(a) || policies(b) - policies(a) || a.name.localeCompare(b.name));
}

/** A P&C line (Auto, Home …) or carrier with its policies and premium. */
export interface PcCount {
  name: string;
  policies: number;
  cents: number;
}
export interface PcCarrierCount extends PcCount {
  /** The lines written with this carrier, most policies first. */
  lines: { name: string; policies: number }[];
}

interface PcSaleLike {
  kind: SaleKind;
  carrier: string | null;
  product: string | null;
  policies: number;
  premiumCents: number;
}

const byCount = <T extends { name: string; policies: number; cents?: number }>(a: T, b: T) => b.policies - a.policies || (b.cents ?? 0) - (a.cents ?? 0) || a.name.localeCompare(b.name);

/**
 * The month's P&C by line (a P&C sale's product is its line) and by carrier, most policies first.
 * A sale with no line or carrier counts under "Other"; life sales are left out.
 */
export function pcBreakdown(sales: PcSaleLike[]): { lines: PcCount[]; carriers: PcCarrierCount[] } {
  const lines = new Map<string, PcCount>();
  const carriers = new Map<string, { name: string; policies: number; cents: number; lines: Map<string, number> }>();
  for (const s of sales) {
    if (s.kind !== "pc") continue;
    const line = s.product?.trim() || "Other";
    const carrier = s.carrier?.trim() || "Other";
    const l = lines.get(line) ?? { name: line, policies: 0, cents: 0 };
    l.policies += s.policies;
    l.cents += s.premiumCents;
    lines.set(line, l);
    const c = carriers.get(carrier) ?? { name: carrier, policies: 0, cents: 0, lines: new Map<string, number>() };
    c.policies += s.policies;
    c.cents += s.premiumCents;
    c.lines.set(line, (c.lines.get(line) ?? 0) + s.policies);
    carriers.set(carrier, c);
  }
  return {
    lines: [...lines.values()].sort(byCount),
    carriers: [...carriers.values()]
      .map((c) => ({ name: c.name, policies: c.policies, cents: c.cents, lines: [...c.lines.entries()].map(([name, policies]) => ({ name, policies })).sort(byCount) }))
      .sort(byCount),
  };
}

/** "Auto 6 · Home 4 · Dwelling 2" for a person's or a carrier's lines. */
export function linesSummary(lines: { name: string; policies: number }[]): string {
  return lines.map((l) => `${l.name} ${l.policies}`).join(" · ");
}

/** The month chart for life alone: each day's life premium and its running total. */
export function lifeDaily<T extends { cents: number; cumulativeCents: number; lifeCents: number; lifeCumulativeCents: number }>(daily: T[]): T[] {
  return daily.map((d) => ({ ...d, cents: d.lifeCents, cumulativeCents: d.lifeCumulativeCents }));
}
