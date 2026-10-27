"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { AgentLine, FeedSale, MonthSnapshot } from "@/lib/board";
import { formatDollars, formatMoney } from "@/lib/money";
import { dayLabel } from "@/lib/month";
import { TEAM_TIME_ZONE } from "@/lib/timezone";
import { Avatar, firstName, shortName } from "@/components/avatar";
import { ScoreMark, TkgMark } from "@/components/brand";
import { MonthChart } from "@/components/month-chart";
import { cn, formatClock } from "@/components/ui";
import { burst } from "./confetti";

/**
 * The TV board. One screen, no scrolling, sized from the viewport (1em = about 1% of the width,
 * capped for 4K), so a 1080p TV, a 4K TV and a laptop all show the same layout. Polls /api/board
 * every few seconds; a sale that was not there before gets a celebration with confetti.
 * Keys: F full screen, T light/dark. The cursor hides after a few seconds still.
 */
const POLL_MS = 5000;
const CELEBRATE_MS = 9000;

function useClock(): string {
  const [now, setNow] = useState("");
  useEffect(() => {
    const fmt = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: TEAM_TIME_ZONE });
    const tick = () => setNow(fmt.format(new Date()));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

/** Keeps the TV from sleeping where the browser allows it (Chrome and Safari on a Mac do). */
function useWakeLock() {
  useEffect(() => {
    let lock: { release: () => Promise<void> } | null = null;
    const request = async () => {
      try {
        const nav = navigator as Navigator & { wakeLock?: { request: (t: "screen") => Promise<{ release: () => Promise<void> }> } };
        if (!nav.wakeLock || document.visibilityState !== "visible") return;
        lock = await nav.wakeLock.request("screen");
      } catch {
        lock = null;
      }
    };
    request();
    document.addEventListener("visibilitychange", request);
    return () => {
      document.removeEventListener("visibilitychange", request);
      lock?.release().catch(() => {});
    };
  }, []);
}

function useIdleCursor() {
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const wake = () => {
      document.body.classList.remove("board-idle");
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => document.body.classList.add("board-idle"), 3500);
    };
    wake();
    window.addEventListener("mousemove", wake);
    return () => {
      window.removeEventListener("mousemove", wake);
      if (timer) clearTimeout(timer);
      document.body.classList.remove("board-idle");
    };
  }, []);
}

function applyTheme(choice: "light" | "dark" | null) {
  const root = document.documentElement;
  if (!choice) root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", choice);
  try {
    if (!choice) localStorage.removeItem("theme");
    else localStorage.setItem("theme", choice);
  } catch {
    /* private mode */
  }
}

