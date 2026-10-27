import type { Metadata } from "next";
import { requirePage } from "@/lib/auth";
import { dbConfigured } from "@/lib/supabase";
import { getSettings, goalsForMonth } from "@/lib/data";
import { addMonths, monthKeyOf, monthLabel, todayInDetroit } from "@/lib/month";
import { PageTitle } from "@/components/ui";
import { SettingsForms } from "./settings-forms";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  await requirePage("owner");
  if (!dbConfigured()) return <PageTitle>Settings</PageTitle>;
  const month = monthKeyOf(todayInDetroit());
  const next = addMonths(month, 1);
  const [settings, goals, nextGoals] = await Promise.all([getSettings(), goalsForMonth(month), goalsForMonth(next)]);
  return (
    <>
      <PageTitle sub="Only you see this screen.">Settings</PageTitle>
      <SettingsForms
        settings={settings}
        months={[
          { key: month, label: monthLabel(month), cents: goals.teamCents, current: true },
          { key: next, label: monthLabel(next), cents: nextGoals.teamCents, current: false },
        ]}
        shortcutReady={!!process.env.LOG_TOKEN}
        teamPasswordSet={!!process.env.TEAM_PASSWORD}
        base={process.env.APP_URL?.replace(/\/$/, "") ?? ""}
      />
    </>
  );
}
