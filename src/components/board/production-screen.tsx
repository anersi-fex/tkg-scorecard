"use client";

import type { MonthSnapshot } from "@/lib/board";
import type { ScoreRow } from "@/lib/scoreboard-types";
import { formatDollars } from "@/lib/money";
import { cn } from "@/components/ui";
import { pageCount, pageOf, recentDays, shortDay } from "@/lib/views";
import { EmptyScreen, PageDots, PlaceMedal, useBoxEm, usePager, useReportPages } from "./parts";

/**
 * The Production screen: the CRM's "Production leaderboard" as a table (owner, 2026-11-12:
 * "matched exactly ... compact ... it's going to be on a big TV"). One row per agent who sold: the
 * rank, the places gained or lost since yesterday, a medal for the top three, the name over a
 * tinted bar as long as their total against the leader's, Policies, one column per day (the most
 * recent days that fit, a dash for a day without production) and the Total. About twenty rows a
 * page on a 16:9 screen; more rows page, they never scroll.
 */
/** The smallest row and the fixed columns, in the board's em. */
const ROW = 2.05;
const NAME_COL = 21;
const POLICIES_COL = 5.5;
const TOTAL_COL = 8;
const DAY_COL = 5.3;

export function ProductionScreen({ snap, onPages }: { snap: MonthSnapshot; onPages?: (pages: number) => void }) {
  const sb = snap.scoreboard;
  const all = sb?.rows ?? [];
  const [ref, box] = useBoxEm();
  const fit = box ? Math.max(1, Math.floor(box.h / ROW + 0.02)) : 20;
  const pages = pageCount(all.length, fit);
  const page = usePager(pages);
  useReportPages(pages, onPages);
  if (!sb || all.length === 0) return <EmptyScreen title="Production leaderboard" line={sb ? "The first sale of the month lights this up." : "The numbers are on their way."} />;
  const days = recentDays(sb.range.days, box ? Math.floor((box.w - NAME_COL - POLICIES_COL - TOTAL_COL) / DAY_COL) : 11);
  const columns = `${NAME_COL}em ${POLICIES_COL}em repeat(${days.length}, minmax(0, 1fr)) ${TOTAL_COL}em`;
  const lead = Math.max(1, all[0]?.totalCents ?? 1, ...all.map((r) => r.totalCents));
  const shown = pageOf(all, page, fit);
  return (
    <section className="mt-[0.9em] flex min-h-0 flex-1 flex-col rounded-[1.4em] bg-surface px-[1.2em] pt-[0.85em] pb-[0.7em] shadow-card">
      <div className="flex shrink-0 items-baseline justify-between gap-[1em]">
        <h2 className="flex items-baseline gap-[0.7em] text-[1.35em] font-extrabold tracking-[-0.02em]">
          Production leaderboard
          <span className="text-[0.66em] font-semibold tracking-normal text-gray-500">Arrows show places gained or lost since yesterday</span>
        </h2>
        <p className="flex items-center gap-[0.8em] text-[0.9em] font-semibold text-gray-500">
          {sb.range.label} · {all.length} {all.length === 1 ? "agent" : "agents"}
          {days.length < sb.range.days.length && ` · last ${days.length} days`}
          <PageDots pages={pages} page={page} />
        </p>
      </div>
      <div className="mt-[0.5em] grid shrink-0 items-end border-b border-line pb-[0.3em] text-[0.8em] font-bold tracking-[0.04em] text-gray-500 uppercase" style={{ gridTemplateColumns: columns }}>
        <p className="pl-[6.6em]">Name</p>
        <p className="text-center">Policies</p>
        {days.map((d) => (
          <p key={d} className={cn("text-right whitespace-nowrap", d === snap.clock.today && "text-accent-text")}>
            {shortDay(d)}
          </p>
        ))}
        <p className="text-right">Total</p>
      </div>
      <div ref={ref} className="min-h-0 flex-1">
        <ol key={page} className={cn("grid h-full", pages > 1 && "board-page")} style={{ gridTemplateRows: `repeat(${Math.min(fit, Math.max(all.length, 1))}, minmax(0, 1fr))` }}>
          {shown.map((r) => (
            <Row key={r.agentId} row={r} days={days} columns={columns} lead={lead} />
          ))}
        </ol>
      </div>
    </section>
  );
}

/** Places gained (green, up) or lost (red, down) since yesterday; a gray dash for none; "new" for someone not on the board yesterday. */
export function ChangeChip({ change, className }: { change: number | null; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center justify-center rounded-full px-[0.45em] font-mono text-[0.78em] leading-[1.55] font-bold whitespace-nowrap",
        change === null ? "bg-tint text-accent-text" : change > 0 ? "bg-green-100 text-green-800" : change < 0 ? "bg-red-100 text-red-800" : "bg-track text-gray-500",
        className,
      )}
    >
      {change === null ? "new" : change > 0 ? `↑ ${change}` : change < 0 ? `↓ ${-change}` : "–"}
    </span>
  );
}

function Row({ row, days, columns, lead }: { row: ScoreRow; days: string[]; columns: string; lead: number }) {
  return (
    <li data-row={row.rank} className="grid min-h-0 items-center border-b border-line/60 last:border-b-0" style={{ gridTemplateColumns: columns }}>
      <div className="relative flex h-full min-w-0 items-center gap-[0.5em] pr-[0.8em]">
        <span aria-hidden className="absolute inset-y-[0.16em] left-0 rounded-[0.5em] bg-tint" style={{ width: `${Math.max(2, Math.round((row.totalCents / lead) * 100))}%` }} />
        <span className="relative w-[1.7em] shrink-0 text-right font-mono text-[1.05em] font-bold text-gray-600">{row.rank}</span>
        <ChangeChip change={row.rankChange} className="relative w-[3.1em] shrink-0" />
        <PlaceMedal place={row.rank} className="relative w-[1.2em] shrink-0 text-[1.05em]" />
        <span className="relative min-w-0 truncate text-[1.08em] font-extrabold tracking-[-0.02em]">{row.name}</span>
      </div>
      <p className="text-center font-mono text-[1.05em] font-bold">{row.policies}</p>
      {days.map((d) => {
        const cents = row.byDay[d] ?? 0;
        return (
          <p key={d} className={cn("text-right font-mono text-[0.98em] whitespace-nowrap", cents > 0 ? "font-semibold text-gray-800" : "text-gray-400")}>
            {cents > 0 ? formatDollars(cents) : "—"}
          </p>
        );
      })}
      <p className="text-right font-mono text-[1.15em] font-bold tracking-[-0.02em]">{formatDollars(row.totalCents)}</p>
    </li>
  );
}
