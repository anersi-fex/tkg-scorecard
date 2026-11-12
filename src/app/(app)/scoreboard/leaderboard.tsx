"use client";

import Link from "next/link";
import { Fragment, useState } from "react";
import type { ScoreRow, ScoreTeam } from "@/lib/scoreboard-types";
import { formatDollars } from "@/lib/money";
import { cn } from "@/components/ui";
import { ChangeChip, OfficeDot, PlaceIcon } from "./parts";
import { useSearch } from "./search";

/**
 * The production leaderboard: a real table on a computer (Name and Total stay put while the days
 * scroll sideways, every header sorts), compact blocks on a phone. Agents, or teams that open to
 * show their people. The search box filters it as you type; nothing here asks the server.
 */

export interface Column {
  key: string;
  label: string;
}

type Field = "byDay" | "byProduct" | "byCarrier";

interface Sort {
  /** "total", "name", "policies", or "c:<column key>". */
  key: string;
  desc: boolean;
}

interface Props {
  who: "agents" | "teams";
  field: Field;
  columns: Column[];
  rows: ScoreRow[];
  teams: ScoreTeam[];
  /** Shown under someone with no upline. */
  agencyName: string;
  /** The team the page is narrowed to, if any: links to it would go nowhere new. */
  scopeLeaderId: string | null;
  /** What follows "/scoreboard?team=<id>", so a team link keeps the month and the view. */
  linkTail: string;
  emptyLine: string;
}

interface Sortable {
  name: string;
  policies: number;
  totalCents: number;
  rank: number;
}

function sorted<T extends Sortable>(items: T[], sort: Sort, by: (t: T) => Record<string, number>): T[] {
  const value = (t: T): number | string => (sort.key === "name" ? t.name : sort.key === "policies" ? t.policies : sort.key === "total" ? t.totalCents : (by(t)[sort.key.slice(2)] ?? 0));
  return [...items].sort((a, b) => {
    const x = value(a);
    const y = value(b);
    const c = typeof x === "string" ? x.localeCompare(String(y)) : x - Number(y);
    return (sort.desc ? -c : c) || a.rank - b.rank;
  });
}

const money = (cents: number | undefined) => (cents ? formatDollars(cents) : "—");
const policiesWord = (n: number) => `${n} ${n === 1 ? "policy" : "policies"}`;

