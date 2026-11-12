import type { Metadata } from "next";
import { pageViewer } from "@/lib/auth";
import { isOwner } from "@/lib/viewer";
import { dbConfigured } from "@/lib/supabase";
import { getSettings, goalsForMonth } from "@/lib/data";
import { addMonths, monthKeyOf, monthLabel, todayInDetroit } from "@/lib/month";
import { PageTitle } from "@/components/ui";
import { appBase } from "@/lib/app-url";
import { LOG_TOKEN_MIN } from "@/lib/auth";
import { DEFAULT_PC_COLOR } from "@/lib/pc-colors";
import { SettingsForms } from "./settings-forms";

export const metadata: Metadata = { title: "Settings" };

/**
 * Settings by level (owner, 2026-11-12): the owner and the admins run the goals, the board, the
 * look, the TV and the agency's name. The sign-ins, the Shortcut and the last row are the
 * owner's alone, and what they would show is not even sent to an admin's screen. A member and
 * the team password cannot open this page.
 */
export default async function SettingsPage() {
  const viewer = await pageViewer("manager");
  const owner = isOwner(viewer);
  if (!dbConfigured()) return <PageTitle>Settings</PageTitle>;
  const month = monthKeyOf(todayInDetroit());
  const next = addMonths(month, 1);
  const [settings, goals, nextGoals] = await Promise.all([getSettings(), goalsForMonth(month), goalsForMonth(next)]);
  const token = owner ? (process.env.LOG_TOKEN ?? "") : "";
  return (
    <>
      <PageTitle sub={owner ? "You and the admins see this screen." : "Only the admins and Anersi see this screen."}>Settings</PageTitle>
      <SettingsForms
        // The P&C carriers, color and goals and the Sign-ins switch are the owner's: an admin's
        // screen is sent none of them (the color and the switch read as their defaults).
        settings={owner ? settings : { ...settings, pcCarriers: [], pcColor: DEFAULT_PC_COLOR, teamPasswordLogs: true }}
        months={[
          { key: month, label: monthLabel(month), cents: goals.teamCents, pcCents: owner ? goals.pcTeamCents : 0, current: true },
          { key: next, label: monthLabel(next), cents: nextGoals.teamCents, pcCents: owner ? nextGoals.pcTeamCents : 0, current: false },
        ]}
        shortcutReady={owner && token.length >= LOG_TOKEN_MIN}
        shortcutTooShort={owner && token.length > 0 && token.length < LOG_TOKEN_MIN}
        teamPasswordSet={owner && !!process.env.TEAM_PASSWORD}
        base={owner ? await appBase() : ""}
        owner={owner}
      />
    </>
  );
}
