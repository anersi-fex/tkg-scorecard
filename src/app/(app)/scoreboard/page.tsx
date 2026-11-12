import type { Metadata } from "next";
import Link from "next/link";
import { pageViewer } from "@/lib/auth";
import { getSettings, listAgents, monthsWithSales } from "@/lib/data";
import { formatDollars } from "@/lib/money";
import { isMonthKey, monthKeyOf, monthLabel, todayInDetroit } from "@/lib/month";
import { buildOrg } from "@/lib/org";
import { shortDay } from "@/lib/scoreboard";
import { loadScoreboard } from "@/lib/scoreboard-load";
import type { ScoreMover, Scoreboard } from "@/lib/scoreboard-types";
import { dbConfigured } from "@/lib/supabase";
import { Notice, cn } from "@/components/ui";
import { Leaderboard, type Column } from "./leaderboard";
import { MonthPicker } from "./month-picker";
import { OfficeDot, Segmented, Spark, shortMoney } from "./parts";
import { SearchBox, SearchProvider } from "./search";

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

const CARD = "rounded-[22px] bg-surface shadow-card";
const H2 = "text-[17px] leading-tight font-extrabold tracking-[-0.025em] text-gray-900";
const SUB = "mt-0.5 text-[13px] font-medium text-gray-500";

