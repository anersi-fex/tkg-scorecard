import Link from "next/link";
import { cn } from "@/components/ui";

/**
 * Small pieces the Scoreboard page shares between its server parts and its client parts (no
 * hooks here, so both can use them). Colors are theme tokens only.
 */

/** "$91.6K", "$950", "$1.2M": the short money on the top cards, like the agency's CRM. */
export function shortMoney(cents: number): string {
  const dollars = Math.abs(cents) / 100;
  const sign = cents < 0 ? "−" : "";
  const one = (n: number) => (Math.round(n * 10) / 10).toFixed(1).replace(/\.0$/, "");
  if (dollars >= 999_950) return `${sign}$${one(dollars / 1_000_000)}M`;
  if (dollars >= 1_000) return `${sign}$${one(dollars / 1_000)}K`;
  return `${sign}$${Math.round(dollars)}`;
}

export interface SegmentItem {
  href: string;
  label: string;
  on: boolean;
}

/** A switch made of links, so the choice lives in the address (a refresh or a shared link keeps it). */
export function Segmented({ label, items, scroll = true, className }: { label: string; items: SegmentItem[]; scroll?: boolean; className?: string }) {
  return (
    <nav aria-label={label} className={cn("inline-flex shrink-0 gap-0.5 rounded-xl bg-track p-0.5", className)}>
      {items.map((it) => (
        <Link
          key={it.label}
          href={it.href}
          scroll={scroll}
          aria-current={it.on ? "true" : undefined}
          className={cn(
            "flex h-11 flex-1 items-center justify-center rounded-[10px] px-3.5 text-[13px] font-bold whitespace-nowrap transition md:h-8 md:px-3",
            it.on ? "bg-segment text-gray-900 shadow-card" : "text-gray-600 hover:text-gray-900",
          )}
        >
          {it.label}
        </Link>
      ))}
    </nav>
  );
}

/** Places gained (green, up) or lost (red, down) since yesterday; a gray dash for none; "new", in green, for someone who was not on the board yesterday (getting on it is a gain: in Crimson the brand's tint would read as the red of a drop). */
export function ChangeChip({ change, className }: { change: number | null; className?: string }) {
  const words = change === null ? "new on the board" : change > 0 ? `up ${change}` : change < 0 ? `down ${-change}` : "no change";
  return (
    <span
      title={`Since yesterday: ${words}`}
      className={cn(
        "inline-flex h-[18px] min-w-[26px] shrink-0 items-center justify-center rounded-full px-1.5 font-mono text-[11px] leading-none font-bold whitespace-nowrap",
        change === null || change > 0 ? "bg-green-100 text-green-800" : change < 0 ? "bg-red-100 text-red-800" : "bg-track text-gray-500",
        className,
      )}
    >
      <span aria-hidden>{change === null ? "new" : change > 0 ? `↑ ${change}` : change < 0 ? `↓ ${-change}` : "–"}</span>
      <span className="sr-only">{words}</span>
    </span>
  );
}

/** A gold trophy for first, a silver and a bronze medal for second and third; an empty slot of the same width after that. */
export function PlaceIcon({ place, className }: { place: number; className?: string }) {
  if (place > 3 || place < 1) return <span aria-hidden className={cn("inline-block w-4 shrink-0", className)} />;
  const tone = place === 1 ? "text-gold" : place === 2 ? "text-silver" : "text-bronze";
  return (
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      role="img"
      aria-label={place === 1 ? "First place" : place === 2 ? "Second place" : "Third place"}
      className={cn("shrink-0", tone, className)}
    >
      {place === 1 ? (
        <>
          <path d="M7 4h10v5a5 5 0 0 1-10 0V4z" />
          <path d="M7 6H4v1a3 3 0 0 0 3 3M17 6h3v1a3 3 0 0 1-3 3" />
          <path d="M12 14v4M8.5 20h7" />
        </>
      ) : (
        <>
          <circle cx="12" cy="9" r="5" />
          <path d="M9 13.2 7.5 21l4.5-2.4 4.5 2.4-1.5-7.8" />
        </>
      )}
    </svg>
  );
}

/** The small dot that marks someone who works in the office. */
export function OfficeDot({ className }: { className?: string }) {
  return (
    <span title="In the office" className={cn("inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-accent", className)}>
      <span className="sr-only">In the office</span>
    </span>
  );
}

/** A small line chart with no axes (one point per day). */
export function Spark({ values, className }: { values: number[]; className?: string }) {
  if (values.length < 2) return <span aria-hidden className={className} />;
  const max = Math.max(1, ...values);
  const points = values.map((v, i) => `${((i / (values.length - 1)) * 100).toFixed(2)},${(29 - (Math.max(0, v) / max) * 26).toFixed(2)}`).join(" ");
  return (
    <svg viewBox="0 0 100 32" preserveAspectRatio="none" aria-hidden className={cn("text-gray-400", className)}>
      <polyline points={points} fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
