import type { Metadata } from "next";
import Link from "next/link";
import { pageViewer } from "@/lib/auth";
import { dbConfigured } from "@/lib/supabase";
import { loadMonthSnapshot, type MonthSnapshot } from "@/lib/board";
import { getSettings, listAgents } from "@/lib/data";
import { addMonths, dayLabelLong, daysLeftLabel, isMonthKey, monthKeyOf, monthLabel, todayInDetroit, datesOfMonth } from "@/lib/month";
import { isView, type View } from "@/lib/views";
import { formatDollars } from "@/lib/money";
import { canSeeClient, canUsePolicies, homeScopes, myTeamLeaderId, ruleContext, teamName, type RuleContext } from "@/lib/rules";
import { listPoliciesFor } from "@/lib/policies";
import { queryToParams } from "@/lib/policy-filter";
import { clientNameOf, type PolicyListRow, type PolicyScope } from "@/lib/policy-types";
import { isAdmin, type Viewer } from "@/lib/viewer";
import {
  aroundYou,
  bestDayOf,
  comingUp,
  homeBoard,
  homeTeams,
  officeGroups,
  pickHomeScope,
  pipelineOf,
  rangeLabel,
  scopeDaily,
  scopeSummary,
  teamGoalOf,
  type HomePerson,
  type HomeSale,
  type HomeScopeId,
  type PipelineStatus,
} from "@/lib/home-scope";
import { MonthChart } from "@/components/month-chart";
import { Notice, cn, formatClock, formatDate } from "@/components/ui";
import { Icon } from "@/components/ui/icon";
import { EmptyState, ListRow, PageHead, Panel, SegmentedLinks } from "@/components/ui/kit";
import { AroundCard, BoardCard, ChartCard, ComingCard, EmptyMe, MiniCards, PipelineCard, ProductionCard, TeamsCard, homeStyles as s } from "@/components/home/cards";
import { TeamPicker } from "@/components/home/team-picker";
import { PcView, TotalView } from "@/components/home/pc-views";
import { SaleRowMenu, type UndoRight } from "./sale-row-menu";

export const metadata: Metadata = { title: "Home" };

