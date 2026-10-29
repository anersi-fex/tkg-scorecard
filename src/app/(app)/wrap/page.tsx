import type { Metadata } from "next";
import Link from "next/link";
import { requirePage } from "@/lib/auth";
import { dbConfigured } from "@/lib/supabase";
import { loadMonthSnapshot } from "@/lib/board";
import { buildWrap, carrierSummary, isWrapView, periodFor, periodNav, WRAP_VIEWS, type PeriodWrap, type WrapLine, type WrapPeriod, type WrapView } from "@/lib/wrap";
import { datesOfMonth, dayLabelLong, isDateKey, monthKeyOf, monthName, todayInDetroit, weekday } from "@/lib/month";
import { formatDollars } from "@/lib/money";
import { Avatar, firstName } from "@/components/avatar";
import { Eyebrow, ListCard, ROW_INSET } from "@/components/tide";
import { Badge, Notice, cn, formatClock, formatDate } from "@/components/ui";

export const metadata: Metadata = { title: "Wrap" };

type Tone = "green" | "amber" | "gray" | "blue";

/** The words that change with the view. */
const WORDS: Record<WrapView, { name: string; player: string; now: string; then: string; here: string; nobodyNow: string; nobodyThen: string; won: string }> = {
  day: { name: "Day", player: "Player of the day", now: "Everybody today", then: "Everybody that day", here: "Today", nobodyNow: "Nobody yet. First sale takes it.", nobodyThen: "Nobody sold that day.", won: "Day won" },
  week: { name: "Week", player: "Player of the week", now: "Everybody this week", then: "Everybody that week", here: "This week", nobodyNow: "Nobody yet this week.", nobodyThen: "Nobody sold that week.", won: "Week won" },
  month: { name: "Month", player: "Player of the month", now: "Everybody this month", then: "Everybody that month", here: "This month", nobodyNow: "Nobody yet this month.", nobodyThen: "Nobody sold that month.", won: "Month won" },
};

/** The address of a view on a day; today's day view is the plain /wrap. */
function wrapHref(view: WrapView, day: string, today: string): string {
  const q = new URLSearchParams();
  if (view !== "day") q.set("view", view);
  if (day !== today) q.set("day", day);
  const s = q.toString();
  return s ? `/wrap?${s}` : "/wrap";
}

/** "Oct 26 – 29", or "Oct 26" for one day (a period never crosses a month). */
function rangeLabel(from: string, to: string): string {
  const start = formatDate(from, { year: false });
  return from === to ? start : `${start} – ${Number(to.slice(8))}`;
}

/**
 * The Wrap: the team's day, week or month on one iPhone screenshot (owner, 2026-10-29: "super
 * screenshotable and tells you a lot"). Who sold what, the period's top producer and best deal,
 * the month's top three carriers, and whether the period beat what the goal needed. Arrows walk
 * back a day, a week or a month at a time.
 */
