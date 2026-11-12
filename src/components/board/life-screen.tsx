"use client";

import { useCallback, useState } from "react";
import type { AgentLine, MonthSnapshot } from "@/lib/board";
import { formatDollars } from "@/lib/money";
import { cn } from "@/components/ui";
import { Medal, RankChip } from "@/components/ui/kit";
import { boardGroups, pageCount, pageOf, shareOf } from "@/lib/views";
import { PageDots, RightSide, useBoxEm, usePager, useReportPages } from "./parts";
import { ArrowsKey } from "./production-screen";

/**
 * The leaderboard screen in the calmer CRM look (the approved demo's TV, 2026-11-12): everyone on
 * the board in up to three columns (the place, places gained or lost since yesterday, a medal for
 * the top three, the name over "N policies", the amount, a thin bar against the leader), and the
 * right side with Production, the goal line and "On pace for". With people marked in the office,
 * "In the office" stays on top with places of its own, over "Everyone else" in smaller rows (owner,
 * 2026-11-12: "their numbers should be showing at the top"). Nothing scrolls and no row is cut:
 * each block measures its own room and pages through its people when they do not fit.
 */
type Ranked = AgentLine & { place: number };

/** A row's height in the board's em (1em = 16 of the demo's pixels): a full row, and the smaller "Everyone else" row. */
const ROW = 67 / 16;
const SMALL_ROW = 51 / 16;
/** The demo's most rows a column holds before the list pages. */
const MAX_ROWS = 12;
const COLS = 3;

export function LifeScreen({ snap, flash, onPages }: { snap: MonthSnapshot; tones?: Record<string, string>; flash: string[]; onPages?: (pages: number) => void }) {
  const { split, office, others } = boardGroups(snap.agents);
  const everyone = [...office, ...others];
  const max = Math.max(1, ...everyone.map((a) => a.lifeCents));
  // Places since yesterday come from the agency's own ranking (the Scoreboard's), shown in both
  // groups as Home shows them (the arrow is the agency move, the number the place in the group).
  const change = new Map((snap.scoreboard?.rows ?? []).map((r) => [r.agentId, r.rankChange]));
  const mainRows = Math.max(1, Math.min(MAX_ROWS, Math.ceil(office.length / COLS)));
  const smallRows = Math.max(1, Math.ceil(others.length / COLS));
  const [pages, setPages] = useState({ main: 1, small: 1 });
  const onMain = useCallback((n: number) => setPages((p) => (p.main === n ? p : { ...p, main: n })), []);
  const onSmall = useCallback((n: number) => setPages((p) => (p.small === n ? p : { ...p, small: n })), []);
  useReportPages(Math.max(pages.main, others.length > 0 ? pages.small : 1), onPages);
  return (
    <div className="tvb-main tvb-board">
      <div className="tvb-left">
        {everyone.length === 0 ? (
          <section className="tvb-card tvb-lb" aria-label="Leaderboard">
            <h2 className="tvb-title">Leaderboard</h2>
            <p className="tvb-lb-empty">Add your team in Scorecard on your phone.</p>
          </section>
        ) : (
          <>
            <Group
              name="office"
              title={split ? "In the office" : "Leaderboard"}
              people={office}
              rowEm={ROW}
              weight={split ? mainRows * ROW + 5 : 1}
              max={max}
              change={change}
              legend
              onPages={onMain}
            />
            {others.length > 0 && <Group name="others" title="Everyone else" people={others} rowEm={SMALL_ROW} weight={Math.min(smallRows, MAX_ROWS) * SMALL_ROW + 4} small max={max} change={change} onPages={onSmall} />}
          </>
        )}
      </div>
      <RightSide snap={snap} view="life" flash={flash} />
    </div>
  );
}

