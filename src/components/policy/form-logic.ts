import { autoBillingDay, formatPhoneInput, productsOf, type FormKey, type PolicyForm } from "../../lib/policy-validate";
import { billingDaysFor, type CarrierProducts } from "../../lib/policy-types";

/**
 * The sale form's behavior as it is typed (Log a sale and a policy's Edit share it), the demo's
 * applyField ported. Pure: it takes the form and one change and returns the next form. Nothing
 * here is stored anywhere but React state (a client's details never go to browser storage or the
 * address).
 */
export interface Draft {
  f: PolicyForm;
  /** The person picked a billing day themself: the effective date stops setting it. */
  billingTouched: boolean;
}

export type FieldValue = string | boolean;

/** One field changed. `autoDay`: Log a sale fills the billing day from the effective date until it is picked. */
export function applyChange(d: Draft, key: keyof PolicyForm, value: FieldValue, opts: { carrierProducts: CarrierProducts; autoDay?: boolean }): Draft {
  const f: PolicyForm = { ...d.f };
  let touched = d.billingTouched;
  if (key === "underwriting" || key === "noEmail") f[key] = value === true;
  else if (key === "bens") return d;
  else (f as unknown as Record<string, string>)[key] = key === "phone" ? formatPhoneInput(String(value)) : String(value);
  const auto = () => {
    if (!opts.autoDay || touched || !f.effectiveDate) return;
    f.billingDay = autoBillingDay(f.effectiveDate, f.ss === "yes");
  };
  if (key === "carrier") {
    const prods = productsOf(f.carrier, opts.carrierProducts);
    if (!prods.includes(f.product)) f.product = prods.length === 1 ? prods[0] : "";
  } else if (key === "ss") {
    if (!billingDaysFor(f.ss === "yes").includes(f.billingDay)) {
      f.billingDay = "";
      touched = false;
    }
    auto();
  } else if (key === "effectiveDate") auto();
  else if (key === "billingDay") touched = true;
  return { f, billingTouched: touched };
}

/**
 * The form as a FormData for the server (policy-validate.ts formFromFormData reads it back): the
 * keys given (a section's), or every field. Yes/no boxes as "1"/"0"; beneficiaries as repeated
 * benName / benRelationship (a "bens" marker when the list is empty, so clearing it saves).
 * `soldOnTouched` false sends no day: the server stamps its own Detroit today.
 */
export function toFormData(f: PolicyForm, keys?: readonly FormKey[], opts: { soldOnTouched?: boolean } = {}): FormData {
  const fd = new FormData();
  const want = (k: FormKey) => !keys || keys.includes(k);
  const text: (keyof PolicyForm)[] = ["agentId", "carrier", "product", "effectiveDate", "monthly", "rateClass", "coverage", "soldOn", "ss", "billingCycle", "billingDay", "policyNumber", "applicationNumber", "leadSource", "notes", "firstName", "lastName", "dob", "email", "phone", "address"];
  for (const k of text) {
    if (!want(k)) continue;
    if (k === "soldOn" && opts.soldOnTouched === false) continue;
    fd.set(k, String(f[k] ?? ""));
  }
  if (keys?.includes("numbers")) {
    fd.set("policyNumber", f.policyNumber);
    fd.set("applicationNumber", f.applicationNumber);
  }
  if (want("underwriting")) fd.set("underwriting", f.underwriting ? "1" : "0");
  if (want("noEmail")) fd.set("noEmail", f.noEmail ? "1" : "0");
  if (want("bens")) {
    const bens = f.bens.filter((b) => b.name.trim());
    if (!bens.length) fd.set("bens", "");
    for (const b of bens) {
      fd.append("benName", b.name);
      fd.append("benRelationship", b.relationship);
    }
  }
  return fd;
}

/** The yearly amount beside the monthly box ("$1,135/yr"), "" while it is not an amount. */
export function annualHint(monthly: string, parse: (s: string) => number | null, yearly: (c: number) => string): string {
  const c = monthly.trim() ? parse(monthly) : null;
  return c && c > 0 ? yearly(c * 12) : "";
}
