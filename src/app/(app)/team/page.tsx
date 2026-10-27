import type { Metadata } from "next";
import { requirePage } from "@/lib/auth";
import { dbConfigured } from "@/lib/supabase";
import { goalsForMonth, listAgents, salesForMonth } from "@/lib/data";
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
  const [agents, sales, goals] = await Promise.all([listAgents({ includeInactive: true }), salesForMonth(month), goalsForMonth(month)]);
  const tones = teamTones(agents);
  const totals = new Map<string, { cents: number; policies: number }>();
  for (const s of sales) {
    const t = totals.get(s.agent_id) ?? { cents: 0, policies: 0 };
    t.cents += s.premium_cents;
    t.policies += s.policies;
    totals.set(s.agent_id, t);
  }
  const people = agents.map((a) => ({
    id: a.id,
    name: a.name,
    active: a.active,
    tone: tones[a.id],
    cents: totals.get(a.id)?.cents ?? 0,
    policies: totals.get(a.id)?.policies ?? 0,
    goalCents: goals.byAgent[a.id] ?? 0,
  }));
  const base = await appBase();
  return (
    <>
      <PageTitle sub={`${monthLabel(month)} so far`}>Team</PageTitle>
      <TeamEditor people={people} role={role} month={month} base={base} />
    </>
  );
}
