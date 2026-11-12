"use client";

import { useMemo, useState, useTransition, type FormEvent } from "react";
import { Button, Input, Label, Notice, cn } from "@/components/ui";
import { Switch } from "@/components/switch";
import { PasswordField } from "@/app/login/password-field";
import { join, type JoinState } from "./actions";

export interface JoinFormProps {
  token: string;
  kind: "agency" | "person" | "reset";
  /** The person a personal or reset link is for. */
  firstName?: string;
  /** Everyone on the board, names only: who a new person can pick as their upline. */
  people: { id: string; name: string }[];
  /**
   * The agency link only: the people already on the board with no sign-in yet, as the board
   * spells them. Names and nothing else (no id, no number).
   */
  unclaimed?: string[];
  /** The leader this link belongs to: already picked. */
  leaderId: string | null;
  needsPhone: boolean;
  inOffice: boolean;
}

const FIELD = "text-[15px]";

/**
 * The join card's form. Submits through onSubmit, so a refused try keeps everything that was
 * typed. Nothing is decided here: the server checks the link, the name, the number and the password.
 */
export function JoinForm({ token, kind, people, unclaimed = [], leaderId, needsPhone, inOffice }: JoinFormProps) {
  const [error, setError] = useState<string | null>(null);
  // The name is kept here so a tap on "Already on the board?" can write the board's spelling into it.
  const [name, setName] = useState("");
  const [pending, startTransition] = useTransition();
  const [office, setOffice] = useState(inOffice);
  const [upline, setUpline] = useState<string | null>(leaderId);
  const [unsure, setUnsure] = useState(false);

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    const form = new FormData(e.currentTarget);
    setError(null);
    startTransition(async () => {
      let state: JoinState;
      try {
        state = await join(form);
      } catch {
        state = { error: "Scorecard didn't answer. Check your connection and try again." };
      }
      // A join that worked never comes back here: the action sends the phone on.
      if (state?.error) setError(state.error);
    });
  }

  return (
    <form method="post" onSubmit={onSubmit} className="space-y-[18px]" data-join={kind}>
      <input type="hidden" name="token" value={token} />
      <input type="hidden" name="in_office" value={office ? "1" : "0"} />
      <input type="hidden" name="upline_id" value={unsure ? "" : (upline ?? "")} />
      {kind === "agency" && (
        <div>
          <Label htmlFor="name">
            First and last name
          </Label>
          <Input id="name" name="name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" autoCapitalize="words" maxLength={60} placeholder="Alex Smith" className={FIELD} required />
          {unclaimed.length > 0 && <ClaimNames names={unclaimed} typed={name} onPick={setName} />}
        </div>
      )}
      {needsPhone && (
        <div>
          <Label htmlFor="phone">
            Cell number
          </Label>
          <Input id="phone" name="phone" type="tel" inputMode="tel" autoComplete="tel" placeholder="248 555 0100" className={FIELD} required />
        </div>
      )}
      {kind === "agency" && (
        <UplinePicker
          people={people}
          picked={unsure ? null : upline}
          unsure={unsure}
          onPick={(id) => {
            setUpline(id);
            setUnsure(false);
          }}
          onUnsure={() => {
            setUpline(null);
            setUnsure(true);
          }}
          onClear={() => {
            setUpline(null);
            setUnsure(false);
          }}
        />
      )}
      {kind !== "reset" && (
        <div className="flex min-h-12 items-center justify-between gap-3 rounded-[10px] bg-input px-3.5 py-2.5">
          <div className="min-w-0">
            <p className="text-[14px] font-medium text-fg">I work in the office</p>
            <p className="text-[12.5px] leading-snug text-fg-2">The office group is at the top of the board.</p>
          </div>
          <Switch checked={office} onChange={setOffice} label="I work in the office" />
        </div>
      )}
      <div>
        <Label htmlFor="password">
          {kind === "reset" ? "New password" : "Password"}
        </Label>
        <PasswordField id="password" name="password" autoComplete="new-password" minLength={8} maxLength={200} required />
        <p className="mt-1.5 text-[12.5px] text-fg-2">8 characters or more. You pick it; nobody else sees it.</p>
      </div>
      {error && <Notice tone="red">{error}</Notice>}
      <Button type="submit" className="min-h-[46px] w-full text-[15px]" disabled={pending}>
        {pending ? "One moment..." : kind === "agency" ? "Join" : kind === "person" ? "Set up my sign-in" : "Save my new password"}
      </Button>
    </form>
  );
}

const fold = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

/** Past this many names the chips become a short list that follows what is typed in the name field. */
const CHIP_LIMIT = 12;

/** Two words that are likely the same name written two ways: one starts the other ("matt", "matthew"), or they share their first three letters ("dangelo", "dangerlo"). */
function alike(a: string, b: string): boolean {
  if (a.startsWith(b) || b.startsWith(a)) return true;
  return a.length >= 3 && b.length >= 3 && a.slice(0, 3) === b.slice(0, 3);
}

/**
 * "Already on the board? Tap your name." (2026-11-12). The join claims a person's row only when
 * the name is the board's own spelling, so "Matt" on the board and "Matthew" typed made a second
 * row. A tap writes the board's spelling into the name field; the chip is the chosen one for as
 * long as the field still says that name, so typing a different name clears it. Up to twelve
 * names are chips; more are a short list that narrows to the names like what is being typed.
 */
