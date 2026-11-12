"use client";

import { useEffect, useState } from "react";
import type { AgentLine, FeedSale, MonthSnapshot } from "@/lib/board";
import { formatDollars, formatMoney } from "@/lib/money";
import { dayLabel } from "@/lib/month";
import { Avatar, firstName } from "@/components/avatar";
import { KindDot, KindSplit, PcTag } from "@/components/kind";
import { MonthChart } from "@/components/month-chart";
import { cn, formatClock } from "@/components/ui";
import { PAGE_MS, lifeDaily, pcDaily, type View } from "@/lib/views";

/**
 * The pieces every TV screen shares: the right side (the goal ring, the tiles, the month's chart,
 * the latest sales), the place marks (a crown, medals), and the paging a long list uses in place
 * of scrolling (the TV never scrolls and never cuts a row).
 */

/**
 * The box of an element in the board's own em (the whole board scales with the screen), measured
 * again whenever it resizes. Pass `ref` to the element; `box` is null until the first measure.
 */
export function useBoxEm(): [(el: HTMLElement | null) => void, { w: number; h: number } | null] {
  const [el, setEl] = useState<HTMLElement | null>(null);
  const [box, setBox] = useState<{ w: number; h: number } | null>(null);
  useEffect(() => {
    if (!el) return;
    const observer = new ResizeObserver(() => {
      const em = parseFloat(getComputedStyle(el).fontSize) || 16;
      const r = el.getBoundingClientRect();
      setBox((old) => {
        const next = { w: r.width / em, h: r.height / em };
        return old && Math.abs(old.w - next.w) < 0.01 && Math.abs(old.h - next.h) < 0.01 ? old : next;
      });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [el]);
  return [setEl, box];
}

/** The page a list is on: the next one every few seconds, around and around; 0 with one page. */
export function usePager(pages: number, ms: number = PAGE_MS): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (pages <= 1) return;
    const id = setInterval(() => setTick((t) => t + 1), ms);
    return () => clearInterval(id);
  }, [pages, ms]);
  return pages <= 1 ? 0 : tick % pages;
}

/** Tells the board how many pages a screen has, so the screen stays until each page had its time. */
export function useReportPages(pages: number, onPages?: (pages: number) => void) {
  useEffect(() => {
    onPages?.(pages);
  }, [pages, onPages]);
}

/** Small dots for a paged list, the page on screen lit; nothing with one page. */
export function PageDots({ pages, page, className }: { pages: number; page: number; className?: string }) {
  if (pages <= 1) return null;
  return (
    <span className={cn("inline-flex items-center gap-[0.35em]", className)} aria-label={`Page ${page + 1} of ${pages}`}>
      {Array.from({ length: pages }, (_, i) => (
        <span key={i} aria-hidden className={cn("h-[0.5em] rounded-full transition-all duration-300", i === page ? "w-[1.3em] bg-accent" : "w-[0.5em] bg-gray-300")} />
      ))}
    </span>
  );
}

/** A medal with its number: silver for 2, bronze for 3. */
export function Medal({ place }: { place: number }) {
  return (
    <svg viewBox="0 0 24 24" className="inline-block h-[1.15em] w-[1.15em]" aria-label={place === 2 ? "Second" : "Third"}>
      <path d="M7 1.5h4l1 5.2-3.4 1.6zM17 1.5h-4l-1 5.2 3.4 1.6z" className="fill-current opacity-60" />
      <circle cx="12" cy="14.6" r="7.6" className="fill-current" />
      <text x="12" y="18.6" textAnchor="middle" className="fill-surface font-mono font-bold" style={{ fontSize: "11px" }}>
        {place}
      </text>
    </svg>
  );
}

/**
 * A place on a leaderboard: a gold crown for 1, a silver and a bronze medal for 2 and 3, the
 * number after that. Someone with no sale yet has no place to show: a quiet dash.
 */
export function PlaceMark({ place, sold, className }: { place: number; sold: boolean; className?: string }) {
  return (
    <span className={cn("inline-flex shrink-0 items-center justify-center font-mono font-bold", !sold ? "text-gray-400" : place === 1 ? "text-gold" : place === 2 ? "text-silver" : place === 3 ? "text-bronze" : "text-gray-500", className)}>
      {!sold ? "–" : place === 1 ? <Crown /> : place <= 3 ? <Medal place={place} /> : place}
    </span>
  );
}

