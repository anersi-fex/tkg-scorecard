import "server-only";
import { db } from "./supabase";
import { DataError, Said, getSettings, listAgents, touchBoard } from "./data";
import { requestApproval } from "./approvals";
import { datesOfMonth, dayLabel, isDateKey, isMonthKey, todayInDetroit } from "./month";
import { formatDollars, formatMoney } from "./money";
import {
  EMPTY_CLIENT,
  LOCK,
  POLICY_STATUSES,
  isPolicySource,
  isPolicyStatus,
  type Beneficiary,
  type PipelineCounts,
  type PolicyClient,
  type PolicyEvent,
  type PolicyField,
  type PolicyListRow,
  type PolicyRecord,
  type PolicyScope,
  type PolicyStatus,
} from "./policy-types";
import {
  annualOf,
  errorLine,
  formOf,
  monthlyText,
  validatePolicyForm,
  valuesOf,
  type FormKey,
  type PolicyForm,
  type PolicyValues,
} from "./policy-validate";
import { canLogFor, canSeeClient, editRights, isPastMonth, policyAgentIds, policyScopes, removeRights, ruleContext, type RuleContext, type RulePolicy } from "./rules";
import { isSaleKind, type LoggedBy, type SaleKind } from "./types";
import { isAdmin, isOwner, type Viewer } from "./viewer";

/**
 * The CRM's data (0006_crm.sql): the ONLY file that selects a policy's client and tracking columns.
 * Every read and write checks the rules (src/lib/rules.ts) here, on the server, from the session's
 * viewer, never from what a request names; a row comes back only to someone the rules let see it.
 * The shared team password never reads or writes a policy (contract decision 2). Nothing here logs
 * a value: errors carry the table and the operation (DataError), history lines never a client's.
 */

export const NEEDS_OWN_SIGN_IN = "This needs your own sign-in.";
export const SENT_FOR_OK = "Sent to Anersi for a quick OK.";
const NOT_HERE = "That policy isn't here.";

function fail(where: string, error: { message: string } | null): never {
  throw new DataError(where, error);
}
const isUuid = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

// ---- reading -----------------------------------------------------------------------------------

const BOARD_COLUMNS = "id, agent_id, premium_cents, policies, product, carrier, kind, note, sold_on, logged_by, logged_by_agent, created_at, updated_at, source";
const TRACK_COLUMNS = "status, monthly_cents, effective_date, rate_class, coverage_cents, ss_benefit, billing_cycle, billing_day, policy_number, application_number, lead_source, underwriting";
const LIST_CLIENT_COLUMNS = "client_first, client_last, client_email, client_phone, beneficiaries";
const RECORD_CLIENT_COLUMNS = "notes, client_first, client_last, client_dob, client_email, client_no_email, client_phone, client_address, beneficiaries";
const LIST_COLUMNS = `${BOARD_COLUMNS}, ${TRACK_COLUMNS}, ${LIST_CLIENT_COLUMNS}, agents!agent_id(name)`;
const RECORD_COLUMNS = `${BOARD_COLUMNS}, ${TRACK_COLUMNS}, ${RECORD_CLIENT_COLUMNS}, agents!agent_id(name)`;

type Row = Record<string, unknown> & { agents?: { name: string } | { name: string }[] | null };

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);
const num = (v: unknown): number | null => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
const bool = (v: unknown): boolean | null => (v === true ? true : v === false ? false : null);
const agentNameOf = (r: Row) => {
  const a = Array.isArray(r.agents) ? r.agents[0] : r.agents;
  return a?.name ?? "Someone";
};
function benList(v: unknown): Beneficiary[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((b): b is Record<string, unknown> => !!b && typeof b === "object")
    .map((b) => ({ name: String(b.name ?? "").slice(0, 80), relationship: String(b.relationship ?? "").slice(0, 40) }))
    .filter((b) => b.name.trim())
    .slice(0, 10);
}
const LOGGED_BY: LoggedBy[] = ["owner", "team", "shortcut"];

function toListRow(r: Row): PolicyListRow {
  const source = isPolicySource(r.source) ? r.source : "scorecard";
  return {
    id: String(r.id),
    agentId: String(r.agent_id),
    agentName: agentNameOf(r),
    loggedByAgent: str(r.logged_by_agent),
    createdAt: String(r.created_at),
    source,
    kind: isSaleKind(r.kind) ? r.kind : "life",
    premiumCents: Number(r.premium_cents),
    monthlyCents: num(r.monthly_cents),
    policies: Number(r.policies) || 1,
    carrier: str(r.carrier),
    product: str(r.product),
    soldOn: String(r.sold_on),
    status: isPolicyStatus(r.status) ? r.status : null,
    underwriting: r.underwriting === true,
    effectiveDate: str(r.effective_date),
    rateClass: str(r.rate_class),
    coverageCents: num(r.coverage_cents),
    ssBenefit: bool(r.ss_benefit),
    billingCycle: str(r.billing_cycle),
    leadSource: str(r.lead_source),
    policyNumber: str(r.policy_number),
    applicationNumber: str(r.application_number),
    clientFirst: str(r.client_first) ?? "",
    clientLast: str(r.client_last) ?? "",
    clientEmail: str(r.client_email) ?? "",
    clientPhone: str(r.client_phone) ?? "",
    beneficiaryCount: benList(r.beneficiaries).length,
  };
}

