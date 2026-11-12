import { buildOrg, type Org } from "./org";
import { monthKeyOf, todayInDetroit } from "./month";
import { ALL_POLICY_FIELDS, LOCK, LOCK_MINUTES, MANAGER_FIELDS, TRACKING_FIELDS, type PolicyField, type PolicyScope, type PolicySource } from "./policy-types";
import type { Agent, AgentRole } from "./types";
import { isAdmin, isOwner, type Viewer } from "./viewer";

/**
 * Who sees and does what (the demo the owner approved on 2026-11-12, perms.js, ported; contract
 * decisions 1 to 8). Pure and browser-safe: every function takes the viewer, the thing asked
 * about, and a RuleContext (the people, as a CONFIRMED-only tree, and the clock). The server asks
 * the same functions again before it reads or writes anything (src/lib/policies.ts and the
 * actions); a screen asks them only to know what to draw.
 *
 * One difference from the demo, on purpose (contract decision 6): a team is the CONFIRMED tree.
 * An upline a joiner picked that waits to be confirmed puts them on nobody's team, so nobody above
 * sees their clients, logs for them or changes their policies until it is confirmed.
 */
export type RuleViewer = Pick<Viewer, "level" | "agentId">;

/** A policy as the rules need it (a PolicyRecord or a PolicyListRow fits). */
export interface RulePolicy {
  agentId: string;
  loggedByAgent: string | null;
  createdAt: string;
  soldOn: string;
  source: PolicySource;
}

/** A person as the rules need them. */
export type RulePerson = Pick<Agent, "id" | "name" | "active" | "role" | "upline_id" | "upline_confirmed">;

export interface RuleContext {
  /** The confirmed-only tree (org.ts). */
  org: Org;
  byId: Map<string, Agent>;
  agents: Agent[];
  /** Now, in milliseconds (the 15-minute locks). */
  nowMs: number;
  /** This month in Detroit, "YYYY-MM" (a past month's change asks the owner). */
  month: string;
}

/** The context the rules read: the people (every one, off the board too) and the clock. */
export function ruleContext(agents: Agent[], now: Date | number = Date.now()): RuleContext {
  const nowMs = typeof now === "number" ? now : now.getTime();
  return {
    org: buildOrg(agents),
    byId: new Map(agents.map((a) => [a.id, a])),
    agents,
    nowMs,
    month: monthKeyOf(todayInDetroit(new Date(nowMs))),
  };
}

const firstName = (name: string | null | undefined) => String(name ?? "").trim().split(/\s+/)[0] ?? "";
const isManagerLevel = (v: RuleViewer) => v.level === "manager";
const personOf = (v: RuleViewer): string | null => (v.level === "team" ? null : v.agentId);

// ---- the tree ---------------------------------------------------------------------------------

/** Everyone under `id` on the CONFIRMED tree, all levels (never `id` itself). */
export function confirmedDownline(id: string, ctx: RuleContext): Set<string> {
  return new Set(ctx.org.downlineOf(id));
}

/** True when `viewerId` is above `agentId` on the confirmed tree (any number of levels up). */
export function isAbove(viewerId: string, agentId: string, ctx: RuleContext): boolean {
  return viewerId !== agentId && ctx.org.uplineChain(agentId).includes(viewerId);
}

/** "My team": the viewer's own team when they lead people (confirmed), else the team they are on; themself when alone. */
export function myTeamLeaderId(v: RuleViewer, ctx: RuleContext): string | null {
  const me = personOf(v);
  if (!me) return null;
  return ctx.org.myTeamLeader(me) ?? me;
}

/** "Mikal's team" (the leader's first name). */
export function teamName(leaderId: string, ctx: RuleContext): string {
  const name = ctx.byId.get(leaderId)?.name;
  return name ? `${firstName(name)}'s team` : "Team";
}

// ---- numbers (Home, the Scoreboard) --------------------------------------------------------------

export interface HomeScope {
  id: "me" | "team" | "agency";
  label: string;
  /** The team's leader (the "team" scope); null when the viewer picks one (the team password). */
  leaderId?: string | null;
}
/**
 * The scopes on Home: Me, a team and the agency for a person (an admin may pick any team); the
 * shared team password sees a team's and the agency's numbers (decision 2), picking the team.
 */
