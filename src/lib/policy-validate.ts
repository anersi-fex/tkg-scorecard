import { addDays, isDateKey } from "./month";
import { formatDollars, parseDollars } from "./money";
import {
  BILLING_CYCLES,
  EMPTY_CLIENT,
  billingDaysFor,
  ordinal,
  type Beneficiary,
  type CarrierProducts,
  type PolicyClient,
  type PolicyRecord,
} from "./policy-types";

/**
 * Log a sale's three steps (AgentSpace's Post a Deal in our words, from the demo the owner
 * approved): 1 Policy information, 2 Client information, 3 Review and log. The same checks run in
 * the form (per step, as the person types) and on the server (every field, before anything is
 * written), with the same words. Pure and browser-safe.
 *
 * The form works on plain values: money as typed ("94.58"), yes or no as "yes"/"no", the client
 * flat. A FormData carries the same names (formFromFormData); beneficiaries as repeated
 * "benName" / "benRelationship" pairs.
 */
export interface PolicyForm {
  agentId: string;
  carrier: string;
  product: string;
  effectiveDate: string;
  /** The monthly premium as typed. */
  monthly: string;
  rateClass: string;
  /** The coverage amount as typed ("" for none). */
  coverage: string;
  /** The submitted date ("" on Log a sale means today: the server stamps its own Detroit today). */
  soldOn: string;
  ss: "" | "yes" | "no";
  billingCycle: string;
  billingDay: string;
  policyNumber: string;
  applicationNumber: string;
  leadSource: string;
  notes: string;
  underwriting: boolean;
  firstName: string;
  lastName: string;
  dob: string;
  email: string;
  noEmail: boolean;
  phone: string;
  address: string;
  bens: Beneficiary[];
}
export type FormKey = keyof PolicyForm | "numbers";

export const STEPS = ["Policy information", "Client information", "Review and log"] as const;
/** The fields of each step, in screen order (the first error gets focus). */
export const STEP_FIELDS: Record<1 | 2, FormKey[]> = {
  1: ["agentId", "carrier", "product", "effectiveDate", "monthly", "rateClass", "coverage", "soldOn", "ss", "billingCycle", "billingDay", "numbers", "policyNumber", "applicationNumber", "leadSource", "notes", "underwriting"],
  2: ["firstName", "lastName", "dob", "email", "noEmail", "phone", "address", "bens"],
};
/** The record's edit sections (the policy page) and their fields. */
export const SECTION_FIELDS: Record<"policy" | "client" | "beneficiaries" | "notes", FormKey[]> = {
  policy: ["agentId", "carrier", "product", "effectiveDate", "monthly", "rateClass", "coverage", "soldOn", "ss", "billingCycle", "billingDay", "numbers", "policyNumber", "applicationNumber", "leadSource", "underwriting"],
  client: ["firstName", "lastName", "dob", "email", "noEmail", "phone", "address"],
  beneficiaries: ["bens"],
  notes: ["notes"],
};

export const FORM_LABEL: Record<FormKey, string> = {
  agentId: "Sold by",
  carrier: "Carrier",
  product: "Product",
  effectiveDate: "Policy effective date",
  monthly: "Monthly premium",
  rateClass: "Rate class",
  coverage: "Coverage amount",
  soldOn: "Submitted date",
  ss: "Paid from a Social Security benefit",
  billingCycle: "Billing cycle",
  billingDay: "Billing day",
  numbers: "Policy and application numbers",
  policyNumber: "Policy number",
  applicationNumber: "Application number",
  leadSource: "Lead source",
  notes: "Notes",
  underwriting: "In underwriter review with the carrier",
  firstName: "First name",
  lastName: "Last name",
  dob: "Date of birth",
  email: "Email",
  noEmail: "Client has no email address",
  phone: "Phone",
  address: "Address",
  bens: "Beneficiaries",
};
/** The fields marked * (Required). The numbers need at least one of the two. */
export const REQUIRED = new Set<FormKey>(["agentId", "carrier", "product", "effectiveDate", "monthly", "rateClass", "ss", "billingCycle", "billingDay", "leadSource", "firstName", "lastName", "dob", "email", "phone", "address"]);

