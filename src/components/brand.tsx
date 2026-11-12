import { cn } from "@/components/ui";

/**
 * Scorecard brand, a sibling of Sales Coach (Tide): a white podium (three steps, the tallest in
 * the middle, a star over it) on the colorway's gradient squircle; the lockup reads "Scorecard"
 * over "by TKG × <the agency's name>" (Settings; "Lineage Financial" to start). The icons in
 * public/ are drawn from the same geometry by scripts/gen-icons.mjs (keep the two in sync).
 */
// Podium steps on a 1024 canvas: [x, width, top, bottom] with rounded top corners.
// Big marks (48px and up) carry the star; small ones drop it and grow the steps.
const STEPS_BIG: Array<[number, number, number, number]> = [
  [152, 224, 432, 776],
  [400, 224, 312, 776],
  [648, 224, 512, 776],
];
const STEPS_SMALL: Array<[number, number, number, number]> = [
  [136, 240, 384, 808],
  [392, 240, 232, 808],
  [648, 240, 488, 808],
];
const STAR = { cx: 512, cy: 196, outer: 74, inner: 31 };

function stepPath([x, w, top, bottom]: [number, number, number, number], r = 44): string {
  return `M${x} ${bottom}V${top + r}Q${x} ${top} ${x + r} ${top}H${x + w - r}Q${x + w} ${top} ${x + w} ${top + r}V${bottom}Z`;
}

function starPath(): string {
  const pts: string[] = [];
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? STAR.outer : STAR.inner;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    pts.push(`${(STAR.cx + r * Math.cos(a)).toFixed(1)} ${(STAR.cy + r * Math.sin(a)).toFixed(1)}`);
  }
  return `M${pts.join("L")}Z`;
}

/** The whole mark as one path (big or small variant), for the icon script and the SVGs below. */
export function podiumPath(small: boolean): string {
  const steps = (small ? STEPS_SMALL : STEPS_BIG).map((s) => stepPath(s)).join("");
  return small ? steps : steps + starPath();
}

export function ScoreMark({ size = 32, className }: { size?: number; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("inline-flex shrink-0 items-center justify-center bg-tide", className)}
      style={{ width: size, height: size, borderRadius: Math.round(size * 0.28) }}
    >
      <svg viewBox="0 0 1024 1024" width={size} height={size}>
        <path d={podiumPath(size < 48)} fill="currentColor" className="text-on-grad" />
      </svg>
    </span>
  );
}

/** The real TKG letters as a solid shape (aspect 1540 x 734). */
export function TkgMark({ height = 12, className, title = "TKG" }: { height?: number; className?: string; title?: string }) {
  return (
    <svg viewBox="30 30 1540 734" height={height} width={Math.round((height * 1540) / 734)} role="img" aria-label={title} className={cn("block shrink-0 fill-current", className)}>
      <path d="M30 39H542V204H368V684H203V204H30ZM570 41H734V253L887 41H1084V47L865 350L1084 648V682H906L766 491L570 763ZM1569 160A323 323 0 1 0 1305 677H1560V294H1259V458H1396V513H1305A160 160 0 1 1 1449 268Z" />
    </svg>
  );
}

/**
 * Icon + "Scorecard" (600) + "by TKG × <agency>" under it (the demo's sidebar lockup) (owner, 2026-11-12: "you can still put 'by
 * tkg' ... just needs to also say Lineage Financial"): the TKG letters as before, a thin "×", then
 * the agency's name. `size` is the icon size; the type scales with it. Pass `agency` from
 * `loadLook().agencyName` (or the snapshot's `agencyName`); without it the line reads "by TKG".
 */
export function ScoreLockup({ size = 28, className, agency }: { size?: number; className?: string; agency?: string }) {
  // The demo's proportions: a 34px tile beside a 15.5px "Scorecard" (600) over an 11px line.
  const name = Math.max(14, Math.round(size * 0.46));
  const sub = Math.max(10.5, Math.round(size * 0.33 * 2) / 2);
  const mark = Math.max(8, Math.round(sub * 0.78));
  const label = agency?.trim();
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-2.5", className)}>
      <ScoreMark size={size} />
      <span className="flex min-w-0 flex-col text-left leading-[1.2]">
        <span className="font-semibold tracking-[-0.005em] text-fg" style={{ fontSize: name }}>
          Scorecard
        </span>
        <span data-lockup-by className="mt-px flex min-w-0 items-center gap-[0.3em] whitespace-nowrap text-fg-2" style={{ fontSize: sub }}>
          by <TkgMark height={mark} className="text-fg" />
          {label && (
            <>
              <span aria-hidden className="relative -top-[0.04em]">
                ×
              </span>
              <span data-agency className="max-w-[14em] min-w-0 truncate" style={{ lineHeight: 1.2 }}>
                {label}
              </span>
            </>
          )}
        </span>
      </span>
    </span>
  );
}
