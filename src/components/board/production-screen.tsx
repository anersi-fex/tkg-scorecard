"use client";

import type { MonthSnapshot } from "@/lib/board";
import type { ScoreRow } from "@/lib/scoreboard-types";
import { formatDollars } from "@/lib/money";
import { cn } from "@/components/ui";
import { Icon } from "@/components/ui/icon";
import { Medal, RankChip } from "@/components/ui/kit";
import { pageCount, pageOf, shareOf, shortDay, tableDays } from "@/lib/views";
import { EmptyScreen, PageDots, useBoxEm, usePager, useReportPages } from "./parts";

/**
 * The Production screen: the CRM's "Production leaderboard" as a table, in the calmer CRM look (the
 * approved demo, 2026-11-12). One row per agent who sold: the rank and the places gained or lost
 * since yesterday in a quiet block, a medal for the top three, the name over a thin bar against the
 * leader, Policies, the last five days that count (business days through yesterday, and today or a
 * Saturday once someone sold on it; a dash for a day without production) and the Total. Up to
 * fifteen rows a page; more rows page, they never scroll.
 */
/** A row's least height in the board's em (1em = 16 of the demo's pixels), and the demo's rows a page. */
const ROW = 48 / 16;
const MAX_ROWS = 15;
const DAYS = 5;

export function ProductionScreen({ snap, onPages }: { snap: MonthSnapshot; onPages?: (pages: number) => void }) {
  const sb = snap.scoreboard;
  const all = sb?.rows ?? [];
  const [ref, box] = useBoxEm();
  const fit = Math.min(MAX_ROWS, box ? Math.max(1, Math.floor(box.h / ROW + 0.02)) : MAX_ROWS);
  const pages = pageCount(all.length, fit);
  const page = usePager(pages);
  useReportPages(pages, onPages);
  if (!sb || all.length === 0) return <EmptyScreen title="Production leaderboard" line={sb ? "The first sale of the month lights this up." : "The numbers are on their way."} />;
  const today = snap.clock.today;
  const days = tableDays(sb.range.days, (d) => all.some((r) => (r.byDay[d] ?? 0) > 0), today, DAYS);
  const lead = Math.max(1, ...all.map((r) => r.totalCents));
  const shown = pageOf(all, page, fit);
  const moves = all.some((r) => r.rankChange !== 0);
  return (
    <div className="tvb-main tvb-prodmain">
      <section className="tvb-card tvb-tbl" aria-label="Production leaderboard" data-card="production">
        <div className="tvb-tbl-head">
          <div className="tvb-lhs">
            <h2 className="tvb-title">Production leaderboard</h2>
            <div className="tvb-sub">{moves ? "Arrows show places gained or lost since yesterday" : <ArrowsKey />}</div>
          </div>
          <div className="tvb-rhs">
            <span className="num">
              {sb.range.label} · {all.length} {all.length === 1 ? "agent" : "agents"}
            </span>
            <PageDots pages={pages} page={page} />
          </div>
        </div>
        <div className="tvb-grid" style={{ ["--ndays" as string]: days.length }}>
          <div className="tvb-thead">
            <span className="tvb-th-name">Name</span>
            <span className="tvb-n">Policies</span>
            {days.map((d) => (
              <span key={d} className={cn("tvb-n num", d === today && "tvb-th-today")}>
                {shortDay(d)}
              </span>
            ))}
            <span className="tvb-n tvb-sorted">
              Total
              <Icon name="arrow-down" size={15} stroke={1.8} className="h-[calc(15*var(--u))] w-[calc(15*var(--u))]" />
            </span>
          </div>
          <div ref={ref} className="min-h-0 flex-1">
            <ol key={page} className={cn("tvb-tbody h-full", pages > 1 && "board-page")} style={{ gridTemplateRows: `repeat(${fit}, minmax(0, 1fr))` }}>
              {shown.map((r) => (
                <Row key={r.agentId} row={r} days={days} lead={lead} />
              ))}
            </ol>
          </div>
        </div>
      </section>
    </div>
  );
}

/** "Arrows show places gained ↑ or lost ↓ since yesterday": while nobody has moved, the two colors are the key. */
export function ArrowsKey() {
  return (
    <>
      Arrows show places gained <span className="chip up tvb-key">↑</span> or lost <span className="chip down tvb-key">↓</span> since yesterday
    </>
  );
}

function Row({ row, days, lead }: { row: ScoreRow; days: string[]; lead: number }) {
  return (
    <li data-row={row.rank} data-agent={row.agentId} className="tvb-tr">
      <div className="tvb-namecell">
        <span className="tvb-rankblock">
          <span className="tvb-rk num">{row.rank}</span>
          <span className="tvb-rchg">
            <RankChip change={row.rankChange} />
          </span>
        </span>
        <span className="tvb-pmedal">
          <Medal rank={row.rank} size={28} />
        </span>
        <span className="tvb-who">
          <span className="tvb-nm ell">{row.name}</span>
          <span className="tvb-share" style={{ width: `${shareOf(row.totalCents, lead).toFixed(1)}%` }} />
        </span>
      </div>
      <span className="tvb-n num">{row.policies}</span>
      {days.map((d) => {
        const cents = row.byDay[d] ?? 0;
        return cents > 0 ? (
          <span key={d} className="tvb-n num">
            {formatDollars(cents)}
          </span>
        ) : (
          <span key={d} className="tvb-n nil">
            —
          </span>
        );
      })}
      <span className="tvb-n tvb-total num">{formatDollars(row.totalCents)}</span>
    </li>
  );
}
