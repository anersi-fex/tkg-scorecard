/**
 * Money is stored in whole cents (annual premium) and shown in dollars. Pure, browser-safe.
 */

/** "$12,450" (no cents); "$1.2M" style never, the board has room for the full number. */
export function formatDollars(cents: number): string {
  const dollars = Math.round(cents / 100);
  return `$${Math.abs(dollars).toLocaleString("en-US")}`.replace("$", dollars < 0 ? "-$" : "$");
}

/** "$12,450.50" when the amount has cents, else "$12,450". */
export function formatMoney(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100);
  const rest = abs % 100;
  const base = `${sign}$${dollars.toLocaleString("en-US")}`;
  return rest === 0 ? base : `${base}.${String(rest).padStart(2, "0")}`;
}

/** "$12.4k" for tight spots (chart ticks, small chips). */
export function formatCompact(cents: number): string {
  const dollars = cents / 100;
  const abs = Math.abs(dollars);
  const sign = dollars < 0 ? "-" : "";
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1)}M`;
  if (abs >= 10_000) return `${sign}$${Math.round(abs / 1000)}k`;
  if (abs >= 1_000) return `${sign}$${(abs / 1000).toFixed(1)}k`;
  return `${sign}$${Math.round(abs)}`;
}

/**
 * Dollars typed by a person ("1,250", "$1250.50", "1250") to cents. Null when it is not an
 * amount, negative, or absurd (over $10,000,000: a typo, not a premium).
 */
export function parseDollars(input: string): number | null {
  const cleaned = input.replace(/[$,\s]/g, "");
  if (!/^\d+(\.\d{0,2})?$/.test(cleaned)) return null;
  const [whole, frac = ""] = cleaned.split(".");
  const cents = Number(whole) * 100 + Number((frac + "00").slice(0, 2));
  if (!Number.isFinite(cents) || cents < 0 || cents > 1_000_000_000) return null;
  return cents;
}

/** Whole percent, never over 999, "0" when the goal is missing. */
export function percentOf(part: number, whole: number): number {
  if (!whole || whole <= 0) return 0;
  return Math.min(999, Math.round((part / whole) * 100));
}