export function homeScopes(v: RuleViewer, ctx: RuleContext): { scopes: HomeScope[]; pickAnyTeam: boolean } {
  const me = personOf(v);
  if (!me) return { scopes: [{ id: "team", label: "A team", leaderId: null }, { id: "agency", label: "Agency" }], pickAnyTeam: true };
  const lid = myTeamLeaderId(v, ctx) ?? me;
  return {
    scopes: [
      { id: "me", label: "Me" },
      { id: "team", label: lid === me ? "My team" : teamName(lid, ctx), leaderId: lid },
      { id: "agency", label: "Agency" },
    ],
    pickAnyTeam: isAdmin(v),
  };
}

// ---- policies and client details (the CRM) -----------------------------------------------------

/**
 * The one rule for a policy's client (contract decision 5): the seller, anyone above the seller on
 * the CONFIRMED upline chain (any level up), and the admins. Never the shared team password. On
 * the Policies list a row is shown only when this says yes.
 */
export function canSeeClient(v: RuleViewer, p: Pick<RulePolicy, "agentId">, ctx: RuleContext): boolean {
  if (v.level === "team") return false;
  if (isAdmin(v)) return true;
  const me = personOf(v);
  if (!me) return false;
  if (p.agentId === me) return true;
  return isAbove(me, p.agentId, ctx);
}

export interface PolicyScopeTab {
  id: PolicyScope;
  label: string;
  /** An admin picks which team. */
  pickTeam?: boolean;
}
/** The scope tabs on Policies: an agent "My policies"; a manager Mine and My team; an admin Mine, A team and Everyone. */
export function policyScopes(v: RuleViewer): PolicyScopeTab[] {
  if (v.level === "team") return [];
  if (isAdmin(v)) return [{ id: "mine", label: "Mine" }, { id: "team", label: "A team", pickTeam: true }, { id: "all", label: "Everyone" }];
  if (isManagerLevel(v)) return [{ id: "mine", label: "Mine" }, { id: "team", label: "My team" }];
  return [{ id: "mine", label: "My policies" }];
}

/**
 * Whose policies a scope lists: a set of people, or null for everyone (an admin's Everyone). The
 * rows are still each checked with canSeeClient, so no scope can leak. Empty for the team password.
 */
export function policyAgentIds(v: RuleViewer, scope: PolicyScope, teamLeaderId: string | null | undefined, ctx: RuleContext): Set<string> | null {
  const me = personOf(v);
  if (v.level === "team") return new Set();
  if (scope === "all") return isAdmin(v) ? null : new Set(me ? [me] : []);
  if (scope === "team") {
    if (isAdmin(v)) {
      const lead = teamLeaderId && ctx.byId.has(teamLeaderId) ? teamLeaderId : myTeamLeaderId(v, ctx);
      return new Set(lead ? ctx.org.teamOf(lead) : []);
    }
    if (isManagerLevel(v) && me) return new Set([me, ...ctx.org.downlineOf(me)]);
  }
  return new Set(me ? [me] : []);
}

/** The policies a scope shows, of the ones given (the demo's policiesFor): the scope, then canSeeClient. */
export function policiesFor<T extends RulePolicy>(v: RuleViewer, scope: PolicyScope, teamLeaderId: string | null | undefined, policies: T[], ctx: RuleContext): T[] {
  if (!policyScopes(v).some((s) => s.id === scope)) return [];
  const ids = policyAgentIds(v, scope, teamLeaderId, ctx);
  return policies.filter((p) => (ids === null || ids.has(p.agentId)) && canSeeClient(v, p, ctx));
}

// ---- logging a sale ----------------------------------------------------------------------------

/**
 * Who the viewer may log a sale for (decision 8): an agent themself; a manager themself and their
 * confirmed downline; an admin anyone on the board. The team password: nobody (decision 2).
 * Active people only, in the order given.
 */
export function logForChoices(v: RuleViewer, ctx: RuleContext): Agent[] {
  const active = ctx.agents.filter((a) => a.active);
  if (v.level === "team") return [];
  if (isAdmin(v)) return active;
  const me = personOf(v);
  if (!me) return [];
  if (isManagerLevel(v)) {
    const d = confirmedDownline(me, ctx);
    return active.filter((a) => a.id === me || d.has(a.id));
  }
  return active.filter((a) => a.id === me);
}
export const canLogFor = (v: RuleViewer, agentId: string, ctx: RuleContext): boolean => logForChoices(v, ctx).some((a) => a.id === agentId);

// ---- changing a policy -------------------------------------------------------------------------

