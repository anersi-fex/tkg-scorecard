"use client";

import type { AgentLine, MonthSnapshot } from "@/lib/board";
import { formatDollars } from "@/lib/money";
import { monthName } from "@/lib/month";
import { Avatar, shortName } from "@/components/avatar";
import { GoalBar } from "@/components/goal-bar";
import { KindDot, KindSplit } from "@/components/kind";
import { cn } from "@/components/ui";
import { linesSummary, type View } from "@/lib/views";
import { Crown, RightSide, ViewDot, goalOf } from "./parts";

/**
 * The two screens that exist only while P&C is switched on (Settings, owner only): the agency
 * total (life and P&C added up) and the P&C board. With P&C off the TV never mounts this file's
 * screens, so none of their words can reach it.
 */

/** The life screen and the agency total: the same board, measured in life alone or with P&C added. */
export function MainScreen({ snap, view, tones, flash }: { snap: MonthSnapshot; view: "life" | "total"; tones: Record<string, string>; flash: string[] }) {
  const { team, clock: month } = snap;
  const life = view === "life";
  const amountOf = (a: AgentLine) => (life ? a.lifeCents : a.premiumCents);
  const people = (life ? snap.agents : [...snap.agents].sort((a, b) => a.totalRank - b.totalRank)).filter((a) => a.active || amountOf(a) > 0);
  const max = Math.max(1, ...people.map(amountOf));
  // The goal line today, the same tick on every bar: how far through its business days the month is.
  const goalLine = month.position === "current" && month.elapsed > 0 && people.some((a) => goalOf(a, view).goal > 0) ? Math.round(month.progress * 100) : null;
  const split = !life && team.pcCents > 0;
  const current = month.position === "current";
  return (
    <div className="mt-[0.9em] grid min-h-0 flex-1 grid-cols-12 gap-[1em]">
      {/* Leaderboard */}
      <section className="col-span-7 flex min-h-0 flex-col rounded-[1.4em] bg-surface p-[1.1em] shadow-card">
        <div className="flex items-baseline justify-between">
          <h2 className="flex items-center gap-[0.45em] text-[1.25em] font-extrabold tracking-[-0.02em]">
            <ViewDot view={view} className="h-[0.5em] w-[0.5em]" />
            {life ? "Life leaderboard" : "Agency leaderboard"}
          </h2>
          <p className="flex items-center gap-[0.45em] text-[0.85em] font-semibold text-gray-500">
            {split && (
              <>
                <KindDot kind="life" className="h-[0.5em] w-[0.5em]" />
                life
                <KindDot kind="pc" className="ml-[0.3em] h-[0.5em] w-[0.5em]" />
                P&C
                <span aria-hidden>·</span>
              </>
            )}
            {goalLine !== null && (
              <>
                <span aria-hidden className="inline-block h-[0.9em] w-[0.12em] rounded-full bg-gray-500" />
                goal line today
                <span aria-hidden>·</span>
              </>
            )}
            {life ? "annual premium · policies" : "life + P&C"}
          </p>
        </div>
        {people.length === 0 ? (
          <p className="flex flex-1 items-center justify-center text-[1.2em] font-semibold text-gray-500">Add your team in Scorecard on your phone.</p>
        ) : (
          <ol className="mt-[0.6em] flex min-h-0 flex-1 flex-col gap-[0.45em]">
            {people.map((a) => (
              <LeaderRow key={a.id} line={a} view={view} max={max} count={people.length} today={current} goalLine={goalLine} />
            ))}
          </ol>
        )}
      </section>
      <RightSide snap={snap} view={view} tones={tones} flash={flash} />
    </div>
  );
}

/**
 * The P&C screen, laid out like the others (owner, 2026-11-04): the P&C leaderboard over the month's
 * carriers and lines on the left, the same right side as every screen (its goal ring, tiles, chart
 * against its goal line, latest P&C sales).
 */
