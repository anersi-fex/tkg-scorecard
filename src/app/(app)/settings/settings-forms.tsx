"use client";

import { useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { COLORWAYS, COLORWAY_KEYS, type ColorwayKey } from "@/lib/colorways";
import { PC_COLORS, PC_COLOR_KEYS, pcLooksLikeLife, type PcColorKey } from "@/lib/pc-colors";
import { cn } from "@/components/ui";
import { BOARD_THEMES, TV_SCREENS, type AppSettings, type BoardTheme, type TvScreens } from "@/lib/types";
import { SOUNDS, type SoundKey } from "@/lib/sounds";
import { Icon } from "@/components/ui/icon";
import { Field, MoneyInput, Panel, Rail, TextArea, TextInput, btn } from "@/components/ui/kit";
import { Segmented } from "@/components/ui/segmented";
import { saveBoardSettings, saveBoardTheme, saveColorway, savePcColor, saveSaleLists, saveSaleSound, saveTeamGoal, saveTeamPcGoal, saveTvScreens } from "../actions";
import { saveAgencyName, savePcEnabled } from "../people-actions";
import { Switch } from "@/components/switch";
import { toast } from "@/components/toaster";
import s from "./settings.module.css";

interface MonthGoal {
  key: string;
  label: string;
  /** The life goal (the one the board measures) and the P&C goal. */
  cents: number;
  pcCents: number;
  current: boolean;
}

type Result = { ok: true; message?: string } | { ok: false; error: string };

/** Runs an action and says how it went; a dropped connection is said plainly. */
async function say(work: () => Promise<Result>): Promise<boolean> {
  try {
    const r = await work();
    toast(r.ok ? (r.message ?? "Saved.") : r.error, r.ok);
    return r.ok;
  } catch {
    toast("Couldn't reach the server. Try again.", false);
    return false;
  }
}

/**
 * Settings (the demo the owner approved on 2026-11-12): the agency's name and the board message,
 * the goals; the lists Log a sale offers (carriers and products, rate classes, lead sources); the
 * TV (screens, look, sale sound) and the colorway. The sign-ins, the Shortcut and the P&C switch
 * are the owner's alone; an admin sees them locked, and is sent nothing they would show.
 */
export function SettingsForms({
  settings,
  months,
  progress,
  shortcutReady,
  shortcutTooShort,
  teamPasswordSet,
  base,
  owner = false,
}: {
  settings: AppSettings;
  months: MonthGoal[];
  /** This month's life production against its goal, for the line under the goal. */
  progress: { pct: number; projected: string } | null;
  shortcutReady: boolean;
  /** LOG_TOKEN is set but shorter than the route accepts. */
  shortcutTooShort: boolean;
  teamPasswordSet: boolean;
  base: string;
  /** The owner alone gets Sign-ins, the Shortcut card and the P&C switch (an admin never sees them). */
  owner?: boolean;
}) {
  // Life only (owner, 2026-11-12): with the P&C board off, nothing on this screen names P&C
  // except the owner's one switch.
  const pcOn = settings.pcEnabled === true;
  return (
    <div className={s.grid}>
      <div className={s.col}>
        <Panel title="Agency name and board message" sub="The agency's name shows beside the Scorecard mark on every screen and the TV." data-agency-name>
          <AgencyForm name={settings.agencyName} message={settings.message} />
        </Panel>
        <Panel title="Goals" sub={pcOn ? "Life annual premium for the whole agency: the line the board measures." : "Annual premium for the whole agency: the line the board measures."}>
          <div className="stack">
            {months.map((m) => (
              <GoalForm key={m.key} month={m} />
            ))}
            {progress && (
              <div>
                <Rail value={progress.pct / 100} label={`${progress.pct}% of the goal`} />
                <div className="mt-2 flex justify-between gap-3 small muted">
                  <span>
                    <b className="strong">{progress.pct}%</b> so far
                  </span>
                  <span>
                    On pace for <b className="strong">{progress.projected}</b>
                  </span>
                </div>
              </div>
            )}
            <p className="small muted flex items-start gap-2 border-t border-line pt-3">
              <Icon name="user" size={15} className="mt-0.5 flex-none" />
              <span>
                Personal goals are on each person&apos;s card in{" "}
                <Link href="/team" className="link">
                  People
                </Link>
                .
              </span>
            </p>
          </div>
        </Panel>
        {pcOn && owner && (
          <Panel title="P&C goal" sub="P&C annual premium for the P&C team. The agency total adds both goals up.">
            <div className="stack">
              {months.map((m) => (
                <GoalForm key={m.key} month={m} pc />
              ))}
            </div>
          </Panel>
        )}
      </div>

      <div className={s.col}>
        <Panel title="Carriers and products" sub="What Log a sale offers, one carrier per line with its products after a colon. A change shows there at once." data-carriers>
          <ListForm field="carrier_products" label="Carriers and products" rows={10} value={Object.entries(settings.carrierProducts).map(([c, p]) => `${c}: ${p.join(", ")}`).join("\n")} help={'Like "Americo: WL/FEX, TERM, IUL". A carrier with no products gets WL/FEX.'} />
        </Panel>
        <Panel title="Rate classes" sub="The choices on Log a sale, one per line." data-rate-classes>
          <ListForm field="rate_classes" label="Rate classes" rows={6} value={settings.rateClasses.join("\n")} />
        </Panel>
        <Panel title="Lead sources" sub="The choices on Log a sale, one per line." data-lead-sources>
          <ListForm field="lead_sources" label="Lead sources" rows={8} value={settings.leadSources.join("\n")} />
        </Panel>
        {pcOn && owner && (
          <Panel title="P&C carriers" sub='The P&C carriers and the lines each one writes, one per line, like "Progressive: Auto, Renters, ATV".'>
            <PcCarriersForm settings={settings} />
          </Panel>
        )}
      </div>

      <div className={s.col}>
        <Panel title={owner ? "Only you" : "Only Anersi"} sub={owner ? "Admins see these locked." : "These stay with the owner."} data-owner-only-settings>
          {owner ? (
            <div>
              <div className={s.ownerRow} data-sign-ins>
                <b>Sign-ins</b>
                Everyone signs in with their own cell number and password; the join link is on People. Changing OWNER_PASSWORD in Vercel signs out every device that used it.{" "}
                {teamPasswordSet ? "The team password is for the TV and phones that haven't joined: it shows the boards and never logs a sale." : "Add TEAM_PASSWORD in Vercel for the TV and phones that haven't joined yet."}
              </div>
              <div className={s.ownerRow} data-shortcut>
                <b>iPhone Shortcut and NFC tags</b>
                {shortcutReady ? (
                  <>
                    Ready. A Shortcut can log a sale straight to the board (SETUP.md, Phase 2). It sends to <code className="font-mono">{base || ""}/api/sales</code> with your LOG_TOKEN.
                  </>
                ) : shortcutTooShort ? (
                  "LOG_TOKEN is too short: use at least 12 characters (24 or more is best) in Vercel, then redeploy. Until then every Shortcut call is refused."
                ) : (
                  "Not set up yet. Add LOG_TOKEN in Vercel (any long random text) to let a Shortcut log sales. A tag can open each person's desk link from People."
                )}
              </div>
              <div className={s.ownerRow} data-other-lines>
                <b>Other lines of business</b>
                <PcBoardSwitch on={pcOn} />
              </div>
            </div>
          ) : (
            <div>
              {["Sign-ins", "Other lines of business"].map((t) => (
                <div key={t} className={s.locked}>
                  <span className={s.lockIco}>
                    <Icon name="lock" size={16} />
                  </span>
                  <span>
                    <span className={s.rTitle}>{t}</span>
                    <span className={s.rSub}>Only Anersi can change this</span>
                  </span>
                </div>
              ))}
            </div>
          )}
        </Panel>
        <Panel title="TV screens" sub="What the office TV shows. It follows within a few seconds.">
          {/* A TV left on "P&C only" or "Agency total only" from before shows the leaderboard while P&C is off: light that row. */}
          <TvScreensPicker current={!pcOn && (settings.tvScreens === "pc" || settings.tvScreens === "total") ? "life" : settings.tvScreens} pcOn={pcOn} />
        </Panel>
        <Panel title="TV look" sub="Light or dark on the office TV.">
          <BoardThemePicker current={settings.boardTheme} />
        </Panel>
        <Panel title="Sale sound" sub="What the TV plays when a sale lands. Tap a name to pick it; the play button tries it here.">
          <SoundPicker current={settings.sound} />
        </Panel>
        <Panel title="Colorway" sub="The accent on every screen and the TV. The app icon stays Crimson.">
          <ColorwayPicker current={settings.colorway} />
        </Panel>
        {pcOn && owner && (
          <Panel title="P&C color" sub="P&C's own color on the bars, rings and tags.">
            <PcColorPicker current={settings.pcColor} colorway={settings.colorway} />
          </Panel>
        )}
      </div>
    </div>
  );
}

/** The agency's name and the one line at the bottom of the TV, saved together. */
function AgencyForm({ name, message }: { name: string; message: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <form
      // A tap before the page's script has loaded sends the form the plain way: by post, so what was typed never lands in the address.
      method="post"
      onSubmit={(e) => {
        e.preventDefault();
        const form = new FormData(e.currentTarget);
        start(async () => {
          try {
            const msg = String(form.get("message") ?? "").trim();
            const named = String(form.get("agency_name") ?? "").trim();
            // The message first (it never fails on its own), then the name, whose words say what changed.
            const m = msg !== message.trim() ? await saveBoardSettings(form) : null;
            if (m && !m.ok) return void toast(m.error, false);
            const r = named !== name || !m ? await saveAgencyName(form) : m;
            toast(r.ok ? (r.message ?? "Saved.") : r.error, r.ok);
            if (r.ok) router.refresh();
          } catch {
            toast("Couldn't reach the server. Try again.", false);
          }
        });
      }}
      className="stack"
    >
      <Field label="Agency name" htmlFor="agency_name" required>
        <TextInput id="agency_name" name="agency_name" defaultValue={name} maxLength={40} placeholder="Lineage Financial" autoComplete="off" required />
      </Field>
      <Field label="Board message" htmlFor="message" help="One line at the bottom of the TV. Optional.">
        <TextInput id="message" name="message" defaultValue={message} maxLength={120} placeholder="Every policy counts. Finish strong." />
      </Field>
      <div className={s.foot}>
        <button type="submit" className={btn("primary")} disabled={pending}>
          {pending ? "Saving..." : "Save"}
        </button>
      </div>
    </form>
  );
}

/** One list in Settings (one entry per line), saved by saveSaleLists. */
function ListForm({ field, label, value, rows, help }: { field: "carrier_products" | "rate_classes" | "lead_sources"; label: string; value: string; rows: number; help?: ReactNode }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <form
      method="post"
      onSubmit={(e) => {
        e.preventDefault();
        const form = new FormData(e.currentTarget);
        start(async () => {
          if (await say(() => saveSaleLists(form))) router.refresh();
        });
      }}
      className="stack"
    >
      <Field label={label} htmlFor={field} help={help}>
        <TextArea id={field} name={field} defaultValue={value} rows={rows} className={s.textarea} spellCheck={false} />
      </Field>
      <div className={s.foot}>
        <button type="submit" className={btn("secondary")} disabled={pending}>
          {pending ? "Saving..." : "Save"}
        </button>
      </div>
    </form>
  );
}

