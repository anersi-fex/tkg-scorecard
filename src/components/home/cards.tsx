import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/components/ui";
import { Icon } from "@/components/ui/icon";
import { EmptyState, ListRow, Medal, Panel, RankChip, Rail, StatusPill, btn } from "@/components/ui/kit";
import { formatDollars } from "@/lib/money";
import type { MonthClock } from "@/lib/month";
import type { BoardRow, GroupedRow, ScopeSummary, TeamRow, PipelineStatus } from "@/lib/home-scope";
import s from "./home.module.css";

export { s as homeStyles };

const policies = (n: number) => `${n} ${n === 1 ? "policy" : "policies"}`;
const days = (n: number) => `${n} ${n === 1 ? "day" : "days"}`;

/**
 * Production: the amount, the goal (its rail, the percent, ahead or behind) or "No goal set", and
 * on its own line "On pace for" (owner, 2026-11-12: "what we would be on pace for ... somewhere
 * convenient") with what each business day left needs.
 */
export function ProductionCard({ sum, clock, range, noGoal }: { sum: ScopeSummary; clock: MonthClock; range: string; noGoal: { hide?: boolean; note?: string; setGoalHref?: string } }) {
  const p = sum.pace;
  const hasGoal = sum.goalCents > 0;
  const past = clock.position === "past";
  let goal: ReactNode = null;
  if (hasGoal) {
    const where =
      p.status === "ahead" ? (
        <>
          Ahead by <b className={cn(s.upText, "num")}>{formatDollars(p.aheadCents)}</b>
        </>
      ) : p.status === "behind" ? (
        past ? (
          <>
            Short by <b className={cn(s.downText, "num")}>{formatDollars(sum.goalCents - sum.cents)}</b>
          </>
        ) : (
          <>
            Behind by <b className={cn(s.downText, "num")}>{formatDollars(-p.aheadCents)}</b>
          </>
        )
      ) : p.status === "on" ? (
        <b>On the goal line</b>
      ) : (
        <b className={s.upText}>Goal hit</b>
      );
    goal = (
      <div className={s.prodGoal}>
        <Rail value={sum.pct / 100} label={`${sum.pct}% of the goal`} />
        <div className={s.prodGoalRow}>
          <span>
            <b className="num">{sum.pct}%</b> of <span className="num">{formatDollars(sum.goalCents)}</span> goal
          </span>
          <span>{where}</span>
        </div>
      </div>
    );
  } else if (noGoal.hide) {
    goal = noGoal.note ? (
      <div className={s.noGoal}>
        <span className="muted">{noGoal.note}</span>
      </div>
    ) : null;
  } else {
    goal = (
      <div className={s.noGoal} data-no-goal>
        <span>
          <Icon name="flag" size={15} />
          No goal set
        </span>
        {noGoal.setGoalHref && (
          <Link href={noGoal.setGoalHref} className="link">
            Set a goal
          </Link>
        )}
        {noGoal.note && <span className="muted">{noGoal.note}</span>}
      </div>
    );
  }
  const needed =
    hasGoal && p.status !== "done" && !past ? (
      <div className={s.prodLine}>
        <span className={s.prodK}>{clock.remaining > 0 ? "Needed a day" : "Needed today"}</span>
        <span className={s.prodV}>
          <b className="num">{formatDollars(p.neededPerDayCents)}</b> <span className="muted">{clock.remaining > 0 ? `for ${days(clock.remaining)}` : "today"}</span>
        </span>
      </div>
    ) : null;
  return (
    <section className={cn("card", s.prodCard, s.prod)} aria-label="Production" data-kpi="Production">
      <div className={s.prodHead}>
        <span className="kpi-label">Production</span>
        <span className={cn(s.prodRange, "num")}>{range}</span>
      </div>
      <div className={cn(s.prodBig, "num")} data-production>
        {formatDollars(sum.cents)}
      </div>
      {goal}
      <div className={s.prodLines}>
        <div className={s.prodLine} data-pace>
          <span className={s.prodK}>
            <Icon name="trend-up" size={16} className={s.paceIco} />
            {past ? "Finished at" : "On pace for"}
          </span>
          <b className={cn(s.prodV, s.paceV, "num")}>{formatDollars(past ? sum.cents : p.projectedCents)}</b>
        </div>
        {needed}
      </div>
    </section>
  );
}

