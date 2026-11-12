import Link from "next/link";
import { cn } from "@/components/ui";
import { compactDollars } from "@/lib/views";

/**
 * Small pieces the Scoreboard page shares between its server parts and its client parts (no
 * hooks here, so both can use them). Colors are theme tokens only; the look is the CRM's (the
 * global `.seg` control, `scoreboard.css` for the rest).
 */

/** "$91.6K", "$950", "$1.2M": the short money on the top cards, like the agency's CRM. The TV's spelling, letter for letter. */
export function shortMoney(cents: number): string {
  return compactDollars(cents);
}

export interface SegmentItem {
  href: string;
  label: string;
  on: boolean;
}

/** A switch made of links, so the choice lives in the address (a refresh or a shared link keeps it). */
export function Segmented({ label, items, scroll = true, small = false, className }: { label: string; items: SegmentItem[]; scroll?: boolean; small?: boolean; className?: string }) {
  return (
    <nav aria-label={label} className={cn("seg", small && "seg-sm", className)}>
      {items.map((it) => (
        <Link key={it.label} href={it.href} scroll={scroll} aria-current={it.on ? "true" : undefined} className={cn("seg-btn", it.on && "on")}>
          <span>{it.label}</span>
        </Link>
      ))}
    </nav>
  );
}

/** The small dot that marks someone who works in the office. */
export function OfficeDot({ className }: { className?: string }) {
  return (
    <span title="In the office" className={cn("sb-dot", className)}>
      <span className="sr-only">In the office</span>
    </span>
  );
}

/** A small line chart with no axes (one point per day). */
export function Spark({ values, className }: { values: number[]; className?: string }) {
  if (values.length < 2) return <span aria-hidden className={className} />;
  const max = Math.max(1, ...values);
  const min = Math.min(...values);
  const span = Math.max(1, max - Math.min(0, min));
  const points = values.map((v, i) => `${((i / (values.length - 1)) * 100).toFixed(2)},${(29 - (Math.max(0, v) / span) * 26).toFixed(2)}`).join(" ");
  return (
    <svg viewBox="0 0 100 32" preserveAspectRatio="none" aria-hidden className={className}>
      <polyline points={points} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
