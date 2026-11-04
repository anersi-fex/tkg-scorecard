import type { Metadata } from "next";
import Link from "next/link";
import { requirePage } from "@/lib/auth";
import { dbConfigured } from "@/lib/supabase";
import { loadMonthSnapshot, type AgentLine, type MonthSnapshot } from "@/lib/board";
import { getSettings } from "@/lib/data";
import { addMonths, dayLabel, daysLeftLabel, isMonthKey, monthKeyOf, monthLabel, todayInDetroit, type MonthClock, type Pace } from "@/lib/month";
import { isView, lifeDaily, linesSummary, type View } from "@/lib/views";
import { formatDollars, formatMoney } from "@/lib/money";
import { Avatar } from "@/components/avatar";
import { GoalBar } from "@/components/goal-bar";
import { KindDot, KindSplit, PcTag } from "@/components/kind";
import { MonthChart } from "@/components/month-chart";
import { Eyebrow, ListCard, ListTitle, ROW_INSET } from "@/components/tide";
import { Badge, Card, Notice, cn, formatClock, formatDate } from "@/components/ui";
import { SaleRowMenu } from "./sale-row-menu";

export const metadata: Metadata = { title: "This month" };

/**
 * The line under the goal card. Life is measured against the goal (owner, 2026-11-04); the agency
 * total says what the month looks like with P&C added, with the same words after "With P&C:".
 */
function paceLine(clock: MonthClock, pace: Pace, productionCents: number, goalCents: number, withPc = false): { text: string; tone: "green" | "amber" | "red" | "gray" | "blue" } {
  const lead = withPc ? "With P&C: " : "";
  if (clock.position === "past") {
    if (goalCents <= 0) return { text: `Finished at ${formatDollars(productionCents)}.`, tone: "gray" };
    return productionCents >= goalCents
      ? { text: `${lead}Goal hit: ${formatDollars(productionCents)} of ${formatDollars(goalCents)}.`, tone: "green" }
      : { text: `${lead}Finished ${formatDollars(goalCents - productionCents)} short of the goal.`, tone: "red" };
  }
  if (pace.status === "done") return { text: `${lead}Goal hit, ${formatDollars(productionCents - goalCents)} over. Keep going.`, tone: "green" };
  if (clock.elapsed === 0) return { text: clock.position === "future" ? "The month hasn't started." : "The month starts Monday.", tone: "gray" };
  if (pace.status === "none") return { text: `On pace for ${formatDollars(pace.projectedCents)} this month. Set a goal in Settings.`, tone: "gray" };
  if (clock.remaining === 0 && !clock.todayBusiness) return { text: `${lead}${formatDollars(goalCents - productionCents)} to go. No business days left this month.`, tone: "amber" };
  const per = withPc
    ? ""
    : clock.remaining === 0
      ? ` Last business day: ${formatDollars(goalCents - productionCents)} today gets there.`
      : ` ${formatDollars(pace.neededPerDayCents)} a day for ${clock.remaining} ${clock.remaining === 1 ? "day" : "days"} gets there.`;
  if (pace.status === "ahead") return { text: `${lead}Ahead by ${formatDollars(pace.aheadCents)}. On pace for ${formatDollars(pace.projectedCents)}.${per}`, tone: "green" };
  if (pace.status === "on") return { text: `${lead}Right on the goal line. On pace for ${formatDollars(pace.projectedCents)}.${per}`, tone: "blue" };
  return { text: `${lead}Behind by ${formatDollars(-pace.aheadCents)}. On pace for ${formatDollars(pace.projectedCents)}.${per}`, tone: "amber" };
}

const toneClass = (tone: ReturnType<typeof paceLine>["tone"]) =>
  tone === "green" ? "text-green-700" : tone === "amber" ? "text-amber-800" : tone === "red" ? "text-red-700" : tone === "blue" ? "text-accent-text" : "text-gray-600";

/** "/?view=pc&month=2026-10": the switch and the month arrows keep each other. Life and this month are the defaults. */
function homeHref(view: View, month: string, current: string): string {
  const q = new URLSearchParams();
  if (view !== "life") q.set("view", view);
  if (month !== current) q.set("month", month);
  const qs = q.toString();
  return qs ? `/?${qs}` : "/";
}