/** Longest each typed value may be (the database checks the same, 0006_crm.sql). */
export const MAX_LEN = { name: 60, email: 120, phone: 30, address: 200, notes: 2000, number: 60, list: 60, benName: 80, benRelationship: 40, bens: 10 } as const;

/** The messages, word for word the demo's. */
export const MSG = {
  required: "Required",
  carrier: "Pick a carrier from the list",
  product: "Pick a product this carrier writes",
  zero: "Enter more than $0",
  monthly: "Enter an amount like 94.58",
  coverage: "Enter an amount like 10,000",
  future: "Can't be in the future",
  tooOld: "Can't be more than a year ago",
  pastMonth: "A sale in a past month needs an admin.",
  date: "Enter a date",
  numbers: "Enter at least one.",
  dobPast: "Pick a date in the past",
  email: "Enter an email like name@example.com",
  phone: "Enter a 10-digit number",
  list: "Pick one from the list",
  long: (n: number) => `Keep it to ${n} characters`,
  bens: `Up to ${10} beneficiaries`,
} as const;

/** "Fill in the field marked below." / "Fill in the 3 fields marked below." */
export const errorLine = (n: number): string => (n === 1 ? "Fill in the field marked below." : `Fill in the ${n} fields marked below.`);

export interface ValidateContext {
  /** Today in Detroit ("YYYY-MM-DD"). */
  today: string;
  carrierProducts: CarrierProducts;
  rateClasses: string[];
  leadSources: string[];
  /**
   * The stored values when fixing a policy: a carrier, product, rate class or lead source that has
   * since left Settings still passes while it is unchanged.
   */
  keep?: Partial<PolicyForm>;
  /** The earliest submitted date this viewer may pick (the 1st of this month for anyone but an admin: rules.ts earliestSoldOn). */
  earliest?: string;
}

const t = (s: unknown) => String(s ?? "").trim();
const looksLikeEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s.trim());
const digits = (s: string) => s.replace(/\D/g, "");
const inList = (v: string, list: readonly string[]) => list.some((x) => x.toLowerCase() === v.toLowerCase());

/** The carrier's own spelling from Settings (any case), or null. */
export function carrierIn(carrier: string, cp: CarrierProducts): string | null {
  return Object.keys(cp).find((k) => k.toLowerCase() === t(carrier).toLowerCase()) ?? null;
}
/** The products a carrier writes (none for a carrier not in Settings). */
export function productsOf(carrier: string, cp: CarrierProducts): string[] {
  const k = carrierIn(carrier, cp);
  return k ? cp[k] : [];
}

/**
 * The form's errors, by field ("carrier": "Required", "numbers": "Enter at least one."). `keys`
 * narrows it to one step's or one section's fields. Empty when everything passes.
 */
