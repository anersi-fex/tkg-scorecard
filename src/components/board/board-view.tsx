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
import { SCREEN_MS, VIEWS, VIEW_LABEL, lifeDaily, linesSummary, nextScreen, pcDaily, screenFor, type View } from "@/lib/views";

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
  // The sales that just arrived: their feed row flashes once (a screen switch remounts the feed).
  const [flash, setFlash] = useState<string[]>([]);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
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

  // The owner's colorway and P&C color from the latest poll (a change in Settings reaches the TV within 5 s).
  useEffect(() => {
    document.documentElement.setAttribute("data-colorway", snap.colorway);
  }, [snap.colorway]);
  useEffect(() => {
    document.documentElement.setAttribute("data-pc-color", snap.pcColor);
  }, [snap.pcColor]);

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
        setFlash(fresh.map((r) => r.id));
        if (flashTimer.current) clearTimeout(flashTimer.current);
        flashTimer.current = setTimeout(() => setFlash([]), 3000);
      }
    } catch {
      setOffline((n) => n + 1);
    }
  }, [router, showNext, initial.build]);

  useEffect(() => {
    const id = setInterval(refresh, POLL_MS);
    return () => clearInterval(id);
  }, [refresh]);

  const { clock: month } = snap;
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

  // The screens (2026-11-12): the leaderboard for 40 s, then the Scoreboard, Production and Teams
  // for 20 s each (P&C and the agency total only while P&C is switched on); a screen with nothing
  // to show is skipped; or the one screen the TV is kept on (Settings > TV screens, from the poll).
  const scoreRows = snap.scoreboard?.rows.length ?? 0;
  const scoreTeams = snap.scoreboard?.teams.length ?? 0;
  const pcEnabled = snap.pcEnabled === true;
  const pcCents = snap.team.pcCents;
  const facts = useMemo(
    () => screenFacts({ pcEnabled, team: { pcCents }, scoreboard: snap.scoreboard ? { rows: new Array(scoreRows), teams: new Array(scoreTeams) } : null }),
    // Only the counts matter: a poll brings a new scoreboard object every 5 s, the rotation must not restart with it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pcEnabled, pcCents, scoreRows, scoreTeams, snap.scoreboard === null],
  );
  const rotate = snap.tvScreens === "rotate";
  const [rotating, setRotating] = useState<Screen>("life");
  const [turn, setTurn] = useState(0);
  const screen = screenFor(snap.tvScreens, rotating, facts);
  const inRotation = rotationScreens(facts);
  const cycling = rotate && inRotation.length > 1;
  // A screen whose list has more pages than its time allows stays until each page had its turn.
  const [paged, setPaged] = useState<{ screen: Screen; pages: number }>({ screen: "life", pages: 1 });
  const pages = paged.screen === screen ? paged.pages : 1;
  const onPages = useCallback((n: number) => setPaged((old) => (old.screen === screen && old.pages === n ? old : { screen, pages: n })), [screen]);
  const stay = screenMs(screen, pages);
  useEffect(() => {
    if (!cycling) return;
    const id = setTimeout(() => {
      setRotating(nextScreen(screen, facts));
      setTurn((t) => t + 1);
    }, stay);
    return () => clearTimeout(id);
  }, [cycling, screen, facts, turn, stay]);
  const tones = Object.fromEntries(snap.agents.map((a) => [a.id, a.tone]));

  return (
    <main
      data-screen={screen}
      className="relative flex h-dvh w-full flex-col overflow-hidden bg-ink px-[1.6em] pt-[1em] pb-[0.9em] text-gray-900 select-none"
      style={{ fontSize: "clamp(10px, min(1vw, 1.78vh), 36px)" }}
    >
      {/* Header */}
      <header className="flex shrink-0 items-center justify-between gap-[1em]">
        <BoardLockup agency={snap.agencyName} />
        <div className="flex flex-col items-center text-center">
          <p className="text-[1.75em] leading-none font-extrabold tracking-[-0.03em]">{month.label}</p>
          {/* One pill per screen in rotation; kept on one screen (or with nothing else to show), only its pill */}
          <ScreenPills screen={screen} shown={cycling ? inRotation : [screen]} timed={cycling} turn={turn} ms={stay} />
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

      {screen === "scoreboard" ? (
        <ScoreboardScreen snap={snap} />
      ) : screen === "production" ? (
        <ProductionScreen snap={snap} onPages={onPages} />
      ) : screen === "teams" ? (
        <TeamsScreen snap={snap} onPages={onPages} />
      ) : screen === "pc" ? (
        <PcScreen snap={snap} tones={tones} flash={flash} />
      ) : screen === "total" ? (
        <MainScreen snap={snap} view="total" tones={tones} flash={flash} />
      ) : (
        <LifeScreen snap={snap} tones={tones} flash={flash} onPages={onPages} />
      )}

      {/* Footer */}
      <footer className="mt-[0.8em] flex shrink-0 items-center justify-between gap-[1em] text-[0.85em] font-semibold text-gray-500">
        <p className="min-w-0 truncate text-[1.1em] font-bold text-gray-700">{snap.message || " "}</p>
        <p className="shrink-0">
          {offline >= 3 ? <span className="text-amber-800">Reconnecting…</span> : <>Updated {formatClock(snap.generatedAt)}</>}
          {sound.blocked && snap.sound !== "off" && <span className="ml-[1em] text-amber-800">Click or press a key once for sound</span>}
          <span className="ml-[1em] text-gray-500">F full screen</span>
        </p>
      </footer>

      {showing && <Celebration sale={showing} sound={snap.sound} pc={pcEnabled && showing.kind === "pc"} onRefused={sound.refused} onPlayed={sound.played} />}
    </main>
  );
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
