import type { Metadata } from "next";
import { pageViewer } from "@/lib/auth";
import { dbConfigured } from "@/lib/supabase";
import { getSettings, goalsForMonth, listAgents, salesForMonth } from "@/lib/data";
import { listPeople } from "@/lib/people";
import { buildOrg } from "@/lib/org";
import { formatPhone } from "@/lib/phone";
import { isAdmin, isOwner } from "@/lib/viewer";
import type { Agent } from "@/lib/types";
import { addDays, monthKeyOf, monthLabel, todayInDetroit } from "@/lib/month";
import { teamTones } from "@/components/avatar";
import { PageTitle } from "@/components/ui";
import { appBase } from "@/lib/app-url";
import { getJoinLink } from "../people-actions";
import { TeamEditor, type PersonRow } from "./team-editor";

export const metadata: Metadata = { title: "People" };

/**
 * People (owner, 2026-11-12: "I would like to make this for everyone"): the directory everyone
 * sees (search, in the office or everyone, people grouped by team, each with their month so far)
 * and, for the owner and the admins, the controls on each person, the join link and who joined
 * this week. A phone number and the sign-in mark are read and sent only for a manager.
 */
export default async function PeoplePage() {
  const viewer = await pageViewer();
  if (!dbConfigured()) return <PageTitle>People</PageTitle>;
  const manager = isAdmin(viewer);
  const today = todayInDetroit();
  const month = monthKeyOf(today);
  const [everyone, allSales, goals, settings, joinLink] = await Promise.all([
    manager ? listPeople({ includeInactive: true }) : (listAgents({ includeInactive: true }) as Promise<Array<Agent & { phone?: string | null }>>),
    salesForMonth(month),
    goalsForMonth(month),
    getSettings(),
    manager ? getJoinLink() : null,
  ]);
  // Life only (owner, 2026-11-12): with the P&C board off, P&C sales and goals are left out before
  // any adding up, and the page shows no P&C tag, switch, goal or desk link.
  const pcOn = settings.pcEnabled === true;
  const sales = pcOn ? allSales : allSales.filter((s) => s.kind !== "pc");
  const tones = teamTones(everyone);
  const totals = new Map<string, { cents: number; policies: number; pcCents: number }>();
  for (const s of sales) {
    const t = totals.get(s.agent_id) ?? { cents: 0, policies: 0, pcCents: 0 };
    t.cents += s.premium_cents;
    t.policies += s.policies;
    if (s.kind === "pc") t.pcCents += s.premium_cents;
    totals.set(s.agent_id, t);
  }
  // Teams come from the upline (contract decision 6): a team is the leader and everyone below.
  const org = buildOrg(everyone);
  const activeIds = new Set(everyone.filter((a) => a.active).map((a) => a.id));
  // "New this week": joined in the last 7 days (the day they joined, against today in Detroit).
  const weekAgo = addDays(today, -7);
  const people: PersonRow[] = everyone
    // Someone off the board is listed only for a manager (to put them back).
    .filter((a) => a.active || manager)
    .map((a) => {
      const leader = a.active && org.isLeader(a.id);
      const team = leader ? org.teamOf(a.id) : [];
      return {
        id: a.id,
        name: a.name,
        active: a.active,
        tone: tones[a.id],
        inOffice: a.in_office === true,
        role: a.role ?? "member",
        uplineId: org.uplineOf(a.id),
        // Where they sit in the list: under their nearest upline who is on the board.
        parentId: org.uplineChain(a.id).find((id) => activeIds.has(id)) ?? null,
        cents: totals.get(a.id)?.cents ?? 0,
        policies: totals.get(a.id)?.policies ?? 0,
        goalCents: goals.byAgent[a.id] ?? 0,
        leader,
        teamSize: leader ? org.membersOf(a.id).length : 0,
        teamCents: team.reduce((sum, id) => sum + (totals.get(id)?.cents ?? 0), 0),
        teamPolicies: team.reduce((sum, id) => sum + (totals.get(id)?.policies ?? 0), 0),
        pcLicensed: pcOn && a.pc_licensed,
        pcCents: totals.get(a.id)?.pcCents ?? 0,
        pcGoalCents: pcOn ? (goals.pcByAgent[a.id] ?? 0) : 0,
        // Managers only: the cell number, the sign-in mark and when they joined.
        phone: manager ? formatPhone(a.phone ?? null) : "",
        hasLogin: manager ? a.has_login === true : false,
        joinedThisWeek: manager && typeof a.joined_at === "string" && todayInDetroit(new Date(a.joined_at)) >= weekAgo,
        joinedAt: manager ? (a.joined_at ?? null) : null,
      };
    });
  const base = manager ? await appBase() : "";
  return (
    <>
      <PageTitle sub={`${monthLabel(month)} so far`}>People</PageTitle>
      <TeamEditor
        people={people}
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
    </>
  );
}
