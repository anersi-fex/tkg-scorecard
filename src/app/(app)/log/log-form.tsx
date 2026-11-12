"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore, useTransition, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/components/ui";
import { Icon } from "@/components/ui/icon";
import { Field, Initials, PageHead, Panel } from "@/components/ui/kit";
import { toast } from "@/components/toaster";
import { parseDollars } from "@/lib/money";
import { STEPS, STEP_FIELDS, blankForm, errorLine, monthlyText, summaryLine, validatePolicyForm, valuesOf, yearlyText, type FormKey, type PolicyForm } from "@/lib/policy-validate";
import { BensFields, ClientFields, PolicyFields, type FieldErrors, type Lists } from "@/components/policy/policy-fields";
import { PvDl, clientItems, policyItems } from "@/components/policy/policy-read";
import { applyChange, toFormData, type Draft, type FieldValue } from "@/components/policy/form-logic";
import { ageOn } from "@/lib/policy-validate";
import { dayShort, firstName, monthWord, previewSale, type BoardLine } from "@/components/policy/format";
import { logPolicy } from "../sale-actions";

/** Someone the viewer may log a sale for (rules.ts logForChoices), with the words under their name. */
export interface WhoChoice {
  id: string;
  name: string;
  /** "You", "Manager", "Agent" ... */
  line: string;
  inOffice: boolean;
}

/** The last few people picked on this browser, newest first: ids only (never a client's detail). */
const RECENT_KEY = "scorecard:recent";
const RECENT_MAX = 6;
const noSubscribe = () => () => {};
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
const norm = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

type Step = 1 | 2 | 3;

/**
 * Log a sale in three steps (the demo the owner approved: AgentSpace's Post a Deal in our words):
 * 1 Policy information, 2 Client information, 3 Review and log. Each step is checked before the
 * next opens (policy-validate.ts, the same words the server uses), and the server's own field
 * errors land on their fields. The draft lives in React state only: nothing typed here is kept in
 * browser storage or the address. An agent logs for themself ("Logging for ..."); a manager or an
 * admin picks who sold it. After logging the page opens /log?done=<id>.
 */