export default async function HomePage({ searchParams }: PageProps<"/">) {
  const role = await requirePage();
  const params = await searchParams;
  const today = todayInDetroit();
  const current = monthKeyOf(today);
  const month = typeof params.month === "string" && isMonthKey(params.month) ? params.month : current;
  // Life first (owner, 2026-11-04: the goal is life); P&C and the agency total one tap away.
  const view: View = isView(params.view) ? params.view : "life";
  if (!dbConfigured()) return <PageHeader month={month} current={current} view={view} />;

  let s: MonthSnapshot;
  try {
    s = await loadMonthSnapshot(month, { today });
  } catch (err) {
    return (
      <>
        <PageHeader month={month} current={current} view={view} />
        <Notice tone="red">The database answered with an error: {err instanceof Error ? err.message : "unknown"}. Check that the setup SQL ran (SETUP.md, step 3).</Notice>
      </>
    );
  }
  const { carriers, pcCarriers } = await getSettings();
  // The goal line today: how far through its business days the month is (the same tick on every bar);
  // nothing, and no legend, until a goal gives a bar something to measure against.
  const goalLine = s.clock.position === "current" && s.clock.elapsed > 0 && (s.team.goalCents > 0 || s.agents.some((a) => a.goalCents > 0)) ? Math.round(s.clock.progress * 100) : null;
  // The sales list is where a sale is fixed or taken back: everything on Life and the total, P&C alone on P&C.
  const listed = view === "pc" ? s.sales.filter((r) => r.kind === "pc") : s.sales;
  const top = s.agents[0];

  return (
    <>
      <PageHeader month={month} current={current} view={view} daysLeft={s.clock.position === "current" ? { text: daysLeftLabel(s.clock), amber: s.clock.remaining <= 2 } : null} />
      <ViewSwitch view={view} month={month} current={current} />

      {view === "life" && <LifeView s={s} role={role} goalLine={goalLine} today={today} />}
      {view === "pc" && <PcView s={s} role={role} />}
      {view === "total" && <TotalView s={s} role={role} goalLine={goalLine} today={today} />}

      {/* Sales */}
      <div className="mt-6">
        <ListTitle count={listed.length}>{view === "pc" ? "P&C sales" : s.clock.position === "current" ? "Latest sales" : "Sales"}</ListTitle>
        <ListCard className="mt-2">
          {listed.length === 0 && (
            <li className="px-4 py-5 text-[14px] text-gray-600">
              {view === "pc" ? `No P&C sales ${s.clock.position === "current" ? "yet this month" : "this month"}.` : s.clock.position === "current" ? "No sales logged yet this month. The first one lights up the board." : "No sales this month."}
            </li>
          )}
          {listed.map((r) => (
            <li key={r.id} className={cn("flex items-center gap-3 px-4 py-3", ROW_INSET.avatar)}>
              <Avatar name={r.agentName} tone={s.agents.find((a) => a.id === r.agentId)?.tone} size={40} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[15px] font-bold text-gray-900">
                  {r.agentName}
                  {r.kind === "pc" && <PcTag className="ml-1.5 align-middle" />}
                </p>
                <p className="truncate text-[13px] font-medium text-gray-500">
                  {[r.carrier, r.product, r.policies > 1 ? `${r.policies} policies` : null, r.soldOn === today ? `Today, ${formatClock(r.createdAt)}` : formatDate(r.soldOn, { year: false })]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              </div>
              <p className="shrink-0 font-mono text-[16px] font-bold text-gray-900">{formatMoney(r.premiumCents)}</p>
              <SaleRowMenu sale={r} role={role} agents={s.agents.map((a) => ({ id: a.id, name: a.name }))} carriers={carriers} pcCarriers={pcCarriers.map((c) => c.name)} />
            </li>
          ))}
        </ListCard>
      </div>

      {/* The recap at the bottom for a finished month: life, the goal's measure */}
      {view === "life" && s.clock.position === "past" && top && top.lifeCents > 0 && (
        <Card className="mt-6">
          <Eyebrow>{monthLabel(month)} recap</Eyebrow>
          <ul className="mt-2 space-y-1.5 text-[14px] text-gray-700">
            <li>
              <span className="font-semibold text-gray-900">{top.name}</span> led life with {formatDollars(top.lifeCents)} and {top.lifePolicies} {top.lifePolicies === 1 ? "policy" : "policies"}.
            </li>
            {s.team.bestLifeDay && (
              <li>
                Best day: <span className="font-semibold text-gray-900">{dayLabel(s.team.bestLifeDay.date)}</span> with {formatDollars(s.team.bestLifeDay.cents)}.
              </li>
            )}
            <li>
              {s.team.lifePolicies} life policies, {formatDollars(s.team.lifeAverageCents)} average premium, {s.clock.businessDays} business days.
            </li>
          </ul>
        </Card>
      )}
    </>
  );
}

/** Life, P&C, Total as a switch of links (like the Wrap's Day / Week / Month); the month stays. */
function ViewSwitch({ view, month, current }: { view: View; month: string; current: string }) {
  const items: Array<{ key: View; label: string; dot: React.ReactNode }> = [
    { key: "life", label: "Life", dot: <KindDot kind="life" className="h-2 w-2" /> },
    { key: "pc", label: "P&C", dot: <KindDot kind="pc" className="h-2 w-2" /> },
    {
      key: "total",
      label: "Total",
      dot: (
        <span aria-hidden className="flex h-2 w-2 overflow-hidden rounded-full">
          <span className="h-full w-1/2 bg-accent" />
          <span className="h-full w-1/2 bg-pc" />
        </span>
      ),
    },
  ];
  return (
    <nav aria-label="View" className="mb-4 grid grid-cols-3 gap-1 rounded-2xl bg-track p-1">
      {items.map((it) => (
        <Link
          key={it.key}
          href={homeHref(it.key, month, current)}
          aria-current={it.key === view ? "true" : undefined}
          className={cn("flex h-10 items-center justify-center gap-2 rounded-xl text-[14px] font-bold transition", it.key === view ? "bg-segment text-gray-900 shadow-card" : "text-gray-600 hover:text-gray-900")}
        >
          {it.dot}
          {it.label}
        </Link>
      ))}
    </nav>
  );
}

/** The life view: the goal card and the leaderboard measure life alone (owner, 2026-11-04). */
function LifeView({ s, role, goalLine, today }: { s: MonthSnapshot; role: string; goalLine: number | null; today: string }) {
  const line = paceLine(s.clock, s.team.pace, s.team.lifeCents, s.team.goalCents);
  const width = s.team.goalCents > 0 ? Math.min(100, s.team.goalPct) : 0;
  const maxLife = Math.max(1, ...s.agents.map((a) => a.lifeCents));
  const current = s.clock.position === "current";
  return (
    <>
      <Card className="relative overflow-hidden p-5">
        <Eyebrow>{s.clock.position === "past" ? "How the month went · life" : "Life production"}</Eyebrow>
        <div className="mt-2 flex flex-wrap items-end gap-x-3 gap-y-1">
          <span className="font-mono text-[40px] leading-none font-bold tracking-[-0.03em] text-gray-900">{formatDollars(s.team.lifeCents)}</span>
          {s.team.goalCents > 0 && (
            <span className="pb-1 text-[15px] font-semibold text-gray-500">
              of {formatDollars(s.team.goalCents)} · <span className="font-mono text-gray-900">{s.team.goalPct}%</span>
            </span>
          )}
        </div>
        <div className="mt-4 flex" role="progressbar" aria-label="Life against the goal" aria-valuenow={Math.min(100, s.team.goalPct)} aria-valuemin={0} aria-valuemax={100}>
          <GoalBar width={width} lifeShare={width} goalLine={s.team.goalCents > 0 ? goalLine : null} className="h-3" tickClassName="-top-1 h-5 w-0.5" />
        </div>
        <p className={cn("mt-3 text-[14px] leading-snug font-semibold", toneClass(line.tone))}>{line.text}</p>
        <div className="mt-4 grid grid-cols-3 gap-2 text-center">
          <Stat label="Policies" value={String(s.team.lifePolicies)} />
          <Stat label="Avg premium" value={s.team.lifeAverageCents ? formatDollars(s.team.lifeAverageCents) : "–"} />
          <Stat
            label={current ? "Today" : "Best day"}
            value={current ? formatDollars(s.team.todayLifeCents) : s.team.bestLifeDay ? formatDollars(s.team.bestLifeDay.cents) : "–"}
            sub={current ? undefined : s.team.bestLifeDay ? dayLabel(s.team.bestLifeDay.date) : undefined}
          />
        </div>
        <div className="mt-4">
          <MonthChart daily={lifeDaily(s.daily)} goalCents={s.team.goalCents} today={today} height={150} className="h-[150px] w-full" />
        </div>
      </Card>

      {/* One track per person: the share of their own goal in life (of the leader's life without one), a gray tick at the goal line today. */}
      <div className="mt-6">
        <div className="flex items-end justify-between gap-3">
          <ListTitle count={s.agents.length}>Life leaderboard</ListTitle>
          {goalLine !== null && (
            <p className="flex shrink-0 items-center gap-1.5 pr-1 pb-0.5 text-[11px] font-semibold text-gray-500">
              <span aria-hidden className="inline-block h-3 w-0.5 rounded-[1px] bg-gray-500" />
              goal line today
            </p>
          )}
        </div>
        <ListCard className="mt-2">
          <NobodyYet show={s.agents.length === 0} role={role} />
          {s.agents.map((a) => {
            const hasGoal = a.goalCents > 0;
            const width = hasGoal ? Math.min(100, a.goalPct) : Math.round((a.lifeCents / maxLife) * 100);
            return (
              <Row
                key={a.id}
                a={a}
                rank={a.rank}
                amount={a.lifeCents}
                today={current ? a.todayLifeCents : 0}
                bar={<GoalBar width={width} lifeShare={width} goalLine={hasGoal ? goalLine : null} />}
                pct={hasGoal ? a.goalPct : null}
                small={`${a.lifePolicies} ${a.lifePolicies === 1 ? "policy" : "policies"}${hasGoal ? "" : " · no goal"}`}
              />
            );
          })}
        </ListCard>
      </div>
    </>
  );
}

/** The P&C view: the people who write it, its lines and its carriers; no goal on it. */
function PcView({ s, role }: { s: MonthSnapshot; role: string }) {
  const people = s.agents.filter((a) => a.pcRank !== null).sort((x, y) => (x.pcRank ?? 0) - (y.pcRank ?? 0));
  const lead = Math.max(1, ...people.map((a) => a.pcCents));
  const maxCarrier = Math.max(1, ...s.team.pcByCarrier.map((c) => c.policies));
  const current = s.clock.position === "current";
  return (
    <>
      <Card className="relative overflow-hidden p-5">
        <Eyebrow>{s.clock.position === "past" ? "How the month went · P&C" : "P&C production"}</Eyebrow>
        <div className="mt-2 flex flex-wrap items-end gap-x-3 gap-y-1">
          <span className="font-mono text-[40px] leading-none font-bold tracking-[-0.03em] text-gray-900">{formatDollars(s.team.pcCents)}</span>
          <span className="pb-1 text-[15px] font-semibold text-gray-500">
            {s.team.pcPolicies} {s.team.pcPolicies === 1 ? "policy" : "policies"}
            {s.team.pcAverageCents > 0 && (
              <>
                {" "}
                · <span className="font-mono text-gray-900">{formatDollars(s.team.pcAverageCents)}</span> avg
              </>
            )}
          </span>
        </div>
        {s.team.pcByLine.length > 0 ? (
          <div className="mt-4 grid grid-cols-3 gap-2">
            {s.team.pcByLine.slice(0, 6).map((l) => (
              <div key={l.name} className="min-w-0 rounded-2xl bg-surface-2 px-3 py-2">
                <p className="flex items-center gap-1.5 truncate text-[11px] font-bold tracking-[0.06em] text-gray-500 uppercase">
                  <KindDot kind="pc" />
                  {l.name}
                </p>
                <p className="mt-0.5 font-mono text-[18px] leading-none font-bold text-gray-900">{l.policies}</p>
                <p className="mt-0.5 truncate font-mono text-[11px] font-semibold text-gray-500">{formatDollars(l.cents)}</p>
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-3 text-[14px] font-semibold text-gray-600">{current ? "No P&C yet this month. Log one with the P&C switch on Log a sale." : "No P&C that month."}</p>
        )}
        <div className="mt-4 grid grid-cols-3 gap-2 text-center">
          <Stat label={current ? "Today" : "Policies"} value={current ? formatDollars(s.team.todayPcCents) : String(s.team.pcPolicies)} />
          <Stat label="Carriers" value={String(s.team.pcByCarrier.length)} />
          <Stat label="Of agency" value={`${s.team.pcSharePct}%`} sub="of all premium" />
        </div>
      </Card>

      <div className="mt-6" data-board="pc">
        <ListTitle count={people.length}>P&amp;C leaderboard</ListTitle>
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
            const width = Math.round((a.pcCents / lead) * 100);
            return (
              <Row
                key={a.id}
                a={a}
                rank={a.pcRank ?? 0}
                amount={a.pcCents}
                today={current ? a.todayPcCents : 0}
                bar={<GoalBar width={width} lifeShare={0} goalLine={null} />}
                pct={null}
                small={`${a.pcPolicies} ${a.pcPolicies === 1 ? "policy" : "policies"}${a.pcLines.length ? ` · ${linesSummary(a.pcLines)}` : ""}`}
              />
            );
          })}
        </ListCard>
      </div>

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
function TotalView({ s, role, goalLine, today }: { s: MonthSnapshot; role: string; goalLine: number | null; today: string }) {
  const line = paceLine(s.clock, s.team.totalPace, s.team.productionCents, s.team.goalCents, true);
  const width = s.team.goalCents > 0 ? Math.min(100, s.team.totalGoalPct) : 0;
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
          {s.team.goalCents > 0 && (
            <span className="pb-1 text-[15px] font-semibold text-gray-500">
              of {formatDollars(s.team.goalCents)} · <span className="font-mono text-gray-900">{s.team.totalGoalPct}%</span> with P&amp;C
            </span>
          )}
        </div>
        <div className="mt-4 flex" role="progressbar" aria-label="Life and P&C against the goal" aria-valuenow={Math.min(100, s.team.totalGoalPct)} aria-valuemin={0} aria-valuemax={100}>
          <GoalBar width={width} lifeShare={lifeShare} goalLine={s.team.goalCents > 0 ? goalLine : null} className="h-3" tickClassName="-top-1 h-5 w-0.5" />
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
          <MonthChart daily={s.daily} goalCents={s.team.goalCents} today={today} height={150} className="h-[150px] w-full" />
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
            const hasGoal = a.goalCents > 0;
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
        "Ask Anersi to add the team."
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

function PageHeader({ month, current, view, daysLeft }: { month: string; current: string; view: View; daysLeft?: { text: string; amber: boolean } | null }) {
  const prev = addMonths(month, -1);
  const next = addMonths(month, 1);
  const isCurrent = month === current;
  return (
    <div className="mb-4 flex items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-[28px] leading-tight font-extrabold tracking-[-0.035em] text-gray-900">{isCurrent ? "This month" : monthLabel(month)}</h1>
        <p className="mt-0.5 flex items-center gap-2 text-[14px] font-medium text-gray-500">
          {isCurrent ? monthLabel(month) : month < current ? "Finished" : "Coming up"}
          {daysLeft != null && <Badge tone={daysLeft.amber ? "amber" : "blue"}>{daysLeft.text}</Badge>}
        </p>
      </div>
      <nav aria-label="Month" className="flex shrink-0 items-center gap-1">
        <Link href={homeHref(view, prev, current)} aria-label={`${monthLabel(prev)}`} className="flex h-11 w-11 items-center justify-center rounded-full bg-surface text-gray-700 shadow-card hover:bg-gray-50">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M15 6l-6 6 6 6" />
          </svg>
        </Link>
        {!isCurrent && (
          <Link href={homeHref(view, current, current)} className="flex h-11 items-center rounded-full bg-surface px-3.5 text-[13px] font-bold text-accent-text shadow-card hover:bg-gray-50">
            Now
          </Link>
        )}
        <Link
          href={homeHref(view, next, current)}
          aria-label={`${monthLabel(next)}`}
          aria-disabled={month >= current}
          className={cn("flex h-11 w-11 items-center justify-center rounded-full bg-surface text-gray-700 shadow-card hover:bg-gray-50", month >= current && "pointer-events-none opacity-40")}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M9 6l6 6-6 6" />
          </svg>
        </Link>
      </nav>
    </div>
  );
}