/** Only the medal of a place (the Production table prints the number beside it); nothing after third. */
export function PlaceMedal({ place, className }: { place: number; className?: string }) {
  if (place > 3) return <span aria-hidden className={className} />;
  return <span className={cn("inline-flex items-center justify-center", place === 1 ? "text-gold" : place === 2 ? "text-silver" : "text-bronze", className)}>{place === 1 ? <Crown /> : <Medal place={place} />}</span>;
}

/** A quiet line for a screen with nothing to show yet. */
export function EmptyScreen({ title, line }: { title: string; line: string }) {
  return (
    <div className="mt-[0.9em] flex min-h-0 flex-1 flex-col items-center justify-center rounded-[1.4em] bg-surface text-center shadow-card">
      <p className="text-[1.6em] font-extrabold tracking-[-0.02em]">{title}</p>
      <p className="mt-[0.4em] text-[1.1em] font-semibold text-gray-500">{line}</p>
    </div>
  );
}

/** The dot of a view: the brand accent for life, P&C's color, both halves for the agency total. */
export function ViewDot({ view, className }: { view: View; className?: string }) {
  if (view === "total") {
    return (
      <span aria-hidden className={cn("inline-flex shrink-0 overflow-hidden rounded-full", className)}>
        <span className="h-full w-1/2 bg-accent" />
        <span className="h-full w-1/2 bg-pc" />
      </span>
    );
  }
  return <KindDot kind={view} className={className} />;
}

/** What a view measures: its production, its goal, its percent and its pace, today, policies and average. */
export function measure(snap: MonthSnapshot, view: View) {
  const { team } = snap;
  if (view === "pc")
    return { production: team.pcCents, goal: team.pcGoalCents, pct: team.pcGoalPct, pace: team.pcPace, today: team.todayPcCents, todayPolicies: team.todayPcPolicies, policies: team.pcPolicies, average: team.pcAverageCents };
  if (view === "total")
    return { production: team.productionCents, goal: team.totalGoalCents, pct: team.totalGoalPct, pace: team.totalPace, today: team.todayCents, todayPolicies: team.todayPolicies, policies: team.policies, average: team.averageCents };
  return { production: team.lifeCents, goal: team.goalCents, pct: team.goalPct, pace: team.pace, today: team.todayLifeCents, todayPolicies: team.todayLifePolicies, policies: team.lifePolicies, average: team.lifeAverageCents };
}

/** A person's goal and percent on a view: life, P&C, or both added up. */
export function goalOf(line: AgentLine, view: View): { goal: number; pct: number } {
  if (view === "pc") return { goal: line.pcGoalCents, pct: line.pcGoalPct };
  if (view === "total") return { goal: line.totalGoalCents, pct: line.totalGoalPct };
  return { goal: line.goalCents, pct: line.goalPct };
}

/**
 * The right side, the same on every screen (owner, 2026-11-04: "the whole right side, to be the exact
 * same for each screen: a graph, recent sales, and numbers and stats"): the goal ring, three tiles,
 * the month's chart against the goal line, and the latest sales.
 */