export function validatePolicyForm(f: PolicyForm, ctx: ValidateContext, keys?: readonly FormKey[]): Partial<Record<FormKey, string>> {
  const e: Partial<Record<FormKey, string>> = {};
  const keep = ctx.keep ?? {};
  const kept = (k: keyof PolicyForm, v: string) => v !== "" && t(keep[k]) === v;
  const need = (k: FormKey, v: string) => {
    if (!v) e[k] = MSG.required;
  };
  const listed = (k: keyof PolicyForm, list: readonly string[], max: number) => {
    const v = t(f[k]);
    need(k, v);
    if (v && !inList(v, list) && !kept(k, v)) e[k] = MSG.list;
    if (v.length > max) e[k] = MSG.long(max);
  };

  need("agentId", t(f.agentId));
  const carrier = t(f.carrier);
  need("carrier", carrier);
  if (carrier && !carrierIn(carrier, ctx.carrierProducts) && !kept("carrier", carrier)) e.carrier = MSG.carrier;
  const product = t(f.product);
  need("product", product);
  if (carrier && product && !inList(product, productsOf(carrier, ctx.carrierProducts)) && !(kept("product", product) && kept("carrier", carrier))) e.product = MSG.product;

  const eff = t(f.effectiveDate);
  need("effectiveDate", eff);
  if (eff && !isDateKey(eff)) e.effectiveDate = MSG.date;

  const monthly = t(f.monthly);
  if (!monthly) e.monthly = MSG.required;
  else {
    const cents = parseDollars(monthly);
    if (cents == null) e.monthly = MSG.monthly;
    else if (cents === 0) e.monthly = MSG.zero;
    else if (cents > 100_000_000) e.monthly = MSG.monthly;
  }
  listed("rateClass", ctx.rateClasses, MAX_LEN.list);
  const coverage = t(f.coverage);
  if (coverage && parseDollars(coverage) == null) e.coverage = MSG.coverage;

  const sold = t(f.soldOn);
  if (sold) {
    if (!isDateKey(sold)) e.soldOn = MSG.date;
    else if (sold > ctx.today) e.soldOn = MSG.future;
    else if (sold < addDays(ctx.today, -400)) e.soldOn = MSG.tooOld;
    else if (ctx.earliest && sold < ctx.earliest && !kept("soldOn", sold)) e.soldOn = MSG.pastMonth;
  }

  if (f.ss !== "yes" && f.ss !== "no") e.ss = MSG.required;
  const cycle = t(f.billingCycle);
  need("billingCycle", cycle);
  if (cycle && !inList(cycle, BILLING_CYCLES) && !kept("billingCycle", cycle)) e.billingCycle = MSG.list;
  const day = t(f.billingDay);
  need("billingDay", day);
  if (day && f.ss && !inList(day, billingDaysFor(f.ss === "yes")) && !kept("billingDay", day)) e.billingDay = MSG.list;

  const pn = t(f.policyNumber);
  const an = t(f.applicationNumber);
  if (!pn && !an) e.numbers = MSG.numbers;
  if (pn.length > MAX_LEN.number) e.policyNumber = MSG.long(MAX_LEN.number);
  if (an.length > MAX_LEN.number) e.applicationNumber = MSG.long(MAX_LEN.number);

  listed("leadSource", ctx.leadSources, MAX_LEN.list);
  if (String(f.notes ?? "").length > MAX_LEN.notes) e.notes = MSG.long(MAX_LEN.notes);

  const first = t(f.firstName);
  need("firstName", first);
  if (first.length > MAX_LEN.name) e.firstName = MSG.long(MAX_LEN.name);
  const last = t(f.lastName);
  need("lastName", last);
  if (last.length > MAX_LEN.name) e.lastName = MSG.long(MAX_LEN.name);
  const dob = t(f.dob);
  need("dob", dob);
  if (dob && !isDateKey(dob)) e.dob = MSG.date;
  else if (dob && dob >= ctx.today) e.dob = MSG.dobPast;
  if (!f.noEmail) {
    const email = t(f.email);
    if (!email) e.email = MSG.required;
    else if (!looksLikeEmail(email)) e.email = MSG.email;
    else if (email.length > MAX_LEN.email) e.email = MSG.long(MAX_LEN.email);
  }
  const phone = t(f.phone);
  need("phone", phone);
  if (phone && (digits(phone).replace(/^1(?=\d{10}$)/, "").length !== 10 || phone.length > MAX_LEN.phone)) e.phone = MSG.phone;
  const address = t(f.address);
  need("address", address);
  if (address.length > MAX_LEN.address) e.address = MSG.long(MAX_LEN.address);

  const bens = (f.bens ?? []).filter((b) => t(b.name));
  if (bens.length > MAX_LEN.bens) e.bens = MSG.bens;
  else if (bens.some((b) => t(b.name).length > MAX_LEN.benName || t(b.relationship).length > MAX_LEN.benRelationship)) e.bens = MSG.long(MAX_LEN.benName);

  if (keys) for (const k of Object.keys(e) as FormKey[]) if (!keys.includes(k)) delete e[k];
  return e;
}