/** One of the four small cards. */
function Mini({ label, value, unit, sub }: { label: string; value: ReactNode; unit?: ReactNode; sub: ReactNode }) {
  return (
    <section className={cn("card kpi", s.miniCard)} data-kpi={label}>
      <div className="kpi-top">
        <span className="kpi-label">{label}</span>
      </div>
      <div className="kpi-value num">
        {value}
        {unit != null && <small>{unit}</small>}
      </div>
      <div className="kpi-sub">{sub}</div>
    </section>
  );
}

/** Policies, the average premium a policy (a year), today (or the best day of a finished month), and the rank. */
export function MiniCards({ sum, current, best, rank }: { sum: ScopeSummary; current: boolean; best: { date: string; cents: number } | null; rank: { label: string; value: ReactNode; unit?: ReactNode; sub: ReactNode } }) {
  return (
    <div className={cn(s.miniGrid, s.mini)}>
      <Mini label="Policies" value={String(sum.count)} sub={sum.count ? (current ? "this month" : "that month") : "None yet"} />
      <Mini label="Avg premium" value={sum.count ? formatDollars(sum.avgCents) : "–"} sub={sum.count ? "a policy, per year" : "No policies yet"} />
      {current ? (
        <Mini label="Today" value={formatDollars(sum.todayCents)} sub={sum.todayCount ? `${policies(sum.todayCount)} today` : "No sales yet today"} />
      ) : (
        <Mini label="Best day" value={best ? formatDollars(best.cents) : "–"} sub={best ? best.date : "No sales"} />
      )}
      <Mini label={rank.label} value={rank.value} unit={rank.unit} sub={rank.sub} />
    </div>
  );
}

/** One leaderboard row (the demo's lbRow): rank and arrow, medal, name with "You", policies, the amount, the share bar. */
export function LbRow({ r, rank, me, compact, sub }: { r: BoardRow; rank: number | null; me?: boolean; compact?: boolean; sub?: ReactNode }) {
  const dim = !r.sold;
  return (
    <li className={cn("lb-row", me && "me", dim && "dim", compact && "compact")} data-person={r.id} data-place={rank ?? undefined}>
      <span className="lb-rank">
        <span className="lb-n num">{dim ? "–" : rank}</span>
        <span className="lb-chg">{dim ? null : <RankChip change={r.change} />}</span>
      </span>
      <span className="lb-medal">
        <Medal rank={dim ? 0 : (rank ?? 0)} />
      </span>
      <span className="lb-who">
        <span className="lb-name ell">
          {r.name}
          {me && <span className="you">You</span>}
          {!r.active && <span className="muted"> (off the board)</span>}
        </span>
        <span className="lb-sub ell num">{sub ?? (dim ? "No sale yet" : `${policies(r.policies)}${r.todayCents > 0 ? ` · +${formatDollars(r.todayCents)} today` : ""}`)}</span>
      </span>
      <span className="lb-amt num">{dim ? "—" : formatDollars(r.cents)}</span>
      {!dim && (
        <span className="lb-bar" aria-hidden>
          <i style={{ width: `${Math.max(1.5, Math.min(100, r.share * 100)).toFixed(1)}%` }} />
        </span>
      )}
    </li>
  );
}

/** A long group folds its people without a sale behind "Show everyone" once there are more than a handful. */
const FOLD_AFTER = 10;
const FOLD_AT_LEAST = 4;

/**
 * One group of the leaderboard ("In the office", "Everyone else", or the only list): its sellers,
 * then its people without a sale (folded behind "Show everyone" when the group is long).
 */
