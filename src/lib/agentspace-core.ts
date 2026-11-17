/**
 * The AgentSpace sync's pure part (browser-safe, no I/O): the shapes AgentSpace's API answers
 * with, the mapping from a deal to a Scorecard policy, who a deal's agent is on the board, and the
 * planner that compares AgentSpace's Scoreboard with what Scorecard holds. The HTTP client, the
 * run and the state live in src/lib/agentspace.ts; the writes in src/lib/policies.ts (the one file
 * that touches a policy's client columns). Nothing here logs or returns a value to a log.
 */
import type { Beneficiary } from "./policy-types";

// ---- AgentSpace's answers (only the fields the sync reads; every one may be missing) ---------------

export interface AsAgent {
  id?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  alias_name?: string | null;
  name?: string | null;
}
export interface AsStatus {
  raw?: string | null;
  code?: string | null;
  label?: string | null;
  portfolio_bucket?: string | null;
  attention_bucket?: string | null;
}
export interface AsNamed {
  id?: string | null;
  name?: string | null;
  display_name?: string | null;
}
/** One deal as client search lists it (a summary: it does not say whether the deal counts as production). */
export interface AsDealSummary {
  id: string;
  status?: AsStatus | null;
  annual_premium?: string | number | null;
  submission_date?: string | null;
  agent?: AsAgent | null;
  created_at?: string | null;
  updated_at?: string | null;
}
export interface AsClientHit {
  id?: string;
  deals?: AsDealSummary[] | null;
}
export interface AsClientPage {
  count?: number;
  next?: string | null;
  results?: AsClientHit[];
}
/** A deal in full (GET deals/{id}/). */
export interface AsDeal {
  id: string;
  client?: {
    first_name?: string | null;
    last_name?: string | null;
    email?: string | null;
    phone?: string | null;
    address?: string | null;
    date_of_birth?: string | null;
  } | null;
  agent?: AsAgent | null;
  carrier?: AsNamed | null;
  product?: AsNamed | null;
  policy_number?: string | null;
  application_number?: string | null;
  status?: AsStatus | null;
  annual_premium?: string | number | null;
  monthly_premium?: string | number | null;
  face_value?: string | number | null;
  policy_effective_date?: string | null;
  submission_date?: string | null;
  billing_cycle?: string | null;
  billing_day_of_month?: string | null;
  billing_weekday?: string | null;
  lead_source?: string | null;
  rate_class?: string | null;
  notes?: string | null;
  post_a_deal?: boolean | null;
  beneficiaries?: { name?: string | null; first_name?: string | null; last_name?: string | null; relationship?: string | null }[] | null;
  created_at?: string | null;
  updated_at?: string | null;
}
export interface AsScoreRow {
  agentId?: string | null;
  entityId?: string | null;
  name?: string | null;
  rowType?: string | null;
  total?: number | string | null;
  dealCount?: number | null;
  dailyBreakdown?: Record<string, number | string> | null;
}

// ---- small helpers -------------------------------------------------------------------------------------

