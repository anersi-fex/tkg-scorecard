import type { Metadata } from "next";
import { requirePage } from "@/lib/auth";
import { dbConfigured } from "@/lib/supabase";
import { getSettings, goalsForMonth, listAgents, salesForMonth } from "@/lib/data";
import { monthKeyOf, monthLabel, todayInDetroit } from "@/lib/month";
import { teamTones } from "@/components/avatar";
import { PageTitle } from "@/components/ui";
import { appBase } from "@/lib/app-url";
import { TeamEditor } from "./team-editor";

export const metadata: Metadata = { title: "Team" };

export default async function TeamPage() {
  const role = await requirePage();
  if (!dbConfigured()) return <PageTitle>Team</PageTitle>;
  const today = todayInDetroit();
  const month = monthKeyOf(today);
  const [agents, allSales, goals, settings] = await Promise.all([listAgents({ includeInactive: true }), salesForMonth(month), goalsForMonth(month), getSettings()]);
  // Life only (owner, 2026-11-12): with the P&C board off, P&C sales and goals are left out before
  // any adding up, and the page shows no P&C tag, switch, goal or desk link.
  const pcOn = settings.pcEnabled === true;
  const sales = pcOn ? allSales : allSales.filter((s) => s.kind !== "pc");
  const tones = teamTones(agents);
  const totals = new Map<string, { cents: number; policies: number; pcCents: number }>();
  for (const s of sales) {
    const t = totals.get(s.agent_id) ?? { cents: 0, policies: 0, pcCents: 0 };
    t.cents += s.premium_cents;
    t.policies += s.policies;
    if (s.kind === "pc") t.pcCents += s.premium_cents;
    totals.set(s.agent_id, t);
  }
  const people = agents.map((a) => ({
    id: a.id,
    name: a.name,
    active: a.active,
    pcLicensed: pcOn && a.pc_licensed,
    tone: tones[a.id],
    cents: totals.get(a.id)?.cents ?? 0,
    policies: totals.get(a.id)?.policies ?? 0,
    pcCents: totals.get(a.id)?.pcCents ?? 0,
    goalCents: goals.byAgent[a.id] ?? 0,
    pcGoalCents: pcOn ? (goals.pcByAgent[a.id] ?? 0) : 0,
  }));
  const base = await appBase();
  return (
    <>
      <PageTitle sub={`${monthLabel(month)} so far`}>Team</PageTitle>
      <TeamEditor people={people} role={role} month={month} base={base} pcEnabled={pcOn} />
    </>
  );
}