export function RightSide({ snap, view, tones, flash }: { snap: MonthSnapshot; view: View; tones: Record<string, string>; flash: string[] }) {
  const { team, clock: month } = snap;
  const m = measure(snap, view);
  const current = month.position === "current";
  const best = view === "life" ? team.bestLifeDay : view === "total" ? team.bestDay : null;
  // Each screen's own latest sales: the month's life or P&C sales, or the newest of both for the total.
  const feed = view === "pc" ? snap.pcRecent.slice(0, 4) : view === "life" ? snap.lifeRecent.slice(0, 4) : snap.recent.filter((r) => r.soldOn.slice(0, 7) === month.key).slice(0, 4);
  const daily = view === "life" ? lifeDaily(snap.daily) : view === "pc" ? pcDaily(snap.daily) : snap.daily;
  return (
    <div className="col-span-5 flex min-h-0 flex-col gap-[1em]">
      <GoalCard snap={snap} view={view} />
      <section className="grid shrink-0 grid-cols-3 gap-[0.7em]">
        {current ? (
          <Tile
            label="Today"
            value={formatDollars(m.today)}
            sub={`${m.todayPolicies} ${m.todayPolicies === 1 ? "policy" : "policies"}${view === "total" && team.todayPcPolicies > 0 ? ` · ${team.todayPcPolicies} P&C` : ""}`}
            tone={current && m.today > 0 ? "up" : undefined}
          />
        ) : view === "pc" ? (
          <Tile label="Lines" value={String(team.pcByLine.length)} sub="written that month" />
        ) : (
          <Tile label="Best day" value={best ? formatDollars(best.cents) : "–"} sub={best ? dayLabel(best.date) : ""} />
        )}
        <Tile
          label="Policies"
          value={String(m.policies)}
          sub={view === "total" && team.pcPolicies > 0 ? `${team.lifePolicies} life · ${team.pcPolicies} P&C` : m.average ? `${formatDollars(m.average)} avg` : "this month"}
        />
        <NeededTile snap={snap} view={view} />
      </section>
      <section className="min-h-0 flex-1 rounded-[1.4em] bg-surface p-[1em] shadow-card">
        <div className="flex items-baseline justify-between">
          <h2 className="text-[1.05em] font-extrabold tracking-[-0.02em]">The month so far</h2>
          <p className="text-[0.8em] font-semibold text-gray-500">
            <span className={cn("mr-[0.5em] inline-block h-[0.55em] w-[1.4em] rounded-full align-middle", view === "pc" ? "bg-pc-grad" : "bg-chart-1")} />
            {view === "life" ? "life production" : view === "pc" ? "P&C production" : "life + P&C"}
            <span className="mr-[0.5em] ml-[1em] inline-block h-[0.55em] w-[1.4em] rounded-full bg-chart-2 align-middle" />
            goal line
          </p>
        </div>
        <MonthChart daily={daily} goalCents={m.goal} today={month.today} height={150} tone={view === "pc" ? "pc" : "brand"} className="mt-[0.4em] h-[calc(100%-1.8em)] w-full" />
      </section>
      <Feed
        title={view === "life" ? "Latest life sales" : view === "pc" ? "Latest P&C sales" : "Latest sales"}
        sales={feed}
        tones={tones}
        today={month.today}
        empty={view === "pc" ? "The first P&C sale of the month lights this up." : undefined}
        flash={flash}
      />
    </div>
  );
}

export function Crown() {
  return (
    <svg viewBox="0 0 24 24" className="inline-block h-[1em] w-[1em] fill-current" aria-label="First">
      <path d="M3 8l4.5 4L12 5l4.5 7L21 8l-2 11H5z" />
    </svg>
  );
}

/** The words under the goal ring: a view's production against its goal and the straight line to it. */
export function paceWords(clock: MonthSnapshot["clock"], pace: MonthSnapshot["team"]["pace"], production: number, goal: number): { line: string; tone: string } {
  if (clock.position === "past") {
    const hit = production >= goal && goal > 0;
    return { line: goal <= 0 ? "Finished" : hit ? "Goal hit" : `${formatDollars(goal - production)} short`, tone: hit ? "text-up" : "text-gray-600" };
  }
  if (pace.status === "done") return { line: `Goal hit, ${formatDollars(production - goal)} over`, tone: "text-up" };
  if (clock.elapsed === 0) return { line: clock.position === "future" ? "The month hasn't started" : "The month starts Monday", tone: "text-gray-600" };
  if (pace.status === "none") return { line: `On pace for ${formatDollars(pace.projectedCents)}`, tone: "text-gray-600" };
  if (clock.remaining === 0 && clock.todayBusiness) return { line: `${formatDollars(goal - production)} to go · last business day`, tone: pace.status === "ahead" ? "text-up" : pace.status === "on" ? "text-accent-text" : "text-down" };
  if (clock.remaining === 0) return { line: `${formatDollars(goal - production)} to go · no business days left`, tone: "text-down" };
  if (pace.status === "ahead") return { line: `Ahead by ${formatDollars(pace.aheadCents)} · on pace for ${formatDollars(pace.projectedCents)}`, tone: "text-up" };
  if (pace.status === "on") return { line: `Right on the line · on pace for ${formatDollars(pace.projectedCents)}`, tone: "text-accent-text" };
  return { line: `Behind by ${formatDollars(-pace.aheadCents)} · on pace for ${formatDollars(pace.projectedCents)}`, tone: "text-down" };
}

