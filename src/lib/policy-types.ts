import type { LoggedBy, SaleKind } from "./types";

/**
 * The CRM's shapes and words (0006_crm.sql; contract 2026-11-12). Browser-safe: types, constants
 * and labels only. A policy is a row of `sales`: the board's fields (who sold it, the premium, the
 * day, the carrier, the product) and the tracking fields (status, the policy's own details, the
 * client, beneficiaries, notes). Client fields are read in one server file, src/lib/policies.ts.
 */

/** Tracking only: a status never changes a total (contract decision 3). */
export const POLICY_STATUSES = ["Submitted", "Underwriting", "Approved", "Issued", "Declined", "Cancelled"] as const;
export type PolicyStatus = (typeof POLICY_STATUSES)[number];
export function isPolicyStatus(v: unknown): v is PolicyStatus {
  return typeof v === "string" && (POLICY_STATUSES as readonly string[]).includes(v);
}
/** What a policy with no status yet (an older Scorecard sale) says. */
export const NO_STATUS = "No status yet";
/** The CSS-friendly key of each status (the status pills' classes). */
export const STATUS_KEY: Record<PolicyStatus, string> = { Submitted: "submitted", Underwriting: "underwriting", Approved: "approved", Issued: "issued", Declined: "declined", Cancelled: "cancelled" };

/** Where a row came from: logged in Scorecard, an AgentSpace day total (import), or the Shortcut. */
export type PolicySource = "scorecard" | "import" | "shortcut";
export function isPolicySource(v: unknown): v is PolicySource {
  return v === "scorecard" || v === "import" || v === "shortcut";
}
/** What an imported AgentSpace day total reads as on Policies (contract decision 14). */
export const IMPORT_LABEL = "Day total from AgentSpace";

// ---- the lists in Settings (contract decision 15) ---------------------------------------------

/** Each carrier with the products it writes ("Americo: WL/FEX, TERM, IUL"). */
export type CarrierProducts = Record<string, string[]>;
export const DEFAULT_CARRIER_PRODUCTS: CarrierProducts = {
  AHL: ["WL/FEX"],
  AmAm: ["WL/FEX", "TERM"],
  Americo: ["WL/FEX", "TERM", "IUL"],
  Foresters: ["WL/FEX", "TERM"],
  Newbridge: ["WL/FEX"],
  Royal: ["WL/FEX"],
  UHL: ["WL/FEX"],
  Corebridge: ["WL/FEX", "TERM", "IUL"],
};
/** A carrier the defaults do not know writes this until Settings says otherwise. */
export const FALLBACK_PRODUCTS = ["WL/FEX"];
export const DEFAULT_RATE_CLASSES = ["Preferred", "Standard", "Graded", "Modified", "Guaranteed issue"];
export const DEFAULT_LEAD_SOURCES = ["FEX Dialer", "Inbound call", "Referral", "Facebook lead", "Mailer", "Self-generated", "Other"];
/** Fixed lists (not in Settings). */
export const BILLING_CYCLES = ["Monthly", "Quarterly", "Semi-annual", "Annual"] as const;
export const SS_BILLING_DAYS = ["2nd Wednesday", "3rd Wednesday", "4th Wednesday", "3rd of the month"] as const;

/**
 * The carriers and products for a carriers list that has no products yet (an older settings row):
 * each carrier gets the default products for its name (any case), else WL/FEX.
 */
export function carrierProductsFrom(carriers: string[]): CarrierProducts {
  const out: CarrierProducts = {};
  for (const name of carriers) {
    const known = Object.keys(DEFAULT_CARRIER_PRODUCTS).find((k) => k.toLowerCase() === name.toLowerCase());
    out[name] = [...(known ? DEFAULT_CARRIER_PRODUCTS[known] : FALLBACK_PRODUCTS)];
  }
  return out;
}