/** Still inside the first 15 minutes after it was logged. */
export function inFirstMinutes(p: Pick<RulePolicy, "createdAt">, ctx: Pick<RuleContext, "nowMs">): boolean {
  const at = Date.parse(p.createdAt);
  return Number.isFinite(at) && ctx.nowMs - at <= LOCK_MINUTES * 60_000;
}
/** The policy's submitted date is in a month before this one (Detroit). */
export const isPastMonth = (p: Pick<RulePolicy, "soldOn">, ctx: Pick<RuleContext, "month">): boolean => p.soldOn < `${ctx.month}-01`;

/**
 * The earliest submitted date this viewer may give a sale (logging it, or fixing its day): an admin
 * any (a past month asks the owner, unless it is the owner); anyone else the 1st of this month, so a
 * past month's board never changes without the owner's OK (decision 4).
 */
export const earliestSoldOn = (v: RuleViewer, ctx: Pick<RuleContext, "month">): string | undefined => (isAdmin(v) ? undefined : `${ctx.month}-01`);
const isOwnPolicy = (v: RuleViewer, p: RulePolicy) => !!personOf(v) && p.agentId === personOf(v);
const loggedIt = (v: RuleViewer, p: RulePolicy) => !!personOf(v) && p.loggedByAgent === personOf(v);
/** A manager above the seller on the confirmed tree. */
export const managesPolicy = (v: RuleViewer, p: RulePolicy, ctx: RuleContext): boolean => isManagerLevel(v) && !!personOf(v) && isAbove(personOf(v)!, p.agentId, ctx);

/** The board fields a seller may change in the first 15 minutes (all but who sold it). */
const SALE_FIELDS = ["monthlyCents", "soldOn", "carrier", "product"] as const;

export interface EditRights {
  /** The fields this viewer may change on this policy. */
  fields: Set<PolicyField>;
  /** Why each other field is locked (the line under it). */
  locked: Partial<Record<PolicyField, string>>;
  /** An admin other than the owner changing a past month's policy files a request for the owner instead. */
  asksOwner: boolean;
}

/**
 * What the viewer may change on one policy (contract decision 4, the demo's editRights):
 *   an admin          everything (a past month asks the owner, unless it is the owner)
 *   whoever logged it everything but who sold it, for 15 minutes (a manager who logged for a teammate too)
 *   the seller        everything but who sold it for 15 minutes; after that the tracking fields
 *   a manager above   status, underwriting and notes on their confirmed downline's policies
 *   anyone else       nothing
 * An AgentSpace day total is never edited (an admin may remove one). The team password: nothing.
 */
export function editRights(v: RuleViewer, p: RulePolicy, ctx: RuleContext): EditRights {
  const locked: Partial<Record<PolicyField, string>> = {};
  const lockAll = (why: string) => {
    for (const f of ALL_POLICY_FIELDS) locked[f] = why;
    return { fields: new Set<PolicyField>(), locked, asksOwner: false };
  };
  if (v.level === "team") return lockAll(LOCK.none);
  if (p.source === "import") return lockAll(LOCK.importRow);
  if (isAdmin(v)) return { fields: new Set(ALL_POLICY_FIELDS), locked, asksOwner: isPastMonth(p, ctx) && !isOwner(v) };
  const notSeller = ALL_POLICY_FIELDS.filter((f) => f !== "agentId");
  // The first 15 minutes: everything but who sold it, unless the sale is already in a past month
  // (logged just before the month turned): then its board fields wait for an admin.
  const firstMinutes = () => {
    locked.agentId = LOCK.seller;
    if (!isPastMonth(p, ctx)) return { fields: new Set(notSeller), locked, asksOwner: false };
    for (const f of SALE_FIELDS) locked[f] = LOCK.pastMonth;
    return { fields: new Set<PolicyField>(TRACKING_FIELDS), locked, asksOwner: false };
  };
  if (loggedIt(v, p) && inFirstMinutes(p, ctx)) return firstMinutes();
  if (isOwnPolicy(v, p)) {
    if (inFirstMinutes(p, ctx)) return firstMinutes();
    for (const f of SALE_FIELDS) locked[f] = LOCK.board;
    locked.agentId = LOCK.seller;
    return { fields: new Set<PolicyField>(TRACKING_FIELDS), locked, asksOwner: false };
  }
  if (managesPolicy(v, p, ctx)) {
    const fields = new Set<PolicyField>(MANAGER_FIELDS);
    const why = LOCK.ownerOf(firstName(ctx.byId.get(p.agentId)?.name));
    for (const f of ALL_POLICY_FIELDS) if (!fields.has(f)) locked[f] = why;
    return { fields, locked, asksOwner: false };
  }
  return lockAll(LOCK.none);
}
export const canEditField = (v: RuleViewer, p: RulePolicy, field: PolicyField, ctx: RuleContext): boolean => editRights(v, p, ctx).fields.has(field);
export const canChangeStatus = (v: RuleViewer, p: RulePolicy, ctx: RuleContext): boolean => canEditField(v, p, "status", ctx);

