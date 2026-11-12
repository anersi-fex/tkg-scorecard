"use client";

import type { MonthSnapshot } from "@/lib/board";
import type { ScoreRow, ScoreTeam } from "@/lib/scoreboard-types";
import { formatDollars } from "@/lib/money";
import { Avatar, shortName } from "@/components/avatar";
import { cn } from "@/components/ui";
import { pageCount, pageOf } from "@/lib/views";
import { EmptyScreen, PageDots, PlaceMark, useBoxEm, usePager, useReportPages } from "./parts";
import { ChangeChip } from "./production-screen";

/**
 * The Teams screen (the CRM's "Agency totals", decision 11): one row per leader, a leader being
 * anyone with people under them and the team the leader plus everyone below, all levels. Each row:
 * the place, "Anersi Koka's team" over a bar against the top team, the people on it and how many
 * sold, policies, the team's top three sellers and the total. More teams than fit page.
 */
const ROW = 4.5;
const COLUMNS = "3.2em minmax(0, 1.2fr) 8.5em 7em minmax(0, 1.75fr) 9.5em";

export function TeamsScreen({ snap, onPages }: { snap: MonthSnapshot; onPages?: (pages: number) => void }) {
  const sb = snap.scoreboard;
  const teams = sb?.teams ?? [];
  const [ref, box] = useBoxEm();
  const fit = box ? Math.max(1, Math.floor(box.h / ROW + 0.02)) : 9;
  const pages = pageCount(teams.length, fit);
  const page = usePager(pages);
  useReportPages(pages, onPages);
  if (!sb || teams.length === 0) return <EmptyScreen title="Teams" line={sb ? "A team shows here once someone on it sells." : "The numbers are on their way."} />;
  const byId = new Map(sb.rows.map((r) => [r.agentId, r]));
  const top = Math.max(1, ...teams.map((t) => t.totalCents));
  const shown = pageOf(teams, page, fit);
  const rows = Math.min(fit, teams.length);
  return (
    <section className="mt-[0.9em] flex min-h-0 flex-1 flex-col rounded-[1.4em] bg-surface px-[1.2em] pt-[0.85em] pb-[0.7em] shadow-card">
      <div className="flex shrink-0 items-baseline justify-between gap-[1em]">
        <h2 className="flex items-baseline gap-[0.7em] text-[1.35em] font-extrabold tracking-[-0.02em]">
          Teams
          <span className="text-[0.66em] font-semibold tracking-normal text-gray-500">A leader and everyone under them, added up</span>
        </h2>
        <p className="flex items-center gap-[0.8em] text-[0.9em] font-semibold text-gray-500">
          {sb.range.label} · {teams.length} {teams.length === 1 ? "team" : "teams"}
          <PageDots pages={pages} page={page} />
        </p>
      </div>
      <div className="mt-[0.5em] grid shrink-0 items-end gap-x-[1.2em] border-b border-line pb-[0.3em] text-[0.8em] font-bold tracking-[0.04em] text-gray-500 uppercase" style={{ gridTemplateColumns: COLUMNS }}>
        <p />
        <p>Team</p>
        <p>People</p>
        <p className="text-center">Policies</p>
        <p>Top sellers</p>
        <p className="text-right">Total</p>
      </div>
      <div ref={ref} className="min-h-0 flex-1">
        <ol key={page} className={cn("grid h-full", pages > 1 && "board-page")} style={{ gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))`, maxHeight: `${rows * 7.2}em` }}>
          {shown.map((t) => (
            <TeamRow key={t.leaderId} team={t} top={top} sellers={t.memberIds.map((id) => byId.get(id)).filter((r): r is ScoreRow => r !== undefined).slice(0, 3)} />
          ))}
        </ol>
      </div>
    </section>
  );
}

function TeamRow({ team, top, sellers }: { team: ScoreTeam; top: number; sellers: ScoreRow[] }) {
  return (
    <li data-team={team.leaderId} className="grid min-h-0 items-center gap-x-[1.2em] border-b border-line/60 last:border-b-0" style={{ gridTemplateColumns: COLUMNS }}>
      <PlaceMark place={team.rank} sold={team.totalCents > 0} className="text-[1.5em]" />
      <div className="min-w-0">
        <p className="flex min-w-0 items-center gap-[0.6em]">
          <span className="min-w-0 truncate text-[1.35em] leading-tight font-extrabold tracking-[-0.02em]">
            {team.name}
            {/s$/i.test(team.name.trim()) ? "’" : "’s"} team
          </span>
          {team.rankChange !== null && team.rankChange !== 0 && <ChangeChip change={team.rankChange} className="shrink-0" />}
        </p>
        <div className="mt-[0.4em] h-[0.5em] overflow-hidden rounded-full bg-track">
          <div className="h-full rounded-full bg-tide" style={{ width: `${Math.max(1, Math.round((team.totalCents / top) * 100))}%` }} />
        </div>
      </div>
      <div className="min-w-0 leading-tight">
        <p className="text-[1.15em] font-extrabold whitespace-nowrap">
          <span className="font-mono">{team.members}</span> {team.members === 1 ? "person" : "people"}
        </p>
        <p className="text-[0.95em] font-semibold whitespace-nowrap text-gray-500">
          <span className="font-mono">{team.activeAgents}</span> sold
        </p>
      </div>
      <p className="text-center font-mono text-[1.6em] font-bold tracking-[-0.02em]">{team.policies}</p>
      <ul className="grid min-w-0 grid-cols-3 gap-[0.8em]">
        {sellers.map((s) => (
          <li key={s.agentId} className="flex min-w-0 items-center gap-[0.5em]">
            <Avatar name={s.name} tone={s.tone} size={32} className="!h-[1.9em] !w-[1.9em] !text-[0.72em]" />
            <span className="min-w-0 leading-tight">
              <span className="block truncate text-[0.95em] font-bold">{shortName(s.name)}</span>
              <span className="block font-mono text-[0.95em] font-semibold text-gray-600">{formatDollars(s.totalCents)}</span>
            </span>
          </li>
        ))}
      </ul>
      <p className="text-right font-mono text-[1.75em] font-bold tracking-[-0.03em]">{formatDollars(team.totalCents)}</p>
    </li>
  );
}
