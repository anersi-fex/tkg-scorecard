"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { AgentLine, FeedSale, MonthSnapshot } from "@/lib/board";
import type { BoardTheme } from "@/lib/types";
import { formatDollars, formatMoney } from "@/lib/money";
import { dayLabel, daysLeftLabel, monthName } from "@/lib/month";
import { TEAM_TIME_ZONE } from "@/lib/timezone";
import { Avatar, firstName, shortName } from "@/components/avatar";
import { ScoreMark, TkgMark } from "@/components/brand";
import { GoalBar } from "@/components/goal-bar";
import { KindDot, KindSplit, PcTag } from "@/components/kind";
import { MonthChart } from "@/components/month-chart";
import { cn, formatClock } from "@/components/ui";
import { burst } from "./confetti";
import { soundFile, type SoundKey } from "@/lib/sounds";
import { SCREEN_MS, VIEWS, VIEW_LABEL, lifeDaily, linesSummary, nextScreen, screenFor, type View } from "@/lib/views";

/**
 * The TV board. One screen, no scrolling, sized from the viewport (1em = about 1% of the width,
 * capped for 4K), so a 1080p TV, a 4K TV and a laptop all show the same layout. Polls /api/board
 * every few seconds; a sale that was not there before gets a celebration with confetti.
 * Dark or light is the owner's TV look (Settings), applied before paint and again from every poll,
 * so the TV follows a change within 5 s; nothing on the TV itself changes it. When a poll comes
 * from a newer deploy the page reloads itself once, so the TV never runs last week's code. Key: F
 * full screen. The cursor hides after a few seconds still.
 */
const POLL_MS = 5000;
const CELEBRATE_MS = 9000;
/** A long sound fades out this long before the celebration leaves, so it is never cut mid-note. */
const SOUND_FADE_MS = 700;

/**
 * A tenth of a second of silence as a WAV (8 kHz, 8-bit, mono) in a data address: the board's sound
 * check. A data address needs no fetch and nothing to clean up (a revoked blob address would still be
 * fetched after a refused play and log an error).
 */
function silence(): string {
  const n = 800;
  const bytes = new Uint8Array(44 + n);
  const view = new DataView(bytes.buffer);
  const word = (at: number, s: string) => [...s].forEach((ch, i) => (bytes[at + i] = ch.charCodeAt(0)));
  word(0, "RIFF");
  view.setUint32(4, 36 + n, true);
  word(8, "WAVE");
  word(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, 8000, true);
  view.setUint32(28, 8000, true);
  view.setUint16(32, 1, true);
  view.setUint16(34, 8, true);
  word(36, "data");
  view.setUint32(40, n, true);
  bytes.fill(128, 44); // 8-bit silence sits at the midpoint
  let text = "";
  for (const b of bytes) text += String.fromCharCode(b);
  return `data:audio/wav;base64,${btoa(text)}`;
}

/** True only for the browser's "no sound before a click" answer, not a load error or an interrupted play. */
function isAutoplayRefusal(err: unknown): boolean {
  return err instanceof DOMException && err.name === "NotAllowedError";
}

/**
 * Browsers play sound only after someone clicked or pressed a key on the page (F for full screen
 * counts), unless the site may auto-play (Safari > Settings > Websites > Auto-Play). The board asks
 * the browser at load with a tenth of a second of silence, so the footer says so before a sale
 * goes quiet (the board reloads itself after a deploy, which can lose the earlier click). A click,
 * a key or any sound that plays clears it.
 */
function useSoundGate(soundOn: boolean): { blocked: boolean; refused: () => void; played: () => void } {
  const [blocked, setBlocked] = useState(false);
  useEffect(() => {
    const allow = () => setBlocked(false);
    window.addEventListener("pointerdown", allow);
    window.addEventListener("keydown", allow);
    return () => {
      window.removeEventListener("pointerdown", allow);
      window.removeEventListener("keydown", allow);
    };
  }, []);
  useEffect(() => {
    if (!soundOn) return;
    let live = true;
    const check = new Audio(silence());
    check.play().then(
      () => check.pause(),
      (err: unknown) => {
        if (live && isAutoplayRefusal(err)) setBlocked(true);
      },
    );
    return () => {
      live = false;
      check.pause();
    };
  }, [soundOn]);
  const refused = useCallback(() => setBlocked(true), []);
  const played = useCallback(() => setBlocked(false), []);
  return { blocked, refused, played };
}

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

/** The TV's look lives on <html> only, never in this browser's storage: Settings is the source. */
function applyTheme(choice: BoardTheme) {
  document.documentElement.setAttribute("data-theme", choice);
}

