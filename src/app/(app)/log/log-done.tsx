import { getPolicyFor } from "@/lib/policies";
import { loadMonthSnapshot } from "@/lib/board";
import { daysLeftLabel, monthKeyOf, pace, todayInDetroit } from "@/lib/month";
import { formatDollars } from "@/lib/money";
import { LOCK_MINUTES } from "@/lib/policy-types";
import { summaryLine } from "@/lib/policy-validate";
import type { Viewer } from "@/lib/viewer";
import { canLogFor } from "@/lib/rules";
import { loadRuleContext } from "@/lib/policies";
import { Icon } from "@/components/ui/icon";
import { ButtonLink, EmptyState, PageHead, Panel, RankChip } from "@/components/ui/kit";
import { clockTime, dayShort, firstName, policiesWord, rankChangeOf, rankOf, type BoardLine } from "@/components/policy/format";
import Link from "next/link";
import type { ReactNode } from "react";

/**
 * After logging (/log?done=<id>): what the board and the TV now show, never the client on the TV
 * line; how long the sale stays fully the logger's; Log another, Open the policy, Home. Beside it
 * on a computer, the seller's month as it stands (the numbers Home shows). Only the policy's id is
 * in the address; the page reads it again with the viewer's rights.
 */
export async function LogDone({ viewer, id }: { viewer: Viewer; id: string }) {
  const today = todayInDetroit();
  const month = monthKeyOf(today);
  const [p, ctx, snapshot] = await Promise.all([
    getPolicyFor(viewer, id),
    loadRuleContext(),
    loadMonthSnapshot(month, { today, recentLimit: 1, scoreboard: false }).catch((err: unknown) => {
      console.error("log_done_board_failed", err instanceof Error ? err.name : "error");
      return null;
    }),
  ]);
  if (!p) {
    return (
      <div className="page log-page">
        <PageHead title="Log a sale" />
        <section className="card log-done">
          <EmptyState icon="undo" title="That sale isn't here any more" body="It may have been taken back. It's off the board and out of the policy list." />
          <div className="log-done-btns">
            <ButtonLink href="/log" kind="primary" icon="plus">
              Log another
            </ButtonLink>
            <ButtonLink href="/" kind="ghost">
              Go home
            </ButtonLink>
          </div>
        </section>
      </div>
    );
  }
  const self = p.agentId === viewer.agentId;
  const name = p.agentName;
  const lines: BoardLine[] = (snapshot?.agents ?? []).map((a) => ({ id: a.id, name: a.name, cents: a.lifeCents, policies: a.lifePolicies, todayCents: a.todayLifeCents, todayPolicies: a.todayPolicies }));
  const line = snapshot?.agents.find((a) => a.id === p.agentId) ?? null;
  const rank = rankOf(lines, p.agentId);
  const change = rankChangeOf(lines, p.agentId);
  const people = snapshot?.agents.filter((a) => a.active).length ?? 0;
  const until = Date.parse(p.createdAt) + LOCK_MINUTES * 60_000;
  const fresh = until > ctx.nowMs;
  const other = !self && canLogFor(viewer, p.agentId, ctx) ? p.agentName : null;
  const clock = snapshot?.clock ?? null;
  const proj = line && clock ? pace(line.lifeCents, line.goalCents, clock).projectedCents : 0;
  const lastDay = clock ? `${clock.key}-${String(new Date(Date.UTC(Number(clock.key.slice(0, 4)), Number(clock.key.slice(5, 7)), 0)).getUTCDate()).padStart(2, "0")}` : today;
  const tile = (k: string, v: ReactNode, sub?: ReactNode) => (
    <div className="log-mo-tile">
      <span className="log-mo-k">{k}</span>
      <span className="log-mo-v num">{v}</span>
      {sub != null && <span className="log-mo-s">{sub}</span>}
    </div>
  );
  return (
    <div className="page log-page">
      <PageHead title="Log a sale" />
      <div className="log-grid">
        <section className="card log-done" aria-live="polite" data-log-done>
          <span className="log-done-ico">
            <Icon name="check-circle" size={26} />
          </span>
          <h2 className="log-done-title">Logged. It&apos;s on the board.</h2>
          <p className="log-done-sum">{summaryLine(p)}</p>
          {rank != null && p.soldOn.slice(0, 7) === month && (
            <div className="log-done-board">
              <span className="log-done-rank num">#{rank}</span>
              <span className="log-done-who">
                <span>
                  {self ? "You're" : `${name} is`} #{rank} on the agency board
                  {change ? (
                    <span className="log-done-chip">
                      <RankChip change={change} />
                    </span>
                  ) : null}
                </span>
                {line && (
                  <span className="muted num">
                    {formatDollars(line.lifeCents)} this month · {policiesWord(line.lifePolicies)}
                  </span>
                )}
              </span>
            </div>
          )}
          <ul className="log-done-notes">
            <li>
              <Icon name="tv" size={15} className="ico" />
              <span>
                The office TV shows &ldquo;New sale · {name} · {formatDollars(p.premiumCents)}
                {p.carrier ? ` · ${p.carrier}` : ""}&rdquo; for a few seconds. Never the client.
              </span>
            </li>
            {fresh && (
              <li>
                <Icon name="clock" size={15} className="ico" />
                <span>
                  Until {clockTime(until)} {self || p.loggedByAgent === viewer.agentId ? "you" : "whoever logged it"} can fix anything on it, or take it back.
                </span>
              </li>
            )}
          </ul>
          <div className="log-done-btns">
            <ButtonLink href={`/policies/${p.id}`} icon="file">
              Open the policy
            </ButtonLink>
            <ButtonLink href="/log" kind="primary" icon="plus">
              Log another
            </ButtonLink>
            <ButtonLink href="/" kind="ghost">
              Go home
            </ButtonLink>
          </div>
          {other && (
            <p className="log-done-again">
              <Link href={`/log?agent=${p.agentId}`} className="link">
                <Icon name="plus" size={14} />
                Log another for {firstName(other)}
              </Link>
            </p>
          )}
        </section>
        {line && clock && rank != null && (
          <div className="col log-side only-wide">
            <Panel
              title={self ? "Your month now" : `${firstName(name)}'s month now`}
              sub={`${dayShort(`${clock.key}-01`)} – ${Number(today.slice(8, 10))} · ${daysLeftLabel(clock)}`}
              className="log-month"
              foot={
                <>
                  <Link href="/scoreboard" className="link">
                    See the Scoreboard
                  </Link>
                  <Link href="/" className="link">
                    Home
                  </Link>
                </>
              }
            >
              <div className="log-mo-grid">
                {tile("Production", formatDollars(line.lifeCents), line.todayLifeCents ? `+${formatDollars(line.todayLifeCents)} today` : undefined)}
                {tile("On pace for", formatDollars(proj), `by ${dayShort(lastDay)}`)}
                {tile("Policies", String(line.lifePolicies), `${line.todayPolicies} today`)}
                {tile(
                  "Rank",
                  <>
                    #{rank}
                    <small> of {people}</small>
                  </>,
                  change ? (
                    <>
                      <RankChip change={change} /> today
                    </>
                  ) : (
                    "in the agency"
                  ),
                )}
              </div>
            </Panel>
          </div>
        )}
      </div>
    </div>
  );
}
