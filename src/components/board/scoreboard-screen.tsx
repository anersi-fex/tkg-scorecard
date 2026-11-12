"use client";

import type { MonthSnapshot } from "@/lib/board";
import type { ScoreMover, Scoreboard } from "@/lib/scoreboard-types";
import { formatDollars } from "@/lib/money";
import { cn } from "@/components/ui";
import { compactDollars } from "@/lib/views";
import { EmptyScreen } from "./parts";

/**
 * The Scoreboard screen: the agency's CRM page as leadership reads it (owner, 2026-11-12: "copy and
 * pay attention to analytics in the same way that their current CRM does ... matched exactly"), in
 * Scorecard's look and sized for the TV. Three cards across the top (Production, Policies sold,
 * Active agents, each against the same days of the month before), then "Where agents stand"
 * beside "Moved most this week". Same names, same numbers, same words.
 */
export function ScoreboardScreen({ snap }: { snap: MonthSnapshot }) {
  const sb = snap.scoreboard;
  if (!sb || sb.rows.length === 0) return <EmptyScreen title="Scoreboard" line={sb ? "The first sale of the month lights this up." : "The numbers are on their way."} />;
  const { kpis } = sb;
  const vs = `vs ${sb.compare.label}`;
  return (
    <div className="mt-[0.9em] flex min-h-0 flex-1 flex-col gap-[1em]">
      <section className="grid shrink-0 grid-cols-3 gap-[1em]">
        <KpiCard label="Production" value={compactDollars(kpis.productionCents)} delta={kpis.productionCents - kpis.prevProductionCents} money vs={vs} caption="Annual premium sold" spark={kpis.dailyCents} />
        <KpiCard label="Policies sold" value={String(kpis.policies)} delta={kpis.policies - kpis.prevPolicies} vs={vs} caption="Policies with premium" />
        <KpiCard label="Active agents" value={String(kpis.activeAgents)} delta={kpis.activeAgents - kpis.prevActiveAgents} vs={vs} caption="Agents who sold" spark={kpis.dailyActiveAgents} />
      </section>
      <div className="grid min-h-0 flex-1 grid-cols-2 gap-[1em]">
        <Stand sb={sb} />
        <Movers sb={sb} />
      </div>
    </div>
  );
}

/** "↑ $90.1K" in green, "↓ 2" in red, a gray dash for no change. */
function DeltaChip({ delta, money = false }: { delta: number; money?: boolean }) {
  const size = money ? compactDollars(Math.abs(delta)) : String(Math.abs(delta));
  return (
    <span className={cn("inline-flex items-center rounded-full px-[0.7em] py-[0.18em] font-mono text-[1em] font-bold whitespace-nowrap", delta > 0 ? "bg-green-100 text-green-800" : delta < 0 ? "bg-red-100 text-red-800" : "bg-track text-gray-500")}>
      {delta > 0 ? `↑ ${size}` : delta < 0 ? `↓ ${size}` : "–"}
    </span>
  );
}

function KpiCard({ label, value, delta, money, vs, caption, spark }: { label: string; value: string; delta: number; money?: boolean; vs: string; caption: string; spark?: number[] }) {
  return (
    <div data-kpi={label} className="relative flex min-w-0 flex-col overflow-hidden rounded-[1.4em] bg-surface px-[1.3em] pt-[1em] pb-[1.1em] shadow-card">
      <p className="text-[1.05em] font-bold text-gray-600">{label}</p>
      <p className="mt-[0.12em] font-mono text-[4.4em] leading-none font-bold tracking-[-0.045em]">{value}</p>
      <p className="mt-[0.55em] flex items-center gap-[0.6em] text-[1em] font-semibold text-gray-500">
        <DeltaChip delta={delta} money={money} />
        {vs}
      </p>
      <p className="mt-[0.45em] text-[1em] font-semibold text-gray-500">{caption}</p>
      {spark && spark.length > 1 && <Sparkline values={spark} className="absolute right-[1.2em] bottom-[1.1em] h-[4.6em] w-[36%]" />}
    </div>
  );
}

