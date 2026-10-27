"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { COLORWAYS, COLORWAY_KEYS, type ColorwayKey } from "@/lib/colorways";
import { cn } from "@/components/ui";
import type { AppSettings } from "@/lib/types";
import { Button, Input, Label, Notice, Textarea } from "@/components/ui";
import { ListCard, ListTitle } from "@/components/tide";
import { saveBoardSettings, saveColorway, saveTeamGoal } from "../actions";
import { toast } from "@/components/toaster";

interface MonthGoal {
  key: string;
  label: string;
  cents: number;
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
        <ListTitle>Team goal</ListTitle>
        <p className="mt-1 px-1 text-[13px] text-gray-500">Annual premium for the whole team. The board shows how close you are and what each day needs.</p>
        <ListCard className="mt-2 divide-y divide-line">
          {months.map((m) => (
            <li key={m.key} className="px-4 py-3">
              <GoalForm month={m} />
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
                const r = await saveColorway(key);
                toast(r.ok ? (r.message ?? "Saved.") : r.error, r.ok);
                if (r.ok) router.refresh();
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

function GoalForm({ month }: { month: MonthGoal }) {
  const [pending, start] = useTransition();
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const form = new FormData(e.currentTarget);
        start(async () => {
          const r = await saveTeamGoal(month.key, form);
          toast(r.ok ? (r.message ?? "Saved.") : r.error, r.ok);
        });
      }}
      className="flex items-end gap-2"
    >
      <div className="min-w-0 flex-1">
        <Label htmlFor={`goal-${month.key}`}>
          {month.label}
          {month.current ? " (this month)" : ""}
        </Label>
        <div className="relative">
          <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 font-mono text-[16px] font-bold text-gray-400">$</span>
          <Input id={`goal-${month.key}`} name="goal" inputMode="decimal" defaultValue={month.cents ? String(month.cents / 100) : ""} placeholder="150000" className="pl-7 font-mono" />
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
        <Label htmlFor="products">Product chips on Log a sale (one per line)</Label>
        <Textarea id="products" name="products" defaultValue={settings.products.join("\n")} rows={5} className="font-medium" />
      </div>
      <Button type="submit" className="h-11 rounded-xl" disabled={pending}>
        {pending ? "Saving..." : "Save"}
      </Button>
      <Notice tone="blue">The TV board refreshes on its own every few seconds. Open it from the initials menu, then press F for full screen.</Notice>
    </form>
  );
}
