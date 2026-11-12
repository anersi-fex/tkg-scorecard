"use client";

import type { MonthSnapshot } from "@/lib/board";
import type { ScoreMover } from "@/lib/scoreboard-types";
import { formatDollars } from "@/lib/money";
import { Icon } from "@/components/ui/icon";
import { DeltaChip } from "@/components/ui/kit";
import { compactDollars, firstCompare, sparkValues } from "@/lib/views";
import { EmptyScreen, Spark } from "./parts";

/**
 * The Scoreboard screen: the agency's CRM page as leadership reads it, in the calmer CRM look and
 * sized for the TV (the approved demo, 2026-11-12). Three cards across the top (Production with
 * "On pace for", Policies sold, Active agents, each against the same days of the month before, or
 * "First month on Scorecard" when those days had nothing), then "Where agents stand" beside "Moved
 * most this week". Same names, same numbers, same words as the phone's Scoreboard.
 */
export function ScoreboardScreen({ snap }: { snap: MonthSnapshot }) {
  const sb = snap.scoreboard;
  if (!sb || sb.rows.length === 0) return <EmptyScreen title="Scoreboard" line={sb ? "The first sale of the month lights this up." : "The numbers are on their way."} />;
  const k = sb.kpis;
  const vs = sb.compare.label;
  const first = firstCompare(k);
  const current = snap.clock.position === "current";
  const upTo = current ? snap.clock.today : "9999-12-31";
  const st = sb.stand;
  const most = Math.max(1, ...st.buckets.map((b) => b.count));
  return (
    <div className="tvb-main tvb-sb">
      <section className="tvb-kpis">
        <section className="tvb-card tvb-kpi" aria-label="Production" data-kpi="Production">
          <div className="tvb-kpi-label">Production</div>
          <div className="tvb-kpi-big num">{compactDollars(k.productionCents)}</div>
          <div className="tvb-kpi-vs">
            <DeltaChip diff={k.productionCents - k.prevProductionCents} text={compactDollars(Math.abs(k.productionCents - k.prevProductionCents))} vs={vs} first={first} />
          </div>
          <div className="tvb-kpi-cap">Annual premium sold</div>
          <Spark values={sparkValues(sb.range.days, k.dailyCents, upTo)} w={200} h={62} />
          {current && (
            <div className="tvb-kpi-pace">
              <span className="tvb-kpi-pace-k">
                <Icon name="trend-up" size={19} className="tvb-ico" />
                On pace for
              </span>
              <span className="tvb-kpi-pace-v num">{formatDollars(snap.team.pace.projectedCents)}</span>
            </div>
          )}
        </section>
        <section className="tvb-card tvb-kpi" aria-label="Policies sold" data-kpi="Policies sold">
          <div className="tvb-kpi-label">Policies sold</div>
          <div className="tvb-kpi-big num">{k.policies}</div>
          <div className="tvb-kpi-vs">
            <DeltaChip diff={k.policies - k.prevPolicies} text={String(Math.abs(k.policies - k.prevPolicies))} vs={vs} first={first} />
          </div>
          <div className="tvb-kpi-cap">Policies with premium</div>
        </section>
        <section className="tvb-card tvb-kpi" aria-label="Active agents" data-kpi="Active agents">
          <div className="tvb-kpi-label">Active agents</div>
          <div className="tvb-kpi-big num">{k.activeAgents}</div>
          <div className="tvb-kpi-vs">
            <DeltaChip diff={k.activeAgents - k.prevActiveAgents} text={String(Math.abs(k.activeAgents - k.prevActiveAgents))} vs={vs} first={first} />
          </div>
          <div className="tvb-kpi-cap">Agents who sold</div>
          <Spark values={sparkValues(sb.range.days, k.dailyActiveAgents, upTo)} w={200} h={62} />
        </section>
      </section>
      <section className="tvb-mid">
        <div className="tvb-card tvb-panel tvb-stand" data-card="stand">
          <h2 className="tvb-title">Where agents stand</h2>
          <div className="tvb-sub num">
            {sb.range.label} · {st.agents} {st.agents === 1 ? "agent" : "agents"} on the board
          </div>
          <div className="tvb-middle">
            The middle agent is at <b className="num">{formatDollars(st.medianCents)}</b>.
          </div>
          {st.tooFew ? (
            <div className="tvb-middle" data-stand="too-few">Too few agents on the board to compare. This fills in once 5 agents have production in this period.</div>
          ) : (
          <>
          <div className="tvb-hist" role="img" aria-label={st.buckets.map((b) => `${b.label}: ${b.count}`).join(", ")}>
            {st.buckets.map((b) => (
              <div key={b.label} className="tvb-hcol">
                <div className="tvb-hcount num">{b.count}</div>
                <div className="tvb-hbar" style={{ height: `max(calc(6 * var(--u)), calc((100% - calc(36 * var(--u))) * ${(b.count / most).toFixed(4)}))` }} />
              </div>
            ))}
          </div>
          <div className="tvb-hlabels">
            {st.buckets.map((b) => (
              <span key={b.label} className="num">
                {b.label}
              </span>
            ))}
          </div>
          <div className="tvb-hfoot">Each bar counts the agents whose production falls in that range</div>
          </>
          )}
        </div>
        <div className="tvb-card tvb-panel tvb-movers" data-card="movers">
          <h2 className="tvb-title">Moved most this week</h2>
          <div className="tvb-sub">{sb.movers.label} · Agency</div>
          <div className="tvb-mgrid">
            <div className="tvb-mh up">
              <Icon name="trend-up" size={24} className="tvb-ico" />
              Going up
            </div>
            <MoverRows list={sb.movers.up} up />
            <div className="tvb-mh down">
              <Icon name="trend-down" size={24} className="tvb-ico" />
              Slipping
            </div>
            <MoverRows list={sb.movers.down} up={false} />
          </div>
        </div>
      </section>
    </div>
  );
}

function MoverRows({ list, up }: { list: ScoreMover[]; up: boolean }) {
  if (!list.length) return <div className="tvb-mnone">{up ? "Nobody went up." : "Nobody slipped."}</div>;
  const top = Math.max(1, ...list.map((m) => Math.abs(m.deltaCents)));
  return (
    <>
      {list.map((m) => (
        <div key={m.agentId} className="tvb-mrow">
          <span className="tvb-mbar" style={{ width: `${(Math.max(0.06, Math.abs(m.deltaCents) / top) * 100).toFixed(1)}%` }} />
          <span className="tvb-mname ell">{m.name}</span>
          <span className="tvb-mwas num">
            {formatDollars(m.nowCents)}, was {formatDollars(m.wasCents)}
          </span>
          <span className="tvb-mdelta num">
            {up ? "+" : "−"}
            {formatDollars(Math.abs(m.deltaCents))}
          </span>
        </div>
      ))}
    </>
  );
}
