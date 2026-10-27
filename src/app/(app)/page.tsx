import type { Metadata } from "next";
import Link from "next/link";
import { requirePage } from "@/lib/auth";
import { dbConfigured } from "@/lib/supabase";
import { loadMonthSnapshot, type MonthSnapshot } from "@/lib/board";
import { getSettings } from "@/lib/data";
import { addMonths, dayLabel, isMonthKey, monthKeyOf, monthLabel, todayInDetroit } from "@/lib/month";
import { formatDollars, formatMoney } from "@/lib/money";
import { Avatar } from "@/components/avatar";
import { MonthChart } from "@/components/month-chart";
import { Eyebrow, ListCard, ListTitle, ROW_INSET } from "@/components/tide";
import { Badge, Card, Notice, cn, formatClock, formatDate } from "@/components/ui";
import { SaleRowMenu } from "./sale-row-menu";

export const metadata: Metadata = { title: "This month" };

function paceLine(s: MonthSnapshot): { text: string; tone: "green" | "amber" | "red" | "gray" | "blue" } {
  const { pace } = s.team;
  const { clock } = s;
  if (clock.position === "past") {
    if (s.team.goalCents <= 0) return { text: `Finished at ${formatDollars(s.team.productionCents)}.`, tone: "gray" };
    return s.team.productionCents >= s.team.goalCents
      ? { text: `Goal hit: ${formatDollars(s.team.productionCents)} of ${formatDollars(s.team.goalCents)}.`, tone: "green" }
      : { text: `Finished ${formatDollars(s.team.goalCents - s.team.productionCents)} short of the goal.`, tone: "red" };
  }
  if (pace.status === "done") return { text: `Goal hit, ${formatDollars(s.team.productionCents - s.team.goalCents)} over. Keep going.`, tone: "green" };
  if (clock.elapsed === 0) return { text: clock.position === "future" ? "The month hasn't started." : "The month starts Monday.", tone: "gray" };
  if (pace.status === "none") return { text: `On pace for ${formatDollars(pace.projectedCents)} this month. Set a goal in Settings.`, tone: "gray" };
  if (clock.remaining === 0) return { text: `${formatDollars(s.team.goalCents - s.team.productionCents)} short of the goal. No business days left this month.`, tone: "amber" };
  const per = `${formatDollars(pace.neededPerDayCents)} a day for ${clock.remaining} ${clock.remaining === 1 ? "day" : "days"} gets there.`;
  if (pace.status === "ahead") return { text: `Ahead by ${formatDollars(pace.aheadCents)}. On pace for ${formatDollars(pace.projectedCents)}. ${per}`, tone: "green" };
  if (pace.status === "on") return { text: `Right on the goal line. On pace for ${formatDollars(pace.projectedCents)}. ${per}`, tone: "blue" };
  return { text: `Behind by ${formatDollars(-pace.aheadCents)}. On pace for ${formatDollars(pace.projectedCents)}. ${per}`, tone: "amber" };
}