export function BoardView({ initial }: { initial: MonthSnapshot }) {
  const router = useRouter();
  const [snap, setSnap] = useState(initial);
  const [offline, setOffline] = useState(0);
  const [showing, setShowing] = useState<FeedSale | null>(null);
  const known = useRef<Set<string>>(new Set(initial.recent.map((r) => r.id)));
  // Sales waiting for their moment, and the timer of the one on screen.
  const queue = useRef<FeedSale[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reloading = useRef(false);
  const clock = useClock();
  useWakeLock();
  useIdleCursor();

  // The owner's TV look from the latest poll (a change in Settings reaches the TV within 5 s).
  // THEME_SCRIPT already applied it before the first paint.
  useEffect(() => {
    applyTheme(snap.boardTheme);
  }, [snap.boardTheme]);

  // The owner's colorway from the latest poll (a change in Settings reaches the TV within 5 s).
  useEffect(() => {
    document.documentElement.setAttribute("data-colorway", snap.colorway);
  }, [snap.colorway]);

  // Key: F full screen.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "f" || e.key === "F") {
        if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
        else document.documentElement.requestFullscreen?.().catch(() => {});
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
      // A new deploy is live: the TV was opened once and left, so it reloads itself (once) to run it.
      if (next.build && initial.build && next.build !== initial.build && !reloading.current) {
        reloading.current = true;
        window.location.reload();
        return;
      }
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
  }, [router, showNext, initial.build]);

  useEffect(() => {
    const id = setInterval(refresh, POLL_MS);
    return () => clearInterval(id);
  }, [refresh]);

  const { team, clock: month } = snap;
  const sound = useSoundGate(snap.sound !== "off");
  // Fetch the chosen sound ahead of time, so the first celebration does not wait on a download.
  useEffect(() => {
    const file = soundFile(snap.sound);
    if (!file) return;
    const a = new Audio();
    a.preload = "auto";
    a.src = file;
    a.load();
  }, [snap.sound]);

  // The three screens (owner, 2026-11-04): life for a minute, then P&C and the agency total for 15 s
  // each; or the one screen the owner keeps the TV on (Settings > TV screens, from the poll). With no
  // P&C this month the TV stays on life.
  const hasPc = team.pcCents > 0;
  const rotate = snap.tvScreens === "rotate";
  const [rotating, setRotating] = useState<View>("life");
  const [turn, setTurn] = useState(0);
  useEffect(() => {
    if (!rotate) return;
    const id = setTimeout(
      () => {
        setRotating((r) => nextScreen(r, hasPc));
        setTurn((t) => t + 1);
      },
      SCREEN_MS[hasPc ? rotating : "life"],
    );
    return () => clearTimeout(id);
  }, [rotate, rotating, hasPc, turn]);
  const screen = screenFor(snap.tvScreens, hasPc ? rotating : "life");
  const tones = Object.fromEntries(snap.agents.map((a) => [a.id, a.tone]));

  return (
    <main
      data-screen={screen}
      className="relative flex h-dvh w-full flex-col overflow-hidden bg-ink px-[1.6em] pt-[1em] pb-[0.9em] text-gray-900 select-none"
      style={{ fontSize: "clamp(10px, min(1vw, 1.78vh), 36px)" }}
    >
      {/* Header */}
      <header className="flex shrink-0 items-center justify-between gap-[1em]">
        <BoardLockup />
        <div className="flex flex-col items-center text-center">
          <p className="text-[1.75em] leading-none font-extrabold tracking-[-0.03em]">{month.label}</p>
          <ScreenPills screen={screen} all={rotate} timed={rotate && hasPc} turn={turn} />
        </div>
        <div className="flex items-center gap-[0.8em]">
          {month.position === "current" && (
            <span className={cn("rounded-full px-[0.9em] py-[0.35em] text-[0.9em] font-bold", month.remaining <= 2 ? "bg-amber-100 text-amber-800" : "bg-tint text-accent-text")}>
              {daysLeftLabel(month)}
            </span>
          )}
          <div className="flex flex-col items-end">
            <p className="min-w-[4.6em] text-right font-mono text-[1.75em] leading-none font-bold tracking-[-0.02em]">{clock}</p>
            <p className="mt-[0.3em] text-[0.9em] leading-none font-semibold text-gray-500">{dayLabel(month.today)}</p>
          </div>
        </div>
      </header>

      {screen === "pc" ? <PcScreen snap={snap} tones={tones} /> : <MainScreen snap={snap} view={screen} tones={tones} />}

      {/* Footer */}
      <footer className="mt-[0.8em] flex shrink-0 items-center justify-between gap-[1em] text-[0.85em] font-semibold text-gray-500">
        <p className="min-w-0 truncate text-[1.1em] font-bold text-gray-700">{snap.message || " "}</p>
        <p className="shrink-0">
          {offline >= 3 ? <span className="text-amber-800">Reconnecting…</span> : <>Updated {formatClock(snap.generatedAt)}</>}
          {sound.blocked && snap.sound !== "off" && <span className="ml-[1em] text-amber-800">Click or press a key once for sound</span>}
          <span className="ml-[1em] text-gray-500">F full screen</span>
        </p>
      </footer>

      {showing && <Celebration sale={showing} sound={snap.sound} onRefused={sound.refused} onPlayed={sound.played} />}
    </main>
  );
}

/** The dot of a view: the brand accent for life, P&C's color, both halves for the agency total. */
function ViewDot({ view, className }: { view: View; className?: string }) {
  if (view === "total") {
    return (
      <span aria-hidden className={cn("inline-flex shrink-0 overflow-hidden rounded-full", className)}>
        <span className="h-full w-1/2 bg-accent" />
        <span className="h-full w-1/2 bg-pc" />
      </span>
    );
  }
  return <KindDot kind={view} className={className} />;
}