type Params = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** The address for Home: only what differs from the defaults (this month, the viewer's first scope, life). */
function homeHref(p: { month: string; current: string; scope: HomeScopeId; defaultScope: HomeScopeId; team?: string | null; all?: boolean; view?: View }): string {
  const q = new URLSearchParams();
  if (p.scope !== p.defaultScope) q.set("scope", p.scope);
  if (p.scope === "team" && p.team) q.set("team", p.team);
  if (p.month !== p.current) q.set("month", p.month);
  if (p.all) q.set("all", "1");
  if (p.view && p.view !== "life") q.set("view", p.view);
  const qs = q.toString();
  return qs ? `/?${qs}` : "/";
}

const people = (n: number) => `${n} ${n === 1 ? "person" : "people"}`;

/**
 * Home (the demo the owner approved on 2026-11-12): the month for Me, a team and the agency
 * (?scope=). Three columns on a computer, one on a phone: Production with the goal and "On pace
 * for", four small cards, the month so far, the leaderboard ("Around you" on Me; In the office
 * first, then Everyone else), the pipeline by status, the latest sales and (Me) what is coming up.
 * Numbers are everyone's to see; a client's name shows only on Me (the viewer's own policies).
 */
export default async function HomePage({ searchParams }: { searchParams: Promise<Params> }) {
  const viewer = await pageViewer();
  const params = await searchParams;
  const today = todayInDetroit();
  const current = monthKeyOf(today);
  const askedMonth = one(params.month);
  const month = askedMonth && isMonthKey(askedMonth) && askedMonth <= current ? askedMonth : current;
  if (!dbConfigured())
    return (
      <div className="page">
        <PageHead title={monthLabel(month)} />
      </div>
    );

  let snap: MonthSnapshot;
  let ctx: RuleContext;
  let carriers: string[] = [];
  try {
    const [snapshot, everyone, settings] = await Promise.all([loadMonthSnapshot(month, { today, scoreboard: false }), listAgents({ includeInactive: true }), getSettings()]);
    snap = snapshot;
    ctx = ruleContext(everyone);
    carriers = settings.carriers;
  } catch (err) {
    // The class only, for the log: the database's own words are not for a screen everyone opens.
    console.error("home_load_failed", err instanceof Error ? err.name : "error");
    return (
      <div className="page">
        <PageHead title={monthLabel(month)} />
        <Notice tone="red">The database didn&apos;t answer. Try again in a moment.</Notice>
      </div>
    );
  }

  // ---- the scope: Me | <team> | Agency (the shared team password: the agency alone) ----
  const me = viewer.level !== "team" && viewer.agentId && ctx.byId.has(viewer.agentId) ? viewer.agentId : null;
  const hs = viewer.level === "team" ? { scopes: [{ id: "agency" as const, label: "Agency" }], pickAnyTeam: false } : homeScopes(viewer, ctx);
  const scopes = me ? hs.scopes : hs.scopes.filter((x) => x.id !== "me");
  const defaultScope: HomeScopeId = scopes.some((x) => x.id === "me") ? "me" : "agency";
  const leaders = ctx.org.leaders();
  const sc = pickHomeScope({ asked: one(params.scope) ?? defaultScope, askedTeam: one(params.team), scopes, pickAnyTeam: hs.pickAnyTeam, leaders });
  const ownTeam = scopes.find((x) => x.id === "team")?.leaderId ?? null;
  const labelOf = (leaderId: string | null) => (!leaderId ? "A team" : leaderId === me ? "My team" : teamName(leaderId, ctx));
  const teamLabel = sc.id === "team" ? labelOf(sc.leaderId) : labelOf(ownTeam);
  const pcOn = snap.pcEnabled === true;
  const view: View = pcOn && isView(one(params.view)) ? (one(params.view) as View) : "life";
  const href = (over: Partial<Parameters<typeof homeHref>[0]>) => homeHref({ month, current, scope: sc.id, defaultScope, team: sc.leaderId, view, ...over });

  // ---- the numbers (life: the goal's measure) ----
  const clock = snap.clock;
  const isCurrent = clock.position === "current";
  const lifeSales: Array<HomeSale & (typeof snap.sales)[number]> = snap.sales.filter((x) => x.kind !== "pc");
  // A joiner whose picked upline waits to be confirmed counts on the agency board like anyone, and
  // is on nobody's team until it is confirmed (contract decision 6: the team scopes read the
  // confirmed tree), so Home, People, the Scoreboard and the TV print the same head count.
  const persons: HomePerson[] = snap.agents.map((a) => ({ id: a.id, name: a.name, active: a.active, inOffice: a.inOffice }));
  const goals = Object.fromEntries(snap.agents.map((a) => [a.id, a.goalCents]));
  const agencyBoard = homeBoard({ people: persons, sales: lifeSales, month, today });
  const teamIds = sc.id === "team" && sc.leaderId ? new Set(ctx.org.teamOf(sc.leaderId)) : null;
  const ids: Set<string> | null = sc.id === "me" && me ? new Set([me]) : sc.id === "team" ? (teamIds ?? new Set()) : null;
  const scoped = ids ? lifeSales.filter((x) => ids.has(x.agentId)) : lifeSales;
  let goalCents = 0;
  let goalNote = "";
  let hideGoal = false;
  if (sc.id === "me") goalCents = me ? (goals[me] ?? 0) : 0;
  else if (sc.id === "team") {
    const tg = teamGoalOf({ people: persons, ids: teamIds ?? new Set(), agencyGoalCents: snap.team.goalCents, goals });
    goalCents = tg.cents;
    hideGoal = !goalCents;
    if (hideGoal && isAdmin(viewer)) goalNote = tg.withGoal === 0 ? "No goals set for these people yet. A team's goal adds up theirs." : `${tg.withGoal} of ${people(tg.people)} have a goal. The team's goal adds up everyone's once each has one.`;
  } else goalCents = snap.team.goalCents;
  const sum = scopeSummary({ sales: scoped, month, today, goalCents, clock });

  // ---- the fourth small card ----
  const teamsList = leaders.map((id) => ({ leaderId: id, name: teamName(id, ctx), ids: ctx.org.teamOf(id), members: ctx.org.membersOf(id).length }));
  let rank: { label: string; value: React.ReactNode; unit?: React.ReactNode; sub: React.ReactNode };
  if (sc.id === "me" && me) {
    const r = agencyBoard.rows.find((x) => x.id === me);
    const lid = myTeamLeaderId(viewer, ctx);
    const myTeam = lid ? homeBoard({ people: persons, sales: lifeSales, month, today, ids: new Set(ctx.org.teamOf(lid)) }) : null;
    const tr = myTeam?.rows.find((x) => x.id === me);
    const words = lid === me ? "your team" : lid ? teamName(lid, ctx) : "";
    rank =
      r && r.sold
        ? { label: "Rank", value: `#${r.rank}`, unit: `of ${agencyBoard.people}`, sub: tr?.sold && myTeam && myTeam.people > 1 ? `#${tr.rank} on ${words}` : "in the agency" }
        : { label: "Rank", value: "—", sub: "Not on the board yet" };
  } else if (sc.id === "team") {
    const teams = homeTeams({ board: agencyBoard, teams: teamsList, month, today });
    const t = teams.find((x) => x.leaderId === sc.leaderId);
    const members = persons.filter((p) => p.active && teamIds?.has(p.id)).length;
    const sellers = new Set(scoped.map((x) => x.agentId)).size;
    rank = t ? { label: "Team rank", value: `#${t.rank}`, unit: `of ${teams.length} ${teams.length === 1 ? "team" : "teams"}`, sub: `${people(members)} · ${sellers} sold` } : { label: "Team rank", value: "—", sub: `${people(members)} · none sold` };
  } else {
    rank = { label: "Sold", value: String(agencyBoard.sellers), unit: `of ${agencyBoard.people}`, sub: "people have sold" };
  }

  // ---- the right column: the pipeline and the latest sales ----
  const monthDays = datesOfMonth(month);
  const policiesHref = (scope: PolicyScope, team: string | null, status?: PipelineStatus) => {
    const q = queryToParams({ scope, team, status: status ? [status] : [], ...(isCurrent ? { sub: "month" as const } : { sub: "custom" as const, subFrom: monthDays[0], subTo: monthDays[monthDays.length - 1] }) });
    return `/policies?${q.toString()}`;
  };
  const right: React.ReactNode[] = [];
  let mine: PolicyListRow[] = [];
  const own = canUsePolicies(viewer) && viewer.agentId;
  // The pipeline's rows (read first; the cards are drawn after): the viewer's own, a team's where the
  // viewer sees every policy on it (a manager on their own team, an admin on any), the agency's for an admin.
  let pipeRows: PolicyListRow[] | null = null;
  let pipeLink: { title: string; scope: PolicyScope; team: string | null } | null = null;
  try {
    if (sc.id === "me" && own) {
      mine = await listPoliciesFor(viewer, "mine");
      if (mine.some((p) => p.soldOn.slice(0, 7) === month)) {
        pipeRows = mine;
        pipeLink = { title: "My pipeline", scope: "mine", team: null };
      }
    } else if (sc.id === "team" && sc.leaderId && (isAdmin(viewer) || (viewer.level === "manager" && sc.leaderId === viewer.agentId))) {
      pipeRows = await listPoliciesFor(viewer, "team", sc.leaderId);
      pipeLink = { title: "Team pipeline", scope: "team", team: isAdmin(viewer) ? sc.leaderId : null };
    } else if (sc.id === "agency" && isAdmin(viewer)) {
      pipeRows = await listPoliciesFor(viewer, "all");
      pipeLink = { title: "Agency pipeline", scope: "all", team: null };
    }
  } catch (err) {
    console.error("home_pipeline_failed", err instanceof Error ? err.name : "error");
    pipeRows = null;
  }
  if (pipeRows && pipeLink) {
    const pipe = pipelineOf(pipeRows, month);
    const link = pipeLink;
    right.push(<PipelineCard key="pipe" title={link.title} total={pipe.total} rows={pipe.rows} hrefFor={(st) => policiesHref(link.scope, link.team, st)} allHref={policiesHref(link.scope, link.team)} />);
  }
  const when = (soldOn: string, createdAt: string) => (soldOn === today ? formatClock(createdAt) : formatDate(soldOn, { year: false }));
  if (sc.id === "me") {
    const thisMonth = mine.filter((p) => p.soldOn.slice(0, 7) === month);
    if (thisMonth.length) {
      const latest = [...thisMonth].sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0)).slice(0, 5);
      right.push(
        <Panel key="latest" title="Latest sales" sub="Your newest policies" className={s.latest} data-latest-sales>
          <div className="list">
            {latest.map((p) => (
              <ListRow key={p.id} href={`/policies/${p.id}`} title={clientNameOf(p) || "No client yet"} sub={[p.carrier, p.product].filter(Boolean).join(" · ")} right={formatDollars(p.premiumCents)} rightSub={when(p.soldOn, p.createdAt)} />
            ))}
          </div>
        </Panel>,
      );
      const items = comingUp(mine, today).map((c) => ({
        id: c.policy.id,
        title: clientNameOf(c.policy) || [c.policy.carrier, c.policy.product].filter(Boolean).join(" · ") || "A policy",
        sub: c.kind === "effective" ? `Takes effect ${formatDate(c.policy.effectiveDate, { year: false })} · ${c.days === 0 ? "today" : c.days === 1 ? "tomorrow" : `in ${c.days} days`}` : `Underwriting ${c.days} days${c.policy.carrier ? ` · ${c.policy.carrier}` : ""}`,
        warn: c.kind === "underwriting",
      }));
      if (isCurrent) right.push(<ComingCard key="coming" items={items} />);
    }
  } else {
    right.push(<LatestSales key="latest" viewer={viewer} ctx={ctx} sales={scoped} scope={sc.id} today={today} pcOn={pcOn} carriers={carriers} />);
    if (sc.id === "agency") right.push(<TeamsCard key="teams" teams={homeTeams({ board: agencyBoard, teams: teamsList, month, today })} />);
  }

  // ---- the middle column: the chart and the leaderboard ----
  const board = sc.id === "team" ? homeBoard({ people: persons, sales: lifeSales, month, today, ids: teamIds ?? new Set() }) : agencyBoard;
  const chartTitle = sc.id === "me" ? "You" : sc.id === "team" ? teamLabel : snap.agencyName;
  const emptyMine = sc.id === "me" && sum.count === 0;
  const showAll = one(params.all) === "1";
  let boardCard: React.ReactNode;
  if (sc.id === "me" && me) {
    const r = agencyBoard.rows.find((x) => x.id === me);
    boardCard = (
      <AroundCard
        key="board"
        rows={aroundYou(agencyBoard.rows, me)}
        meId={me}
        sub={r?.sold ? `Agency leaderboard · you're #${r.rank} of ${agencyBoard.people}` : `Agency leaderboard · ${agencyBoard.sellers} of ${agencyBoard.people} have sold`}
      />
    );
  } else {
    boardCard = (
      <BoardCard
        key="board"
        title={sc.id === "team" ? teamLabel : "Leaderboard"}
        sub={`${people(board.people)} · ${board.sellers} sold${isCurrent ? " · arrows show places since yesterday" : ""}`}
        groups={officeGroups(board)}
        meId={me}
        compact={sc.id === "agency"}
        current={isCurrent}
        allHref={href({ all: true })}
        fewerHref={href({ all: false })}
        showAll={showAll}
        people={board.people}
      />
    );
  }

  // ---- the header ----
  const prev = addMonths(month, -1);
  const next = addMonths(month, 1);
  const segItems = scopes.map((x) => ({ key: x.id, label: x.id === "team" ? teamLabel : x.label, href: href({ scope: x.id, team: x.id === "team" ? (sc.id === "team" ? sc.leaderId : ownTeam) : null, all: false }) }));
  const pickTeam = hs.pickAnyTeam && sc.id === "team" && sc.leaderId;
  const teamOptions = pickTeam
    ? [...leaders]
        .sort((a, b) => (a === me ? -1 : b === me ? 1 : (ctx.byId.get(a)?.name ?? "").localeCompare(ctx.byId.get(b)?.name ?? "")))
        .map((id) => ({ id, label: `${labelOf(id)} · ${people(ctx.org.membersOf(id).length)}` }))
    : [];
  const tools = (
    <div className={s.tools}>
      {segItems.length > 1 && <SegmentedLinks items={segItems} current={sc.id} label="Whose numbers" />}
      {pickTeam && (
        <div className={s.pick}>
          <TeamPicker value={sc.leaderId!} options={teamOptions} hrefFor={Object.fromEntries(teamOptions.map((o) => [o.id, href({ scope: "team", team: o.id, all: false })]))} />
        </div>
      )}
    </div>
  );
  const title = (
    <>
      <span>{monthLabel(month)}</span>
      <span className={s.months} aria-label="Month">
        <Link href={href({ month: prev, all: false })} aria-label={monthLabel(prev)} className="btn btn-ghost btn-icon btn-sm" scroll={false}>
          <Icon name="chevron-left" size={16} />
        </Link>
        {month !== current && (
          <Link href={href({ month: current, all: false })} className="btn btn-quiet btn-sm" scroll={false}>
            Now
          </Link>
        )}
        <Link
          href={href({ month: next, all: false })}
          aria-label={monthLabel(next)}
          aria-disabled={month >= current}
          className={cn("btn btn-ghost btn-icon btn-sm", month >= current && "pointer-events-none opacity-40")}
          scroll={false}
        >
          <Icon name="chevron-right" size={16} />
        </Link>
      </span>
    </>
  );
  const sub = isCurrent ? `${dayLabelLong(today)} · ${daysLeftLabel(clock)}` : "Finished";

  // While the owner has the P&C board on, Life | P&C | Total as before (the life view is the new Home).
  const viewSwitch = pcOn ? (
    <SegmentedLinks
      small
      label="View"
      current={view}
      items={(["life", "pc", "total"] as const).map((v) => ({ key: v, label: v === "life" ? "Life" : v === "pc" ? "P&C" : "Total", href: href({ view: v, all: false }) }))}
    />
  ) : null;
  if (pcOn && view !== "life") {
    const tick = isCurrent && clock.elapsed > 0 ? Math.round(clock.progress * 100) : null;
    const role = isAdmin(viewer) ? "owner" : "team";
    return (
      <div className="page">
        <PageHead title={title} sub={sub} right={segItems.length > 1 || pickTeam ? tools : undefined} />
        {viewSwitch}
        <div className="page-narrow">
          {view === "pc" ? (
            <PcView s={snap} role={role} goalLine={tick !== null && (snap.team.pcGoalCents > 0 || snap.agents.some((a) => a.pcGoalCents > 0)) ? tick : null} today={today} />
          ) : (
            <TotalView s={snap} role={role} goalLine={tick !== null && (snap.team.totalGoalCents > 0 || snap.agents.some((a) => a.totalGoalCents > 0)) ? tick : null} today={today} />
          )}
        </div>
      </div>
    );
  }

  const setGoalHref = sc.id === "me" && !goalCents && isAdmin(viewer) ? "/team" : undefined;
  return (
    <div className={cn("page", s.wrap)} data-scope={sc.id}>
      <PageHead title={title} sub={sub} right={segItems.length > 1 || pickTeam ? tools : undefined} />
      {viewSwitch}
      <div className={cn(s.grid, right.length === 0 && s.noRight)}>
        <div className={cn(s.col, s.left)}>
          <ProductionCard sum={sum} clock={clock} range={rangeLabel(month, today)} noGoal={{ hide: hideGoal, note: goalNote, setGoalHref }} />
          <MiniCards sum={sum} current={isCurrent} best={(() => {
            const b = bestDayOf(scoped);
            return b ? { date: formatDate(b.date, { year: false }), cents: b.cents } : null;
          })()} rank={rank} />
        </div>
        <div className={cn(s.col, s.mid)}>
          {emptyMine ? (
            <EmptyMe current={isCurrent} />
          ) : (
            <ChartCard title={chartTitle} goal={goalCents > 0}>
              <MonthChart daily={scopeDaily(snap.daily, scoped)} goalCents={goalCents} today={today} height={216} className="h-[176px] w-full md:h-[216px]" />
            </ChartCard>
          )}
          {boardCard}
        </div>
        {right.length > 0 && <div className={cn(s.col, s.right)}>{right}</div>}
      </div>
    </div>
  );
}

