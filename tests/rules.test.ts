import { test } from "node:test";
import assert from "node:assert/strict";
import {
  canConfirmJoiner,
  canGetJoinLink,
  canLogFor,
  canManageAccess,
  canSeeClient,
  clientSeers,
  editRights,
  homeScopes,
  joinLinkChoices,
  joinersFor,
  logForChoices,
  nav,
  policiesFor,
  policyAgentIds,
  policyScopes,
  removeRights,
  roleChoices,
  roleLabel,
  ruleContext,
  type RulePolicy,
  type RuleViewer,
} from "../src/lib/rules";
import { BOARD_FIELDS, LOCK, TRACKING_FIELDS } from "../src/lib/policy-types";
import type { Agent, AgentRole } from "../src/lib/types";

/**
 * The rules (src/lib/rules.ts) on an invented agency, the demo's checks (tools/audit-perms.mjs)
 * ported: who sees which client, the 15-minute locks, a manager's sale logged for a teammate,
 * past-month requests, roles, joiners and links. Every name here is made up.
 *
 *   Adam Admin (admin)
 *     Olive Owner (owner)
 *     Tom Top (manager)
 *       Mia Lead (manager)
 *         Ann Agent, Ben Agent (members)
 *           Cal Agent (member, under Ben)
 *         Jo Joiner (member, picked Mia: waiting to be confirmed)
 *     Max Other (manager)
 *       Zed Agent (member)
 *   Gus Gone (member, off the board, under Mia)
 */
const person = (id: string, role: AgentRole, upline: string | null, extra: Partial<Agent> = {}): Agent => ({ id, name: `${id[0].toUpperCase()}${id.slice(1)} Person`, active: true, sort: 0, pc_licensed: false, upline_id: upline, role, ...extra });
const agents: Agent[] = [
  person("adam", "admin", null, { name: "Adam Admin" }),
  person("olive", "owner", "adam", { name: "Olive Owner" }),
  person("tom", "manager", "adam", { name: "Tom Top" }),
  person("mia", "manager", "tom", { name: "Mia Lead" }),
  person("ann", "member", "mia", { name: "Ann Agent" }),
  person("ben", "member", "mia", { name: "Ben Agent" }),
  person("cal", "member", "ben", { name: "Cal Agent" }),
  person("jo", "member", "mia", { name: "Jo Joiner", upline_confirmed: false }),
  person("max", "manager", "adam", { name: "Max Other" }),
  person("zed", "member", "max", { name: "Zed Agent" }),
  person("gus", "member", "mia", { name: "Gus Gone", active: false }),
];
const NOW = Date.parse("2026-11-12T15:30:00Z");
const ctx = ruleContext(agents, NOW);
const v = (id: string): RuleViewer => {
  const a = agents.find((x) => x.id === id)!;
  return { level: a.role === "member" ? "member" : (a.role as RuleViewer["level"]), agentId: id };
};
const TEAM: RuleViewer = { level: "team", agentId: null };
const OWNER_PASSWORD: RuleViewer = { level: "owner", agentId: null };
const minutesAgo = (m: number) => new Date(NOW - m * 60_000).toISOString();
const policy = (agentId: string, extra: Partial<RulePolicy> = {}): RulePolicy & { id: string } => ({ id: `${agentId}-p`, agentId, loggedByAgent: agentId, createdAt: minutesAgo(60 * 24), soldOn: "2026-11-10", source: "scorecard", ...extra });

test("client details: the seller, anyone above on the CONFIRMED chain, the admins; never the team password", () => {
  const cal = policy("cal");
  assert.equal(canSeeClient(v("cal"), cal, ctx), true, "the seller");
  assert.equal(canSeeClient(v("ben"), cal, ctx), true, "an agent with people under them sees theirs");
  assert.equal(canSeeClient(v("mia"), cal, ctx), true, "the manager two levels up");
  assert.equal(canSeeClient(v("tom"), cal, ctx), true, "and three levels up");
  assert.equal(canSeeClient(v("adam"), cal, ctx), true, "an admin");
  assert.equal(canSeeClient(v("olive"), cal, ctx), true, "the owner");
  assert.equal(canSeeClient(OWNER_PASSWORD, cal, ctx), true, "the owner password");
  assert.equal(canSeeClient(v("ann"), cal, ctx), false, "a teammate beside them");
  assert.equal(canSeeClient(v("max"), cal, ctx), false, "another team's manager");
  assert.equal(canSeeClient(v("zed"), cal, ctx), false);
  assert.equal(canSeeClient(TEAM, cal, ctx), false, "the shared team password, never");
  assert.equal(canSeeClient({ level: "team", agentId: "cal" }, cal, ctx), false, "even if a team viewer named someone");
  assert.equal(canSeeClient(v("ann"), policy("mia"), ctx), false, "nobody below sees their upline's clients");
});