/** "1st" … "28th": the billing days of a policy not paid from a Social Security benefit. */
export function ordinal(n: number): string {
  const s = n % 100 >= 11 && n % 100 <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] || "th";
  return `${n}${s}`;
}
export const MONTH_DAYS: string[] = Array.from({ length: 28 }, (_, i) => ordinal(i + 1));
/** The billing days to offer: the Social Security days, or 1st to 28th. */
export const billingDaysFor = (ssBenefit: boolean): readonly string[] => (ssBenefit ? SS_BILLING_DAYS : MONTH_DAYS);

// ---- the record ---------------------------------------------------------------------------------

export interface PolicyClient {
  firstName: string;
  lastName: string;
  /** "YYYY-MM-DD", "" when none. */
  dob: string;
  email: string;
  noEmail: boolean;
  phone: string;
  address: string;
}
export const EMPTY_CLIENT: PolicyClient = { firstName: "", lastName: "", dob: "", email: "", noEmail: false, phone: "", address: "" };

export interface Beneficiary {
  name: string;
  relationship: string;
}

/** Everything about one policy, for a viewer the rules let see it (src/lib/policies.ts getPolicyFor). */
export interface PolicyRecord {
  id: string;
  agentId: string;
  agentName: string;
  /** The person whose own sign-in logged it (null: a shared password, the Shortcut, an import). */
  loggedByAgent: string | null;
  loggedByName: string | null;
  /** The kind of session that logged it. */
  loggedBy: LoggedBy;
  createdAt: string;
  updatedAt: string | null;
  source: PolicySource;
  kind: SaleKind;
  /** The ANNUAL premium the board counts (monthly x 12 for a policy logged in Scorecard). */
  premiumCents: number;
  /** The monthly premium (null for an import, the Shortcut and older sales). */
  monthlyCents: number | null;
  policies: number;
  carrier: string | null;
  product: string | null;
  /** The submitted date: the day it counts on the board ("YYYY-MM-DD"). */
  soldOn: string;
  status: PolicyStatus | null;
  underwriting: boolean;
  effectiveDate: string | null;
  rateClass: string | null;
  coverageCents: number | null;
  ssBenefit: boolean | null;
  billingCycle: string | null;
  billingDay: string | null;
  policyNumber: string | null;
  applicationNumber: string | null;
  leadSource: string | null;
  notes: string | null;
  /** The older one-line note (an import's marker, a Shortcut's note). */
  note: string | null;
  client: PolicyClient;
  beneficiaries: Beneficiary[];
}

/** One row of the Policies list: what the columns, the filters, the search and the CSV need. */
export interface PolicyListRow {
  id: string;
  agentId: string;
  agentName: string;
  loggedByAgent: string | null;
  createdAt: string;
  source: PolicySource;
  kind: SaleKind;
  premiumCents: number;
  monthlyCents: number | null;
  policies: number;
  carrier: string | null;
  product: string | null;
  soldOn: string;
  status: PolicyStatus | null;
  underwriting: boolean;
  effectiveDate: string | null;
  rateClass: string | null;
  coverageCents: number | null;
  ssBenefit: boolean | null;
  billingCycle: string | null;
  leadSource: string | null;
  policyNumber: string | null;
  applicationNumber: string | null;
  clientFirst: string;
  clientLast: string;
  clientEmail: string;
  clientPhone: string;
  /** The client's age today in Detroit, from their birthday (null without one); the birthday itself stays on the record. */
  age: number | null;
  beneficiaryCount: number;
}

/** True for an AgentSpace day total: one row, its policy count, no client, nothing editable (decision 14). */
export const isImportRow = (p: Pick<PolicyListRow, "source">): boolean => p.source === "import";
/** "Mary Johnson", or "Day total from AgentSpace" for an import, "" when there is no client yet. */
export function clientNameOf(p: Pick<PolicyListRow, "source" | "clientFirst" | "clientLast">): string {
  if (isImportRow(p)) return IMPORT_LABEL;
  return `${p.clientFirst} ${p.clientLast}`.trim();
}

