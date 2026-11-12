"use client";

import { useEffect, useState, type ReactNode } from "react";
import type { AgentLine, FeedSale, MonthSnapshot } from "@/lib/board";
import { formatDollars } from "@/lib/money";
import { dayLabel } from "@/lib/month";
import { KindDot, PcTag } from "@/components/kind";
import { cn, formatClock } from "@/components/ui";
import { Icon } from "@/components/ui/icon";
import { DeltaChip, Rail } from "@/components/ui/kit";
import { PAGE_MS, compactDollars, firstCompare, sparkValues, type View } from "@/lib/views";

/**
 * The pieces every TV screen shares (the calmer CRM look, 2026-11-12): the right side (Production
 * with the goal line and "On pace for", Policies sold and Active agents, the latest sales), the
 * page dots, the places, and the paging a long list uses in place of scrolling (the TV never
 * scrolls and never cuts a row). Names and amounts only: nothing here reads a client's details.
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

/** "Page 1 of 2" and a dot per page, the page on screen lit; nothing with one page. */
export function PageDots({ pages, page, className }: { pages: number; page: number; className?: string }) {
  if (pages <= 1) return null;
  return (
    <span className={cn("tvb-pager", className)} aria-label={`Page ${page + 1} of ${pages}`}>
      <span className="num">
        Page {page + 1} of {pages}
      </span>
      <span className="tvb-dots" aria-hidden>
        {Array.from({ length: pages }, (_, i) => (
          <i key={i} className={i === page ? "on" : undefined} />
        ))}
      </span>
    </span>
  );
}

/** A medal with its number: silver for 2, bronze for 3 (the P&C screens' places). */
function NumberMedal({ place }: { place: number }) {
  return (
    <svg viewBox="0 0 24 24" className="inline-block h-[1.3em] w-[1.3em]" aria-label={place === 2 ? "Second" : "Third"}>
      <path d="M7 1.5h4l1 5.2-3.4 1.6zM17 1.5h-4l-1 5.2 3.4 1.6z" className="fill-current opacity-60" />
      <circle cx="12" cy="14.6" r="7.6" className="fill-current" />
      <text x="12" y="18.6" textAnchor="middle" className="fill-surface font-mono font-bold" style={{ fontSize: "11px" }}>
        {place}
      </text>
    </svg>
  );
}

/**
 * A place on a P&C leaderboard: a gold crown for 1, a silver and a bronze medal for 2 and 3, the
 * number after that. Someone with no sale yet has no place to show: a quiet dash.
 */
export function PlaceMark({ place, sold, className }: { place: number; sold: boolean; className?: string }) {
  return (
    <span className={cn("inline-flex shrink-0 items-center justify-center font-mono font-bold", !sold ? "text-gray-400" : place === 1 ? "text-gold" : place === 2 ? "text-silver" : place === 3 ? "text-bronze" : "text-gray-500", className)}>
      {!sold ? "–" : place === 1 ? <Crown /> : place <= 3 ? <NumberMedal place={place} /> : place}
    </span>
  );
}

