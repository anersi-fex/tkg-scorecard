"use client";

import Link from "next/link";
import { Fragment, useEffect, useRef, useState } from "react";
import type { ScoreRow, ScoreTeam } from "@/lib/scoreboard-types";
import { formatDollars } from "@/lib/money";
import { cn } from "@/components/ui";
import { Icon } from "@/components/ui/icon";
import { Medal, RankChip } from "@/components/ui/kit";
import { OfficeDot } from "./parts";
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
  /** Nobody on the board has an upline yet, so there are no teams to show: Teams says how to make them. */
  noUplines?: boolean;
  /** The viewer's own row carries a "You" tag. */
  me?: string | null;
  /** The Dates table opens on its newest days (Name, Policies and Total stay put). */
  scrollEnd?: boolean;
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

const money = (cents: number | undefined) => (cents ? formatDollars(cents) : null);
const policiesWord = (n: number) => `${n} ${n === 1 ? "policy" : "policies"}`;
const share = (cents: number, lead: number) => Math.max(3, Math.min(100, Math.round((cents / lead) * 100)));

function SortIcon({ on, desc }: { on: boolean; desc: boolean }) {
  return <Icon name={on ? (desc ? "sort-down" : "sort-up") : "sort"} size={14} className={on ? "text-fg" : "text-fg-3"} />;
}