/** One history line (sale_events), newest first on the policy page. */
export interface PolicyEvent {
  id: number;
  at: string;
  byAgent: string | null;
  /** The person's name, or "Owner password", "Team password", "Shortcut", "Someone". */
  byName: string;
  what: string;
}

// ---- the fields and who changes them (contract decision 4; rules.ts editRights) -----------------

/** The fields that count on the board: after 15 minutes only an admin changes them. */
export const BOARD_FIELDS = ["monthlyCents", "soldOn", "carrier", "product", "agentId"] as const;
/** Everything else: the seller changes them any time. */
export const TRACKING_FIELDS = ["status", "underwriting", "effectiveDate", "rateClass", "coverageCents", "ssBenefit", "billingCycle", "billingDay", "policyNumber", "applicationNumber", "leadSource", "notes", "client", "beneficiaries"] as const;
export type BoardField = (typeof BOARD_FIELDS)[number];
export type TrackingField = (typeof TRACKING_FIELDS)[number];
export type PolicyField = BoardField | TrackingField;
export const ALL_POLICY_FIELDS: PolicyField[] = [...BOARD_FIELDS, ...TRACKING_FIELDS];
/** A manager on a policy of their confirmed downline changes these (decision 4). */
export const MANAGER_FIELDS: PolicyField[] = ["status", "underwriting", "notes"];
/** Client details in the sense of decision 5: never a value in a history line, an approval or a log. */
export const CLIENT_FIELDS: PolicyField[] = ["client", "beneficiaries", "policyNumber", "applicationNumber", "notes"];

export const FIELD_LABEL: Record<PolicyField, string> = {
  agentId: "Sold by",
  monthlyCents: "Monthly premium",
  soldOn: "Submitted date",
  carrier: "Carrier",
  product: "Product",
  status: "Status",
  underwriting: "In underwriter review with the carrier",
  effectiveDate: "Policy effective date",
  rateClass: "Rate class",
  coverageCents: "Coverage amount",
  ssBenefit: "Paid from a Social Security benefit",
  billingCycle: "Billing cycle",
  billingDay: "Billing day",
  policyNumber: "Policy number",
  applicationNumber: "Application number",
  leadSource: "Lead source",
  notes: "Notes",
  client: "Client details",
  beneficiaries: "Beneficiaries",
};

/** The lines a locked field says (rules.ts editRights). */
export const LOCK = {
  board: "These count on the board. After 15 minutes, ask an admin to change them.",
  seller: "Only an admin can move a policy to someone else.",
  pastMonth: "This sale is in a past month. Ask an admin to change these.",
  none: "You can't change this policy.",
  importRow: "A day total from AgentSpace can't be changed. An admin can remove it.",
  /** For a manager on a teammate's policy: "Only Roman or an admin can change this." */
  ownerOf: (firstName: string) => `Only ${firstName || "the seller"} or an admin can change this.`,
} as const;

/** The 15 minutes a sale stays fully its logger's and seller's (fix anything, or take it back). */
export const LOCK_MINUTES = 15;

// ---- the list: columns, sort, filters (policy-filter.ts) -----------------------------------------

export type PolicyColumn = "client" | "agent" | "carrier" | "product" | "monthly" | "annual" | "coverage" | "status" | "submitted" | "effective" | "lead" | "numbers";
export interface PolicyColumnDef {
  id: PolicyColumn;
  label: string;
  /** Text columns sort A to Z first; numbers and dates biggest or newest first. */
  text?: boolean;
  /** Right-aligned (money). */
  right?: boolean;
  /** Always shown (the Columns menu cannot hide it). */
  fixed?: boolean;
  /** Only on a team's or everyone's list. */
  team?: boolean;
}
export const POLICY_COLUMNS: PolicyColumnDef[] = [
  { id: "client", label: "Client", text: true, fixed: true },
  { id: "agent", label: "Agent", text: true, team: true },
  { id: "carrier", label: "Carrier", text: true },
  { id: "product", label: "Product", text: true },
  { id: "monthly", label: "Monthly", right: true },
  { id: "annual", label: "Annual", right: true },
  { id: "coverage", label: "Coverage", right: true },
  { id: "status", label: "Status", text: true },
  { id: "submitted", label: "Submitted" },
  { id: "effective", label: "Effective" },
  { id: "lead", label: "Lead source", text: true },
  { id: "numbers", label: "Policy # / App #", text: true },
];
/** Hidden at first: your own list shows every column; a team's adds Agent, so Coverage starts hidden. */
export const DEFAULT_HIDDEN_COLUMNS: Record<"mine" | "team", PolicyColumn[]> = { mine: [], team: ["coverage"] };

