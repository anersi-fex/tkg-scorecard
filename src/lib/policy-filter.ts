import { addDays, addMonths, daysInMonth, isDateKey } from "./month";
import {
  BILLING_CYCLES,
  DEFAULT_SORT,
  IMPORT_LABEL,
  MULTI_FILTERS,
  PAGE_SIZE,
  POLICY_COLUMNS,
  POLICY_STATUSES,
  SAVED_VIEWS,
  STALE_DAYS,
  clientNameOf,
  isImportRow,
  type CarrierProducts,
  type MultiFilterKey,
  type PolicyColumn,
  type PolicyListRow,
  type PolicyQuery,
  type PolicyScope,
  type PolicySort,
  type PolicyStatus,
  type SavedView,
  type SortDir,
  type ViewId,
} from "./policy-types";

/**
 * The Policies list (the demo's screens/policies.js, ported): the query in the address, search,
 * filters, sort, status counts, saved views and the CSV. Pure and browser-safe: it works only on
 * the rows src/lib/policies.ts already let this viewer see, so nothing here decides who sees what.
 */

/** What a date preset needs: today in Detroit ("YYYY-MM-DD"). */
export interface FilterContext {
  today: string;
}

type Params = URLSearchParams | Record<string, string | string[] | undefined> | null | undefined;

function values(params: Params, key: string): string[] {
  if (!params) return [];
  const raw = params instanceof URLSearchParams ? params.getAll(key) : ([] as string[]).concat(params[key] ?? []);
  // A value may also be a comma-joined list (queryToParams writes them that way). Carriers and
  // products never hold a comma (Settings splits on them).
  return raw
    .flatMap((v) => String(v).split(","))
    .map((v) => v.trim().slice(0, 80))
    .filter(Boolean)
    .filter((v, i, all) => all.indexOf(v) === i)
    .slice(0, 50);
}
const one = (params: Params, key: string): string => values(params, key)[0] ?? "";
/** The first value as typed (the search box: commas and spaces kept). */
function rawOne(params: Params, key: string): string {
  if (!params) return "";
  const v = params instanceof URLSearchParams ? params.get(key) : ([] as string[]).concat(params[key] ?? [])[0];
  return typeof v === "string" ? v : "";
}
const pick = <T extends string>(v: string, ok: readonly T[]): T | null => ((ok as readonly string[]).includes(v) ? (v as T) : null);
const dateOr = (v: string) => (isDateKey(v) ? v : "");
const flag = (v: string) => v === "1" || v === "true" || v === "yes" || v === "on";

const SORT_COLUMNS = POLICY_COLUMNS.map((c) => c.id);
/** The empty query: everything shown, newest submitted first, 25 rows. */
export const EMPTY_QUERY: PolicyQuery = {
  scope: null,
  team: null,
  q: "",
  status: [],
  carrier: [],
  product: [],
  lead: [],
  rate: [],
  agent: [],
  cycle: [],
  sub: null,
  subFrom: "",
  subTo: "",
  eff: null,
  effFrom: "",
  effTo: "",
  ss: null,
  benef: null,
  stale: false,
  nonum: false,
  sort: DEFAULT_SORT,
  limit: PAGE_SIZE,
};

/**
 * The query from a page's search params (Next's searchParams object or URLSearchParams). Anything
 * that is not one of the choices is dropped; nothing here is trusted for who sees what.
 */
export function parseQuery(params: Params): PolicyQuery {
  const by = one(params, "sort");
  const dir = one(params, "dir");
  const sort: PolicySort = pick(by, SORT_COLUMNS) && (dir === "asc" || dir === "desc") ? { by: by as PolicyColumn, dir } : DEFAULT_SORT;
  const limit = Math.floor(Number(one(params, "limit")));
  const team = one(params, "team");
  return {
    scope: pick(one(params, "scope"), ["mine", "team", "all"] as const),
    team: /^[0-9a-f-]{36}$/i.test(team) ? team : null,
    q: rawOne(params, "q").slice(0, 80),
    status: values(params, "status").filter((s) => (POLICY_STATUSES as readonly string[]).includes(s)),
    carrier: values(params, "carrier"),
    product: values(params, "product"),
    lead: values(params, "lead"),
    rate: values(params, "rate"),
    agent: values(params, "agent").filter((a) => /^[0-9a-f-]{36}$/i.test(a)),
    cycle: values(params, "cycle"),
    sub: pick(one(params, "sub"), ["month", "7d", "custom"] as const),
    subFrom: dateOr(one(params, "subFrom")),
    subTo: dateOr(one(params, "subTo")),
    eff: pick(one(params, "eff"), ["month", "next", "custom"] as const),
    effFrom: dateOr(one(params, "effFrom")),
    effTo: dateOr(one(params, "effTo")),
    ss: pick(one(params, "ss"), ["yes", "no"] as const),
    benef: pick(one(params, "benef"), ["yes", "no"] as const),
    stale: flag(one(params, "stale")),
    nonum: flag(one(params, "nonum")),
    sort,
    limit: Number.isFinite(limit) && limit >= PAGE_SIZE ? Math.min(limit, 100_000) : PAGE_SIZE,
  };
}

