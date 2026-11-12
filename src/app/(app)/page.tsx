import type { Metadata } from "next";
import Link from "next/link";
import { currentViewer, requirePage } from "@/lib/auth";
import { dbConfigured } from "@/lib/supabase";
import { loadMonthSnapshot, type AgentLine, type MonthSnapshot } from "@/lib/board";
import { getSettings, listAgents } from "@/lib/data";
import { addMonths, dayLabel, daysLeftLabel, isMonthKey, monthKeyOf, monthLabel, todayInDetroit, type MonthClock, type Pace } from "@/lib/month";
import { isView, lifeDaily, linesSummary, pcDaily, type View } from "@/lib/views";
import { formatDollars, formatMoney } from "@/lib/money";
import { buildOrg } from "@/lib/org";
import { Avatar } from "@/components/avatar";
import { GoalBar } from "@/components/goal-bar";
import { KindDot, KindSplit, PcTag } from "@/components/kind";
import { MonthChart } from "@/components/month-chart";
import { Eyebrow, ListCard, ListTitle, ROW_INSET } from "@/components/tide";
import { Badge, Card, Notice, cn, formatClock, formatDate } from "@/components/ui";
import { SaleRowMenu } from "./sale-row-menu";

export const metadata: Metadata = { title: "This month" };

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

/** How many sales Home lists before "Show all N sales" (a busy month has hundreds). */
const SALES_SHOWN = 30;

/** "/?view=pc&month=2026-10&team=mine": the switch, the month arrows and the My team filter keep each other. Life, this month and everyone are the defaults. */
function homeHref(view: View, month: string, current: string, mine = false): string {
  const q = new URLSearchParams();
  if (view !== "life") q.set("view", view);
  if (month !== current) q.set("month", month);
  if (mine) q.set("team", "mine");
  const qs = q.toString();
  return qs ? `/?${qs}` : "/";
}

