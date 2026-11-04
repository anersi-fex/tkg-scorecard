"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { COLORWAYS, COLORWAY_KEYS, type ColorwayKey } from "@/lib/colorways";
import { PC_COLORS, PC_COLOR_KEYS, pcLooksLikeLife, type PcColorKey } from "@/lib/pc-colors";
import { cn } from "@/components/ui";
import { BOARD_THEMES, TV_SCREENS, type AppSettings, type BoardTheme, type TvScreens } from "@/lib/types";
import { SOUNDS, type SoundKey } from "@/lib/sounds";
import { Button, Input, Label, Notice, Textarea } from "@/components/ui";
import { ListCard, ListTitle, ROW_INSET } from "@/components/tide";
import { saveBoardSettings, saveBoardTheme, saveColorway, savePcColor, saveSaleSound, saveTeamGoal, saveTeamPcGoal, saveTvScreens } from "../actions";
import { toast } from "@/components/toaster";
import { KindDot } from "@/components/kind";

interface MonthGoal {
  key: string;
  label: string;
  /** The life goal (the one the board measures) and the P&C goal. */
  cents: number;
  pcCents: number;
  current: boolean;
}

export function SettingsForms({
  settings,
  months,
  shortcutReady,
  shortcutTooShort,
  teamPasswordSet,
  base,
}: {
  settings: AppSettings;
  months: MonthGoal[];
  shortcutReady: boolean;
  /** LOG_TOKEN is set but shorter than the route accepts. */
  shortcutTooShort: boolean;
  teamPasswordSet: boolean;
  base: string;
}) {
  return (
    <div className="space-y-6">
      <section>
        <ListTitle>Life goal</ListTitle>
        <p className="mt-1 px-1 text-[13px] text-gray-500">Life annual premium for the whole team: the goal the board measures, with what each day needs.</p>
        <ListCard className="mt-2 divide-y divide-line">
          {months.map((m) => (
            <li key={m.key} className="px-4 py-3">
              <GoalForm month={m} />
            </li>
          ))}
        </ListCard>
      </section>

      <section>
        <ListTitle>P&amp;C goal</ListTitle>
        <p className="mt-1 px-1 text-[13px] text-gray-500">P&amp;C annual premium for the P&amp;C team. The P&amp;C screen measures it; the agency total adds both goals up.</p>
        <ListCard className="mt-2 divide-y divide-line">
          {months.map((m) => (
            <li key={m.key} className="px-4 py-3">
              <GoalForm month={m} pc />
            </li>
          ))}
        </ListCard>
      </section>

      <section>
        <ListTitle>Colorway</ListTitle>
        <p className="mt-1 px-1 text-[13px] text-gray-500">The color story on every phone and the TV. Crimson is the default; the app icon stays Crimson.</p>
        <ColorwayPicker current={settings.colorway} />
      </section>

      <section>
        <ListTitle>P&amp;C color</ListTitle>
        <p className="mt-1 px-1 text-[13px] text-gray-500">P&amp;C&apos;s own color on the bars, rings and tags, next to life&apos;s. Dusty blue is the default.</p>
        <PcColorPicker current={settings.pcColor} colorway={settings.colorway} />
      </section>

      <section>
        <ListTitle>TV look</ListTitle>
        <p className="mt-1 px-1 text-[13px] text-gray-500">Light or dark on the office TV. The TV follows this within a few seconds.</p>
        <BoardThemePicker current={settings.boardTheme} />
      </section>

      <section>
        <ListTitle>TV screens</ListTitle>
        <p className="mt-1 px-1 text-[13px] text-gray-500">What the office TV shows. It follows within a few seconds.</p>
        <TvScreensPicker current={settings.tvScreens} />
      </section>

      <section>
        <ListTitle>Sale sound</ListTitle>
        <p className="mt-1 px-1 text-[13px] text-gray-500">What the TV plays when a sale lands, with the confetti. Tap the play button to hear one here; tap its name to pick it.</p>
        <SoundPicker current={settings.sound} />
      </section>

      <section>
        <ListTitle>The board</ListTitle>
        <BoardForm settings={settings} />
      </section>

      <section>
        <ListTitle>Sign-ins</ListTitle>
        <ListCard className="mt-2">
          <li className="px-4 py-3 text-[14px] text-gray-700">
            <p className="font-bold text-gray-900">Owner password</p>
            <p className="mt-0.5 text-gray-600">Yours. Changing OWNER_PASSWORD in Vercel signs out every device that used it.</p>
          </li>
          <li className="border-t border-line px-4 py-3 text-[14px] text-gray-700">
            <p className="font-bold text-gray-900">Team password {teamPasswordSet ? "" : "(not set yet)"}</p>
            <p className="mt-0.5 text-gray-600">
              {teamPasswordSet
                ? "For everyone's phone and the TV: they can log sales and see everything, not change goals or the team."
                : "Add TEAM_PASSWORD in Vercel so the team can sign in on their phones and the TV without your password."}
            </p>
          </li>
        </ListCard>
      </section>

      <section>
        <ListTitle>iPhone Shortcut and NFC tags</ListTitle>
        <ListCard className="mt-2">
          <li className="px-4 py-3 text-[14px] text-gray-700">
            {shortcutReady ? (
              <>
                <p className="font-bold text-gray-900">Ready</p>
                <p className="mt-0.5 text-gray-600">
                  A Shortcut can post a sale straight to the board. The recipe is in SETUP.md (Phase 2). It sends to{" "}
                  <code className="rounded bg-surface-2 px-1 font-mono text-[12px]">{base || ""}/api/sales</code> with your LOG_TOKEN.
                </p>
              </>
            ) : shortcutTooShort ? (
              <>
                <p className="font-bold text-gray-900">LOG_TOKEN is too short</p>
                <p className="mt-0.5 text-gray-600">Use at least 12 characters (24 or more is best) in Vercel, then redeploy. Until then every Shortcut call is refused.</p>
              </>
            ) : (
              <>
                <p className="font-bold text-gray-900">Not set up yet</p>
                <p className="mt-0.5 text-gray-600">Add LOG_TOKEN in Vercel (any long random text) to let a Shortcut log sales. Until then, a tag can simply open each person&apos;s desk link from the Team page.</p>
              </>
            )}
          </li>
        </ListCard>
      </section>
    </div>
  );
}

