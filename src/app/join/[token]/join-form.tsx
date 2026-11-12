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
  /** The leader this link belongs to: already picked. */
  leaderId: string | null;
  needsPhone: boolean;
  inOffice: boolean;
}

const FIELD = "h-12 rounded-2xl text-[17px]";

/**
 * The join card's form. Submits through onSubmit, so a refused try keeps everything that was
 * typed. Nothing is decided here: the server checks the link, the name, the number and the password.
 */
export function JoinForm({ token, kind, people, leaderId, needsPhone, inOffice }: JoinFormProps) {
  const [error, setError] = useState<string | null>(null);
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
    <form method="post" onSubmit={onSubmit} className="space-y-4" data-join={kind}>
      <input type="hidden" name="token" value={token} />
      <input type="hidden" name="in_office" value={office ? "1" : "0"} />
      <input type="hidden" name="upline_id" value={unsure ? "" : (upline ?? "")} />
      {kind === "agency" && (
        <div>
          <Label htmlFor="name" className="font-semibold">
            First and last name
          </Label>
          <Input id="name" name="name" autoComplete="name" autoCapitalize="words" maxLength={60} placeholder="Alex Smith" className={FIELD} required />
        </div>
      )}
      {needsPhone && (
        <div>
          <Label htmlFor="phone" className="font-semibold">
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
        <div className="flex min-h-12 items-center justify-between gap-3 rounded-2xl border border-line px-3.5 py-2">
          <div className="min-w-0">
            <p className="text-[15px] font-semibold text-gray-900">I work in the office</p>
            <p className="text-[12.5px] leading-snug text-gray-500">The office group is at the top of the board.</p>
          </div>
          <Switch checked={office} onChange={setOffice} label="I work in the office" />
        </div>
      )}
      <div>
        <Label htmlFor="password" className="font-semibold">
          {kind === "reset" ? "New password" : "Password"}
        </Label>
        <PasswordField id="password" name="password" autoComplete="new-password" minLength={8} maxLength={200} required />
        <p className="mt-1.5 text-[12.5px] text-gray-500">8 characters or more. You pick it; nobody else sees it.</p>
      </div>
      {error && <Notice tone="red">{error}</Notice>}
      <Button type="submit" className="h-12 w-full rounded-2xl text-[15px]" disabled={pending}>
        {pending ? "One moment..." : kind === "agency" ? "Join" : kind === "person" ? "Set up my sign-in" : "Save my new password"}
      </Button>
    </form>
  );
}

const fold = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

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
        <p className="mb-1 block text-sm font-semibold text-gray-700">Who is your upline?</p>
        <div className="flex min-h-12 items-center justify-between gap-2 rounded-2xl border border-line bg-tint py-1 pr-1.5 pl-3.5" data-upline={picked ?? "unsure"}>
          <div className="min-w-0">
            <p className="truncate text-[16px] font-bold text-gray-900">{pickedName ?? "I'm not sure"}</p>
            {unsure && <p className="text-[12.5px] leading-snug text-gray-600">That&apos;s fine. An admin will put you on the right team.</p>}
          </div>
          <button
            type="button"
            onClick={() => {
              setQuery("");
              onClear();
            }}
            className="min-h-10 shrink-0 rounded-xl px-3 text-[13px] font-bold text-accent-text hover:bg-surface"
          >
            Change
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <Label htmlFor="upline-search" className="font-semibold">
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
        <ul id="upline-list" className="mt-2 overflow-hidden rounded-2xl border border-line">
          {matches.map((p, i) => (
            <li key={p.id}>
              <button type="button" onClick={() => onPick(p.id)} className={cn("flex min-h-11 w-full items-center px-3.5 text-left text-[15px] font-semibold text-gray-900 hover:bg-tint", i > 0 && "border-t border-line")}>
                {p.name}
              </button>
            </li>
          ))}
          {matches.length === 0 && <li className="px-3.5 py-3 text-[14px] text-gray-600">Nobody by that name yet. Check the spelling, or tap &ldquo;I&apos;m not sure&rdquo;.</li>}
        </ul>
      )}
      <button type="button" onClick={onUnsure} className="mt-1 min-h-11 rounded-xl px-2 text-[14px] font-semibold text-accent-text hover:bg-tint">
        I&apos;m not sure
      </button>
    </div>
  );
}