/** A quiet card for a screen with nothing to show yet. */
export function EmptyScreen({ title, line }: { title: string; line: string }) {
  return (
    <div className="tvb-main">
      <section className="tvb-card tvb-emptycard" data-card="empty">
        <h2 className="tvb-title">{title}</h2>
        <p className="tvb-empty-line">{line}</p>
      </section>
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
 * The right side of the leaderboard (owner, 2026-11-12: "what we would be on pace for ...
 * somewhere convenient"): Production against the goal with "On pace for", Policies sold and
 * Active agents, and the latest sales. P&C and the agency total (only while P&C is on) use the same
 * side on their own numbers.
 */
export function RightSide({ snap, view, flash, className }: { snap: MonthSnapshot; view: View; tones?: Record<string, string>; flash: string[]; className?: string }) {
  const { clock: month } = snap;
  const only = !snap.pcEnabled;
  const m = measure(snap, view);
  // Each screen's own latest sales: the month's life or P&C sales, or the newest of both for the total.
  const feed = view === "pc" ? snap.pcRecent.slice(0, 4) : view === "life" ? snap.lifeRecent.slice(0, 4) : snap.recent.filter((r) => r.soldOn.slice(0, 7) === month.key).slice(0, 4);
  const sellers = snap.agents.filter((a) => (view === "pc" ? a.pcCents : view === "total" ? a.lifeCents + a.pcCents : a.lifeCents) > 0).length;
  // The Scoreboard's comparison (the same days of the month before) is life only: P&C and the total go without it.
  const sb = view === "life" ? snap.scoreboard : null;
  const k = sb?.kpis ?? null;
  const first = k ? firstCompare(k) : true;
  const spark = sb && k ? sparkValues(sb.range.days, k.dailyCents, month.position === "current" ? month.today : "9999-12-31") : [];
  return (
    <aside className={cn("tvb-side", className)}>
      <section className="tvb-card tvb-prod" aria-label="Production" data-card="production">
        <div className="tvb-prod-top">
          <div className="min-w-0">
            <div className="tvb-label">{only ? "Production" : view === "life" ? "Life production" : view === "pc" ? "P&C production" : "Agency total · life + P&C"}</div>
            <div key={m.production} className="tvb-big num board-pop">
              {formatDollars(m.production)}
            </div>
          </div>
          {spark.length > 1 && <Spark values={spark} w={140} h={44} />}
        </div>
        {k && (
          <div className="tvb-delta">
            <DeltaChip diff={k.productionCents - k.prevProductionCents} text={compactDollars(Math.abs(k.productionCents - k.prevProductionCents))} vs={sb?.compare.label} first={first} />
          </div>
        )}
        <GoalLine snap={snap} view={view} />
        {month.position === "current" ? (
          <div className="tvb-pace" data-pace>
            <span className="tvb-pace-k">
              <Icon name="trend-up" size={20} className="tvb-ico" />
              On pace for
            </span>
            <b className="tvb-pace-v num">{formatDollars(m.pace.projectedCents)}</b>
          </div>
        ) : (
          <div className="tvb-pace">
            <span className="tvb-pace-k">Month total</span>
            <b className="tvb-pace-v num">{formatDollars(m.production)}</b>
          </div>
        )}
      </section>
      <div className="tvb-pair">
        <Mini label="Policies sold" value={m.policies} was={k ? k.prevPolicies : 0} vs={sb?.compare.label} cap="Policies with premium" />
        <Mini label="Active agents" value={sellers} was={k ? k.prevActiveAgents : 0} vs={sb?.compare.label} cap="Agents who sold" />
      </div>
      <section className="tvb-card tvb-latest" aria-label="Latest sales" data-card="latest">
        <div className="tvb-latest-head">
          <h2 className="tvb-title">{only ? "Latest sales" : view === "life" ? "Latest life sales" : view === "pc" ? "Latest P&C sales" : "Latest sales"}</h2>
          <LatestDay sales={feed} today={month.today} />
        </div>
        <div className="tvb-list">
          {feed.length === 0 ? (
            <p className="tvb-empty-line">{view === "pc" ? "The first P&C sale of the month shows here." : "The first sale of the month shows here."}</p>
          ) : (
            feed.map((s, i) => <SaleRow key={s.id} sale={s} today={month.today} oneDay={oneDayOf(feed)} pc={!only && s.kind === "pc"} flash={i === 0 && flash.includes(s.id)} />)
          )}
        </div>
      </section>
    </aside>
  );
}

/** The day every sale in the list was logged on, when they share one (its rows then show the time alone). */
function oneDayOf(sales: FeedSale[]): string | null {
  const days = new Set(sales.map((s) => s.soldOn));
  return sales.length > 0 && days.size === 1 ? [...days][0] : null;
}

function LatestDay({ sales, today }: { sales: FeedSale[]; today: string }) {
  const day = oneDayOf(sales);
  if (!day) return null;
  return <span className="tvb-on-day num">{day === today ? "Today" : dayLabel(day)}</span>;
}

function SaleRow({ sale, today, oneDay, pc, flash }: { sale: FeedSale; today: string; oneDay: string | null; pc: boolean; flash: boolean }) {
  const what = [sale.carrier, sale.product, sale.policies > 1 ? `${sale.policies} policies` : null].filter(Boolean).join(" · ");
  const when = oneDay || sale.soldOn === today ? formatClock(sale.createdAt) : dayLabel(sale.soldOn);
  return (
    <div className={cn("tvb-sale", flash && "flash")}>
      <span className="tvb-sale-who ell">{sale.agentName}</span>
      <span className="tvb-sale-amt num">{formatDollars(sale.premiumCents)}</span>
      <span className="tvb-sale-what ell">
        {what}
        {pc && <PcTag tv className="ml-[0.5em] align-middle" />}
      </span>
      <span className="tvb-sale-when num">{when}</span>
    </div>
  );
}

/** A small card: the number, its chip against the month before when that month had numbers, what it counts. */
function Mini({ label, value, was, vs, cap }: { label: string; value: number; was: number; vs?: string; cap: string }) {
  return (
    <section className="tvb-card tvb-mini" aria-label={label} data-card={label}>
      <div className="tvb-label">{label}</div>
      <div className="tvb-big num">{value}</div>
      {was > 0 && (
        <div className="tvb-delta">
          <DeltaChip diff={value - was} text={String(Math.abs(value - was))} vs={vs} />
        </div>
      )}
      <div className="tvb-cap">{cap}</div>
    </section>
  );
}

/** The progress line toward a view's goal, "61% of $150,000 goal" and where the month stands against the straight line to it. */
function GoalLine({ snap, view }: { snap: MonthSnapshot; view: View }) {
  const { clock } = snap;
  const m = measure(snap, view);
  if (m.goal <= 0) return <p className="tvb-goal-none">{view === "pc" ? "No P&C goal set yet" : "No goal set yet"}</p>;
  const pct = Math.max(0, m.pct);
  let where: ReactNode;
  if (clock.position === "past") where = m.production >= m.goal ? <b className="tvb-up">Goal hit</b> : <span>
        <b className="num">{formatDollars(m.goal - m.production)}</b> short
      </span>;
  else if (m.pace.status === "done") where = <b className="tvb-up">Goal hit</b>;
  else if (clock.elapsed === 0) where = <span>The month starts soon</span>;
  else if (m.pace.status === "ahead")
    where = (
      <span>
        Ahead by <b className="tvb-up num">{formatDollars(m.pace.aheadCents)}</b>
      </span>
    );
  else if (m.pace.status === "behind")
    where = (
      <span>
        Behind by <b className="tvb-down num">{formatDollars(-m.pace.aheadCents)}</b>
      </span>
    );
  else where = <b>On the goal line</b>;
  return (
    <div className="tvb-goal">
      <Rail value={Math.min(100, pct) / 100} label={`${pct}% of the goal`} />
      <div className="tvb-goal-text">
        <span>
          <span className="num">{pct}%</span> of <span className="num">{formatDollars(m.goal)}</span> goal
        </span>
        {where}
      </div>
    </div>
  );
}

/** A small line chart with no axes (one point per business day), in the quiet spark color. */
export function Spark({ values, w, h, className }: { values: number[]; w: number; h: number; className?: string }) {
  if (values.length < 2) return null;
  const max = Math.max(1, ...values);
  const points = values.map((v, i) => `${((i / (values.length - 1)) * w).toFixed(1)},${(h - 3 - (Math.max(0, v) / max) * (h - 6)).toFixed(1)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className={cn("spark", className)} style={{ width: `calc(${w} * var(--u))`, height: `calc(${h} * var(--u))` }} aria-hidden>
      <polyline points={points} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export function Crown() {
  return (
    <svg viewBox="0 0 24 24" className="inline-block h-[1.15em] w-[1.15em] fill-current" aria-label="First">
      <path d="M3 8l4.5 4L12 5l4.5 7L21 8l-2 11H5z" />
    </svg>
  );
}