test("a picked upline that waits to be confirmed: nobody above sees the joiner's clients or logs for them", () => {
  const jo = policy("jo");
  assert.equal(canSeeClient(v("jo"), jo, ctx), true);
  assert.equal(canSeeClient(v("mia"), jo, ctx), false, "not the upline they picked");
  assert.equal(canSeeClient(v("tom"), jo, ctx), false);
  assert.equal(canSeeClient(v("adam"), jo, ctx), true, "an admin still does");
  assert.equal(canLogFor(v("mia"), "jo", ctx), false);
  assert.equal(policyAgentIds(v("mia"), "team", null, ctx)?.has("jo"), false);
  // Once confirmed, all of it opens.
  const confirmed = ruleContext(
    agents.map((a) => (a.id === "jo" ? { ...a, upline_confirmed: true } : a)),
    NOW,
  );
  assert.equal(canSeeClient(v("mia"), jo, confirmed), true);
  assert.equal(canSeeClient(v("tom"), jo, confirmed), true);
  assert.equal(canLogFor(v("mia"), "jo", confirmed), true);
});

test("the Policies scopes and the rows each one shows (always also checked by canSeeClient)", () => {
  assert.deepEqual(policyScopes(v("ann")).map((s) => s.label), ["My policies"]);
  assert.deepEqual(policyScopes(v("mia")).map((s) => s.label), ["Mine", "My team"]);
  assert.deepEqual(policyScopes(v("adam")).map((s) => s.label), ["Mine", "A team", "Everyone"]);
  assert.deepEqual(policyScopes(TEAM), []);
  const all = agents.map((a) => policy(a.id));
  const ids = (rows: { agentId: string }[]) => rows.map((r) => r.agentId).sort();
  assert.deepEqual(ids(policiesFor(v("ann"), "mine", null, all, ctx)), ["ann"]);
  assert.deepEqual(ids(policiesFor(v("ann"), "team", null, all, ctx)), [], "an agent has no team scope");
  assert.deepEqual(ids(policiesFor(v("ann"), "all", null, all, ctx)), []);
  assert.deepEqual(ids(policiesFor(v("mia"), "team", null, all, ctx)), ["ann", "ben", "cal", "gus", "mia"], "every confirmed level under them (off the board too), not the joiner");
  assert.deepEqual(ids(policiesFor(v("mia"), "mine", null, all, ctx)), ["mia"]);
  assert.deepEqual(ids(policiesFor(v("adam"), "team", "max", all, ctx)), ["max", "zed"], "an admin picks a team");
  assert.equal(policiesFor(v("adam"), "all", null, all, ctx).length, agents.length);
  assert.deepEqual(policiesFor(TEAM, "all", null, all, ctx), []);
  assert.equal(policyAgentIds(TEAM, "all", null, ctx)?.size, 0);
});

test("who a sale can be logged for: an agent themself, a manager their confirmed team, an admin anyone on the board", () => {
  const names = (vw: RuleViewer) => logForChoices(vw, ctx).map((a) => a.id).sort();
  assert.deepEqual(names(v("ann")), ["ann"]);
  assert.deepEqual(names(v("ben")), ["ben"], "an agent with people under them still logs only their own");
  assert.deepEqual(names(v("mia")), ["ann", "ben", "cal", "mia"], "not the waiting joiner, not someone off the board");
  assert.deepEqual(names(v("adam")), agents.filter((a) => a.active).map((a) => a.id).sort());
  assert.deepEqual(names(TEAM), []);
  assert.equal(canLogFor(v("max"), "ann", ctx), false);
});

test("the 15-minute locks: the seller fixes anything at first, then the tracking fields only", () => {
  const fresh = policy("ann", { createdAt: minutesAgo(5) });
  const old = policy("ann", { createdAt: minutesAgo(16) });
  const first = editRights(v("ann"), fresh, ctx);
  assert.deepEqual([...first.fields].sort(), [...BOARD_FIELDS, ...TRACKING_FIELDS].filter((f) => f !== "agentId").sort());
  assert.equal(first.locked.agentId, LOCK.seller);
  const later = editRights(v("ann"), old, ctx);
  assert.deepEqual([...later.fields].sort(), [...TRACKING_FIELDS].sort());
  for (const f of ["monthlyCents", "soldOn", "carrier", "product"] as const) assert.equal(later.locked[f], LOCK.board);
  assert.equal(later.locked.agentId, LOCK.seller);
  assert.equal(later.asksOwner, false);
  assert.equal(removeRights(v("ann"), fresh, ctx).label, "Take it back");
  assert.equal(removeRights(v("ann"), old, ctx).can, false, "after 15 minutes only an admin removes it");
  assert.equal(editRights(v("zed"), fresh, ctx).fields.size, 0, "anyone else: nothing");
  assert.equal(editRights(v("zed"), fresh, ctx).locked.status, LOCK.none);
});

