"use client";

import type { ReactNode } from "react";
import { cn } from "@/components/ui";
import { Icon } from "@/components/ui/icon";
import { CheckBox, DateInput, Field, FormGrid, FormSection, MoneyInput, SelectBox, TextArea, TextInput } from "@/components/ui/kit";
import { addDays, addMonths } from "@/lib/month";
import { parseDollars } from "@/lib/money";
import { BILLING_CYCLES, billingDaysFor, type CarrierProducts } from "@/lib/policy-types";
import { FORM_LABEL, REQUIRED, ageOn, productsOf, yearlyText, type FormKey, type PolicyForm } from "@/lib/policy-validate";
import { annualHint, type FieldValue } from "./form-logic";

/**
 * The sale form's fields, in AgentSpace's sections (the demo's formPolicy, formClient and
 * formBens): Log a sale's steps 1 and 2, and a policy's Edit. Controlled by the caller's state;
 * `lockOf(key)` gives the reason a field is locked (the policy page), and a locked field is drawn
 * disabled with its reason under it.
 */
export interface Lists {
  carrierProducts: CarrierProducts;
  rateClasses: string[];
  leadSources: string[];
}
export type FieldErrors = Partial<Record<FormKey, string>>;
type LockOf = (k: FormKey) => string | false;

interface Common {
  f: PolicyForm;
  onChange: (k: keyof PolicyForm, v: FieldValue) => void;
  errors?: FieldErrors;
  lockOf?: LockOf;
  /** Id prefix ("" on Log a sale, "pe-" on a policy's Edit). */
  idp: string;
  lists: Lists;
  /** Today in Detroit. */
  today: string;
}

function bitsOf(p: Common) {
  const err = p.errors ?? {};
  const lock = (k: FormKey): string | false => (p.lockOf ? p.lockOf(k) : false);
  const id = (k: string) => `${p.idp}${k}`;
  const field = (k: FormKey, control: ReactNode, extra?: { help?: ReactNode; span2?: boolean; className?: string; htmlFor?: string }) => (
    <Field key={k} label={FORM_LABEL[k]} htmlFor={extra?.htmlFor ?? id(k)} required={REQUIRED.has(k)} error={err[k]} locked={lock(k) || false} help={extra?.help} span2={extra?.span2} className={extra?.className}>
      {control}
    </Field>
  );
  return { err, lock, id, field };
}

const opts = (xs: readonly string[], keep?: string) => {
  const list = [...xs];
  if (keep && !list.includes(keep)) list.push(keep);
  return list.map((x) => (
    <option key={x} value={x}>
      {x}
    </option>
  ));
};

