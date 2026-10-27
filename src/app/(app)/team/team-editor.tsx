"use client";

import { useState, useTransition } from "react";
import type { Role } from "@/lib/session";
import { Avatar } from "@/components/avatar";
import { ListCard, ListTitle, ROW_INSET } from "@/components/tide";
import { Button, Input, Label, cn } from "@/components/ui";
import { formatDollars } from "@/lib/money";
import { addPerson, renamePerson, savePersonGoal, setPersonActive } from "../actions";
import { toast } from "@/components/toaster";

interface Person {
  id: string;
  name: string;
  active: boolean;
  tone: string;
  cents: number;
  policies: number;
  goalCents: number;
}

/** The team list; the owner adds people, renames them, sets a goal, and takes someone off the board. */
export function TeamEditor({ people, role, month, base }: { people: Person[]; role: Role; month: string; base: string }) {
  const active = people.filter((p) => p.active);
  const gone = people.filter((p) => !p.active);
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div className="space-y-6">
      {role === "owner" && <AddPerson />}

      <div>
        <ListTitle count={active.length}>On the board</ListTitle>
        <ListCard className="mt-2">
          {active.length === 0 && <li className="px-4 py-5 text-[14px] text-gray-600">Nobody yet.{role === "owner" ? " Add your people above." : ""}</li>}
          {active.map((p) => (
            <li key={p.id} className={cn("px-4 py-3", ROW_INSET.avatar)}>
              <div className="flex items-center gap-3">
                <Avatar name={p.name} tone={p.tone} size={40} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[15px] font-bold text-gray-900">{p.name}</p>
                  <p className="text-[13px] font-medium text-gray-500">
                    {formatDollars(p.cents)} · {p.policies} {p.policies === 1 ? "policy" : "policies"}
                    {p.goalCents > 0 && ` · goal ${formatDollars(p.goalCents)}`}
                  </p>
                </div>
                {role === "owner" && (
                  <button type="button" onClick={() => setOpen(open === p.id ? null : p.id)} aria-expanded={open === p.id} className="min-h-11 shrink-0 rounded-full px-3 text-[14px] font-bold text-accent-text hover:bg-tint">
                    {open === p.id ? "Close" : "Edit"}
                  </button>
                )}
              </div>
              {role === "owner" && open === p.id && <PersonEditor person={p} month={month} base={base} onClose={() => setOpen(null)} />}
            </li>
          ))}
        </ListCard>
      </div>

      {role === "owner" && gone.length > 0 && (
        <div>
          <ListTitle count={gone.length}>Off the board</ListTitle>
          <ListCard className="mt-2">
            {gone.map((p) => (
              <li key={p.id} className={cn("flex items-center gap-3 px-4 py-3", ROW_INSET.avatar)}>
                <Avatar name={p.name} tone={p.tone} size={40} />
                <p className="min-w-0 flex-1 truncate text-[15px] font-bold text-gray-700">{p.name}</p>
                <BackButton id={p.id} />
              </li>
            ))}
          </ListCard>
          <p className="mt-2 px-1 text-[12px] text-gray-500">Their sales stay in every month&apos;s history.</p>
        </div>
      )}
    </div>
  );
}

function AddPerson() {
  const [pending, start] = useTransition();
  const [name, setName] = useState("");
  return (
    <form
      action={(form) =>
        start(async () => {
          const r = await addPerson(form);
          toast(r.ok ? (r.message ?? "Added.") : r.error, r.ok);
          if (r.ok) setName("");
        })
      }
      className="flex items-end gap-2 rounded-[22px] bg-surface p-4 shadow-card"
    >
      <div className="min-w-0 flex-1">
        <Label htmlFor="new-name">Add a person</Label>
        <Input id="new-name" name="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="First and last name" maxLength={60} autoComplete="off" required />
      </div>
      <Button type="submit" className="h-11 rounded-xl" disabled={pending || !name.trim()}>
        {pending ? "Adding..." : "Add"}
      </Button>
    </form>
  );
}

function PersonEditor({ person, month, base, onClose }: { person: Person; month: string; base: string; onClose: () => void }) {
  const [pending, start] = useTransition();
  const link = `${base || ""}/log?agent=${person.id}`;
  return (
    <div className="mt-3 space-y-3 rounded-2xl bg-surface-2 p-3">
      <form
        action={(form) =>
          start(async () => {
            const r = await renamePerson(person.id, form);
            toast(r.ok ? (r.message ?? "Saved.") : r.error, r.ok);
          })
        }
        className="flex items-end gap-2"
      >
        <div className="min-w-0 flex-1">
          <Label htmlFor={`name-${person.id}`}>Name</Label>
          <Input id={`name-${person.id}`} name="name" defaultValue={person.name} maxLength={60} required />
        </div>
        <Button type="submit" variant="secondary" className="h-11 rounded-xl" disabled={pending}>
          Save
        </Button>
      </form>
      <form
        action={(form) =>
          start(async () => {
            const r = await savePersonGoal(month, person.id, form);
            toast(r.ok ? (r.message ?? "Saved.") : r.error, r.ok);
          })
        }
        className="flex items-end gap-2"
      >
        <div className="min-w-0 flex-1">
          <Label htmlFor={`goal-${person.id}`}>Their goal this month ($ annual premium; blank for none)</Label>
          <Input id={`goal-${person.id}`} name="goal" inputMode="decimal" defaultValue={person.goalCents ? String(person.goalCents / 100) : ""} placeholder="25000" className="font-mono" />
        </div>
        <Button type="submit" variant="secondary" className="h-11 rounded-xl" disabled={pending}>
          Save
        </Button>
      </form>
      <div>
        <p className="text-[13px] font-medium text-gray-700">Their desk link (for an NFC tag or a Shortcut): opens Log a sale with {person.name.split(" ")[0]} picked.</p>
        <div className="mt-1 flex items-center gap-2">
          <code className="min-w-0 flex-1 truncate rounded-xl bg-surface px-3 py-2 font-mono text-[12px] text-gray-700">{link}</code>
          <CopyButton text={link} />
        </div>
      </div>
      <div className="flex items-center justify-between gap-2 pt-1">
        <button
          type="button"
          disabled={pending}
          onClick={() => {
            if (!window.confirm(`Take ${person.name} off the board? Their sales stay in the history.`)) return;
            start(async () => {
              const r = await setPersonActive(person.id, false);
              toast(r.ok ? (r.message ?? "Done.") : r.error, r.ok);
              if (r.ok) onClose();
            });
          }}
          className="min-h-11 rounded-xl px-3 text-[14px] font-bold text-red-700 hover:bg-red-50"
        >
          Take off the board
        </button>
        <button type="button" onClick={onClose} className="min-h-11 rounded-xl px-3 text-[14px] font-bold text-gray-600 hover:bg-gray-100">
          Close
        </button>
      </div>
    </div>
  );
}

function BackButton({ id }: { id: string }) {
  const [pending, start] = useTransition();
  return (
    <Button
      type="button"
      variant="secondary"
      className="h-10 shrink-0 rounded-xl px-3 text-[13px]"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const r = await setPersonActive(id, true);
          toast(r.ok ? (r.message ?? "Done.") : r.error, r.ok);
        })
      }
    >
      {pending ? "..." : "Put back"}
    </Button>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      variant="secondary"
      className="h-10 shrink-0 rounded-xl px-3 text-[13px]"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          window.prompt("Copy this link", text);
        }
      }}
    >
      {copied ? "Copied" : "Copy"}
    </Button>
  );
}
