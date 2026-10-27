import type { Metadata } from "next";
import Link from "next/link";
import { requirePage } from "@/lib/auth";
import { dbConfigured } from "@/lib/supabase";
import { getSettings, listAgents } from "@/lib/data";
import { teamTones } from "@/components/avatar";
import { todayInDetroit } from "@/lib/month";
import { Notice, PageTitle } from "@/components/ui";
import { LogForm } from "./log-form";

export const metadata: Metadata = { title: "Log a sale" };

export default async function LogPage({ searchParams }: PageProps<"/log">) {
  const role = await requirePage();
  const params = await searchParams;
  const preset = typeof params.agent === "string" ? params.agent : null;
  if (!dbConfigured()) return <PageTitle>Log a sale</PageTitle>;
  const [agents, settings] = await Promise.all([listAgents(), getSettings()]);
  const tones = teamTones(agents);
  return (
    <>
      <PageTitle sub="It shows on the TV within a few seconds.">Log a sale</PageTitle>
      {agents.length === 0 ? (
        <Notice tone="amber">
          Nobody is on the team yet.{" "}
          {role === "owner" ? (
            <Link href="/team" className="font-semibold underline">
              Add your people first.
            </Link>
          ) : (
            "Ask Anersi to add the team."
          )}
        </Notice>
      ) : (
        <LogForm agents={agents.map((a) => ({ id: a.id, name: a.name, tone: tones[a.id] }))} products={settings.products} carriers={settings.carriers} today={todayInDetroit()} preset={preset} />
      )}
    </>
  );
}
