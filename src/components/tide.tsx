import type { ReactNode } from "react";
import { cn } from "@/components/ui";

/**
 * Small Tide pieces shared by every screen: iOS-style
 * grouped list rows with inset hairlines, an eyebrow label and a row chevron. Colors are theme
 * tokens only, so every piece reads in light and dark. (Avatars live in `avatar.tsx`.)
 */

/**
 * Inset hairlines between grouped list rows (iOS style): put one of these on each row of a
 * `ListCard`. The line starts where the row's text starts (16px padding, then 12px gap): after a
 * 40px avatar (`avatar`), a 28px icon (`icon`), or at the row's padding (`plain`).
 */
export const ROW_INSET = {
  avatar:
    "relative not-first:before:pointer-events-none not-first:before:absolute not-first:before:top-0 not-first:before:right-0 not-first:before:left-[68px] not-first:before:h-px not-first:before:bg-line",
  icon: "relative not-first:before:pointer-events-none not-first:before:absolute not-first:before:top-0 not-first:before:right-0 not-first:before:left-14 not-first:before:h-px not-first:before:bg-line",
  plain:
    "relative not-first:before:pointer-events-none not-first:before:absolute not-first:before:top-0 not-first:before:right-0 not-first:before:left-4 not-first:before:h-px not-first:before:bg-line",
} as const;

/** The white (night, in dark mode) rounded card that holds grouped rows. */
export function ListCard({ children, className }: { children: ReactNode; className?: string }) {
  // No overflow clip: a row's menu (the "…" on a sale) opens past the card's edge; rows paint no full-width fills.
  return <ul className={cn("rounded-[22px] bg-surface shadow-card", className)}>{children}</ul>;
}

/**
 * A section title over a grouped list ("Teaching moments 3", "Recent calls"), with an optional
 * icon before it and a count after it. The calls home's SectionTitle is this same component.
 */
export function ListTitle({ children, count, icon, className }: { children: ReactNode; count?: number; icon?: ReactNode; className?: string }) {
  return (
    <h2 className={cn("flex items-center gap-2 px-1 text-[20px] leading-tight font-extrabold tracking-[-0.03em] text-gray-900", className)}>
      {icon}
      {children}
      {count != null && <span className="font-mono text-[15px] font-semibold tracking-normal text-gray-500">{count}</span>}
    </h2>
  );
}

/** Small uppercase label over a card's content ("CALL OF THE WEEK"). */
export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-[11px] font-bold uppercase leading-none tracking-[0.09em] text-gray-500", className)}>
      {children}
    </span>
  );
}

/** The light gray chevron at the end of a tappable row; `accent` colors it like a text link. */
export function RowChevron({ className, accent = false }: { className?: string; accent?: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={cn("shrink-0", accent ? "text-accent-text" : "text-gray-400", className)}
    >
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}