export function LogForm({
  me,
  choices,
  preset,
  lists,
  today,
  month,
  board,
  anyone = false,
}: {
  /** An admin logs for anyone on the board (the note under the picker says so). */
  anyone?: boolean;
  /** The person signed in (null: the owner password with no row of its own). */
  me: string | null;
  choices: WhoChoice[];
  /** Picked first (a desk tag's ?agent=, or the viewer). */
  preset: string | null;
  lists: Lists;
  today: string;
  /** This month, "YYYY-MM". */
  month: string;
  /** The month's board as it stands (life premium per person): the side's "On the board" line. */
  board: BoardLine[];
}) {
  const router = useRouter();
  const [draft, setDraft] = useState<Draft>(() => ({ f: blankForm(preset ?? "", today), billingTouched: false }));
  const [soldOnTouched, setSoldOnTouched] = useState(false);
  const [step, setStep] = useState<Step>(1);
  const [tried, setTried] = useState<Record<1 | 2, boolean>>({ 1: false, 2: false });
  const [serverErrors, setServerErrors] = useState<FieldErrors>({});
  const [alert, setAlert] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [focusError, setFocusError] = useState(0);
  const formRef = useRef<HTMLFormElement | null>(null);
  const f = draft.f;
  const ctx = useMemo(() => ({ today, ...lists }), [today, lists]);
  const picker = choices.length > 1;
  const seller = choices.find((c) => c.id === f.agentId) ?? null;

  const errorsOf = (s: 1 | 2): FieldErrors => {
    const local = tried[s] ? validatePolicyForm(f, ctx, STEP_FIELDS[s]) : {};
    const fromServer: FieldErrors = {};
    for (const [k, v] of Object.entries(serverErrors)) if (STEP_FIELDS[s].includes(k as FormKey)) fromServer[k as FormKey] = v;
    return { ...fromServer, ...local };
  };
  const errors: FieldErrors = step < 3 ? errorsOf(step as 1 | 2) : {};
  const nErrors = Object.keys(errors).length;

  const change = (k: keyof PolicyForm, v: FieldValue) => {
    if (k === "soldOn") setSoldOnTouched(true);
    setDraft((d) => applyChange(d, k, v, { carrierProducts: lists.carrierProducts, autoDay: true }));
    if (serverErrors[k as FormKey] || (k === "policyNumber" || k === "applicationNumber" ? serverErrors.numbers : false)) {
      setServerErrors((e) => {
        const next = { ...e };
        delete next[k as FormKey];
        if (k === "policyNumber" || k === "applicationNumber") delete next.numbers;
        return next;
      });
    }
  };

  // After a step moves, the page goes to its top; after a refused Next, the first marked field gets focus.
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [step]);
  useEffect(() => {
    if (!focusError) return;
    const el = formRef.current?.querySelector<HTMLElement>(".has-error .input, .has-error .select, .has-error .textarea");
    el?.focus();
  }, [focusError]);

  const goStep = (to: Step) => {
    if (to <= step) {
      setStep(to);
      setAlert(null);
      return;
    }
    for (let s = step; s < to; s++) {
      if (s === 3) break;
      const errs = validatePolicyForm(f, ctx, STEP_FIELDS[s as 1 | 2]);
      if (Object.keys(errs).length) {
        setTried((t) => ({ ...t, [s]: true }));
        setStep(s as Step);
        setFocusError((n) => n + 1);
        return;
      }
    }
    setAlert(null);
    setStep(to);
  };

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (step < 3) return goStep((step + 1) as Step);
    for (const s of [1, 2] as const) {
      if (Object.keys(validatePolicyForm(f, ctx, STEP_FIELDS[s])).length) {
        setTried((t) => ({ ...t, [s]: true }));
        setStep(s);
        setFocusError((n) => n + 1);
        return;
      }
    }
    const fd = toFormData(f, undefined, { soldOnTouched });
    start(async () => {
      const r = await logPolicy(fd);
      if (r.ok) {
        if (picker && f.agentId) {
          try {
            const recent = parseRecent(readRecentRaw());
            localStorage.setItem(RECENT_KEY, JSON.stringify([f.agentId, ...recent.filter((id) => id !== f.agentId)].slice(0, RECENT_MAX)));
          } catch {
            // blocked storage: the picker just has no "Picked lately"
          }
        }
        const id = "id" in r && typeof r.id === "string" ? r.id : null;
        if (id) router.push(`/log?done=${encodeURIComponent(id)}`);
        else {
          toast(r.message ?? "Logged.");
          router.push("/policies");
        }
        return;
      }
      const errs = ("errors" in r && r.errors) || {};
      setServerErrors(errs);
      const keys = Object.keys(errs) as FormKey[];
      if (keys.length) {
        const s: 1 | 2 = keys.some((k) => STEP_FIELDS[1].includes(k)) ? 1 : 2;
        setStep(s);
        setAlert(errorLine(keys.filter((k) => STEP_FIELDS[s].includes(k)).length || keys.length));
        setFocusError((n) => n + 1);
      } else {
        setAlert(r.error);
        toast(r.error, false);
      }
    });
  };

  const alertText = nErrors ? errorLine(nErrors) : step === 3 ? alert : null;

  return (
    <>
    <PageHead title="Log a sale" sub={step === 3 ? "Check it over, then log it. It's on the board the moment you do." : undefined} />
    <div className="log-grid">
      <div className="col log-main">
        <section className="card log-card" data-step={step}>
          <div className="log-progress">
            <div className="log-steps-line">
              <span className="log-step-now">
                Step {step} of 3 · {STEPS[step - 1]}
              </span>
              {step < 3 && <span className="log-step-next">Next: {STEPS[step as 1 | 2]}</span>}
            </div>
            <div className="log-rail" role="progressbar" aria-valuemin={1} aria-valuemax={3} aria-valuenow={step} aria-label={`Step ${step} of 3`}>
              <i style={{ width: `${((step / 3) * 100).toFixed(2)}%` }} />
            </div>
          </div>
          {step < 3 && (
            <p className="log-req">
              <span className="req">*</span> Required
            </p>
          )}
          {alertText && (
            <div className="form-alert" role="alert">
              <Icon name="alert" size={16} />
              <span>{alertText}</span>
            </div>
          )}
          {step === 1 && (picker ? <WhoPicker choices={choices} anyone={anyone} me={me} value={f.agentId} error={errors.agentId} onPick={(id) => change("agentId", id)} /> : <LoggingFor name={seller?.name ?? choices[0]?.name ?? ""} />)}
          <form ref={formRef} className="log-form" method="post" noValidate onSubmit={submit}>
            {step === 1 && <PolicyFields f={f} onChange={change} errors={errors} idp="" lists={lists} today={today} autoDay billingTouched={draft.billingTouched} withNotes uwHelp="Starts the policy in Underwriting." />}
            {step === 2 && (
              <>
                <ClientFields f={f} onChange={change} errors={errors} idp="" lists={lists} today={today} />
                <BensFields bens={f.bens} idp="" error={errors.bens} onBens={(bens) => setDraft((d) => ({ ...d, f: { ...d.f, bens } }))} />
              </>
            )}
            {step === 3 && <Review f={f} lists={lists} today={today} sellerName={seller?.name ?? ""} onEdit={(s) => goStep(s)} />}
            <div className="form-foot log-foot">
              {step > 1 ? (
                <button type="button" className="btn btn-secondary" onClick={() => goStep((step - 1) as Step)} disabled={pending}>
                  <Icon name="arrow-left" size={18} />
                  <span>Previous</span>
                </button>
              ) : (
                <span />
              )}
              {step < 3 ? (
                <button type="submit" className="btn btn-primary" id="log-next">
                  <span>Next</span>
                  <Icon name="arrow-right" size={18} />
                </button>
              ) : (
                <button type="submit" className="btn btn-primary btn-lg" id="log-go" disabled={pending}>
                  <Icon name="check-circle" size={18} />
                  <span>{pending ? "Logging..." : "Log sale"}</span>
                </button>
              )}
            </div>
          </form>
        </section>
      </div>
      <SideColumn f={f} step={step} sellerId={f.agentId} sellerName={seller?.name ?? ""} self={!!me && f.agentId === me} today={today} month={month} board={board} onStep={goStep} />
    </div>
    </>
  );
}