function SortIcon({ on, desc }: { on: boolean; desc: boolean }) {
  return (
    <svg viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden className={cn("shrink-0", on ? "text-gray-900" : "text-gray-400")}>
      {on ? desc ? <path d="M8 3v10M4 9l4 4 4-4" /> : <path d="M8 13V3M4 7l4-4 4 4" /> : <path d="M5 3v10M2.5 10.5 5 13l2.5-2.5M11 13V3M8.5 5.5 11 3l2.5 2.5" />}
    </svg>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden className={cn("shrink-0 transition-transform", open && "rotate-90")}>
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}

const TH = "sticky top-0 z-20 border-b border-line bg-surface-2 px-2.5 py-0 text-[12px] font-bold whitespace-nowrap text-gray-600";
const TD = "border-b border-line px-2.5 py-1 text-right font-mono text-[13px] whitespace-nowrap text-gray-900";

export function Leaderboard({ who, field, columns, rows, teams, agencyName, scopeLeaderId, linkTail, emptyLine }: Props) {
  const { q } = useSearch();
  const [picked, setSort] = useState<Sort>({ key: "total", desc: true });
  const [opened, setOpened] = useState<string[]>([]);
  // The sort in use. A sort by a day, a product or a carrier is left behind when the columns or
  // the month change (this stays mounted): a column that is gone means Total, highest first.
  const sort: Sort = picked.key.startsWith("c:") && !columns.some((c) => `c:${c.key}` === picked.key) ? { key: "total", desc: true } : picked;

  // What a row shows is what finds it: a name, "<leader>'s team", the agency's name. An iPhone
  // types a curly apostrophe, the rows are compared with a straight one.
  const norm = (text: string) => text.toLowerCase().replace(/[‘’ʼ`´]/g, "'");
  const needle = norm(q.trim());
  const hit = (text: string | null | undefined) => !!text && norm(text).includes(needle);
  const rowById = new Map(rows.map((r) => [r.agentId, r]));
  const leaderIds = new Set(teams.map((t) => t.leaderId));
  const leadCents = Math.max(1, ...rows.map((r) => r.totalCents));
  const leadTeamCents = Math.max(1, ...teams.map((t) => t.totalCents));
  const share = (cents: number, lead: number) => Math.max(2, Math.min(100, Math.round((cents / lead) * 100)));

  const onSort = (key: string) => setSort(sort.key === key ? { key, desc: !sort.desc } : { key, desc: key !== "name" });
  const toggle = (id: string) => setOpened((list) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]));
  const teamHref = (id: string) => `/scoreboard?team=${id}${linkTail}`;
  /** The team a tap on this person narrows to: their own when they lead one, else their upline's. */
  const teamOf = (r: ScoreRow): string | null => {
    const id = leaderIds.has(r.agentId) ? r.agentId : r.uplineId;
    return id && id !== scopeLeaderId ? id : null;
  };

  const shownRows = sorted(needle ? rows.filter((r) => hit(r.name) || hit(r.uplineName ? `${r.uplineName}'s team` : agencyName)) : rows, sort, (r) => r[field]);
  const shownTeams = sorted(needle ? teams.filter((t) => hit(`${t.name}'s team`) || t.memberIds.some((id) => hit(rowById.get(id)?.name))) : teams, sort, (t) => t[field]);
  const count = who === "teams" ? teams.length : rows.length;
  const shown = who === "teams" ? shownTeams.length : shownRows.length;

  // Nobody sold: the page's own line for the month. People sold but no team did: say only that.
  if (count === 0) return <p className="border-t border-line px-4 py-6 text-[14px] text-gray-600">{who === "teams" && rows.length > 0 ? "No teams here." : emptyLine}</p>;

  const nameLink = (r: ScoreRow, className: string) => {
    const id = teamOf(r);
    return id ? (
      <Link href={teamHref(id)} className={cn("hover:underline", className)}>
        {r.name}
      </Link>
    ) : (
      <span className={className}>{r.name}</span>
    );
  };
  /** The small line under a name. On the table it links to that team; a phone block keeps one link, the name (two links 5px apart, to different teams, were too easy to miss). */
  const uplineLine = (r: ScoreRow, link = true) =>
    link && r.uplineName && r.uplineId && r.uplineId !== scopeLeaderId ? (
      <Link href={teamHref(r.uplineId)} className="hover:underline">
        {r.uplineName}&rsquo;s team
      </Link>
    ) : r.uplineName ? (
      <>{r.uplineName}&rsquo;s team</>
    ) : (
      agencyName
    );

  // The Name column: a little wider for teams, whose rows also hold the chevron and "…'s team".
  const nameWidth = who === "teams" ? "w-[276px] lg:w-[300px]" : "w-[248px] lg:w-[272px]";

  /** One person's table row; `inside` marks a row opened under its team. */
  const agentRow = (r: ScoreRow, inside: boolean) => (
    <tr key={`${inside ? "in" : "a"}-${r.agentId}`} data-agent={r.agentId} className="group">
      <td className={cn("sticky left-0 z-10 border-r border-b border-line p-0", inside ? "bg-surface-2" : "bg-surface")}>
        <div className={cn("relative flex h-10 items-center gap-1.5 pr-2", nameWidth, inside ? "pl-7" : "pl-2")}>
          <span aria-hidden className="absolute inset-y-1 left-0 rounded-r-lg bg-tint" style={{ width: `${share(r.totalCents, leadCents)}%` }} />
          <span className="relative w-6 shrink-0 text-right font-mono text-[13px] font-bold text-gray-600">{r.rank}</span>
          <ChangeChip change={r.rankChange} className="relative w-10" />
          <PlaceIcon place={r.rank} className="relative" />
          <div className="relative min-w-0 flex-1 leading-tight">
            <p className="flex items-center gap-1.5">
              {nameLink(r, "truncate text-[13px] font-bold text-gray-900")}
              {r.inOffice && <OfficeDot />}
            </p>
            <p className="truncate text-[11px] font-medium text-gray-500">{uplineLine(r)}</p>
          </div>
        </div>
      </td>
      <td className={cn(TD, inside && "bg-surface-2")}>{r.policies}</td>
      {columns.map((c) => (
        <td key={c.key} className={cn(TD, inside && "bg-surface-2", !r[field][c.key] && "text-gray-400")}>
          {money(r[field][c.key])}
        </td>
      ))}
      <td className={cn(TD, "sticky right-0 z-10 border-l font-bold", inside ? "bg-surface-2" : "bg-surface")}>{formatDollars(r.totalCents)}</td>
    </tr>
  );

  /** One person's block on a phone. */
  const agentBlock = (r: ScoreRow, inside: boolean) => {
    const pairs = columns.filter((c) => r[field][c.key]);
    return (
      <li key={`${inside ? "in" : "a"}-${r.agentId}`} data-agent={r.agentId} className={cn("border-t border-line py-2.5 pr-4", inside ? "bg-surface-2 pl-9" : "pl-4")}>
        <div className="flex gap-2.5">
          <div className="flex w-9 shrink-0 flex-col items-center gap-1 pt-0.5">
            <span className="font-mono text-[15px] leading-none font-bold text-gray-600">{r.rank}</span>
            <ChangeChip change={r.rankChange} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline justify-between gap-3">
              <p className="flex min-w-0 items-center gap-1.5">
                {r.rank <= 3 && <PlaceIcon place={r.rank} className="self-center" />}
                {nameLink(r, "-my-3 truncate py-3 text-[15px] leading-tight font-bold text-gray-900")}
                {r.inOffice && <OfficeDot />}
              </p>
              <p className="shrink-0 font-mono text-[16px] leading-tight font-bold text-gray-900">{formatDollars(r.totalCents)}</p>
            </div>
            <p className="truncate text-[12px] font-medium text-gray-500">
              {policiesWord(r.policies)} · {uplineLine(r, false)}
            </p>
            {pairs.length > 0 && (
              <p className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[12px] text-gray-500">
                {pairs.map((c) => (
                  <span key={c.key} className="whitespace-nowrap">
                    {c.label} <span className="font-mono font-semibold text-gray-800">{formatDollars(r[field][c.key])}</span>
                  </span>
                ))}
              </p>
            )}
          </div>
        </div>
        <div aria-hidden className="mt-2 h-1 rounded-full bg-bar" style={{ width: `${share(r.totalCents, leadCents)}%` }} />
      </li>
    );
  };

  const teamPeople = (t: ScoreTeam) => t.memberIds.map((id) => rowById.get(id)).filter((r): r is ScoreRow => !!r);
  const isOpen = (t: ScoreTeam) => opened.includes(t.leaderId);
  const teamSmall = (t: ScoreTeam) => `${t.members} ${t.members === 1 ? "person" : "people"} · ${t.activeAgents} sold`;
  const teamName = (t: ScoreTeam, className: string) =>
    t.leaderId !== scopeLeaderId ? (
      <Link href={teamHref(t.leaderId)} className={cn("hover:underline", className)}>
        {t.name}&rsquo;s team
      </Link>
    ) : (
      <span className={className}>{t.name}&rsquo;s team</span>
    );

  const th = (key: string, label: string, extra?: string) => (
    <th key={key} scope="col" aria-sort={sort.key === key ? (sort.desc ? "descending" : "ascending") : "none"} className={cn(TH, extra)}>
      <button type="button" onClick={() => onSort(key)} className={cn("inline-flex h-9 items-center gap-1 hover:text-gray-900", sort.key === key && "text-gray-900")}>
        {label}
        <SortIcon on={sort.key === key} desc={sort.desc} />
      </button>
    </th>
  );

  return (
    <div data-leaderboard={who}>
      {shown === 0 && <p className="border-t border-line px-4 py-6 text-[14px] text-gray-600">Nobody matches &ldquo;{q.trim()}&rdquo;.</p>}

      {/* A computer: the table */}
      {shown > 0 && (
        <div className="hidden max-h-[min(78vh,900px)] overflow-auto overscroll-x-contain border-t border-line md:block">
          <table className="w-full border-separate border-spacing-0">
            <thead>
              <tr>
                {th("name", "Name", "left-0 z-30 border-r pl-3 text-left")}
                {th("policies", "Policies", "text-right")}
                {columns.map((c) => th(`c:${c.key}`, c.label, "min-w-[68px] text-right"))}
                {th("total", "Total", "right-0 z-30 border-l text-right")}
              </tr>
            </thead>
            <tbody>
              {who === "agents" && shownRows.map((r) => agentRow(r, false))}
              {who === "teams" &&
                shownTeams.map((t) => (
                  <Fragment key={t.leaderId}>
                    <tr data-team={t.leaderId}>
                      <td className="sticky left-0 z-10 border-r border-b border-line bg-surface p-0">
                        <div className={cn("relative flex h-10 items-center gap-1.5 pr-2 pl-1", nameWidth)}>
                          <span aria-hidden className="absolute inset-y-1 left-0 rounded-r-lg bg-tint" style={{ width: `${share(t.totalCents, leadTeamCents)}%` }} />
                          <button type="button" onClick={() => toggle(t.leaderId)} aria-expanded={isOpen(t)} aria-label={`${isOpen(t) ? "Hide" : "Show"} the people on ${t.name}'s team`} className="relative flex h-8 w-7 shrink-0 items-center justify-center rounded-lg text-gray-600 hover:bg-gray-100">
                            <Chevron open={isOpen(t)} />
                          </button>
                          <span className="relative w-5 shrink-0 text-right font-mono text-[13px] font-bold text-gray-600">{t.rank}</span>
                          <ChangeChip change={t.rankChange} className="relative w-10" />
                          <PlaceIcon place={t.rank} className="relative" />
                          <div className="relative min-w-0 flex-1 leading-tight">
                            <p className="flex">{teamName(t, "truncate text-[13px] font-bold text-gray-900")}</p>
                            <p className="truncate text-[11px] font-medium text-gray-500">{teamSmall(t)}</p>
                          </div>
                        </div>
                      </td>
                      <td className={TD}>{t.policies}</td>
                      {columns.map((c) => (
                        <td key={c.key} className={cn(TD, !t[field][c.key] && "text-gray-400")}>
                          {money(t[field][c.key])}
                        </td>
                      ))}
                      <td className={cn(TD, "sticky right-0 z-10 border-l bg-surface font-bold")}>{formatDollars(t.totalCents)}</td>
                    </tr>
                    {isOpen(t) && teamPeople(t).map((r) => agentRow(r, true))}
                  </Fragment>
                ))}
            </tbody>
          </table>
        </div>
      )}

      {/* A phone: sort, then one block each */}
      {shown > 0 && (
        <div className="md:hidden">
          <div className="flex items-center gap-2 px-4 pb-3">
            <label htmlFor="scoreboard-sort" className="shrink-0 text-[13px] font-semibold text-gray-500">
              Sort by
            </label>
            <select
              id="scoreboard-sort"
              value={sort.key}
              onChange={(e) => setSort({ key: e.target.value, desc: e.target.value !== "name" })}
              className="h-11 min-w-0 flex-1 rounded-xl border border-line bg-surface-2 px-3 text-[14px] font-bold text-gray-900 focus:border-accent focus:outline-none"
            >
              <option value="total">Total</option>
              <option value="policies">Policies</option>
              <option value="name">Name</option>
              {columns.map((c) => (
                <option key={c.key} value={`c:${c.key}`}>
                  {c.label}
                </option>
              ))}
            </select>
            <button type="button" onClick={() => setSort({ ...sort, desc: !sort.desc })} aria-label={sort.desc ? "Highest first. Tap for lowest first" : "Lowest first. Tap for highest first"} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-line bg-surface-2 text-gray-700">
              <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                {sort.desc ? <path d="M8 3v10M4 9l4 4 4-4" /> : <path d="M8 13V3M4 7l4-4 4 4" />}
              </svg>
            </button>
          </div>
          <ul>
            {who === "agents" && shownRows.map((r) => agentBlock(r, false))}
            {who === "teams" &&
              shownTeams.map((t) => {
                const pairs = columns.filter((c) => t[field][c.key]);
                return (
                  <Fragment key={t.leaderId}>
                    <li data-team={t.leaderId} className="border-t border-line py-2.5 pr-4 pl-4">
                      <div className="flex gap-2.5">
                        <div className="flex w-9 shrink-0 flex-col items-center gap-1 pt-0.5">
                          <span className="font-mono text-[15px] leading-none font-bold text-gray-600">{t.rank}</span>
                          <ChangeChip change={t.rankChange} />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-baseline justify-between gap-3">
                            <p className="flex min-w-0 items-center gap-1.5">
                              {t.rank <= 3 && <PlaceIcon place={t.rank} className="self-center" />}
                              {teamName(t, "-my-3 truncate py-3 text-[15px] leading-tight font-bold text-gray-900")}
                            </p>
                            <p className="shrink-0 font-mono text-[16px] leading-tight font-bold text-gray-900">{formatDollars(t.totalCents)}</p>
                          </div>
                          <p className="truncate text-[12px] font-medium text-gray-500">
                            {policiesWord(t.policies)} · {teamSmall(t)}
                          </p>
                          {pairs.length > 0 && (
                            <p className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[12px] text-gray-500">
                              {pairs.map((c) => (
                                <span key={c.key} className="whitespace-nowrap">
                                  {c.label} <span className="font-mono font-semibold text-gray-800">{formatDollars(t[field][c.key])}</span>
                                </span>
                              ))}
                            </p>
                          )}
                        </div>
                      </div>
                      <div className="mt-2 flex items-center gap-3">
                        <div aria-hidden className="h-1 min-w-0 flex-1">
                          <div className="h-1 rounded-full bg-bar" style={{ width: `${share(t.totalCents, leadTeamCents)}%` }} />
                        </div>
                        <button type="button" onClick={() => toggle(t.leaderId)} aria-expanded={isOpen(t)} className="-my-2.5 flex h-11 shrink-0 items-center gap-1 rounded-lg pl-2 text-[13px] font-bold text-accent-text">
                          {isOpen(t) ? "Hide people" : "Show people"}
                          <Chevron open={isOpen(t)} />
                        </button>
                      </div>
                    </li>
                    {isOpen(t) && teamPeople(t).map((r) => agentBlock(r, true))}
                  </Fragment>
                );
              })}
          </ul>
        </div>
      )}
    </div>
  );
}
