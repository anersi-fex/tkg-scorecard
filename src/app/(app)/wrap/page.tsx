import type { Metadata } from "next";
import Link from "next/link";
import { requirePage } from "@/lib/auth";
import { dbConfigured } from "@/lib/supabase";
import { loadMonthSnapshot } from "@/lib/board";
import { buildWrap, carrierSummary, type DayWrap, type WrapLine } from "@/lib/wrap";
import { addDays, dayLabelLong, isDateKey, monthKeyOf, todayInDetroit, weekday } from "@/lib/month";
import { formatDollars } from "@/lib/money";
import { Avatar, firstName } from "@/components/avatar";
import { Eyebrow, ListCard, ROW_INSET } from "@/components/tide";
import { Badge, Notice, cn, formatClock } from "@/components/ui";

export const metadata: Metadata = { title: "Wrap" };

/**
 * The Wrap: one day of the team's month on one iPhone screenshot (owner, 2026-10-29: "super
 * screenshotable and tells you a lot"). Who sold what, the day's top producer, the best deal, the
 * carriers, and whether the day beat what the goal needed. Arrows walk back a day at a time.
 */
export default async function WrapPage({ searchParams }: PageProps<"/wrap">) {
  await requirePage();
  const params = await searchParams;
  const today = todayInDetroit();
  const day = typeof params.day === "string" && isDateKey(params.day) && params.day <= today ? params.day : today;
  if (!dbConfigured()) return <Header day={day} today={today} />;

  let wrap: DayWrap;
  try {
    wrap = buildWrap(await loadMonthSnapshot(monthKeyOf(day), { today }), day);
  } catch (err) {
    return (
      <>
        <Header day={day} today={today} />
        <Notice tone="red">The database answered with an error: {err instanceof Error ? err.message : "unknown"}. Check that the setup SQL ran (SETUP.md, step 3).</Notice>
      </>
    );
  }
  const verdict = verdictBadge(wrap);
  const best = wrap.bestSale;
  const sold = wrap.lines.filter((l) => l.premiumCents > 0);
  const quiet = wrap.lines.filter((l) => l.premiumCents === 0);
  // Seven people fit one screenshot as rows; past eight, the no-sale names share one line.
  const fold = wrap.lines.length > 8;

  return (
    <>
      <Header day={day} today={today} badge={verdict} />

      {/* Player of the day */}
      {wrap.player ? (
        <div className="relative overflow-hidden rounded-[22px] bg-tide-strong p-4 text-white shadow-card">
          <Crown className="absolute top-4 right-4 h-7 w-7 opacity-90" />
          <Eyebrow className="text-white/80">Player of the day</Eyebrow>
          <p className="mt-1 font-mono text-[32px] leading-none font-bold tracking-[-0.03em]">{formatDollars(wrap.player.premiumCents)}</p>
          <div className="mt-2.5 flex items-center gap-3">
            <Avatar name={wrap.player.name} tone={wrap.player.tone} size={36} className="bg-surface text-accent-text" />
            <div className="min-w-0">
              <p className="truncate text-[17px] leading-tight font-extrabold">{wrap.player.name}</p>
              <p className="truncate text-[12px] font-semibold text-white/85">
                {wrap.player.policies} {wrap.player.policies === 1 ? "policy" : "policies"}
                {wrap.player.carriers.length > 0 && ` · ${carrierSummary(wrap.player.carriers)}`}
              </p>
            </div>
          </div>
          {best && (
            <p className="mt-2.5 truncate border-t border-white/20 pt-2 text-[12px] font-semibold text-white/90">
              Best deal · {firstName(best.agentName)} · <span className="font-mono text-[13px] text-white">{formatDollars(best.premiumCents)}</span>
              {best.carrier && ` · ${best.carrier}`}
              {best.product && ` · ${best.product}`} · {formatClock(best.createdAt)}
            </p>
          )}
        </div>
      ) : (
        <div className="rounded-[22px] bg-surface p-4 shadow-card">
          <Eyebrow>Player of the day</Eyebrow>
          <p className="mt-1.5 text-[17px] font-bold text-gray-900">{wrap.when === "today" ? "Nobody yet. First sale takes it." : "Nobody sold that day."}</p>
        </div>
      )}

      {/* Everybody: sold rows ranked; with a long roster the no-sale names fold into one line */}
      <ListCard className="mt-3 pt-2.5">
        <li className="px-4 pb-1">
          <Eyebrow>{wrap.when === "today" ? "Everybody today" : "Everybody that day"}</Eyebrow>
        </li>
        {wrap.lines.length === 0 && <li className="px-4 py-3 text-[14px] text-gray-600">Nobody is on the board yet.</li>}
        {(fold ? sold : wrap.lines).map((l) => (
          <WrapRow key={l.id} line={l} />
        ))}
        {fold && quiet.length > 0 && (
          <li className={cn("px-4 py-2 text-[12px] font-semibold text-gray-500", ROW_INSET.plain)}>No sale: {quiet.map((l) => firstName(l.name)).join(", ")}</li>
        )}
      </ListCard>

      {/* Carriers */}
      {wrap.carriers.length > 0 && (
        <div className="mt-2.5 flex flex-wrap gap-1.5 px-1">
          {wrap.carriers.map((c) => (
            <Badge key={c.name} tone="blue">
              {c.name} {c.count}
            </Badge>
          ))}
        </div>
      )}

      <p data-wrap-foot className="mt-2.5 flex items-center justify-between gap-3 px-1 text-[11px] font-semibold text-gray-500">
        <span>
          {wrap.month.policies} {wrap.month.policies === 1 ? "policy" : "policies"} this month
          {wrap.month.goalCents > 0 && ` · ${wrap.month.goalPct}% of the goal`}
        </span>
        <span className="shrink-0">Scorecard by TKG</span>
      </p>
    </>
  );
}

