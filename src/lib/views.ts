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

/**
 * The office TV's screens (2026-11-12, Lineage): the leaderboard ("life", the office group on top),
 * the Scoreboard (the top numbers, where agents stand, moved most), Production (the day-by-day
 * table) and Teams; "pc" and "total" only while P&C is on (settings.app.pcEnabled).
 */
export type Screen = Exclude<TvScreens, "rotate">;
export const SCREEN_LABEL: Record<Screen, string> = { life: "Leaderboard", scoreboard: "Scoreboard", production: "Production", teams: "Teams", pc: "P&C", total: "Agency total" };

/** How long each screen stays on the TV while it rotates: the leaderboard 40 s, every other screen 20 s. */
export const SCREEN_MS: Record<Screen, number> = { life: 40_000, scoreboard: 20_000, production: 20_000, teams: 20_000, pc: 20_000, total: 20_000 };

/** What the month has to show, so the rotation skips a screen that would be empty. */
export interface ScreenFacts {
  /** The Scoreboard has numbers: it was loaded and somebody sold. */
  scoreboard: boolean;
  /** The day-by-day table has rows. */
  production: boolean;
  /** At least one team (a leader with people under them) sold. */
  teams: boolean;
  /** P&C is switched on (owner only); off, the TV never shows or names it. */
  pcEnabled: boolean;
  /** P&C is on and there is P&C this month. */
  pc: boolean;
}

/** The facts of a snapshot (only the fields read here, so tests need no whole snapshot). */
export function screenFacts(snap: { pcEnabled?: boolean; team: { pcCents: number }; scoreboard?: { rows: unknown[]; teams: unknown[] } | null }): ScreenFacts {
  const sb = snap.scoreboard ?? null;
  const sold = sb !== null && sb.rows.length > 0;
  const pcEnabled = snap.pcEnabled === true;
  return { scoreboard: sold, production: sold, teams: sb !== null && sb.teams.length > 0, pcEnabled, pc: pcEnabled && snap.team.pcCents > 0 };
}

/** The screens in rotation, in order: the leaderboard first, then each screen that has something to show. */
export function rotationScreens(facts: ScreenFacts): Screen[] {
  const out: Screen[] = ["life"];
  if (facts.scoreboard) out.push("scoreboard");
  if (facts.production) out.push("production");
  if (facts.teams) out.push("teams");
  if (facts.pc) out.push("pc", "total");
  return out;
}

/**
 * The screen after `current` while the TV rotates. A screen with nothing to show is skipped; when
 * only the leaderboard has something, the TV stays on it; a screen that just dropped out of the
 * rotation goes back to the leaderboard.
 */
export function nextScreen(current: Screen, facts: ScreenFacts): Screen {
  const list = rotationScreens(facts);
  return list[(list.indexOf(current) + 1) % list.length];
}

/**
 * The screen the TV shows for the setting (Settings > TV screens) and where the rotation is. Kept
 * on one screen, the TV shows that screen even while it is empty (it says so quietly), except P&C
 * and the agency total, which do not exist while P&C is off: the leaderboard shows.
 */
export function screenFor(setting: TvScreens, rotating: Screen, facts: ScreenFacts): Screen {
  if (setting === "rotate") return rotationScreens(facts).includes(rotating) ? rotating : "life";
  if ((setting === "pc" || setting === "total") && !facts.pcEnabled) return "life";
  return setting;
}

/** The view a screen measures on the shared right side (the goal ring, the tiles, the chart). */
export function viewOf(screen: Screen): View {
  return screen === "pc" || screen === "total" ? screen : "life";
}

/** One person as the TV's leaderboard needs them. */
export interface BoardPerson {
  name: string;
  active: boolean;
  inOffice: boolean;
  lifeCents: number;
  lifePolicies: number;
  /** Rank inside their group from the snapshot (0 while it is not filled). */
  groupRank?: number;
}

/**
 * The TV leaderboard's two groups (owner, 2026-11-12: "the ones in the office ... their numbers
 * should be showing at the top"): the office group ranked 1..n among themselves, then everyone
 * else ranked among themselves; one group while nobody is marked in office. Most life premium,
 * then most policies, then the name, so people with no sale yet come after the sellers. `place`
 * is the snapshot's `groupRank` when every person of the group has one, else the place in this order.
 */
export function boardGroups<T extends BoardPerson>(agents: T[]): { split: boolean; office: Array<T & { place: number }>; others: Array<T & { place: number }> } {
  const people = agents.filter((a) => a.active || a.lifeCents > 0);
  const split = people.some((a) => a.inOffice);
  const place = (group: T[]) => {
    const ordered = rankOrder(group, (a) => a.lifeCents, (a) => a.lifePolicies);
    const given = ordered.every((a) => (a.groupRank ?? 0) > 0);
    const out = ordered.map((a, i) => ({ ...a, place: given ? (a.groupRank as number) : i + 1 }));
    return given ? out.sort((a, b) => a.place - b.place) : out;
  };
  return split ? { split, office: place(people.filter((a) => a.inOffice)), others: place(people.filter((a) => !a.inOffice)) } : { split, office: place(people), others: [] };
}

/** How many pages a list needs when `perPage` rows fit (at least one). */
export function pageCount(count: number, perPage: number): number {
  return Math.max(1, Math.ceil(count / Math.max(1, perPage)));
}

/** The rows of one page; a page past the end wraps around. */
export function pageOf<T>(items: T[], page: number, perPage: number): T[] {
  const per = Math.max(1, perPage);
  const p = Math.abs(page) % pageCount(items.length, per);
  return items.slice(p * per, p * per + per);
}

/** The most recent `fit` days of a range, oldest first (the Production table's day columns). */
export function recentDays(days: string[], fit: number): string[] {
  return days.slice(-Math.max(1, fit));
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "Nov 3" from "2026-11-03" (a table's day column). */
export function shortDay(date: string): string {
  return `${MONTHS[Number(date.slice(5, 7)) - 1] ?? ""} ${Number(date.slice(8, 10))}`;
}

/** "$91.6K", "$1.2M", "$950": a big number on a card, the way the agency's CRM prints it. */
export function compactDollars(cents: number): string {
  const dollars = Math.abs(cents) / 100;
  const sign = cents < 0 ? "−" : "";
  if (dollars >= 999_950) return `${sign}$${(dollars / 1_000_000).toFixed(1)}M`;
  if (dollars >= 1000) return `${sign}$${(dollars / 1000).toFixed(1)}K`;
  return `${sign}$${Math.round(dollars)}`;
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

/** The month chart for P&C alone: each day's P&C premium and its running total. */
export function pcDaily<T extends { cents: number; cumulativeCents: number; lifeCents: number; lifeCumulativeCents: number }>(daily: T[]): T[] {
  return daily.map((d) => ({ ...d, cents: d.cents - d.lifeCents, cumulativeCents: d.cumulativeCents - d.lifeCumulativeCents }));
}