/** The first step (1 or 2) with an error, or 3 when both pass (Log a sale never opens past a step that is not filled in). */
export function firstOpenStep(f: PolicyForm, ctx: ValidateContext): 1 | 2 | 3 {
  if (Object.keys(validatePolicyForm(f, ctx, STEP_FIELDS[1])).length) return 1;
  if (Object.keys(validatePolicyForm(f, ctx, STEP_FIELDS[2])).length) return 2;
  return 3;
}

// ---- values ----------------------------------------------------------------------------------------

/** A policy's values, cleaned (cents, yes/no as booleans, trimmed text, the client and beneficiaries). */
export interface PolicyValues {
  agentId: string;
  carrier: string;
  product: string;
  effectiveDate: string | null;
  monthlyCents: number | null;
  rateClass: string | null;
  coverageCents: number | null;
  soldOn: string | null;
  ssBenefit: boolean | null;
  billingCycle: string | null;
  billingDay: string | null;
  policyNumber: string | null;
  applicationNumber: string | null;
  leadSource: string | null;
  notes: string | null;
  underwriting: boolean;
  client: PolicyClient;
  beneficiaries: Beneficiary[];
}

const orNull = (s: unknown) => t(s) || null;
/** The form's values, cleaned (call after validatePolicyForm passed). Settings' spelling for the lists. */
export function valuesOf(f: PolicyForm, cp?: CarrierProducts): PolicyValues {
  const carrier = cp ? (carrierIn(f.carrier, cp) ?? t(f.carrier)) : t(f.carrier);
  const product = cp ? (productsOf(carrier, cp).find((p) => p.toLowerCase() === t(f.product).toLowerCase()) ?? t(f.product)) : t(f.product);
  const monthly = t(f.monthly) ? parseDollars(t(f.monthly)) : null;
  const coverage = t(f.coverage) ? parseDollars(t(f.coverage)) : null;
  return {
    agentId: t(f.agentId),
    carrier,
    product,
    effectiveDate: orNull(f.effectiveDate),
    monthlyCents: monthly && monthly > 0 ? monthly : null,
    rateClass: orNull(f.rateClass),
    coverageCents: coverage && coverage > 0 ? coverage : null,
    soldOn: orNull(f.soldOn),
    ssBenefit: f.ss === "yes" ? true : f.ss === "no" ? false : null,
    billingCycle: orNull(f.billingCycle),
    billingDay: orNull(f.billingDay),
    policyNumber: orNull(f.policyNumber),
    applicationNumber: orNull(f.applicationNumber),
    leadSource: orNull(f.leadSource),
    notes: String(f.notes ?? "").trim() ? String(f.notes).trim().slice(0, MAX_LEN.notes) : null,
    underwriting: f.underwriting === true,
    client: {
      firstName: t(f.firstName),
      lastName: t(f.lastName),
      dob: t(f.dob),
      email: f.noEmail ? "" : t(f.email),
      noEmail: f.noEmail === true,
      phone: t(f.phone),
      address: t(f.address),
    },
    beneficiaries: (f.bens ?? [])
      .filter((b) => t(b.name))
      .slice(0, MAX_LEN.bens)
      .map((b) => ({ name: t(b.name).slice(0, MAX_LEN.benName), relationship: t(b.relationship).slice(0, MAX_LEN.benRelationship) })),
  };
}