/** The P&C carriers (the owner, while P&C is on): the board form with only that box and the message it keeps. */
function PcCarriersForm({ settings }: { settings: AppSettings }) {
  const [pending, start] = useTransition();
  return (
    <form
      method="post"
      onSubmit={(e) => {
        e.preventDefault();
        const form = new FormData(e.currentTarget);
        start(async () => {
          await say(() => saveBoardSettings(form));
        });
      }}
      className="stack"
    >
      <input type="hidden" name="message" value={settings.message} />
      <TextArea id="pc_carriers" name="pc_carriers" aria-label="P&C carriers" defaultValue={settings.pcCarriers.map((c) => (c.lines.length ? `${c.name}: ${c.lines.join(", ")}` : c.name)).join("\n")} rows={6} />
      <div className={s.foot}>
        <button type="submit" className={btn("secondary")} disabled={pending}>
          {pending ? "Saving..." : "Save"}
        </button>
      </div>
    </form>
  );
}

/**
 * The owner's one switch for P&C (owner, 2026-11-12: "This is only gonna be life insurance"):
 * off, P&C sales and goals stop counting and no screen names them; on, the P&C board, the
 * life and P&C total and their settings come back. Nothing is deleted either way.
 */
function PcBoardSwitch({ on }: { on: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [checked, setChecked] = useState(on);
  const [seen, setSeen] = useState(on);
  if (seen !== on) {
    setSeen(on);
    setChecked(on);
  }
  return (
    <div className="mt-2 flex items-center justify-between gap-3">
      <span>{checked ? "P&C board on: P&C sales count on their own board, beside life." : "P&C board off: life insurance only. Turning it on brings back the P&C board and its settings. Nothing is deleted."}</span>
      <Switch
        checked={checked}
        disabled={pending}
        label="P&C board"
        onChange={(next) => {
          setChecked(next);
          start(async () => {
            if (await say(() => savePcEnabled(next))) router.refresh();
            else setChecked(!next);
          });
        }}
      />
    </div>
  );
}

function ColorwayPicker({ current }: { current: ColorwayKey }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [picked, setPicked] = useState<ColorwayKey>(current);
  return (
    <div role="radiogroup" aria-label="Colorway" className={s.swatches}>
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
            data-colorway={key}
            onClick={() => {
              setPicked(key);
              // This screen changes at once; every other screen on the next load; the TV on its next poll.
              document.documentElement.setAttribute("data-colorway", key);
              start(async () => {
                if (await say(() => saveColorway(key))) router.refresh();
                else {
                  setPicked(current);
                  document.documentElement.setAttribute("data-colorway", current);
                }
              });
            }}
            className={cn(s.swatch, on && s.on)}
          >
            <span aria-hidden className={s.chipSq} style={{ background: `linear-gradient(135deg, ${c.swatch[0]}, ${c.swatch[1]})` }} />
            <span className="min-w-0">
              <span className={cn(s.rTitle, on && "accent-text")}>{c.name}</span>
              <span className={cn(s.rSub, "truncate")}>{c.idea}</span>
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
      <div role="radiogroup" aria-label="P&C color" className={s.swatches}>
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
                document.documentElement.setAttribute("data-pc-color", key);
                start(async () => {
                  if (await say(() => savePcColor(key))) router.refresh();
                  else {
                    setPicked(current);
                    document.documentElement.setAttribute("data-pc-color", current);
                  }
                });
              }}
              className={cn(s.swatch, on && s.on)}
            >
              <span aria-hidden className={s.chipSq} style={{ background: `linear-gradient(135deg, ${c.swatch[0]}, ${c.swatch[1]})` }} />
              <span className="min-w-0">
                <span className={cn(s.rTitle, on && "accent-text")}>{c.name}</span>
                <span className={cn(s.rSub, "truncate")}>{c.idea}</span>
              </span>
            </button>
          );
        })}
      </div>
      {pcLooksLikeLife(colorway, picked) && (
        <p className="mt-2 small down-text">
          {COLORWAYS[colorway].name} is close to {PC_COLORS[picked].name}, so P&amp;C can look like life. {colorway === "emerald" ? "Dusty blue or Silver" : "Silver or Sage"} keeps them apart.
        </p>
      )}
    </>
  );
}