/**
 * The screens under the month: all three while the TV rotates, the one on screen lit with a line
 * that runs out with its time; only the kept screen when the owner keeps the TV on one.
 */
function ScreenPills({ screen, all, timed, turn }: { screen: View; all: boolean; timed: boolean; turn: number }) {
  const shown = all ? VIEWS : [screen];
  return (
    <div className="mt-[0.45em] inline-flex gap-[0.3em] rounded-full bg-track p-[0.22em]">
      {shown.map((v) => {
        const on = v === screen;
        return (
          <span
            key={v}
            data-pill={v}
            aria-current={on ? "true" : undefined}
            className={cn(
              "relative inline-flex items-center overflow-hidden rounded-full px-[1.05em] pt-[0.28em] pb-[0.34em] text-[0.95em] font-bold whitespace-nowrap",
              on ? "bg-segment shadow-card" : "text-gray-500",
              on && (v === "life" ? "text-accent-text" : v === "pc" ? "text-pc-text" : "text-gray-900"),
            )}
          >
            <ViewDot view={v} className="mr-[0.45em] h-[0.5em] w-[0.5em]" />
            {VIEW_LABEL[v]}
            {on && timed && <span key={turn} aria-hidden className="board-timer absolute bottom-0 left-0 h-[0.17em] w-full rounded-full bg-current opacity-80" style={{ animationDuration: `${SCREEN_MS[v]}ms` }} />}
          </span>
        );
      })}
    </div>
  );
}

/** The life screen and the agency total: the same board, measured in life alone or with P&C added. */
function MainScreen({ snap, view, tones }: { snap: MonthSnapshot; view: "life" | "total"; tones: Record<string, string> }) {
  const { team, clock: month } = snap;
  const life = view === "life";
  const amountOf = (a: AgentLine) => (life ? a.lifeCents : a.premiumCents);
  const people = (life ? snap.agents : [...snap.agents].sort((a, b) => a.totalRank - b.totalRank)).filter((a) => a.active || amountOf(a) > 0);
  const max = Math.max(1, ...people.map(amountOf));
  // The goal line today, the same tick on every bar: how far through its business days the month is.
  const goalLine = month.position === "current" && month.elapsed > 0 && people.some((a) => a.goalCents > 0) ? Math.round(month.progress * 100) : null;
  const split = !life && team.pcCents > 0;
  const current = month.position === "current";
  const feed = snap.recent.filter((r) => r.soldOn.slice(0, 7) === month.key && (!life || r.kind !== "pc")).slice(0, 4);
  return (
    <div className="mt-[0.9em] grid min-h-0 flex-1 grid-cols-12 gap-[1em]">
      {/* Leaderboard */}
      <section className="col-span-7 flex min-h-0 flex-col rounded-[1.4em] bg-surface p-[1.1em] shadow-card">
        <div className="flex items-baseline justify-between">
          <h2 className="flex items-center gap-[0.45em] text-[1.25em] font-extrabold tracking-[-0.02em]">
            <ViewDot view={view} className="h-[0.5em] w-[0.5em]" />
            {life ? "Life leaderboard" : "Agency leaderboard"}
          </h2>
          <p className="flex items-center gap-[0.45em] text-[0.85em] font-semibold text-gray-500">
            {split && (
              <>
                <KindDot kind="life" className="h-[0.5em] w-[0.5em]" />
                life
                <KindDot kind="pc" className="ml-[0.3em] h-[0.5em] w-[0.5em]" />
                P&C
                <span aria-hidden>·</span>
              </>
            )}
            {goalLine !== null && (
              <>
                <span aria-hidden className="inline-block h-[0.9em] w-[0.12em] rounded-full bg-gray-500" />
                goal line today
                <span aria-hidden>·</span>
              </>
            )}
            {life ? "annual premium · policies" : "life + P&C"}
          </p>
        </div>
        {people.length === 0 ? (
          <p className="flex flex-1 items-center justify-center text-[1.2em] font-semibold text-gray-500">Add your team in Scorecard on your phone.</p>
        ) : (
          <ol className="mt-[0.6em] flex min-h-0 flex-1 flex-col gap-[0.45em]">
            {people.map((a) => (
              <LeaderRow key={a.id} line={a} view={view} max={max} count={people.length} today={current} goalLine={goalLine} />
            ))}
          </ol>
        )}
      </section>

      {/* Right column */}
      <div className="col-span-5 flex min-h-0 flex-col gap-[1em]">
        <GoalCard snap={snap} view={view} />
        <section className="grid shrink-0 grid-cols-3 gap-[0.7em]">
          {life ? (
            <>
              <Tile
                label={current ? "Today" : "Best day"}
                value={current ? formatDollars(team.todayLifeCents) : team.bestLifeDay ? formatDollars(team.bestLifeDay.cents) : "–"}
                sub={current ? `${team.todayLifePolicies} ${team.todayLifePolicies === 1 ? "policy" : "policies"}` : team.bestLifeDay ? dayLabel(team.bestLifeDay.date) : ""}
                tone={current && team.todayLifeCents > 0 ? "up" : undefined}
              />
              <Tile label="Policies" value={String(team.lifePolicies)} sub={team.lifeAverageCents ? `${formatDollars(team.lifeAverageCents)} avg` : "this month"} />
              <NeededTile snap={snap} />
            </>
          ) : (
            <>
              <Tile
                label={current ? "Today" : "Best day"}
                value={current ? formatDollars(team.todayCents) : team.bestDay ? formatDollars(team.bestDay.cents) : "–"}
                sub={current ? `${team.todayPolicies} ${team.todayPolicies === 1 ? "policy" : "policies"}${team.todayPcPolicies > 0 ? ` · ${team.todayPcPolicies} P&C` : ""}` : team.bestDay ? dayLabel(team.bestDay.date) : ""}
                tone={current && team.todayCents > 0 ? "up" : undefined}
              />
              <Tile label="Policies" value={String(team.policies)} sub={team.pcPolicies > 0 ? `${team.lifePolicies} life · ${team.pcPolicies} P&C` : "this month"} />
              <Tile label="Avg premium" value={team.averageCents ? formatDollars(team.averageCents) : "–"} sub="per policy" />
            </>
          )}
        </section>
        <section className="min-h-0 flex-1 rounded-[1.4em] bg-surface p-[1em] shadow-card">
          <div className="flex items-baseline justify-between">
            <h2 className="text-[1.05em] font-extrabold tracking-[-0.02em]">The month so far</h2>
            <p className="text-[0.8em] font-semibold text-gray-500">
              <span className="mr-[0.5em] inline-block h-[0.55em] w-[1.4em] rounded-full bg-chart-1 align-middle" />
              {life ? "life production" : "life + P&C"}
              <span className="mr-[0.5em] ml-[1em] inline-block h-[0.55em] w-[1.4em] rounded-full bg-chart-2 align-middle" />
              goal line
            </p>
          </div>
          <MonthChart daily={life ? lifeDaily(snap.daily) : snap.daily} goalCents={team.goalCents} today={month.today} height={150} className="mt-[0.4em] h-[calc(100%-1.8em)] w-full" />
        </section>
        <Feed title={life ? "Latest life sales" : "Latest sales"} sales={feed} tones={tones} today={month.today} />
      </div>
    </div>
  );
}