function ColorwayPicker({ current }: { current: ColorwayKey }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [picked, setPicked] = useState<ColorwayKey>(current);
  return (
    <div role="radiogroup" aria-label="Colorway" className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
      {COLORWAY_KEYS.map((key) => {
        const c = COLORWAYS[key];
        const on = picked === key;
        return (
          <button
            key={key}
            type="button"
            role="radio"
            aria-checked={on}
            disabled={pending}
            onClick={() => {
              setPicked(key);
              // This screen changes at once; every other screen on the next load; the TV on its next poll.
              document.documentElement.setAttribute("data-colorway", key);
              start(async () => {
                let ok = false;
                try {
                  const r = await saveColorway(key);
                  toast(r.ok ? (r.message ?? "Saved.") : r.error, r.ok);
                  ok = r.ok;
                } catch {
                  toast("Couldn't reach the server. Try again.", false);
                }
                if (ok) router.refresh();
                else {
                  setPicked(current);
                  document.documentElement.setAttribute("data-colorway", current);
                }
              });
            }}
            className={cn("flex min-h-14 items-center gap-3 rounded-2xl bg-surface px-3 text-left shadow-card transition", on ? "outline-2 outline-accent" : "hover:bg-gray-50")}
          >
            <span aria-hidden className="h-9 w-9 shrink-0 rounded-xl" style={{ background: `linear-gradient(135deg, ${c.swatch[0]}, ${c.swatch[1]})` }} />
            <span className="min-w-0">
              <span className={cn("block text-[15px] font-bold", on ? "text-accent-text" : "text-gray-900")}>{c.name}</span>
              <span className="block truncate text-[12px] font-medium text-gray-500">{c.idea}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

function PcColorPicker({ current, colorway }: { current: PcColorKey; colorway: ColorwayKey }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [picked, setPicked] = useState<PcColorKey>(current);
  return (
    <>
      <div role="radiogroup" aria-label="P&C color" className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {PC_COLOR_KEYS.map((key) => {
          const c = PC_COLORS[key];
          const on = picked === key;
          return (
            <button
              key={key}
              type="button"
              role="radio"
              aria-checked={on}
              data-pc-color-option={key}
              disabled={pending}
              onClick={() => {
                setPicked(key);
                // This screen changes at once; every other screen on the next load; the TV on its next poll.
                document.documentElement.setAttribute("data-pc-color", key);
                start(async () => {
                  let ok = false;
                  try {
                    const r = await savePcColor(key);
                    toast(r.ok ? (r.message ?? "Saved.") : r.error, r.ok);
                    ok = r.ok;
                  } catch {
                    toast("Couldn't reach the server. Try again.", false);
                  }
                  if (ok) router.refresh();
                  else {
                    setPicked(current);
                    document.documentElement.setAttribute("data-pc-color", current);
                  }
                });
              }}
              className={cn("flex min-h-14 items-center gap-3 rounded-2xl bg-surface px-3 text-left shadow-card transition", on ? "outline-2 outline-accent" : "hover:bg-gray-50")}
            >
              <span aria-hidden className="h-9 w-9 shrink-0 rounded-xl" style={{ background: `linear-gradient(135deg, ${c.swatch[0]}, ${c.swatch[1]})` }} />
              <span className="min-w-0">
                <span className={cn("block text-[15px] font-bold", on ? "text-accent-text" : "text-gray-900")}>{c.name}</span>
                <span className="block truncate text-[12px] font-medium text-gray-500">{c.idea}</span>
              </span>
            </button>
          );
        })}
      </div>
      {pcLooksLikeLife(colorway, picked) && (
        <p className="mt-2 px-1 text-[13px] font-medium text-down">
          {COLORWAYS[colorway].name} is close to {PC_COLORS[picked].name}, so P&amp;C can look like life. {colorway === "emerald" ? "Dusty blue or Silver" : "Silver or Sage"} keeps them apart.
        </p>
      )}
    </>
  );
}

const BOARD_THEME_OPTIONS: Record<BoardTheme, { label: string; icon: React.ReactNode }> = {
  dark: {
    label: "Dark",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" />
      </svg>
    ),
  },
  light: {
    label: "Light",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
      </svg>
    ),
  },
};

/** Light / Dark for the TV, saved on tap (like the colorway); the TV picks it up on its next poll. */
function BoardThemePicker({ current }: { current: BoardTheme }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [picked, setPicked] = useState<BoardTheme>(current);
  // Follow the saved value when the page refreshes (a change made on another phone shows here).
  const [seen, setSeen] = useState(current);
  if (seen !== current) {
    setSeen(current);
    setPicked(current);
  }
  return (
    <div role="radiogroup" aria-label="TV look" className="mt-2 grid grid-cols-2 gap-1 rounded-2xl bg-track p-1">
      {BOARD_THEMES.map((key) => {
        const o = BOARD_THEME_OPTIONS[key];
        const on = picked === key;
        return (
          <button
            key={key}
            type="button"
            role="radio"
            aria-checked={on}
            disabled={pending}
            onClick={() => {
              setPicked(key);
              start(async () => {
                try {
                  const r = await saveBoardTheme(key);
                  toast(r.ok ? (r.message ?? "Saved.") : r.error, r.ok);
                  if (r.ok) router.refresh();
                  else setPicked(current);
                } catch {
                  toast("Couldn't reach the server. Try again.", false);
                  setPicked(current);
                }
              });
            }}
            className={cn(
              "flex min-h-12 items-center justify-center gap-2 rounded-xl text-[15px] font-bold transition",
              on ? "bg-segment text-gray-900 shadow-card" : "text-gray-600 hover:text-gray-900",
            )}
          >
            {o.icon}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

const TV_SCREEN_OPTIONS: Record<TvScreens, { label: string; note: string; icon: React.ReactNode; tone: string }> = {
  rotate: {
    label: "Rotate",
    note: "Life 60 s, then P&C 15 s, then Agency total 15 s",
    tone: "bg-surface-2 text-gray-700",
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M20 11a8 8 0 0 0-14.3-4.9L4 8" />
        <path d="M4 4v4h4" />
        <path d="M4 13a8 8 0 0 0 14.3 4.9L20 16" />
        <path d="M20 20v-4h-4" />
      </svg>
    ),
  },
  life: { label: "Life only", note: "the goal screen, all day", tone: "bg-tint", icon: <KindDot kind="life" className="h-3 w-3" /> },
  pc: { label: "P&C only", note: "P&C sales and the P&C team", tone: "bg-pc-tint", icon: <KindDot kind="pc" className="h-3 w-3" /> },
  total: {
    label: "Agency total only",
    note: "life and P&C added up",
    tone: "bg-surface-2",
    icon: (
      <span aria-hidden className="flex h-3 w-3 overflow-hidden rounded-full">
        <span className="h-full w-1/2 bg-accent" />
        <span className="h-full w-1/2 bg-pc" />
      </span>
    ),
  },
};

/** Settings > TV screens: the TV rotates its three screens, or stays on one; saved on a tap. */
function TvScreensPicker({ current }: { current: TvScreens }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [picked, setPicked] = useState<TvScreens>(current);
  // Follow the saved value when the page refreshes (a change made on another phone shows here).
  const [seen, setSeen] = useState(current);
  if (seen !== current) {
    setSeen(current);
    setPicked(current);
  }
  const pick = (key: TvScreens) => {
    if (key === picked) return;
    setPicked(key);
    start(async () => {
      try {
        const r = await saveTvScreens(key);
        toast(r.ok ? (r.message ?? "Saved.") : r.error, r.ok);
        if (r.ok) router.refresh();
        else setPicked(current);
      } catch {
        toast("Couldn't reach the server. Try again.", false);
        setPicked(current);
      }
    });
  };
  return (
    <div role="radiogroup" aria-label="TV screens">
      <ListCard className="mt-2">
        {TV_SCREENS.map((key) => {
          const o = TV_SCREEN_OPTIONS[key];
          const on = picked === key;
          return (
            <li key={key} className={ROW_INSET.button}>
              <button type="button" role="radio" aria-checked={on} disabled={pending} onClick={() => pick(key)} className="flex min-h-[60px] w-full items-center gap-3 px-4 py-2 text-left">
                <span aria-hidden className={cn("flex h-11 w-11 shrink-0 items-center justify-center rounded-full", o.tone)}>
                  {o.icon}
                </span>
                <span className="min-w-0 flex-1">
                  <span className={cn("block truncate text-[15px] font-bold", on ? "text-accent-text" : "text-gray-900")}>{o.label}</span>
                  <span className="block truncate text-[12px] font-medium text-gray-500">{o.note}</span>
                </span>
                <span aria-hidden className={cn("flex h-6 w-6 shrink-0 items-center justify-center rounded-full", on ? "bg-tide-strong text-white" : "border border-line")}>
                  {on && (
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                      <path d="M5 12.5l4.5 4.5L19 7.5" />
                    </svg>
                  )}
                </span>
              </button>
            </li>
          );
        })}
      </ListCard>
    </div>
  );
}

/** The sound rows: a play button hears one here; a tap on the name picks it and saves at once. */
function SoundPicker({ current }: { current: SoundKey }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [picked, setPicked] = useState<SoundKey>(current);
  // Follow the saved value when the page refreshes (a change made on another phone shows here).
  const [seen, setSeen] = useState(current);
  if (seen !== current) {
    setSeen(current);
    setPicked(current);
  }
  const [playing, setPlaying] = useState<SoundKey | null>(null);
  const player = useRef<HTMLAudioElement | null>(null);
  // A test sound stops when the page goes (the 16 s intro would play on over the next screen).
  useEffect(() => {
    const ref = player;
    return () => ref.current?.pause();
  }, []);
  const play = (key: SoundKey, file: string) => {
    player.current?.pause();
    // A second tap on the row that is playing stops it.
    if (playing === key) {
      player.current = null;
      setPlaying(null);
      return;
    }
    const a = new Audio(file);
    player.current = a;
    setPlaying(key);
    a.onended = () => setPlaying((p) => (p === key ? null : p));
    a.play().catch((err: unknown) => {
      // A tap on another row pauses this one before it starts: that is not a failure.
      if (player.current !== a || (err instanceof DOMException && err.name === "AbortError")) return;
      setPlaying(null);
      toast("Couldn't play that sound. Try again.", false);
    });
  };
  const pick = (key: SoundKey) => {
    if (key === picked) return;
    setPicked(key);
    start(async () => {
      try {
        const r = await saveSaleSound(key);
        toast(r.ok ? (r.message ?? "Saved.") : r.error, r.ok);
        if (r.ok) router.refresh();
        else setPicked(current);
      } catch {
        toast("Couldn't reach the server. Try again.", false);
        setPicked(current);
      }
    });
  };
  const rows: Array<{ key: SoundKey; label: string; note: string; file: string | null }> = [...SOUNDS, { key: "off", label: "Off", note: "confetti only", file: null }];
  return (
    <div role="radiogroup" aria-label="Sale sound">
      <ListCard className="mt-2">
        {rows.map((r) => {
          const on = picked === r.key;
          const live = playing === r.key;
          return (
            <li key={r.key} className={cn("flex items-center gap-3 px-4 py-2", ROW_INSET.button)}>
              {r.file ? (
                <button
                  type="button"
                  aria-label={`${live ? "Stop" : "Play"} ${r.label}`}
                  onClick={() => play(r.key, r.file as string)}
                  className={cn("flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition", live ? "bg-tide-strong text-white shadow-glow" : "bg-tint text-accent-text")}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" className={cn("fill-current", !live && "ml-0.5")} aria-hidden>
                    {live ? <rect x="6.5" y="6.5" width="11" height="11" rx="2" /> : <path d="M7 5.5v13l11-6.5z" />}
                  </svg>
                </button>
              ) : (
                <span aria-hidden className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-surface-2 text-gray-400">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d="M4 9.5v5h3.5L13 19V5L7.5 9.5zM17 9l4 6M21 9l-4 6" />
                  </svg>
                </span>
              )}
              <button type="button" role="radio" aria-checked={on} disabled={pending} onClick={() => pick(r.key)} className="flex min-h-11 min-w-0 flex-1 items-center justify-between gap-3 text-left">
                <span className="min-w-0">
                  <span className={cn("block truncate text-[15px] font-bold", on ? "text-accent-text" : "text-gray-900")}>{r.label}</span>
                  <span className="block truncate text-[12px] font-medium text-gray-500">{r.note}</span>
                </span>
                <span aria-hidden className={cn("flex h-6 w-6 shrink-0 items-center justify-center rounded-full", on ? "bg-tide-strong text-white" : "border border-line")}>
                  {on && (
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                      <path d="M5 12.5l4.5 4.5L19 7.5" />
                    </svg>
                  )}
                </span>
              </button>
            </li>
          );
        })}
      </ListCard>
    </div>
  );
}

/** One month's goal: the life goal, or (`pc`) the P&C goal. */
function GoalForm({ month, pc = false }: { month: MonthGoal; pc?: boolean }) {
  const [pending, start] = useTransition();
  const id = `${pc ? "pc-goal" : "goal"}-${month.key}`;
  const cents = pc ? month.pcCents : month.cents;
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const form = new FormData(e.currentTarget);
        start(async () => {
          const r = pc ? await saveTeamPcGoal(month.key, form) : await saveTeamGoal(month.key, form);
          toast(r.ok ? (r.message ?? "Saved.") : r.error, r.ok);
        });
      }}
      className="flex items-end gap-2"
    >
      <div className="min-w-0 flex-1">
        <Label htmlFor={id}>
          {month.label}
          {month.current ? " (this month)" : ""}
        </Label>
        <div className="relative">
          <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 font-mono text-[16px] font-bold text-gray-400">$</span>
          <Input id={id} name={pc ? "pc_goal" : "goal"} inputMode="decimal" defaultValue={cents ? String(cents / 100) : ""} placeholder={pc ? "30000" : "150000"} className="pl-7 font-mono" />
        </div>
      </div>
      <Button type="submit" className="h-11 rounded-xl" disabled={pending}>
        {pending ? "Saving..." : "Save"}
      </Button>
    </form>
  );
}

function BoardForm({ settings }: { settings: AppSettings }) {
  const [pending, start] = useTransition();
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const form = new FormData(e.currentTarget);
        start(async () => {
          const r = await saveBoardSettings(form);
          toast(r.ok ? (r.message ?? "Saved.") : r.error, r.ok);
        });
      }}
      className="mt-2 space-y-3 rounded-[22px] bg-surface p-4 shadow-card"
    >
      <div>
        <Label htmlFor="message">Message on the board (one line, optional)</Label>
        <Input id="message" name="message" defaultValue={settings.message} maxLength={120} placeholder="Every policy counts. Finish strong." />
      </div>
      <div>
        <Label htmlFor="carriers">Life carriers on Log a sale (one per line; a sale always names one)</Label>
        <Textarea id="carriers" name="carriers" defaultValue={settings.carriers.join("\n")} rows={7} className="font-medium" />
      </div>
      <div>
        <Label htmlFor="products">Life product chips on Log a sale (one per line)</Label>
        <Textarea id="products" name="products" defaultValue={settings.products.join("\n")} rows={5} className="font-medium" />
      </div>
      <div>
        <Label htmlFor="pc_carriers">P&amp;C carriers and the lines each one writes (one per line, like &quot;Progressive: Auto, Renters, ATV&quot;)</Label>
        <Textarea id="pc_carriers" name="pc_carriers" defaultValue={settings.pcCarriers.map((c) => (c.lines.length ? `${c.name}: ${c.lines.join(", ")}` : c.name)).join("\n")} rows={6} className="font-medium" />
      </div>
      <Button type="submit" className="h-11 rounded-xl" disabled={pending}>
        {pending ? "Saving..." : "Save"}
      </Button>
      <Notice tone="blue">The TV board refreshes on its own every few seconds. Open it from the initials menu, then press F for full screen.</Notice>
    </form>
  );
}
