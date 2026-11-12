"use client";

import { useCallback, useState } from "react";
import type { AgentLine, MonthSnapshot } from "@/lib/board";
import { formatDollars } from "@/lib/money";
import { Avatar, shortName } from "@/components/avatar";
import { GoalBar } from "@/components/goal-bar";
import { cn } from "@/components/ui";
import { boardGroups, pageCount, pageOf } from "@/lib/views";
import { PageDots, PlaceMark, RightSide, useBoxEm, usePager, useReportPages } from "./parts";

/**
 * The leaderboard screen (owner, 2026-11-12: "the ones in the office are like a group of like 27,
 * and I feel like ... their numbers should be showing at the top"): the office group as a dense
 * leaderboard in up to three columns, ranked among themselves, over "Everyone else" in smaller
 * rows; the shared right side (goal ring, tiles, chart, latest sales) in the last third. Nothing
 * scrolls and no row is cut: each block measures its own room and pages through its people when
 * they do not fit. With nobody marked in office it is one list, "Leaderboard".
 */
type Ranked = AgentLine & { place: number };

/** The smallest row of each block, in the board's em; rows grow from there when there is room. */
const MAIN_ROW = 2.85;
const SMALL_ROW = 2.5;
/** The row heights the two blocks share out between them (about what a 16:9 screen has). */
const ROOM = 38;

/** One column up to ten people, two up to twenty, three from there. */
function columnsFor(count: number): number {
  return count <= 10 ? 1 : count <= 20 ? 2 : 3;
}

export function LifeScreen({ snap, tones, flash, onPages }: { snap: MonthSnapshot; tones: Record<string, string>; flash: string[]; onPages?: (pages: number) => void }) {
  const { clock: month } = snap;
  const { split, office, others } = boardGroups(snap.agents);
  const everyone = [...office, ...others];
  const max = Math.max(1, ...everyone.map((a) => a.lifeCents));
  const current = month.position === "current";
  // The goal line today, the same tick on every bar: how far through its business days the month is.
  const goalLine = current && month.elapsed > 0 && everyone.some((a) => a.goalCents > 0) ? Math.round(month.progress * 100) : null;
  const mainCols = columnsFor(office.length);
  const smallCols = mainCols + 1;
  const mainRows = Math.max(1, Math.min(10, Math.ceil(office.length / mainCols)));
  const smallRows = Math.max(1, Math.min(Math.max(3, Math.floor((ROOM - mainRows * MAIN_ROW) / SMALL_ROW)), Math.ceil(others.length / smallCols)));
  // The screen stays until the block with the most pages has shown each of them.
  const [pages, setPages] = useState({ main: 1, small: 1 });
  const onMain = useCallback((n: number) => setPages((p) => (p.main === n ? p : { ...p, main: n })), []);
  const onSmall = useCallback((n: number) => setPages((p) => (p.small === n ? p : { ...p, small: n })), []);
  useReportPages(Math.max(pages.main, others.length > 0 ? pages.small : 1), onPages);
  return (
    <div className="mt-[0.9em] grid min-h-0 flex-1 grid-cols-12 gap-[1em]">
      <div className="col-span-8 flex min-h-0 flex-col gap-[0.8em]">
        {everyone.length === 0 ? (
          <section className="flex min-h-0 flex-1 items-center justify-center rounded-[1.4em] bg-surface shadow-card">
            <p className="text-[1.2em] font-semibold text-gray-500">Add your team in Scorecard on your phone.</p>
          </section>
        ) : (
          <>
            <Group
              name="office"
              title={split ? "In the office" : "Leaderboard"}
              people={office}
              cols={mainCols}
              rowEm={MAIN_ROW}
              weight={mainRows * MAIN_ROW + 3.6}
              maxScale={mainCols === 1 ? 1.5 : mainCols === 2 ? 1.3 : 1.06}
              max={max}
              today={current}
              goalLine={goalLine}
              legend
              onPages={onMain}
            />
            {others.length > 0 && (
              <Group name="others" title="Everyone else" people={others} cols={smallCols} rowEm={SMALL_ROW} weight={smallRows * SMALL_ROW + 3.2} maxScale={1.08} small max={max} today={current} goalLine={goalLine} onPages={onSmall} />
            )}
          </>
        )}
      </div>
      <RightSide snap={snap} view="life" tones={tones} flash={flash} className="col-span-4" />
    </div>
  );
}

