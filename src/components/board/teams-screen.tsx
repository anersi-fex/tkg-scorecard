"use client";

import type { MonthSnapshot } from "@/lib/board";
import type { ScoreRow, ScoreTeam } from "@/lib/scoreboard-types";
import { formatDollars } from "@/lib/money";
import { cn } from "@/components/ui";
import { Medal, RankChip } from "@/components/ui/kit";
import { pageCount, pageOf, quietTeams, shareOf, teamLabel, type QuietTeam } from "@/lib/views";
import { EmptyScreen, PageDots, useBoxEm, usePager, useReportPages } from "./parts";

/**
 * The Teams screen (the CRM's "Agency totals") in the calmer CRM look (the approved demo,
 * 2026-11-12): one row per leader, a leader being anyone with people under them on confirmed
 * uplines and the team the leader plus everyone below, all levels. Each row: the place and its
 * change, a medal for the top three, "<Leader>'s team" over a thin bar against the top team, the
 * people on it and how many sold, policies, the top seller and the total. The leaders whose people
 * have not sold yet follow, dimmed. More teams than fit page.
 */
/** A row's least height in the board's em (1em = 16 of the demo's pixels), and the demo's rows a page. */
const ROW = 76 / 16;
const MAX_ROWS = 9;
/** The same sentence as the phone Scoreboard's Teams view. */
const NO_UPLINES = "Teams show here once people have an upline. Set uplines on the People page.";

type Item = { kind: "team"; team: ScoreTeam } | { kind: "quiet"; team: QuietTeam };

export function TeamsScreen({ snap, onPages }: { snap: MonthSnapshot; onPages?: (pages: number) => void }) {
  const sb = snap.scoreboard;
  const teams = sb?.teams ?? [];
  // The snapshot's upline is the confirmed one: a joiner waiting for an OK is on nobody's team.
  const quiet = sb ? quietTeams(snap.agents, teams.map((t) => t.leaderId)) : [];
  const items: Item[] = [...teams.map((team): Item => ({ kind: "team", team })), ...quiet.map((team): Item => ({ kind: "quiet", team }))];
  const [ref, box] = useBoxEm();
  const fit = Math.min(MAX_ROWS, box ? Math.max(1, Math.floor(box.h / ROW + 0.02)) : MAX_ROWS);
  const pages = pageCount(items.length, fit);
  const page = usePager(pages);
  useReportPages(pages, onPages);
  // Uplines make teams: before anyone has one, say where to set them, not that nobody sold.
  const uplines = snap.agents.some((a) => a.active && a.uplineId);
  if (!sb || teams.length === 0) return <EmptyScreen title="Teams" line={!uplines ? NO_UPLINES : sb ? "A team shows here once someone on it sells." : "The numbers are on their way."} />;
  const byId = new Map(sb.rows.map((r) => [r.agentId, r]));
  const lead = Math.max(1, ...teams.map((t) => t.totalCents));
  const shown = pageOf(items, page, fit);
  const rows = Math.min(fit, Math.max(1, shown.length));
  return (
    <div className="tvb-main tvb-teamsmain">
      <section className="tvb-card tvb-tbl tvb-teams" aria-label="Teams" data-card="teams">
        <div className="tvb-tbl-head">
          <div className="tvb-lhs">
            <h2 className="tvb-title">Teams</h2>
            <div className="tvb-sub">A leader and everyone under them, added up</div>
          </div>
          <div className="tvb-rhs">
            <span className="num">
              {sb.range.label} · {items.length} {items.length === 1 ? "team" : "teams"}, {teams.length} with a sale
            </span>
            <PageDots pages={pages} page={page} />
          </div>
        </div>
        <div className="tvb-teamgrid">
          <div className="tvb-thead tvb-teamhead">
            <span />
            <span />
            <span>Team</span>
            <span>People</span>
            <span className="tvb-n">Policies</span>
            <span className="tvb-th-top">Top seller</span>
            <span className="tvb-n">Total</span>
          </div>
          <div ref={ref} className="min-h-0 flex-1">
            <ol key={page} className={cn("tvb-tbody h-full", pages > 1 && "board-page")} style={{ gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))` }}>
              {shown.map((it) =>
                it.kind === "team" ? (
                  <TeamRow key={it.team.leaderId} team={it.team} lead={lead} top={it.team.memberIds.map((id) => byId.get(id)).find((r): r is ScoreRow => r !== undefined) ?? null} />
                ) : (
                  <QuietRow key={it.team.leaderId} team={it.team} />
                ),
              )}
            </ol>
          </div>
        </div>
      </section>
    </div>
  );
}

function TeamRow({ team, lead, top }: { team: ScoreTeam; lead: number; top: ScoreRow | null }) {
  return (
    <li data-team={team.leaderId} className="tvb-team">
      <span className="tvb-trank">
        <span className="tvb-rk num">{team.rank}</span>
        <span className="tvb-rchg">
          <RankChip change={team.rankChange} />
        </span>
      </span>
      <span className="tvb-tmedal">
        <Medal rank={team.rank} size={28} />
      </span>
      <span className="tvb-tname">
        <span className="tvb-tn-row">
          <span className="tvb-nm ell">{teamLabel(team.name)}</span>
        </span>
        <span className="tvb-share" style={{ width: `${shareOf(team.totalCents, lead).toFixed(1)}%` }} />
      </span>
      <span className="tvb-tpeople">
        <span className="num">
          {team.members} {team.members === 1 ? "person" : "people"}
        </span>
        <span className="tvb-tsold num">{team.activeAgents} sold</span>
      </span>
      <span className="tvb-n num">{team.policies}</span>
      <span className="tvb-ttop">
        {top && (
          <>
            <span className="tvb-ttop-nm ell">{top.name}</span>
            <span className="tvb-ttop-amt num">{formatDollars(top.totalCents)}</span>
          </>
        )}
      </span>
      <span className="tvb-n tvb-total num">{formatDollars(team.totalCents)}</span>
    </li>
  );
}

/** A leader whose people have not sold yet: dimmed, after the ranked teams. */
function QuietRow({ team }: { team: QuietTeam }) {
  return (
    <li data-quiet-team={team.leaderId} className="tvb-team none">
      <span className="tvb-trank">
        <span className="tvb-rk num">–</span>
        <span className="tvb-rchg" />
      </span>
      <span className="tvb-tmedal" />
      <span className="tvb-tname">
        <span className="tvb-tn-row">
          <span className="tvb-nm ell">{teamLabel(team.name)}</span>
        </span>
      </span>
      <span className="tvb-tpeople">
        <span className="num">
          {team.members} {team.members === 1 ? "person" : "people"}
        </span>
        <span className="tvb-tsold">No sale yet</span>
      </span>
      <span className="tvb-n">—</span>
      <span className="tvb-ttop" />
      <span className="tvb-n tvb-total">—</span>
    </li>
  );
}
