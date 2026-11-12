import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { pageViewer } from "@/lib/auth";
import { getSettings, listAgents, monthsWithSales } from "@/lib/data";
import { formatDollars } from "@/lib/money";
import { isMonthKey, monthClock, monthKeyOf, monthLabel, pace, todayInDetroit } from "@/lib/month";
import { buildOrg } from "@/lib/org";
import { shortDay } from "@/lib/scoreboard";
import { loadScoreboard } from "@/lib/scoreboard-load";
import type { ScoreMover, Scoreboard } from "@/lib/scoreboard-types";
import { dbConfigured } from "@/lib/supabase";
import { isAdmin } from "@/lib/viewer";
import { firstCompare, sparkValues } from "@/lib/views";
import { firstName } from "@/components/avatar";
import { Notice } from "@/components/ui";
import { DeltaChip } from "@/components/ui/kit";
import { Icon, type IconName } from "@/components/ui/icon";
import { Leaderboard, type Column } from "./leaderboard";
import { MonthPicker } from "./month-picker";
import { OfficeDot, Segmented, Spark, shortMoney } from "./parts";
import { SearchBox, SearchProvider } from "./search";
import "./scoreboard.css";

export const metadata: Metadata = { title: "Scoreboard" };

/**
 * The Scoreboard (owner, 2026-11-12: the agency's CRM page, "matched exactly ... compact,
 * reasonable, and efficient with space management"): the same four sections, the same words and
 * the same numbers, in Scorecard's look. Every choice lives in the address:
 *   ?scope=team   the viewer's own team (the CRM's "Hierarchy"); the whole agency without it
 *   ?team=<id>    one leader's team (a tap on a person or a team)
 *   ?month=       an earlier month, whole; this month runs through today
 *   ?who=teams    teams in place of agents
 *   ?view=product | carrier   a column per product or carrier in place of the days
 */

type Who = "agents" | "teams";
type TableView = "dates" | "product" | "carrier";

