import type { Metadata } from "next";
import Link from "next/link";
import { pageViewer } from "@/lib/auth";
import { logout } from "@/app/login/actions";
import { isManager } from "@/lib/viewer";
import { dbConfigured } from "@/lib/supabase";
import { getSettings, listAgents } from "@/lib/data";
import { teamTones } from "@/components/avatar";
import { todayInDetroit } from "@/lib/month";
import { Notice, PageTitle } from "@/components/ui";
import { LogForm } from "./log-form";

export const metadata: Metadata = { title: "Log a sale" };

export default async function LogPage({ searchParams }: PageProps<"/log">) {
  const viewer = await pageViewer();
  const params = await searchParams;
  const preset = typeof params.agent === "string" ? params.agent : null;
  // A desk tag can open the form set to P&C (?kind=pc) on the owner's P&C days, while P&C is on.
  const askedPc = params.kind === "pc";
  if (!dbConfigured()) return <PageTitle>Log a sale</PageTitle>;
  const [agents, settings] = await Promise.all([listAgents(), getSettings()]);
  const tones = teamTones(agents);
  // Life only (owner, 2026-11-12): with the P&C board off nobody is offered P&C, so the form
  // shows no Life / P&C switch, no P&C carriers and no line, and ?kind=pc opens the life form.
  const pcOn = settings.pcEnabled === true;
  const presetKind = pcOn && askedPc ? "pc" : null;
  return (
    <>
      <PageTitle sub="It shows on the TV within a few seconds.">Log a sale</PageTitle>
      {agents.length === 0 ? (
        <Notice tone="amber">
          Nobody is on the team yet.{" "}
          {isManager(viewer) ? (
            <Link href="/team" className="font-semibold underline">
              Add your people first.
            </Link>
          ) : (
            "Ask an admin to add people."
          )}
        </Notice>
      ) : viewer.level === "team" && !settings.teamPasswordLogs ? (
        // The owner turned logging off for the shared password (Settings > Sign-ins): it only looks now.
        <Notice tone="amber">
          The team password only looks now. To log a sale, sign in with your own cell number and password.{" "}
          {/* A link to /login would bounce: this phone is signed in (with the team password), so it signs out first. */}
          <form action={logout} className="inline">
            <button type="submit" className="font-semibold underline">
              Sign out and sign in with your own number
            </button>
          </form>
          . No sign-in yet? Ask an admin for the join link.
        </Notice>
      ) : viewer.level === "member" && !agents.some((a) => a.id === viewer.agentId) ? (
        <Notice tone="amber">You are not on the board right now. Ask an admin to put you back, then you can log a sale.</Notice>
      ) : (
        <LogForm
          agents={agents.map((a) => ({ id: a.id, name: a.name, tone: tones[a.id], pcLicensed: pcOn && a.pc_licensed, inOffice: a.in_office === true }))}
          // A member logs for themselves only (the server holds them to it); the owner, an admin and the team password pick the person.
          self={viewer.level === "member" ? viewer.agentId : null}
          me={viewer.agentId}
          products={settings.products}
          carriers={settings.carriers}
          pcCarriers={pcOn ? settings.pcCarriers : []}
          today={todayInDetroit()}
          preset={preset}
          presetKind={presetKind}
        />
      )}
    </>
  );
}