export function BoardGroup({ title, rows, meId, compact, noSaleWord, cap }: { title: string | null; rows: GroupedRow[]; meId: string | null; compact?: boolean; noSaleWord: string; cap: number | null }) {
  const quiet = rows.filter((r) => !r.sold);
  const sellers = rows.filter((r) => r.sold);
  const fold = rows.length > FOLD_AFTER && quiet.length >= FOLD_AT_LEAST;
  const head = fold ? sellers : rows;
  const shown = cap !== null && head.length > cap ? head.slice(0, cap) : head;
  const me = meId ? head.find((r) => r.id === meId) : undefined;
  const meHidden = me && !shown.includes(me);
  const row = (r: GroupedRow) => <LbRow key={r.id} r={r} rank={r.groupRank} me={r.id === meId} compact={compact} />;
  return (
    <section className={s.group} data-group={title ?? "all"}>
      {title && (
        <h3 className={s.groupTitle}>
          {title}
          <span className="num">{rows.length}</span>
        </h3>
      )}
      <ol className={cn("lb", compact && "compact", s.lb)}>
        {shown.map(row)}
        {meHidden && (
          <>
            <li className="lb-gap" aria-hidden>
              · · ·
            </li>
            {row(me)}
          </>
        )}
      </ol>
      {fold && cap === null && (
        <details className={s.fold}>
          <summary>
            <span className={s.more}>Show everyone</span>
            <span className={s.less}>Show less</span>
            <span className={s.foldNote}>
              {quiet.length} {noSaleWord}
            </span>
          </summary>
          <ol className={cn("lb", compact && "compact", s.lb)}>{quiet.map(row)}</ol>
        </details>
      )}
    </section>
  );
}

/** The leaderboard card: In the office first, then Everyone else (or one list), a "Show all N" link past ten. */
export function BoardCard({
  title,
  sub,
  groups,
  meId,
  compact,
  current,
  allHref,
  fewerHref,
  showAll,
  people,
}: {
  title: string;
  sub: ReactNode;
  groups: { split: boolean; office: GroupedRow[]; others: GroupedRow[] };
  meId: string | null;
  compact?: boolean;
  current: boolean;
  allHref: string;
  fewerHref: string;
  showAll: boolean;
  people: number;
}) {
  const CAP = 10;
  const longList = groups.office.length + groups.others.length > CAP + 2;
  const cap = showAll || !longList ? null : CAP;
  const noSaleWord = current ? "with no sale yet" : "with no sale";
  const list = groups.split ? (
    <>
      {groups.office.length > 0 && <BoardGroup title="In the office" rows={groups.office} meId={meId} compact={compact} noSaleWord={noSaleWord} cap={cap} />}
      {groups.others.length > 0 && <BoardGroup title="Everyone else" rows={groups.others} meId={meId} compact={compact} noSaleWord={noSaleWord} cap={cap} />}
    </>
  ) : (
    <BoardGroup title={null} rows={groups.others} meId={meId} compact={compact} noSaleWord={noSaleWord} cap={cap} />
  );
  const foot = cap !== null ? (
    <Link href={allHref} scroll={false} className={btn("quiet", "sm")} data-board-all>
      <span>Show all {people}</span>
      <Icon name="chevron-down" size={16} />
    </Link>
  ) : showAll && longList ? (
    <Link href={fewerHref} scroll={false} className={btn("ghost", "sm")}>
      <span>Show fewer</span>
      <Icon name="chevron-up" size={16} />
    </Link>
  ) : null;
  return (
    <Panel title={title} sub={sub} className={s.board} data-leaderboard-home>
      {people === 0 ? <EmptyState title="Nobody on the board yet" body="People show up here once they join." /> : list}
      {foot && <div className={cn("card-foot", s.boardFoot)}>{foot}</div>}
    </Panel>
  );
}

/** "Around you": seven rows of the agency's board around the viewer, and the way to the whole board. */
export function AroundCard({ rows, meId, sub }: { rows: BoardRow[]; meId: string; sub: ReactNode }) {
  return (
    <Panel
      title="Around you"
      sub={sub}
      className={s.board}
      foot={
        <Link href="/scoreboard" className="link">
          See the whole board on the Scoreboard
        </Link>
      }
    >
      <section data-group="around">
        <ol className={cn("lb", s.lb)}>
          {rows.map((r) => (
            <LbRow key={r.id} r={r} rank={r.rank} me={r.id === meId} />
          ))}
        </ol>
      </section>
    </Panel>
  );
}

/** The month so far: the scope's running total against its goal line. */
export function ChartCard({ title, goal, children }: { title: string; goal: boolean; children: ReactNode }) {
  return (
    <Panel
      title="The month so far"
      sub={title}
      className={s.chart}
      right={
        <span className={s.legend}>
          <span>
            <i className={s.lgLine} />
            Production
          </span>
          {goal && (
            <span>
              <i className={s.lgGoal} />
              Goal line
            </span>
          )}
        </span>
      }
    >
      {children}
    </Panel>
  );
}