export interface RemoveRights {
  can: boolean;
  /** "Remove policy" (an admin) or "Take it back" (the seller or whoever logged it, first 15 minutes). */
  label: "" | "Remove policy" | "Take it back";
  asksOwner: boolean;
}
/** Removing a policy: an admin any (a past month asks the owner, unless it is the owner); the seller or whoever logged it in the first 15 minutes; nobody else. */
export function removeRights(v: RuleViewer, p: RulePolicy, ctx: RuleContext): RemoveRights {
  if (v.level === "team") return { can: false, label: "", asksOwner: false };
  if (isAdmin(v)) return { can: true, label: "Remove policy", asksOwner: isPastMonth(p, ctx) && !isOwner(v) };
  if (p.source !== "import" && (isOwnPolicy(v, p) || loggedIt(v, p)) && inFirstMinutes(p, ctx)) return { can: true, label: "Take it back", asksOwner: false };
  return { can: false, label: "", asksOwner: false };
}

/** Who sees a policy's client, grouped: the seller, the people above them (nearest first), the admins (the owner first). Active people only. */
export function clientSeers(p: Pick<RulePolicy, "agentId">, ctx: RuleContext): { seller: Agent | null; uplines: Agent[]; admins: Agent[] } {
  const seller = ctx.byId.get(p.agentId);
  const admins = ctx.agents.filter((a) => a.active && (a.role === "owner" || a.role === "admin")).sort((a, b) => Number(b.role === "owner") - Number(a.role === "owner") || a.name.localeCompare(b.name));
  const adminIds = new Set(admins.map((a) => a.id));
  const uplines = ctx.org
    .uplineChain(p.agentId)
    .map((id) => ctx.byId.get(id))
    .filter((a): a is Agent => !!a && a.active && !adminIds.has(a.id));
  return { seller: seller && seller.active ? seller : null, uplines, admins: admins.filter((a) => a.id !== p.agentId) };
}

// ---- people ------------------------------------------------------------------------------------

export const ROLE_LABEL: Record<AgentRole, string> = { owner: "Admin · owner", admin: "Admin", manager: "Manager", member: "Agent" };
/** The words for a person's level ("Admin · owner", "Admin", "Manager", "Agent"). */
export const roleLabel = (a: Pick<Agent, "role">): string => ROLE_LABEL[a.role ?? "member"];
export const canSeePhones = (v: RuleViewer): boolean => isAdmin(v);
/** Rename, upline, office, goals, off the board: an admin; the owner's own row only by the owner. */
export const canEditPerson = (v: RuleViewer, a: Pick<Agent, "role">): boolean => isAdmin(v) && (a.role !== "owner" || isOwner(v));
/**
 * Sign-in and reset links, taking someone off the board and putting them back: an admin for agents
 * and managers; for an admin (or the owner) only the owner (decision 7).
 */
export const canManageAccess = (v: RuleViewer, a: Pick<Agent, "role"> | null | undefined): boolean => isAdmin(v) && !!a && (isOwner(v) || (a.role !== "admin" && a.role !== "owner"));

export interface RoleChoice {
  role: "member" | "manager" | "admin";
  label: string;
  /** True when this change goes to the owner as a request (making an admin, or taking an admin's role away). */
  asksOwner: boolean;
}
/**
 * The levels an admin can set on someone else (decision 7): agent or manager at once; making an
 * admin, or taking an admin's role away, asks the owner (unless it is the owner). Nobody changes
 * their own, and the owner's row never changes.
 */
export function roleChoices(v: RuleViewer, a: Pick<Agent, "id" | "role">): RoleChoice[] {
  if (!isAdmin(v) || a.role === "owner" || (v.agentId && a.id === v.agentId)) return [];
  const removesAdmin = a.role === "admin" && !isOwner(v);
  return [
    { role: "member", label: "Agent", asksOwner: removesAdmin },
    { role: "manager", label: "Manager", asksOwner: removesAdmin },
    { role: "admin", label: "Admin", asksOwner: !isOwner(v) },
  ];
}

