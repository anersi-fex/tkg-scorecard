"use client";

import { useRef, useState, useSyncExternalStore, useTransition } from "react";
import Link from "next/link";
import { Avatar } from "@/components/avatar";
import { Button, Input, Label, cn } from "@/components/ui";
import { formatMoney, parseDollars } from "@/lib/money";
import { todayInDetroit } from "@/lib/month";
import { logSale, removeSale } from "../actions";
import { toast } from "@/components/toaster";

interface Person {
  id: string;
  name: string;
  tone: string;
}

const WHO_KEY = "scorecard:who";

// The last person picked on this phone (a rep logs their own sales); null on the server.
const noSubscribe = () => () => {};
function readSavedWho(): string | null {
  try {
    return localStorage.getItem(WHO_KEY);
  } catch {
    return null;
  }
}

/**
 * Three taps: who, how much, Log it. The person a desk tag opens (`?agent=`) or the last person
 * picked on this phone is preselected. After logging, the screen offers Undo for a bit, Log
 * another, and the board.
 */
export function LogForm({ agents, products, today, preset }: { agents: Person[]; products: string[]; today: string; preset: string | null }) {
  const saved = useSyncExternalStore(noSubscribe, readSavedWho, () => null);
  const [picked, setPicked] = useState<string | null>(null);
  // A desk tag's person wins, then the last one picked on this phone, then whoever taps.
  const who = picked ?? (preset && agents.some((a) => a.id === preset) ? preset : saved && agents.some((a) => a.id === saved) ? saved : null);
  const setWho = setPicked;
  const [premium, setPremium] = useState("");
  const [policies, setPolicies] = useState(1);
  const [product, setProduct] = useState<string | null>(null);
  const [client, setClient] = useState("");
  const [date, setDate] = useState(today);
  // Only a day the person picked is sent; otherwise the server stamps its own Detroit today, so a
  // screen left open past midnight never dates a sale to yesterday.
  const [dateTouched, setDateTouched] = useState(false);
  const [more, setMore] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ id: string; who: string; cents: number } | null>(null);
  const [pending, start] = useTransition();
  const premiumRef = useRef<HTMLInputElement | null>(null);

  const cents = parseDollars(premium);
  const ready = !!who && cents != null && cents > 0;

  const submit = () => {
    if (!who) return setError("Tap who sold it.");
    if (cents == null || cents === 0) return setError("Type the annual premium, like 1250.");
    setError(null);
    const form = new FormData();
    form.set("agent_id", who);
    form.set("premium", premium);
    form.set("policies", String(policies));
    if (product) form.set("product", product);
    if (client.trim()) form.set("client", client.trim());
    if (note.trim()) form.set("note", note.trim());
    form.set("sold_on", dateTouched ? date : "");
    start(async () => {
      const r = await logSale(form);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      try {
        localStorage.setItem(WHO_KEY, who);
      } catch {
        /* private mode */
      }
      const person = agents.find((a) => a.id === who)?.name ?? "Someone";
      setDone({ id: r.id!, who: person, cents: cents });
      toast(r.message ?? "Logged.");
    });
  };

  const reset = () => {
    setDone(null);
    setPremium("");
    setPolicies(1);
    setProduct(null);
    setClient("");
    setNote("");
    setDate(todayInDetroit());
    setDateTouched(false);
    setError(null);
  };

  if (done) {
    return (
      <div className="rounded-[26px] bg-surface p-6 text-center shadow-card">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-tide text-white shadow-glow">
          <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M5 12.5l4.5 4.5L19 7.5" />
          </svg>
        </div>
        <h2 className="mt-4 text-[22px] font-extrabold tracking-[-0.03em] text-gray-900">Logged</h2>
        <p className="mt-1 text-[15px] text-gray-600">
          <span className="font-semibold text-gray-900">{done.who}</span> · <span className="font-mono font-semibold text-gray-900">{formatMoney(done.cents)}</span> annual premium. The board is celebrating.
        </p>
        <div className="mt-6 grid gap-2">
          <Button type="button" className="h-12 w-full rounded-2xl text-[15px]" onClick={reset}>
            Log another
          </Button>
          <Link href="/" className="inline-flex min-h-11 items-center justify-center rounded-2xl border border-line bg-surface px-4 text-sm font-bold text-gray-900 shadow-card hover:bg-gray-50">
            See this month
          </Link>
          <UndoButton id={done.id} onUndone={reset} />
        </div>
      </div>
    );
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className="space-y-5"
    >
      {error && (
        <p role="alert" className="rounded-2xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-900">
          {error}
        </p>
      )}

      <section>
        <h2 className="mb-2 px-1 text-[13px] font-bold tracking-[0.06em] text-gray-500 uppercase">Who sold it</h2>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Who sold it">
          {agents.map((a) => {
            const on = who === a.id;
            return (
              <button
                key={a.id}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => {
                  setWho(a.id);
                  setError(null);
                  premiumRef.current?.focus();
                }}
                className={cn(
                  "flex min-h-14 items-center gap-3 rounded-2xl bg-surface px-3 text-left shadow-card transition",
                  on ? "outline-2 outline-accent" : "hover:bg-gray-50",
                )}
              >
                <Avatar name={a.name} tone={a.tone} size={36} />
                <span className={cn("truncate text-[15px] font-bold", on ? "text-accent-text" : "text-gray-900")}>{a.name}</span>
              </button>
            );
          })}
        </div>
      </section>

      <section className="rounded-[26px] bg-surface p-4 shadow-card">
        <Label htmlFor="premium" className="text-[13px] font-bold tracking-[0.06em] text-gray-500 uppercase">
          Annual premium
        </Label>
        <div className="relative">
          <span className="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 font-mono text-[28px] font-bold text-gray-400">$</span>
          <input
            ref={premiumRef}
            id="premium"
            name="premium"
            inputMode="decimal"
            autoComplete="off"
            placeholder="0"
            value={premium}
            onChange={(e) => {
              setPremium(e.target.value);
              setError(null);
            }}
            className="h-16 w-full rounded-2xl border border-line bg-surface-2 pr-4 pl-10 font-mono text-[32px] font-bold text-gray-900 placeholder:text-gray-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-200 focus:outline-none"
          />
        </div>
        <div className="mt-3 flex items-center justify-between gap-3">
          <span className="text-[14px] font-semibold text-gray-700">Policies</span>
          <div className="flex items-center gap-1 rounded-full bg-track p-1">
            <button type="button" aria-label="One policy less" onClick={() => setPolicies((p) => Math.max(1, p - 1))} className="h-9 w-9 rounded-full bg-segment text-lg font-bold text-gray-900 shadow-card">
              –
            </button>
            <span className="w-8 text-center font-mono text-[16px] font-bold text-gray-900">{policies}</span>
            <button type="button" aria-label="One policy more" onClick={() => setPolicies((p) => Math.min(50, p + 1))} className="h-9 w-9 rounded-full bg-segment text-lg font-bold text-gray-900 shadow-card">
              +
            </button>
          </div>
        </div>
      </section>

      <section>
        <h2 className="mb-2 px-1 text-[13px] font-bold tracking-[0.06em] text-gray-500 uppercase">Product (optional)</h2>
        <div className="flex flex-wrap gap-2">
          {products.map((p) => {
            const on = product === p;
            return (
              <button
                key={p}
                type="button"
                aria-pressed={on}
                onClick={() => setProduct(on ? null : p)}
                className={cn("min-h-11 rounded-full px-4 text-[14px] font-bold transition", on ? "bg-tide-strong text-white shadow-glow" : "bg-surface text-gray-700 shadow-card hover:bg-gray-50")}
              >
                {p}
              </button>
            );
          })}
        </div>
      </section>

      <section className="rounded-[26px] bg-surface p-4 shadow-card">
        <button type="button" onClick={() => setMore((m) => !m)} aria-expanded={more} className="flex min-h-11 w-full items-center justify-between text-left text-[15px] font-bold text-gray-900">
          Client name, day, note
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden className={cn("text-gray-400 transition-transform", more && "rotate-90")}>
            <path d="M9 6l6 6-6 6" />
          </svg>
        </button>
        {more && (
          <div className="mt-2 grid gap-3">
            <div>
              <Label htmlFor="client">Client&apos;s first name (shows on the board)</Label>
              <Input id="client" name="client" value={client} onChange={(e) => setClient(e.target.value)} maxLength={40} autoComplete="off" placeholder="Maria" />
            </div>
            <div>
              <Label htmlFor="sold_on">Day it counts for</Label>
              <Input
                id="sold_on"
                name="sold_on"
                type="date"
                value={date}
                max={todayInDetroit()}
                onChange={(e) => {
                  setDate(e.target.value);
                  setDateTouched(true);
                }}
              />
            </div>
            <div>
              <Label htmlFor="note">Note (only in the app)</Label>
              <Input id="note" name="note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} placeholder="Referral from Mark" />
            </div>
          </div>
        )}
      </section>

      <Button type="submit" className="h-14 w-full rounded-2xl text-[17px]" disabled={pending || !ready}>
        {pending ? "Logging..." : ready ? `Log ${formatMoney(cents!)}` : "Log it"}
      </Button>
    </form>
  );
}

function UndoButton({ id, onUndone }: { id: string; onUndone: () => void }) {
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const r = await removeSale(id);
          toast(r.ok ? "Taken back." : r.error, r.ok);
          if (r.ok) onUndone();
        })
      }
      className="min-h-11 text-[14px] font-semibold text-red-700"
    >
      {pending ? "Taking it back..." : "Oops, take it back"}
    </button>
  );
}
