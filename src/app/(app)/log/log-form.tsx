"use client";

import { useMemo, useRef, useState, useSyncExternalStore, useTransition } from "react";
import Link from "next/link";
import { Avatar } from "@/components/avatar";
import { KindDot } from "@/components/kind";
import { Button, Input, Label, cn } from "@/components/ui";
import { formatMoney, parseDollars } from "@/lib/money";
import { todayInDetroit } from "@/lib/month";
import { KIND_LABEL, SALE_KINDS, type PcCarrier, type SaleKind } from "@/lib/types";
import { logSale, removeSale } from "../sale-actions";
import { toast } from "@/components/toaster";

interface Person {
  id: string;
  name: string;
  tone: string;
  /** P&C licensed (Team page): the Life / P&C switch shows for them. */
  pcLicensed: boolean;
  /** Works in the office: the office group leads the picker. */
  inOffice?: boolean;
}

const WHO_KEY = "scorecard:who";
/** The last few people picked on this phone, newest first (ids, as JSON): they lead the picker. */
const RECENT_KEY = "scorecard:recent";
const RECENT_MAX = 6;

// The last person picked on this phone (a rep logs their own sales); null on the server.
const noSubscribe = () => () => {};
function readSavedWho(): string | null {
  try {
    return localStorage.getItem(WHO_KEY);
  } catch {
    return null;
  }
}

function readRecentRaw(): string | null {
  try {
    return localStorage.getItem(RECENT_KEY);
  } catch {
    return null;
  }
}

function parseRecent(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const list: unknown = JSON.parse(raw);
    return Array.isArray(list) ? list.filter((v): v is string => typeof v === "string").slice(0, RECENT_MAX) : [];
  } catch {
    return [];
  }
}

/**
 * Four taps: who, how much, which carrier, Log it. A member logs for themselves, so there is no
 * person to pick (`self`: their own name heads the form). For the owner, an admin and the team
 * password the person a desk tag opens (`?agent=`) or the
 * last person picked on this phone is preselected, and the picker searches as they type, with
 * the people picked lately first, then the office group, then everyone else. A P&C licensed person (Team page) gets a
 * Life / P&C switch (owner, 2026-11-04); P&C mode brings the P&C carriers and the lines the picked
 * carrier writes (`?kind=pc` on a desk tag opens it that way). After logging, the screen offers
 * Undo for a bit, Log another, and the board.
 */
