import type { Metadata } from "next";
import "@/components/policy/policy.css";
import { pageViewer } from "@/lib/auth";
import { dbConfigured } from "@/lib/supabase";
import { canUsePolicies, nav } from "@/lib/rules";
import { PageHead } from "@/components/ui/kit";
import { OwnSignIn } from "@/components/policy/own-sign-in";
import { loadPolicyList } from "@/components/policy/list-data";
import { PoliciesView } from "./policies-view";

export const metadata: Metadata = { title: "Policies" };

/**
 * Policies, the CRM (contract decisions 4, 5 and 14): the rows this viewer may see, filtered,
 * searched and sorted on the server from the address, so the browser gets only the rows it shows
 * and the counts. An agent's list is "My policies"; a manager has Mine and My team; an admin Mine,
 * A team and Everyone. The shared team password gets "This needs your own sign-in."
 */
export default async function PoliciesPage({ searchParams }: PageProps<"/policies">) {
  const viewer = await pageViewer();
  const title = nav(viewer).items.find((i) => i.id === "policies")?.label ?? "Policies";
  if (!canUsePolicies(viewer)) return <OwnSignIn title="Policies" />;
  if (!dbConfigured()) return <PageHead title={title} />;
  const d = await loadPolicyList(viewer, await searchParams);
  return (
    <PoliciesView
      title={title}
      scopes={d.scopes}
      scope={d.scope}
      teamId={d.teamId}
      leaders={d.leaders}
      scopeNote={d.scopeNote}
      withAgent={d.withAgent}
      managerish={d.managerish}
      query={d.query}
      baseCount={d.baseCount}
      matched={d.matched}
      annualCents={d.annualCents}
      avgMonthlyCents={d.avgMonthlyCents}
      rows={d.rows}
      status={d.status}
      views={d.views}
      facets={d.facets}
      dateCounts={d.dateCounts}
      yesNo={d.yesNo}
    />
  );
}