/** The pipeline: each status's policies this month and their premium, a tap opens them in Policies. */
export function PipelineCard({ title, total, rows, hrefFor, allHref }: { title: string; total: number; rows: Array<{ status: PipelineStatus; count: number; cents: number }>; hrefFor: (status: PipelineStatus) => string; allHref: string }) {
  return (
    <Panel
      title={title}
      sub={`${policies(total)} · tap a status to see them`}
      className={s.pipe}
      data-pipeline
      right={
        <Link href={allHref} className="link">
          All
        </Link>
      }
    >
      <div className="list">
        {rows.map((r) => (
          <ListRow
            key={r.status}
            href={hrefFor(r.status)}
            className={cn(s.pipeRow, !r.count && s.zero)}
            lead={<StatusPill status={r.status} />}
            title=""
            trail={
              <span className={s.pipeRight}>
                <span className={cn(s.pipeN, "num")}>{r.count}</span>
                <span className={cn(s.pipeC, "num")}>{r.count ? formatDollars(r.cents) : "—"}</span>
              </span>
            }
            chevron
          />
        ))}
      </div>
    </Panel>
  );
}

/** "Coming up" (Me): policies taking effect this week, and underwriting past 5 days. */
export function ComingCard({ items }: { items: Array<{ id: string; title: string; sub: string; warn: boolean }> }) {
  const shown = items.slice(0, 6);
  return (
    <Panel title="Coming up" sub="Your policies taking effect this week, and underwriting past 5 days" className={s.coming}>
      {shown.length ? (
        <>
          <div className="list">
            {shown.map((it) => (
              <ListRow
                key={`${it.id}-${it.warn ? "u" : "e"}`}
                href={`/policies/${it.id}`}
                lead={<span className={cn(s.cuIco, it.warn && s.warn)}>{<Icon name={it.warn ? "clock" : "calendar"} size={16} />}</span>}
                title={it.title}
                sub={it.sub}
                chevron
                wrap
              />
            ))}
          </div>
          {items.length > 6 && <div className="card-more muted small">and {items.length - 6} more</div>}
        </>
      ) : (
        <EmptyState title="Nothing coming up this week" />
      )}
    </Panel>
  );
}

/** Teams (Agency): each leader with everyone under them, the first six. */
export function TeamsCard({ teams }: { teams: TeamRow[] }) {
  return (
    <Panel title="Teams" sub="Each leader with everyone under them" className={s.teams} data-teams-home>
      {teams.length ? (
        <ol className={cn("lb", s.lb)}>
          {teams.slice(0, 6).map((t) => (
            <li key={t.leaderId} className="lb-row" data-team={t.leaderId}>
              <span className="lb-rank">
                <span className="lb-n num">{t.rank}</span>
                <span className="lb-chg">
                  <RankChip change={t.change} />
                </span>
              </span>
              <span className="lb-medal">
                <Medal rank={t.rank} />
              </span>
              <span className="lb-who">
                <span className="lb-name wrap-text">{t.name}</span>
                <span className="lb-sub wrap-text num">
                  {t.members} {t.members === 1 ? "person" : "people"} · {t.sellers} sold
                </span>
              </span>
              <span className="lb-amt num">{formatDollars(t.cents)}</span>
              <span className="lb-bar" aria-hidden>
                <i style={{ width: `${Math.max(1.5, Math.min(100, t.share * 100)).toFixed(1)}%` }} />
              </span>
            </li>
          ))}
        </ol>
      ) : (
        <EmptyState title="No team has a sale yet" />
      )}
    </Panel>
  );
}

/** Me with no sale yet this month. */
export function EmptyMe({ current }: { current: boolean }) {
  return (
    <section className={cn("card", s.emptyMe, s.chart)}>
      <EmptyState
        icon="star"
        title={current ? "No sales yet this month." : "No sales that month."}
        body={current ? "Your first sale puts you on the board, and your policies show up here with what's coming up." : undefined}
        action={
          current ? (
            <Link href="/log" className={btn("primary")}>
              <Icon name="plus" size={18} />
              <span>Log a sale</span>
            </Link>
          ) : undefined
        }
      />
    </section>
  );
}
