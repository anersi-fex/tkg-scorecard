import "server-only";
import { getSettings } from "@/lib/data";
import { listPoliciesFor, loadRuleContext } from "@/lib/policies";
import { applyQuery, dateRange, facet, isStale, parseQuery, statusCounts, viewCounts, passes, type ListResult } from "@/lib/policy-filter";
import { MULTI_FILTERS, clientNameOf, isImportRow, type MultiFilterKey, type PolicyListRow, type PolicyQuery, type PolicyScope, type PolicyStatus, type ViewId } from "@/lib/policy-types";
import { myTeamLeaderId, policyScopes, teamName, type PolicyScopeTab } from "@/lib/rules";
import { todayInDetroit } from "@/lib/month";
import { isAdmin, isManager, type Viewer } from "@/lib/viewer";
import { daysBetween } from "./format";

/**
 * The Policies list on the server (the page and its CSV share it): every row comes from
 * policies.ts listPoliciesFor (the rules already applied), then the address's query is applied
 * here (policy-filter.ts applyQuery), so the browser receives only the rows it shows and the
 * counts, never the whole list. The display rows carry what the table and the cards draw: no
 * email, phone or birthday.
 */
export interface PolicyRowView {
  id: string;
  client: string;
  isImport: boolean;
  agentId: string;
  agentName: string;
  carrier: string | null;
  product: string | null;
  monthlyCents: number | null;
  premiumCents: number;
  policies: number;
  coverageCents: number | null;
  status: PolicyStatus | null;
  /** Days waiting while Submitted or in Underwriting past 5 days; 0 otherwise. */
  staleDays: number;
  soldOn: string;
  effectiveDate: string | null;
  leadSource: string | null;
  policyNumber: string | null;
  applicationNumber: string | null;
  /** Logged in the last 15 minutes. */
  fresh: boolean;
}

export type Option = { value: string; label: string; n: number };

export interface PolicyListData {
  scopes: PolicyScopeTab[];
  scope: PolicyScope;
  /** An admin's "A team": the leader picked, and the leaders to pick from. */
  teamId: string | null;
  leaders: { id: string; label: string }[];
  scopeNote: string;
  /** A team's or everyone's list (the Agent column and filter). */
  withAgent: boolean;
  /** A manager or an admin (the search also finds the seller). */
  managerish: boolean;
  query: PolicyQuery;
  today: string;
  baseCount: number;
  result: ListResult;
  rows: PolicyRowView[];
  /** Everything the search and the filters leave. */
  matched: number;
  annualCents: number;
  avgMonthlyCents: number;
  status: { all: number; byStatus: Record<PolicyStatus, number>; noStatus: number };
  views: Record<ViewId, number>;
  facets: Partial<Record<MultiFilterKey, Option[]>>;
  dateCounts: { sub: Record<"month" | "7d", number>; eff: Record<"month" | "next", number> };
  yesNo: { ss: { pool: number; yes: number }; benef: { pool: number; yes: number } };
}

type Params = Record<string, string | string[] | undefined> | URLSearchParams;