export type SortDir = "asc" | "desc";
export interface PolicySort {
  by: PolicyColumn;
  dir: SortDir;
}
export const DEFAULT_SORT: PolicySort = { by: "submitted", dir: "desc" };

/** The scope tabs on Policies (rules.ts policyScopes). */
export type PolicyScope = "mine" | "team" | "all";

export type SubmittedPreset = "month" | "7d" | "custom";
export type EffectivePreset = "month" | "next" | "custom";
export type YesNo = "yes" | "no";

/** Everything the Policies page reads from its address (policy-filter.ts parseQuery). */
export interface PolicyQuery {
  scope: PolicyScope | null;
  /** A team's leader, for an admin's "A team". */
  team: string | null;
  q: string;
  status: string[];
  carrier: string[];
  product: string[];
  lead: string[];
  rate: string[];
  agent: string[];
  cycle: string[];
  sub: SubmittedPreset | null;
  subFrom: string;
  subTo: string;
  eff: EffectivePreset | null;
  effFrom: string;
  effTo: string;
  ss: YesNo | null;
  benef: YesNo | null;
  /** Needs attention: Submitted or Underwriting more than 5 days after the submitted date. */
  stale: boolean;
  /** Missing a policy number. */
  nonum: boolean;
  sort: PolicySort;
  /** How many rows show (25 at a time). */
  limit: number;
}
export const PAGE_SIZE = 25;
/** A policy still Submitted or in Underwriting this many days after it was submitted needs attention. */
export const STALE_DAYS = 5;

export type MultiFilterKey = "status" | "carrier" | "product" | "lead" | "rate" | "agent" | "cycle";
export const MULTI_FILTERS: { key: MultiFilterKey; label: string; team?: boolean; more?: boolean }[] = [
  { key: "status", label: "Status" },
  { key: "carrier", label: "Carrier" },
  { key: "product", label: "Product" },
  { key: "lead", label: "Lead source" },
  { key: "rate", label: "Rate class" },
  { key: "agent", label: "Agent", team: true },
  { key: "cycle", label: "Billing cycle", more: true },
];

export type ViewId = "all" | "attention" | "effective" | "issued" | "nonum";
export interface SavedView {
  id: ViewId;
  label: string;
  /** The filters the view sets (every other filter cleared). */
  preset: Partial<PolicyQuery>;
  title?: string;
}
export const SAVED_VIEWS: SavedView[] = [
  { id: "all", label: "All", preset: {} },
  { id: "attention", label: "Needs attention", preset: { stale: true }, title: "Submitted or in underwriting for more than 5 days" },
  { id: "effective", label: "Effective this month", preset: { eff: "month" } },
  { id: "issued", label: "Issued", preset: { status: ["Issued"] } },
  { id: "nonum", label: "Missing a policy number", preset: { nonum: true } },
];

/** The numbers Home shows for a set of people's month (policies.ts pipelineCounts): never a client. */
export interface PipelineCounts {
  total: number;
  byStatus: Record<PolicyStatus, number>;
  noStatus: number;
  /** Submitted or Underwriting more than 5 days after the submitted date. */
  needsAttention: number;
  issuedCents: number;
}
