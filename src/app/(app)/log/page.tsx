import type { Metadata } from "next";
import "@/components/policy/policy.css";
import { pageViewer } from "@/lib/auth";
import { dbConfigured } from "@/lib/supabase";
import { getSettings } from "@/lib/data";
import { loadMonthSnapshot } from "@/lib/board";
import { loadRuleContext } from "@/lib/policies";
import { canUsePolicies, logForChoices, roleLabel } from "@/lib/rules";
import { isAdmin } from "@/lib/viewer";
import { monthKeyOf, todayInDetroit } from "@/lib/month";
import { EmptyState, PageHead } from "@/components/ui/kit";
import { OwnSignIn } from "@/components/policy/own-sign-in";
import type { BoardLine } from "@/components/policy/format";
import { LogForm, type WhoChoice } from "./log-form";
import { LogDone } from "./log-done";

export const metadata: Metadata = { title: "Log a sale" };

/**
 * Log a sale (the demo the owner approved, 2026-11-12): three steps, then /log?done=<id> says where
 * the sale landed. Who it can be for comes from the rules (an agent themself, a manager their
 * confirmed team, an admin anyone on the board); the server holds every step to the same rules.
 * The shared team password gets "This needs your own sign-in." A desk tag's ?agent=<id> picks that
 * person for someone who may log for them (an agent's own sale is always their own).
 */
export default async function LogPage({ searchParams }: PageProps<"/log">) {
  const viewer = await pageViewer();
  if (!canUsePolicies(viewer)) return <OwnSignIn title="Log a sale" />;
  const params = await searchParams;
  if (!dbConfigured()) return <PageHead title="Log a sale" />;
  const done = typeof params.done === "string" ? params.done : null;
  if (done) return <LogDone viewer={viewer} id={done} />;

  const today = todayInDetroit();
  const month = monthKeyOf(today);
  const [ctx, settings, snapshot] = await Promise.all([
    loadRuleContext(),
    getSettings(),
    // The board as it stands, for the side's "On the board" line (numbers only); the form works without it.
    loadMonthSnapshot(month, { today, recentLimit: 1, scoreboard: false }).catch((err: unknown) => {
      console.error("log_board_failed", err instanceof Error ? err.name : "error");
      return null;
    }),
  ]);
  const people = logForChoices(viewer, ctx);
  if (people.length === 0) {
    return (
      <div className="page log-page">
        <PageHead title="Log a sale" />
        <section className="card">
          <EmptyState icon="user" title="You're not on the board right now" body="Ask an admin to put you back, then you can log a sale." />
        </section>
      </div>
    );
  }
  const choices: WhoChoice[] = people.map((a) => ({ id: a.id, name: a.name, line: roleLabel(a), inOffice: a.in_office === true }));
  const asked = typeof params.agent === "string" ? params.agent : null;
  const me = viewer.agentId && choices.some((c) => c.id === viewer.agentId) ? viewer.agentId : null;
  const preset = choices.length === 1 ? choices[0].id : asked && choices.some((c) => c.id === asked) ? asked : me;
  const board: BoardLine[] = (snapshot?.agents ?? []).map((a) => ({ id: a.id, name: a.name, cents: a.lifeCents, policies: a.lifePolicies }));
  return (
    <div className="page log-page">
      <LogForm
        // A new key per preset: a desk tag opened in the same tab starts a fresh draft for its person.
        key={preset ?? "none"}
        me={me}
        anyone={isAdmin(viewer)}
        choices={choices}
        preset={preset}
        lists={{ carrierProducts: settings.carrierProducts, rateClasses: settings.rateClasses, leadSources: settings.leadSources }}
        today={today}
        month={month}
        board={board}
      />
    </div>
  );
}