/** The policy half: Carrier and product, Policy details, Billing, the numbers, Additional information. */
export function PolicyFields(
  p: Common & {
    /** The "Who sold it" field at the top of Carrier and product (an admin's Edit). */
    soldBy?: ReactNode;
    autoDay?: boolean;
    billingTouched?: boolean;
    withNotes?: boolean;
    uwHelp?: string;
    /** Why the underwriter box can't change now (it follows the status), not a lock. */
    uwDisabled?: string;
    /** The earliest submitted date this viewer may pick (rules.ts earliestSoldOn; none for an admin). */
    earliest?: string;
  },
) {
  const { f, onChange } = p;
  const { err, lock, id, field } = bitsOf(p);
  const carriers = Object.keys(p.lists.carrierProducts);
  if (f.carrier && !carriers.includes(f.carrier)) carriers.push(f.carrier);
  const products = f.carrier ? [...productsOf(f.carrier, p.lists.carrierProducts)] : [];
  if (f.carrier && f.product && !products.includes(f.product)) products.push(f.product);
  const nextMonth = `${addMonths(p.today.slice(0, 7), 1)}-01`;
  const days = billingDaysFor(f.ss === "yes");
  const numErr = err.numbers;
  const showAuto = p.autoDay && !p.billingTouched && !!f.billingDay;
  const yr = annualHint(f.monthly, parseDollars, yearlyText);
  const effLocked = !!lock("effectiveDate");
  const uwLock = lock("underwriting");
  return (
    <>
      <FormSection title="Carrier and product">
        <FormGrid>
          {p.soldBy}
          {field(
            "carrier",
            <SelectBox id={id("carrier")} name="carrier" value={f.carrier} disabled={!!lock("carrier")} onChange={(e) => onChange("carrier", e.target.value)}>
              <option value="">Select carrier</option>
              {opts(carriers)}
            </SelectBox>,
          )}
          {field(
            "product",
            <SelectBox id={id("product")} name="product" value={f.product} disabled={!!lock("product") || !f.carrier} onChange={(e) => onChange("product", e.target.value)}>
              <option value="">{f.carrier ? "Select product" : "Pick a carrier first"}</option>
              {opts(products)}
            </SelectBox>,
          )}
        </FormGrid>
      </FormSection>
      <FormSection title="Policy details">
        <FormGrid>
          {field(
            "effectiveDate",
            <div className="flex flex-col gap-2.5">
              <DateInput id={id("effectiveDate")} name="effectiveDate" value={f.effectiveDate} disabled={effLocked} onChange={(e) => onChange("effectiveDate", e.target.value)} />
              {!effLocked && (
                <div className="qchips">
                  {[
                    { label: "1st of next month", value: nextMonth },
                    { label: "Today", value: p.today },
                  ].map((c) => (
                    <button key={c.label} type="button" className={cn("qchip", f.effectiveDate === c.value && "on")} aria-pressed={f.effectiveDate === c.value} onClick={() => onChange("effectiveDate", c.value)}>
                      {c.label}
                    </button>
                  ))}
                </div>
              )}
            </div>,
          )}
          {field(
            "monthly",
            <div className="pf-money">
              <MoneyInput id={id("premium")} name="monthly" value={f.monthly} disabled={!!lock("monthly")} className="pf-pad-r" onChange={(e) => onChange("monthly", e.target.value)} />
              <span className="pf-yr num" aria-live="polite">
                {yr}
              </span>
            </div>,
            { htmlFor: id("premium") },
          )}
          {field(
            "rateClass",
            <SelectBox id={id("rateClass")} name="rateClass" value={f.rateClass} disabled={!!lock("rateClass")} onChange={(e) => onChange("rateClass", e.target.value)}>
              <option value="">Select rate class</option>
              {opts(p.lists.rateClasses, f.rateClass)}
            </SelectBox>,
          )}
          {field("coverage", <MoneyInput id={id("coverage")} name="coverage" value={f.coverage} disabled={!!lock("coverage")} onChange={(e) => onChange("coverage", e.target.value)} />)}
          {field("soldOn", <DateInput id={id("soldOn")} name="soldOn" value={f.soldOn} min={p.earliest} max={p.today} disabled={!!lock("soldOn")} onChange={(e) => onChange("soldOn", e.target.value)} />, {
            help: lock("soldOn") ? undefined : p.earliest ? "The day it counts on the board: this month, never later than today. A past month needs an admin." : "The day it counts on the board. Never later than today.",
          })}
        </FormGrid>
      </FormSection>
      <FormSection title="Billing">
        <FormGrid>
          {field(
            "ss",
            <SelectBox id={id("ss")} name="ss" value={f.ss} disabled={!!lock("ss")} onChange={(e) => onChange("ss", e.target.value)}>
              {f.ss === "" && <option value="">Select</option>}
              <option value="no">No</option>
              <option value="yes">Yes</option>
            </SelectBox>,
          )}
          {field(
            "billingCycle",
            <SelectBox id={id("billingCycle")} name="billingCycle" value={f.billingCycle} disabled={!!lock("billingCycle")} onChange={(e) => onChange("billingCycle", e.target.value)}>
              <option value="">Select billing cycle</option>
              {opts(BILLING_CYCLES, f.billingCycle)}
            </SelectBox>,
          )}
          {field(
            "billingDay",
            <SelectBox id={id("billingDay")} name="billingDay" value={f.billingDay} disabled={!!lock("billingDay")} onChange={(e) => onChange("billingDay", e.target.value)}>
              <option value="">Select day</option>
              {opts(days, f.billingDay)}
            </SelectBox>,
            { help: showAuto ? "Set from the effective date." : f.ss === "yes" && !lock("billingDay") ? "The client's benefit day." : undefined },
          )}
        </FormGrid>
      </FormSection>
      <FormSection title="Policy and application numbers" sub="Enter at least one.">
        {numErr && (
          <p className="field-error pf-sec-err" role="alert">
            {numErr}
          </p>
        )}
        <FormGrid>
          {field("policyNumber", <TextInput id={id("policyNumber")} name="policyNumber" value={f.policyNumber} autoComplete="off" disabled={!!lock("policyNumber")} onChange={(e) => onChange("policyNumber", e.target.value)} />, { className: numErr ? "has-error" : undefined })}
          {field(
            "applicationNumber",
            <TextInput id={id("applicationNumber")} name="applicationNumber" value={f.applicationNumber} autoComplete="off" inputMode="numeric" disabled={!!lock("applicationNumber")} onChange={(e) => onChange("applicationNumber", e.target.value)} />,
            { className: numErr ? "has-error" : undefined },
          )}
        </FormGrid>
      </FormSection>
      <FormSection title="Additional information">
        <FormGrid>
          {field(
            "leadSource",
            <SelectBox id={id("leadSource")} name="leadSource" value={f.leadSource} disabled={!!lock("leadSource")} onChange={(e) => onChange("leadSource", e.target.value)}>
              <option value="">Select lead source</option>
              {opts(p.lists.leadSources, f.leadSource)}
            </SelectBox>,
          )}
          {p.withNotes &&
            field("notes", <TextArea id={id("notes")} name="notes" rows={4} value={f.notes} placeholder="Anything the next person should know" disabled={!!lock("notes")} onChange={(e) => onChange("notes", e.target.value)} />, { span2: true })}
          <Field span2 className="pf-uw" locked={uwLock || false}>
            <CheckBox id={id("underwriting")} name="underwriting" checked={f.underwriting} label={FORM_LABEL.underwriting} help={p.uwDisabled || p.uwHelp || undefined} disabled={!!uwLock || !!p.uwDisabled} onChange={(e) => onChange("underwriting", e.target.checked)} />
          </Field>
        </FormGrid>
      </FormSection>
    </>
  );
}

