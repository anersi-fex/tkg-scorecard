import type { DayPoint } from "@/lib/board";
import { formatCompact } from "@/lib/money";

/**
 * The month so far: a filled line of the running total (cobalt) against the straight path to the
 * goal (violet, dashed), one point per calendar day. Pure SVG, scales to its box, theme tokens
 * only. Used on the Home page and, bigger, on the TV board.
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
  height?: number;
  labels?: boolean;
  className?: string;
}) {
  const W = 600;
  const H = height;
  const padL = labels ? 44 : 6;
  const padR = 10;
  const padT = 10;
  const padB = labels ? 22 : 6;
  const n = daily.length;
  if (n === 0) return null;
  const reached = daily.filter((d) => d.reached);
  const last = reached[reached.length - 1];
  const top = Math.max(goalCents, last?.cumulativeCents ?? 0, daily[n - 1].cumulativeCents, 1);
  const x = (i: number) => padL + (i / Math.max(1, n - 1)) * (W - padL - padR);
  const y = (v: number) => padT + (1 - v / top) * (H - padT - padB);

  const actual = reached.map((d, i) => `${x(i).toFixed(1)},${y(d.cumulativeCents).toFixed(1)}`);
  const actualPath = actual.length ? `M${x(0).toFixed(1)},${y(0).toFixed(1)} L${actual.join(" L")}` : "";
  const areaPath = actual.length ? `${actualPath} L${x(reached.length - 1).toFixed(1)},${y(0).toFixed(1)} Z` : "";
  const todayIdx = daily.findIndex((d) => d.date === today);
  const ticks = [0.5, 1].map((f) => Math.round(top * f));

  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className={className} role="img" aria-label="Production this month against the goal line">
      {/* Guide lines */}
      {ticks.map((t) => (
        <g key={t}>
          <line x1={padL} x2={W - padR} y1={y(t)} y2={y(t)} className="stroke-line" strokeWidth="1" vectorEffect="non-scaling-stroke" />
          {labels && (
            <text x={padL - 8} y={y(t) + 4} textAnchor="end" className="fill-gray-500 font-mono" fontSize="11">
              {formatCompact(t)}
            </text>
          )}
        </g>
      ))}
      {goalCents > 0 && (
        <line
          x1={x(0)}
          y1={y(0)}
          x2={x(n - 1)}
          y2={y(goalCents)}
          className="stroke-chart-2"
          strokeWidth="2"
          strokeDasharray="6 6"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
      )}
      {areaPath && <path d={areaPath} className="fill-chart-1" opacity="0.12" />}
      {actualPath && <path d={actualPath} fill="none" className="stroke-chart-1" strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />}
      {last && (
        <circle cx={x(reached.length - 1)} cy={y(last.cumulativeCents)} r="5" className="fill-chart-1 stroke-surface" strokeWidth="2.5" vectorEffect="non-scaling-stroke" />
      )}
      {labels &&
        daily
          .filter((d, i) => i === 0 || i === n - 1 || ((i + 1) % 5 === 0 && i < n - 3))
          .map((d) => (
            <text key={d.date} x={x(daily.indexOf(d))} y={H - 6} textAnchor="middle" className={d.date === today ? "fill-gray-900 font-bold" : "fill-gray-500"} fontSize="11">
              {Number(d.date.slice(8))}
            </text>
          ))}
      {todayIdx >= 0 && labels && (
        <line x1={x(todayIdx)} x2={x(todayIdx)} y1={padT} y2={H - padB} className="stroke-gray-300" strokeWidth="1" strokeDasharray="2 4" vectorEffect="non-scaling-stroke" />
      )}
    </svg>
  );
}