/** One line for each day of the range, drawn to fill its box. */
function Sparkline({ values, className }: { values: number[]; className?: string }) {
  const max = Math.max(1, ...values);
  const step = 100 / (values.length - 1);
  const points = values.map((v, i) => `${(i * step).toFixed(2)},${(38 - (v / max) * 34).toFixed(2)}`);
  return (
    <svg viewBox="0 0 100 40" preserveAspectRatio="none" className={className} aria-hidden>
      <polygon points={`0,40 ${points.join(" ")} 100,40`} className="fill-accent opacity-15" />
      <polyline points={points.join(" ")} fill="none" className="stroke-accent" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/** "Where agents stand": the middle agent, and how many agents fall in each of five ranges. */
function Stand({ sb }: { sb: Scoreboard }) {
  const { stand } = sb;
  const top = Math.max(1, ...stand.buckets.map((b) => b.count));
  return (
    <section data-card="stand" className="flex min-h-0 flex-col rounded-[1.4em] bg-surface px-[1.3em] pt-[1em] pb-[0.9em] shadow-card">
      <h2 className="text-[1.45em] leading-tight font-extrabold tracking-[-0.02em]">Where agents stand</h2>
      <p className="mt-[0.1em] text-[1em] font-semibold text-gray-500">
        {sb.range.label} · {stand.agents} {stand.agents === 1 ? "agent" : "agents"} on the board
      </p>
      <p className="mt-[0.7em] text-[1.5em] leading-tight font-semibold text-gray-700">
        The middle agent is at <span className="font-mono font-bold text-gray-900">{formatDollars(stand.medianCents)}</span>.
      </p>
      <div className="mt-[0.8em] grid min-h-0 flex-1 gap-[1.2em]" style={{ gridTemplateColumns: `repeat(${Math.max(1, stand.buckets.length)}, minmax(0, 1fr))` }}>
        {stand.buckets.map((b) => (
          <div key={b.label} className="flex min-h-0 flex-col items-center justify-end">
            <p className="font-mono text-[1.7em] leading-none font-bold">{b.count}</p>
            <div className={cn("mt-[0.35em] w-full rounded-t-[0.7em]", b.count > 0 ? "bg-gray-300" : "bg-track")} style={{ height: b.count > 0 ? `${Math.max(4, (b.count / top) * 78)}%` : "0.3em" }} />
            <p className="mt-[0.5em] text-[1.05em] leading-none font-bold whitespace-nowrap text-gray-600">{b.label}</p>
          </div>
        ))}
      </div>
      <p className="mt-[0.8em] border-t border-line pt-[0.6em] text-[0.9em] font-semibold text-gray-500">Each bar counts the agents whose production falls in that range</p>
    </section>
  );
}

/** "Moved most this week": the last 7 days against the 7 days before, three going up and three slipping. */
function Movers({ sb }: { sb: Scoreboard }) {
  const { movers } = sb;
  return (
    <section data-card="movers" className="flex min-h-0 flex-col rounded-[1.4em] bg-surface px-[1.3em] pt-[1em] pb-[1.1em] shadow-card">
      <h2 className="text-[1.45em] leading-tight font-extrabold tracking-[-0.02em]">Moved most this week</h2>
      <p className="mt-[0.1em] text-[1em] font-semibold text-gray-500">
        {movers.label} · {sb.scope === "agency" ? "Agency" : sb.scopeName}
      </p>
      <div className="mt-[0.9em] grid min-h-0 flex-1 grid-cols-2 gap-[1.4em]">
        <MoverList title="Going up" up list={movers.up} />
        <MoverList title="Slipping" list={movers.down} />
      </div>
    </section>
  );
}

function MoverList({ title, up = false, list }: { title: string; up?: boolean; list: ScoreMover[] }) {
  const top = Math.max(1, ...list.map((m) => Math.abs(m.deltaCents)));
  return (
    <div className="flex min-h-0 flex-col">
      <p className={cn("flex items-center gap-[0.45em] text-[1.15em] font-extrabold", up ? "text-up" : "text-red-800")}>
        <svg viewBox="0 0 24 24" className="h-[1.1em] w-[1.1em]" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          {up ? <path d="M3 17l6-6 4 4 8-8M15 7h6v6" /> : <path d="M3 7l6 6 4-4 8 8M15 17h6v-6" />}
        </svg>
        <span className="text-gray-900">{title}</span>
      </p>
      {list.length === 0 ? (
        <p className="mt-[0.8em] text-[1em] font-semibold text-gray-500">{up ? "Nobody is up on last week yet." : "Nobody is slipping."}</p>
      ) : (
        <ul className="mt-[0.6em] flex min-h-0 flex-1 flex-col gap-[0.6em]">
          {list.map((m) => (
            <li key={m.agentId} className="relative flex min-h-0 flex-1 items-center overflow-hidden rounded-[0.9em] bg-surface-2" style={{ maxHeight: "5.4em" }}>
              <span aria-hidden className={cn("absolute inset-y-0 left-0 rounded-[0.9em]", up ? "bg-green-100" : "bg-red-100")} style={{ width: `${Math.max(6, Math.round((Math.abs(m.deltaCents) / top) * 100))}%` }} />
              <div className="relative flex w-full min-w-0 items-center justify-between gap-[0.8em] px-[0.9em]">
                <div className="min-w-0">
                  <p className="truncate text-[1.25em] leading-tight font-extrabold tracking-[-0.02em]">{m.name}</p>
                  <p className="mt-[0.1em] truncate font-mono text-[0.95em] font-semibold text-gray-600">
                    {formatDollars(m.nowCents)}, was {formatDollars(m.wasCents)}
                  </p>
                </div>
                <p className={cn("shrink-0 font-mono text-[1.45em] font-bold tracking-[-0.02em]", up ? "text-up" : "text-red-800")}>
                  {m.deltaCents >= 0 ? "+" : "−"}
                  {formatDollars(Math.abs(m.deltaCents))}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