export async function loadPolicyList(viewer: Viewer, params: Params): Promise<PolicyListData> {
  const query = parseQuery(params);
  const today = todayInDetroit();
  const scopes = policyScopes(viewer);
  const [ctx, settings] = await Promise.all([loadRuleContext(), getSettings()]);
  const admin = isAdmin(viewer);
  const leaderIds = admin ? ctx.org.leaders() : [];
  const teamFor = (s: PolicyScope) => (s === "team" && admin ? (query.team && leaderIds.includes(query.team) ? query.team : (myTeamLeaderId(viewer, ctx) ?? leaderIds[0] ?? null)) : null);

  let scope: PolicyScope = scopes.some((s) => s.id === query.scope) ? (query.scope as PolicyScope) : (scopes[0]?.id ?? "mine");
  let base: PolicyListRow[] = [];
  if (scopes.length) {
    base = await listPoliciesFor(viewer, scope, teamFor(scope));
    // No scope asked for: the first one with policies in it (the owner, with no sales of his own, lands on Everyone).
    if (!query.scope && !base.length) {
      for (const s of scopes.slice(1)) {
        const rows = await listPoliciesFor(viewer, s.id, teamFor(s.id));
        if (rows.length) {
          scope = s.id;
          base = rows;
          break;
        }
      }
    }
  }
  const teamId = teamFor(scope);
  const withAgent = scope !== "mine";
  const managerish = admin || isManager(viewer);
  const q: PolicyQuery = { ...query, scope: query.scope ? scope : null, team: scope === "team" && admin ? teamId : null, agent: withAgent ? query.agent : [] };
  const fctx = { today };
  const result = applyQuery(base, q, fctx, { withAgent: managerish, scope });
  const nowMs = ctx.nowMs;
  const rows: PolicyRowView[] = result.shown.map((p) => ({
    id: p.id,
    client: clientNameOf(p),
    isImport: isImportRow(p),
    agentId: p.agentId,
    agentName: p.agentName,
    carrier: p.carrier,
    product: p.product,
    monthlyCents: p.monthlyCents,
    premiumCents: p.premiumCents,
    policies: p.policies,
    coverageCents: p.coverageCents,
    status: p.status,
    staleDays: isStale(p, today) ? daysBetween(p.soldOn, today) : 0,
    soldOn: p.soldOn,
    effectiveDate: p.effectiveDate,
    leadSource: p.leadSource,
    policyNumber: p.policyNumber,
    applicationNumber: p.applicationNumber,
    fresh: !isImportRow(p) && nowMs - Date.parse(p.createdAt) <= 15 * 60_000,
  }));
  const withMonthly = result.rows.filter((p) => p.monthlyCents);
  const lists = { carrierProducts: settings.carrierProducts, rateClasses: settings.rateClasses, leadSources: settings.leadSources };
  const facets: PolicyListData["facets"] = {};
  for (const f of MULTI_FILTERS) {
    if (f.team && !withAgent) continue;
    facets[f.key] = facet(f.key, base, result.searched, q, fctx, lists);
  }
  const datePool = (k: "sub" | "eff") => result.searched.filter((p) => passes(p, q, fctx, k));
  const inRange = (k: "sub" | "eff", preset: string, pool: PolicyListRow[]) => {
    const r = dateRange(k, { ...q, [k]: preset } as PolicyQuery, fctx);
    if (!r) return pool.length;
    return pool.filter((p) => {
      const v = (k === "sub" ? p.soldOn : p.effectiveDate) ?? "";
      return !!v && (!r.from || v >= r.from) && (!r.to || v <= r.to);
    }).length;
  };
  const subPool = datePool("sub");
  const effPool = datePool("eff");
  const ssPool = result.searched.filter((p) => passes(p, q, fctx, "ss"));
  const benPool = result.searched.filter((p) => passes(p, q, fctx, "benef"));
  const name = (id: string) => ctx.byId.get(id)?.name ?? "Someone";
  const leaders = leaderIds
    .map((id) => ({ id, label: `${id === viewer.agentId ? "My team" : teamName(id, ctx)} · ${ctx.org.membersOf(id).length} people` }))
    .sort((a, b) => (a.id === viewer.agentId ? -1 : b.id === viewer.agentId ? 1 : a.label.localeCompare(b.label)));
  const scopeNote =
    scope === "mine" ? "" : scope === "all" ? "Every policy in the agency" : admin && teamId ? `${teamName(teamId, ctx)}: everyone under ${name(teamId).split(" ")[0]}, every level` : "Yours and everyone under you, every level";
  return {
    scopes,
    scope,
    teamId: scope === "team" && admin ? teamId : null,
    leaders,
    scopeNote,
    withAgent,
    managerish,
    query: q,
    today,
    baseCount: base.length,
    result,
    rows,
    matched: result.rows.length,
    annualCents: result.rows.reduce((s, p) => s + p.premiumCents, 0),
    avgMonthlyCents: withMonthly.length ? Math.round(withMonthly.reduce((s, p) => s + (p.monthlyCents ?? 0), 0) / withMonthly.length) : 0,
    status: statusCounts(result.searched, q, fctx),
    views: viewCounts(result.searched, q, fctx),
    facets,
    dateCounts: { sub: { month: inRange("sub", "month", subPool), "7d": inRange("sub", "7d", subPool) }, eff: { month: inRange("eff", "month", effPool), next: inRange("eff", "next", effPool) } },
    yesNo: { ss: { pool: ssPool.length, yes: ssPool.filter((p) => p.ssBenefit === true).length }, benef: { pool: benPool.length, yes: benPool.filter((p) => p.beneficiaryCount > 0).length } },
  };
}