export function BoardView({ initial, theme }: { initial: MonthSnapshot; theme: "light" | "dark" | null }) {
  const router = useRouter();
  const [snap, setSnap] = useState(initial);
  const [offline, setOffline] = useState(0);
  const [showing, setShowing] = useState<FeedSale | null>(null);
  const known = useRef<Set<string>>(new Set(initial.recent.map((r) => r.id)));
  // Sales waiting for their moment, and the timer of the one on screen.
  const queue = useRef<FeedSale[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clock = useClock();
  useWakeLock();
  useIdleCursor();

  // The board is dark unless the address or this browser's saved choice says light.
  useEffect(() => {
    if (theme) applyTheme(theme);
    else {
      let saved: string | null = null;
      try {
        saved = localStorage.getItem("theme");
      } catch {
        saved = null;
      }
      if (saved !== "light" && saved !== "dark") document.documentElement.setAttribute("data-theme", "dark");
    }
  }, [theme]);

  // Keys: F full screen, T flips light and dark.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "f" || e.key === "F") {
        if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
        else document.documentElement.requestFullscreen?.().catch(() => {});
      }
      if (e.key === "t" || e.key === "T") {
        applyTheme(document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // One celebration at a time: the next one starts when the timer of the last one ends.
  const showNext = useCallback(function showNext() {
    const next = queue.current.shift() ?? null;
    setShowing(next);
    timer.current = next ? setTimeout(showNext, CELEBRATE_MS) : null;
  }, []);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/board", { cache: "no-store" });
      if (res.status === 401) {
        router.push("/login?next=/board");
        return;
      }
      if (!res.ok) throw new Error(String(res.status));
      const next = (await res.json()) as MonthSnapshot;
      setOffline(0);
      // New sales, oldest first, each gets its moment.
      const fresh = next.recent.filter((r) => !known.current.has(r.id)).reverse();
      for (const r of next.recent) known.current.add(r.id);
      setSnap(next);
      if (fresh.length) {
        queue.current.push(...fresh);
        if (!timer.current) showNext();
      }
    } catch {
      setOffline((n) => n + 1);
    }
  }, [router, showNext]);

  useEffect(() => {
    const id = setInterval(refresh, POLL_MS);
    return () => clearInterval(id);
  }, [refresh]);

  const { team, clock: month, agents } = snap;
  const leaders = agents.filter((a) => a.active || a.premiumCents > 0);
  const maxPremium = Math.max(1, ...leaders.map((a) => a.premiumCents));
  const toneById = Object.fromEntries(agents.map((a) => [a.id, a.tone]));

  return (
    <main
      className="relative flex h-dvh w-full flex-col overflow-hidden bg-ink px-[1.6em] pt-[1em] pb-[0.9em] text-gray-900 select-none"
      style={{ fontSize: "clamp(10px, min(1vw, 1.78vh), 36px)" }}
    >
      {/* Header */}
      <header className="flex shrink-0 items-center justify-between gap-[1em]">
        <BoardLockup />
        <div className="text-center">
          <p className="text-[1.75em] leading-none font-extrabold tracking-[-0.03em]">{month.label}</p>
          <p className="mt-[0.3em] text-[0.95em] font-semibold text-gray-500">{dayLabel(month.today)}</p>
        </div>
        <div className="flex items-center gap-[0.8em]">
          {month.position === "current" && (
            <span className={cn("rounded-full px-[0.9em] py-[0.35em] text-[0.9em] font-bold", month.remaining <= 3 ? "bg-amber-100 text-amber-800" : "bg-tint text-accent-text")}>
              {month.remaining} business {month.remaining === 1 ? "day" : "days"} left
            </span>
          )}
          <p className="min-w-[4.6em] text-right font-mono text-[1.75em] leading-none font-bold tracking-[-0.02em]">{clock}</p>
        </div>
      </header>

      {/* Body */}
      <div className="mt-[0.9em] grid min-h-0 flex-1 grid-cols-12 gap-[1em]">
        {/* Leaderboard */}
        <section className="col-span-7 flex min-h-0 flex-col rounded-[1.4em] bg-surface p-[1.1em] shadow-card">
          <div className="flex items-baseline justify-between">
            <h2 className="text-[1.25em] font-extrabold tracking-[-0.02em]">Leaderboard</h2>
            <p className="text-[0.85em] font-semibold text-gray-500">annual premium · policies</p>
          </div>
          {leaders.length === 0 ? (
            <p className="flex flex-1 items-center justify-center text-[1.2em] font-semibold text-gray-500">Add your team in Scorecard on your phone.</p>
          ) : (
            <ol className="mt-[0.6em] flex min-h-0 flex-1 flex-col gap-[0.45em]">
              {leaders.map((a) => (
                <LeaderRow key={a.id} line={a} max={maxPremium} count={leaders.length} today={month.position === "current"} />
              ))}
            </ol>
          )}
        </section>

        {/* Right column */}
        <div className="col-span-5 flex min-h-0 flex-col gap-[1em]">
          <GoalCard snap={snap} />
          <section className="grid shrink-0 grid-cols-3 gap-[0.7em]">
            <Tile label={month.position === "current" ? "Today" : "Best day"} value={month.position === "current" ? formatDollars(team.todayCents) : team.bestDay ? formatDollars(team.bestDay.cents) : "–"} sub={month.position === "current" ? `${team.todayPolicies} ${team.todayPolicies === 1 ? "policy" : "policies"}` : team.bestDay ? dayLabel(team.bestDay.date) : ""} tone={team.todayCents > 0 ? "up" : undefined} />
            <Tile label="Policies" value={String(team.policies)} sub={team.averageCents ? `${formatDollars(team.averageCents)} avg` : "this month"} />
            <Tile
              label={team.pace.status === "done" ? "Over the goal" : team.goalCents > 0 ? "Needed a day" : "On pace for"}
              value={team.pace.status === "done" ? formatDollars(team.productionCents - team.goalCents) : team.goalCents > 0 ? formatDollars(team.pace.neededPerDayCents) : formatDollars(team.pace.projectedCents)}
              sub={team.pace.status === "done" ? "keep going" : team.goalCents > 0 ? `to hit ${formatDollars(team.goalCents)}` : "set a goal in Settings"}
            />
          </section>
          <section className="min-h-0 flex-1 rounded-[1.4em] bg-surface p-[1em] shadow-card">
            <div className="flex items-baseline justify-between">
              <h2 className="text-[1.05em] font-extrabold tracking-[-0.02em]">The month so far</h2>
              <p className="text-[0.8em] font-semibold text-gray-500">
                <span className="mr-[0.5em] inline-block h-[0.55em] w-[1.4em] rounded-full bg-chart-1 align-middle" />
                production
                <span className="mr-[0.5em] ml-[1em] inline-block h-[0.55em] w-[1.4em] rounded-full bg-chart-2 align-middle" />
                goal line
              </p>
            </div>
            <MonthChart daily={snap.daily} goalCents={team.goalCents} today={month.today} height={150} className="mt-[0.4em] h-[calc(100%-1.8em)] w-full" />
          </section>
          <Feed sales={snap.recent.filter((r) => r.soldOn.slice(0, 7) === month.key).slice(0, 4)} tones={toneById} today={month.today} />
        </div>
      </div>

      {/* Footer */}
      <footer className="mt-[0.8em] flex shrink-0 items-center justify-between gap-[1em] text-[0.85em] font-semibold text-gray-500">
        <p className="min-w-0 truncate text-[1.1em] font-bold text-gray-700">{snap.message || " "}</p>
        <p className="shrink-0">
          {offline >= 3 ? <span className="text-amber-800">Reconnecting…</span> : <>Updated {formatClock(snap.generatedAt)}</>}
          <span className="ml-[1em] text-gray-400">F full screen · T light/dark</span>
        </p>
      </footer>

      {showing && <Celebration sale={showing} />}
    </main>
  );
}