function LoggingFor({ name }: { name: string }) {
  return (
    <div className="log-for" data-logging-for>
      <Initials name={name} small />
      <span>
        Logging for <b>{name}</b>
      </span>
      <span className="log-for-note">Agents log their own sales.</span>
    </div>
  );
}

/** Who sold it: a searchable list (Picked lately, In the office, Everyone else), the viewer first. */
function WhoPicker({ choices, anyone, me, value, error, onPick }: { choices: WhoChoice[]; anyone: boolean; me: string | null; value: string; error?: string; onPick: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const wrap = useRef<HTMLDivElement | null>(null);
  const recentRaw = useSyncExternalStore(noSubscribe, readRecentRaw, () => null);
  const recent = useMemo(() => parseRecent(recentRaw), [recentRaw]);
  const cur = choices.find((c) => c.id === value) ?? null;

  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", down);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("pointerdown", down);
      document.removeEventListener("keydown", key);
    };
  }, [open]);

  const words = norm(q).trim().split(/\s+/).filter(Boolean);
  const byName = (a: WhoChoice, b: WhoChoice) => (a.id === me ? -1 : b.id === me ? 1 : a.name.localeCompare(b.name));
  const groups: { title: string; people: WhoChoice[] }[] = [];
  if (words.length) {
    const found = choices.filter((c) => words.every((w) => norm(c.name).includes(w))).sort(byName);
    if (found.length) groups.push({ title: "Matches", people: found });
  } else {
    const lately = recent.map((id) => choices.find((c) => c.id === id)).filter((c): c is WhoChoice => !!c);
    const seen = new Set(lately.map((c) => c.id));
    const rest = choices.filter((c) => !seen.has(c.id)).sort(byName);
    const office = rest.filter((c) => c.inOffice);
    const others = rest.filter((c) => !c.inOffice);
    if (lately.length) groups.push({ title: "Picked lately", people: lately });
    if (office.length) groups.push({ title: "In the office", people: office });
    if (others.length) groups.push({ title: office.length || lately.length ? "Everyone else" : "Everyone", people: others });
  }
  const pick = (id: string) => {
    onPick(id);
    setOpen(false);
    setQ("");
  };
  return (
    <div className="log-who" ref={wrap}>
      <Field label="Who sold it" htmlFor="log-who" required error={error} help={cur && cur.id !== me ? `${firstName(cur.name)} gets the sale on the board; you're named as the one who logged it.` : undefined}>
        <div className="pop-wrap log-who-wrap">
          <button type="button" id="log-who" className={cn("log-who-btn", open && "open")} aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((v) => !v)} data-who>
            {cur ? <Initials name={cur.name} small /> : <span className="avatar sm" aria-hidden />}
            <span className="log-who-cur">
              <span className="log-who-name ell">
                {cur ? cur.name : "Pick who sold it"}
                {cur && cur.id === me && <span className="you">You</span>}
              </span>
              <span className="log-who-line ell">{cur ? (cur.id === me ? "Logging for yourself" : cur.line) : `${choices.length} people`}</span>
            </span>
            <Icon name="chevron-down" size={16} className="log-who-chev" />
          </button>
          {open && (
            <div className="pop pop-left log-who-pop-box">
              <div className="log-who-pop">
                <div className="search-wrap">
                  <span className="search-ico" aria-hidden>
                    <Icon name="search" size={17} />
                  </span>
                  <input
                    autoFocus
                    type="search"
                    className="input search-input"
                    placeholder="Find someone"
                    aria-label="Find who sold it"
                    autoComplete="off"
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key !== "Enter") return;
                      e.preventDefault();
                      const first = groups[0]?.people[0];
                      if (first) pick(first.id);
                    }}
                  />
                </div>
                <div className="log-who-list" role="listbox" aria-label="Who sold it">
                  {groups.length === 0 && <p className="log-who-none">No one by that name {anyone ? "on the board" : "on your team"}.</p>}
                  {groups.map((g) => (
                    <div key={g.title} role="group" aria-label={g.title}>
                      {groups.length > 1 || g.title !== "Matches" ? <p className="log-who-group">{g.title}</p> : null}
                      {g.people.map((c) => (
                        <button key={`${g.title}-${c.id}`} type="button" role="option" aria-selected={c.id === value} className={cn("log-who-opt", c.id === value && "on")} onClick={() => pick(c.id)}>
                          <Initials name={c.name} small />
                          <span className="log-who-t">
                            <span className="log-who-n ell">{c.name}</span>
                            <span className="log-who-s ell">{c.id === me ? "You" : c.line}</span>
                          </span>
                          {c.id === value && <Icon name="check" size={16} />}
                        </button>
                      ))}
                    </div>
                  ))}
                </div>
                <p className="log-who-note">{anyone ? `Admins log for anyone on the board (${choices.length} people).` : `Managers log for themselves and everyone under them (${choices.length} people).`}</p>
              </div>
            </div>
          )}
        </div>
      </Field>
    </div>
  );
}

