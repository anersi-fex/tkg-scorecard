"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { FeedSale, MonthSnapshot } from "@/lib/board";
import type { BoardTheme } from "@/lib/types";
import { formatMoney } from "@/lib/money";
import { daysLeftLabel } from "@/lib/month";
import { TEAM_TIME_ZONE } from "@/lib/timezone";
import { ScoreMark, TkgMark } from "@/components/brand";
import { cn, formatClock } from "@/components/ui";
import { Icon } from "@/components/ui/icon";
import "./tv.css";
import { soundFile, type SoundKey } from "@/lib/sounds";
import { SCREEN_LABEL, nextScreen, rotationScreens, screenFacts, screenFor, screenMs, type Screen } from "@/lib/views";
import { LifeScreen } from "./life-screen";
import { ViewDot } from "./parts";
import { MainScreen, PcScreen } from "./pc-screens";
import { ProductionScreen } from "./production-screen";
import { ScoreboardScreen } from "./scoreboard-screen";
import { TeamsScreen } from "./teams-screen";

/**
 * The TV board. One screen, no scrolling, sized from the viewport (1em = about 1% of the width,
 * capped for 4K), so a 1080p TV, a 4K TV and a laptop all show the same layout. Polls /api/board
 * every few seconds; a sale that was not there before gets its moment: a calm banner over the
 * screen pills for 9 s and the owner's sale sound (the calmer look, 2026-11-12: no confetti).
 * Dark or light is the owner's TV look (Settings), applied before paint and again from every poll,
 * so the TV follows a change within 5 s; nothing on the TV itself changes it. When a poll comes
 * from a newer deploy the page reloads itself once, so the TV never runs last week's code. Key: F
 * full screen. The cursor hides after a few seconds still.
 */
const POLL_MS = 5000;
/** Every this many polls the TV reads the whole feed; in between it asks only whether anything changed. */
const FULL_EVERY = 12;
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
  // When the newest sale the page knows was logged: an older sale that slides into the feed (a
  // newer one was taken back, or P&C was switched on) is not new, so it gets no celebration.
  const newest = useRef(initial.recent.reduce((m, r) => Math.max(m, Date.parse(r.createdAt) || 0), 0));
  // Sales waiting for their moment, and the timer of the one on screen.
  const queue = useRef<FeedSale[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reloading = useRef(false);
  const stamp = useRef<string | null>(null);
  const polls = useRef(0);
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
      // Most polls only ask "anything new?" (the stamp the last full answer carried); a new or
      // removed sale and a Settings change answer in full at once, everything else once a minute.
      const held = polls.current % FULL_EVERY === 0 ? null : stamp.current;
      polls.current += 1;
      const res = await fetch(held ? `/api/board?stamp=${encodeURIComponent(held)}` : "/api/board", { cache: "no-store" });
      if (res.status === 401) {
        router.push("/login?next=/board");
        return;
      }
      if (res.status === 204) {
        setOffline(0);
        return;
      }
      if (!res.ok) throw new Error(String(res.status));
      const next = (await res.json()) as MonthSnapshot & { stamp?: string | null };
      stamp.current = next.stamp ?? null;
      // A new deploy is live: the TV was opened once and left, so it reloads itself (once) to run it.
      if (next.build && initial.build && next.build !== initial.build && !reloading.current) {
        reloading.current = true;
        window.location.reload();
        return;
      }
      setOffline(0);
      // New sales, oldest first, each gets its moment.
      const since = newest.current;
      const fresh = next.recent.filter((r) => !known.current.has(r.id) && Date.parse(r.createdAt) > since).reverse();
      for (const r of next.recent) {
        known.current.add(r.id);
        newest.current = Math.max(newest.current, Date.parse(r.createdAt) || 0);
      }
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
  const pcEnabled = snap.pcEnabled === true;
  const facts = screenFacts(snap);
  const rotate = snap.tvScreens === "rotate";
  const [rotating, setRotating] = useState<Screen>("life");
  const [turn, setTurn] = useState(0);
  const screen = screenFor(snap.tvScreens, rotating, facts);
  const inRotation = rotationScreens(facts);
  const cycling = rotate && inRotation.length > 1;
  const next = nextScreen(screen, facts);
  // A screen whose list has more pages than its time allows stays until each page had its turn.
  const [paged, setPaged] = useState<{ screen: Screen; pages: number }>({ screen: "life", pages: 1 });
  const pages = paged.screen === screen ? paged.pages : 1;
  const onPages = useCallback((n: number) => setPaged((old) => (old.screen === screen && old.pages === n ? old : { screen, pages: n })), [screen]);
  const stay = screenMs(screen, pages);
  // The timer follows only the screen and its own time (plain values), so the poll every 5 s never
  // restarts it; what comes next is read when the time is up, so a screen joining or leaving the
  // rotation meanwhile does not start this screen's time over.
  const upNext = useRef(next);
  useEffect(() => {
    upNext.current = next;
  }, [next]);
  useEffect(() => {
    if (!cycling) return;
    const id = setTimeout(() => {
      setRotating(upNext.current);
      setTurn((t) => t + 1);
    }, stay);
    return () => clearTimeout(id);
  }, [cycling, screen, turn, stay]);
  const tones = Object.fromEntries(snap.agents.map((a) => [a.id, a.tone]));

  return (
    <main data-screen={screen} className="tvb">
      <header className="tvb-top">
        <BoardLockup agency={snap.agencyName} />
        {/* One pill per screen in rotation; kept on one screen (or with nothing else to show), only its pill */}
        <ScreenPills screen={screen} shown={cycling ? inRotation : [screen]} timed={cycling} turn={turn} ms={stay} />
        <div className="tvb-when">
          <span className="tvb-month">
            {month.label}
            {month.position === "current" && (
              <>
                {" · "}
                <span className="num">{daysLeftLabel(month)}</span>
              </>
            )}
          </span>
          <span className="tvb-clock num">{clock}</span>
        </div>
      </header>

      {screen === "scoreboard" ? (
        <ScoreboardScreen snap={snap} />
      ) : screen === "production" ? (
        <ProductionScreen snap={snap} onPages={onPages} />
      ) : screen === "teams" ? (
        <TeamsScreen snap={snap} onPages={onPages} />
      ) : screen === "pc" ? (
        <div className="tvb-legacy">
          <PcScreen snap={snap} tones={tones} flash={flash} />
        </div>
      ) : screen === "total" ? (
        <div className="tvb-legacy">
          <MainScreen snap={snap} view="total" tones={tones} flash={flash} onPages={onPages} />
        </div>
      ) : (
        <LifeScreen snap={snap} flash={flash} onPages={onPages} />
      )}

      <footer className="tvb-foot">
        <p className="tvb-msg ell">{snap.message || " "}</p>
        <p>
          {offline >= 3 ? <span className="tvb-warn">Reconnecting…</span> : <span className="num">Updated {formatClock(snap.generatedAt)}</span>}
          {sound.blocked && snap.sound !== "off" && <span className="tvb-warn">Click or press a key once for sound</span>}
          <span className="tvb-key">F full screen</span>
        </p>
      </footer>

      {showing && <Celebration key={showing.id} sale={showing} sound={snap.sound} pc={pcEnabled && showing.kind === "pc"} onRefused={sound.refused} onPlayed={sound.played} />}
    </main>
  );
}

