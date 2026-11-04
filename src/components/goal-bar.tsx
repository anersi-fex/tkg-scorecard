import { cn } from "@/components/ui";

/**
 * One track per person, the same length for everyone (owner, 2026-10-30, option A): `width` is
 * how far along the goal they are (0 to 100), filled with life in the brand gradient and any P&C
 * share in P&C's own gradient (owner, 2026-11-04: "delineate between life and P&C"; on the life
 * views the bar is life alone), and `goalLine` is where
 * the month stands today as a gray tick (owner: "where they need to be at to continue producing
 * the same amount and still reach their goal"). Sizes come from the caller, so the TV draws it in em.
 */
export function GoalBar({
  width,
  lifeShare,
  goalLine,
  className,
  tickClassName,
}: {
  /** The filled part of the track, 0 to 100. */
  width: number;
  /** The part of `width` that is life (the rest is P&C), 0 to `width`. */
  lifeShare: number;
  /** The goal line today, 0 to 100, or null for no tick. */
  goalLine: number | null;
  className?: string;
  tickClassName?: string;
}) {
  const w = Math.max(0, Math.min(100, width));
  const lifePct = w > 0 ? Math.max(0, Math.min(100, (lifeShare / w) * 100)) : 0;
  return (
    <div className={cn("relative min-w-0 flex-1 rounded-full bg-track", className ?? "h-1.5")}>
      <div className="absolute inset-y-0 left-0 overflow-hidden rounded-full transition-[width] duration-700" style={{ width: `${w}%` }}>
        <div className="absolute inset-y-0 left-0 bg-tide" style={{ width: `${lifePct}%` }} />
        {lifePct < 100 && <div className="absolute inset-y-0 right-0 bg-pc-grad" style={{ left: `${lifePct}%` }} />}
      </div>
      {/* A card-colored halo keeps the tick readable where it crosses a fill */}
      {goalLine !== null && <span aria-hidden className={cn("absolute rounded-[1px] bg-gray-500 outline-1 outline-surface", tickClassName ?? "-top-1 h-3.5 w-0.5")} style={{ left: `calc(${Math.max(0, Math.min(100, goalLine))}% - 1px)` }} />}
    </div>
  );
}