/** The lockup at the board's size: the mark, "Scorecard", "by TKG" (all in em, so it scales with the TV). */
function BoardLockup() {
  return (
    <div className="flex items-center gap-[0.7em]">
      <ScoreMark size={64} className="!h-[2.9em] !w-[2.9em] !rounded-[0.8em] [&>svg]:!h-[2.9em] [&>svg]:!w-[2.9em]" />
      <div className="flex flex-col leading-none">
        <span className="text-[1.6em] font-extrabold tracking-[-0.03em] text-gray-900">Scorecard</span>
        <span className="mt-[0.2em] flex items-center gap-[0.3em] text-[0.7em] font-medium text-gray-500">
          by <TkgMark height={12} className="!h-[0.95em] !w-auto text-gray-700" />
        </span>
      </div>
    </div>
  );
}

function LeaderRow({ line, max, count, today }: { line: AgentLine; max: number; count: number; today: boolean }) {
  const pct = line.goalCents > 0 ? Math.min(100, line.goalPct) : Math.round((line.premiumCents / max) * 100);
  const first = line.rank === 1 && line.premiumCents > 0;
  const medal = line.premiumCents > 0 ? (line.rank === 1 ? "text-gold" : line.rank === 2 ? "text-silver" : line.rank === 3 ? "text-bronze" : "text-gray-500") : "text-gray-400";
  // Fewer people, taller rows: the type grows a little when there is room.
  const scale = count <= 5 ? 1.15 : count <= 7 ? 1 : 0.86;
  return (
    <li className={cn("flex min-h-0 flex-1 items-center gap-[0.9em] rounded-[1em] px-[0.8em]", first && "bg-tint/60")} style={{ fontSize: `${scale}em` }}>
      <span className={cn("w-[1.4em] shrink-0 text-center font-mono text-[1.4em] font-bold", medal)}>{first ? <Crown /> : line.rank}</span>
      <Avatar name={line.name} tone={line.tone} size={44} className="!h-[2.6em] !w-[2.6em] !text-[0.95em]" />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-[1em]">
          <p className="truncate text-[1.35em] leading-tight font-extrabold tracking-[-0.02em]">{line.name.length > 18 ? shortName(line.name) : line.name}</p>
          <p className="shrink-0 font-mono text-[1.5em] leading-none font-bold tracking-[-0.02em]">{formatDollars(line.premiumCents)}</p>
        </div>
        <div className="mt-[0.45em] flex items-center gap-[0.8em]">
          <div className="h-[0.55em] flex-1 overflow-hidden rounded-full bg-track">
            <div className={cn("h-full rounded-full transition-[width] duration-700", first ? "bg-tide" : "bg-blue-300")} style={{ width: `${pct}%` }} />
          </div>
          <p className="w-[9.5em] shrink-0 text-right text-[0.85em] font-semibold whitespace-nowrap text-gray-500">
            {line.policies} {line.policies === 1 ? "policy" : "policies"}
            {line.goalCents > 0 ? ` · ${line.goalPct}%` : ""}
          </p>
          {today && line.todayCents > 0 && <span className="shrink-0 rounded-full bg-green-100 px-[0.6em] py-[0.15em] font-mono text-[0.8em] font-bold text-green-800">+{formatDollars(line.todayCents)}</span>}
        </div>
      </div>
    </li>
  );
}