export function PcScreen({ snap, tones, flash }: { snap: MonthSnapshot; tones: Record<string, string>; flash: string[] }) {
  const { team, clock: month } = snap;
  const people = snap.agents.filter((a) => a.pcRank !== null && (a.active || a.pcCents > 0)).sort((a, b) => (a.pcRank ?? 0) - (b.pcRank ?? 0));
  const lead = Math.max(1, ...people.map((a) => a.pcCents));
  const maxCarrier = Math.max(1, ...team.pcByCarrier.map((c) => c.policies));
  const current = month.position === "current";
  const goalLine = current && month.elapsed > 0 && people.some((a) => a.pcGoalCents > 0) ? Math.round(month.progress * 100) : null;
  // More P&C people, smaller rows and fewer carriers and lines below them; the rest fold into one line.
  const n = people.length;
  const carriersShown = n <= 3 ? 5 : n <= 5 ? 4 : n <= 7 ? 3 : 2;
  const linesShown = n <= 3 ? 6 : n <= 5 ? 4 : 2;
  const carriers = team.pcByCarrier.length > carriersShown ? team.pcByCarrier.slice(0, carriersShown - 1) : team.pcByCarrier;
  const moreCarriers = team.pcByCarrier.slice(carriers.length);
  const lines = team.pcByLine.slice(0, linesShown);
  return (
    <div className="mt-[0.9em] grid min-h-0 flex-1 grid-cols-12 gap-[1em]">
      <div className="col-span-7 flex min-h-0 flex-col gap-[1em]">
        <section className="flex min-h-0 shrink-0 flex-col rounded-[1.4em] bg-surface p-[1.1em] shadow-card">
          <div className="flex items-baseline justify-between">
            <h2 className="flex items-center gap-[0.45em] text-[1.25em] font-extrabold tracking-[-0.02em]">
              <ViewDot view="pc" className="h-[0.5em] w-[0.5em]" />
              P&C leaderboard
            </h2>
            <p className="flex items-center gap-[0.45em] text-[0.85em] font-semibold text-gray-500">
              {goalLine !== null && (
                <>
                  <span aria-hidden className="inline-block h-[0.9em] w-[0.12em] rounded-full bg-gray-500" />
                  goal line today
                  <span aria-hidden>·</span>
                </>
              )}
              annual premium · policies · lines
            </p>
          </div>
          {people.length === 0 ? (
            <p className="py-[2em] text-center text-[1.2em] font-semibold text-gray-500">Nobody is P&C licensed yet: Team, on your phone.</p>
          ) : (
            <ol className="mt-[0.6em] flex min-h-0 flex-col gap-[0.45em]">
              {people.map((a) => (
                <LeaderRow key={a.id} line={a} view="pc" max={lead} count={n} today={current} goalLine={goalLine} />
              ))}
            </ol>
          )}
        </section>
        {/* The month's carriers and lines, side by side */}
        <section className="grid min-h-[9em] flex-1 grid-cols-2 gap-[1.4em] overflow-hidden rounded-[1.4em] bg-surface p-[1.1em] shadow-card">
          <div className="flex min-h-0 flex-col">
            <div className="flex items-baseline justify-between">
              <h2 className="text-[1.15em] font-extrabold tracking-[-0.02em]">By carrier</h2>
              <p className="text-[0.8em] font-semibold text-gray-500">{current ? `${monthName(month.key)} so far` : monthName(month.key)}</p>
            </div>
            {team.pcByCarrier.length === 0 ? (
              <p className="flex flex-1 items-center justify-center text-[1em] font-semibold text-gray-500">No P&C yet this month.</p>
            ) : (
              <ul className="mt-[0.5em] flex min-h-0 flex-col gap-[0.4em]">
                {carriers.map((c) => (
                  <li key={c.name} className="min-w-0">
                    <div className="flex items-baseline justify-between gap-[0.8em]">
                      <p className="truncate text-[1em] font-extrabold tracking-[-0.02em]">{c.name}</p>
                      <p className="shrink-0 font-mono text-[1em] font-bold">
                        <span className="mr-[0.5em] font-sans text-[0.8em] font-semibold text-gray-500">{c.policies}</span>
                        {formatDollars(c.cents)}
                      </p>
                    </div>
                    <div className="mt-[0.2em] h-[0.5em] overflow-hidden rounded-full bg-track">
                      <div className="h-full rounded-full bg-pc-grad" style={{ width: `${Math.round((c.policies / maxCarrier) * 100)}%` }} />
                    </div>
                    <p className="mt-[0.15em] truncate text-[0.8em] leading-tight font-semibold text-gray-500">{linesSummary(c.lines)}</p>
                  </li>
                ))}
                {moreCarriers.length > 0 && (
                  <li className="truncate text-[0.9em] font-semibold text-gray-500">
                    +{moreCarriers.length} more · {moreCarriers.reduce((k, c) => k + c.policies, 0)} policies · {formatDollars(moreCarriers.reduce((k, c) => k + c.cents, 0))}
                  </li>
                )}
              </ul>
            )}
          </div>
          <div className="flex min-h-0 flex-col">
            <div className="flex items-baseline justify-between">
              <h2 className="text-[1.15em] font-extrabold tracking-[-0.02em]">By line</h2>
              <p className="text-[0.8em] font-semibold text-gray-500">policies · premium</p>
            </div>
            {team.pcByLine.length === 0 ? (
              <p className="flex flex-1 items-center justify-center text-[1em] font-semibold text-gray-500">No P&C yet this month.</p>
            ) : (
              <div className="mt-[0.6em] grid grid-cols-2 gap-[0.5em]">
                {lines.map((l) => (
                  <div key={l.name} className="min-w-0 rounded-[0.9em] bg-surface-2 px-[0.75em] pt-[0.45em] pb-[0.5em]">
                    <p className="flex items-center gap-[0.45em] truncate text-[0.75em] font-bold tracking-[0.08em] text-gray-500 uppercase">
                      <KindDot kind="pc" className="h-[0.55em] w-[0.55em]" />
                      {l.name}
                    </p>
                    <p className="mt-[0.15em] font-mono text-[1.4em] leading-none font-bold">{l.policies}</p>
                    <p className="mt-[0.15em] truncate font-mono text-[0.8em] font-semibold text-gray-500">{formatDollars(l.cents)}</p>
                  </div>
                ))}
                {team.pcByLine.length > lines.length && <p className="col-span-2 truncate text-[0.9em] font-semibold text-gray-500">+{team.pcByLine.length - lines.length} more lines</p>}
              </div>
            )}
          </div>
        </section>
      </div>
      <RightSide snap={snap} view="pc" tones={tones} flash={flash} />
    </div>
  );
}

