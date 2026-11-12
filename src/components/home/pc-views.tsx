import Link from "next/link";
import type { MonthSnapshot } from "@/lib/board";
import { dayLabel, type MonthClock, type Pace } from "@/lib/month";
import { linesSummary, pcDaily } from "@/lib/views";
import { formatDollars } from "@/lib/money";
import { Avatar } from "@/components/avatar";
import { GoalBar } from "@/components/goal-bar";
import { KindDot, KindSplit } from "@/components/kind";
import { MonthChart } from "@/components/month-chart";
import { Eyebrow, ListCard, ListTitle, ROW_INSET } from "@/components/tide";
import { Card, cn } from "@/components/ui";
import type { AgentLine } from "@/lib/board";

/*
 * Home's P&C and Agency total views, kept as they were (owner, 2026-11-04). They show only while
 * the owner has the P&C board on (Settings > Other lines of business); the life view is Home's
 * new layout (src/app/(app)/page.tsx).
 */

/**
 * The line under a goal card: a view's production against its goal (life against the life goal,
 * P&C against its own, the agency total against both added up; owner, 2026-11-04).
 */
function paceLine(clock: MonthClock, pace: Pace, productionCents: number, goalCents: number): { text: string; tone: "green" | "amber" | "red" | "gray" | "blue" } {
  if (clock.position === "past") {
    if (goalCents <= 0) return { text: `Finished at ${formatDollars(productionCents)}.`, tone: "gray" };
    return productionCents >= goalCents
      ? { text: `Goal hit: ${formatDollars(productionCents)} of ${formatDollars(goalCents)}.`, tone: "green" }
      : { text: `Finished ${formatDollars(goalCents - productionCents)} short of the goal.`, tone: "red" };
  }
  if (pace.status === "done") return { text: `Goal hit, ${formatDollars(productionCents - goalCents)} over. Keep going.`, tone: "green" };
  if (clock.elapsed === 0) return { text: clock.position === "future" ? "The month hasn't started." : "The month starts Monday.", tone: "gray" };
  if (pace.status === "none") return { text: `On pace for ${formatDollars(pace.projectedCents)} this month. Set a goal in Settings.`, tone: "gray" };
  if (clock.remaining === 0 && !clock.todayBusiness) return { text: `${formatDollars(goalCents - productionCents)} to go. No business days left this month.`, tone: "amber" };
  const per =
    clock.remaining === 0
      ? ` Last business day: ${formatDollars(goalCents - productionCents)} today gets there.`
      : ` ${formatDollars(pace.neededPerDayCents)} a day for ${clock.remaining} ${clock.remaining === 1 ? "day" : "days"} gets there.`;
  if (pace.status === "ahead") return { text: `Ahead by ${formatDollars(pace.aheadCents)}. On pace for ${formatDollars(pace.projectedCents)}.${per}`, tone: "green" };
  if (pace.status === "on") return { text: `Right on the goal line. On pace for ${formatDollars(pace.projectedCents)}.${per}`, tone: "blue" };
  return { text: `Behind by ${formatDollars(-pace.aheadCents)}. On pace for ${formatDollars(pace.projectedCents)}.${per}`, tone: "amber" };
}

const toneClass = (tone: ReturnType<typeof paceLine>["tone"]) =>
  tone === "green" ? "text-green-700" : tone === "amber" ? "text-amber-800" : tone === "red" ? "text-red-700" : tone === "blue" ? "text-accent-text" : "text-gray-600";