test("a manager's sale logged for a teammate is fully theirs for 15 minutes; after that status, underwriting and notes", () => {
  const fresh = policy("ann", { loggedByAgent: "mia", createdAt: minutesAgo(3) });
  const r = editRights(v("mia"), fresh, ctx);
  assert.ok(r.fields.has("monthlyCents") && r.fields.has("client") && !r.fields.has("agentId"));
  assert.equal(removeRights(v("mia"), fresh, ctx).label, "Take it back");
  assert.equal(removeRights(v("ann"), fresh, ctx).label, "Take it back", "the seller can take it back too");
  const old = policy("ann", { loggedByAgent: "mia", createdAt: minutesAgo(20) });
  const after = editRights(v("mia"), old, ctx);
  assert.deepEqual([...after.fields].sort(), ["notes", "status", "underwriting"]);
  assert.equal(after.locked.client, "Only Ann or an admin can change this.");
  assert.equal(removeRights(v("mia"), old, ctx).can, false);
  // The manager two levels up has the same on Cal's; another team's manager has nothing.
  assert.deepEqual([...editRights(v("tom"), policy("cal"), ctx).fields].sort(), ["notes", "status", "underwriting"]);
  assert.equal(editRights(v("max"), policy("cal"), ctx).fields.size, 0);
  // An agent above someone (no manager level) sees their clients but changes nothing.
  assert.equal(editRights(v("ben"), policy("cal"), ctx).fields.size, 0);
});

test("an admin changes anything; a past month asks the owner unless it is the owner", () => {
  const thisMonth = policy("ann");
  const lastMonth = policy("ann", { soldOn: "2026-10-30" });
  assert.equal(editRights(v("adam"), thisMonth, ctx).fields.has("agentId"), true);
  assert.equal(editRights(v("adam"), thisMonth, ctx).asksOwner, false);
  assert.equal(editRights(v("adam"), lastMonth, ctx).asksOwner, true);
  assert.equal(editRights(v("olive"), lastMonth, ctx).asksOwner, false);
  assert.equal(editRights(OWNER_PASSWORD, lastMonth, ctx).asksOwner, false);
  assert.deepEqual(removeRights(v("adam"), lastMonth, ctx), { can: true, label: "Remove policy", asksOwner: true });
  assert.deepEqual(removeRights(v("olive"), lastMonth, ctx), { can: true, label: "Remove policy", asksOwner: false });
  assert.equal(editRights(TEAM, thisMonth, ctx).fields.size, 0);
  assert.equal(removeRights(TEAM, thisMonth, ctx).can, false);
});

test("an AgentSpace day total: nothing editable; an admin may remove it", () => {
  const imported = policy("ann", { source: "import", loggedByAgent: null, createdAt: minutesAgo(1) });
  assert.equal(editRights(v("ann"), imported, ctx).fields.size, 0);
  assert.equal(editRights(v("adam"), imported, ctx).fields.size, 0);
  assert.equal(editRights(v("adam"), imported, ctx).locked.monthlyCents, LOCK.importRow);
  assert.equal(removeRights(v("ann"), imported, ctx).can, false);
  assert.equal(removeRights(v("adam"), imported, ctx).can, true);
});

test("roles: an admin makes agents and managers; an admin's level is the owner's call; nobody changes their own", () => {
  const ann = agents.find((a) => a.id === "ann")!;
  const adam = agents.find((a) => a.id === "adam")!;
  const olive = agents.find((a) => a.id === "olive")!;
  assert.deepEqual(
    roleChoices(v("adam"), ann).map((c) => [c.role, c.asksOwner]),
    [
      ["member", false],
      ["manager", false],
      ["admin", true],
    ],
  );
  const second = { id: "beth", role: "admin" as const };
  assert.deepEqual(
    roleChoices(v("adam"), second).map((c) => c.asksOwner),
    [true, true, true],
    "removing an admin asks the owner",
  );
  assert.deepEqual(
    roleChoices(v("olive"), adam).map((c) => c.asksOwner),
    [false, false, false],
  );
  assert.deepEqual(roleChoices(v("adam"), adam), [], "not their own");
  assert.deepEqual(roleChoices(v("adam"), olive), [], "the owner's row never changes");
  assert.deepEqual(roleChoices(v("mia"), ann), []);
  assert.equal(roleLabel(olive), "Admin · owner");
  assert.equal(roleLabel(ann), "Agent");
});