/** The client half: Personal details and Contact information. */
export function ClientFields(p: Common) {
  const { f, onChange } = p;
  const { err, lock, id, field } = bitsOf(p);
  const age = f.dob && f.dob < p.today ? ageOn(f.dob, p.today) : null;
  return (
    <>
      <FormSection title="Personal details">
        <FormGrid>
          {field("firstName", <TextInput id={id("firstName")} name="firstName" value={f.firstName} autoComplete="off" disabled={!!lock("firstName")} onChange={(e) => onChange("firstName", e.target.value)} />)}
          {field("lastName", <TextInput id={id("lastName")} name="lastName" value={f.lastName} autoComplete="off" disabled={!!lock("lastName")} onChange={(e) => onChange("lastName", e.target.value)} />)}
          {field("dob", <DateInput id={id("dob")} name="dob" value={f.dob} max={addDays(p.today, -1)} disabled={!!lock("dob")} onChange={(e) => onChange("dob", e.target.value)} />, {
            help: age != null && !err.dob ? `Age ${age}` : undefined,
          })}
        </FormGrid>
      </FormSection>
      <FormSection title="Contact information">
        <FormGrid>
          {field(
            "email",
            <TextInput
              id={id("email")}
              name="email"
              type="email"
              autoComplete="off"
              placeholder={f.noEmail ? "No email" : "name@example.com"}
              value={f.noEmail ? "" : f.email}
              disabled={!!lock("email") || f.noEmail}
              onChange={(e) => onChange("email", e.target.value)}
            />,
          )}
          {field("phone", <TextInput id={id("phone")} name="phone" type="tel" inputMode="tel" autoComplete="off" placeholder="(248) 555-0123" value={f.phone} disabled={!!lock("phone")} onChange={(e) => onChange("phone", e.target.value)} />)}
          <div className="pf-noemail">
            <CheckBox id={id("noEmail")} name="noEmail" checked={f.noEmail} label={FORM_LABEL.noEmail} disabled={!!lock("noEmail")} onChange={(e) => onChange("noEmail", e.target.checked)} />
          </div>
          {field("address", <TextInput id={id("address")} name="address" autoComplete="off" placeholder="Street, city, state and ZIP" value={f.address} disabled={!!lock("address")} onChange={(e) => onChange("address", e.target.value)} />, { span2: true })}
        </FormGrid>
      </FormSection>
    </>
  );
}

/** Beneficiaries: full name and relationship rows, a trash button each, "Add beneficiary". */
export function BensFields({ bens, onBens, idp, error, title = true }: { bens: PolicyForm["bens"]; onBens: (next: PolicyForm["bens"]) => void; idp: string; error?: string; title?: boolean }) {
  const rows = bens.length ? bens : [{ name: "", relationship: "" }];
  const setAt = (i: number, patch: Partial<PolicyForm["bens"][number]>) => onBens(rows.map((b, j) => (j === i ? { ...b, ...patch } : b)));
  const body = (
    <>
      {error && (
        <p className="field-error pf-sec-err" role="alert">
          {error}
        </p>
      )}
      <div className="pf-ben-list">
        {rows.map((b, i) => (
          <div key={i} className="pf-ben">
            <Field label="Full name" htmlFor={`${idp}ben-${i}-name`} className={i === 0 ? undefined : "pf-nolabel"}>
              <TextInput id={`${idp}ben-${i}-name`} name="benName" value={b.name} placeholder="Jane Doe" autoComplete="off" onChange={(e) => setAt(i, { name: e.target.value })} />
            </Field>
            <Field label="Relationship" htmlFor={`${idp}ben-${i}-rel`} className={i === 0 ? undefined : "pf-nolabel"}>
              <TextInput id={`${idp}ben-${i}-rel`} name="benRelationship" value={b.relationship} placeholder="Spouse, child…" autoComplete="off" onChange={(e) => setAt(i, { relationship: e.target.value })} />
            </Field>
            <button
              type="button"
              className="btn btn-ghost btn-icon pf-ben-del"
              aria-label="Remove this beneficiary"
              onClick={() => {
                const next = rows.filter((_, j) => j !== i);
                onBens(next.length ? next : [{ name: "", relationship: "" }]);
              }}
            >
              <Icon name="trash" size={17} />
            </button>
          </div>
        ))}
      </div>
      <div className="pf-ben-add">
        <button
          type="button"
          className="btn btn-secondary"
          disabled={rows.length >= 10}
          onClick={() => {
            onBens([...rows, { name: "", relationship: "" }]);
            setTimeout(() => document.getElementById(`${idp}ben-${rows.length}-name`)?.focus(), 0);
          }}
        >
          <Icon name="plus" size={18} />
          <span>Add beneficiary</span>
        </button>
      </div>
    </>
  );
  if (!title) return <div className="pv-form-bens">{body}</div>;
  return (
    <FormSection title="Beneficiaries" sub="Optional" className="pf-bens">
      {body}
    </FormSection>
  );
}