/** The P&C view, laid out like Life: its goal card and chart, the P&C team's board, then its lines and carriers. */
export function PcView({ s, role, goalLine, today }: { s: MonthSnapshot; role: string; goalLine: number | null; today: string }) {
  const people = s.agents.filter((a) => a.pcRank !== null).sort((x, y) => (x.pcRank ?? 0) - (y.pcRank ?? 0));
  const lead = Math.max(1, ...people.map((a) => a.pcCents));
  const maxCarrier = Math.max(1, ...s.team.pcByCarrier.map((c) => c.policies));
  const current = s.clock.position === "current";
  const line = paceLine(s.clock, s.team.pcPace, s.team.pcCents, s.team.pcGoalCents);
  const width = s.team.pcGoalCents > 0 ? Math.min(100, s.team.pcGoalPct) : 0;
  const pcLine = goalLine;
  return (
    <>
      <Card className="relative overflow-hidden p-5">
        <Eyebrow>{s.clock.position === "past" ? "How the month went · P&C" : "P&C production"}</Eyebrow>
        <div className="mt-2 flex flex-wrap items-end gap-x-3 gap-y-1">
          <span className="font-mono text-[40px] leading-none font-bold tracking-[-0.03em] text-gray-900">{formatDollars(s.team.pcCents)}</span>
          <span className="pb-1 text-[15px] font-semibold text-gray-500">
            {s.team.pcGoalCents > 0 ? (
              <>
                of {formatDollars(s.team.pcGoalCents)} · <span className="font-mono text-gray-900">{s.team.pcGoalPct}%</span>
              </>
            ) : (
              "no P&C goal yet"
            )}
          </span>
        </div>
        <div className="mt-4 flex" role="progressbar" aria-label="P&C against its goal" aria-valuenow={Math.min(100, s.team.pcGoalPct)} aria-valuemin={0} aria-valuemax={100}>
          <GoalBar width={width} lifeShare={0} goalLine={s.team.pcGoalCents > 0 ? goalLine : null} className="h-3" tickClassName="-top-1 h-5 w-0.5" />
        </div>
        <p className={cn("mt-3 text-[14px] leading-snug font-semibold", toneClass(line.tone))}>{s.team.pcGoalCents > 0 ? line.text : `On pace for ${formatDollars(s.team.pcPace.projectedCents)}. Set a P&C goal in Settings.`}</p>
        <div className="mt-4 grid grid-cols-3 gap-2 text-center">
          <Stat label="Policies" value={String(s.team.pcPolicies)} />
          <Stat label="Avg premium" value={s.team.pcAverageCents ? formatDollars(s.team.pcAverageCents) : "–"} />
          <Stat label={current ? "Today" : "Of agency"} value={current ? formatDollars(s.team.todayPcCents) : `${s.team.pcSharePct}%`} />
        </div>
        <div className="mt-4">
          <MonthChart daily={pcDaily(s.daily)} goalCents={s.team.pcGoalCents} today={today} height={150} tone="pc" className="h-[150px] w-full" />
        </div>
      </Card>

      <div className="mt-6" data-board="pc">
        <div className="flex items-end justify-between gap-3">
          <ListTitle count={people.length}>P&amp;C leaderboard</ListTitle>
          {pcLine !== null && (
            <p className="flex shrink-0 items-center gap-1.5 pr-1 pb-0.5 text-[11px] font-semibold text-gray-500">
              <span aria-hidden className="inline-block h-3 w-0.5 rounded-[1px] bg-gray-500" />
              goal line today
            </p>
          )}
        </div>
        <ListCard className="mt-2">
          {people.length === 0 && (
            <li className="px-4 py-5 text-[14px] text-gray-600">
              Nobody is P&amp;C licensed yet.{" "}
              {role === "owner" ? (
                <Link href="/team" className="font-semibold text-accent-text">
                  Turn it on in Team
                </Link>
              ) : (
                "Anersi turns it on in Team."
              )}
            </li>
          )}
          {people.map((a) => {
            const hasGoal = a.pcGoalCents > 0;
            const w = hasGoal ? Math.min(100, a.pcGoalPct) : Math.round((a.pcCents / lead) * 100);
            return (
              <Row
                key={a.id}
                a={a}
                rank={a.pcRank ?? 0}
                amount={a.pcCents}
                today={current ? a.todayPcCents : 0}
                bar={<GoalBar width={w} lifeShare={0} goalLine={hasGoal ? pcLine : null} />}
                pct={hasGoal ? a.pcGoalPct : null}
                small={`${a.pcPolicies} ${a.pcPolicies === 1 ? "policy" : "policies"}${a.pcLines.length ? ` · ${linesSummary(a.pcLines)}` : ""}${hasGoal ? "" : " · no goal"}`}
              />
            );
          })}
        </ListCard>
      </div>

      {s.team.pcByLine.length > 0 && (
        <div className="mt-6">
          <ListTitle count={s.team.pcByLine.length}>By line</ListTitle>
          <div className="mt-2 grid grid-cols-3 gap-2">
            {s.team.pcByLine.map((l) => (
              <div key={l.name} className="min-w-0 rounded-2xl bg-surface px-3 py-2.5 shadow-card">
                <p className="flex items-center gap-1.5 truncate text-[11px] font-bold tracking-[0.06em] text-gray-500 uppercase">
                  <KindDot kind="pc" />
                  {l.name}
                </p>
                <p className="mt-1 font-mono text-[20px] leading-none font-bold text-gray-900">{l.policies}</p>
                <p className="mt-1 truncate font-mono text-[11px] font-semibold text-gray-500">{formatDollars(l.cents)}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {s.team.pcByCarrier.length > 0 && (
        <div className="mt-6">
          <ListTitle count={s.team.pcByCarrier.length}>By carrier</ListTitle>
          <ListCard className="mt-2">
            {s.team.pcByCarrier.map((c) => (
              <li key={c.name} className={cn("px-4 py-3", ROW_INSET.plain)}>
                <div className="flex items-baseline justify-between gap-3">
                  <p className="truncate text-[15px] font-bold text-gray-900">{c.name}</p>
                  <p className="shrink-0 text-[12px] font-semibold text-gray-500">
                    {c.policies} {c.policies === 1 ? "policy" : "policies"} · <span className="font-mono text-[15px] font-bold text-gray-900">{formatDollars(c.cents)}</span>
                  </p>
                </div>
                <div className="mt-2 flex">
                  <GoalBar width={Math.round((c.policies / maxCarrier) * 100)} lifeShare={0} goalLine={null} />
                </div>
                <p className="mt-1.5 truncate text-[12px] font-semibold text-gray-500">{linesSummary(c.lines)}</p>
              </li>
            ))}
          </ListCard>
        </div>
      )}
    </>
  );
}

/** The agency total: life and P&C added up, measured against the same goal ("what the numbers would look like"). */
export function TotalView({ s, role, goalLine, today }: { s: MonthSnapshot; role: string; goalLine: number | null; today: string }) {
  const line = paceLine(s.clock, s.team.totalPace, s.team.productionCents, s.team.totalGoalCents);
  const width = s.team.totalGoalCents > 0 ? Math.min(100, s.team.totalGoalPct) : 0;
  const lifeShare = s.team.productionCents > 0 ? (width * s.team.lifeCents) / s.team.productionCents : 0;
  const people = [...s.agents].sort((x, y) => x.totalRank - y.totalRank);
  const lead = Math.max(1, ...people.map((a) => a.premiumCents));
  const split = s.team.pcCents > 0;
  const current = s.clock.position === "current";
  return (
    <>
      <Card className="relative overflow-hidden p-5">
        <Eyebrow>{s.clock.position === "past" ? "How the month went · all of it" : "Agency total · life + P&C"}</Eyebrow>
        <div className="mt-2 flex flex-wrap items-end gap-x-3 gap-y-1">
          <span className="font-mono text-[40px] leading-none font-bold tracking-[-0.03em] text-gray-900">{formatDollars(s.team.productionCents)}</span>
          {s.team.totalGoalCents > 0 && (
            <span className="pb-1 text-[15px] font-semibold text-gray-500">
              of {formatDollars(s.team.totalGoalCents)} · <span className="font-mono text-gray-900">{s.team.totalGoalPct}%</span>
              {s.team.pcGoalCents > 0 && " · both goals"}
            </span>
          )}
        </div>
        <div className="mt-4 flex" role="progressbar" aria-label="Life and P&C against the goal" aria-valuenow={Math.min(100, s.team.totalGoalPct)} aria-valuemin={0} aria-valuemax={100}>
          <GoalBar width={width} lifeShare={lifeShare} goalLine={s.team.totalGoalCents > 0 ? goalLine : null} className="h-3" tickClassName="-top-1 h-5 w-0.5" />
        </div>
        {split && (
          <p className="mt-2.5 text-[13px] font-semibold text-gray-600">
            <KindSplit dot="h-2 w-2" life={<span className="font-mono text-gray-900">{formatDollars(s.team.lifeCents)}</span>} pc={<span className="font-mono text-gray-900">{formatDollars(s.team.pcCents)}</span>} />
          </p>
        )}
        <p className={cn("mt-3 text-[14px] leading-snug font-semibold", toneClass(line.tone))}>{line.text}</p>
        <div className="mt-4 grid grid-cols-3 gap-2 text-center">
          <Stat label="Policies" value={String(s.team.policies)} sub={split ? `${s.team.lifePolicies} life · ${s.team.pcPolicies} P&C` : undefined} />
          <Stat label="Avg premium" value={s.team.averageCents ? formatDollars(s.team.averageCents) : "–"} sub={split ? "per policy" : undefined} />
          <Stat
            label={current ? "Today" : "Best day"}
            value={current ? formatDollars(s.team.todayCents) : s.team.bestDay ? formatDollars(s.team.bestDay.cents) : "–"}
            sub={!current ? (s.team.bestDay ? dayLabel(s.team.bestDay.date) : undefined) : split ? `${s.team.todayPolicies} ${s.team.todayPolicies === 1 ? "policy" : "policies"}${s.team.todayPcPolicies > 0 ? ` · ${s.team.todayPcPolicies} P&C` : ""}` : undefined}
          />
        </div>
        <div className="mt-4">
          <MonthChart daily={s.daily} goalCents={s.team.totalGoalCents} today={today} height={150} className="h-[150px] w-full" />
        </div>
      </Card>

      <div className="mt-6">
        <div className="flex items-end justify-between gap-3">
          <ListTitle count={people.length}>Agency leaderboard</ListTitle>
          {(goalLine !== null || split) && (
            <p className="flex shrink-0 items-center gap-3 pr-1 pb-0.5 text-[11px] font-semibold text-gray-500">
              {split && (
                <span className="flex items-center gap-1.5">
                  <KindDot kind="life" />
                  life
                  <KindDot kind="pc" className="ml-1 h-1.5 w-1.5" />
                  P&C
                </span>
              )}
              {goalLine !== null && (
                <span className="flex items-center gap-1.5">
                  <span aria-hidden className="inline-block h-3 w-0.5 rounded-[1px] bg-gray-500" />
                  goal line
                </span>
              )}
            </p>
          )}
        </div>
        <ListCard className="mt-2">
          <NobodyYet show={people.length === 0} role={role} />
          {people.map((a) => {
            const hasGoal = a.totalGoalCents > 0;
            const w = hasGoal ? Math.min(100, a.totalGoalPct) : Math.round((a.premiumCents / lead) * 100);
            const life = a.premiumCents > 0 ? (w * a.lifeCents) / a.premiumCents : 0;
            return (
              <Row
                key={a.id}
                a={a}
                rank={a.totalRank}
                amount={a.premiumCents}
                today={current ? a.todayCents : 0}
                bar={<GoalBar width={w} lifeShare={life} goalLine={hasGoal ? goalLine : null} />}
                pct={hasGoal ? a.totalGoalPct : null}
                small={
                  a.pcCents > 0 ? (
                    <>
                      <KindSplit life={<span className="font-mono">{formatDollars(a.lifeCents)} · {a.lifePolicies}</span>} pc={<span className="font-mono">{formatDollars(a.pcCents)} · {a.pcPolicies}</span>} />
                      {!hasGoal && " · no goal"}
                    </>
                  ) : (
                    `${a.policies} ${a.policies === 1 ? "policy" : "policies"}${hasGoal ? "" : " · no goal"}`
                  )
                }
              />
            );
          })}
        </ListCard>
      </div>
    </>
  );
}

function NobodyYet({ show, role }: { show: boolean; role: string }) {
  if (!show) return null;
  return (
    <li className="px-4 py-5 text-[14px] text-gray-600">
      Nobody is on the board yet.{" "}
      {role === "owner" ? (
        <Link href="/team" className="font-semibold text-accent-text">
          Add your team
        </Link>
      ) : (
        "Ask an admin to add people."
      )}
    </li>
  );
}

/** One leaderboard row, the same on all three views: rank, avatar, name, amount, today, bar, percent, a small line. */
function Row({ a, rank, amount, today, bar, pct, small }: { a: AgentLine; rank: number; amount: number; today: number; bar: React.ReactNode; pct: number | null; small: React.ReactNode }) {
  return (
    <li className={cn("flex items-center gap-3 px-4 py-3", ROW_INSET.avatar)}>
      <span className={cn("w-5 shrink-0 text-center font-mono text-[15px] font-bold", rank === 1 && amount > 0 ? "text-amber-800" : "text-gray-500")}>{rank}</span>
      <Avatar name={a.name} tone={a.tone} size={40} />
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-3">
          <p className="min-w-0 truncate pt-px text-[15px] leading-tight font-bold text-gray-900">
            {a.name}
            {!a.active && <span className="ml-1.5 text-[12px] font-medium text-gray-500">(off the board)</span>}
          </p>
          <div className="shrink-0 text-right">
            <p className="font-mono text-[16px] leading-none font-bold text-gray-900">{formatDollars(amount)}</p>
            {today > 0 && <p className="mt-1 text-[11px] leading-none font-bold text-green-700">+{formatDollars(today)} today</p>}
          </div>
        </div>
        <div className="mt-2 flex items-center gap-2.5">
          {bar}
          {pct !== null && <span className={cn("w-10 shrink-0 text-right font-mono text-[12px] font-bold", pct >= 100 ? "text-green-700" : "text-gray-700")}>{pct}%</span>}
        </div>
        <p className="mt-1.5 truncate text-[12px] font-semibold text-gray-500">{small}</p>
      </div>
    </li>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-2xl bg-surface-2 px-2 py-2.5">
      <p className="font-mono text-[18px] leading-none font-bold text-gray-900">{value}</p>
      <p className="mt-1 text-[11px] font-bold tracking-[0.06em] text-gray-500 uppercase">{label}</p>
      {sub && <p className="text-[11px] font-medium text-gray-500">{sub}</p>}
    </div>
  );
}