export default async function WrapPage({ searchParams }: PageProps<"/wrap">) {
  await requirePage();
  const params = await searchParams;
  const today = todayInDetroit();
  const day = typeof params.day === "string" && isDateKey(params.day) && params.day <= today ? params.day : today;
  const view: WrapView = isWrapView(params.view) ? params.view : "day";
  const period = periodFor(view, day, today);
  if (!dbConfigured()) return <Header period={period} day={day} today={today} />;

  let wrap: PeriodWrap;
  try {
    wrap = buildWrap(await loadMonthSnapshot(monthKeyOf(day), { today }), day, view);
  } catch (err) {
    return (
      <>
        <Header period={period} day={day} today={today} />
        <Notice tone="red">The database answered with an error: {err instanceof Error ? err.message : "unknown"}. Check that the setup SQL ran (SETUP.md, step 3).</Notice>
      </>
    );
  }
  const words = WORDS[view];
  const verdict = verdictBadge(wrap);
  const best = wrap.bestSale;
  const sold = wrap.lines.filter((l) => l.premiumCents > 0);
  const quiet = wrap.lines.filter((l) => l.premiumCents === 0);
  // Seven people fit one screenshot as rows, every one of them selling; past seven, the no-sale names share one line.
  const fold = wrap.lines.length > 7;
  const month = monthName(wrap.month.key);
  const monthDates = datesOfMonth(wrap.month.key);
  // The carriers are the month's, as they stood at the period's end.
  const asOf = wrap.current ? `${month} so far` : wrap.to === monthDates[monthDates.length - 1] ? month : `through ${formatDate(wrap.to, { year: false })}`;
  // Days imported before the carrier column have no carrier: say how much of the month the squares cover.
  const carrierNote = wrap.month.withCarrier < wrap.month.policies ? ` · ${wrap.month.withCarrier} of ${wrap.month.policies} with a carrier` : "";

  return (
    <>
      <Header period={period} day={day} today={today} badge={verdict} total={wrap.teamCents > 0 ? `${formatDollars(wrap.teamCents)} · ${wrap.policies} ${wrap.policies === 1 ? "policy" : "policies"}` : undefined} />

      {/* Player of the period */}
      {wrap.player ? (
        <div className="relative overflow-hidden rounded-[22px] bg-tide-strong p-4 text-white shadow-card">
          <Crown className="absolute top-4 right-4 h-7 w-7" />
          <Eyebrow className="text-white">{words.player}</Eyebrow>
          <p className="mt-1 font-mono text-[32px] leading-none font-bold tracking-[-0.03em]">{formatDollars(wrap.player.premiumCents)}</p>
          <div className="mt-2.5 flex items-center gap-3">
            <Avatar name={wrap.player.name} tone="bg-surface text-accent-text" size={36} />
            <div className="min-w-0">
              <p className="truncate text-[17px] leading-tight font-extrabold">{wrap.player.name}</p>
              <p className="truncate text-[12px] font-semibold">
                {wrap.player.policies} {wrap.player.policies === 1 ? "policy" : "policies"}
                {wrap.player.carriers.length > 0 && ` · ${carrierSummary(wrap.player.carriers)}`}
              </p>
            </div>
          </div>
          {best && (
            <p className="mt-2.5 truncate border-t border-on-grad-line pt-2 text-[12px] font-semibold">
              Best deal · {firstName(best.agentName)} · <span className="font-mono text-[13px]">{formatDollars(best.premiumCents)}</span>
              {best.policies > 1 && ` · ${best.policies} policies`}
              {best.carrier && ` · ${best.carrier}`}
              {best.product && ` · ${best.product}`}
              {/* A day shows the clock, and only when the sale was logged on its own day (not a past day or an import); a week or month shows the day. */}
              {view === "day" ? todayInDetroit(new Date(best.createdAt)) === best.soldOn && ` · ${formatClock(best.createdAt)}` : ` · ${formatDate(best.soldOn, { year: false })}`}
            </p>
          )}
        </div>
      ) : (
        <div className="rounded-[22px] bg-surface p-4 shadow-card">
          <Eyebrow>{words.player}</Eyebrow>
          <p className="mt-1.5 text-[17px] font-bold text-gray-900">{wrap.current ? words.nobodyNow : words.nobodyThen}</p>
        </div>
      )}

      {/* The month's top three carriers by policies (owner, 2026-10-29) */}
      <div className="mt-3 px-1">
        <Eyebrow>
          Top carriers · {asOf}
          {carrierNote}
        </Eyebrow>
      </div>
      <div className="mt-1.5 grid grid-cols-3 gap-2.5">
        {wrap.topCarriers.length === 0 ? (
          <div className="col-span-3 rounded-[18px] bg-surface px-4 py-3 text-[13px] font-semibold text-gray-600 shadow-card">
            {wrap.month.policies > 0 ? `${wrap.month.policies} ${wrap.month.policies === 1 ? "policy" : "policies"} in ${month}, none with a carrier.` : `No policies in ${month}${wrap.current ? " yet" : ""}.`}
          </div>
        ) : (
          wrap.topCarriers.map((c, i) => <CarrierSquare key={c.name} name={c.name} count={c.count} top={i === 0} />)
        )}
      </div>

      {/* Everybody: sold rows ranked; with a long roster the no-sale names fold into one line */}
      <ListCard className="mt-3 pt-2.5">
        <li className="px-4 pb-1">
          <Eyebrow>{wrap.current ? words.now : words.then}</Eyebrow>
        </li>
        {wrap.lines.length === 0 && <li className="px-4 py-3 text-[14px] text-gray-600">Nobody is on the board yet.</li>}
        {(fold ? sold : wrap.lines).map((l) => (
          <WrapRow key={l.id} line={l} />
        ))}
        {fold && quiet.length > 0 && (
          <li className={cn("px-4 py-2 text-[12px] font-semibold text-gray-500", ROW_INSET.plain)}>No sale: {quiet.map((l) => firstName(l.name)).join(", ")}</li>
        )}
      </ListCard>

      {/* The period's carriers (the month view's are the squares above) */}
      {view !== "month" && wrap.carriers.length > 0 && (
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
          {view === "month" ? (
            wrap.month.goalCents > 0 ? `${wrap.month.goalPct}% of the ${formatDollars(wrap.month.goalCents)} goal` : "No goal set"
          ) : (
            <>
              {wrap.month.policies} {wrap.month.policies === 1 ? "policy" : "policies"} in {month}
              {wrap.month.goalCents > 0 && ` · ${wrap.month.goalPct}% of the goal`}
            </>
          )}
        </span>
        <span className="shrink-0">Scorecard by TKG</span>
      </p>
    </>
  );
}

function verdictBadge(w: PeriodWrap): { text: string; tone: Tone } {
  const v = w.verdict;
  if (w.teamCents === 0 && v.kind !== "off_day") return { text: w.current ? "No sales yet" : "No sales", tone: "gray" };
  // One fact per pill; the period's total sits in the date line.
  if (v.kind === "won") return { text: `${WORDS[w.view].won} · needed ${formatDollars(v.neededCents)}`, tone: "green" };
  if (v.kind === "short") return { text: `${formatDollars(v.shortCents)} short of ${formatDollars(v.neededCents)}`, tone: "amber" };
  if (v.kind === "goal_hit") return { text: w.view === "month" ? "Goal hit" : "Goal already hit", tone: "green" };
  if (v.kind === "off_day") return { text: w.view === "day" ? (weekday(w.day) === 6 ? "Saturday" : "Sunday") : "Weekend", tone: "blue" };
  if (v.kind === "ahead") return { text: `Ahead by ${formatDollars(v.byCents)}`, tone: "green" };
  if (v.kind === "behind") return { text: `Behind by ${formatDollars(v.byCents)}`, tone: "amber" };
  if (v.kind === "on") return { text: "On the goal line", tone: "blue" };
  return { text: "No goal set", tone: "gray" };
}

/** One of the three carrier squares; the busiest carrier's count wears the accent. */
function CarrierSquare({ name, count, top }: { name: string; count: number; top: boolean }) {
  return (
    <div className="min-w-0 rounded-[18px] bg-surface px-3 py-2.5 shadow-card">
      <p className="truncate text-[12px] leading-tight font-bold text-gray-700">{name}</p>
      <p className="mt-1 truncate leading-none">
        <span className={cn("font-mono text-[22px] font-bold tracking-[-0.02em]", top ? "text-accent-text" : "text-gray-900")}>{count}</span>
        <span className="ml-1 text-[11px] font-semibold text-gray-500">{count === 1 ? "policy" : "policies"}</span>
      </p>
    </div>
  );
}

function WrapRow({ line }: { line: WrapLine }) {
  const sold = line.premiumCents > 0;
  const medal = line.rank === 1 ? "text-gold" : line.rank === 2 ? "text-silver" : line.rank === 3 ? "text-bronze" : "text-gray-500";
  return (
    <li className={cn("flex items-center gap-3 px-4 py-1", ROW_INSET.plain, !sold && "opacity-50")}>
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

/**
 * The Day / Week / Month switch with the arrows beside it, then the period and its total, then the
 * verdict. The switch stands where a title would (the tab bar names the screen), so the whole Wrap
 * still fits one screenshot.
 */
function Header({ period, day, today, badge, total }: { period: WrapPeriod; day: string; today: string; badge?: { text: string; tone: Tone }; total?: string }) {
  const { view } = period;
  const words = WORDS[view];
  const nav = periodNav(period, today);
  // The period reaches today: no way forward, and no need for the "Today" pill.
  const live = nav.next === null;
  const when = view === "day" ? dayLabelLong(day) : view === "week" ? rangeLabel(period.from, period.to) : `${monthName(monthKeyOf(day))}${live ? " so far" : ""}`;
  const arrow = "flex h-11 w-11 items-center justify-center rounded-full bg-surface text-gray-700 shadow-card hover:bg-gray-50";
  return (
    <div className="mb-3">
      <h1 className="sr-only">Wrap</h1>
      <div className="flex items-center justify-between gap-3">
        {/* The switch gives up a few pixels on a 375pt phone when the "This month" pill is out; the arrows never shrink. */}
        <nav aria-label="View" className="grid w-[210px] grid-cols-3 gap-1 rounded-2xl bg-track p-1">
          {WRAP_VIEWS.map((v) => (
            <Link
              key={v}
              href={wrapHref(v, day, today)}
              aria-current={v === view ? "true" : undefined}
              className={cn("flex h-9 items-center justify-center rounded-xl text-[13px] font-bold transition", v === view ? "bg-segment text-gray-900 shadow-card" : "text-gray-600 hover:text-gray-900")}
            >
              {WORDS[v].name}
            </Link>
          ))}
        </nav>
        <nav aria-label={words.name} className="flex shrink-0 items-center gap-1">
          <Link href={wrapHref(view, nav.prev, today)} aria-label={`Earlier ${view}`} className={arrow}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M15 6l-6 6 6 6" />
            </svg>
          </Link>
          {!live && (
            <Link href={wrapHref(view, today, today)} className="flex h-11 items-center rounded-full bg-surface px-3.5 text-[13px] font-bold whitespace-nowrap text-accent-text shadow-card hover:bg-gray-50">
              {words.here}
            </Link>
          )}
          <Link href={nav.next ? wrapHref(view, nav.next, today) : wrapHref(view, day, today)} aria-label={`Later ${view}`} aria-disabled={live} className={cn(arrow, live && "pointer-events-none opacity-40")}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M9 6l6 6-6 6" />
            </svg>
          </Link>
        </nav>
      </div>
      <p className="mt-2.5 text-[14px] font-medium text-gray-500">
        {when}
        {total && <span className="font-mono font-semibold text-gray-900"> · {total}</span>}
      </p>
      {badge && (
        <Badge tone={badge.tone} className="mt-1.5 max-w-full">
          {badge.text}
        </Badge>
      )}
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