export default async function HomePage({ searchParams }: PageProps<"/">) {
  const role = await requirePage();
  const params = await searchParams;
  const today = todayInDetroit();
  const current = monthKeyOf(today);
  const month = typeof params.month === "string" && isMonthKey(params.month) ? params.month : current;
  // Life first (owner, 2026-11-04: the goal is life). The other two views exist only while the owner
  // has the P&C board on (Settings > Other lines of business); off, Home is the life board alone.
  const asked: View = isView(params.view) ? params.view : "life";
  const askedMine = params.team === "mine";
  if (!dbConfigured()) return <PageHeader month={month} current={current} view="life" />;

  let s: MonthSnapshot;
  // "My team" (owner, 2026-11-12): the viewer's own people when they lead some, else the team they
  // are on. The shared team password names nobody, so it has no filter to offer.
  let myTeam: { leaderName: string; ids: Set<string> } | null = null;
  try {
    const [snapshot, everyone, viewer] = await Promise.all([loadMonthSnapshot(month, { today, scoreboard: false }), listAgents({ includeInactive: true }), currentViewer()]);
    s = snapshot;
    const me = viewer?.agentId && everyone.some((a) => a.id === viewer.agentId) ? viewer.agentId : null;
    if (me) {
      const org = buildOrg(everyone);
      const leader = org.isLeader(me) ? me : org.uplineOf(me);
      if (leader) myTeam = { leaderName: org.nameOf(leader) ?? "", ids: new Set(org.teamOf(leader)) };
    }
  } catch (err) {
    return (
      <>
        <PageHeader month={month} current={current} view="life" />
        <Notice tone="red">The database answered with an error: {err instanceof Error ? err.message : "unknown"}. Check that the setup SQL ran (SETUP.md, step 3).</Notice>
      </>
    );
  }
  const { carriers, pcCarriers } = await getSettings();
  const pcOn = s.pcEnabled === true;
  const view: View = pcOn ? asked : "life";
  // The goal line today: how far through its business days the month is (the same tick on every bar).
  // Each view draws it, and its legend, only once its own goals give a bar something to measure against.
  const tick = s.clock.position === "current" && s.clock.elapsed > 0 ? Math.round(s.clock.progress * 100) : null;
  // The sales list is where a sale is fixed or taken back: everything on Life and the total, P&C alone on P&C.
  const listed = view === "pc" ? s.sales.filter((r) => r.kind === "pc") : s.sales;
  const top = s.agents[0];
  const mine = askedMine && myTeam !== null && view === "life";
  // One list for every row's menu: the page sends it once however many sales there are (a list
  // built per row is sent again with each row, megabytes by mid-month at 70 people).
  const agentOptions = s.agents.map((a) => ({ id: a.id, name: a.name }));
  const toneOf = new Map(s.agents.map((a) => [a.id, a.tone]));
  const pcCarrierNames = pcOn ? pcCarriers.map((c) => c.name) : [];
  // The newest sales first; the rest of a busy month behind one link (?sales=all).
  const allSales = params.sales === "all";
  const listedShown = allSales ? listed : listed.slice(0, SALES_SHOWN);
  const moreSales = listed.length - listedShown.length;
  const homeNow = homeHref(view, month, current, mine);
  const allSalesHref = `${homeNow}${homeNow.includes("?") ? "&" : "?"}sales=all`;

  return (
    <>
      <PageHeader month={month} current={current} view={view} mine={mine} daysLeft={s.clock.position === "current" ? { text: daysLeftLabel(s.clock), amber: s.clock.remaining <= 2 } : null} />
      {pcOn && <ViewSwitch view={view} month={month} current={current} />}

      {view === "life" && (
        <LifeView
          s={s}
          role={role}
          goalLine={tick !== null && (s.team.goalCents > 0 || s.agents.some((a) => a.goalCents > 0)) ? tick : null}
          today={today}
          team={myTeam ? { ...myTeam, on: mine, allHref: homeHref("life", month, current), mineHref: homeHref("life", month, current, true) } : null}
        />
      )}
      {view === "pc" && <PcView s={s} role={role} goalLine={tick !== null && (s.team.pcGoalCents > 0 || s.agents.some((a) => a.pcGoalCents > 0)) ? tick : null} today={today} />}
      {view === "total" && <TotalView s={s} role={role} goalLine={tick !== null && (s.team.totalGoalCents > 0 || s.agents.some((a) => a.totalGoalCents > 0)) ? tick : null} today={today} />}

      {/* Sales */}
      <div className="mt-6">
        <ListTitle count={listed.length}>{view === "pc" ? "P&C sales" : s.clock.position === "current" ? "Latest sales" : "Sales"}</ListTitle>
        <ListCard className="mt-2">
          {listed.length === 0 && (
            <li className="px-4 py-5 text-[14px] text-gray-600">
              {view === "pc" ? (s.clock.position === "current" ? "No P&C sales yet this month." : "No P&C sales that month.") : s.clock.position === "current" ? "No sales logged yet this month. The first one lights up the board." : "No sales this month."}
            </li>
          )}
          {listedShown.map((r) => (
            <li key={r.id} className={cn("flex items-center gap-3 px-4 py-3", ROW_INSET.avatar)}>
              <Avatar name={r.agentName} tone={toneOf.get(r.agentId)} size={40} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[15px] font-bold text-gray-900">
                  {r.agentName}
                  {pcOn && r.kind === "pc" && <PcTag className="ml-1.5 align-middle" />}
                </p>
                <p className="truncate text-[13px] font-medium text-gray-500">
                  {[r.carrier, r.product, r.policies > 1 ? `${r.policies} policies` : null, r.soldOn === today ? `Today, ${formatClock(r.createdAt)}` : formatDate(r.soldOn, { year: false })]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              </div>
              <p className="shrink-0 font-mono text-[16px] font-bold text-gray-900">{formatMoney(r.premiumCents)}</p>
              <SaleRowMenu sale={r} role={role} agents={agentOptions} carriers={carriers} pcCarriers={pcCarrierNames} pcEnabled={pcOn} />
            </li>
          ))}
          {moreSales > 0 && (
            <li>
              <Link href={allSalesHref} scroll={false} data-sales="all" className="flex min-h-12 items-center justify-center gap-1.5 px-4 text-[14px] font-bold text-accent-text hover:bg-gray-50">
                Show all {listed.length} sales
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M6 9l6 6 6-6" />
                </svg>
              </Link>
            </li>
          )}
        </ListCard>
      </div>

      {/* The recap at the bottom for a finished month: life, the goal's measure */}
      {view === "life" && s.clock.position === "past" && top && top.lifeCents > 0 && (
        <Card className="mt-6">
          <Eyebrow>{monthLabel(month)} recap</Eyebrow>
          <ul className="mt-2 space-y-1.5 text-[14px] text-gray-700">
            <li>
              <span className="font-semibold text-gray-900">{top.name}</span> led {pcOn ? "life " : ""}with {formatDollars(top.lifeCents)} and {top.lifePolicies} {top.lifePolicies === 1 ? "policy" : "policies"}.
            </li>
            {s.team.bestLifeDay && (
              <li>
                Best day: <span className="font-semibold text-gray-900">{dayLabel(s.team.bestLifeDay.date)}</span> with {formatDollars(s.team.bestLifeDay.cents)}.
              </li>
            )}
            <li>
              {s.team.lifePolicies} {pcOn ? "life policies" : s.team.lifePolicies === 1 ? "policy" : "policies"}, {formatDollars(s.team.lifeAverageCents)} average premium, {s.clock.businessDays} business days.
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
          className={cn("flex h-11 items-center justify-center gap-2 rounded-xl text-[14px] font-bold transition", it.key === view ? "bg-segment text-gray-900 shadow-card" : "text-gray-600 hover:text-gray-900")}
        >
          {it.dot}
          {it.label}
        </Link>
      ))}
    </nav>
  );
}