/**
 * The ring and the production of a view against its goal: life in the brand gradient, P&C in its
 * silver one, and the agency total's ring in both, life then P&C, against both goals added up.
 */
export function GoalCard({ snap, view }: { snap: MonthSnapshot; view: View }) {
  const { team, clock } = snap;
  const m = measure(snap, view);
  const pct = m.goal > 0 ? Math.min(100, m.pct) : 0;
  const lifePct = view === "life" ? pct : view === "pc" ? 0 : team.productionCents > 0 ? (pct * team.lifeCents) / team.productionCents : pct;
  const r = 44;
  const c = 2 * Math.PI * r;
  const { line, tone } = paceWords(clock, m.pace, m.production, m.goal);
  const eyebrow = view === "life" ? "Life production" : view === "pc" ? "P&C production" : "Agency total · life + P&C";
  const of = m.goal > 0 ? `of ${formatDollars(m.goal)}${view === "total" && team.pcGoalCents > 0 ? " · life + P&C goals" : ""}` : view === "pc" ? "no P&C goal set yet" : "no goal set yet";
  return (
    <section className="flex shrink-0 items-center gap-[1.2em] rounded-[1.4em] bg-surface p-[1.1em] shadow-card">
      <div className="relative h-[8.4em] w-[8.4em] shrink-0">
        <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90">
          <defs>
            <linearGradient id="ring-grad" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" style={{ stopColor: "var(--t-grad-from)" }} />
              <stop offset="1" style={{ stopColor: "var(--t-grad-to)" }} />
            </linearGradient>
            <linearGradient id="ring-pc-grad" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" style={{ stopColor: "var(--t-pc-from)" }} />
              <stop offset="1" style={{ stopColor: "var(--t-pc-to)" }} />
            </linearGradient>
          </defs>
          <circle cx="50" cy="50" r={r} fill="none" className="stroke-track" strokeWidth="9" />
          {view !== "life" && (view === "pc" || team.pcCents > 0) && (
            <circle key={`pc-${view}-${pct}`} cx="50" cy="50" r={r} fill="none" stroke="url(#ring-pc-grad)" strokeWidth="9" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - pct / 100)} style={{ transition: "stroke-dashoffset 900ms cubic-bezier(0.2, 0.8, 0.2, 1)" }} />
          )}
          {view !== "pc" && (
            <circle
              key={`${view}-${lifePct}`}
              cx="50"
              cy="50"
              r={r}
              fill="none"
              stroke="url(#ring-grad)"
              strokeWidth="9"
              strokeLinecap="round"
              strokeDasharray={c}
              strokeDashoffset={c * (1 - lifePct / 100)}
              style={{ transition: "stroke-dashoffset 900ms cubic-bezier(0.2, 0.8, 0.2, 1)" }}
            />
          )}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="font-mono text-[2em] leading-none font-bold tracking-[-0.03em]">{m.goal > 0 ? `${m.pct}%` : "–"}</span>
          <span className="mt-[0.3em] text-[0.7em] font-bold tracking-[0.08em] text-gray-500 uppercase">of goal</span>
        </div>
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[0.8em] font-bold tracking-[0.09em] text-gray-500 uppercase">{eyebrow}</p>
        <p key={m.production} className="board-pop mt-[0.15em] font-mono text-[2.9em] leading-none font-bold tracking-[-0.035em]">
          {formatDollars(m.production)}
        </p>
        <p className="mt-[0.35em] truncate text-[1em] font-semibold text-gray-500">{of}</p>
        {view === "total" && team.pcCents > 0 && (
          <p className="mt-[0.4em] text-[1em] font-semibold text-gray-600">
            <KindSplit dot="h-[0.55em] w-[0.55em]" life={<span className="font-mono text-gray-900">{formatDollars(team.lifeCents)}</span>} pc={<span className="font-mono text-gray-900">{formatDollars(team.pcCents)}</span>} />
          </p>
        )}
        <p className={cn("mt-[0.5em] text-[1em] leading-snug font-bold", tone)}>{line}</p>
      </div>
    </section>
  );
}