/** Step 3: the sale as it will be logged, with Edit back to each step. */
function Review({ f, lists, today, sellerName, onEdit }: { f: PolicyForm; lists: Lists; today: string; sellerName: string; onEdit: (s: Step) => void }) {
  const v = valuesOf(f, lists.carrierProducts);
  const read = {
    carrier: v.carrier || null,
    product: v.product || null,
    effectiveDate: v.effectiveDate,
    monthlyCents: v.monthlyCents,
    premiumCents: v.monthlyCents ? v.monthlyCents * 12 : 0,
    rateClass: v.rateClass,
    coverageCents: v.coverageCents,
    soldOn: v.soldOn ?? today,
    ssBenefit: v.ssBenefit,
    billingCycle: v.billingCycle,
    billingDay: v.billingDay,
    policyNumber: v.policyNumber,
    applicationNumber: v.applicationNumber,
    leadSource: v.leadSource,
    underwriting: v.underwriting,
  };
  const items = policyItems(read, undefined, sellerName);
  if (v.notes) items.push({ label: "Notes", value: <span className="wrap-text">{v.notes}</span>, span: 4 });
  const sec = (title: string, s: Step, body: ReactNode) => (
    <section className="log-rev-sec">
      <div className="log-rev-head">
        <h3 className="form-section-title">{title}</h3>
        <button type="button" className="link log-rev-edit" onClick={() => onEdit(s)}>
          <Icon name="pencil" size={14} />
          Edit
        </button>
      </div>
      {body}
    </section>
  );
  return (
    <>
      <p className="log-rev-sum">{summaryLine({ client: v.client, carrier: read.carrier, product: read.product, monthlyCents: read.monthlyCents, premiumCents: read.premiumCents })}</p>
      {sec("Policy", 1, <PvDl items={items} cols={4} />)}
      {sec("Client", 2, <PvDl items={clientItems(v.client, today, { bens: v.beneficiaries })} cols={4} />)}
    </>
  );
}

