import type { ReactNode } from "react";
import { cn } from "@/components/ui";
import type { SaleKind } from "@/lib/types";

/**
 * Life and P&C side by side (owner, 2026-11-04: "scores combined ... delineate between life and
 * P&C"): the dot that colors a share (the brand accent for life, P&C's own color for P&C) and
 * the small P&C tag on a sale. Server-safe, no hooks.
 */
export function KindDot({ kind, className }: { kind: SaleKind; className?: string }) {
  return <span aria-hidden className={cn("inline-block shrink-0 rounded-full", kind === "pc" ? "bg-pc" : "bg-accent", className ?? "h-1.5 w-1.5")} />;
}

/** "P&C" in a pill of P&C's tint; `tv` sizes it in em for the board. */
export function PcTag({ tv = false, className }: { tv?: boolean; className?: string }) {
  return (
    <span className={cn("inline-flex shrink-0 items-center rounded-full bg-pc-tint font-bold text-pc-text", tv ? "px-[0.5em] text-[0.72em] leading-[1.6]" : "px-1.5 text-[10px] leading-4", className)}>
      P&amp;C
    </span>
  );
}

/** "Life $67,515 · 44  P&C $8,900 · 10": the split under a combined number. */
export function KindSplit({ life, pc, lifeLabel, pcLabel, className, dot }: { life: ReactNode; pc: ReactNode; lifeLabel?: string; pcLabel?: string; className?: string; dot?: string }) {
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-3 whitespace-nowrap", className)}>
      <span className="inline-flex items-center gap-1.5">
        <KindDot kind="life" className={dot} />
        {lifeLabel ?? "Life"} {life}
      </span>
      <span className="inline-flex items-center gap-1.5">
        <KindDot kind="pc" className={dot} />
        {pcLabel ?? "P&C"} {pc}
      </span>
    </span>
  );
}