/** The P&C screen: the people who write it, its carriers and lines, its latest sales; no goal on it. */
function PcScreen({ snap, tones }: { snap: MonthSnapshot; tones: Record<string, string> }) {
  const { team, clock: month } = snap;
  const people = snap.agents.filter((a) => a.pcRank !== null && (a.active || a.pcCents > 0)).sort((a, b) => (a.pcRank ?? 0) - (b.pcRank ?? 0));
  const lead = Math.max(1, ...people.map((a) => a.pcCents));
  const maxCarrier = Math.max(1, ...team.pcByCarrier.map((c) => c.policies));
  const current = month.position === "current";
  const writers = people.filter((a) => a.pcCents > 0).map((a) => firstName(a.name));
  const who = writers.length > 1 ? `${writers.slice(0, -1).join(", ")} and ${writers[writers.length - 1]}` : (writers[0] ?? "");
  return (
    <div className="mt-[0.9em] grid min-h-0 flex-1 grid-cols-12 gap-[1em]">
      <div className="col-span-7 flex min-h-0 flex-col gap-[1em]">
        <section className="flex shrink-0 flex-col rounded-[1.4em] bg-surface p-[1.1em] shadow-card">
          <div className="flex items-baseline justify-between">
            <h2 className="flex items-center gap-[0.45em] text-[1.25em] font-extrabold tracking-[-0.02em]">
              <ViewDot view="pc" className="h-[0.5em] w-[0.5em]" />
              P&C leaderboard
            </h2>
            <p className="text-[0.85em] font-semibold text-gray-500">annual premium · policies · lines</p>
          </div>
          {people.length === 0 ? (
            <p className="py-[2em] text-center text-[1.2em] font-semibold text-gray-500">Nobody is P&C licensed yet: Team, on your phone.</p>
          ) : (
            <ol className="mt-[0.6em] flex flex-col gap-[0.45em]">
              {people.map((a) => (
                <LeaderRow key={a.id} line={a} view="pc" max={lead} count={people.length} today={current} goalLine={null} />
              ))}
            </ol>
          )}
        </section>
        <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[1.4em] bg-surface p-[1.1em] shadow-card">
          <div className="flex items-baseline justify-between">
            <h2 className="text-[1.25em] font-extrabold tracking-[-0.02em]">By carrier</h2>
            <p className="text-[0.85em] font-semibold text-gray-500">{current ? `${monthName(month.key)} so far` : monthName(month.key)}</p>
          </div>
          {team.pcByCarrier.length === 0 ? (
            <p className="flex flex-1 items-center justify-center text-[1.1em] font-semibold text-gray-500">The first P&C sale of the month shows here.</p>
          ) : (
            <ul className="mt-[0.7em] flex min-h-0 flex-1 flex-col gap-[1em]">
              {team.pcByCarrier.slice(0, 6).map((c) => (
                <li key={c.name} className="min-w-0">
                  <div className="flex items-baseline justify-between gap-[1em]">
                    <p className="truncate text-[1.15em] font-extrabold tracking-[-0.02em]">{c.name}</p>
                    <p className="shrink-0 font-mono text-[1.05em] font-bold">
                      <span className="mr-[0.6em] font-sans text-[0.8em] font-semibold text-gray-500">
                        {c.policies} {c.policies === 1 ? "policy" : "policies"}
                      </span>
                      {formatDollars(c.cents)}
                    </p>
                  </div>
                  <div className="mt-[0.25em] h-[0.5em] overflow-hidden rounded-full bg-track">
                    <div className="h-full rounded-full bg-pc-grad" style={{ width: `${Math.round((c.policies / maxCarrier) * 100)}%` }} />
                  </div>
                  <p className="mt-[0.2em] truncate text-[0.85em] font-semibold text-gray-500">{linesSummary(c.lines)}</p>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <div className="col-span-5 flex min-h-0 flex-col gap-[1em]">
        <section className="flex shrink-0 items-center gap-[1.2em] rounded-[1.4em] bg-surface p-[1.1em] shadow-card">
          <div className="flex h-[6.4em] w-[6.4em] shrink-0 items-center justify-center rounded-full bg-surface-2 text-pc-text">
            <svg viewBox="0 0 24 24" className="h-[3em] w-[3em]" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M3 11.5 11 5l8 6.5" />
              <path d="M5 10v8.5h4.5V14h3v4.5H17V10" />
              <path d="M14.5 20.5h6.8l-.9-2.6a1.2 1.2 0 0 0-1.1-.8h-2.8a1.2 1.2 0 0 0-1.1.8z" fill="currentColor" stroke="none" />
            </svg>
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[0.8em] font-bold tracking-[0.09em] text-gray-500 uppercase">P&C production</p>
            <p key={team.pcCents} className="board-pop mt-[0.15em] font-mono text-[2.9em] leading-none font-bold tracking-[-0.035em]">
              {formatDollars(team.pcCents)}
            </p>
            <p className="mt-[0.35em] truncate text-[1em] font-semibold text-gray-500">
              {team.pcPolicies} {team.pcPolicies === 1 ? "policy" : "policies"}
              {who ? ` · ${who}` : ""}
            </p>
            {current && team.todayPcCents > 0 && <p className="mt-[0.5em] text-[1em] leading-snug font-bold text-up">+{formatDollars(team.todayPcCents)} today</p>}
          </div>
        </section>
        <section className="grid shrink-0 grid-cols-3 gap-[0.7em]">
          {current ? (
            <Tile label="Today" value={formatDollars(team.todayPcCents)} sub={`${team.todayPcPolicies} ${team.todayPcPolicies === 1 ? "policy" : "policies"}`} tone={team.todayPcCents > 0 ? "up" : undefined} />
          ) : (
            <Tile label="Lines" value={String(team.pcByLine.length)} sub="written this month" />
          )}
          <Tile label="Policies" value={String(team.pcPolicies)} sub={team.pcAverageCents ? `${formatDollars(team.pcAverageCents)} avg` : "this month"} />
          <Tile label="Share of agency" value={`${team.pcSharePct}%`} sub={`of ${formatDollars(team.productionCents)} total`} />
        </section>
        <section className="flex shrink-0 flex-col rounded-[1.4em] bg-surface p-[1em] shadow-card">
          <div className="flex items-baseline justify-between">
            <h2 className="text-[1.05em] font-extrabold tracking-[-0.02em]">By line</h2>
            <p className="text-[0.8em] font-semibold text-gray-500">policies · annual premium</p>
          </div>
          {team.pcByLine.length === 0 ? (
            <p className="py-[1.2em] text-center text-[1em] font-semibold text-gray-500">No P&C yet this month.</p>
          ) : (
            <div className="mt-[0.5em] grid grid-cols-3 gap-[0.5em]">
              {team.pcByLine.slice(0, 6).map((l) => (
                <div key={l.name} className="min-w-0 rounded-[0.9em] bg-surface-2 px-[0.75em] pt-[0.45em] pb-[0.5em]">
                  <p className="flex items-center gap-[0.45em] truncate text-[0.78em] font-bold tracking-[0.08em] text-gray-500 uppercase">
                    <KindDot kind="pc" className="h-[0.55em] w-[0.55em]" />
                    {l.name}
                  </p>
                  <p className="mt-[0.15em] font-mono text-[1.4em] leading-none font-bold">{l.policies}</p>
                  <p className="mt-[0.15em] truncate font-mono text-[0.85em] font-semibold text-gray-500">{formatDollars(l.cents)}</p>
                </div>
              ))}
            </div>
          )}
        </section>
        {/* Two rows of lines leave room for three sales, one row for five */}
        <Feed title="Latest P&C sales" sales={snap.pcRecent.slice(0, team.pcByLine.length > 3 ? 3 : 5)} tones={tones} today={month.today} empty="The first P&C sale of the month lights this up." grow />
      </div>
    </div>
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

/**
 * One leaderboard row on any screen: life (the share of their own goal in life), the agency total
 * (life and P&C against the same goal, in two colors), or P&C (the share of the P&C leader; no goal).
 */
function LeaderRow({ line, view, max, count, today, goalLine }: { line: AgentLine; view: View; max: number; count: number; today: boolean; goalLine: number | null }) {
  const life = view === "life";
  const pc = view === "pc";
  const amount = life ? line.lifeCents : pc ? line.pcCents : line.premiumCents;
  const todayCents = life ? line.todayLifeCents : pc ? line.todayPcCents : line.todayCents;
  const rank = life ? line.rank : pc ? (line.pcRank ?? 0) : line.totalRank;
  const hasGoal = !pc && line.goalCents > 0;
  const pct = life ? line.goalPct : line.totalGoalPct;
  // One track for everyone: the share of their own goal (of the leader's amount without one).
  const width = hasGoal ? Math.min(100, pct) : Math.round((amount / max) * 100);
  const lifeShare = pc ? 0 : life ? width : line.premiumCents > 0 ? (width * line.lifeCents) / line.premiumCents : 0;
  const done = hasGoal && pct >= 100;
  const first = rank === 1 && amount > 0;
  const medal = amount > 0 ? (rank === 1 ? "text-gold" : rank === 2 ? "text-silver" : rank === 3 ? "text-bronze" : "text-gray-500") : "text-gray-500";
  // Fewer people, taller rows: the type grows a little when there is room. The P&C rows keep one size.
  const scale = pc ? 1.05 : count <= 5 ? 1.15 : count <= 7 ? 1 : count <= 8 ? 0.86 : 0.7;
  const policies = life ? line.lifePolicies : pc ? line.pcPolicies : line.policies;
  return (
    <li
      className={cn("flex min-h-0 items-center gap-[0.9em] rounded-[1em] px-[0.8em]", pc ? "h-[5.2em] shrink-0" : "flex-1", first && (pc ? "bg-surface-2" : "bg-tint/60"))}
      style={{ fontSize: `${scale}em` }}
    >
      <span className={cn("w-[1.4em] shrink-0 text-center font-mono text-[1.4em] font-bold", medal)}>{first ? <Crown /> : rank}</span>
      <Avatar name={line.name} tone={line.tone} size={44} className="!h-[2.6em] !w-[2.6em] !text-[0.95em]" />
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-[1em]">
          <p className="min-w-0 truncate text-[1.35em] leading-tight font-extrabold tracking-[-0.02em]">{line.name.length > 18 ? shortName(line.name) : line.name}</p>
          <div className="shrink-0 text-right">
            <p className="font-mono text-[1.5em] leading-none font-bold tracking-[-0.02em]">{formatDollars(amount)}</p>
            {today && todayCents > 0 && <p className="mt-[0.2em] text-[0.8em] leading-none font-bold text-up">+{formatDollars(todayCents)} today</p>}
          </div>
        </div>
        <div className="mt-[0.45em] flex items-center gap-[0.8em]">
          <GoalBar width={width} lifeShare={lifeShare} goalLine={hasGoal ? goalLine : null} className="h-[0.55em]" tickClassName="-top-[0.3em] h-[1.15em] w-[0.12em]" />
          {hasGoal && <p className={cn("w-[3em] shrink-0 text-right font-mono text-[0.95em] leading-none font-bold", done ? "text-up" : "text-gray-700")}>{pct}%</p>}
        </div>
        <p className="mt-[0.3em] truncate text-[0.85em] leading-none font-semibold whitespace-nowrap text-gray-500">
          {!life && !pc && line.pcCents > 0 ? (
            <KindSplit dot="h-[0.45em] w-[0.45em]" life={<span className="font-mono">{formatDollars(line.lifeCents)} · {line.lifePolicies}</span>} pc={<span className="font-mono">{formatDollars(line.pcCents)} · {line.pcPolicies}</span>} />
          ) : (
            `${policies} ${policies === 1 ? "policy" : "policies"}`
          )}
          {pc && line.pcLines.length > 0 && ` · ${linesSummary(line.pcLines)}`}
          {!pc && !hasGoal && " · no goal"}
        </p>
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

/**
 * The words under the goal card: life against the goal, or (the agency total) what the month looks
 * like with P&C added, after "With P&C:".
 */
function paceWords(clock: MonthSnapshot["clock"], pace: MonthSnapshot["team"]["pace"], production: number, goal: number, withPc: boolean): { line: string; tone: string } {
  const lead = withPc ? "With P&C: " : "";
  if (clock.position === "past") {
    const hit = production >= goal && goal > 0;
    return { line: goal <= 0 ? "Finished" : hit ? `${lead}Goal hit` : `${lead}${formatDollars(goal - production)} short`, tone: hit ? "text-up" : "text-gray-600" };
  }
  if (pace.status === "done") return { line: `${lead}Goal hit, ${formatDollars(production - goal)} over`, tone: "text-up" };
  if (clock.elapsed === 0) return { line: clock.position === "future" ? "The month hasn't started" : "The month starts Monday", tone: "text-gray-600" };
  if (pace.status === "none") return { line: `On pace for ${formatDollars(pace.projectedCents)}`, tone: "text-gray-600" };
  if (clock.remaining === 0 && clock.todayBusiness) return { line: `${lead}${formatDollars(goal - production)} to go · last business day`, tone: pace.status === "ahead" ? "text-up" : pace.status === "on" ? "text-accent-text" : "text-down" };
  if (clock.remaining === 0) return { line: `${lead}${formatDollars(goal - production)} to go · no business days left`, tone: "text-down" };
  if (pace.status === "ahead") return { line: `${lead}Ahead by ${formatDollars(pace.aheadCents)} · on pace for ${formatDollars(pace.projectedCents)}`, tone: "text-up" };
  if (pace.status === "on") return { line: `${lead}Right on the line · on pace for ${formatDollars(pace.projectedCents)}`, tone: "text-accent-text" };
  return { line: `${lead}Behind by ${formatDollars(-pace.aheadCents)} · on pace for ${formatDollars(pace.projectedCents)}`, tone: "text-down" };
}

/** The ring and the production: life against the goal, or life and P&C added up against it. */
function GoalCard({ snap, view }: { snap: MonthSnapshot; view: "life" | "total" }) {
  const { team, clock } = snap;
  const life = view === "life";
  const production = life ? team.lifeCents : team.productionCents;
  const goalPct = life ? team.goalPct : team.totalGoalPct;
  const pct = team.goalCents > 0 ? Math.min(100, goalPct) : 0;
  // The total's ring is life then P&C, in the same proportion as the production.
  const lifePct = life ? pct : team.productionCents > 0 ? (pct * team.lifeCents) / team.productionCents : pct;
  const r = 44;
  const c = 2 * Math.PI * r;
  const { line, tone } = paceWords(clock, life ? team.pace : team.totalPace, production, team.goalCents, !life);
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
          {!life && team.pcCents > 0 && (
            <circle key={`pc-${pct}`} cx="50" cy="50" r={r} fill="none" className="stroke-pc" strokeWidth="9" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - pct / 100)} style={{ transition: "stroke-dashoffset 900ms cubic-bezier(0.2, 0.8, 0.2, 1)" }} />
          )}
          <circle
            key={`${view}-${lifePct}`}
            cx="50"
            cy="50"
            r={r}
            fill="none"
            stroke="url(#ring-grad)"
            strokeWidth="9"
            strokeLinecap="round"
            strokeDasharray={c}
            strokeDashoffset={c * (1 - lifePct / 100)}
            style={{ transition: "stroke-dashoffset 900ms cubic-bezier(0.2, 0.8, 0.2, 1)" }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="font-mono text-[2em] leading-none font-bold tracking-[-0.03em]">{team.goalCents > 0 ? `${goalPct}%` : "–"}</span>
          <span className="mt-[0.3em] text-[0.7em] font-bold tracking-[0.08em] text-gray-500 uppercase">{life ? "of goal" : "with P&C"}</span>
        </div>
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[0.8em] font-bold tracking-[0.09em] text-gray-500 uppercase">{life ? "Life production" : "Agency total · life + P&C"}</p>
        <p key={production} className="board-pop mt-[0.15em] font-mono text-[2.9em] leading-none font-bold tracking-[-0.035em]">
          {formatDollars(production)}
        </p>
        <p className="mt-[0.35em] text-[1em] font-semibold text-gray-500">{team.goalCents > 0 ? `of ${formatDollars(team.goalCents)}` : "no goal set yet"}</p>
        {!life && team.pcCents > 0 && (
          <p className="mt-[0.4em] text-[1em] font-semibold text-gray-600">
            <KindSplit dot="h-[0.55em] w-[0.55em]" life={<span className="font-mono text-gray-900">{formatDollars(team.lifeCents)}</span>} pc={<span className="font-mono text-gray-900">{formatDollars(team.pcCents)}</span>} />
          </p>
        )}
        <p className={cn("mt-[0.5em] text-[1em] leading-snug font-bold", tone)}>{line}</p>
      </div>
    </section>
  );
}

/** The third life tile: what each day left needs, or what today needs on the last business day (life against the goal). */
function NeededTile({ snap }: { snap: MonthSnapshot }) {
  const { team, clock } = snap;
  if (team.goalCents <= 0) return <Tile label="On pace for" value={formatDollars(team.pace.projectedCents)} sub="set a goal in Settings" />;
  if (team.pace.status === "done") return <Tile label="Over the goal" value={formatDollars(team.lifeCents - team.goalCents)} sub="keep going" />;
  if (clock.remaining === 0 && clock.todayBusiness) return <Tile label="Needed today" value={formatDollars(team.goalCents - team.lifeCents)} sub="last business day" />;
  if (clock.remaining === 0) return <Tile label="To go" value={formatDollars(team.goalCents - team.lifeCents)} sub="no business days left" />;
  return <Tile label="Needed a day" value={formatDollars(team.pace.neededPerDayCents)} sub={`to hit ${formatDollars(team.goalCents)}`} />;
}

function Tile({ label, value, sub, tone }: { label: string; value: string; sub: string; tone?: "up" }) {
  return (
    <div className="rounded-[1.2em] bg-surface px-[0.9em] py-[0.8em] shadow-card">
      <p className="truncate text-[0.75em] font-bold tracking-[0.08em] text-gray-500 uppercase">{label}</p>
      <p className={cn("mt-[0.2em] truncate font-mono text-[1.7em] leading-none font-bold tracking-[-0.03em]", tone === "up" ? "text-up" : "text-gray-900")}>{value}</p>
      <p className="mt-[0.35em] truncate text-[0.8em] font-semibold text-gray-500">{sub}</p>
    </div>
  );
}

function Feed({ title, sales, tones, today, empty, grow = false }: { title: string; sales: FeedSale[]; tones: Record<string, string>; today: string; empty?: string; grow?: boolean }) {
  return (
    <section className={cn("min-h-0 overflow-hidden rounded-[1.4em] bg-surface p-[1em] shadow-card", grow ? "flex-1" : "shrink-0")}>
      <h2 className="text-[1.05em] font-extrabold tracking-[-0.02em]">{title}</h2>
      {sales.length === 0 ? (
        <p className="mt-[0.5em] text-[0.95em] font-semibold text-gray-500">{empty ?? "The first sale of the month lights this up."}</p>
      ) : (
        <ul className="mt-[0.5em] space-y-[0.35em]">
          {sales.map((s, i) => (
            <li key={s.id} className={cn("flex items-center gap-[0.7em] rounded-[0.8em] px-[0.4em] py-[0.25em]", i === 0 && "board-flash")}>
              <Avatar name={s.agentName} tone={tones[s.agentId]} size={32} className="!h-[2em] !w-[2em] !text-[0.75em]" />
              <p className="min-w-0 flex-1 truncate text-[1em] font-bold">
                {firstName(s.agentName)}
                <span className="font-semibold text-gray-500">
                  {s.carrier ? ` · ${s.carrier}` : ""}
                  {s.product ? ` · ${s.product}` : ""}
                  {s.policies > 1 ? ` · ${s.policies} policies` : ""}
                </span>
                {s.kind === "pc" && <PcTag tv className="ml-[0.5em] align-middle" />}
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

function Celebration({ sale, sound, onRefused, onPlayed }: { sale: FeedSale; sound: SoundKey; onRefused: () => void; onPlayed: () => void }) {
  const canvas = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    if (!canvas.current) return;
    const stop = burst(canvas.current, { count: 320, duration: CELEBRATE_MS - 1500 });
    return stop;
  }, [sale.id]);
  // The owner's sale sound, once per celebration; a long one fades out before the overlay leaves.
  useEffect(() => {
    const file = soundFile(sound);
    if (!file) return;
    const audio = new Audio(file);
    let step: number | undefined;
    // Only the browser's autoplay answer means "click first"; an interrupted play or a load error does not.
    audio.play().then(onPlayed, (err: unknown) => {
      if (isAutoplayRefusal(err)) onRefused();
    });
    const fade = window.setTimeout(() => {
      step = window.setInterval(() => {
        audio.volume = Math.max(0, audio.volume - 0.1);
        if (audio.volume === 0) {
          window.clearInterval(step);
          audio.pause();
        }
      }, SOUND_FADE_MS / 10);
    }, CELEBRATE_MS - SOUND_FADE_MS - 300);
    return () => {
      window.clearTimeout(fade);
      window.clearInterval(step);
      audio.pause();
    };
  }, [sale.id, sound, onRefused, onPlayed]);
  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-ink/70" role="status" aria-live="polite" data-sound={sound}>
      <canvas ref={canvas} className="pointer-events-none absolute inset-0 h-full w-full" />
      <div className="board-pop relative flex flex-col items-center rounded-[2em] bg-surface px-[3.2em] py-[2.4em] text-center shadow-float">
        <Avatar name={sale.agentName} tone="bg-tide text-white shadow-glow" size={96} className="!h-[6em] !w-[6em] !text-[2.2em]" />
        <p className={cn("mt-[0.9em] text-[1.1em] font-bold tracking-[0.1em] uppercase", sale.kind === "pc" ? "text-pc-text" : "text-accent-text")}>{sale.kind === "pc" ? "New P&C sale" : "New sale"}</p>
        <p className="mt-[0.2em] text-[2.8em] leading-tight font-extrabold tracking-[-0.03em]">{sale.agentName}</p>
        <p className="mt-[0.4em] font-mono text-[3.6em] leading-none font-bold tracking-[-0.035em] text-gray-900">{formatMoney(sale.premiumCents)}</p>
        <p className="mt-[0.6em] text-[1.2em] font-semibold text-gray-500">
          annual premium
          {sale.kind === "pc" ? " · P&C" : ""}
          {sale.carrier ? ` · ${sale.carrier}` : ""}
          {sale.product ? ` · ${sale.product}` : ""}
          {sale.policies > 1 ? ` · ${sale.policies} policies` : ""}
        </p>
      </div>
    </div>
  );
}