function verdictBadge(w: DayWrap): { text: string; tone: "green" | "amber" | "gray" | "blue" } {
  const v = w.verdict;
  if (w.teamCents === 0 && v.kind !== "off_day") return { text: w.when === "today" ? "No sales yet" : "No sales", tone: "gray" };
  if (v.kind === "won") return { text: `Day won · ${formatDollars(w.teamCents)}, needed ${formatDollars(v.neededCents)}`, tone: "green" };
  if (v.kind === "short") return { text: `${formatDollars(v.shortCents)} short · ${formatDollars(w.teamCents)}, needed ${formatDollars(v.neededCents)}`, tone: "amber" };
  if (v.kind === "goal_hit") return { text: `Goal already hit · ${formatDollars(w.teamCents)} ${w.when === "today" ? "today" : "that day"}`, tone: "green" };
  if (v.kind === "off_day") return { text: `${weekday(w.day) === 6 ? "Saturday" : "Sunday"} · ${formatDollars(w.teamCents)}`, tone: "blue" };
  return { text: `${formatDollars(w.teamCents)} ${w.when === "today" ? "today" : "that day"}`, tone: "blue" };
}

function WrapRow({ line }: { line: WrapLine }) {
  const sold = line.premiumCents > 0;
  const medal = line.rank === 1 ? "text-gold" : line.rank === 2 ? "text-silver" : line.rank === 3 ? "text-bronze" : "text-gray-500";
  return (
    <li className={cn("flex items-center gap-3 px-4", ROW_INSET.plain, sold ? "py-1.5" : "py-1 opacity-50")}>
      <span className={cn("w-4 shrink-0 text-center font-mono text-[14px] font-bold", medal)}>{line.rank ?? "–"}</span>
      <Avatar name={line.name} tone={line.tone} size={sold ? 32 : 28} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[15px] leading-tight font-bold text-gray-900">
          {line.name}
          {!sold && <span className="ml-1.5 text-[12px] font-semibold text-gray-500">no sale</span>}
        </p>
        {sold && (
          <p className="truncate text-[11.5px] leading-tight font-semibold text-gray-500">
            {line.policies} {line.policies === 1 ? "policy" : "policies"}
            {line.carriers.length > 0 && ` · ${carrierSummary(line.carriers)}`}
          </p>
        )}
      </div>
      <p className="shrink-0 font-mono text-[16px] font-bold text-gray-900">{formatDollars(line.premiumCents)}</p>
    </li>
  );
}

function Header({ day, today, badge }: { day: string; today: string; badge?: { text: string; tone: "green" | "amber" | "gray" | "blue" } }) {
  const prev = addDays(day, -1);
  const next = addDays(day, 1);
  const isToday = day === today;
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-[28px] leading-tight font-extrabold tracking-[-0.035em] text-gray-900">Wrap</h1>
        <p className="mt-0.5 text-[14px] font-medium text-gray-500">{dayLabelLong(day)}</p>
        {badge && (
          <Badge tone={badge.tone} className="mt-1.5 max-w-full whitespace-normal">
            {badge.text}
          </Badge>
        )}
      </div>
      <nav aria-label="Day" className="flex shrink-0 items-center gap-1">
        <Link href={`/wrap?day=${prev}`} aria-label={dayLabelLong(prev)} className="flex h-11 w-11 items-center justify-center rounded-full bg-surface text-gray-700 shadow-card hover:bg-gray-50">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M15 6l-6 6 6 6" />
          </svg>
        </Link>
        {!isToday && (
          <Link href="/wrap" className="flex h-11 items-center rounded-full bg-surface px-3.5 text-[13px] font-bold text-accent-text shadow-card hover:bg-gray-50">
            Today
          </Link>
        )}
        <Link
          href={`/wrap?day=${next}`}
          aria-label={dayLabelLong(next)}
          aria-disabled={isToday}
          className={cn("flex h-11 w-11 items-center justify-center rounded-full bg-surface text-gray-700 shadow-card hover:bg-gray-50", isToday && "pointer-events-none opacity-40")}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M9 6l6 6-6 6" />
          </svg>
        </Link>
      </nav>
    </div>
  );
}

function Crown({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={cn("fill-current", className)} aria-hidden>
      <path d="M3 8l4.5 4L12 5l4.5 7L21 8l-2 11H5z" />
    </svg>
  );
}