test("sign-in links and off the board: an admin for agents and managers, the owner for an admin", () => {
  const ann = agents.find((a) => a.id === "ann")!;
  const mia = agents.find((a) => a.id === "mia")!;
  const adam = agents.find((a) => a.id === "adam")!;
  assert.equal(canManageAccess(v("adam"), ann), true);
  assert.equal(canManageAccess(v("adam"), mia), true);
  assert.equal(canManageAccess(v("adam"), { role: "admin" }), false);
  assert.equal(canManageAccess(v("olive"), adam), true);
  assert.equal(canManageAccess(v("mia"), ann), false);
  assert.equal(canManageAccess(v("adam"), null), false);
});

test("joiners: the upline they picked, a manager above that upline, or an admin confirms", () => {
  const jo = agents.find((a) => a.id === "jo")!;
  assert.equal(canConfirmJoiner(v("mia"), jo, ctx), true, "the upline they picked");
  assert.equal(canConfirmJoiner(v("tom"), jo, ctx), true, "a manager above that upline");
  assert.equal(canConfirmJoiner(v("adam"), jo, ctx), true, "an admin");
  assert.equal(canConfirmJoiner(v("ann"), jo, ctx), false);
  assert.equal(canConfirmJoiner(v("max"), jo, ctx), false, "another team's manager");
  assert.equal(canConfirmJoiner(TEAM, jo, ctx), false);
  // An agent picked as someone's upline answers for themself.
  const pickedBen = { upline_id: "ben", upline_confirmed: false };
  assert.equal(canConfirmJoiner(v("ben"), pickedBen, ctx), true);
  assert.equal(canConfirmJoiner(v("ann"), pickedBen, ctx), false);
  assert.equal(canConfirmJoiner(v("mia"), { upline_id: "mia", upline_confirmed: true }, ctx), false, "nothing waits");
  assert.deepEqual(joinersFor(v("mia"), ctx).map((a) => a.id), ["jo"]);
  assert.deepEqual(joinersFor(v("max"), ctx), []);
});

test("join links: an admin the agency's or any team's; a manager their own team's; an agent none", () => {
  assert.deepEqual(joinLinkChoices(v("adam")).map((c) => c.kind), ["agency", "team"]);
  assert.deepEqual(joinLinkChoices(v("mia")), [{ kind: "team", label: "A link for my team", leaderId: "mia" }]);
  assert.deepEqual(joinLinkChoices(v("ann")), []);
  assert.equal(canGetJoinLink(v("mia"), "mia"), true);
  assert.equal(canGetJoinLink(v("mia"), "max"), false);
  assert.equal(canGetJoinLink(v("mia"), null), false, "a manager never gets the agency link");
  assert.equal(canGetJoinLink(v("adam"), null), true);
});

test("Home's scopes: Me, the team, the agency; the team password a team and the agency", () => {
  assert.deepEqual(homeScopes(v("ann"), ctx).scopes.map((s) => s.label), ["Me", "Mia's team", "Agency"]);
  assert.equal(homeScopes(v("mia"), ctx).scopes[1].label, "My team");
  assert.equal(homeScopes(v("mia"), ctx).pickAnyTeam, false);
  assert.equal(homeScopes(v("adam"), ctx).pickAnyTeam, true);
  assert.deepEqual(homeScopes(TEAM, ctx).scopes.map((s) => s.id), ["team", "agency"]);
  // The waiting joiner is on nobody's team: "My team" is just them.
  assert.equal(homeScopes(v("jo"), ctx).scopes[1].label, "My team");
});

test("navigation: My policies for an agent, Settings for admins, Approvals for the owner, own sign-in for the team password", () => {
  const items = (vw: RuleViewer) => nav(vw).items.map((i) => i.label);
  const menu = (vw: RuleViewer) => nav(vw).menu.map((i) => i.label);
  assert.deepEqual(items(v("ann")), ["Home", "Scoreboard", "Log a sale", "My policies", "People"]);
  assert.equal(items(v("mia"))[3], "Policies");
  assert.ok(!menu(v("mia")).includes("Settings"));
  assert.ok(menu(v("adam")).includes("Settings") && !menu(v("adam")).includes("Approvals"));
  assert.ok(menu(v("olive")).includes("Approvals"));
  assert.ok(!menu(TEAM).includes("Your profile"));
  assert.ok(nav(TEAM).items.filter((i) => i.needsOwnSignIn).map((i) => i.id).join() === "log,policies");
});

test("who sees a policy's client, as the policy page lists them", () => {
  const s = clientSeers(policy("cal"), ctx);
  assert.equal(s.seller?.id, "cal");
  assert.deepEqual(
    s.uplines.map((a) => a.id),
    ["ben", "mia", "tom"],
    "nearest first, the admins apart",
  );
  assert.deepEqual(
    s.admins.map((a) => a.id),
    ["olive", "adam"],
    "the owner first",
  );
});
