import type { Metadata } from "next";
import { pageViewer } from "@/lib/auth";
import { dbConfigured } from "@/lib/supabase";
import { getSettings, goalsForMonth, listAgents, salesForMonth } from "@/lib/data";
import { listPeople } from "@/lib/people";
import { listApprovals } from "@/lib/approvals";
import { formatPhone } from "@/lib/phone";
import { isAdmin, isOwner } from "@/lib/viewer";
import type { Agent } from "@/lib/types";
import { addDays, monthKeyOf, todayInDetroit } from "@/lib/month";
import { canEditPerson, canManageAccess, joinersFor, roleChoices, ruleContext, teamName } from "@/lib/rules";
import { formatDollars } from "@/lib/money";
import { formatDate } from "@/components/ui";
import { PageHead } from "@/components/ui/kit";
import { teamTones } from "@/components/avatar";
import { appBase } from "@/lib/app-url";
import { getJoinLink } from "../people-actions";
import { TeamEditor, type JoinerRow, type PersonRow, type TeamSummary } from "./team-editor";

export const metadata: Metadata = { title: "People" };

const first = (name: string | null | undefined) => String(name ?? "").trim().split(/\s+/)[0] ?? "";

/**
 * People (the demo the owner approved on 2026-11-12): the directory everyone sees (by team, the
 * confirmed tree; search; All or In the office), and by level: a manager confirms the joiners who
 * picked them or someone under them and shares a link for their own team; an admin runs everyone
 * (the join links, new this week, add a person, off the board, each person's card). A cell number
 * is read and sent only to an admin's screen.
 */