/**
 * One leaderboard row on any screen: the share of their own goal on that screen (life, P&C, or both
 * goals added up), of the leader's amount without one, with the goal line today as a tick.
 */
function LeaderRow({ line, view, max, count, today, goalLine }: { line: AgentLine; view: View; max: number; count: number; today: boolean; goalLine: number | null }) {
  const life = view === "life";
  const pc = view === "pc";
  const amount = life ? line.lifeCents : pc ? line.pcCents : line.premiumCents;
  const todayCents = life ? line.todayLifeCents : pc ? line.todayPcCents : line.todayCents;
  const rank = life ? line.rank : pc ? (line.pcRank ?? 0) : line.totalRank;
  const { goal, pct } = goalOf(line, view);
  const hasGoal = goal > 0;
  // One track for everyone: the share of their own goal (of the leader's amount without one).
  const width = hasGoal ? Math.min(100, pct) : Math.round((amount / max) * 100);
  const lifeShare = pc ? 0 : life ? width : line.premiumCents > 0 ? (width * line.lifeCents) / line.premiumCents : 0;
  const done = hasGoal && pct >= 100;
  const first = rank === 1 && amount > 0;
  const medal = amount > 0 ? (rank === 1 ? "text-gold" : rank === 2 ? "text-silver" : rank === 3 ? "text-bronze" : "text-gray-500") : "text-gray-500";
  // Fewer people, taller rows: the type grows a little when there is room. The P&C rows keep one size.
  const scale = pc ? (count <= 3 ? 1.05 : count <= 5 ? 0.95 : count <= 7 ? 0.82 : 0.68) : count <= 5 ? 1.15 : count <= 7 ? 1 : count <= 8 ? 0.86 : 0.7;
  const policies = life ? line.lifePolicies : pc ? line.pcPolicies : line.policies;
  return (
    <li
      className={cn("flex min-h-0 items-center gap-[0.9em] rounded-[1em] px-[0.8em]", pc ? (count <= 3 ? "h-[4.9em] shrink-0" : "h-[4.3em] shrink-0") : "flex-1", first && (pc ? "bg-surface-2" : "bg-tint/60"))}
      style={{ fontSize: `${scale}em` }}
    >
      <span className={cn("w-[1.4em] shrink-0 text-center font-mono text-[1.4em] font-bold", medal)}>{first ? <Crown /> : rank}</span>
      <Avatar name={line.name} tone={line.tone} size={44} className="!h-[2.6em] !w-[2.6em] !text-[0.95em]" />
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-[1em]">
          <p className="min-w-0 truncate text-[1.35em] leading-tight font-extrabold tracking-[-0.02em]">{line.name.length > 18 ? shortName(line.name) : line.name}</p>
          <div className="shrink-0 text-right">
            <p className="font-mono text-[1.5em] leading-none font-bold tracking-[-0.02em]">{formatDollars(amount)}</p>
            {today && todayCents > 0 && <p className="mt-[0.2em] text-[0.8em] leading-none font-bold text-up">+{formatDollars(todayCents)} today</p>}
          </div>
        </div>
        <div className="mt-[0.45em] flex items-center gap-[0.8em]">
          <GoalBar width={width} lifeShare={lifeShare} goalLine={hasGoal ? goalLine : null} className="h-[0.55em]" tickClassName="-top-[0.3em] h-[1.15em] w-[0.12em]" />
          {hasGoal && <p className={cn("w-[3em] shrink-0 text-right font-mono text-[0.95em] leading-none font-bold", done ? "text-up" : "text-gray-700")}>{pct}%</p>}
        </div>
        <p className="mt-[0.3em] truncate text-[0.85em] leading-none font-semibold whitespace-nowrap text-gray-500">
          {!life && !pc && line.pcCents > 0 ? (
            <KindSplit dot="h-[0.45em] w-[0.45em]" life={<span className="font-mono">{formatDollars(line.lifeCents)} · {line.lifePolicies}</span>} pc={<span className="font-mono">{formatDollars(line.pcCents)} · {line.pcPolicies}</span>} />
          ) : (
            `${policies} ${policies === 1 ? "policy" : "policies"}`
          )}
          {pc && line.pcLines.length > 0 && ` · ${linesSummary(line.pcLines)}`}
          {!hasGoal && " · no goal"}
        </p>
      </div>
    </li>
  );
}