/** The life view: the goal card and the leaderboard measure life alone (owner, 2026-11-04). */
function LifeView({
  s,
  role,
  goalLine,
  today,
  team,
}: {
  s: MonthSnapshot;
  role: string;
  goalLine: number | null;
  today: string;
  /** The viewer's team, when they have one: the filter chips over the leaderboard. */
  team: { leaderName: string; ids: Set<string>; on: boolean; allHref: string; mineHref: string } | null;
}) {
  const line = paceLine(s.clock, s.team.pace, s.team.lifeCents, s.team.goalCents);
  const width = s.team.goalCents > 0 ? Math.min(100, s.team.goalPct) : 0;
  // The people on the board and anyone with life this month (someone off it with only P&C is on the P&C view)
  const people = s.agents.filter((a) => a.active || a.lifeCents > 0);
  const maxLife = Math.max(1, ...people.map((a) => a.lifeCents));
  const current = s.clock.position === "current";
  // In the office first (owner, 2026-11-12: "their numbers should be showing at the top"): each
  // group ranked among itself (groupRank). One list while nobody is marked in the office.
  const shown = [...(team?.on ? people.filter((a) => team.ids.has(a.id)) : people)].sort((x, y) => x.groupRank - y.groupRank);
  const split = people.some((a) => a.inOffice);
  const groups: Array<{ title: string | null; people: AgentLine[] }> = split
    ? [
        { title: "In the office", people: shown.filter((a) => a.inOffice) },
        { title: "Everyone else", people: shown.filter((a) => !a.inOffice) },
      ].filter((g) => g.people.length > 0)
    : [{ title: null, people: shown }];
  return (
    <>
      <Card className="relative overflow-hidden p-5">
        <Eyebrow>{s.pcEnabled ? (s.clock.position === "past" ? "How the month went · life" : "Life production") : s.clock.position === "past" ? "How the month went" : "Production"}</Eyebrow>
        <div className="mt-2 flex flex-wrap items-end gap-x-3 gap-y-1">
          <span className="font-mono text-[40px] leading-none font-bold tracking-[-0.03em] text-gray-900">{formatDollars(s.team.lifeCents)}</span>
          {s.team.goalCents > 0 && (
            <span className="pb-1 text-[15px] font-semibold text-gray-500">
              of {formatDollars(s.team.goalCents)} · <span className="font-mono text-gray-900">{s.team.goalPct}%</span>
            </span>
          )}
        </div>
        <div className="mt-4 flex" role="progressbar" aria-label={s.pcEnabled ? "Life against the goal" : "Production against the goal"} aria-valuenow={Math.min(100, s.team.goalPct)} aria-valuemin={0} aria-valuemax={100}>
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
          <ListTitle count={shown.length}>{s.pcEnabled ? "Life leaderboard" : "Leaderboard"}</ListTitle>
          {goalLine !== null && (
            <p className="flex shrink-0 items-center gap-1.5 pr-1 pb-0.5 text-[11px] font-semibold text-gray-500">
              <span aria-hidden className="inline-block h-3 w-0.5 rounded-[1px] bg-gray-500" />
              goal line today
            </p>
          )}
        </div>
        {team && (
          <nav aria-label="Whose leaderboard" className="mt-2 flex flex-wrap gap-2" data-filter="team">
            {[
              { label: "Everyone", href: team.allHref, on: !team.on },
              { label: "My team", href: team.mineHref, on: team.on },
            ].map((chip) => (
              <Link
                key={chip.label}
                href={chip.href}
                scroll={false}
                aria-current={chip.on ? "true" : undefined}
                className={cn("flex h-11 items-center rounded-full px-4 text-[13px] font-bold transition", chip.on ? "bg-chip text-chip-text" : "bg-surface text-gray-600 shadow-card hover:text-gray-900")}
              >
                {chip.label}
              </Link>
            ))}
            {team.on && team.leaderName && <p className="flex items-center px-1 text-[13px] font-medium text-gray-500">{team.leaderName}&rsquo;s team</p>}
          </nav>
        )}
        {shown.length === 0 && (
          <ListCard className="mt-2">
            <NobodyYet show role={role} />
          </ListCard>
        )}
        {groups.map((g) => (
          <BoardGroup
            key={g.title ?? "all"}
            title={g.title}
            people={g.people}
            noSaleWord={current ? "with no sale yet" : "with no sale"}
            render={(a) => {
              const hasGoal = a.goalCents > 0;
              const width = hasGoal ? Math.min(100, a.goalPct) : Math.round((a.lifeCents / maxLife) * 100);
              return (
                <Row
                  key={a.id}
                  a={a}
                  rank={a.groupRank}
                  amount={a.lifeCents}
                  today={current ? a.todayLifeCents : 0}
                  bar={<GoalBar width={width} lifeShare={width} goalLine={hasGoal ? goalLine : null} />}
                  pct={hasGoal ? a.goalPct : null}
                  small={`${a.lifePolicies} ${a.lifePolicies === 1 ? "policy" : "policies"}${hasGoal ? "" : " · no goal"}`}
                />
              );
            }}
          />
        ))}
      </div>
    </>
  );
}