/** The computer's side column: Your sale (the steps, what is filled in, the board preview) and Good to know. */
function SideColumn({ f, step, sellerId, sellerName, self, today, month, board, onStep }: { f: PolicyForm; step: Step; sellerId: string; sellerName: string; self: boolean; today: string; month: string; board: BoardLine[]; onStep: (s: Step) => void }) {
  const monthly = f.monthly.trim() ? parseDollars(f.monthly) : null;
  const client = `${f.firstName} ${f.lastName}`.trim();
  const age = f.dob && f.dob < today ? ageOn(f.dob, today) : null;
  const money = monthly && monthly > 0 ? `${monthlyText(monthly)} · ${yearlyText(monthly * 12)}` : "";
  const row = (k: string, v: string, dim?: boolean) => (
    <div className="log-sum-row">
      <span className="log-sum-k">{k}</span>
      <span className={cn("log-sum-v", dim && "dim")}>{v}</span>
    </div>
  );
  let preview: ReactNode = null;
  if (monthly && monthly > 0 && sellerId) {
    const sold = f.soldOn || today;
    if (sold.slice(0, 7) !== month) preview = <p className="log-board">It counts on {monthWord(sold.slice(0, 7))}&apos;s board, the month it was submitted.</p>;
    else {
      const p = previewSale(board, sellerId, sellerName, monthly * 12);
      const who = self ? "You" : firstName(sellerName);
      const move =
        p.before != null ? (
          p.after < p.before ? (
            <>
              {who} {self ? "go" : "goes"} from <b>#{p.before}</b> to <b>#{p.after}</b>
            </>
          ) : (
            <>
              {who} stay{self ? "" : "s"} at <b>#{p.after}</b>
            </>
          )
        ) : (
          <>
            {who} join{self ? "" : "s"} the board at <b>#{p.after}</b>
          </>
        );
      preview = (
        <div className="log-board">
          <span className="log-board-k">
            <Icon name="trend-up" size={15} className="ico" />
            On the board
          </span>
          <span className="log-board-v">{move}</span>
          <span className="log-board-s num">
            {fmt(p.centsBefore)} → {fmt(p.centsAfter)} this month
          </span>
        </div>
      );
    }
  }
  return (
    <div className="col log-side only-wide">
      <Panel title="Your sale" className="log-sum">
        <ol className="log-steps">
          {STEPS.map((t, i) => {
            const n = (i + 1) as Step;
            const state = n < step ? "done" : n === step ? "now" : "todo";
            return (
              <li key={t}>
                <button type="button" className={cn("log-sn", state)} aria-current={n === step ? "step" : undefined} onClick={() => onStep(n)}>
                  <span className="log-sn-i">{state === "done" ? <Icon name="check" size={13} stroke={2.4} /> : n}</span>
                  <span>{t}</span>
                </button>
              </li>
            );
          })}
        </ol>
        <div className="log-sum-rows">
          {row("Sold by", sellerName || "Not picked yet", !sellerName)}
          {row("Policy", [f.carrier, f.product].filter(Boolean).join(" · ") || "Not picked yet", !f.carrier)}
          {row("Premium", money || "Not entered yet", !money)}
          {row("Effective", f.effectiveDate ? dayShort(f.effectiveDate) : "Not picked yet", !f.effectiveDate)}
          {row("Client", client ? `${client}${age != null ? `, ${age}` : ""}` : "Step 2", !client)}
        </div>
        {preview}
      </Panel>
      <Panel title="Good to know" className="log-know">
        <ul className="log-know-list">
          <li>
            <Icon name="chart" size={15} className="ico" />
            <span>It&apos;s on the board, Home and the TV the moment you log it.</span>
          </li>
          <li>
            <Icon name="tv" size={15} className="ico" />
            <span>The TV shows the name, the amount and the carrier. Never the client.</span>
          </li>
          <li>
            <Icon name="clock" size={15} className="ico" />
            <span>For 15 minutes you can fix anything or take it back. After that, the premium, carrier, product and day are an admin&apos;s to change.</span>
          </li>
        </ul>
      </Panel>
    </div>
  );
}

const fmt = (cents: number) => `$${Math.round(cents / 100).toLocaleString("en-US")}`;