export function Leaderboard({ who, field, columns, rows, teams, agencyName, scopeLeaderId, linkTail, emptyLine, noUplines = false, me = null, scrollEnd = false }: Props) {
  const { q } = useSearch();
  const [picked, setSort] = useState<Sort>({ key: "total", desc: true });
  const [opened, setOpened] = useState<string[]>([]);
  const box = useRef<HTMLDivElement | null>(null);
  // The sort in use. A sort by a day, a product or a carrier is left behind when the columns or
  // the month change (this stays mounted): a column that is gone means Total, highest first.
  const sort: Sort = picked.key.startsWith("c:") && !columns.some((c) => `c:${c.key}` === picked.key) ? { key: "total", desc: true } : picked;
  const columnKeys = columns.map((c) => c.key).join("|");
  // Dates opens on its newest days, the way the agency's CRM does.
  useEffect(() => {
    const el = box.current;
    if (el) el.scrollLeft = scrollEnd ? el.scrollWidth : 0;
  }, [scrollEnd, columnKeys, who]);

  // What a row shows is what finds it: a name, "<leader>'s team", the agency's name. An iPhone
  // types a curly apostrophe, the rows are compared with a straight one.
  const norm = (text: string) => text.toLowerCase().replace(/[‘’ʼ`´]/g, "'");
  const needle = norm(q.trim());
  const hit = (text: string | null | undefined) => !!text && norm(text).includes(needle);
  const rowById = new Map(rows.map((r) => [r.agentId, r]));
  const leaderIds = new Set(teams.map((t) => t.leaderId));
  const leadCents = Math.max(1, ...rows.map((r) => r.totalCents));
  const leadTeamCents = Math.max(1, ...teams.map((t) => t.totalCents));

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
  // Teams before anyone has an upline: uplines make teams, so say where to set them.
  if (count === 0) {
    return (
      <p data-empty={who === "teams" && noUplines ? "no-uplines" : undefined} className="sb-pempty">
        {who === "teams" && noUplines ? "Teams show here once people have an upline. Set uplines on the People page." : who === "teams" && rows.length > 0 ? "No teams here." : emptyLine}
      </p>
    );
  }

  const nameLink = (r: ScoreRow) => {
    const id = teamOf(r);
    return id ? (
      <Link href={teamHref(id)} className="ell">
        {r.name}
      </Link>
    ) : (
      <span className="ell">{r.name}</span>
    );
  };
  /** The small line under a name. On the table it links to that team; a phone block keeps one link, the name. */
  const uplineLine = (r: ScoreRow, link = true) =>
    link && r.uplineName && r.uplineId && r.uplineId !== scopeLeaderId ? (
      <Link href={teamHref(r.uplineId)}>{r.uplineName}&rsquo;s team</Link>
    ) : r.uplineName ? (
      <>{r.uplineName}&rsquo;s team</>
    ) : (
      agencyName
    );
  const you = (id: string) => (me && id === me ? <span className="you">You</span> : null);

  /** One person's table row; `inside` marks a row opened under its team. */
  const agentRow = (r: ScoreRow, inside: boolean) => (
    <tr key={`${inside ? "in" : "a"}-${r.agentId}`} data-agent={r.agentId} className={inside ? "in" : undefined}>
      <td className="sb-td-name">
        <div className={cn("sb-nc", inside && "sb-nc-in")}>
          <span aria-hidden className="sb-nc-bar" style={{ width: `${share(r.totalCents, leadCents)}%` }} />
          <span className="sb-nc-rank">{r.rank}</span>
          <span className="sb-nc-chg">
            <RankChip change={r.rankChange} />
          </span>
          <Medal rank={r.rank} size={16} />
          <span className="sb-nc-who">
            <span className="sb-nc-name">
              {nameLink(r)}
              {r.inOffice && <OfficeDot />}
              {you(r.agentId)}
            </span>
            <span className="sb-nc-sub">{uplineLine(r)}</span>
          </span>
        </div>
      </td>
      <td className="sb-td-pol">{r.policies}</td>
      {columns.map((c) => (
        <td key={c.key}>{money(r[field][c.key]) ?? <span className="sb-nil">—</span>}</td>
      ))}
      <td className="sb-td-total">
        <span className="sb-total">{formatDollars(r.totalCents)}</span>
      </td>
    </tr>
  );

  /** One person's block on a phone. */
  const agentBlock = (r: ScoreRow, inside: boolean) => {
    const pairs = columns.filter((c) => r[field][c.key]);
    return (
      <li key={`${inside ? "in" : "a"}-${r.agentId}`} data-agent={r.agentId} className={cn("sb-pr", inside && "in")}>
        <div className="sb-pr-rk">
          <span className="sb-pr-n">{r.rank}</span>
          <RankChip change={r.rankChange} />
        </div>
        <div className="sb-pr-main">
          <div className="sb-pr-top">
            <span className="sb-pr-name">
              {r.rank <= 3 && <Medal rank={r.rank} size={16} />}
              {nameLink(r)}
              {r.inOffice && <OfficeDot />}
              {you(r.agentId)}
            </span>
            <span className="sb-pr-amt">{formatDollars(r.totalCents)}</span>
          </div>
          <div className="sb-pr-sub">
            {policiesWord(r.policies)} · {uplineLine(r, false)}
          </div>
          {pairs.length > 0 && (
            <div className="sb-pr-pairs">
              {pairs.map((c) => (
                <span key={c.key}>
                  {c.label} <b className="num">{formatDollars(r[field][c.key])}</b>
                </span>
              ))}
            </div>
          )}
          <span aria-hidden className="sb-pr-bar">
            <i style={{ width: `${share(r.totalCents, leadCents)}%` }} />
          </span>
        </div>
      </li>
    );
  };

  const teamPeople = (t: ScoreTeam) => t.memberIds.map((id) => rowById.get(id)).filter((r): r is ScoreRow => !!r);
  const isOpen = (t: ScoreTeam) => opened.includes(t.leaderId);
  const teamSmall = (t: ScoreTeam) => `${t.members} ${t.members === 1 ? "person" : "people"} · ${t.activeAgents} sold`;
  const teamName = (t: ScoreTeam) =>
    t.leaderId !== scopeLeaderId ? (
      <Link href={teamHref(t.leaderId)} className="ell">
        {t.name}&rsquo;s team
      </Link>
    ) : (
      <span className="ell">{t.name}&rsquo;s team</span>
    );

  const th = (key: string, label: string, className?: string) => (
    <th key={key} scope="col" aria-sort={sort.key === key ? (sort.desc ? "descending" : "ascending") : "none"} className={className}>
      <button type="button" onClick={() => onSort(key)}>
        {label}
        <SortIcon on={sort.key === key} desc={sort.desc} />
      </button>
    </th>
  );

  return (
    <div data-leaderboard={who}>
      {shown === 0 && <p className="sb-pempty">Nobody matches &ldquo;{q.trim()}&rdquo;.</p>}

      {/* A computer: the table */}
      {shown > 0 && (
        <div ref={box} className={cn("sb-tbl sb-only-wide", who === "teams" && "sb-tbl-teams")}>
          <table>
            <thead>
              <tr>
                {th("name", who === "teams" ? "Team" : "Name", "sb-th-name")}
                {th("policies", "Policies", "sb-th-pol")}
                {columns.map((c) => th(`c:${c.key}`, c.label, "sb-th-col"))}
                {th("total", "Total", "sb-th-total")}
              </tr>
            </thead>
            <tbody>
              {who === "agents" && shownRows.map((r) => agentRow(r, false))}
              {who === "teams" &&
                shownTeams.map((t) => (
                  <Fragment key={t.leaderId}>
                    <tr data-team={t.leaderId}>
                      <td className="sb-td-name">
                        <div className="sb-nc sb-nc-team">
                          <span aria-hidden className="sb-nc-bar" style={{ width: `${share(t.totalCents, leadTeamCents)}%` }} />
                          <button type="button" onClick={() => toggle(t.leaderId)} aria-expanded={isOpen(t)} aria-label={`${isOpen(t) ? "Hide" : "Show"} the people on ${t.name}'s team`} className="sb-open">
                            <Icon name="chevron-right" size={15} stroke={2.2} />
                          </button>
                          <span className="sb-nc-rank">{t.rank}</span>
                          <span className="sb-nc-chg">
                            <RankChip change={t.rankChange} />
                          </span>
                          <Medal rank={t.rank} size={16} />
                          <span className="sb-nc-who">
                            <span className="sb-nc-name">{teamName(t)}</span>
                            <span className="sb-nc-sub">{teamSmall(t)}</span>
                          </span>
                        </div>
                      </td>
                      <td className="sb-td-pol">{t.policies}</td>
                      {columns.map((c) => (
                        <td key={c.key}>{money(t[field][c.key]) ?? <span className="sb-nil">—</span>}</td>
                      ))}
                      <td className="sb-td-total">
                        <span className="sb-total">{formatDollars(t.totalCents)}</span>
                      </td>
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
        <div className="sb-only-phone">
          <div className="sb-psort">
            <label htmlFor="scoreboard-sort" className="sb-psort-l">
              Sort by
            </label>
            <span className="select-wrap">
              <select id="scoreboard-sort" value={sort.key} onChange={(e) => setSort({ key: e.target.value, desc: e.target.value !== "name" })} className="input select">
                <option value="total">Total</option>
                <option value="policies">Policies</option>
                <option value="name">Name</option>
                {columns.map((c) => (
                  <option key={c.key} value={`c:${c.key}`}>
                    {c.label}
                  </option>
                ))}
              </select>
              <span className="select-chev" aria-hidden>
                <Icon name="chevron-down" size={16} />
              </span>
            </span>
            <button type="button" onClick={() => setSort({ ...sort, desc: !sort.desc })} aria-label={sort.desc ? "Highest first. Tap for lowest first" : "Lowest first. Tap for highest first"} className="btn btn-secondary sb-psort-dir">
              <Icon name={sort.desc ? "arrow-down" : "arrow-up"} size={17} />
            </button>
          </div>
          <ul className="sb-plist">
            {who === "agents" && shownRows.map((r) => agentBlock(r, false))}
            {who === "teams" &&
              shownTeams.map((t) => {
                const pairs = columns.filter((c) => t[field][c.key]);
                return (
                  <Fragment key={t.leaderId}>
                    <li data-team={t.leaderId} className="sb-pr">
                      <div className="sb-pr-rk">
                        <span className="sb-pr-n">{t.rank}</span>
                        <RankChip change={t.rankChange} />
                      </div>
                      <div className="sb-pr-main">
                        <div className="sb-pr-top">
                          <span className="sb-pr-name">
                            {t.rank <= 3 && <Medal rank={t.rank} size={16} />}
                            {teamName(t)}
                          </span>
                          <span className="sb-pr-amt">{formatDollars(t.totalCents)}</span>
                        </div>
                        <div className="sb-pr-sub">
                          {policiesWord(t.policies)} · {teamSmall(t)}
                        </div>
                        {pairs.length > 0 && (
                          <div className="sb-pr-pairs">
                            {pairs.map((c) => (
                              <span key={c.key}>
                                {c.label} <b className="num">{formatDollars(t[field][c.key])}</b>
                              </span>
                            ))}
                          </div>
                        )}
                        <div className="sb-pr-foot">
                          <span aria-hidden className="sb-pr-bar">
                            <i style={{ width: `${share(t.totalCents, leadTeamCents)}%` }} />
                          </span>
                          <button type="button" onClick={() => toggle(t.leaderId)} aria-expanded={isOpen(t)} className="sb-pr-open">
                            {isOpen(t) ? "Hide people" : "Show people"}
                            <Icon name={isOpen(t) ? "chevron-up" : "chevron-down"} size={15} />
                          </button>
                        </div>
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