/** A new form for Log a sale: today's day, Monthly billing, one empty beneficiary row. */
export function blankForm(agentId: string, today: string): PolicyForm {
  return {
    agentId,
    carrier: "",
    product: "",
    effectiveDate: "",
    monthly: "",
    rateClass: "",
    coverage: "",
    soldOn: today,
    ss: "no",
    billingCycle: "Monthly",
    billingDay: "",
    policyNumber: "",
    applicationNumber: "",
    leadSource: "",
    notes: "",
    underwriting: false,
    firstName: "",
    lastName: "",
    dob: "",
    email: "",
    noEmail: false,
    phone: "",
    address: "",
    bens: [{ name: "", relationship: "" }],
  };
}

/** "94.58" from cents (what a money box shows when fixing), "" for none. */
export const moneyInput = (cents: number | null | undefined): string => (cents == null ? "" : (Math.round(cents) / 100).toFixed(2));
const wholeOrCents = (c: number | null) => (c == null || c === 0 ? "" : c % 100 === 0 ? String(c / 100) : moneyInput(c));

/** A stored policy as the form's values (the record's edit sections). */
export function formOf(p: PolicyRecord): PolicyForm {
  const c = p.client ?? EMPTY_CLIENT;
  return {
    agentId: p.agentId,
    carrier: p.carrier ?? "",
    product: p.product ?? "",
    effectiveDate: p.effectiveDate ?? "",
    monthly: p.monthlyCents ? moneyInput(p.monthlyCents) : "",
    rateClass: p.rateClass ?? "",
    coverage: wholeOrCents(p.coverageCents),
    soldOn: p.soldOn,
    ss: p.ssBenefit === true ? "yes" : p.ssBenefit === false ? "no" : "",
    billingCycle: p.billingCycle ?? "",
    billingDay: p.billingDay ?? "",
    policyNumber: p.policyNumber ?? "",
    applicationNumber: p.applicationNumber ?? "",
    leadSource: p.leadSource ?? "",
    notes: p.notes ?? "",
    underwriting: p.underwriting,
    firstName: c.firstName,
    lastName: c.lastName,
    dob: c.dob,
    email: c.email,
    noEmail: c.noEmail,
    phone: c.phone,
    address: c.address,
    bens: p.beneficiaries.map((b) => ({ ...b })),
  };
}

const FORM_TEXT_KEYS = ["agentId", "carrier", "product", "effectiveDate", "monthly", "rateClass", "coverage", "soldOn", "billingCycle", "billingDay", "policyNumber", "applicationNumber", "leadSource", "notes", "firstName", "lastName", "dob", "email", "phone", "address"] as const;
const isOn = (v: FormDataEntryValue | null) => v === "1" || v === "on" || v === "true" || v === "yes";

/**
 * The form from a FormData (the same names as PolicyForm; beneficiaries as repeated "benName" and
 * "benRelationship"). `present` lists the fields the FormData actually carried: a fix sends only
 * its section, and a field it did not send is left as it is.
 */
export function formFromFormData(fd: FormData): { form: PolicyForm; present: Set<FormKey> } {
  const present = new Set<FormKey>();
  const form = blankForm("", "");
  form.ss = "";
  form.billingCycle = "";
  form.soldOn = "";
  form.bens = [];
  for (const k of FORM_TEXT_KEYS) {
    if (!fd.has(k)) continue;
    present.add(k);
    form[k] = String(fd.get(k) ?? "").slice(0, k === "notes" ? MAX_LEN.notes + 50 : 400);
  }
  if (fd.has("ss")) {
    present.add("ss");
    const v = String(fd.get("ss"));
    form.ss = v === "yes" ? "yes" : v === "no" ? "no" : "";
  }
  for (const k of ["underwriting", "noEmail"] as const) {
    if (!fd.has(k)) continue;
    present.add(k);
    form[k] = isOn(fd.get(k));
  }
  if (fd.has("benName") || fd.has("bens")) {
    present.add("bens");
    const names = fd.getAll("benName").map((v) => String(v));
    const rels = fd.getAll("benRelationship").map((v) => String(v));
    form.bens = names.slice(0, 50).map((name, i) => ({ name: name.slice(0, 200), relationship: String(rels[i] ?? "").slice(0, 100) }));
  }
  return { form, present };
}