function Crown() {
  return (
    <svg viewBox="0 0 24 24" className="inline-block h-[1em] w-[1em] fill-current" aria-label="First">
      <path d="M3 8l4.5 4L12 5l4.5 7L21 8l-2 11H5z" />
    </svg>
  );
}

function GoalCard({ snap }: { snap: MonthSnapshot }) {
  const { team, clock } = snap;
  const pct = team.goalCents > 0 ? Math.min(100, team.goalPct) : 0;
  const r = 44;
  const c = 2 * Math.PI * r;
  const { pace } = team;
  let line: string;
  let tone: string;
  if (clock.position === "past") {
    line = team.goalCents <= 0 ? "Finished" : team.productionCents >= team.goalCents ? "Goal hit" : `${formatDollars(team.goalCents - team.productionCents)} short`;
    tone = team.productionCents >= team.goalCents && team.goalCents > 0 ? "text-up" : "text-gray-600";
  } else if (pace.status === "none") {
    line = clock.elapsed > 0 ? `On pace for ${formatDollars(pace.projectedCents)}` : "The month starts soon";
    tone = "text-gray-600";
  } else if (pace.status === "done") {
    line = `Goal hit, ${formatDollars(team.productionCents - team.goalCents)} over`;
    tone = "text-up";
  } else if (pace.status === "ahead") {
    line = `Ahead by ${formatDollars(pace.aheadCents)} · on pace for ${formatDollars(pace.projectedCents)}`;
    tone = "text-up";
  } else if (pace.status === "on") {
    line = `Right on the line · on pace for ${formatDollars(pace.projectedCents)}`;
    tone = "text-accent-text";
  } else {
    line = `Behind by ${formatDollars(-pace.aheadCents)} · on pace for ${formatDollars(pace.projectedCents)}`;
    tone = "text-down";
  }
  return (
    <section className="flex shrink-0 items-center gap-[1.2em] rounded-[1.4em] bg-surface p-[1.1em] shadow-card">
      <div className="relative h-[8.4em] w-[8.4em] shrink-0">
        <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90">
          <defs>
            <linearGradient id="ring-grad" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" style={{ stopColor: "var(--t-grad-from)" }} />
              <stop offset="1" style={{ stopColor: "var(--t-grad-to)" }} />
            </linearGradient>
          </defs>
          <circle cx="50" cy="50" r={r} fill="none" className="stroke-track" strokeWidth="9" />
          <circle
            key={pct}
            cx="50"
            cy="50"
            r={r}
            fill="none"
            stroke="url(#ring-grad)"
            strokeWidth="9"
            strokeLinecap="round"
            strokeDasharray={c}
            strokeDashoffset={c * (1 - pct / 100)}
            style={{ transition: "stroke-dashoffset 900ms cubic-bezier(0.2, 0.8, 0.2, 1)" }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="font-mono text-[2em] leading-none font-bold tracking-[-0.03em]">{team.goalCents > 0 ? `${team.goalPct}%` : "–"}</span>
          <span className="mt-[0.3em] text-[0.7em] font-bold tracking-[0.08em] text-gray-500 uppercase">of goal</span>
        </div>
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[0.8em] font-bold tracking-[0.09em] text-gray-500 uppercase">Team production</p>
        <p key={team.productionCents} className="board-pop mt-[0.15em] font-mono text-[2.9em] leading-none font-bold tracking-[-0.035em]">
          {formatDollars(team.productionCents)}
        </p>
        <p className="mt-[0.35em] text-[1em] font-semibold text-gray-500">{team.goalCents > 0 ? `of ${formatDollars(team.goalCents)}` : "no goal set yet"}</p>
        <p className={cn("mt-[0.5em] text-[1em] leading-snug font-bold", tone)}>{line}</p>
      </div>
    </section>
  );
}

function Tile({ label, value, sub, tone }: { label: string; value: string; sub: string; tone?: "up" }) {
  return (
    <div className="rounded-[1.2em] bg-surface px-[0.9em] py-[0.8em] shadow-card">
      <p className="text-[0.75em] font-bold tracking-[0.08em] text-gray-500 uppercase">{label}</p>
      <p className={cn("mt-[0.2em] truncate font-mono text-[1.7em] leading-none font-bold tracking-[-0.03em]", tone === "up" ? "text-up" : "text-gray-900")}>{value}</p>
      <p className="mt-[0.35em] truncate text-[0.8em] font-semibold text-gray-500">{sub}</p>
    </div>
  );
}

function Feed({ sales, tones, today }: { sales: FeedSale[]; tones: Record<string, string>; today: string }) {
  return (
    <section className="shrink-0 rounded-[1.4em] bg-surface p-[1em] shadow-card">
      <h2 className="text-[1.05em] font-extrabold tracking-[-0.02em]">Latest sales</h2>
      {sales.length === 0 ? (
        <p className="mt-[0.5em] text-[0.95em] font-semibold text-gray-500">The first sale of the month lights this up.</p>
      ) : (
        <ul className="mt-[0.5em] space-y-[0.35em]">
          {sales.map((s, i) => (
            <li key={s.id} className={cn("flex items-center gap-[0.7em] rounded-[0.8em] px-[0.4em] py-[0.25em]", i === 0 && "board-flash")}>
              <Avatar name={s.agentName} tone={tones[s.agentId]} size={32} className="!h-[2em] !w-[2em] !text-[0.75em]" />
              <p className="min-w-0 flex-1 truncate text-[1em] font-bold">
                {firstName(s.agentName)}
                <span className="font-semibold text-gray-500">
                  {s.client ? ` · ${s.client}` : ""}
                  {s.product ? ` · ${s.product}` : ""}
                  {s.policies > 1 ? ` · ${s.policies} policies` : ""}
                </span>
              </p>
              <p className="shrink-0 text-[0.8em] font-semibold text-gray-500">{s.soldOn === today ? formatClock(s.createdAt) : dayLabel(s.soldOn)}</p>
              <p className="shrink-0 font-mono text-[1.1em] font-bold">{formatMoney(s.premiumCents)}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Celebration({ sale }: { sale: FeedSale }) {
  const canvas = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    if (!canvas.current) return;
    const stop = burst(canvas.current, { count: 320, duration: CELEBRATE_MS - 1500 });
    return stop;
  }, [sale.id]);
  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-ink/70" role="status" aria-live="polite">
      <canvas ref={canvas} className="pointer-events-none absolute inset-0 h-full w-full" />
      <div className="board-pop relative flex flex-col items-center rounded-[2em] bg-surface px-[3.2em] py-[2.4em] text-center shadow-float">
        <Avatar name={sale.agentName} tone="bg-tide text-white shadow-glow" size={96} className="!h-[6em] !w-[6em] !text-[2.2em]" />
        <p className="mt-[0.9em] text-[1.1em] font-bold tracking-[0.1em] text-accent-text uppercase">New sale</p>
        <p className="mt-[0.2em] text-[2.8em] leading-tight font-extrabold tracking-[-0.03em]">{sale.agentName}</p>
        <p className="mt-[0.4em] font-mono text-[3.6em] leading-none font-bold tracking-[-0.035em] text-gray-900">{formatMoney(sale.premiumCents)}</p>
        <p className="mt-[0.6em] text-[1.2em] font-semibold text-gray-500">
          annual premium
          {sale.product ? ` · ${sale.product}` : ""}
          {sale.client ? ` · for ${sale.client}` : ""}
          {sale.policies > 1 ? ` · ${sale.policies} policies` : ""}
        </p>
      </div>
    </div>
  );
}