/**
 * The screens in the middle of the header: one pill per screen in rotation, the one on screen lit
 * with a line that runs out with its time; only the kept screen when the TV is kept on one.
 */
function ScreenPills({ screen, shown, timed, turn, ms }: { screen: Screen; shown: Screen[]; timed: boolean; turn: number; ms: number }) {
  return (
    <nav className="tvb-seg" aria-label="TV screens">
      {shown.map((v) => {
        const on = v === screen;
        return (
          <span key={v} data-pill={v} aria-current={on ? "true" : undefined} className={cn("tvb-pill", on && "on")}>
            {(v === "pc" || v === "total") && <ViewDot view={v} className="tvb-pill-dot" />}
            <span>{SCREEN_LABEL[v]}</span>
            {on && (
              <span className="tvb-timer" aria-hidden>
                {/* The line runs out with the screen's time while the TV rotates; kept on one screen it stays full. */}
                <i key={`${turn}-${ms}`} className={timed ? "board-timer" : undefined} style={timed ? { animationDuration: `${ms}ms` } : undefined} />
              </span>
            )}
          </span>
        );
      })}
    </nav>
  );
}

/**
 * The lockup at the TV's size: the mark, "Scorecard", and under it "by TKG × <the agency's name>"
 * (owner, 2026-11-12: "you can still put 'by tkg' ... just needs to also say Lineage Financial"), the
 * same words as ScoreLockup on the phone; "by TKG" alone without an agency name.
 */
function BoardLockup({ agency }: { agency: string }) {
  const name = agency.trim();
  return (
    <div className="tvb-lockup">
      <ScoreMark size={58} className="tvb-lockup-mark" />
      <div className="min-w-0">
        <div className="tvb-lockup-name">Scorecard</div>
        <div data-lockup-by className="tvb-lockup-by">
          by <TkgMark />
          {name && (
            <>
              <span aria-hidden>×</span>
              <span data-agency>{name}</span>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Celebration({ sale, sound, pc, onRefused, onPlayed }: { sale: FeedSale; sound: SoundKey; pc: boolean; onRefused: () => void; onPlayed: () => void }) {
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
  const what = [pc ? "P&C" : null, sale.carrier, sale.product, sale.policies > 1 ? `${sale.policies} policies` : null].filter(Boolean).join(" · ");
  return (
    <div className="tvb-banner enter" role="status" aria-live="polite" data-sound={sound}>
      <span className="tvb-banner-ico">
        <Icon name="star" size={22} stroke={1.9} className="tvb-ico" />
      </span>
      <span className="tvb-banner-k">{pc ? "New P&C sale" : "New sale"}</span>
      <span className="tvb-dot" aria-hidden>
        ·
      </span>
      <span className="tvb-banner-name">{sale.agentName}</span>
      <span className="tvb-dot" aria-hidden>
        ·
      </span>
      <span className="tvb-banner-amt num">{formatMoney(sale.premiumCents)}</span>
      {what && (
        <>
          <span className="tvb-dot" aria-hidden>
            ·
          </span>
          <span className="tvb-banner-k">{what}</span>
        </>
      )}
    </div>
  );
}