/** The address for a query: only what differs from the empty query (lists comma-joined). */
export function queryToParams(q: Partial<PolicyQuery>): URLSearchParams {
  const full = { ...EMPTY_QUERY, ...q };
  const out = new URLSearchParams();
  if (full.scope) out.set("scope", full.scope);
  if (full.team) out.set("team", full.team);
  if (full.q.trim()) out.set("q", full.q);
  for (const f of MULTI_FILTERS) if (full[f.key].length) out.set(f.key, full[f.key].join(","));
  for (const k of ["sub", "subFrom", "subTo", "eff", "effFrom", "effTo", "ss", "benef"] as const) if (full[k]) out.set(k, String(full[k]));
  if (full.stale) out.set("stale", "1");
  if (full.nonum) out.set("nonum", "1");
  if (full.sort.by !== DEFAULT_SORT.by || full.sort.dir !== DEFAULT_SORT.dir) {
    out.set("sort", full.sort.by);
    out.set("dir", full.sort.dir);
  }
  if (full.limit !== PAGE_SIZE) out.set("limit", String(full.limit));
  return out;
}

// ---- dates ---------------------------------------------------------------------------------------

function monthRange(key: string): { from: string; to: string } {
  const [y, m] = key.split("-").map(Number);
  return { from: `${key}-01`, to: `${key}-${String(daysInMonth(y, m)).padStart(2, "0")}` };
}
/** The range a date filter covers ("" for an open end), or null when it is off. */
export function dateRange(which: "sub" | "eff", q: PolicyQuery, ctx: FilterContext): { from: string; to: string } | null {
  const preset = which === "sub" ? q.sub : q.eff;
  if (!preset) return null;
  const month = ctx.today.slice(0, 7);
  if (preset === "month") return monthRange(month);
  if (preset === "next") return monthRange(addMonths(month, 1));
  if (preset === "7d") return { from: addDays(ctx.today, -6), to: ctx.today };
  const from = which === "sub" ? q.subFrom : q.effFrom;
  const to = which === "sub" ? q.subTo : q.effTo;
  return from || to ? { from, to } : null;
}

/** Whole days from one "YYYY-MM-DD" to another. */
function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}
/** Needs attention: still Submitted or in Underwriting more than 5 days after the submitted date. */
export function isStale(p: Pick<PolicyListRow, "status" | "soldOn">, today: string): boolean {
  return (p.status === "Submitted" || p.status === "Underwriting") && daysBetween(p.soldOn, today) > STALE_DAYS;
}

// ---- filters -------------------------------------------------------------------------------------

const MULTI_GET: Record<MultiFilterKey, (p: PolicyListRow) => string | null> = {
  status: (p) => p.status,
  carrier: (p) => p.carrier,
  product: (p) => p.product,
  lead: (p) => p.leadSource,
  rate: (p) => p.rateClass,
  agent: (p) => p.agentId,
  cycle: (p) => p.billingCycle,
};
export type FilterKey = MultiFilterKey | "sub" | "eff" | "ss" | "benef" | "stale" | "nonum";

/** Does a row pass every filter (but `skip`, for a facet's own counts)? The search is separate. */
export function passes(p: PolicyListRow, q: PolicyQuery, ctx: FilterContext, skip?: FilterKey): boolean {
  for (const f of MULTI_FILTERS) {
    if (f.key === skip) continue;
    const want = q[f.key];
    if (want.length && !want.includes(MULTI_GET[f.key](p) ?? "")) return false;
  }
  for (const which of ["sub", "eff"] as const) {
    if (which === skip) continue;
    const r = dateRange(which, q, ctx);
    if (!r) continue;
    const v = (which === "sub" ? p.soldOn : p.effectiveDate) ?? "";
    if (!v || (r.from && v < r.from) || (r.to && v > r.to)) return false;
  }
  if (skip !== "ss" && q.ss && (q.ss === "yes") !== (p.ssBenefit === true)) return false;
  if (skip !== "benef" && q.benef && (q.benef === "yes") !== p.beneficiaryCount > 0) return false;
  if (skip !== "stale" && q.stale && !isStale(p, ctx.today)) return false;
  // An AgentSpace day total has no numbers to miss.
  if (skip !== "nonum" && q.nonum && (p.policyNumber || isImportRow(p))) return false;
  return true;
}