/** A name for comparing: case, runs of spaces, accents and the kind of apostrophe do not matter. */
export function normName(input: string | null | undefined): string {
  return (input ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[‘’ʼ`´]/g, "'")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** A name as the board spells it when AgentSpace's is all one case ("troy t" becomes "Troy T"). */
export function tidyAgentName(input: string): string {
  const name = input.replace(/\s+/g, " ").trim().slice(0, 60);
  if (name !== name.toLowerCase() && name !== name.toUpperCase()) return name;
  return name.replace(/(^|[\s'-])(\p{L})/gu, (_m, a: string, b: string) => `${a}${b.toUpperCase()}`).replace(/(\p{L})(\p{L}*)/gu, (_m, a: string, b: string) => a + b.toLowerCase()).replace(/(^|[\s'-])(\p{L})/gu, (_m, a: string, b: string) => `${a}${b.toUpperCase()}`);
}

const text = (v: unknown, max: number): string | null => {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t ? t.slice(0, max) : null;
};
/** Dollars as AgentSpace writes them ("1234.50" or 1234.5) to cents; null when it is not an amount. */
export function centsOf(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/[$,\s]/g, ""));
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}
const dateOf = (v: unknown): string | null => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v) && !Number.isNaN(Date.parse(v.slice(0, 10))) ? v.slice(0, 10) : null);
/** "(586) 555-0100" from ten digits (a leading 1 dropped); anything else as AgentSpace has it. */
export function phoneText(p: unknown): string | null {
  if (typeof p !== "string") return null;
  let d = p.replace(/\D/g, "");
  if (d.length === 11 && d[0] === "1") d = d.slice(1);
  return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : text(p, 30);
}

// ---- status ------------------------------------------------------------------------------------------

export type SyncStatus = "Submitted" | "Underwriting" | "Approved" | "Issued" | "Declined" | "Cancelled";

/**
 * AgentSpace's status code to Scorecard's six (the one-time copy's four, and the codes a deal moves
 * to later). A code nobody has seen yet falls back on the portfolio bucket the deal sits in; with
 * nothing to go on it is null, which an update leaves as it is and an insert reads as Submitted.
 */
export function mapStatus(status: AsStatus | null | undefined): SyncStatus | null {
  const code = (status?.code ?? "").toLowerCase().replace(/[\s-]+/g, "_");
  const direct: Record<string, SyncStatus> = { pending: "Submitted", underwriter_review: "Underwriting", issued_not_in_force: "Approved", active: "Issued", in_force: "Issued" };
  if (direct[code]) return direct[code];
  const hay = `${code} ${(status?.raw ?? "").toLowerCase()} ${(status?.label ?? "").toLowerCase()}`;
  if (/declin|reject|postpone|not_?approved/.test(hay)) return "Declined";
  if (/not_?taken|withdraw|lapse|cancel|closed|terminat|surrender|expire|rescind|non_?pay/.test(hay)) return "Cancelled";
  if (/underwrit/.test(hay)) return "Underwriting";
  if (/issued|in_?force|active/.test(hay)) return /not_?in_?force/.test(hay) ? "Approved" : "Issued";
  if (/pending|submit/.test(hay)) return "Submitted";
  const bucket = (status?.portfolio_bucket ?? "").toLowerCase();
  if (bucket === "pipeline") return "Submitted";
  if (bucket === "active" || bucket === "in_force") return "Issued";
  if (bucket === "lapsed" || bucket === "closed" || bucket === "cancelled") return "Cancelled";
  return null;
}

// ---- the policy a deal makes ---------------------------------------------------------------------------

/**
 * What one AgentSpace deal looks like as a Scorecard policy (the one-time copy's mapping): the
 * board's fields and the tracking fields, and the client. Held in memory only for the write in
 * src/lib/policies.ts; never logged.
 */
export interface SyncedPolicy {
  dealId: string;
  asAgentId: string;
  asAgentName: string;
  soldOn: string;
  /** The annual premium: what the board counts. */
  premiumCents: number;
  monthlyCents: number | null;
  carrier: string | null;
  product: string | null;
  /** Null: the status code is one the mapping does not know (an update keeps the status it has). */
  status: SyncStatus | null;
  effectiveDate: string | null;
  rateClass: string | null;
  coverageCents: number | null;
  ssBenefit: boolean;
  billingCycle: string | null;
  billingDay: string | null;
  policyNumber: string | null;
  applicationNumber: string | null;
  leadSource: string | null;
  notes: string | null;
  clientFirst: string | null;
  clientLast: string | null;
  clientDob: string | null;
  clientEmail: string | null;
  clientPhone: string | null;
  clientAddress: string | null;
  beneficiaries: Beneficiary[];
  /** AgentSpace's own created_at and updated_at (ISO instants). */
  createdAt: string | null;
  updatedAt: string | null;
}

const CYCLES: [RegExp, string][] = [
  [/^month/i, "Monthly"],
  [/^quarter/i, "Quarterly"],
  [/semi/i, "Semi-annual"],
  [/^(annual|year)/i, "Annual"],
];
function cycleOf(v: unknown): string | null {
  const t = text(v, 40);
  if (!t) return null;
  for (const [re, label] of CYCLES) if (re.test(t.replace(/_/g, "-"))) return label;
  return t.charAt(0).toUpperCase() + t.slice(1).toLowerCase();
}

/** Why a deal cannot become a policy (never a value). */
export type Unmappable = "no_agent" | "no_date" | "no_premium";

/** The policy a deal makes, or why it cannot (a deal with no agent, no submitted day or no premium above $0 is never copied). */
export function dealToPolicy(d: AsDeal): { ok: true; policy: SyncedPolicy } | { ok: false; reason: Unmappable } {
  const asAgentId = text(d.agent?.id, 64);
  const asAgentName = text(d.agent?.name, 80) ?? text(`${d.agent?.first_name ?? ""} ${d.agent?.last_name ?? ""}`, 80);
  if (!asAgentId || !asAgentName) return { ok: false, reason: "no_agent" };
  const soldOn = dateOf(d.submission_date);
  if (!soldOn) return { ok: false, reason: "no_date" };
  const premiumCents = centsOf(d.annual_premium);
  if (!premiumCents || premiumCents > 1_000_000_000) return { ok: false, reason: "no_premium" };
  const monthly = centsOf(d.monthly_premium);
  const weekday = text(d.billing_weekday, 20);
  const dom = text(d.billing_day_of_month, 20);
  const c = d.client ?? {};
  const coverage = centsOf(d.face_value);
  const bens: Beneficiary[] = (d.beneficiaries ?? [])
    .map((b) => ({ name: (text(b.name, 80) ?? text(`${b.first_name ?? ""} ${b.last_name ?? ""}`, 80)) || "", relationship: text(b.relationship, 40) ?? "" }))
    .filter((b) => b.name)
    .slice(0, 10);
  const email = text(c.email, 120);
  return {
    ok: true,
    policy: {
      dealId: String(d.id),
      asAgentId,
      asAgentName,
      soldOn,
      premiumCents,
      monthlyCents: monthly && monthly > 0 && monthly <= 100_000_000 ? monthly : null,
      carrier: text(d.carrier?.display_name, 40) ?? text(d.carrier?.name, 40),
      product: text(d.product?.name, 40),
      status: mapStatus(d.status),
      effectiveDate: dateOf(d.policy_effective_date),
      rateClass: text(d.rate_class, 40),
      coverageCents: coverage != null && coverage <= 100_000_000_000 ? coverage : null,
      ssBenefit: !!weekday,
      billingCycle: cycleOf(d.billing_cycle),
      billingDay: weekday ? `${dom ?? ""} ${weekday}`.trim() : dom,
      policyNumber: text(d.policy_number, 60),
      applicationNumber: text(d.application_number, 60),
      leadSource: text(d.lead_source, 60),
      notes: text(d.notes, 2000),
      clientFirst: text(c.first_name, 60),
      clientLast: text(c.last_name, 60),
      clientDob: dateOf(c.date_of_birth),
      clientEmail: email,
      clientPhone: phoneText(c.phone),
      clientAddress: text(c.address, 200),
      beneficiaries: bens,
      createdAt: text(d.created_at, 40),
      updatedAt: text(d.updated_at, 40),
    },
  };
}

/** Milliseconds of an ISO instant (0 when it is not one), for comparing two instants whatever their spelling. */
export const instantMs = (iso: string | null | undefined): number => {
  const ms = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(ms) ? ms : 0;
};

// ---- who a deal's agent is on the board -------------------------------------------------------------------

export interface BoardPerson {
  id: string;
  name: string;
  active: boolean;
}

function editDistanceAtMostOne(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i++;
      j++;
      continue;
    }
    if (++edits > 1) return false;
    if (a.length === b.length) {
      // A swap of two neighbours is one edit too.
      if (a[i + 1] === b[j] && a[i] === b[j + 1] && a.slice(i + 2) === b.slice(j + 2)) return true;
      i++;
      j++;
    } else if (a.length > b.length) i++;
    else j++;
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

export interface AgentLookup {
  /** AgentSpace's agent id to the board person's id, as the sync remembered it. */
  map: Record<string, string>;
  /** A name AgentSpace spells one way and the board another: normalized AgentSpace name to the board's name. */
  aliases: Record<string, string>;
}

/**
 * The board person for an AgentSpace agent, and how it was found: the remembered link, the same
 * name (case, spaces, apostrophes ignored; someone on the board first), an alias the state holds,
 * or the one person whose name differs by a single letter (AgentSpace's "Dana Hartmann" for the board's
 * "Dana Hartman"; at least seven letters, and only when that person is the only one so close). Null when
 * nobody fits: the sync adds the person only when a deal needs them.
 */
export function findPerson(asId: string, asName: string, people: BoardPerson[], lookup: AgentLookup): { person: BoardPerson; how: "link" | "name" | "alias" | "spelling" } | null {
  const byId = new Map(people.map((p) => [p.id, p]));
  const linked = lookup.map[asId] ? byId.get(lookup.map[asId]) : undefined;
  if (linked) return { person: linked, how: "link" };
  const want = normName(asName);
  if (!want) return null;
  const firstOf = (list: BoardPerson[]) => list.find((p) => p.active) ?? list[0];
  const same = people.filter((p) => normName(p.name) === want);
  if (same.length) return { person: firstOf(same)!, how: "name" };
  const alias = lookup.aliases[want];
  if (alias) {
    const named = people.filter((p) => normName(p.name) === normName(alias));
    if (named.length) return { person: firstOf(named)!, how: "alias" };
  }
  if (want.length >= 7) {
    const close = people.filter((p) => normName(p.name).length >= 7 && editDistanceAtMostOne(normName(p.name), want));
    if (close.length === 1) return { person: close[0], how: "spelling" };
  }
  return null;
}

// ---- the Scoreboard against the board ------------------------------------------------------------------------

/** One agent-day of AgentSpace's production, in cents. */
export interface Cell {
  asAgentId: string;
  agentName: string;
  day: string;
  cents: number;
}

/** AgentSpace's Scoreboard as cells: one per agent per day with production (producer rows only, no zeros). */
export function cellsOf(rows: AsScoreRow[], from: string, to: string): Cell[] {
  const out: Cell[] = [];
  for (const r of rows) {
    if (r.rowType && r.rowType !== "producer") continue;
    const asAgentId = text(r.agentId ?? r.entityId, 64);
    if (!asAgentId) continue;
    for (const [day, amount] of Object.entries(r.dailyBreakdown ?? {})) {
      if (!dateOf(day) || day < from || day > to) continue;
      const cents = centsOf(amount) ?? 0;
      if (cents > 0) out.push({ asAgentId, agentName: text(r.name, 80) ?? "", day, cents });
    }
  }
  return out;
}

/** A policy Scorecard holds that came from a deal (what the comparison adds up). */
export interface LinkedPolicy {
  saleId: string;
  dealId: string;
  agentId: string;
  day: string;
  cents: number;
  deleted: boolean;
}

export interface CellDiff {
  /** "<AgentSpace agent id>|<day>". */
  key: string;
  asAgentId: string;
  agentName: string;
  day: string;
  asCents: number;
  scCents: number;
  /** AgentSpace minus Scorecard: above 0, deals are missing; below 0, Scorecard holds more than AgentSpace does. */
  delta: number;
}

/**
 * Each cell where AgentSpace and Scorecard disagree. Scorecard's side is the sum of the policies
 * linked to a deal for that person and day (live ones, plus deals an admin took off on purpose,
 * `keptOff`, so a removal that stays does not look like a missing deal). `asIdOf` says which
 * AgentSpace agent a board person is (null: not linked yet, so their rows sit in a cell of their own and AgentSpace's side shows as missing).
 */
export function diffCells(cells: Cell[], linked: LinkedPolicy[], keptOff: { agentId: string; day: string; cents: number }[], asIdOf: (scAgentId: string) => string | null): CellDiff[] {
  const sc = new Map<string, number>();
  const add = (agentId: string, day: string, cents: number) => {
    const asId = asIdOf(agentId);
    const k = `${asId ?? `sc:${agentId}`}|${day}`;
    sc.set(k, (sc.get(k) ?? 0) + cents);
  };
  for (const l of linked) if (!l.deleted) add(l.agentId, l.day, l.cents);
  for (const k of keptOff) add(k.agentId, k.day, k.cents);
  const as = new Map<string, Cell>();
  for (const c of cells) as.set(`${c.asAgentId}|${c.day}`, c);
  const out: CellDiff[] = [];
  const keys = new Set([...as.keys(), ...sc.keys()]);
  for (const key of keys) {
    const cell = as.get(key);
    const asCents = cell?.cents ?? 0;
    const scCents = sc.get(key) ?? 0;
    if (asCents === scCents) continue;
    const [asAgentId, day] = key.split("|");
    out.push({ key, asAgentId, agentName: cell?.agentName ?? "", day, asCents, scCents, delta: asCents - scCents });
  }
  return out.sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : a.key < b.key ? -1 : 1));
}

// ---- finding the deals Scoreboard says are missing -------------------------------------------------------------

/** The common two-letter name fragments first (they match the most clients), then every other pair, then the three-digit phone prefixes. */
const COMMON_PAIRS = ["co", "an", "ar", "er", "in", "on", "en", "el", "al", "la", "ra", "ri", "ro", "ma", "mi", "ch", "th", "sh", "ie", "ia", "ey", "le", "ne", "na", "re", "ll", "st", "is", "or", "ha", "ja", "da", "de", "ke", "te", "ta", "ca", "ki", "li", "lo", "et", "ol", "ul", "un", "am", "om", "im", "em", "ad", "ed", "id", "od", "ud", "ay", "oy", "uy"];
let sequence: string[] | null = null;
/** Every query the finder walks, in order: 54 common pairs, the other 622 pairs, then 000 to 999. */
export function searchQueries(): string[] {
  if (sequence) return sequence;
  const letters = "abcdefghijklmnopqrstuvwxyz";
  const seen = new Set<string>();
  const out: string[] = [];
  const push = (q: string) => {
    if (!seen.has(q)) {
      seen.add(q);
      out.push(q);
    }
  };
  for (const q of COMMON_PAIRS) push(q);
  for (const a of letters) for (const b of letters) push(a + b);
  for (let i = 0; i < 1000; i++) push(String(i).padStart(3, "0"));
  sequence = out;
  return out;
}

/** What is still missing, per cell: the cells the finder is looking for deals in (AgentSpace has more than Scorecard). */
export function needsOf(diffs: CellDiff[]): Map<string, CellDiff> {
  const out = new Map<string, CellDiff>();
  for (const d of diffs) if (d.delta > 0 && d.asAgentId && !d.asAgentId.startsWith("sc:")) out.set(d.key, d);
  return out;
}

/** The key of the cell a search-result deal sits in. */
export const cellKeyOf = (d: { agent?: AsAgent | null; submission_date?: string | null }): string | null => {
  const id = text(d.agent?.id, 64);
  const day = dateOf(d.submission_date);
  return id && day ? `${id}|${day}` : null;
};

/**
 * Whether a search-result deal is worth a look: it sits in a cell that is missing something, it is
 * not one the sync already holds, and it is not one it saw before as not counting and unchanged.
 */
export function worthFetching(d: AsDealSummary, needs: Map<string, CellDiff>, held: Set<string>, nonProd: Record<string, string>): boolean {
  if (!d.id || held.has(d.id)) return false;
  const key = cellKeyOf(d);
  if (!key || !needs.has(key)) return false;
  const seen = nonProd[d.id];
  if (seen !== undefined && seen === (d.updated_at ?? "")) return false;
  return true;
}

/** Which of an unlinked Scorecard row's own facts a found deal is compared with (client columns stay inside policies.ts). */
export interface MatchFacts {
  agentId: string;
  soldOn: string;
  premiumCents: number;
  clientFirst: string | null;
  clientLast: string | null;
}
/**
 * Whether an unlinked Scorecard row is the same sale as a found deal: the same seller, submitted
 * day and annual premium, and the same client first and last name (case and spacing ignored). A
 * row with no client name at all (the Shortcut's) matches on the other three.
 */
export function sameSale(row: MatchFacts, deal: MatchFacts): boolean {
  if (row.agentId !== deal.agentId || row.soldOn !== deal.soldOn || row.premiumCents !== deal.premiumCents) return false;
  const rf = normName(row.clientFirst);
  const rl = normName(row.clientLast);
  if (!rf && !rl) return true;
  return rf === normName(deal.clientFirst) && rl === normName(deal.clientLast);
}

/** How many of the newest new deals may celebrate on the TV in one run (a backlog would otherwise play for minutes). */
export const MAX_CELEBRATIONS = 5;
/** A deal AgentSpace created within this long ago counts as new on the TV. */
export const FRESH_MS = 24 * 3_600_000;

// ---- what a run reports (browser-safe: the Settings card shows these) ---------------------------------------------

export type ErrorClass = "key_rejected" | "rate_limited" | "server" | "network" | "bad_request" | "database" | "error";

export interface RunCounts {
  /** Agent-days AgentSpace's Scoreboard shows, and how many differed from Scorecard when the run began. */
  cells: number;
  differing: number;
  /** Policies already here that the run linked to their deal. */
  linked: number;
  inserted: number;
  /** Linked policies whose deal changed, and how many deals the run looked at. */
  updated: number;
  checked: number;
  removed: number;
  revived: number;
  newAgents: number;
  /** Deals that could not become a policy (no agent, no day or no premium). */
  skipped: number;
  calls: number;
  ms: number;
  /** "budget": the run ran out of time or calls; "rate": AgentSpace asked it to slow down. Either way it saved where it was and goes on at its next turn. */
  stopped: "budget" | "rate" | null;
}
export interface Unresolved {
  agent: string;
  day: string;
  asCents: number;
  scCents: number;
}

export interface SyncCard {
  /** The server's clock when the card was read (the page shows "2 minutes ago" from it). */
  nowMs: number;
  connected: boolean;
  lastOkAt: string | null;
  lastRunAt: string | null;
  errorClass: ErrorClass | null;
  running: boolean;
  linked: number;
  counts: RunCounts | null;
  unresolved: Unresolved[];
  unresolvedTotal: number;
  newAgents: { name: string; at: string }[];
}

/** The one line the card and the route say for an error class. */
export const SLOW_DOWN_LINE = "AgentSpace asked us to slow down. It goes on at the next run.";
export const ERROR_LINE: Record<ErrorClass, string> = {
  key_rejected: "AgentSpace did not accept the key. Make a new agency key in AgentSpace and replace AGENTSPACE_API_KEY in Vercel.",
  rate_limited: "AgentSpace asked us to slow down. The next run tries again.",
  server: "AgentSpace did not answer. The next run tries again.",
  network: "Could not reach AgentSpace. The next run tries again.",
  bad_request: "AgentSpace refused a request. The next run tries again.",
  database: "The database did not answer. The next run tries again.",
  error: "The last run did not finish. The next run tries again.",
};