/**
 * Who may confirm (or turn down) the upline a joiner picked (decision 6): that upline, a manager
 * above them on the confirmed tree, or an admin.
 */
export function canConfirmJoiner(v: RuleViewer, joiner: Pick<Agent, "upline_id" | "upline_confirmed">, ctx: RuleContext): boolean {
  if (v.level === "team" || joiner.upline_confirmed !== false || !joiner.upline_id) return false;
  if (isAdmin(v)) return true;
  const me = personOf(v);
  if (!me) return false;
  if (joiner.upline_id === me) return true;
  return isManagerLevel(v) && ctx.org.uplineChain(joiner.upline_id).includes(me);
}

/** The people waiting for this viewer (or anyone who may) to confirm the upline they picked. */
export function joinersFor(v: RuleViewer, ctx: RuleContext): Agent[] {
  return ctx.agents.filter((a) => a.active && a.upline_confirmed === false && !!a.upline_id && canConfirmJoiner(v, a, ctx));
}

export interface JoinLinkChoice {
  kind: "agency" | "team";
  label: string;
  /** An admin picks the team. */
  pickTeam?: boolean;
  /** A manager's own team link. */
  leaderId?: string;
}
/** The join links a viewer can hand out: an admin the agency link or any team's; a manager their own team's (decision 7). */
export function joinLinkChoices(v: RuleViewer): JoinLinkChoice[] {
  if (isAdmin(v)) return [{ kind: "agency", label: "Agency join link" }, { kind: "team", label: "A link for one team", pickTeam: true }];
  if (isManagerLevel(v) && v.agentId) return [{ kind: "team", label: "A link for my team", leaderId: v.agentId }];
  return [];
}
/** May this viewer get the join link for this leader's team (null: the agency link)? */
export function canGetJoinLink(v: RuleViewer, leaderId: string | null): boolean {
  if (isAdmin(v)) return true;
  return isManagerLevel(v) && !!v.agentId && leaderId === v.agentId;
}

// ---- settings and navigation ---------------------------------------------------------------------

export const canSeeSettings = (v: RuleViewer): boolean => isAdmin(v);
export const canSeeApprovals = (v: RuleViewer): boolean => isOwner(v);
/** Policies and Log a sale need a person's own sign-in (decision 2). */
export const canUsePolicies = (v: RuleViewer): boolean => v.level !== "team";

export interface NavItem {
  id: "home" | "scoreboard" | "log" | "policies" | "people" | "profile" | "tv" | "install" | "settings" | "approvals";
  label: string;
  /** The phone tab bar's shorter word. */
  tabLabel?: string;
  href: string;
  /** In the phone tab bar (the rest are in the initials menu). */
  tab?: boolean;
  /** The raised gradient button (Log a sale). */
  primary?: boolean;
  /** For the shared team password the page says "This needs your own sign-in." */
  needsOwnSignIn?: boolean;
}
/** The app's navigation for a viewer: five tabs (a phone) or the sidebar (a computer), and the menu. */
export function nav(v: RuleViewer): { items: NavItem[]; menu: NavItem[] } {
  const team = v.level === "team";
  const items: NavItem[] = [
    { id: "home", label: "Home", href: "/", tab: true },
    { id: "scoreboard", label: "Scoreboard", href: "/scoreboard", tab: true },
    { id: "log", label: "Log a sale", href: "/log", tab: true, primary: true, needsOwnSignIn: team },
    { id: "policies", label: isAdmin(v) || isManagerLevel(v) ? "Policies" : "My policies", tabLabel: "Policies", href: "/policies", tab: true, needsOwnSignIn: team },
    { id: "people", label: "People", href: "/team", tab: true },
  ];
  const menu: NavItem[] = [];
  if (!team) menu.push({ id: "profile", label: "Your profile", href: "/me" });
  menu.push({ id: "tv", label: "TV board", href: "/board" }, { id: "install", label: "Put Scorecard on your phone", href: "/install" });
  if (canSeeSettings(v)) menu.push({ id: "settings", label: "Settings", href: "/settings" });
  if (canSeeApprovals(v)) menu.push({ id: "approvals", label: "Approvals", href: "/approvals" });
  return { items, menu };
}