export default async function ScoreboardPage({ searchParams }: PageProps<"/scoreboard">) {
  const viewer = await pageViewer();
  const params = await searchParams;
  const today = todayInDetroit();
  const current = monthKeyOf(today);
  const asked = one(params.month);
  const month = isMonthKey(asked) && asked <= current ? asked : current;
  const who: Who = one(params.who) === "teams" ? "teams" : "agents";
  const view: TableView = one(params.view) === "product" ? "product" : one(params.view) === "carrier" ? "carrier" : "dates";

  if (!dbConfigured()) return <Title sub={null} exportHref={null} />;

  let sb: Scoreboard;
  let myLeader: string | null = null;
  let choice: Choice;
  let months: string[] = [];
  let onBoard = true;
  let leaderName: string | null = null;
  let agencyName = "";
  try {
    const agents = await listAgents({ includeInactive: true });
    const org = buildOrg(agents);
    // "My team": the viewer's own people when they lead some, else the team they are on. The
    // shared team password names nobody, so it has no team to show.
    const me = viewer.agentId && agents.some((a) => a.id === viewer.agentId) ? viewer.agentId : null;
    myLeader = me ? (org.isLeader(me) ? me : org.uplineOf(me)) : null;
    const askedTeam = one(params.team);
    const team = UUID.test(askedTeam) && agents.some((a) => a.id === askedTeam) ? askedTeam : null;
    const scope: Choice["scope"] = !team && one(params.scope) === "team" && myLeader ? "team" : "agency";
    choice = { scope, team, month, who, view };
    const leaderId = team ?? (scope === "team" ? myLeader : null);
    leaderName = leaderId ? org.nameOf(leaderId) : null;
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
      <>
        <Title sub={null} exportHref={null} />
        <Notice tone="red">The database didn&apos;t answer. Try again in a minute.</Notice>
      </>
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

  return (
    // Wider than the app's column on a computer: the table needs the room.
    <div className="lg:ml-[calc(50%_-_min(660px,_50vw_-_32px))] lg:w-[min(1320px,_100vw_-_64px)]" data-scoreboard={sb.scope}>
      {/* The key empties the search box when the page narrows to a team or widens again: text left from the last list would quietly hide part of the new one. */}
      <SearchProvider key={leaderId ?? "agency"}>
        <Title sub={`${sb.scopeName} · ${sb.range.label}`} exportHref={`/api/scoreboard/export?${exportQuery.toString()}`} />

        <div className="mb-3 flex flex-wrap items-center gap-2">
          {myLeader && (
            <Segmented
              label="Whose numbers"
              items={[
                { label: "My team", href: go({ scope: "team", team: null }), on: leaderId !== null && leaderId === myLeader },
                { label: "Agency", href: go({ scope: "agency", team: null }), on: leaderId === null },
              ]}
            />
          )}
          <MonthPicker value={month} options={monthOptions} />
          <SearchBox className="min-w-[200px] flex-1 md:max-w-xs" />
        </div>

        {choice.team && (
          <p className="mb-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-2xl bg-tint px-3.5 py-2 text-[14px] font-semibold text-gray-900">
            <span>Showing {leaderName ? `${leaderName}'s team` : "one team"}</span>
            <Link href={go({ scope: "agency", team: null })} className="flex min-h-11 items-center gap-1 font-bold text-accent-text md:min-h-9">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M15 6l-6 6 6 6" />
              </svg>
              Back to the whole agency
            </Link>
          </p>
        )}

        {!onBoard && (
          <p className="mb-3 flex flex-wrap items-center gap-x-2 px-1 text-[14px] font-medium text-gray-600">
            You&apos;re not on the board yet this month
            <Link href="/log" className="flex min-h-11 items-center font-bold text-accent-text md:min-h-0">
              Log a sale
            </Link>
          </p>
        )}

        {/* 1. The three top numbers, against the same days of the month before */}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
          <Kpi className="col-span-2 md:col-span-1" title="Production" value={shortMoney(sb.kpis.productionCents)} delta={sb.kpis.productionCents - sb.kpis.prevProductionCents} deltaText={shortMoney(Math.abs(sb.kpis.productionCents - sb.kpis.prevProductionCents))} compare={sb.compare.label} caption="Annual premium sold" spark={sb.kpis.dailyCents} />
          <Kpi title="Policies sold" value={String(sb.kpis.policies)} delta={sb.kpis.policies - sb.kpis.prevPolicies} deltaText={String(Math.abs(sb.kpis.policies - sb.kpis.prevPolicies))} compare={sb.compare.label} caption="Policies with premium" />
          <Kpi title="Active agents" value={String(sb.kpis.activeAgents)} delta={sb.kpis.activeAgents - sb.kpis.prevActiveAgents} deltaText={String(Math.abs(sb.kpis.activeAgents - sb.kpis.prevActiveAgents))} compare={sb.compare.label} caption="Agents who sold" spark={sb.kpis.dailyActiveAgents} />
        </div>

        <div className="mt-3 grid gap-3 min-[1360px]:grid-cols-[2fr_3fr]">
          {/* 2. Where agents stand */}
          <section className={cn(CARD, "p-4")} data-section="stand">
            <h2 className={H2}>Where agents stand</h2>
            <p className={SUB}>
              {sb.range.label} · {sb.stand.agents} {sb.stand.agents === 1 ? "agent" : "agents"} on the board
            </p>
            {sb.stand.agents === 0 ? (
              <p className="mt-3 text-[14px] text-gray-600">{whole ? "Nobody sold that month." : "Nobody has sold yet this month."}</p>
            ) : (
              <>
                <p className="mt-2.5 text-[14px] font-medium text-gray-600">
                  The middle agent is at <span className="font-mono font-bold text-gray-900">{formatDollars(sb.stand.medianCents)}</span>.
                </p>
                <Histogram sb={sb} />
                <p className="mt-3 border-t border-line pt-2.5 text-[12px] font-medium text-gray-500">Each bar counts the agents whose production falls in that range</p>
              </>
            )}
          </section>

          {/* 3. Moved most this week */}
          <section className={cn(CARD, "p-4")} data-section="movers">
            <h2 className={H2}>{whole ? "Moved most in the last week" : "Moved most this week"}</h2>
            <p className={SUB}>
              {sb.movers.label} · {sb.scope === "agency" ? "Agency" : sb.scopeName}
            </p>
            <div className="mt-3 grid gap-x-4 gap-y-3 md:grid-cols-2">
              <Movers up items={sb.movers.up} />
              <Movers up={false} items={sb.movers.down} />
            </div>
          </section>
        </div>

        {/* 4. The production leaderboard */}
        <section className={cn(CARD, "mt-3 scroll-mt-[calc(var(--nav-h,_61px)_+_8px)] overflow-hidden")} data-section="leaderboard">
          <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3 p-4">
            <div className="min-w-0">
              <h2 className={H2}>Production leaderboard</h2>
              <p className={cn(SUB, "flex flex-wrap items-center gap-x-3")}>
                <span>{whole ? "Final places for the month" : "Arrows show places gained or lost since yesterday"}</span>
                {anyOffice && (
                  <span className="inline-flex items-center gap-1.5">
                    <OfficeDot /> in the office
                  </span>
                )}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Segmented
                label="Agents or teams"
                scroll={false}
                items={[
                  { label: "Agents", href: go({ who: "agents" }), on: who === "agents" },
                  { label: "Teams", href: go({ who: "teams" }), on: who === "teams" },
                ]}
              />
              <Segmented
                label="Columns"
                scroll={false}
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
          />
        </section>
      </SearchProvider>
    </div>
  );
}

function Title({ sub, exportHref }: { sub: string | null; exportHref: string | null }) {
  return (
    <div className="mb-3 flex items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-[28px] leading-tight font-extrabold tracking-[-0.035em] text-gray-900">Scoreboard</h1>
        {sub && <p className="mt-0.5 truncate text-[14px] font-medium text-gray-500">{sub}</p>}
      </div>
      {exportHref && (
        <a href={exportHref} download className="flex h-11 shrink-0 items-center gap-2 rounded-xl border border-line bg-surface px-3.5 text-[13px] font-bold text-gray-900 shadow-card hover:bg-gray-50 md:h-9">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M12 4v10M8 10.5l4 4 4-4M4.5 15.5v2a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-2" />
          </svg>
          Export CSV
        </a>
      )}
    </div>
  );
}

/** One top card: the number, the chip against the month before, what it counts, a small chart. */
function Kpi({ title, value, delta, deltaText, compare, caption, spark, className }: { title: string; value: string; delta: number; deltaText: string; compare: string; caption: string; spark?: number[]; className?: string }) {
  return (
    <section className={cn(CARD, "min-w-0 p-4", className)} data-kpi={title}>
      <h2 className="text-[13px] font-semibold text-gray-500">{title}</h2>
      <p className="mt-1.5 font-mono text-[30px] leading-none font-bold tracking-[-0.03em] text-gray-900">{value}</p>
      <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className={cn("inline-flex h-[22px] items-center gap-1 rounded-full px-2 font-mono text-[12px] leading-none font-bold whitespace-nowrap", delta > 0 ? "bg-green-100 text-green-800" : delta < 0 ? "bg-red-100 text-red-800" : "bg-track text-gray-500")}>
          <span aria-hidden>{delta > 0 ? "↑" : delta < 0 ? "↓" : "–"}</span>
          <span className="sr-only">{delta > 0 ? "up" : delta < 0 ? "down" : "no change"}</span>
          {delta !== 0 && deltaText}
        </span>
        <span className="text-[12px] font-medium whitespace-nowrap text-gray-500">vs {compare}</span>
      </p>
      <div className="mt-2 flex items-end justify-between gap-3">
        <p className="text-[12px] font-medium whitespace-nowrap text-gray-500">{caption}</p>
        {spark && <Spark values={spark} className="h-7 max-w-24 min-w-0 flex-1" />}
      </div>
    </section>
  );
}

/** Five flat bars with the count on top and the range under each. */
function Histogram({ sb }: { sb: Scoreboard }) {
  const most = Math.max(1, ...sb.stand.buckets.map((b) => b.count));
  return (
    <div className="mt-3" role="img" aria-label={sb.stand.buckets.map((b) => `${b.label}: ${b.count}`).join(", ")}>
      <div className="grid h-[112px] grid-cols-5 items-end gap-1.5 border-b border-line">
        {sb.stand.buckets.map((b) => (
          <div key={b.label} className="flex min-w-0 flex-col items-center">
            <span className="mb-1 font-mono text-[12px] leading-none font-semibold text-gray-600">{b.count}</span>
            <span className="w-full rounded-t-lg bg-gray-300" style={{ height: `${b.count ? Math.max(4, Math.round((b.count / most) * 92)) : 2}px` }} />
          </div>
        ))}
      </div>
      <div className="mt-1.5 grid grid-cols-5 gap-1.5">
        {sb.stand.buckets.map((b) => (
          <span key={b.label} className="truncate text-center font-mono text-[11px] font-medium text-gray-500">
            {b.label}
          </span>
        ))}
      </div>
    </div>
  );
}

/** "Going up" or "Slipping": up to three people, each over a bar as long as their move. */
function Movers({ up, items }: { up: boolean; items: ScoreMover[] }) {
  const top = Math.max(1, ...items.map((m) => Math.abs(m.deltaCents)));
  return (
    <div className="min-w-0" data-movers={up ? "up" : "down"}>
      <h3 className={cn("flex items-center gap-1.5 text-[13px] font-bold", up ? "text-green-700" : "text-red-700")}>
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          {up ? <path d="M3 17l6-6 4 4 8-8M15 7h6v6" /> : <path d="M3 7l6 6 4-4 8 8M15 17h6v-6" />}
        </svg>
        {up ? "Going up" : "Slipping"}
      </h3>
      {items.length === 0 ? (
        <p className="mt-2 text-[13px] font-medium text-gray-500">{up ? "Nobody went up." : "Nobody slipped."}</p>
      ) : (
        <ul className="mt-1.5 space-y-1.5">
          {items.map((m) => (
            <li key={m.agentId} className="relative flex h-9 items-center gap-2.5 overflow-hidden rounded-xl bg-surface-2 px-3">
              <span aria-hidden className={cn("absolute inset-y-0 left-0 rounded-xl", up ? "bg-green-100" : "bg-red-100")} style={{ width: `${Math.max(6, Math.round((Math.abs(m.deltaCents) / top) * 100))}%` }} />
              <span className="relative min-w-0 flex-1 truncate text-[14px] font-bold text-gray-900">{m.name}</span>
              <span className="relative shrink-0 font-mono text-[12px] font-medium text-gray-600">
                {formatDollars(m.nowCents)}, was {formatDollars(m.wasCents)}
              </span>
              <span className="relative shrink-0 font-mono text-[14px] font-bold text-gray-900">
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