/** One block of the leaderboard: its title, how many sold, and its people in columns, a page at a time. */
function Group({
  name,
  title,
  people,
  rowEm,
  weight,
  small = false,
  max,
  change,
  legend = false,
  onPages,
}: {
  name: string;
  title: string;
  people: Ranked[];
  rowEm: number;
  /** This block's share of the height against the other block. */
  weight: number;
  small?: boolean;
  max: number;
  change?: Map<string, number | null>;
  legend?: boolean;
  onPages: (pages: number) => void;
}) {
  const [ref, box] = useBoxEm();
  const cols = people.length <= 4 ? 1 : people.length <= 10 ? 2 : COLS;
  const need = Math.ceil(people.length / cols);
  // Before the first measure: what a 16:9 screen holds, so the first paint is already right there.
  const fit = box ? Math.max(1, Math.floor(box.h / rowEm + 0.02)) : small ? 5 : 11;
  const rows = Math.max(1, Math.min(need, fit, MAX_ROWS));
  const per = rows * cols;
  const pages = pageCount(people.length, per);
  const page = usePager(pages);
  useReportPages(pages, onPages);
  const shown = pageOf(people, page, per);
  const sold = people.filter((a) => a.lifeCents > 0).length;
  const columns = Array.from({ length: cols }, (_, c) => shown.slice(c * rows, c * rows + rows));
  const moves = change !== undefined && people.some((a) => a.lifeCents > 0 && (change.get(a.id) ?? 0) !== 0);
  return (
    <section data-group={name} data-pages={pages} aria-label={title} className={cn("tvb-card tvb-lb", small && "tvb-small", cols === 1 && "tvb-one", cols === 2 && "tvb-two")} style={{ flex: `${weight} 1 0%` }}>
      <div className="tvb-lb-head">
        <div className="min-w-0">
          <h2 className="tvb-title">{title}</h2>
          <div className="tvb-sub">
            <span className="num">{people.length}</span> {people.length === 1 ? "person" : "people"} · <span className="num">{sold}</span> sold
            {legend && change !== undefined && <> · {moves ? "Arrows show places gained or lost since yesterday" : <ArrowsKey />}</>}
          </div>
        </div>
        <PageDots pages={pages} page={page} />
      </div>
      <div ref={ref} className="tvb-cols" style={{ display: "grid" }}>
        {columns.map((list, c) => {
          const medals = list.some((a) => a.lifeCents > 0 && a.place <= 3);
          return (
            <ol key={`${page}-${c}`} className={cn("tvb-col", medals && "medals", pages > 1 && "board-page")} style={{ gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))` }}>
              {list.map((a) => (
                <Row key={a.id} line={a} max={max} medal={medals} change={change?.get(a.id)} showChange={change !== undefined} />
              ))}
            </ol>
          );
        })}
      </div>
    </section>
  );
}

/**
 * One person: the place and the change under it, a medal for the top three, the name over
 * "N policies" (and today's gain in green), the amount, and a thin bar against the leader. Someone
 * with no sale this month still shows, dimmed, after the sellers.
 */
function Row({ line, max, medal, change, showChange }: { line: Ranked; max: number; medal: boolean; change: number | null | undefined; showChange: boolean }) {
  const sold = line.lifeCents > 0;
  return (
    <li className={cn("tvb-row", !sold && "none")} data-person={line.id} data-place={line.place}>
      <span className="tvb-rank num">{sold ? line.place : "–"}</span>
      <span className="tvb-chg">{sold && showChange ? <RankChip change={change === undefined ? 0 : change} /> : null}</span>
      {medal && <span className="tvb-medal">{sold ? <Medal rank={line.place} size={28} /> : null}</span>}
      <span className="tvb-name ell">{line.name}</span>
      <span className="tvb-rsub ell num">
        {sold ? `${line.lifePolicies} ${line.lifePolicies === 1 ? "policy" : "policies"}` : "No sale yet"}
        {sold && line.todayLifeCents > 0 && (
          <>
            {" · "}
            <span className="tvb-today">+{formatDollars(line.todayLifeCents)} today</span>
          </>
        )}
      </span>
      <span className="tvb-amt num">{sold ? formatDollars(line.lifeCents) : "—"}</span>
      {sold && <span className="tvb-bar" style={{ width: `${shareOf(line.lifeCents, max)}%` }} />}
    </li>
  );
}