/** Light / Dark for the TV, saved on tap; the TV picks it up on its next poll. */
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
    <Segmented<BoardTheme>
      label="TV look"
      full
      value={picked}
      items={BOARD_THEMES.map((key) => ({ key, label: key === "dark" ? "Dark" : "Light", disabled: pending }))}
      onChange={(key) => {
        setPicked(key);
        start(async () => {
          if (await say(() => saveBoardTheme(key))) router.refresh();
          else setPicked(current);
        });
      }}
    />
  );
}

const TV_SCREEN_OPTIONS: Record<TvScreens, { label: string; note: string }> = {
  rotate: { label: "Rotate", note: "Leaderboard 40 s, the others 20 s each" },
  life: { label: "Leaderboard", note: "Everyone's month, ranked" },
  scoreboard: { label: "Scoreboard", note: "Production, policies, where agents stand" },
  production: { label: "Production", note: "Day by day for each person" },
  teams: { label: "Teams", note: "One row per leader" },
  pc: { label: "P&C only", note: "P&C sales and the P&C team" },
  total: { label: "Agency total only", note: "Life and P&C added up" },
};

/** Settings > TV screens: the TV rotates its screens, or stays on one; saved on a tap. P&C's two screens are offered only while P&C is on. */
function TvScreensPicker({ current, pcOn }: { current: TvScreens; pcOn: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [picked, setPicked] = useState<TvScreens>(current);
  const [seen, setSeen] = useState(current);
  if (seen !== current) {
    setSeen(current);
    setPicked(current);
  }
  const pick = (key: TvScreens) => {
    if (key === picked) return;
    setPicked(key);
    start(async () => {
      if (await say(() => saveTvScreens(key))) router.refresh();
      else setPicked(current);
    });
  };
  return (
    <div role="radiogroup" aria-label="TV screens" className={s.radios}>
      {TV_SCREENS.filter((key) => pcOn || (key !== "pc" && key !== "total")).map((key) => {
        const o = TV_SCREEN_OPTIONS[key];
        const on = picked === key;
        return (
          <button key={key} type="button" role="radio" aria-checked={on} disabled={pending} onClick={() => pick(key)} className={s.radio}>
            <span aria-hidden className={cn(s.dot, on && s.on)} />
            <span className="min-w-0">
              <span className={s.rTitle}>{o.label}</span>
              <span className={s.rSub}>{o.note}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** The sound rows: the play button hears one here; a tap on the name picks it and saves at once. */
function SoundPicker({ current }: { current: SoundKey }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [picked, setPicked] = useState<SoundKey>(current);
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
      if (await say(() => saveSaleSound(key))) router.refresh();
      else setPicked(current);
    });
  };
  const rows: Array<{ key: SoundKey; label: string; note: string; file: string | null }> = [...SOUNDS, { key: "off", label: "Off", note: "The banner only, no sound", file: null }];
  return (
    <div role="radiogroup" aria-label="Sale sound" className={s.radios} data-sound>
      {rows.map((r) => {
        const on = picked === r.key;
        const live = playing === r.key;
        return (
          <div key={r.key} className={s.soundRow}>
            <button type="button" role="radio" aria-checked={on} disabled={pending} onClick={() => pick(r.key)} className={s.radio}>
              <span aria-hidden className={cn(s.dot, on && s.on)} />
              <span className="min-w-0">
                <span className={s.rTitle}>{r.label}</span>
                <span className={s.rSub}>{r.note.charAt(0).toUpperCase() + r.note.slice(1)}</span>
              </span>
            </button>
            {r.file && (
              <button type="button" aria-label={`${live ? "Stop" : "Play"} ${r.label}`} onClick={() => play(r.key, r.file as string)} className={cn(s.play, live && s.live)}>
                <Icon name={live ? "close" : "play"} size={16} />
              </button>
            )}
          </div>
        );
      })}
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
      // A tap before the page's script has loaded sends the form the plain way: by post, so what was typed never lands in the address.
      method="post"
      onSubmit={(e) => {
        e.preventDefault();
        const form = new FormData(e.currentTarget);
        start(async () => {
          await say(() => (pc ? saveTeamPcGoal(month.key, form) : saveTeamGoal(month.key, form)));
        });
      }}
      className={s.formRow}
    >
      <Field label={`${month.label}${month.current ? " (this month)" : ""}`} htmlFor={id}>
        <MoneyInput id={id} name={pc ? "pc_goal" : "goal"} defaultValue={cents ? String(cents / 100) : ""} placeholder={pc ? "30000" : "150000"} />
      </Field>
      <button type="submit" className={btn("primary")} disabled={pending}>
        {pending ? "Saving..." : "Save"}
      </button>
    </form>
  );
}