interface Choice {
  scope: "agency" | "team";
  team: string | null;
  month: string;
  who: Who;
  view: TableView;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const one = (v: string | string[] | undefined): string => (typeof v === "string" ? v : "");

function query(c: Choice, current: string): URLSearchParams {
  const q = new URLSearchParams();
  if (c.team) q.set("team", c.team);
  else if (c.scope === "team") q.set("scope", "team");
  if (c.month !== current) q.set("month", c.month);
  if (c.who !== "agents") q.set("who", c.who);
  if (c.view !== "dates") q.set("view", c.view);
  return q;
}

function hrefOf(c: Choice, current: string): string {
  const qs = query(c, current).toString();
  return qs ? `/scoreboard?${qs}` : "/scoreboard";
}

export default async function ScoreboardPage({ searchParams }: PageProps<"/scoreboard">) {
  const viewer = await pageViewer();
  const params = await searchParams;
  const today = todayInDetroit();
  const current = monthKeyOf(today);
  const asked = one(params.month);
  const month = isMonthKey(asked) && asked <= current ? asked : current;
  const who: Who = one(params.who) === "teams" ? "teams" : "agents";
  const view: TableView = one(params.view) === "product" ? "product" : one(params.view) === "carrier" ? "carrier" : "dates";

  if (!dbConfigured())
    return (
      <div className="sb">
        <Title sub={null} exportHref={null} />
      </div>
    );

  let sb: Scoreboard;
  let myLeader: string | null = null;
  let choice: Choice;
  let months: string[] = [];
  let onBoard = true;
  let leaderName: string | null = null;
  let agencyName = "";
  let noUplines = false;
  let people = 0;
  let myLeaderName: string | null = null;
  let leaders: Array<{ id: string; name: string; size: number }> = [];
  try {
    const agents = await listAgents({ includeInactive: true });
    // Teams come from the confirmed uplines only: a joiner waiting for their upline's OK counts on
    // the agency board and on nobody's team yet.
    const org = buildOrg(agents);
    // Uplines make teams: before anyone on the board has a confirmed one, the Teams view says where to set them.
    noUplines = !agents.some((a) => a.active && a.upline_id && a.upline_confirmed !== false);
    // "My team": the viewer's own people when they lead some, else the team they are on. The
    // shared team password names nobody, so it has no team to show.
    const me = viewer.agentId && agents.some((a) => a.id === viewer.agentId) ? viewer.agentId : null;
    myLeader = me ? (org.isLeader(me) ? me : org.uplineOf(me)) : null;
    myLeaderName = myLeader ? org.nameOf(myLeader) : null;
    const askedTeam = one(params.team);
    const team = UUID.test(askedTeam) && agents.some((a) => a.id === askedTeam) ? askedTeam : null;
    const scope: Choice["scope"] = !team && one(params.scope) === "team" && myLeader ? "team" : "agency";
    choice = { scope, team, month, who, view };
    const leaderId = team ?? (scope === "team" ? myLeader : null);
    leaderName = leaderId ? org.nameOf(leaderId) : null;
    const active = new Set(agents.filter((a) => a.active).map((a) => a.id));
    people = leaderId ? org.teamOf(leaderId).filter((id) => active.has(id)).length : active.size;
    // An admin picks any team (the demo's team picker), by name.
    if (isAdmin(viewer)) leaders = org.leaders().map((id) => ({ id, name: org.nameOf(id) ?? "", size: org.teamOf(id).filter((x) => active.has(x)).length })).sort((x, y) => x.name.localeCompare(y.name));
    const [board, withSales, settings] = await Promise.all([loadScoreboard({ month, leaderId, today }), monthsWithSales(), getSettings()]);
    sb = board;
    months = withSales;
    agencyName = settings.agencyName;
    // "You're not on the board yet": the viewer has no sale this month. A page narrowed to a team
    // they are not on cannot tell, so the whole agency is asked once more.
    if (me && month === current && !sb.rows.some((r) => r.agentId === me)) {
      onBoard = leaderId && !org.teamOf(leaderId).includes(me) ? (await loadScoreboard({ month, today })).rows.some((r) => r.agentId === me) : false;
    }
  } catch (err) {
    // The class only; never a row.
    console.error("scoreboard_page_failed", err instanceof Error ? err.name : "error");
    return (
      <div className="sb">
        <Title sub={null} exportHref={null} />
        <Notice tone="red">The database didn&apos;t answer. Try again in a minute.</Notice>
      </div>
    );
  }

  const leaderId = sb.scopeLeaderId;
  const go = (patch: Partial<Choice>) => hrefOf({ ...choice, ...patch }, current);
  const exportQuery = new URLSearchParams({ month, who, view });
  if (leaderId) exportQuery.set("team", leaderId);
  // A tap on a person or a team keeps the month and the view, and shows that team's people.
  const tail = query({ ...choice, scope: "agency", team: null, who: "agents" }, current).toString();
  const monthOptions = [...new Set([current, ...months.filter((m) => m <= current), month])]
    .sort()
    .reverse()
    .map((m) => ({ value: m, label: m === current ? "This month" : monthLabel(m), href: go({ month: m }) }));
  const columns: Column[] = view === "dates" ? sb.range.days.map((d) => ({ key: d, label: shortDay(d) })) : (view === "product" ? sb.products : sb.carriers).map((k) => ({ key: k, label: k }));
  const anyOffice = sb.rows.some((r) => r.inOffice);
  const whole = month !== current;
  const k = sb.kpis;
  const first = firstCompare(k);
  // "On pace for": the running month's production at its rate so far, to the month's last business day.
  const clock = monthClock(month, today);
  const projected = clock.position === "current" ? pace(k.productionCents, 0, clock).projectedCents : null;
  // A finished month draws every business day; a running one through yesterday, and today once it has a sale.
  const spark = (values: number[]) => sparkValues(sb.range.days, values, whole ? "9999-12-31" : today);
  // The team switch reads like the demo: "My team" for a leader, else "<Leader>'s team".
  const myTeamLabel = !myLeader || viewer.agentId === myLeader || !myLeaderName ? "My team" : `${firstName(myLeaderName)}'s team`;
  const teamOptions = leaders.length
    ? [{ value: "", label: "Pick a team", href: go({ scope: "agency", team: null }) }, ...leaders.map((l) => ({ value: l.id, label: `${l.id === viewer.agentId ? "My team" : `${firstName(l.name)}'s team`} · ${l.size} ${l.size === 1 ? "person" : "people"}`, href: go({ team: l.id }) }))]
    : [];

  return (
    <div className="sb" data-scoreboard={sb.scope}>
      {/* The key empties the search box when the page narrows to a team or widens again: text left from the last list would quietly hide part of the new one. */}
      <SearchProvider key={leaderId ?? "agency"}>
        <Title sub={`${sb.scopeName} · ${sb.range.label}`} exportHref={`/api/scoreboard/export?${exportQuery.toString()}`} />

        <div className="sb-bar">
          {myLeader && (
            <Segmented
              label="Whose numbers"
              className="sb-scope"
              items={[
                { label: myTeamLabel, href: go({ scope: "team", team: null }), on: leaderId !== null && leaderId === myLeader },
                { label: "Agency", href: go({ scope: "agency", team: null }), on: leaderId === null },
              ]}
            />
          )}
          {teamOptions.length > 0 && <MonthPicker label="Team" value={leaderId ?? ""} options={teamOptions} />}
          <MonthPicker value={month} options={monthOptions} />
          <SearchBox className="sb-search" placeholder={who === "teams" ? "Team or agent name" : "Agent or team name"} />
        </div>

        {choice.team && (
          <p className="sb-showing">
            <span>Showing {leaderName ? `${leaderName}'s team` : "one team"}</span>
            <Link href={go({ scope: "agency", team: null })}>
              <Icon name="chevron-left" size={15} />
              Back to the whole agency
            </Link>
          </p>
        )}

        {!onBoard && (
          <p className="sb-off">
            You&apos;re not on the board yet this month
            <Link href="/log">Log a sale</Link>
          </p>
        )}

        {/* 1. The three top numbers, against the same days of the month before */}
        <div className="sb-kpis">
          <Kpi
            className="sb-kpi-prod"
            title="Production"
            value={shortMoney(k.productionCents)}
            chip={<DeltaChip diff={k.productionCents - k.prevProductionCents} text={shortMoney(Math.abs(k.productionCents - k.prevProductionCents))} vs={sb.compare.label} first={first} />}
            line={projected !== null ? <Fact icon="trend-up" label="On pace for" value={formatDollars(projected)} className="sb-kpi-pace" /> : <Fact icon="check" label="Month total" value={formatDollars(k.productionCents)} />}
            caption="Annual premium sold"
            spark={spark(k.dailyCents)}
          />
          <Kpi
            title="Policies sold"
            value={String(k.policies)}
            chip={<DeltaChip diff={k.policies - k.prevPolicies} text={String(Math.abs(k.policies - k.prevPolicies))} vs={sb.compare.label} first={first} />}
            line={<Fact icon="file" label="Avg premium" value={k.policies ? formatDollars(Math.round(k.productionCents / k.policies)) : "—"} className="sb-kpi-fact" />}
            caption="Policies with premium"
          />
          <Kpi
            title="Active agents"
            value={String(k.activeAgents)}
            chip={<DeltaChip diff={k.activeAgents - k.prevActiveAgents} text={String(Math.abs(k.activeAgents - k.prevActiveAgents))} vs={sb.compare.label} first={first} />}
            line={<Fact icon="people" label="On the board" value={`${people} ${people === 1 ? "person" : "people"}`} className="sb-kpi-fact" />}
            caption="Agents who sold"
            spark={spark(k.dailyActiveAgents)}
          />
        </div>

        <div className="sb-mid">
          {/* 2. Where agents stand */}
          <section className="card sb-stand" data-section="stand">
            <div className="card-head">
              <div className="card-titles">
                <h2 className="card-title">Where agents stand</h2>
                <p className="card-sub num">
                  {sb.range.label} · {sb.stand.agents} {sb.stand.agents === 1 ? "agent" : "agents"} on the board
                </p>
              </div>
            </div>
            {sb.stand.agents === 0 ? (
              <p className="sb-none">{whole ? "Nobody sold that month." : "Nobody has sold yet this month."}</p>
            ) : sb.stand.tooFew ? (
              <div className="sb-none" data-stand="too-few">
                <p className="font-medium text-fg">Too few agents on the board to compare</p>
                <p>This fills in once 5 agents have production in this period.</p>
              </div>
            ) : (
              <>
                <p className="sb-middle">
                  The middle agent is at <b className="num">{formatDollars(sb.stand.medianCents)}</b>.
                </p>
                <Histogram sb={sb} />
                <p className="sb-hfoot">Each bar counts the agents whose production falls in that range</p>
              </>
            )}
          </section>

          {/* 3. Moved most this week */}
          <section className="card sb-movers" data-section="movers">
            <div className="card-head">
              <div className="card-titles">
                <h2 className="card-title">Moved most this week</h2>
                <p className="card-sub">
                  {sb.movers.label} · {sb.scope === "agency" ? "Agency" : sb.scopeName}
                </p>
              </div>
            </div>
            <div className="sb-mv-cols">
              <Movers up items={sb.movers.up} />
              <Movers up={false} items={sb.movers.down} />
            </div>
          </section>
        </div>

        {/* 4. The production leaderboard */}
        <section className="card sb-lb scroll-mt-[calc(var(--nav-h,_0px)_+_8px)]" data-section="leaderboard">
          <div className="sb-lb-head">
            <div className="card-titles">
              <h2 className="card-title">Production leaderboard</h2>
              <p className="card-sub">
                <span>{whole ? "Final places for the month" : "Arrows show places gained or lost since yesterday"}</span>
                {anyOffice && (
                  <span className="inline-flex items-center gap-1.5">
                    <OfficeDot /> in the office
                  </span>
                )}
              </p>
            </div>
            <div className="sb-lb-tools">
              <Segmented
                label="Agents or teams"
                scroll={false}
                small
                items={[
                  { label: "Agents", href: go({ who: "agents" }), on: who === "agents" },
                  { label: "Teams", href: go({ who: "teams" }), on: who === "teams" },
                ]}
              />
              <Segmented
                label="Columns"
                scroll={false}
                small
                items={[
                  { label: "Dates", href: go({ view: "dates" }), on: view === "dates" },
                  { label: "Product", href: go({ view: "product" }), on: view === "product" },
                  { label: "Carrier", href: go({ view: "carrier" }), on: view === "carrier" },
                ]}
              />
            </div>
          </div>
          <Leaderboard
            who={who}
            field={view === "dates" ? "byDay" : view === "product" ? "byProduct" : "byCarrier"}
            columns={columns}
            rows={sb.rows}
            teams={sb.teams}
            agencyName={agencyName}
            scopeLeaderId={leaderId}
            linkTail={tail ? `&${tail}` : ""}
            emptyLine={whole ? `No sales in ${monthLabel(month)}.` : "No sales yet this month. The first one starts the board."}
            noUplines={noUplines}
            me={viewer.agentId}
            scrollEnd={view === "dates"}
          />
        </section>
      </SearchProvider>
    </div>
  );
}

function Title({ sub, exportHref }: { sub: string | null; exportHref: string | null }) {
  return (
    <div className="page-head">
      <div className="page-head-row">
        <div className="min-w-0">
          <h1 className="page-title">Scoreboard</h1>
          {sub && <p className="page-sub ell">{sub}</p>}
        </div>
        {exportHref && (
          <div className="page-tools">
            <a href={exportHref} download className="btn btn-secondary sb-export">
              <Icon name="download" size={17} />
              Export CSV
            </a>
          </div>
        )}
      </div>
    </div>
  );
}

/** One fact under a card's number: "On pace for $213,808", "Avg premium $985", "On the board 32 people". */
function Fact({ icon, label, value, className }: { icon: IconName; label: string; value: string; className?: string }) {
  return (
    <div className={`sb-kpi-line${className ? ` ${className}` : ""}`}>
      <Icon name={icon} size={16} />
      <span>{label}</span>
      <b>{value}</b>
    </div>
  );
}

/** One top card: the number, the chip against the month before, one fact, what it counts, a small chart. */
function Kpi({ title, value, chip, line, caption, spark, className }: { title: string; value: string; chip: ReactNode; line: ReactNode; caption: string; spark?: number[]; className?: string }) {
  return (
    <section className={`card sb-kpi${className ? ` ${className}` : ""}`} data-kpi={title}>
      <h2 className="sb-kpi-label">{title}</h2>
      <p className="sb-kpi-value font-mono">{value}</p>
      <div className="sb-kpi-chip">{chip}</div>
      {line}
      <div className="sb-kpi-foot">
        <span className="sb-kpi-cap">{caption}</span>
        {spark && spark.length > 1 && <Spark values={spark} className="sb-spark" />}
      </div>
    </section>
  );
}

/** Up to six flat bars (AgentSpace's ranges) with the count on top and the range under each. */
function Histogram({ sb }: { sb: Scoreboard }) {
  const most = Math.max(1, ...sb.stand.buckets.map((b) => b.count));
  return (
    <>
      <div className="sb-hist" style={{ ["--n" as string]: sb.stand.buckets.length }} role="img" aria-label={sb.stand.buckets.map((b) => `${b.label}: ${b.count}`).join(", ")}>
        {sb.stand.buckets.map((b) => (
          <div key={b.label} className="sb-hcol">
            <span className="sb-hcount num">{b.count}</span>
            <span className={b.count ? "sb-hbar" : "sb-hbar zero"} style={{ ["--f" as string]: (b.count / most).toFixed(4) }} />
          </div>
        ))}
      </div>
      <div className="sb-hlabels" style={{ ["--n" as string]: sb.stand.buckets.length }}>
        {sb.stand.buckets.map((b) => (
          <span key={b.label} className="num">
            {b.label}
          </span>
        ))}
      </div>
    </>
  );
}

/** "Going up" or "Slipping": up to three people, each over a bar as long as their move. */
function Movers({ up, items }: { up: boolean; items: ScoreMover[] }) {
  const top = Math.max(1, ...items.map((m) => Math.abs(m.deltaCents)));
  return (
    <div className="min-w-0" data-movers={up ? "up" : "down"}>
      <h3 className={`sb-mv-h ${up ? "up" : "down"}`}>
        <Icon name={up ? "trend-up" : "trend-down"} size={17} />
        {up ? "Going up" : "Slipping"}
      </h3>
      {items.length === 0 ? (
        <p className="sb-none">{up ? "Nobody went up." : "Nobody slipped."}</p>
      ) : (
        <ul className="sb-mv-rows">
          {items.map((m) => (
            <li key={m.agentId} className="sb-mv">
              <span aria-hidden className="sb-mv-bar" style={{ width: `${Math.max(6, Math.round((Math.abs(m.deltaCents) / top) * 100))}%` }} />
              <span className="sb-mv-who">
                <span className="sb-mv-name ell">{m.name}</span>
                <span className="sb-mv-was num">
                  {formatDollars(m.nowCents)}, was {formatDollars(m.wasCents)}
                </span>
              </span>
              <span className="sb-mv-d num">
                {up ? "+" : "−"}
                {formatDollars(Math.abs(m.deltaCents))}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
