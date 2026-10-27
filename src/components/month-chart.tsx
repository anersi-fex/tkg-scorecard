"use client";

import { useEffect, useRef, useState } from "react";
import type { DayPoint } from "@/lib/board";
import { formatCompact } from "@/lib/money";

/**
 * The month so far: a filled line of the running total (cobalt) against the goal line (violet,
 * dashed), one point per calendar day. The goal line climbs by business days, the same line
 * `pace` measures against, so the dot sits above it exactly when the text says "Ahead".
 * Drawn in pixels: the chart measures its own box, so text and the dot never stretch, and the
 * strokes, labels and dot are sized in em (bigger on the TV, smaller on a phone).
 * Used on the Home page and, bigger, on the TV board.
 */
export function MonthChart({
  daily,
  goalCents,
  today,
  height = 160,
  labels = true,
  className,
}: {
  daily: DayPoint[];
  goalCents: number;
  today: string;
  /** The height before the box is measured (server render). */
  height?: number;
  labels?: boolean;
  className?: string;
}) {
  const ref = useRef<SVGSVGElement | null>(null);
  const [box, setBox] = useState<{ w: number; h: number } | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const r = entries[0]?.contentRect;
      if (r && r.width > 0 && r.height > 0) setBox({ w: Math.round(r.width), h: Math.round(r.height) });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const W = box?.w ?? 600;
  const H = box?.h ?? height;
  // Room for the labels scales with the box: "$150k" on the left, a row of day numbers below.
  const unit = Math.max(10, Math.min(H / 9, W / 40));
  const padL = labels ? unit * 4.2 : 6;
  const padR = unit * 0.8;
  const padT = unit * 0.8;
  const padB = labels ? unit * 1.6 : 6;
  const n = daily.length;
  if (n === 0) return null;
  const reached = daily.filter((d) => d.reached);
  const last = reached[reached.length - 1];
  const top = Math.max(goalCents, last?.cumulativeCents ?? 0, daily[n - 1].cumulativeCents, 1);
  const empty = top <= 1;
  const x = (i: number) => padL + (i / Math.max(1, n - 1)) * (W - padL - padR);
  const y = (v: number) => padT + (1 - v / top) * (H - padT - padB);

  const actual = reached.map((d, i) => `${x(i).toFixed(1)},${y(d.cumulativeCents).toFixed(1)}`);
  const actualPath = actual.length ? `M${x(0).toFixed(1)},${y(0).toFixed(1)} L${actual.join(" L")}` : "";
  const areaPath = actual.length ? `${actualPath} L${x(reached.length - 1).toFixed(1)},${y(0).toFixed(1)} Z` : "";
  const todayIdx = daily.findIndex((d) => d.date === today);
  const ticks = empty ? [] : [0.5, 1].map((f) => Math.round(top * f));

  // The goal line: a step up on each business day (Mon to Fri), flat over weekends.
  const businessTotal = daily.filter((d) => d.business).length || 1;
  const goalPts: string[] = [];
  for (let i = 0, b = 0; i < n; i++) {
    if (daily[i].business) b += 1;
    goalPts.push(`${x(i).toFixed(1)},${y((goalCents * b) / businessTotal).toFixed(1)}`);
  }

  return (
    <svg
      ref={ref}
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio={box ? "xMidYMid meet" : "none"}
      className={className}
      role="img"
      aria-label="Production this month against the goal line"
    >
      {ticks.map((t) => (
        <g key={t}>
          <line x1={padL} x2={W - padR} y1={y(t)} y2={y(t)} className="stroke-line" strokeWidth="1" />
          {labels && (
            <text x={padL - unit * 0.5} y={y(t) + unit * 0.3} textAnchor="end" className="fill-gray-500 font-mono text-[0.7em]">
              {formatCompact(t)}
            </text>
          )}
        </g>
      ))}
      {goalCents > 0 && (
        <polyline points={goalPts.join(" ")} fill="none" className="stroke-chart-2 [stroke-width:0.12em]" strokeDasharray="6 6" strokeLinecap="round" strokeLinejoin="round" />
      )}
      {areaPath && <path d={areaPath} className="fill-chart-1" opacity="0.12" />}
      {actualPath && <path d={actualPath} fill="none" className="stroke-chart-1 [stroke-width:0.19em]" strokeLinejoin="round" strokeLinecap="round" />}
      {last && <circle cx={x(reached.length - 1)} cy={y(last.cumulativeCents)} className="fill-chart-1 stroke-surface [r:0.32em] [stroke-width:0.15em]" />}
      {labels &&
        daily
          .filter((d, i) => i === 0 || i === n - 1 || ((i + 1) % 5 === 0 && i < n - 3))
          .map((d) => (
            <text key={d.date} x={x(daily.indexOf(d))} y={H - unit * 0.35} textAnchor="middle" className={d.date === today ? "fill-gray-900 text-[0.7em] font-bold" : "fill-gray-500 text-[0.7em]"}>
              {Number(d.date.slice(8))}
            </text>
          ))}
      {todayIdx >= 0 && labels && <line x1={x(todayIdx)} x2={x(todayIdx)} y1={padT} y2={H - padB} className="stroke-gray-300" strokeWidth="1" strokeDasharray="2 4" />}
    </svg>
  );
}