function toRecord(r: Row, names: Map<string, string>): PolicyRecord {
  const row = toListRow(r);
  const client: PolicyClient = {
    ...EMPTY_CLIENT,
    firstName: row.clientFirst,
    lastName: row.clientLast,
    dob: str(r.client_dob) ?? "",
    email: row.clientEmail,
    noEmail: r.client_no_email === true,
    phone: row.clientPhone,
    address: str(r.client_address) ?? "",
  };
  return {
    id: row.id,
    agentId: row.agentId,
    agentName: row.agentName,
    loggedByAgent: row.loggedByAgent,
    loggedByName: row.loggedByAgent ? (names.get(row.loggedByAgent) ?? null) : null,
    loggedBy: LOGGED_BY.includes(r.logged_by as LoggedBy) ? (r.logged_by as LoggedBy) : "team",
    createdAt: row.createdAt,
    updatedAt: str(r.updated_at),
    source: row.source,
    kind: row.kind,
    premiumCents: row.premiumCents,
    monthlyCents: row.monthlyCents,
    policies: row.policies,
    carrier: row.carrier,
    product: row.product,
    soldOn: row.soldOn,
    status: row.status,
    underwriting: row.underwriting,
    effectiveDate: row.effectiveDate,
    rateClass: row.rateClass,
    coverageCents: row.coverageCents,
    ssBenefit: row.ssBenefit,
    billingCycle: row.billingCycle,
    billingDay: str(r.billing_day),
    policyNumber: row.policyNumber,
    applicationNumber: row.applicationNumber,
    leadSource: row.leadSource,
    notes: str(r.notes),
    note: str(r.note),
    client,
    beneficiaries: benList(r.beneficiaries),
  };
}

/** The people (all of them, off the board too) and the clock, for the rules. */
export async function loadRuleContext(now: Date = new Date()): Promise<RuleContext> {
  return ruleContext(await listAgents({ includeInactive: true }), now);
}

/** The API hands back at most 1,000 rows a request: a list is read a page at a time. */
const PAGE = 1000;
const MAX_PAGES = 200;

/**
 * The policies a scope lists, every one the viewer may see (each row also passes canSeeClient):
 * newest submitted first, an AgentSpace day total as one row. A scope the viewer does not have
 * falls back to their first one; the shared team password gets none. While P&C is off its sales
 * are left out, like everywhere else.
 */
export async function listPoliciesFor(viewer: Viewer, scope: PolicyScope, teamLeaderId?: string | null): Promise<PolicyListRow[]> {
  if (viewer.level === "team") return [];
  const scopes = policyScopes(viewer);
  if (!scopes.length) return [];
  const use = scopes.some((s) => s.id === scope) ? scope : scopes[0].id;
  const [ctx, settings] = await Promise.all([loadRuleContext(), getSettings()]);
  const ids = policyAgentIds(viewer, use, teamLeaderId ?? null, ctx);
  if (ids && ids.size === 0) return [];
  const out: PolicyListRow[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    let q = db().from("sales").select(LIST_COLUMNS).is("deleted_at", null);
    if (ids) q = q.in("agent_id", [...ids]);
    if (!settings.pcEnabled) q = q.eq("kind", "life");
    const { data, error } = await q
      .order("sold_on", { ascending: false })
      .order("created_at", { ascending: false })
      .order("id")
      .range(page * PAGE, page * PAGE + PAGE - 1);
    if (error) fail("policies.list", error);
    const rows = (data ?? []) as unknown as Row[];
    for (const r of rows) {
      const row = toListRow(r);
      if (canSeeClient(viewer, row, ctx)) out.push(row);
    }
    if (rows.length < PAGE) break;
  }
  return out;
}

async function readRow(id: string, columns: string): Promise<Row | null> {
  if (!isUuid(id)) return null;
  const { data, error } = await db().from("sales").select(columns).eq("id", id).is("deleted_at", null).maybeSingle();
  if (error) fail("policies.get", error);
  return (data as unknown as Row | null) ?? null;
}

/** One policy with everything, or null when it is not there or the viewer may not see it. */
export async function getPolicyFor(viewer: Viewer, id: string): Promise<PolicyRecord | null> {
  if (viewer.level === "team") return null;
  const [row, ctx, settings] = await Promise.all([readRow(id, RECORD_COLUMNS), loadRuleContext(), getSettings()]);
  if (!row) return null;
  if (row.kind === "pc" && !settings.pcEnabled) return null;
  const names = new Map(ctx.agents.map((a) => [a.id, a.name]));
  const record = toRecord(row, names);
  return canSeeClient(viewer, record, ctx) ? record : null;
}

/** A policy's history, newest first (the lines never hold a client's value). Empty when the viewer may not see the policy. */
export async function policyHistory(viewer: Viewer, id: string): Promise<PolicyEvent[]> {
  const policy = await getPolicyFor(viewer, id);
  if (!policy) return [];
  const [{ data, error }, agents] = await Promise.all([db().from("sale_events").select("id, at, by_agent, by_label, what").eq("sale_id", id).order("at", { ascending: false }).order("id", { ascending: false }).limit(500), listAgents({ includeInactive: true })]);
  if (error) fail("policies.history", error);
  const names = new Map(agents.map((a) => [a.id, a.name]));
  const LABEL: Record<string, string> = { owner: "Owner password", team: "Team password", shortcut: "Shortcut" };
  return (data ?? []).map((e) => {
    const by = str(e.by_agent);
    return { id: Number(e.id), at: String(e.at), byAgent: by, byName: (by && names.get(by)) || LABEL[String(e.by_label)] || "Someone", what: String(e.what) };
  });
}

/**
 * Home's pipeline for some people's month (null: everyone): numbers only, never a client. Imports
 * count in the total (their policies) and in no status.
 */