export default async function HomePage({ searchParams }: PageProps<"/">) {
  const role = await requirePage();
  const params = await searchParams;
  const today = todayInDetroit();
  const current = monthKeyOf(today);
  const month = typeof params.month === "string" && isMonthKey(params.month) ? params.month : current;
  if (!dbConfigured()) return <PageHeader month={month} current={current} />;

  let s: MonthSnapshot;
  try {
    s = await loadMonthSnapshot(month, { today });
  } catch (err) {
    return (
      <>
        <PageHeader month={month} current={current} />
        <Notice tone="red">The database answered with an error: {err instanceof Error ? err.message : "unknown"}. Check that the setup SQL ran (SETUP.md, step 3).</Notice>
      </>
    );
  }
  const line = paceLine(s);
  const monthSales = s.sales;
  const carriers = (await getSettings()).carriers;
  const top = s.agents[0];
  const maxPremium = Math.max(1, ...s.agents.map((a) => a.premiumCents));

  return (
    <>
      <PageHeader month={month} current={current} daysLeft={s.clock.position === "current" ? s.clock.remaining : null} />

      {/* The goal */}
      <Card className="relative overflow-hidden p-5">
        <Eyebrow>{s.clock.position === "past" ? "How the month went" : "Team production"}</Eyebrow>
        <div className="mt-2 flex flex-wrap items-end gap-x-3 gap-y-1">
          <span className="font-mono text-[40px] leading-none font-bold tracking-[-0.03em] text-gray-900">{formatDollars(s.team.productionCents)}</span>
          {s.team.goalCents > 0 && (
            <span className="pb-1 text-[15px] font-semibold text-gray-500">
              of {formatDollars(s.team.goalCents)} · <span className="font-mono text-gray-900">{s.team.goalPct}%</span>
            </span>
          )}
        </div>
        <div className="mt-4 h-3 overflow-hidden rounded-full bg-track" role="progressbar" aria-valuenow={Math.min(100, s.team.goalPct)} aria-valuemin={0} aria-valuemax={100}>
          <div className="h-full rounded-full bg-tide transition-[width] duration-700" style={{ width: `${Math.min(100, s.team.goalPct)}%` }} />
        </div>
        <p className={cn("mt-3 text-[14px] leading-snug font-semibold", line.tone === "green" ? "text-green-700" : line.tone === "amber" ? "text-amber-800" : line.tone === "red" ? "text-red-700" : line.tone === "blue" ? "text-accent-text" : "text-gray-600")}>
          {line.text}
        </p>
        <div className="mt-4 grid grid-cols-3 gap-2 text-center">
          <Stat label="Policies" value={String(s.team.policies)} />
          <Stat label="Avg premium" value={s.team.averageCents ? formatDollars(s.team.averageCents) : "–"} />
          <Stat label={s.clock.position === "current" ? "Today" : "Best day"} value={s.clock.position === "current" ? formatDollars(s.team.todayCents) : s.team.bestDay ? formatDollars(s.team.bestDay.cents) : "–"} sub={s.clock.position !== "current" && s.team.bestDay ? dayLabel(s.team.bestDay.date) : undefined} />
        </div>
        <div className="mt-4">
          <MonthChart daily={s.daily} goalCents={s.team.goalCents} today={today} height={150} className="h-[150px] w-full" />
        </div>
      </Card>

      {/* Leaderboard */}
      <div className="mt-6">
        <ListTitle count={s.agents.length}>Leaderboard</ListTitle>
        <ListCard className="mt-2">
          {s.agents.length === 0 && (
            <li className="px-4 py-5 text-[14px] text-gray-600">
              Nobody is on the board yet.{" "}
              {role === "owner" ? (
                <Link href="/team" className="font-semibold text-accent-text">
                  Add your team
                </Link>
              ) : (
                "Ask Anersi to add the team."
              )}
            </li>
          )}
          {s.agents.map((a) => (
            <li key={a.id} className={cn("flex items-center gap-3 px-4 py-3", ROW_INSET.avatar)}>
              <span className={cn("w-5 shrink-0 text-center font-mono text-[15px] font-bold", a.rank === 1 && a.premiumCents > 0 ? "text-amber-800" : "text-gray-500")}>{a.rank}</span>
              <Avatar name={a.name} tone={a.tone} size={40} />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-3">
                  <p className="truncate text-[15px] font-bold text-gray-900">
                    {a.name}
                    {!a.active && <span className="ml-1.5 text-[12px] font-medium text-gray-500">(off the board)</span>}
                  </p>
                  <p className="shrink-0 font-mono text-[16px] font-bold text-gray-900">{formatDollars(a.premiumCents)}</p>
                </div>
                <div className="mt-1.5 flex items-center gap-2">
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-track">
                    <div className={cn("h-full rounded-full", a.rank === 1 && a.premiumCents > 0 ? "bg-tide" : "bg-bar")} style={{ width: `${a.goalCents > 0 ? Math.min(100, a.goalPct) : Math.round((a.premiumCents / maxPremium) * 100)}%` }} />
                  </div>
                  <span className="shrink-0 text-[12px] font-semibold text-gray-500">
                    {a.policies} {a.policies === 1 ? "policy" : "policies"}
                    {a.goalCents > 0 && ` · ${a.goalPct}% of goal`}
                    {a.todayCents > 0 && s.clock.position === "current" && <span className="text-green-700"> · +{formatDollars(a.todayCents)} today</span>}
                  </span>
                </div>
              </div>
            </li>
          ))}
        </ListCard>
      </div>

      {/* Sales */}
      <div className="mt-6">
        <ListTitle count={s.team.salesCount}>{s.clock.position === "current" ? "Latest sales" : "Sales"}</ListTitle>
        <ListCard className="mt-2">
          {monthSales.length === 0 && <li className="px-4 py-5 text-[14px] text-gray-600">{s.clock.position === "current" ? "No sales logged yet this month. The first one lights up the board." : "No sales this month."}</li>}
          {monthSales.map((r) => (
            <li key={r.id} className={cn("flex items-center gap-3 px-4 py-3", ROW_INSET.avatar)}>
              <Avatar name={r.agentName} tone={s.agents.find((a) => a.id === r.agentId)?.tone} size={40} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[15px] font-bold text-gray-900">{r.agentName}</p>
                <p className="truncate text-[13px] font-medium text-gray-500">
                  {[r.carrier, r.product, r.policies > 1 ? `${r.policies} policies` : null, r.soldOn === today ? `Today, ${formatClock(r.createdAt)}` : formatDate(r.soldOn, { year: false })]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              </div>
              <p className="shrink-0 font-mono text-[16px] font-bold text-gray-900">{formatMoney(r.premiumCents)}</p>
              <SaleRowMenu sale={r} role={role} agents={s.agents.map((a) => ({ id: a.id, name: a.name }))} carriers={carriers} />
            </li>
          ))}
        </ListCard>
      </div>

      {/* The recap at the bottom for a finished month */}
      {s.clock.position === "past" && top && top.premiumCents > 0 && (
        <Card className="mt-6">
          <Eyebrow>{monthLabel(month)} recap</Eyebrow>
          <ul className="mt-2 space-y-1.5 text-[14px] text-gray-700">
            <li>
              <span className="font-semibold text-gray-900">{top.name}</span> led with {formatDollars(top.premiumCents)} and {top.policies} {top.policies === 1 ? "policy" : "policies"}.
            </li>
            {s.team.bestDay && (
              <li>
                Best day: <span className="font-semibold text-gray-900">{dayLabel(s.team.bestDay.date)}</span> with {formatDollars(s.team.bestDay.cents)}.
              </li>
            )}
            <li>
              {s.team.policies} policies, {formatDollars(s.team.averageCents)} average premium, {s.clock.businessDays} business days.
            </li>
          </ul>
        </Card>
      )}
    </>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-2xl bg-surface-2 px-2 py-2.5">
      <p className="font-mono text-[18px] leading-none font-bold text-gray-900">{value}</p>
      <p className="mt-1 text-[11px] font-bold tracking-[0.06em] text-gray-500 uppercase">{label}</p>
      {sub && <p className="text-[11px] font-medium text-gray-500">{sub}</p>}
    </div>
  );
}

function PageHeader({ month, current, daysLeft }: { month: string; current: string; daysLeft?: number | null }) {
  const prev = addMonths(month, -1);
  const next = addMonths(month, 1);
  const isCurrent = month === current;
  return (
    <div className="mb-4 flex items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-[28px] leading-tight font-extrabold tracking-[-0.035em] text-gray-900">{isCurrent ? "This month" : monthLabel(month)}</h1>
        <p className="mt-0.5 flex items-center gap-2 text-[14px] font-medium text-gray-500">
          {isCurrent ? monthLabel(month) : month < current ? "Finished" : "Coming up"}
          {daysLeft != null && (
            <Badge tone={daysLeft <= 3 ? "amber" : "blue"}>
              {daysLeft} business {daysLeft === 1 ? "day" : "days"} left
            </Badge>
          )}
        </p>
      </div>
      <nav aria-label="Month" className="flex shrink-0 items-center gap-1">
        <Link href={`/?month=${prev}`} aria-label={`${monthLabel(prev)}`} className="flex h-11 w-11 items-center justify-center rounded-full bg-surface text-gray-700 shadow-card hover:bg-gray-50">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M15 6l-6 6 6 6" />
          </svg>
        </Link>
        {!isCurrent && (
          <Link href="/" className="flex h-11 items-center rounded-full bg-surface px-3.5 text-[13px] font-bold text-accent-text shadow-card hover:bg-gray-50">
            Now
          </Link>
        )}
        <Link
          href={`/?month=${next}`}
          aria-label={`${monthLabel(next)}`}
          aria-disabled={month >= current}
          className={cn("flex h-11 w-11 items-center justify-center rounded-full bg-surface text-gray-700 shadow-card hover:bg-gray-50", month >= current && "pointer-events-none opacity-40")}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M9 6l6 6-6 6" />
          </svg>
        </Link>
      </nav>
    </div>
  );
}
