"use client";

import { useEffect, useRef, useState, useTransition, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/components/ui";
import { Icon } from "@/components/ui/icon";
import Link from "next/link";
import { Field, SelectBox, StatusPill, TextArea, Timeline } from "@/components/ui/kit";
import { toast } from "@/components/toaster";
import { formatDollars } from "@/lib/money";
import { NO_STATUS, POLICY_STATUSES, type PolicyField, type PolicyRecord, type PolicyStatus } from "@/lib/policy-types";
import { SECTION_FIELDS, errorLine, formOf, summaryLine, validatePolicyForm, type FormKey, type PolicyForm } from "@/lib/policy-validate";
import { BensFields, ClientFields, PolicyFields, type FieldErrors, type Lists } from "@/components/policy/policy-fields";
import { PvDl, clientItems, policyItems } from "@/components/policy/policy-read";
import { applyChange, toFormData, type Draft, type FieldValue } from "@/components/policy/form-logic";
import { dateLong, listWords, policiesWord } from "@/components/policy/format";
import { removePolicyAction, setPolicyStatusAction, updatePolicyAction } from "../../sale-actions";

type Section = "policy" | "client" | "beneficiaries" | "notes";

/** A form key → the policy field the rules know it by. */
const PERM_KEY: Partial<Record<FormKey, PolicyField>> = {
  monthly: "monthlyCents",
  coverage: "coverageCents",
  ss: "ssBenefit",
  numbers: "policyNumber",
  firstName: "client",
  lastName: "client",
  dob: "client",
  email: "client",
  noEmail: "client",
  phone: "client",
  address: "client",
  bens: "beneficiaries",
};
const permKey = (k: FormKey): PolicyField => PERM_KEY[k] ?? (k as PolicyField);
const SECTION_RULE_FIELDS: Record<Section, PolicyField[]> = {
  policy: ["agentId", "carrier", "product", "effectiveDate", "monthlyCents", "rateClass", "coverageCents", "soldOn", "ssBenefit", "billingCycle", "billingDay", "policyNumber", "applicationNumber", "leadSource", "underwriting"],
  client: ["client"],
  beneficiaries: ["beneficiaries"],
  notes: ["notes"],
};
const SHORT: Partial<Record<PolicyField, string>> = {
  agentId: "sold by",
  carrier: "carrier",
  product: "product",
  effectiveDate: "effective date",
  monthlyCents: "premium",
  rateClass: "rate class",
  coverageCents: "coverage",
  soldOn: "submitted date",
  ssBenefit: "Social Security billing",
  billingCycle: "billing cycle",
  billingDay: "billing day",
  policyNumber: "policy number",
  applicationNumber: "application number",
  leadSource: "lead source",
  underwriting: "the underwriter review",
};
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export interface RightsView {
  fields: PolicyField[];
  locked: Partial<Record<PolicyField, string>>;
  asksOwner: boolean;
}

/**
 * The policy page's body (client): the head with the status menu, each section read or being
 * edited, the history, Take it back / Remove. Every save sends one section's fields only, and the
 * server checks the rules again (policies.ts updatePolicy); this file only knows what to draw.
 */
export function PolicyRecordView(props: {
  policy: PolicyRecord;
  title: string;
  back: { href: string; label: string };
  loggedLine: string;
  freshLine: string | null;
  rights: RightsView;
  statusOk: boolean;
  statusLock: string;
  remove: { can: boolean; label: "" | "Remove policy" | "Take it back"; asksOwner: boolean };
  soldByChoices: { id: string; name: string }[];
  lists: Lists;
  today: string;
  seen: string;
  history: { key: number; what: string; meta: string }[];
  startEdit: Section | null;
}) {
  const p = props.policy;
  const router = useRouter();
  const allowed = new Set(props.rights.fields);
  const isImport = p.source === "import";
  const [editing, setEditing] = useState<Section | null>(props.startEdit);
  const [draft, setDraft] = useState<Draft>(() => ({ f: formOf(p), billingTouched: true }));
  const [errors, setErrors] = useState<FieldErrors | null>(null);
  const [pending, start] = useTransition();
  const [focusError, setFocusError] = useState(0);
  const root = useRef<HTMLDivElement | null>(null);
  const orig = formOf(p);
  const ctx = { today: props.today, ...props.lists, keep: orig };

  useEffect(() => {
    if (!focusError) return;
    root.current?.querySelector<HTMLElement>(".pv-form .has-error .input, .pv-form .has-error .select, .pv-form .has-error .textarea")?.focus();
  }, [focusError]);

  const lockOf = (k: FormKey): string | false => {
    const f = permKey(k);
    return allowed.has(f) ? false : (props.rights.locked[f] ?? "You can't change this.");
  };
  const fieldLock = (f: PolicyField): string | false => (allowed.has(f) ? false : (props.rights.locked[f] ?? false));

  const openEdit = (s: Section) => {
    const f = formOf(p);
    if (s === "beneficiaries" && !f.bens.length) f.bens.push({ name: "", relationship: "" });
    setDraft({ f, billingTouched: true });
    setErrors(null);
    setEditing(s);
  };
  const cancel = () => {
    setEditing(null);
    setErrors(null);
  };

  /** Errors for what changed in this section only (an old value nobody touched never blocks a save). */
  const sectionErrors = (s: Section, f: PolicyForm): FieldErrors | null => {
    const keys = SECTION_FIELDS[s];
    const errs = validatePolicyForm(f, ctx, keys);
    const changed = (k: FormKey) =>
      k === "numbers" ? f.policyNumber !== orig.policyNumber || f.applicationNumber !== orig.applicationNumber : k === "email" ? f.email !== orig.email || f.noEmail !== orig.noEmail : JSON.stringify(f[k as keyof PolicyForm]) !== JSON.stringify(orig[k as keyof PolicyForm]);
    for (const k of Object.keys(errs) as FormKey[]) if (!changed(k)) delete errs[k];
    return Object.keys(errs).length ? errs : null;
  };

  const change = (k: keyof PolicyForm, v: FieldValue) => {
    setDraft((d) => {
      const next = applyChange(d, k, v, { carrierProducts: props.lists.carrierProducts });
      if (errors && editing) setErrors(sectionErrors(editing, next.f));
      return next;
    });
  };

  const save = (e: FormEvent<HTMLFormElement>, s: Section) => {
    e.preventDefault();
    const errs = sectionErrors(s, draft.f);
    if (errs) {
      setErrors(errs);
      setFocusError((n) => n + 1);
      return;
    }
    const fd = toFormData(draft.f, SECTION_FIELDS[s]);
    start(async () => {
      const r = await updatePolicyAction(p.id, fd);
      if (r.ok) {
        toast(r.message ?? "Saved.");
        setEditing(null);
        setErrors(null);
        router.refresh();
        return;
      }
      if ("errors" in r && r.errors && Object.keys(r.errors).length) {
        setErrors(r.errors);
        setFocusError((n) => n + 1);
      }
      toast(r.error, false);
    });
  };

  const lockLines = (s: Section) => {
    const fields = SECTION_RULE_FIELDS[s].filter((f) => !(s === "policy" && f === "agentId"));
    const open = fields.filter((f) => allowed.has(f));
    const shut = fields.filter((f) => !allowed.has(f));
    if (!shut.length) return [];
    const byReason = new Map<string, PolicyField[]>();
    for (const f of shut) {
      const r = props.rights.locked[f] ?? "You can't change this.";
      byReason.set(r, [...(byReason.get(r) ?? []), f]);
    }
    return [...byReason].map(([reason, fs]) => ({
      who: s !== "policy" || !open.length ? "" : fs.length > 4 ? `All but ${listWords(open.map((f) => SHORT[f] ?? f))}` : cap(listWords(fs.map((f) => SHORT[f] ?? f))),
      reason,
    }));
  };

  const section = (s: Section, title: string, body: ReactNode, opts: { count?: number | null } = {}) => {
    const can = SECTION_RULE_FIELDS[s].some((f) => allowed.has(f) && !(s === "policy" && f === "agentId" && !props.soldByChoices.length));
    const isEd = editing === s;
    const locks = isEd ? [] : lockLines(s);
    return (
      <section className={cn("pv-sec", isEd && "is-editing")} data-sec={s}>
        <div className="pv-sec-head">
          <h3 className="pv-sec-title">
            {title}
            {opts.count ? <span className="pv-count num">{opts.count}</span> : null}
          </h3>
          {!isEd && can && (
            <button type="button" className="btn btn-ghost btn-sm pv-edit" aria-label={`Edit ${title}`} onClick={() => openEdit(s)} disabled={!!editing && editing !== s}>
              <Icon name="pencil" size={16} />
              <span>Edit</span>
            </button>
          )}
        </div>
        {locks.length > 0 && (
          <div className="pv-locks">
            {locks.map((l, i) => (
              <p key={i} className="pv-lockline">
                <Icon name="lock" size={13} className="ico" />
                <span>
                  {l.who && <b>{l.who}: </b>}
                  {l.reason}
                </span>
              </p>
            ))}
          </div>
        )}
        {isEd ? editForm(s) : body}
      </section>
    );
  };

  const editForm = (s: Section) => {
    const f = draft.f;
    const errs = errors ?? {};
    const n = Object.keys(errs).length;
    let body: ReactNode = null;
    if (s === "policy") {
      const soldBy =
        allowed.has("agentId") && props.soldByChoices.length ? (
          <Field key="sold" label="Sold by" htmlFor="pe-agentId" required span2 help="Moving it changes whose board it counts on.">
            <SelectBox id="pe-agentId" value={f.agentId} onChange={(e) => change("agentId", e.target.value)}>
              {!props.soldByChoices.some((a) => a.id === f.agentId) && <option value={f.agentId}>{p.agentName}</option>}
              {props.soldByChoices.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </SelectBox>
          </Field>
        ) : null;
      const uwOff = p.status && p.status !== "Submitted" && p.status !== "Underwriting" ? `Follows the status. It's ${p.status} now.` : undefined;
      body = <PolicyFields f={f} onChange={change} errors={errs} lockOf={lockOf} idp="pe-" lists={props.lists} today={props.today} soldBy={soldBy} uwHelp="Moves the status to Underwriting; unticked, back to Submitted." uwDisabled={uwOff} />;
    } else if (s === "client") body = <ClientFields f={f} onChange={change} errors={errs} lockOf={lockOf} idp="pe-" lists={props.lists} today={props.today} />;
    else if (s === "beneficiaries") body = <BensFields title={false} bens={f.bens} idp="pe-" error={errs.bens} onBens={(bens) => setDraft((d) => ({ ...d, f: { ...d.f, bens } }))} />;
    else
      body = (
        <Field label="Notes" htmlFor="pe-notes" error={errs.notes}>
          <TextArea id="pe-notes" rows={5} value={f.notes} placeholder="Anything the next person should know" onChange={(e) => change("notes", e.target.value)} />
        </Field>
      );
    const boardTouched = s === "policy" && props.rights.asksOwner;
    return (
      <form className="pv-form" method="post" noValidate onSubmit={(e) => save(e, s)} onKeyDown={(e) => e.key === "Escape" && cancel()}>
        {n > 0 && (
          <div className="form-alert" role="alert">
            <Icon name="alert" size={16} />
            <span>{n === 1 ? "Fix the field marked below." : errorLine(n).replace("Fill in", "Fix")}</span>
          </div>
        )}
        {body}
        {boardTouched && (
          <p className="pv-ask">
            <Icon name="info" size={15} />
            <span>A change to the premium, carrier, product, day or seller goes to Anersi for a quick OK.</span>
          </p>
        )}
        <div className="pv-form-foot">
          <button type="button" className="btn btn-ghost" onClick={cancel} disabled={pending}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={pending}>
            <Icon name="check" size={18} />
            <span>{pending ? "Saving..." : "Save"}</span>
          </button>
        </div>
      </form>
    );
  };

  const card = (html: ReactNode, cls?: string) => <div className={cn("card pv-card", cls)}>{html}</div>;
  const summary = isImport ? `${policiesWord(p.policies)} · ${formatDollars(p.premiumCents)}/yr · ${dateLong(p.soldOn)}` : summaryLine(p);
  const head = (
    <header className="page-head pv-head">
      <Link href={props.back.href} className="back-link">
        <Icon name="chevron-left" size={16} />
        <span>{props.back.label}</span>
      </Link>
      <div className="pv-head-row">
        <div className="pv-titles">
          <h1 className="page-title pv-name">{props.title}</h1>
        </div>
        {!isImport && (
          <div className="pv-head-status">
            <StatusControl p={p} ok={props.statusOk} lock={props.statusLock} />
          </div>
        )}
      </div>
      <p className="pv-summary">{summary}</p>
      <p className="pv-meta">
        Sold by <b>{p.agentName}</b>
        <span className="pv-dot" aria-hidden>
          ·
        </span>
        {props.loggedLine}
      </p>
      {props.freshLine && (
        <p className="pv-fresh">
          <Icon name="clock" size={14} />
          <span>{props.freshLine}</span>
        </p>
      )}
    </header>
  );
  const removeBlock = props.remove.can ? card(<RemoveBlock id={p.id} label={props.remove.label} asksOwner={props.remove.asksOwner} back={props.back.href} />, "pv-card-remove") : null;

  if (isImport) {
    return (
      <div className="page pv-page" data-policy={p.id} ref={root}>
        {head}
        <div className="pv-grid">
          <div className="pv-main">
            {card(
              <section className="pv-sec">
                <div className="pv-sec-head">
                  <h3 className="pv-sec-title">Day total from AgentSpace</h3>
                </div>
                <div className="pv-locks">
                  <p className="pv-lockline">
                    <Icon name="lock" size={13} className="ico" />
                    <span>{props.rights.locked.status}</span>
                  </p>
                </div>
                <PvDl
                  items={[
                    { label: "Sold by", value: p.agentName },
                    { label: "Day", value: dateLong(p.soldOn) },
                    { label: "Policies", value: String(p.policies) },
                    { label: "Annual premium", value: formatDollars(p.premiumCents) },
                  ]}
                />
                <p className="pv-none mt-4">One row for the whole day, as the AgentSpace screenshots showed it: no client, carrier or status.</p>
              </section>,
            )}
          </div>
          <div className="pv-side">
            {card(
              <section className="pv-sec" data-sec="history">
                <div className="pv-sec-head">
                  <h3 className="pv-sec-title">
                    History<span className="pv-count num">{props.history.length}</span>
                  </h3>
                </div>
                {props.history.length ? <Timeline items={props.history} /> : <p className="pv-none">Nothing changed since it was loaded.</p>}
              </section>,
            )}
            {removeBlock}
          </div>
        </div>
      </div>
    );
  }

  const policy = section("policy", "Policy", <PvDl items={policyItems(p, fieldLock)} cols={4} />);
  const client = section("client", "Client", <PvDl items={clientItems(p.client, props.today)} cols={4} />);
  const bens = section(
    "beneficiaries",
    "Beneficiaries",
    p.beneficiaries.length ? (
      <ul className="pv-bens">
        {p.beneficiaries.map((b, i) => (
          <li key={i}>
            <span className="pv-ben-name">{b.name}</span>
            <span className="pv-ben-rel">{b.relationship || "—"}</span>
          </li>
        ))}
      </ul>
    ) : (
      <p className="pv-none">None listed.</p>
    ),
    { count: p.beneficiaries.length || null },
  );
  const notes = section("notes", "Notes", p.notes ? <p className="pv-notes">{p.notes}</p> : <p className="pv-none">No notes yet.</p>);
  const history = (
    <section className="pv-sec" data-sec="history">
      <div className="pv-sec-head">
        <h3 className="pv-sec-title">
          History<span className="pv-count num">{props.history.length}</span>
        </h3>
      </div>
      {props.history.length ? <Timeline items={props.history} /> : <p className="pv-none">No changes yet.</p>}
    </section>
  );
  return (
    <div className="page pv-page" data-policy={p.id} ref={root}>
      {head}
      <div className="pv-grid">
        <div className="pv-main">
          {card(policy)}
          {card(client)}
          {card(bens)}
        </div>
        <div className="pv-side">
          {card(notes)}
          {card(history)}
          {removeBlock}
          <p className="pv-seen">
            <Icon name="eye" size={15} className="ico" />
            <span>{props.seen}</span>
          </p>
        </div>
      </div>
    </div>
  );
}

/** The status pill; when the rules allow, it opens a menu of the six statuses. */
function StatusControl({ p, ok, lock }: { p: PolicyRecord; ok: boolean; lock: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const wrap = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => wrap.current && !wrap.current.contains(e.target as Node) && setOpen(false);
    const key = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", down);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("pointerdown", down);
      document.removeEventListener("keydown", key);
    };
  }, [open]);
  if (!ok)
    return (
      <span className="pv-status is-locked" title={lock} data-status={p.status ?? ""}>
        <StatusPill status={p.status} />
      </span>
    );
  const pick = (s: PolicyStatus) => {
    setOpen(false);
    if (s === p.status) return;
    const before = p.status ?? NO_STATUS;
    start(async () => {
      const r = await setPolicyStatusAction(p.id, s);
      toast(r.ok ? `${before} → ${s}` : r.error, r.ok);
      if (r.ok) router.refresh();
    });
  };
  return (
    <div className="pop-wrap pv-status-pop" ref={wrap}>
      <button type="button" className={cn("pv-status-btn", open && "on")} aria-haspopup="menu" aria-expanded={open} aria-label={`Status: ${p.status ?? NO_STATUS}. Change it`} onClick={() => setOpen((v) => !v)} disabled={pending} data-status={p.status ?? ""}>
        <StatusPill status={p.status} />
        <Icon name="chevron-down" size={15} className="pv-status-chev" />
      </button>
      {open && (
        <div className="pop pop-right" style={{ width: 240 }}>
          <div className="menu pv-smenu" role="menu">
            <div className="menu-head">
              <div className="menu-name">Change the status</div>
              <div className="menu-sub">It&apos;s saved in the history.</div>
            </div>
            {POLICY_STATUSES.map((s) => (
              <button key={s} type="button" role="menuitemradio" aria-checked={s === p.status} className={cn("menu-item", s === p.status && "on")} onClick={() => pick(s)}>
                <StatusPill status={s} small />
                {s === p.status && <Icon name="check" size={16} className="menu-check" />}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** Take it back (the first 15 minutes) or Remove policy (an admin; a past month asks the owner), with a confirm. */
function RemoveBlock({ id, label, asksOwner, back }: { id: string; label: "" | "Remove policy" | "Take it back"; asksOwner: boolean; back: string }) {
  const router = useRouter();
  const [asking, setAsking] = useState(false);
  const [pending, start] = useTransition();
  const take = label === "Take it back";
  const yes = () =>
    start(async () => {
      const r = await removePolicyAction(id);
      if (!r.ok) {
        toast(r.error, false);
        setAsking(false);
        return;
      }
      toast(r.message ?? (take ? "Taken back." : "Removed."));
      if (asksOwner) {
        setAsking(false);
        router.refresh();
      } else router.push(back);
    });
  if (asking)
    return (
      <div className="pv-remove">
        <div className="confirm">
          <div>
            <div className="confirm-q">Are you sure?</div>
            <div className="confirm-sub">
              {take ? "It comes off the board and out of your policies." : "It comes off the board and out of the policy list."}
              {asksOwner ? " Anersi gets a request first." : ""}
            </div>
          </div>
          <div className="confirm-btns">
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAsking(false)} disabled={pending}>
              Keep it
            </button>
            <button type="button" className="btn btn-danger btn-sm" onClick={yes} disabled={pending} data-confirm-remove>
              {pending ? "One moment..." : take ? "Yes, take it back" : "Yes, remove"}
            </button>
          </div>
        </div>
      </div>
    );
  return (
    <div className="pv-remove">
      <button type="button" className="btn btn-danger btn-sm" onClick={() => setAsking(true)} data-remove>
        <Icon name={take ? "undo" : "trash"} size={16} />
        <span>{label}</span>
      </button>
      <span className="pv-remove-note">{take ? "For 15 minutes after logging, the sale can come back off the board." : asksOwner ? "A past month's policy asks Anersi first." : "It leaves the board, the totals and the policy list."}</span>
    </div>
  );
}