export default async function PeoplePage() {
  const viewer = await pageViewer();
  if (!dbConfigured())
    return (
      <div className="page">
        <PageHead title="People" />
      </div>
    );
  const admin = isAdmin(viewer);
  const manager = viewer.level === "manager" && !!viewer.agentId;
  const today = todayInDetroit();
  const month = monthKeyOf(today);
  const [everyone, allSales, goals, settings, joinLink, approvals] = await Promise.all([
    admin ? listPeople({ includeInactive: true }) : (listAgents({ includeInactive: true }) as Promise<Array<Agent & { phone?: string | null }>>),
    salesForMonth(month),
    goalsForMonth(month),
    getSettings(),
    admin ? getJoinLink() : manager ? getJoinLink(viewer.agentId) : null,
    admin ? listApprovals("pending").catch(() => []) : Promise.resolve([]),
  ]);
  // Life only while the P&C board is off: P&C sales and goals are left out before any adding up.
  const pcOn = settings.pcEnabled === true;
  const sales = pcOn ? allSales : allSales.filter((x) => x.kind !== "pc");
  const tones = teamTones(everyone);
  const totals = new Map<string, { cents: number; policies: number; pcCents: number }>();
  for (const x of sales) {
    const t = totals.get(x.agent_id) ?? { cents: 0, policies: 0, pcCents: 0 };
    t.cents += x.premium_cents;
    t.policies += x.policies;
    if (x.kind === "pc") t.pcCents += x.premium_cents;
    totals.set(x.agent_id, t);
  }
  // Teams are the confirmed tree (contract decision 6): a joiner waiting for their upline is on nobody's team.
  const ctx = ruleContext(everyone);
  const org = ctx.org;
  const activeIds = new Set(everyone.filter((a) => a.active).map((a) => a.id));
  const weekAgo = addDays(today, -7);
  // What an admin asked the owner about a person's level, still waiting.
  const pendingRole = new Map<string, string>();
  for (const ap of approvals) {
    const id = typeof ap.payload?.agent_id === "string" ? ap.payload.agent_id : null;
    if (id && (ap.kind === "make_admin" || ap.kind === "remove_admin")) pendingRole.set(id, ap.kind === "make_admin" ? "Waiting for Anersi: making them an admin." : "Waiting for Anersi: taking away their admin role.");
  }
  // A joiner waiting for their upline is on the board (contract decision 6) and on nobody's team:
  // under "Wants to join" for whoever can confirm them, in the directory (no team) for everyone else.
  const waitingRows = joinersFor(viewer, ctx);
  const waitingIds = new Set(waitingRows.map((a) => a.id));
  const people: PersonRow[] = everyone
    // Someone off the board is listed only for an admin (to put them back).
    .filter((a) => (a.active || admin) && !waitingIds.has(a.id))
    .map((a) => {
      const leader = a.active && org.isLeader(a.id);
      const team = leader ? org.teamOf(a.id) : [];
      const parentId = org.uplineChain(a.id).find((id) => activeIds.has(id)) ?? null;
      return {
        id: a.id,
        name: a.name,
        active: a.active,
        tone: tones[a.id],
        inOffice: a.in_office === true,
        role: a.role ?? "member",
        uplineId: org.uplineOf(a.id),
        parentId,
        parentTeam: parentId ? teamName(parentId, ctx) : null,
        cents: totals.get(a.id)?.cents ?? 0,
        policies: totals.get(a.id)?.policies ?? 0,
        goalCents: goals.byAgent[a.id] ?? 0,
        leader,
        teamSize: leader ? org.membersOf(a.id).length : 0,
        teamCents: team.reduce((n, id) => n + (totals.get(id)?.cents ?? 0), 0),
        teamPolicies: team.reduce((n, id) => n + (totals.get(id)?.policies ?? 0), 0),
        pcLicensed: pcOn && a.pc_licensed,
        pcCents: totals.get(a.id)?.pcCents ?? 0,
        pcGoalCents: pcOn ? (goals.pcByAgent[a.id] ?? 0) : 0,
        // Admins only: the cell number, the sign-in mark and when they joined.
        phone: admin ? formatPhone(a.phone ?? null) : "",
        hasLogin: admin ? a.has_login === true : false,
        joinedThisWeek: admin && typeof a.joined_at === "string" && todayInDetroit(new Date(a.joined_at)) >= weekAgo,
        joinedAt: admin ? (a.joined_at ?? null) : null,
        canEdit: canEditPerson(viewer, a),
        canAccess: canManageAccess(viewer, a),
        roles: roleChoices(viewer, a),
        pendingRole: pendingRole.get(a.id) ?? null,
      };
    });
  const joiners: JoinerRow[] = waitingRows.map((a) => {
    const up = a.upline_id ? ctx.byId.get(a.upline_id) : undefined;
    return {
      id: a.id,
      name: a.name,
      inOffice: a.in_office === true,
      uplineName: up?.name ?? "someone",
      uplineFirst: first(up?.name),
      pickedMe: a.upline_id === viewer.agentId,
      signedUp: a.joined_at ? (todayInDetroit(new Date(a.joined_at)) === today ? "today" : formatDate(a.joined_at, { year: false })) : null,
      phone: admin ? formatPhone((a as Agent & { phone?: string | null }).phone ?? null) : "",
    };
  });
  const teams: TeamSummary[] = org
    .leaders()
    .map((id) => {
      const ids = org.teamOf(id);
      const sold = ids.filter((x) => (totals.get(x)?.policies ?? 0) > 0).length;
      return {
        leaderId: id,
        name: teamName(id, ctx),
        people: org.membersOf(id).length,
        sold,
        policies: ids.reduce((n, x) => n + (totals.get(x)?.policies ?? 0), 0),
        cents: ids.reduce((n, x) => n + (totals.get(x)?.cents ?? 0), 0),
      };
    })
    .sort((a, b) => b.cents - a.cents || b.people - a.people || a.name.localeCompare(b.name));
  const listed = people.filter((p) => p.active);
  // The head counts everyone on the board: the directory and the joiners under "Wants to join".
  const onBoard = [...listed.map((p) => p.id), ...waitingRows.filter((a) => a.active).map((a) => a.id)];
  const sold = onBoard.filter((id) => (totals.get(id)?.policies ?? 0) > 0).length;
  const notJoined = admin ? listed.filter((p) => !p.hasLogin).length : 0;
  const totalCents = onBoard.reduce((n, id) => n + (totals.get(id)?.cents ?? 0), 0);
  const totalPolicies = onBoard.reduce((n, id) => n + (totals.get(id)?.policies ?? 0), 0);
  const base = admin ? await appBase() : "";
  // The shared team password sees names and teams only, no numbers (contract decision 2): none are sent.
  const shared = viewer.level === "team";
  const quiet = <T extends object>(rows: T[], keys: Array<keyof T>): T[] => (shared ? rows.map((r) => ({ ...r, ...Object.fromEntries(keys.map((k) => [k, 0])) })) : rows);
  return (
    <div className="page">
      <TeamEditor
        head={{ people: onBoard.length, sold: shared ? 0 : sold, notJoined, cents: shared ? "" : formatDollars(totalCents), policies: shared ? 0 : totalPolicies }}
        people={quiet(people, ["cents", "policies", "goalCents", "teamCents", "teamPolicies", "pcCents", "pcGoalCents"])}
        joiners={joiners}
        teams={quiet(teams, ["sold", "policies", "cents"])}
        numbers={!shared}
        level={viewer.level}
        owner={isOwner(viewer)}
        viewerId={viewer.agentId}
        month={month}
        base={base}
        pcEnabled={pcOn}
        agency={settings.agencyName}
        joinUrl={joinLink?.ok ? joinLink.url : null}
        joinError={joinLink && !joinLink.ok ? joinLink.error : null}
      />
    </div>
  );
}