export function LogForm({
  agents,
  products,
  carriers,
  pcCarriers,
  today,
  preset,
  presetKind,
  self = null,
  me = null,
}: {
  /** A member's own id: they log for themselves and see no picker. */
  self?: string | null;
  /** The signed-in person (the owner or an admin too): preselected on a phone that has not picked anyone yet. */
  me?: string | null;
  agents: Person[];
  products: string[];
  carriers: string[];
  pcCarriers: PcCarrier[];
  today: string;
  preset: string | null;
  presetKind: SaleKind | null;
}) {
  const saved = useSyncExternalStore(noSubscribe, readSavedWho, () => null);
  const [picked, setPicked] = useState<string | null>(null);
  const recentRaw = useSyncExternalStore(noSubscribe, readRecentRaw, () => null);
  const recent = useMemo(() => parseRecent(recentRaw), [recentRaw]);
  const onBoard = (id: string | null): id is string => !!id && agents.some((a) => a.id === id);
  // A member is always themselves. Otherwise a desk tag's person wins, then the last one picked on
  // this phone, then the person signed in, then whoever taps.
  const who = self ?? picked ?? (onBoard(preset) ? preset : onBoard(saved) ? saved : onBoard(me) ? me : null);
  const setWho = setPicked;
  // The picker is open while nobody is picked, or after a tap on Change.
  const [choosing, setChoosing] = useState(false);
  const [search, setSearch] = useState("");
  const [premium, setPremium] = useState("");
  const [policies, setPolicies] = useState(1);
  const [product, setProduct] = useState<string | null>(null);
  const [carrier, setCarrier] = useState<string | null>(null);
  // Life or P&C: only a licensed person can be on P&C; the choice is kept per visit (a desk tag can open on P&C).
  const [kindPicked, setKindPicked] = useState<SaleKind | null>(null);
  const canPc = !!agents.find((a) => a.id === who)?.pcLicensed;
  const kind: SaleKind = canPc ? (kindPicked ?? presetKind ?? "life") : "life";
  const carrierChoices = kind === "pc" ? pcCarriers.map((c) => c.name) : carriers;
  // P&C: the lines the picked carrier writes (every line until one is picked); life: the product chips.
  const pcLines = kind === "pc" ? (carrier ? (pcCarriers.find((c) => c.name === carrier)?.lines ?? []) : pcCarriers.flatMap((c) => c.lines).filter((l, i, all) => all.indexOf(l) === i)) : [];
  const productChoices = kind === "pc" ? pcLines : products;
  const pickKind = (next: SaleKind) => {
    if (next === kind) return;
    setKindPicked(next);
    setCarrier(null);
    setProduct(null);
    setError(null);
  };
  const [date, setDate] = useState(today);
  // Only a day the person picked is sent; otherwise the server stamps its own Detroit today, so a
  // screen left open past midnight never dates a sale to yesterday.
  const [dateTouched, setDateTouched] = useState(false);
  const [more, setMore] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ id: string; who: string; cents: number; carrier: string | null } | null>(null);
  const [pending, start] = useTransition();
  const premiumRef = useRef<HTMLInputElement | null>(null);

  const cents = parseDollars(premium);
  const ready = !!who && cents != null && cents > 0 && !!carrier && carrierChoices.includes(carrier);

  const submit = () => {
    if (!who) return setError(self ? "Sign in again to log a sale." : "Tap who sold it.");
    if (cents == null || cents === 0) return setError("Type the annual premium, like 1250.");
    if (!carrier) return setError("Tap the carrier it was written with.");
    setError(null);
    const form = new FormData();
    form.set("agent_id", who);
    form.set("premium", premium);
    form.set("policies", String(policies));
    if (product) form.set("product", product);
    form.set("carrier", carrier);
    form.set("kind", kind);
    if (note.trim()) form.set("note", note.trim());
    form.set("sold_on", dateTouched ? date : "");
    start(async () => {
      const r = await logSale(form);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      try {
        if (!self) {
          localStorage.setItem(WHO_KEY, who);
          localStorage.setItem(RECENT_KEY, JSON.stringify([who, ...recent.filter((id) => id !== who)].slice(0, RECENT_MAX)));
        }
      } catch {
        /* private mode */
      }
      const person = agents.find((a) => a.id === who)?.name ?? "Someone";
      setDone({ id: r.id!, who: person, cents: cents, carrier: carrier ? `${carrier}${kind === "pc" ? " · P&C" : ""}` : null });
      toast(r.message ?? "Logged.");
    });
  };

  const reset = () => {
    setDone(null);
    setPremium("");
    setPolicies(1);
    setProduct(null);
    setCarrier(null);
    setNote("");
    setDate(todayInDetroit());
    setDateTouched(false);
    setError(null);
  };

  const whoPerson = agents.find((a) => a.id === who);
  // The picker's groups: with a name typed, the matches; otherwise the people picked lately on
  // this phone, then the office group, then everyone else (each by name).
  const typed = search.trim().toLowerCase();
  const byName = (a: Person, b: Person) => a.name.localeCompare(b.name);
  const groups: { title: string; people: Person[] }[] = [];
  if (typed) {
    const found = agents.filter((a) => a.name.toLowerCase().includes(typed)).sort(byName);
    if (found.length) groups.push({ title: "Matches", people: found });
  } else {
    const lately = recent.map((id) => agents.find((a) => a.id === id)).filter((a): a is Person => !!a);
    const rest = agents.filter((a) => !lately.includes(a));
    const office = rest.filter((a) => a.inOffice).sort(byName);
    const others = rest.filter((a) => !a.inOffice).sort(byName);
    if (lately.length) groups.push({ title: "Picked lately", people: lately });
    if (office.length) groups.push({ title: "In the office", people: office });
    if (others.length) groups.push({ title: office.length ? "Everyone else" : "Everyone", people: others });
  }

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
          <span className="font-semibold text-gray-900">{done.who}</span> · <span className="font-mono font-semibold text-gray-900">{formatMoney(done.cents)}</span> annual premium
          {done.carrier ? ` with ${done.carrier}` : ""}. The board is celebrating.
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

      {self ? (
        <section data-logging-for className="flex items-center gap-3 rounded-[22px] bg-surface px-4 py-3 shadow-card">
          <Avatar name={whoPerson?.name ?? "You"} tone={whoPerson?.tone} neutral={!whoPerson} size={40} />
          <p className="min-w-0 flex-1 truncate text-[15px] font-medium text-gray-600">
            Logging for <span className="font-bold text-gray-900">{whoPerson?.name ?? "you"}</span>
          </p>
        </section>
      ) : (
        <section data-who>
          <h2 className="mb-2 px-1 text-[13px] font-bold tracking-[0.06em] text-gray-500 uppercase">Who sold it</h2>
          {whoPerson && !choosing ? (
            <div className="flex items-center gap-3 rounded-[22px] bg-surface py-2 pr-2 pl-4 shadow-card outline-2 outline-accent">
              <Avatar name={whoPerson.name} tone={whoPerson.tone} size={40} />
              <p className="min-w-0 flex-1 truncate text-[16px] font-bold text-accent-text">{whoPerson.name}</p>
              <button type="button" onClick={() => setChoosing(true)} className="min-h-11 shrink-0 rounded-full px-3 text-[14px] font-bold text-accent-text hover:bg-tint">
                Change
              </button>
            </div>
          ) : (
            <div className="rounded-[22px] bg-surface p-3 shadow-card">
              <div className="relative">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-gray-400">
                  <circle cx="11" cy="11" r="7" />
                  <path d="M20 20l-3.5-3.5" />
                </svg>
                <Input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Type a name" aria-label="Find who sold it" autoComplete="off" className="rounded-full pl-9" />
              </div>
              <div className="mt-2 max-h-[19rem] space-y-2 overflow-y-auto overscroll-contain pr-0.5" role="radiogroup" aria-label="Who sold it">
                {groups.length === 0 && <p className="px-1 py-3 text-[14px] text-gray-600">Nobody by that name.</p>}
                {groups.map((g) => (
                  <div key={g.title}>
                    {groups.length > 1 && <p className="px-1 pb-1 text-[11.5px] font-bold tracking-[0.06em] text-gray-500 uppercase">{g.title}</p>}
                    <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
                      {g.people.map((a) => {
                        const on = who === a.id;
                        return (
                          <button
                            key={a.id}
                            type="button"
                            role="radio"
                            aria-checked={on}
                            onClick={() => {
                              setWho(a.id);
                              setChoosing(false);
                              setSearch("");
                              // The kind this person lands on; a change in either direction drops a carrier or line from the other list.
                              const nextKind: SaleKind = a.pcLicensed ? (kindPicked ?? presetKind ?? "life") : "life";
                              if (nextKind !== kind) {
                                setCarrier(null);
                                setProduct(null);
                              }
                              setError(null);
                              premiumRef.current?.focus();
                            }}
                            className={cn("flex min-h-12 items-center gap-2 rounded-2xl bg-surface-2 px-2.5 text-left transition", on ? "outline-2 -outline-offset-2 outline-accent" : "hover:bg-gray-100")}
                          >
                            <Avatar name={a.name} tone={a.tone} size={30} />
                            <span className={cn("truncate text-[14px] font-bold", on ? "text-accent-text" : "text-gray-900")}>{a.name}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>
      )}

      {canPc && (
        <section>
          <h2 className="mb-2 px-1 text-[13px] font-bold tracking-[0.06em] text-gray-500 uppercase">What kind</h2>
          <div role="radiogroup" aria-label="What kind" className="grid grid-cols-2 gap-1 rounded-2xl bg-track p-1">
            {SALE_KINDS.map((k) => {
              const on = kind === k;
              return (
                <button
                  key={k}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => pickKind(k)}
                  className={cn("flex min-h-11 items-center justify-center gap-2 rounded-xl text-[14px] font-bold transition", on ? "bg-segment text-gray-900 shadow-card" : "text-gray-600 hover:text-gray-900")}
                >
                  <KindDot kind={k} className="h-2 w-2" />
                  {KIND_LABEL[k]}
                </button>
              );
            })}
          </div>
        </section>
      )}

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
            className="h-16 w-full rounded-2xl border border-line bg-surface-2 pr-4 pl-10 font-mono text-[32px] font-bold text-gray-900 placeholder:text-gray-400 focus:border-accent focus:ring-2 focus:ring-tint focus:outline-none"
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
        <h2 className="mb-2 px-1 text-[13px] font-bold tracking-[0.06em] text-gray-500 uppercase">Carrier</h2>
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Carrier">
          {carrierChoices.map((c) => {
            const on = carrier === c;
            return (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => {
                  setCarrier(c);
                  // A line the new carrier does not write goes.
                  if (kind === "pc" && product && !(pcCarriers.find((x) => x.name === c)?.lines ?? []).includes(product)) setProduct(null);
                  setError(null);
                }}
                className={cn("min-h-11 rounded-full px-4 text-[14px] font-bold transition", on ? "bg-tide-strong text-white shadow-glow" : "bg-surface text-gray-700 shadow-card hover:bg-gray-50")}
              >
                {c}
              </button>
            );
          })}
        </div>
      </section>

      <section>
        <h2 className="mb-2 px-1 text-[13px] font-bold tracking-[0.06em] text-gray-500 uppercase">{kind === "pc" ? "Line" : "Product (optional)"}</h2>
        {kind === "pc" && carrier && <p className="mb-2 px-1 text-[12px] font-medium text-gray-500">What {carrier} writes.</p>}
        <div className="flex flex-wrap gap-2">
          {productChoices.map((p) => {
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
          Day and note
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden className={cn("text-gray-400 transition-transform", more && "rotate-90")}>
            <path d="M9 6l6 6-6 6" />
          </svg>
        </button>
        {more && (
          <div className="mt-2 grid gap-3">
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
        {pending ? "Logging..." : ready ? `Log ${formatMoney(cents!)}${kind === "pc" ? " P&C" : ""}` : "Log it"}
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