/** The P&C view, laid out like Life: its goal card and chart, the P&C team's board, then its lines and carriers. */
function PcView({ s, role, goalLine, today }: { s: MonthSnapshot; role: string; goalLine: number | null; today: string }) {
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
function TotalView({ s, role, goalLine, today }: { s: MonthSnapshot; role: string; goalLine: number | null; today: string }) {
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

/** A long group folds its people without a sale behind "Show everyone" once there are more than a handful. */
const FOLD_AFTER = 10;
const FOLD_AT_LEAST = 4;

/**
 * One group of the leaderboard ("In the office", "Everyone else", or the only list): the people
 * who sold, then the long tail without a sale folded behind "Show everyone", so 70 people stay a
 * short page. A small team is listed whole, as before.
 */
function BoardGroup({ title, people, noSaleWord, render }: { title: string | null; people: AgentLine[]; noSaleWord: string; render: (a: AgentLine) => React.ReactNode }) {
  const quiet = people.filter((a) => a.lifeCents <= 0);
  const fold = people.length > FOLD_AFTER && quiet.length >= FOLD_AT_LEAST;
  const head = fold ? people.filter((a) => a.lifeCents > 0) : people;
  return (
    <section className="mt-3" data-group={title ?? "all"}>
      {title && (
        <h3 className="flex items-baseline gap-2 px-1 pb-1.5 text-[12px] font-bold tracking-[0.07em] text-gray-500 uppercase">
          {title}
          <span className="font-mono tracking-normal">{people.length}</span>
        </h3>
      )}
      <div className="rounded-[22px] bg-surface shadow-card">
        {head.length > 0 && <ul>{head.map(render)}</ul>}
        {fold && (
          <details className={cn("group", head.length > 0 && "border-t border-line")}>
            <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-4 py-2.5 text-[14px] font-bold text-accent-text [&::-webkit-details-marker]:hidden">
              <span className="group-open:hidden">Show everyone</span>
              <span className="hidden group-open:inline">Show less</span>
              <span className="text-[12px] font-semibold text-gray-500">
                {quiet.length} {noSaleWord}
              </span>
            </summary>
            <ul className="border-t border-line">{quiet.map(render)}</ul>
          </details>
        )}
      </div>
    </section>
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

function PageHeader({ month, current, view, mine = false, daysLeft }: { month: string; current: string; view: View; mine?: boolean; daysLeft?: { text: string; amber: boolean } | null }) {
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
        <Link href={homeHref(view, prev, current, mine)} aria-label={`${monthLabel(prev)}`} className="flex h-11 w-11 items-center justify-center rounded-full bg-surface text-gray-700 shadow-card hover:bg-gray-50">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M15 6l-6 6 6 6" />
          </svg>
        </Link>
        {!isCurrent && (
          <Link href={homeHref(view, current, current, mine)} className="flex h-11 items-center rounded-full bg-surface px-3.5 text-[13px] font-bold text-accent-text shadow-card hover:bg-gray-50">
            Now
          </Link>
        )}
        <Link
          href={homeHref(view, next, current, mine)}
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