export async function pipelineCounts(agentIds: string[] | null, month: string, today: string = todayInDetroit()): Promise<PipelineCounts> {
  const byStatus = Object.fromEntries(POLICY_STATUSES.map((s) => [s, 0])) as Record<PolicyStatus, number>;
  const out: PipelineCounts = { total: 0, byStatus, noStatus: 0, needsAttention: 0, issuedCents: 0 };
  if (!isMonthKey(month) || (agentIds && agentIds.length === 0)) return out;
  const settings = await getSettings();
  const days = datesOfMonth(month);
  const from = days[0];
  const to = days[days.length - 1];
  for (let page = 0; page < MAX_PAGES; page++) {
    let q = db().from("sales").select("id, status, sold_on, policies, premium_cents, source").is("deleted_at", null).gte("sold_on", from).lte("sold_on", to);
    if (agentIds) q = q.in("agent_id", agentIds);
    if (!settings.pcEnabled) q = q.eq("kind", "life");
    const { data, error } = await q.order("id").range(page * PAGE, page * PAGE + PAGE - 1);
    if (error) fail("policies.pipeline", error);
    const rows = data ?? [];
    for (const r of rows) {
      out.total += Number(r.policies) || 1;
      const status = isPolicyStatus(r.status) ? r.status : null;
      if (!status) {
        out.noStatus += r.source === "import" ? 0 : 1;
        continue;
      }
      byStatus[status]++;
      if (status === "Issued") out.issuedCents += Number(r.premium_cents);
      const days = Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${String(r.sold_on)}T00:00:00Z`)) / 86_400_000);
      if ((status === "Submitted" || status === "Underwriting") && days > 5) out.needsAttention++;
    }
    if (rows.length < PAGE) break;
  }
  return out;
}

// ---- history lines -------------------------------------------------------------------------------

/** Who made a change, for sale_events: the person, and the kind of session when no person did it. */
function byOf(viewer: Viewer | null): { by_agent: string | null; by_label: "owner" | "team" | "shortcut" | null } {
  if (!viewer) return { by_agent: null, by_label: "shortcut" };
  if (viewer.via === "owner-password") return { by_agent: viewer.agentId, by_label: "owner" };
  return { by_agent: viewer.agentId, by_label: viewer.agentId ? null : "team" };
}

/** Writes history lines (best effort: a change that saved is never reported as failed; the class alone is logged). */
async function writeEvents(saleId: string, viewer: Viewer | null, lines: string[]): Promise<void> {
  if (!lines.length) return;
  try {
    const by = byOf(viewer);
    const now = Date.now();
    // One moment each, in order, so newest-first reads them back the way they happened.
    const rows = lines.map((what, i) => ({ sale_id: saleId, at: new Date(now + i).toISOString(), ...by, what: what.slice(0, 200) }));
    const { error } = await db().from("sale_events").insert(rows);
    if (error) console.error("sale_event_failed", "DataError");
  } catch (err) {
    console.error("sale_event_failed", err instanceof Error ? err.name : "error");
  }
}

const SHORT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "Nov 3" */
const shortDay = (d: string | null) => (d && isDateKey(d) ? `${SHORT_MONTHS[Number(d.slice(5, 7)) - 1]} ${Number(d.slice(8, 10))}` : "none");
const yesNo = (v: boolean | null) => (v == null ? "none" : v ? "Yes" : "No");
const orNone = (v: string | null) => v || "none";

// ---- the values a change compares --------------------------------------------------------------

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** Which policy fields differ between two sets of values. */
function changedFields(before: PolicyValues, after: PolicyValues): PolicyField[] {
  const out: PolicyField[] = [];
  const pairs: [PolicyField, unknown, unknown][] = [
    ["agentId", before.agentId, after.agentId],
    ["monthlyCents", before.monthlyCents, after.monthlyCents],
    ["soldOn", before.soldOn, after.soldOn],
    ["carrier", before.carrier || null, after.carrier || null],
    ["product", before.product || null, after.product || null],
    ["underwriting", before.underwriting, after.underwriting],
    ["effectiveDate", before.effectiveDate, after.effectiveDate],
    ["rateClass", before.rateClass, after.rateClass],
    ["coverageCents", before.coverageCents, after.coverageCents],
    ["ssBenefit", before.ssBenefit, after.ssBenefit],
    ["billingCycle", before.billingCycle, after.billingCycle],
    ["billingDay", before.billingDay, after.billingDay],
    ["policyNumber", before.policyNumber, after.policyNumber],
    ["applicationNumber", before.applicationNumber, after.applicationNumber],
    ["leadSource", before.leadSource, after.leadSource],
    ["notes", before.notes, after.notes],
    ["client", before.client, after.client],
    ["beneficiaries", before.beneficiaries, after.beneficiaries],
  ];
  for (const [f, a, b] of pairs) if (!same(a, b)) out.push(f);
  return out;
}

/** The form fields whose errors matter for a changed policy field. */
const FORM_KEYS_OF: Record<PolicyField, FormKey[]> = {
  agentId: ["agentId"],
  monthlyCents: ["monthly"],
  soldOn: ["soldOn"],
  carrier: ["carrier", "product"],
  product: ["product"],
  status: [],
  underwriting: ["underwriting"],
  effectiveDate: ["effectiveDate"],
  rateClass: ["rateClass"],
  coverageCents: ["coverage"],
  ssBenefit: ["ss", "billingDay"],
  billingCycle: ["billingCycle"],
  billingDay: ["billingDay"],
  policyNumber: ["numbers", "policyNumber"],
  applicationNumber: ["numbers", "applicationNumber"],
  leadSource: ["leadSource"],
  notes: ["notes"],
  client: ["firstName", "lastName", "dob", "email", "phone", "address"],
  beneficiaries: ["bens"],
};

/** The database columns for a set of changed fields (the board's annual premium follows the monthly one). */
function columnsFor(fields: PolicyField[], v: PolicyValues): Record<string, unknown> {
  const c: Record<string, unknown> = {};
  for (const f of fields) {
    if (f === "agentId") c.agent_id = v.agentId;
    else if (f === "monthlyCents" && v.monthlyCents) {
      c.monthly_cents = v.monthlyCents;
      c.premium_cents = annualOf(v.monthlyCents);
    } else if (f === "soldOn") c.sold_on = v.soldOn;
    else if (f === "carrier") c.carrier = v.carrier || null;
    else if (f === "product") c.product = v.product || null;
    else if (f === "underwriting") c.underwriting = v.underwriting;
    else if (f === "effectiveDate") c.effective_date = v.effectiveDate;
    else if (f === "rateClass") c.rate_class = v.rateClass;
    else if (f === "coverageCents") c.coverage_cents = v.coverageCents;
    else if (f === "ssBenefit") c.ss_benefit = v.ssBenefit;
    else if (f === "billingCycle") c.billing_cycle = v.billingCycle;
    else if (f === "billingDay") c.billing_day = v.billingDay;
    else if (f === "policyNumber") c.policy_number = v.policyNumber;
    else if (f === "applicationNumber") c.application_number = v.applicationNumber;
    else if (f === "leadSource") c.lead_source = v.leadSource;
    else if (f === "notes") c.notes = v.notes;
    else if (f === "client") {
      c.client_first = v.client.firstName || null;
      c.client_last = v.client.lastName || null;
      c.client_dob = v.client.dob || null;
      c.client_email = v.client.noEmail ? null : v.client.email || null;
      c.client_no_email = v.client.noEmail;
      c.client_phone = v.client.phone || null;
      c.client_address = v.client.address || null;
    } else if (f === "beneficiaries") c.beneficiaries = v.beneficiaries;
  }
  return c;
}

/** One history line per changed field: values for the policy's own fields, never for a client's. */
function linesFor(fields: PolicyField[], before: PolicyValues, after: PolicyValues, names: Map<string, string>): string[] {
  const lines: string[] = [];
  const name = (id: string) => names.get(id) ?? "someone";
  for (const f of fields) {
    if (f === "agentId") lines.push(`Moved from ${name(before.agentId)} to ${name(after.agentId)}`);
    else if (f === "monthlyCents") lines.push(`Changed premium ${before.monthlyCents ? monthlyText(before.monthlyCents) : "none"} → ${after.monthlyCents ? monthlyText(after.monthlyCents) : "none"}`);
    else if (f === "soldOn") lines.push(`Changed submitted date ${shortDay(before.soldOn)} → ${shortDay(after.soldOn)}`);
    else if (f === "carrier") lines.push(`Changed carrier ${orNone(before.carrier)} → ${orNone(after.carrier)}`);
    else if (f === "product") lines.push(`Changed product ${orNone(before.product)} → ${orNone(after.product)}`);
    else if (f === "effectiveDate") lines.push(`Changed effective date ${shortDay(before.effectiveDate)} → ${shortDay(after.effectiveDate)}`);
    else if (f === "rateClass") lines.push(`Changed rate class ${orNone(before.rateClass)} → ${orNone(after.rateClass)}`);
    else if (f === "coverageCents") lines.push(`Changed coverage ${before.coverageCents ? formatDollars(before.coverageCents) : "none"} → ${after.coverageCents ? formatDollars(after.coverageCents) : "none"}`);
    else if (f === "ssBenefit") lines.push(`Changed Social Security billing ${yesNo(before.ssBenefit)} → ${yesNo(after.ssBenefit)}`);
    else if (f === "billingCycle") lines.push(`Changed billing cycle ${orNone(before.billingCycle)} → ${orNone(after.billingCycle)}`);
    else if (f === "billingDay") lines.push(`Changed billing day ${orNone(before.billingDay)} → ${orNone(after.billingDay)}`);
    else if (f === "leadSource") lines.push(`Changed lead source ${orNone(before.leadSource)} → ${orNone(after.leadSource)}`);
    else if (f === "underwriting") lines.push(after.underwriting ? "In underwriter review" : "Out of underwriter review");
    // Client details in the sense of contract decision 5: what changed, never the value.
    else if (f === "policyNumber") lines.push(!before.policyNumber ? "Added the policy number" : !after.policyNumber ? "Cleared the policy number" : "Changed the policy number");
    else if (f === "applicationNumber") lines.push(!before.applicationNumber ? "Added the application number" : !after.applicationNumber ? "Cleared the application number" : "Changed the application number");
    else if (f === "notes") lines.push(!before.notes ? "Notes added" : !after.notes ? "Notes cleared" : "Notes changed");
    else if (f === "client") lines.push("Updated client details");
    else if (f === "beneficiaries") lines.push("Updated the beneficiaries");
  }
  return lines;
}

// ---- writing -------------------------------------------------------------------------------------

export type PolicyResult = { ok: true; id?: string; message?: string; asked?: boolean } | { ok: false; error: string; errors?: Partial<Record<FormKey, string>> };

/** The kind of session that logged a sale (the database knows owner, team and shortcut). */
const loggedByOf = (viewer: Viewer): LoggedBy => (isAdmin(viewer) ? "owner" : "team");

/**
 * Logs a policy (Log a sale's three steps). Who it is for comes from the rules (decision 8): an
 * agent logs for themself whatever the form names; a manager for themself or their confirmed
 * downline; an admin for anyone on the board. Every field is checked again here. Status Submitted,
 * or Underwriting when the box was ticked; the board counts the monthly premium x 12.
 */
export async function createPolicy(viewer: Viewer, form: PolicyForm): Promise<PolicyResult> {
  if (viewer.level === "team" || (!viewer.agentId && !isAdmin(viewer))) return { ok: false, error: NEEDS_OWN_SIGN_IN };
  const [ctx, settings] = await Promise.all([loadRuleContext(), getSettings()]);
  const today = todayInDetroit();
  const f: PolicyForm = { ...form, agentId: viewer.level === "member" ? (viewer.agentId ?? "") : form.agentId };
  if (!f.agentId && viewer.agentId) f.agentId = viewer.agentId;
  const errors = validatePolicyForm(f, { today, carrierProducts: settings.carrierProducts, rateClasses: settings.rateClasses, leadSources: settings.leadSources });
  const n = Object.keys(errors).length;
  if (n) return { ok: false, error: errorLine(n), errors };
  if (!canLogFor(viewer, f.agentId, ctx)) return { ok: false, error: "You can only log a sale for someone you're allowed to." };
  const v = valuesOf(f, settings.carrierProducts);
  const seller = ctx.byId.get(v.agentId);
  if (!seller || !seller.active || !v.monthlyCents) return { ok: false, error: "That person isn't on the board." };
  const soldOn = v.soldOn ?? today;
  const now = new Date().toISOString();
  const row = {
    agent_id: seller.id,
    premium_cents: annualOf(v.monthlyCents),
    policies: 1,
    product: v.product,
    carrier: v.carrier,
    kind: "life" as SaleKind,
    client: null,
    note: null,
    sold_on: soldOn,
    logged_by: loggedByOf(viewer),
    logged_by_agent: viewer.agentId,
    source: "scorecard",
    status: v.underwriting ? "Underwriting" : "Submitted",
    updated_at: now,
    ...columnsFor(["monthlyCents", "underwriting", "effectiveDate", "rateClass", "coverageCents", "ssBenefit", "billingCycle", "billingDay", "policyNumber", "applicationNumber", "leadSource", "notes", "client", "beneficiaries"], v),
  };
  const { data, error } = await db().from("sales").insert(row).select("id").single();
  if (error) fail("policies.create", error);
  const id = String(data.id);
  await writeEvents(id, viewer, [seller.id === viewer.agentId ? "Logged the sale" : `Logged the sale for ${seller.name}`]);
  await touchBoard();
  return { ok: true, id, message: "Logged. It's on the board." };
}

/** A sale with no client details: the Shortcut, and the one-screen form until Log a sale's steps replace it. */
export interface BoardSaleInput {
  agentId: string;
  /** The annual premium. */
  premiumCents: number;
  policies: number;
  product: string | null;
  carrier: string;
  kind: SaleKind;
  note: string | null;
  soldOn: string;
}

/**
 * Logs a sale without client details: status Submitted, the monthly premium the annual one / 12,
 * and a history line. With a viewer (the one-screen form) the rules decide who it may be for; with
 * none it is the Shortcut (its token was checked by the route).
 */
export async function logBoardSale(viewer: Viewer | null, input: BoardSaleInput): Promise<{ id: string; agentName: string }> {
  if (viewer) {
    if (viewer.level === "team") throw new Said(NEEDS_OWN_SIGN_IN);
    const ctx = await loadRuleContext();
    if (!canLogFor(viewer, input.agentId, ctx)) throw new Said("You can only log a sale for someone you're allowed to.");
  }
  const { data, error } = await db()
    .from("sales")
    .insert({
      agent_id: input.agentId,
      premium_cents: input.premiumCents,
      policies: input.policies,
      product: input.product,
      carrier: input.carrier,
      kind: input.kind,
      client: null,
      note: input.note,
      sold_on: input.soldOn,
      logged_by: viewer ? loggedByOf(viewer) : "shortcut",
      logged_by_agent: viewer?.agentId ?? null,
      source: viewer ? "scorecard" : "shortcut",
      status: "Submitted",
      monthly_cents: Math.max(1, Math.round(input.premiumCents / 12)),
      updated_at: new Date().toISOString(),
    })
    .select("id, agents!agent_id(name)")
    .single();
  if (error) fail("policies.board_sale", error);
  const id = String(data.id);
  const agentName = agentNameOf(data as unknown as Row);
  const forSomeone = viewer && viewer.agentId !== input.agentId;
  await writeEvents(id, viewer, [forSomeone ? `Logged the sale for ${agentName}` : "Logged the sale"]);
  await touchBoard();
  return { id, agentName };
}

/** The approval sentence's money: the monthly premium when the policy has one, else the annual. */
const moneyOf = (monthly: number | null, annual: number) => (monthly ? monthlyText(monthly) : formatMoney(annual));

/** What an admin's past-month fix changes, as the database will hold it (board fields only: never a client value). */
export interface BoardPatch {
  agent_id?: string;
  premium_cents?: number;
  monthly_cents?: number;
  policies?: number;
  product?: string | null;
  carrier?: string | null;
  kind?: SaleKind;
  note?: string | null;
  sold_on?: string;
}
const BOARD_KEYS = ["agent_id", "premium_cents", "monthly_cents", "policies", "product", "carrier", "kind", "note", "sold_on"] as const;

/**
 * The one sentence the owner approves: the person, the amount (the monthly premium when the policy
 * has one, with its cents), the day, and every other change (kind, policy count, carrier, product,
 * the note). A sentence longer than the row's 200 characters is written shorter, never cut silently.
 * Names and amounts only: never a client's value.
 */
export function fixSentence(sale: { agentName: string; agentId: string; premiumCents: number; monthlyCents: number | null; soldOn: string; kind: SaleKind; policies: number; carrier: string | null; product: string | null; note: string | null }, patch: BoardPatch, newName: string | null): string {
  const cut = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);
  const monthly = patch.monthly_cents ?? sale.monthlyCents;
  const annual = patch.monthly_cents ? annualOf(patch.monthly_cents) : (patch.premium_cents ?? sale.premiumCents);
  const soldOn = patch.sold_on ?? sale.soldOn;
  const kind = patch.kind ?? sale.kind;
  const policies = patch.policies ?? sale.policies;
  const carrier = "carrier" in patch ? (patch.carrier ?? null) : sale.carrier;
  const product = "product" in patch ? (patch.product ?? null) : sale.product;
  const note = "note" in patch ? (patch.note ?? null) : sale.note;
  const moved = patch.agent_id && patch.agent_id !== sale.agentId;
  const sentence = (nameMax: number, values: boolean) => {
    const was = `${cut(sale.agentName, nameMax)}'s ${moneyOf(sale.monthlyCents, sale.premiumCents)} sale of ${dayLabel(sale.soldOn)}`;
    const now = `${moved ? `${cut(newName ?? "someone", nameMax)}, ` : ""}${moneyOf(patch.premium_cents && !patch.monthly_cents ? null : monthly, annual)}, ${dayLabel(soldOn)}`;
    const more = [
      kind !== sale.kind ? (kind === "pc" ? "now a P&C sale" : "now a life sale") : "",
      policies !== sale.policies ? `${policies} ${policies === 1 ? "policy" : "policies"}` : "",
      (carrier ?? "") !== (sale.carrier ?? "") ? (values ? `carrier ${carrier ?? "none"}` : "a new carrier") : "",
      (product ?? "") !== (sale.product ?? "") ? (values ? `product ${product ?? "none"}` : "a new product") : "",
      (note ?? "") !== (sale.note ?? "") ? "a new note" : "",
    ].filter(Boolean);
    return `Fix ${was} to ${now}${more.length ? ` (${more.join(", ")})` : ""}`;
  };
  let summary = sentence(60, true);
  if (summary.length > 200) summary = sentence(28, false);
  if (summary.length > 200) summary = `${summary.slice(0, 181)}… and more changes`;
  return summary;
}

/** The history lines for a board patch (an admin's fix through the one-screen form, or an approved one). */
function boardLines(sale: PolicyRecord, patch: BoardPatch, names: Map<string, string>): string[] {
  const lines: string[] = [];
  if (patch.agent_id && patch.agent_id !== sale.agentId) lines.push(`Moved from ${sale.agentName} to ${names.get(patch.agent_id) ?? "someone"}`);
  if (patch.monthly_cents && patch.monthly_cents !== sale.monthlyCents) lines.push(`Changed premium ${sale.monthlyCents ? monthlyText(sale.monthlyCents) : "none"} → ${monthlyText(patch.monthly_cents)}`);
  else if (patch.premium_cents && patch.premium_cents !== sale.premiumCents) lines.push(`Changed premium ${formatMoney(sale.premiumCents)} → ${formatMoney(patch.premium_cents)} a year`);
  if (patch.sold_on && patch.sold_on !== sale.soldOn) lines.push(`Changed submitted date ${shortDay(sale.soldOn)} → ${shortDay(patch.sold_on)}`);
  if ("carrier" in patch && (patch.carrier ?? null) !== sale.carrier) lines.push(`Changed carrier ${orNone(sale.carrier)} → ${orNone(patch.carrier ?? null)}`);
  if ("product" in patch && (patch.product ?? null) !== sale.product) lines.push(`Changed product ${orNone(sale.product)} → ${orNone(patch.product ?? null)}`);
  if (patch.kind && patch.kind !== sale.kind) lines.push(`Changed kind ${sale.kind === "pc" ? "P&C" : "Life"} → ${patch.kind === "pc" ? "P&C" : "Life"}`);
  if (patch.policies && patch.policies !== sale.policies) lines.push(`Changed policies ${sale.policies} → ${patch.policies}`);
  if ("note" in patch && (patch.note ?? null) !== sale.note) lines.push("Changed the note");
  return lines;
}

/** Reads a stored board patch back (an approvals row's payload: the old full shape and the new partial one). Null when nothing in it can be used. */
export function parseBoardPatch(raw: unknown): BoardPatch | null {
  if (!raw || typeof raw !== "object") return null;
  const p = raw as Record<string, unknown>;
  const out: BoardPatch = {};
  const text = (v: unknown, max: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
  if ("agent_id" in p) {
    if (!isUuid(p.agent_id)) return null;
    out.agent_id = p.agent_id;
  }
  for (const k of ["premium_cents", "monthly_cents"] as const) {
    if (!(k in p)) continue;
    const c = Number(p[k]);
    if (!Number.isInteger(c) || c <= 0 || c > 1_000_000_000) return null;
    out[k] = c;
  }
  if ("policies" in p) {
    const n = Number(p.policies);
    if (!Number.isInteger(n) || n < 1 || n > 50) return null;
    out.policies = n;
  }
  if ("kind" in p) {
    if (!isSaleKind(p.kind)) return null;
    out.kind = p.kind;
  }
  if ("sold_on" in p) {
    if (typeof p.sold_on !== "string" || !isDateKey(p.sold_on)) return null;
    out.sold_on = p.sold_on;
  }
  if ("product" in p) out.product = text(p.product, 40);
  if ("carrier" in p) out.carrier = text(p.carrier, 40);
  if ("note" in p) out.note = text(p.note, 200);
  return Object.keys(out).length ? out : null;
}

/** The database columns of a board patch (the annual premium follows a monthly one). */
function boardColumns(patch: BoardPatch): Record<string, unknown> {
  const c: Record<string, unknown> = {};
  for (const k of BOARD_KEYS) if (k in patch) c[k] = patch[k];
  if (patch.monthly_cents) c.premium_cents = annualOf(patch.monthly_cents);
  return c;
}

async function readRecord(id: string, ctx: RuleContext): Promise<PolicyRecord | null> {
  const row = await readRow(id, RECORD_COLUMNS);
  return row ? toRecord(row, new Map(ctx.agents.map((a) => [a.id, a.name]))) : null;
}

/** Writes a patch to a sale still standing; false when it is gone. */
async function writePatch(id: string, columns: Record<string, unknown>): Promise<boolean> {
  const { data, error } = await db()
    .from("sales")
    .update({ ...columns, updated_at: new Date().toISOString() })
    .eq("id", id)
    .is("deleted_at", null)
    .select("id");
  if (error) fail("policies.update", error);
  return (data?.length ?? 0) > 0;
}

/**
 * Applies an approved past-month fix (approvals.ts carryOut), checked again now: the sale and the
 * person must still be there. Returns false when the sale is gone.
 */
export async function applyApprovedFix(saleId: string, patch: BoardPatch, approvedBy: Viewer): Promise<boolean> {
  const ctx = await loadRuleContext();
  const sale = await readRecord(saleId, ctx);
  if (!sale) return false;
  const lines = boardLines(sale, patch, new Map(ctx.agents.map((a) => [a.id, a.name])));
  if (!(await writePatch(saleId, boardColumns(patch)))) return false;
  await writeEvents(
    saleId,
    approvedBy,
    lines.map((l) => `${l} (approved)`),
  );
  return true;
}

/** Removes an approved past-month sale (approvals.ts carryOut). False when it is already gone. */
export async function applyApprovedRemove(saleId: string, approvedBy: Viewer): Promise<boolean> {
  const gone = await softDelete(saleId);
  if (gone) await writeEvents(saleId, approvedBy, ["Removed the policy (approved)"]);
  return gone;
}

async function softDelete(id: string): Promise<boolean> {
  const { data, error } = await db().from("sales").update({ deleted_at: new Date().toISOString() }).eq("id", id).is("deleted_at", null).select("id");
  if (error) fail("policies.remove", error);
  return (data?.length ?? 0) > 0;
}

/**
 * Changes a policy from a form (Log a sale's fields; only the fields the form carried, see
 * formFromFormData's `present`). Only what changed counts: each changed field must be one the
 * rules let this viewer change (a locked field the form sent unchanged is ignored; changed, it is
 * refused with its lock line), and only the changed fields are checked (an old value nobody
 * touched never blocks a save). An admin who is not the owner changing a past month's board
 * fields files a request for the owner for those (the tracking fields save at once).
 */
export async function updatePolicy(viewer: Viewer, id: string, input: { form: PolicyForm; present: Set<FormKey> }): Promise<PolicyResult> {
  if (viewer.level === "team") return { ok: false, error: NEEDS_OWN_SIGN_IN };
  const [ctx, settings] = await Promise.all([loadRuleContext(), getSettings()]);
  const sale = await readRecord(id, ctx);
  if (!sale || !canSeeClient(viewer, sale, ctx) || (sale.kind === "pc" && !settings.pcEnabled)) return { ok: false, error: NOT_HERE };
  const rights = editRights(viewer, sale, ctx);
  const current = formOf(sale);
  const merged: PolicyForm = { ...current };
  for (const k of input.present) if (k !== "numbers") (merged as unknown as Record<string, unknown>)[k] = input.form[k as keyof PolicyForm];
  // A blank day keeps the day it has (a fix never clears the day the board counts it on).
  if (!merged.soldOn.trim()) merged.soldOn = current.soldOn;
  if (!merged.agentId.trim()) merged.agentId = current.agentId;
  const before = valuesOf(current);
  const after = valuesOf(merged, settings.carrierProducts);
  // A carrier or product typed in another case is the same one.
  if (after.carrier.toLowerCase() === before.carrier.toLowerCase()) after.carrier = before.carrier;
  if (after.product.toLowerCase() === before.product.toLowerCase()) after.product = before.product;
  const changed = changedFields(before, after);
  if (!changed.length) return { ok: true, message: "Nothing changed." };
  for (const f of changed) if (!rights.fields.has(f)) return { ok: false, error: rights.locked[f] ?? LOCK.none };
  // Underwriting follows the status while it is Submitted or Underwriting (or has none yet).
  let status: PolicyStatus | null = null;
  if (changed.includes("underwriting") && (!sale.status || sale.status === "Submitted" || sale.status === "Underwriting")) {
    status = after.underwriting ? "Underwriting" : "Submitted";
    if (status === sale.status) status = null;
    else if (!rights.fields.has("status")) return { ok: false, error: rights.locked.status ?? LOCK.none };
  }
  const keys = [...new Set(changed.flatMap((f) => FORM_KEYS_OF[f]))];
  const errors = validatePolicyForm(merged, { today: todayInDetroit(), carrierProducts: settings.carrierProducts, rateClasses: settings.rateClasses, leadSources: settings.leadSources, keep: current }, keys);
  const n = Object.keys(errors).length;
  if (n) return { ok: false, error: errorLine(n), errors };
  if (changed.includes("agentId")) {
    const to = ctx.byId.get(after.agentId);
    if (!to || !to.active) return { ok: false, error: "That person isn't on the board." };
  }
  const names = new Map(ctx.agents.map((a) => [a.id, a.name]));
  const board: PolicyField[] = changed.filter((f) => f === "agentId" || f === "monthlyCents" || f === "soldOn" || f === "carrier" || f === "product");
  const tracking = changed.filter((f) => !board.includes(f));
  // A past month (as it stands, or where the fix moves it) asks the owner, for the board fields only.
  const movesInto = changed.includes("soldOn") && after.soldOn ? isPastMonth({ soldOn: after.soldOn }, ctx) : false;
  const asks = board.length > 0 && isAdmin(viewer) && !isOwner(viewer) && (rights.asksOwner || movesInto);
  let asked = false;
  if (asks) {
    const patch = toBoardPatch(columnsFor(board, after));
    await requestApproval({ kind: "edit_past_sale", payload: { sale_id: sale.id, patch }, summary: fixSentence(sale, patch, names.get(after.agentId) ?? null), requestedBy: viewer.agentId });
    asked = true;
  }
  const apply = asks ? tracking : changed;
  if (apply.length || status) {
    const cols = columnsFor(apply, after);
    if (status) cols.status = status;
    if (!(await writePatch(sale.id, cols))) return { ok: false, error: "That policy is already gone." };
    const lines = linesFor(apply, before, after, names);
    if (status) {
      const i = lines.findIndex((l) => l.includes("underwriter review"));
      const line = `Status: ${sale.status ?? "No status yet"} → ${status}`;
      if (i >= 0) lines[i] = line;
      else lines.push(line);
    }
    await writeEvents(sale.id, viewer, lines);
    if (apply.some((f) => board.includes(f))) await touchBoard();
  }
  if (asked) return { ok: true, asked: true, message: apply.length ? "Saved. The board numbers went to Anersi for a quick OK." : SENT_FOR_OK };
  return { ok: true, message: "Saved." };
}

function toBoardPatch(cols: Record<string, unknown>): BoardPatch {
  const out: BoardPatch = {};
  for (const k of BOARD_KEYS) if (k in cols) (out as Record<string, unknown>)[k] = cols[k];
  return out;
}

/**
 * The one-screen fix an admin makes from Home's sale rows (until Phase B replaces it): the annual
 * premium, policy count, kind, carrier, product, note, day and who sold it. A past month (as it
 * stands or where the fix moves it) goes to the owner unless it is the owner.
 */
export async function fixBoardSale(viewer: Viewer, id: string, patch: Required<Pick<BoardPatch, "agent_id" | "premium_cents" | "policies" | "kind" | "sold_on">> & Pick<BoardPatch, "product" | "carrier" | "note">): Promise<PolicyResult> {
  if (!isAdmin(viewer)) throw new Said("Only an admin can do that");
  const ctx = await loadRuleContext();
  const sale = await readRecord(id, ctx);
  if (!sale) return { ok: false, error: "That sale is already gone." };
  if (sale.source === "import") return { ok: false, error: LOCK.importRow };
  const to = ctx.byId.get(patch.agent_id);
  if (!to) return { ok: false, error: "That person isn't on the team." };
  // The annual premium as typed: an older sale keeps no monthly amount, a newer one gets annual / 12.
  const full: BoardPatch = { ...patch };
  if (sale.monthlyCents && patch.premium_cents !== sale.premiumCents) full.monthly_cents = Math.max(1, Math.round(patch.premium_cents / 12));
  if (!isOwner(viewer) && (isPastMonth(sale, ctx) || isPastMonth({ soldOn: patch.sold_on }, ctx))) {
    await requestApproval({ kind: "edit_past_sale", payload: { sale_id: sale.id, patch: full }, summary: fixSentence(sale, full, to.name), requestedBy: viewer.agentId });
    return { ok: true, asked: true, message: SENT_FOR_OK };
  }
  const lines = boardLines(sale, full, new Map(ctx.agents.map((a) => [a.id, a.name])));
  const cols = boardColumns(full);
  // The annual premium typed here wins over monthly x 12 (the board shows what the admin typed).
  cols.premium_cents = patch.premium_cents;
  if (!(await writePatch(sale.id, cols))) return { ok: false, error: "That sale is already gone." };
  await writeEvents(sale.id, viewer, lines);
  await touchBoard();
  return { ok: true, message: "Saved." };
}

/** Changes a policy's status (the status menu). Tracking only: never a total, never an approval. */
export async function setPolicyStatus(viewer: Viewer, id: string, status: string): Promise<PolicyResult> {
  if (viewer.level === "team") return { ok: false, error: NEEDS_OWN_SIGN_IN };
  if (!isPolicyStatus(status)) return { ok: false, error: "That isn't a status." };
  const [ctx, settings] = await Promise.all([loadRuleContext(), getSettings()]);
  const sale = await readRecord(id, ctx);
  if (!sale || !canSeeClient(viewer, sale, ctx) || (sale.kind === "pc" && !settings.pcEnabled)) return { ok: false, error: NOT_HERE };
  const rights = editRights(viewer, sale, ctx);
  if (!rights.fields.has("status")) return { ok: false, error: rights.locked.status ?? LOCK.none };
  if (sale.status === status) return { ok: true, message: "Nothing changed." };
  if (!(await writePatch(sale.id, { status, underwriting: status === "Underwriting" }))) return { ok: false, error: "That policy is already gone." };
  await writeEvents(sale.id, viewer, [`Status: ${sale.status ?? "No status yet"} → ${status}`]);
  return { ok: true, message: `Status: ${status}.` };
}

/**
 * Removes a policy (soft: the row stays with deleted_at): an admin any (an admin who is not the
 * owner asks the owner for a past month's); the seller or whoever logged it in the first 15
 * minutes ("Take it back"); nobody else.
 */
export async function removePolicy(viewer: Viewer, id: string): Promise<PolicyResult> {
  if (viewer.level === "team") return { ok: false, error: NEEDS_OWN_SIGN_IN };
  const ctx = await loadRuleContext();
  const sale = await readRecord(id, ctx);
  if (!sale) return { ok: false, error: "That sale is already gone." };
  const rights = removeRights(viewer, sale, ctx);
  if (!rights.can) {
    const mine = viewer.agentId && (sale.agentId === viewer.agentId || sale.loggedByAgent === viewer.agentId);
    return { ok: false, error: mine ? "A sale can be taken back for 15 minutes. After that, ask an admin." : "You can take back your own sales only. Ask an admin about this one." };
  }
  if (rights.asksOwner) {
    await requestApproval({
      kind: "remove_past_sale",
      payload: { sale_id: sale.id },
      summary: `Remove ${sale.agentName}'s ${formatDollars(sale.premiumCents)} sale of ${dayLabel(sale.soldOn)}`,
      requestedBy: viewer.agentId,
    });
    return { ok: true, asked: true, message: SENT_FOR_OK };
  }
  if (!(await softDelete(sale.id))) return { ok: false, error: "That sale is already gone." };
  await writeEvents(sale.id, viewer, [rights.label === "Take it back" ? "Took it back" : "Removed the policy"]);
  await touchBoard();
  return { ok: true, message: rights.label === "Take it back" ? "Taken back. It's off the board." : "Removed." };
}

/** The rules' view of a stored sale, for a caller that has only the board's row (the one-screen menus). */
export function rulePolicyOf(s: { agent_id: string; logged_by_agent?: string | null; created_at: string; sold_on: string; source?: string | null }): RulePolicy {
  return { agentId: s.agent_id, loggedByAgent: s.logged_by_agent ?? null, createdAt: s.created_at, soldOn: s.sold_on, source: isPolicySource(s.source) ? s.source : "scorecard" };
}