/** How many filter groups are on (the phone's "Filters (2)"). */
export function activeFilterCount(q: PolicyQuery): number {
  let n = 0;
  for (const f of MULTI_FILTERS) if (q[f.key].length) n++;
  for (const k of ["sub", "eff", "ss", "benef"] as const) if (q[k]) n++;
  if (q.stale) n++;
  if (q.nonum) n++;
  return n;
}

/** The query with every filter cleared (search, scope, team and sort kept). */
export function clearFilters(q: PolicyQuery): PolicyQuery {
  return { ...EMPTY_QUERY, scope: q.scope, team: q.team, q: q.q, sort: q.sort, limit: PAGE_SIZE };
}

// ---- search ---------------------------------------------------------------------------------------

/** Case- and accent-insensitive text ("José" reads "jose"). */
export const norm = (s: string | null | undefined): string =>
  String(s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
const digits = (s: string | null | undefined) => String(s ?? "").replace(/\D/g, "");
export function searchWords(q: string): string[] {
  return norm(q).trim().split(/\s+/).filter(Boolean).slice(0, 8);
}
/**
 * Every typed word must match somewhere: the client's name, email, phone (by its digits, 3 or
 * more), the policy or application number, and (withAgent: a manager's or an admin's list) the
 * seller's name. An import row matches its label.
 */
export function matchesSearch(p: PolicyListRow, words: string[], withAgent: boolean): boolean {
  if (!words.length) return true;
  const hay = norm([p.clientFirst, p.clientLast, `${p.clientFirst} ${p.clientLast}`, p.clientEmail, p.clientPhone, p.policyNumber, p.applicationNumber, withAgent ? p.agentName : "", isImportRow(p) ? IMPORT_LABEL : ""].join("  "));
  const dhay = [digits(p.clientPhone), digits(p.policyNumber), digits(p.applicationNumber)].join("|");
  return words.every((w) => {
    if (hay.includes(w)) return true;
    const bare = w.replace(/[\s().+-]/g, "");
    return bare.length >= 3 && /^\d+$/.test(bare) && dhay.includes(bare);
  });
}

// ---- sort -----------------------------------------------------------------------------------------

const STATUS_ORDER = (s: PolicyStatus | null) => (s ? POLICY_STATUSES.indexOf(s) : null);
const SORT_KEY: Record<PolicyColumn, (p: PolicyListRow) => string | number | null> = {
  client: (p) => clientNameOf(p) || null,
  agent: (p) => p.agentName,
  carrier: (p) => p.carrier || null,
  product: (p) => p.product || null,
  monthly: (p) => p.monthlyCents,
  annual: (p) => p.premiumCents,
  coverage: (p) => p.coverageCents || null,
  status: (p) => STATUS_ORDER(p.status),
  submitted: (p) => `${p.soldOn}|${p.createdAt}`,
  effective: (p) => p.effectiveDate || null,
  lead: (p) => p.leadSource || null,
  numbers: (p) => p.policyNumber || p.applicationNumber || null,
};

/** A stable sort; text compares by locale (case- and accent-insensitive); an empty value is always last. */
function sortBy<T>(rows: T[], key: (r: T) => string | number | null, dir: SortDir): T[] {
  const m = dir === "asc" ? 1 : -1;
  return rows
    .map((r, i) => [r, key(r), i] as const)
    .sort((a, b) => {
      const x = a[1];
      const y = b[1];
      let c = 0;
      if (x == null && y != null) c = 1;
      else if (y == null && x != null) c = -1;
      else if (x == null || y == null) c = 0;
      else if (typeof x === "string" || typeof y === "string") c = String(x).localeCompare(String(y), "en", { sensitivity: "base" }) * m;
      else c = (x - y) * m;
      return c || a[2] - b[2];
    })
    .map((t) => t[0]);
}

/** The rows in a sort's order (newest submitted first underneath, so ties keep that order). */
export function sortRows(rows: PolicyListRow[], sort: PolicySort): PolicyListRow[] {
  const byDefault = sortBy(rows, SORT_KEY.submitted, "desc");
  if (sort.by === "submitted" && sort.dir === "desc") return byDefault;
  return sortBy(byDefault, SORT_KEY[sort.by], sort.dir);
}

/** A click on a column: text columns start A to Z, numbers and dates biggest or newest first; a third click goes back to the default. */
export function nextSort(cur: PolicySort, col: PolicyColumn): PolicySort {
  const def = POLICY_COLUMNS.find((c) => c.id === col);
  const first: SortDir = def?.text ? "asc" : "desc";
  if (cur.by !== col) return { by: col, dir: first };
  if (cur.dir === first) return { by: col, dir: first === "asc" ? "desc" : "asc" };
  return DEFAULT_SORT;
}

// ---- the whole list ------------------------------------------------------------------------------

export interface ListResult {
  /** The rows the search leaves (before the filters): the counts are over these. */
  searched: PolicyListRow[];
  /** Searched, filtered and sorted. */
  rows: PolicyListRow[];
  /** The first `limit` of them (what the page shows). */
  shown: PolicyListRow[];
  words: string[];
}
/**
 * The list for a query. `withAgent`: the seller's name is searched too (a manager's or an admin's
 * list); the Agent filter applies only on a team's or everyone's list.
 */
export function applyQuery(base: PolicyListRow[], q: PolicyQuery, ctx: FilterContext, opts: { withAgent: boolean; scope?: PolicyScope }): ListResult {
  const words = searchWords(q.q);
  const searched = words.length ? base.filter((p) => matchesSearch(p, words, opts.withAgent)) : base;
  const query = opts.scope === "mine" ? { ...q, agent: [] } : q;
  const rows = sortRows(
    searched.filter((p) => passes(p, query, ctx)),
    q.sort,
  );
  return { searched, rows, shown: rows.slice(0, q.limit), words };
}

/** The status strip: each status's count over the searched rows with every other filter on. */
export function statusCounts(searched: PolicyListRow[], q: PolicyQuery, ctx: FilterContext): { all: number; byStatus: Record<PolicyStatus, number>; noStatus: number } {
  const byStatus = Object.fromEntries(POLICY_STATUSES.map((s) => [s, 0])) as Record<PolicyStatus, number>;
  let all = 0;
  let noStatus = 0;
  for (const p of searched) {
    if (!passes(p, q, ctx, "status")) continue;
    all++;
    if (p.status) byStatus[p.status]++;
    else noStatus++;
  }
  return { all, byStatus, noStatus };
}

/**
 * A filter's options with their counts (faceted: every other filter applies, this one doesn't).
 * The options are the lists in Settings (or the fixed ones) plus any value the rows hold.
 */
export function facet(
  key: MultiFilterKey,
  base: PolicyListRow[],
  searched: PolicyListRow[],
  q: PolicyQuery,
  ctx: FilterContext,
  lists: { carrierProducts: CarrierProducts; rateClasses: string[]; leadSources: string[] },
): { value: string; label: string; n: number }[] {
  const counts = new Map<string, number>();
  for (const p of searched) {
    if (!passes(p, q, ctx, key)) continue;
    const v = MULTI_GET[key](p);
    if (v) counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  const uniq = (xs: (string | null)[]) => [...new Set(xs.filter((x): x is string => !!x))];
  const fromRows = base.map(MULTI_GET[key]);
  let options: string[];
  if (key === "status") options = [...POLICY_STATUSES];
  else if (key === "carrier") options = uniq([...Object.keys(lists.carrierProducts), ...fromRows]);
  else if (key === "product") options = uniq([...Object.values(lists.carrierProducts).flat(), ...fromRows]);
  else if (key === "lead") options = uniq([...lists.leadSources, ...fromRows]);
  else if (key === "rate") options = uniq([...lists.rateClasses, ...fromRows]);
  else if (key === "cycle") options = uniq([...BILLING_CYCLES, ...fromRows]);
  else options = uniq(fromRows);
  const names = new Map(base.map((p) => [p.agentId, p.agentName]));
  const label = (v: string) => (key === "agent" ? (names.get(v) ?? "Someone") : v);
  const out = options.map((value) => ({ value, label: label(value), n: counts.get(value) ?? 0 }));
  return key === "agent" ? out.sort((a, b) => a.label.localeCompare(b.label)) : out;
}

// ---- saved views ---------------------------------------------------------------------------------

/** A view's query: its preset over a clear query (search, scope, team and sort kept). */
export function viewQuery(view: SavedView | ViewId, q: PolicyQuery): PolicyQuery {
  const v = typeof view === "string" ? SAVED_VIEWS.find((x) => x.id === view) : view;
  return { ...clearFilters(q), ...(v?.preset ?? {}) };
}
const FILTER_KEYS = ["status", "carrier", "product", "lead", "rate", "agent", "cycle", "sub", "subFrom", "subTo", "eff", "effFrom", "effTo", "ss", "benef", "stale", "nonum"] as const;
const sameFilters = (a: PolicyQuery, b: PolicyQuery) => FILTER_KEYS.every((k) => JSON.stringify(a[k]) === JSON.stringify(b[k]));
/** Which saved view the filters are exactly (null: a mix of filters of the person's own). */
export function viewOf(q: PolicyQuery): ViewId | null {
  for (const v of SAVED_VIEWS) if (sameFilters(q, viewQuery(v, q))) return v.id;
  return null;
}
/** Each saved view's count over the searched rows. */
export function viewCounts(searched: PolicyListRow[], q: PolicyQuery, ctx: FilterContext): Record<ViewId, number> {
  const out = {} as Record<ViewId, number>;
  for (const v of SAVED_VIEWS) {
    const vq = viewQuery(v, q);
    out[v.id] = v.id === "all" ? searched.length : searched.filter((p) => passes(p, vq, ctx)).length;
  }
  return out;
}

// ---- the CSV --------------------------------------------------------------------------------------

/** A text cell: quoted, and never a formula (a leading = + - @ tab or return gets an apostrophe). */
export function csvText(value: string | null | undefined): string {
  const v = String(value ?? "");
  const safe = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
  return `"${safe.replace(/"/g, '""')}"`;
}
/** Plain dollars with two decimals ("1234.50"); empty for none. */
export function csvMoney(cents: number | null | undefined): string {
  if (cents == null) return "";
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(Math.round(cents));
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

/** The CSV's columns, in order (the list's columns, with the client's contact details beside the name). */
export const CSV_COLUMNS: { head: string; team?: boolean; cell: (p: PolicyListRow) => string }[] = [
  { head: "Client", cell: (p) => csvText(clientNameOf(p)) },
  { head: "Client email", cell: (p) => csvText(p.clientEmail) },
  { head: "Client phone", cell: (p) => csvText(p.clientPhone) },
  { head: "Agent", team: true, cell: (p) => csvText(p.agentName) },
  { head: "Carrier", cell: (p) => csvText(p.carrier) },
  { head: "Product", cell: (p) => csvText(p.product) },
  { head: "Monthly premium", cell: (p) => csvMoney(p.monthlyCents) },
  { head: "Annual premium", cell: (p) => csvMoney(p.premiumCents) },
  { head: "Policies", cell: (p) => String(p.policies) },
  { head: "Coverage", cell: (p) => csvMoney(p.coverageCents) },
  { head: "Status", cell: (p) => csvText(p.status ?? (isImportRow(p) ? "" : "No status yet")) },
  { head: "Submitted", cell: (p) => csvText(p.soldOn) },
  { head: "Effective", cell: (p) => csvText(p.effectiveDate) },
  { head: "Rate class", cell: (p) => csvText(p.rateClass) },
  { head: "Lead source", cell: (p) => csvText(p.leadSource) },
  { head: "Billing cycle", cell: (p) => csvText(p.billingCycle) },
  { head: "Social Security billing", cell: (p) => csvText(p.ssBenefit == null ? "" : p.ssBenefit ? "Yes" : "No") },
  { head: "Policy number", cell: (p) => csvText(p.policyNumber) },
  { head: "Application number", cell: (p) => csvText(p.applicationNumber) },
];

/**
 * The rows as a CSV file (CRLF lines, every text quoted and formula-safe). The caller adds the
 * UTF-8 mark and hands in only rows the viewer may see (policies.ts listPoliciesFor), filtered and
 * sorted as the screen shows them. `withAgent`: a team's or everyone's list gets the Agent column.
 */
export function policiesCsv(rows: PolicyListRow[], opts: { withAgent: boolean }): string {
  const cols = CSV_COLUMNS.filter((c) => !c.team || opts.withAgent);
  const lines = [cols.map((c) => csvText(c.head)).join(",")];
  for (const p of rows) lines.push(cols.map((c) => c.cell(p)).join(","));
  return lines.join("\r\n") + "\r\n";
}