function ClaimNames({ names, typed, onPick }: { names: string[]; typed: string; onPick: (name: string) => void }) {
  const text = fold(typed);
  const chosen = names.find((n) => fold(n) === text) ?? null;
  const long = names.length > CHIP_LIMIT;
  // The names like what is in the field (a word of one starts, or nearly starts, a word of the other).
  const near = useMemo(() => {
    if (!text) return [];
    const words = text.split(" ");
    const like = names.filter((n) => {
      const theirs = fold(n).split(" ");
      return words.some((w) => theirs.some((t) => alike(w, t)));
    });
    // The name that starts the way the field does comes first.
    return [...like.filter((n) => fold(n).startsWith(text)), ...like.filter((n) => !fold(n).startsWith(text))];
  }, [names, text]);
  // The chips always show every name; the long list shows every name until something is typed.
  const shown = long && text ? near : names;

  return (
    <div className="mt-2" data-claim={long ? "list" : "chips"}>
      <p className="text-[12.5px] leading-snug font-medium text-fg-2">Already on the board? Tap your name.</p>
      {shown.length > 0 ? (
        <div className={cn("mt-1.5 flex flex-wrap gap-1.5", long && "max-h-[140px] overflow-y-auto overscroll-contain rounded-[10px] border border-line p-2")}>
          {shown.map((n) => {
            const on = n === chosen;
            return (
              <button
                key={n}
                type="button"
                aria-pressed={on}
                data-claim-name={n}
                onClick={() => onPick(n)}
                className={cn(
                  "inline-flex min-h-[34px] max-w-full items-center gap-1.5 rounded-[9px] border px-3 text-[13px] font-medium transition-colors",
                  // While a name is being typed, the chips like it stand out, so "Matthew" sees "Matt Fouchey".
                  on ? "border-accent bg-accent-soft text-fg" : !chosen && near.includes(n) ? "border-fg-2 bg-surface-2 text-fg" : "border-line-2 bg-surface-2 text-fg hover:border-fg-3",
                )}
              >
                {on && (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="shrink-0">
                    <path d="M5 12.5l4.5 4.5L19 7.5" />
                  </svg>
                )}
                <span className="truncate">{n}</span>
              </button>
            );
          })}
        </div>
      ) : (
        <p className="mt-1 text-[12.5px] leading-snug text-fg-2">Nobody by that name is waiting on the board. That&apos;s fine: you&apos;ll be added.</p>
      )}
      {chosen && (
        <p className="mt-1.5 text-[12.5px] leading-snug font-medium text-accent-text" data-claim-chosen>
          That&apos;s you on the board. Your numbers stay with you.
        </p>
      )}
    </div>
  );
}

/** "Who is your upline?": type a few letters, tap the name. "I'm not sure" is a fine answer. */
function UplinePicker({
  people,
  picked,
  unsure,
  onPick,
  onUnsure,
  onClear,
}: {
  people: { id: string; name: string }[];
  picked: string | null;
  unsure: boolean;
  onPick: (id: string) => void;
  onUnsure: () => void;
  onClear: () => void;
}) {
  const [query, setQuery] = useState("");
  const pickedName = picked ? (people.find((p) => p.id === picked)?.name ?? null) : null;
  const matches = useMemo(() => {
    const q = fold(query);
    if (!q) return [];
    // A name that starts with what was typed comes first, then a name that holds it.
    const starts = people.filter((p) => fold(p.name).startsWith(q) || fold(p.name).split(" ").some((w) => w.startsWith(q)));
    const holds = people.filter((p) => !starts.includes(p) && fold(p.name).includes(q));
    return [...starts, ...holds].slice(0, 6);
  }, [people, query]);

  if (pickedName || unsure) {
    return (
      <div>
        <p className="mb-2 block text-[13.5px] font-medium text-fg">Who is your upline?</p>
        <div className="flex min-h-11 items-center justify-between gap-2 rounded-[10px] bg-input py-1 pr-1.5 pl-3.5" data-upline={picked ?? "unsure"}>
          <div className="min-w-0">
            <p className="truncate text-[14.5px] font-medium text-fg">{pickedName ?? "I'm not sure"}</p>
            {unsure && <p className="text-[12.5px] leading-snug text-fg-2">That&apos;s fine. An admin will put you on the right team.</p>}
          </div>
          <button
            type="button"
            onClick={() => {
              setQuery("");
              onClear();
            }}
            className="min-h-9 shrink-0 rounded-lg px-3 text-[13px] font-medium text-accent-text hover:bg-accent-soft"
          >
            Change
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <Label htmlFor="upline-search">
        Who is your upline?
      </Label>
      <Input
        id="upline-search"
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        // Enter picks the first name instead of sending the whole form.
        onKeyDown={(e) => {
          if (e.key !== "Enter") return;
          e.preventDefault();
          if (matches[0]) onPick(matches[0].id);
        }}
        autoComplete="off"
        enterKeyHint="search"
        placeholder="Type their name"
        className={FIELD}
        aria-controls="upline-list"
      />
      {query.trim() !== "" && (
        <ul id="upline-list" className="mt-2 overflow-hidden rounded-[10px] border border-line-2 bg-surface-2">
          {matches.map((p, i) => (
            <li key={p.id}>
              <button type="button" onClick={() => onPick(p.id)} className={cn("flex min-h-11 w-full items-center px-3.5 text-left text-[14px] font-medium text-fg hover:bg-hover", i > 0 && "border-t border-line")}>
                {p.name}
              </button>
            </li>
          ))}
          {matches.length === 0 && <li className="px-3.5 py-3 text-[13.5px] text-fg-2">Nobody by that name yet. Check the spelling, or tap &ldquo;I&apos;m not sure&rdquo;.</li>}
        </ul>
      )}
      <button type="button" onClick={onUnsure} className="mt-1 min-h-10 rounded-lg px-2 text-[13.5px] font-medium text-accent-text hover:underline">
        I&apos;m not sure
      </button>
    </div>
  );
}