/** The third tile: what each day left needs for a view's goal, or what today needs on the last business day. */
export function NeededTile({ snap, view }: { snap: MonthSnapshot; view: View }) {
  const { clock } = snap;
  const m = measure(snap, view);
  if (m.goal <= 0) return <Tile label="On pace for" value={formatDollars(m.pace.projectedCents)} sub={view === "pc" ? "set a P&C goal in Settings" : "set a goal in Settings"} />;
  if (m.pace.status === "done") return <Tile label="Over the goal" value={formatDollars(m.production - m.goal)} sub="keep going" />;
  if (clock.remaining === 0 && clock.todayBusiness) return <Tile label="Needed today" value={formatDollars(m.goal - m.production)} sub="last business day" />;
  if (clock.remaining === 0) return <Tile label="To go" value={formatDollars(m.goal - m.production)} sub="no business days left" />;
  return <Tile label="Needed a day" value={formatDollars(m.pace.neededPerDayCents)} sub={`to hit ${formatDollars(m.goal)}`} />;
}

export function Tile({ label, value, sub, tone }: { label: string; value: string; sub: string; tone?: "up" }) {
  return (
    <div className="rounded-[1.2em] bg-surface px-[0.9em] py-[0.8em] shadow-card">
      <p className="truncate text-[0.75em] font-bold tracking-[0.08em] text-gray-500 uppercase">{label}</p>
      <p className={cn("mt-[0.2em] truncate font-mono text-[1.7em] leading-none font-bold tracking-[-0.03em]", tone === "up" ? "text-up" : "text-gray-900")}>{value}</p>
      <p className="mt-[0.35em] truncate text-[0.8em] font-semibold text-gray-500">{sub}</p>
    </div>
  );
}

export function Feed({ title, sales, tones, today, empty, grow = false, flash = [] }: { title: string; sales: FeedSale[]; tones: Record<string, string>; today: string; empty?: string; grow?: boolean; flash?: string[] }) {
  return (
    <section className={cn("min-h-0 overflow-hidden rounded-[1.4em] bg-surface p-[1em] shadow-card", grow ? "flex-1" : "shrink-0")}>
      <h2 className="text-[1.05em] font-extrabold tracking-[-0.02em]">{title}</h2>
      {sales.length === 0 ? (
        <p className="mt-[0.5em] text-[0.95em] font-semibold text-gray-500">{empty ?? "The first sale of the month lights this up."}</p>
      ) : (
        <ul className="mt-[0.5em] space-y-[0.35em]">
          {sales.map((s, i) => (
            <li key={s.id} className={cn("flex items-center gap-[0.7em] rounded-[0.8em] px-[0.4em] py-[0.25em]", i === 0 && flash.includes(s.id) && "board-flash")}>
              <Avatar name={s.agentName} tone={tones[s.agentId]} size={32} className="!h-[2em] !w-[2em] !text-[0.75em]" />
              <p className="min-w-0 flex-1 truncate text-[1em] font-bold">
                {firstName(s.agentName)}
                <span className="font-semibold text-gray-500">
                  {s.carrier ? ` · ${s.carrier}` : ""}
                  {s.product ? ` · ${s.product}` : ""}
                  {s.policies > 1 ? ` · ${s.policies} policies` : ""}
                </span>
                {s.kind === "pc" && <PcTag tv className="ml-[0.5em] align-middle" />}
              </p>
              <p className="shrink-0 text-[0.8em] font-semibold text-gray-500">{s.soldOn === today ? formatClock(s.createdAt) : dayLabel(s.soldOn)}</p>
              <p className="shrink-0 font-mono text-[1.1em] font-bold">{formatMoney(s.premiumCents)}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