/**
 * The latest sales of a team or the agency: the seller, the carrier and product, the amount and the
 * day. Never a client (the board's own rows, src/lib/data.ts SALE_COLUMNS). A row opens the policy
 * when the viewer may see it; the "…" menu fixes or takes back a sale as the rules allow.
 */
function LatestSales({ viewer, ctx, sales, scope, today, pcOn, carriers }: { viewer: Viewer; ctx: RuleContext; sales: MonthSnapshot["sales"]; scope: "team" | "agency"; today: string; pcOn: boolean; carriers: string[] }) {
  const list = [...sales].sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0)).slice(0, 6);
  const person = viewer.level !== "team";
  const role = isAdmin(viewer) ? "owner" : "team";
  const undo = (agentId: string): UndoRight => (!person ? "view-only" : agentId === viewer.agentId ? "ok" : "not-yours");
  const agents = ctx.agents.filter((a) => a.active).map((a) => ({ id: a.id, name: a.name }));
  return (
    <Panel title="Latest sales" sub={scope === "team" ? "Newest on the team" : "Newest in the agency"} className={s.latest} data-latest-sales>
      {list.length === 0 ? (
        <EmptyState title="No sales yet" body="They show up here as they're logged." />
      ) : (
        <div className="list">
          {list.map((x) => {
            const open = person && canSeeClient(viewer, { agentId: x.agentId }, ctx);
            const product = [x.carrier, x.product].filter(Boolean).join(" · ");
            const whenText = x.soldOn === today ? formatClock(x.createdAt) : formatDate(x.soldOn, { year: false });
            const body = (
              <>
                <span className="lr-main">
                  <span className="lr-title ell">{x.agentName}</span>
                  {product && <span className="lr-sub ell">{product}</span>}
                </span>
                <span className="lr-right">
                  <span className="lr-amt num">{formatDollars(x.premiumCents)}</span>
                  <span className="lr-rsub num">{whenText}</span>
                </span>
              </>
            );
            return (
              <div key={x.id} className="list-row" data-sale={x.id}>
                {open ? (
                  <Link href={`/policies/${x.id}`} className={s.saleLink}>
                    {body}
                  </Link>
                ) : (
                  <span className={s.saleLink}>{body}</span>
                )}
                {person && (isAdmin(viewer) || x.agentId === viewer.agentId) && <SaleRowMenu sale={x} role={role} undo={undo(x.agentId)} agents={agents} carriers={carriers} pcCarriers={[]} pcEnabled={pcOn} />}
              </div>
            );
          })}
        </div>
      )}
    </Panel>
  );
}