/** One block of the leaderboard: its title, how many sold, and its people in columns, a page at a time. */
function Group({
  name,
  title,
  people,
  cols,
  rowEm,
  weight,
  maxScale,
  small = false,
  max,
  today,
  goalLine,
  legend = false,
  onPages,
}: {
  name: string;
  title: string;
  people: Ranked[];
  cols: number;
  /** The smallest row, in the board's em. */
  rowEm: number;
  /** This block's share of the height against the other block. */
  weight: number;
  maxScale: number;
  small?: boolean;
  max: number;
  today: boolean;
  goalLine: number | null;
  legend?: boolean;
  onPages: (pages: number) => void;
}) {
  const [ref, box] = useBoxEm();
  const need = Math.ceil(people.length / cols);
  // Before the first measure: what a 16:9 screen holds, so the first paint is already right there.
  const fit = box ? Math.max(1, Math.floor(box.h / rowEm + 0.02)) : small ? 4 : 10;
  const rows = Math.max(1, Math.min(need, fit));
  const per = rows * cols;
  const pages = pageCount(people.length, per);
  const page = usePager(pages);
  useReportPages(pages, onPages);
  const shown = pageOf(people, page, per);
  // Fewer people, taller rows: the type grows with the room, up to what the column's width holds.
  const slot = box ? box.h / rows : rowEm;
  const scale = Math.min(maxScale, Math.max(1, slot / rowEm)) * (small ? 0.84 : 1);
  const sold = people.filter((a) => a.lifeCents > 0).length;
  return (
    <section data-group={name} data-pages={pages} className="flex min-h-0 flex-col rounded-[1.4em] bg-surface px-[1em] pt-[0.75em] pb-[0.7em] shadow-card" style={{ flex: `${weight} 1 0%` }}>
      <div className="flex shrink-0 items-baseline justify-between gap-[1em]">
        <h2 className={cn("flex items-baseline gap-[0.6em] font-extrabold tracking-[-0.02em]", small ? "text-[1.05em]" : "text-[1.25em]")}>
          {title}
          <span className="text-[0.68em] font-semibold tracking-normal text-gray-500">
            {people.length} {people.length === 1 ? "person" : "people"} · {sold} sold
          </span>
        </h2>
        <p className="flex items-center gap-[0.45em] text-[0.8em] font-semibold text-gray-500">
          {legend && goalLine !== null && (
            <>
              <span aria-hidden className="inline-block h-[0.9em] w-[0.12em] rounded-full bg-gray-500" />
              goal line today
              <span aria-hidden>·</span>
            </>
          )}
          {legend && "annual premium · policies"}
          <PageDots pages={pages} page={page} className={legend ? "ml-[0.6em]" : undefined} />
        </p>
      </div>
      <div ref={ref} className="mt-[0.45em] min-h-0 flex-1">
        <ol key={page} className={cn("grid h-full gap-x-[1.1em]", pages > 1 && "board-page")} style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))`, gridAutoFlow: "column" }}>
          {shown.map((a) => (
            <DenseRow key={a.id} line={a} max={max} today={today} goalLine={goalLine} scale={scale} roomy={cols < 3 && !small} tight={small} />
          ))}
        </ol>
      </div>
    </section>
  );
}

/**
 * One person: the place (a crown, a medal, the number), initials, the name, the amount, a slim
 * bar of their own goal (of the leader's premium without one), policies and today's gain in green.
 * Someone with no sale this month still shows, dimmed, after the sellers.
 */
function DenseRow({ line, max, today, goalLine, scale, roomy, tight }: { line: Ranked; max: number; today: boolean; goalLine: number | null; scale: number; roomy: boolean; tight: boolean }) {
  const sold = line.lifeCents > 0;
  const hasGoal = line.goalCents > 0;
  const width = hasGoal ? Math.min(100, line.goalPct) : Math.round((line.lifeCents / max) * 100);
  const done = hasGoal && line.goalPct >= 100;
  const first = sold && line.place === 1;
  const name = line.name.length > (roomy ? 24 : tight ? 12 : 15) ? shortName(line.name) : line.name;
  return (
    <li className="flex min-h-0 min-w-0 items-center" data-person={line.id} data-place={line.place}>
      <div className={cn("flex w-full min-w-0 items-center gap-[0.5em] rounded-[0.8em] px-[0.4em] py-[0.2em]", first && "bg-tint/60", !sold && "opacity-50")} style={{ fontSize: `${scale}em` }}>
        <PlaceMark place={line.place} sold={sold} className="w-[1.45em] text-[1.15em]" />
        <Avatar name={line.name} tone={line.tone} size={36} className="!h-[1.9em] !w-[1.9em] !text-[0.74em]" />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-[0.5em]">
            <p className="min-w-0 truncate text-[1.05em] leading-[1.2] font-extrabold tracking-[-0.02em]">{name}</p>
            <p className="shrink-0 font-mono text-[1.15em] leading-[1.1] font-bold tracking-[-0.03em]">{sold ? formatDollars(line.lifeCents) : "–"}</p>
          </div>
          <div className="mt-[0.26em] flex items-center gap-[0.5em]">
            <GoalBar width={width} lifeShare={width} goalLine={hasGoal ? goalLine : null} className="h-[0.36em]" tickClassName="-top-[0.22em] h-[0.8em] w-[0.1em]" />
            {roomy && hasGoal && <p className={cn("shrink-0 font-mono text-[0.8em] leading-none font-bold", done ? "text-up" : "text-gray-700")}>{line.goalPct}%</p>}
            <p className="shrink-0 text-[0.74em] leading-none font-semibold whitespace-nowrap text-gray-500">
              {line.lifePolicies} {line.lifePolicies === 1 ? "policy" : "policies"}
            </p>
            {today && line.todayLifeCents > 0 && <p className="shrink-0 font-mono text-[0.78em] leading-none font-bold whitespace-nowrap text-up">+{formatDollars(line.todayLifeCents)}</p>}
          </div>
        </div>
      </div>
    </li>
  );
}