// ---- helpers the form shows -----------------------------------------------------------------------

/**
 * The billing day from the effective date, until the person picks one: the same day of the month
 * (28th at most), or for a Social Security benefit the matching Wednesday or the 3rd ("" when the
 * date matches none).
 */
export function autoBillingDay(effectiveDate: string, ss: boolean): string {
  if (!isDateKey(effectiveDate)) return "";
  const day = Number(effectiveDate.slice(8, 10));
  if (!ss) return ordinal(Math.min(28, day));
  if (day === 3) return "3rd of the month";
  const [y, m, d] = effectiveDate.split("-").map(Number);
  const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  const nth = Math.ceil(day / 7);
  return wd === 3 && nth >= 2 && nth <= 4 ? `${ordinal(nth)} Wednesday` : "";
}

/** "(248) 555-0123" as it is typed (a partial number stays partial; a leading 1 is dropped). */
export function formatPhoneInput(raw: string): string {
  const d = String(raw ?? "")
    .replace(/\D/g, "")
    .replace(/^1(?=\d{10})/, "")
    .slice(0, 10);
  if (d.length <= 3) return d.length ? `(${d}` : "";
  if (d.length <= 6) return `(${d.slice(0, 3)}) ${d.slice(3)}`;
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
}

/** Age in whole years on a day, from a date of birth (null when either is not a date). */
export function ageOn(dob: string, today: string): number | null {
  if (!isDateKey(dob) || !isDateKey(today)) return null;
  const [by, bm, bd] = dob.split("-").map(Number);
  const [ty, tm, td] = today.split("-").map(Number);
  return ty - by - (tm < bm || (tm === bm && td < bd) ? 1 : 0);
}

/** "$94.58": dollars and cents. */
export function centsText(cents: number): string {
  const c = Math.round(cents);
  return `${c < 0 ? "-" : ""}$${(Math.abs(c) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
/** "$94.58/mo" */
export const monthlyText = (cents: number): string => `${centsText(cents)}/mo`;
/** "$1,135/yr": the yearly amount in whole dollars (contract decision 17). */
export const yearlyText = (cents: number): string => `${formatDollars(cents)}/yr`;
/** "$94.58/mo ($1,135/yr)"; an import or an older sale without a monthly amount: "$1,135/yr". */
export function premiumText(monthlyCents: number | null, annualCents: number): string {
  return monthlyCents ? `${monthlyText(monthlyCents)} (${yearlyText(annualCents)})` : yearlyText(annualCents);
}
/** The annual premium a monthly one counts as on the board (monthly x 12). */
export const annualOf = (monthlyCents: number): number => Math.round(monthlyCents) * 12;

/** "Mary Johnson · Americo WL/FEX · $94.58/mo ($1,135/yr)" (withClient false: no name, for a screen that may not show it). */
export function summaryLine(p: { client?: PolicyClient | null; carrier: string | null; product: string | null; monthlyCents: number | null; premiumCents: number }, withClient = true): string {
  const name = withClient && p.client ? `${p.client.firstName} ${p.client.lastName}`.trim() : "";
  const what = [p.carrier, p.product].filter(Boolean).join(" ");
  const money = p.premiumCents ? premiumText(p.monthlyCents, p.premiumCents) : "";
  return [name, what, money].filter(Boolean).join(" · ");
}
/** "1st of each month" for a monthly day; a Social Security day as it is. */
export function billingDayText(day: string | null, cycle: string | null): string {
  if (!day) return "";
  return /^\d+(st|nd|rd|th)$/.test(day) && (cycle || "Monthly") === "Monthly" ? `${day} of each month` : day;
}
