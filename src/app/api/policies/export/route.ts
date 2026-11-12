import { NextResponse, type NextRequest } from "next/server";
import { currentViewer } from "@/lib/auth";
import { policiesCsv } from "@/lib/policy-filter";
import { canUsePolicies } from "@/lib/rules";
import { loadPolicyList } from "@/components/policy/list-data";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "private, no-store" };

/**
 * Policies as a CSV file: the same query as the page's address (scope, team, search, filters,
 * sort), every row it matches (not only the 25 shown), and only rows this viewer may see
 * (policies.ts listPoliciesFor). Formula-safe cells and a UTF-8 mark (policy-filter.ts
 * policiesCsv). 401 signed out; the shared team password is refused (contract decision 2).
 */
export async function GET(req: NextRequest) {
  const viewer = await currentViewer();
  if (!viewer) return NextResponse.json({ error: "Not signed in" }, { status: 401, headers: NO_STORE });
  if (!canUsePolicies(viewer)) return NextResponse.json({ error: "This needs your own sign-in." }, { status: 403, headers: NO_STORE });
  try {
    const d = await loadPolicyList(viewer, req.nextUrl.searchParams);
    const csv = policiesCsv(d.result.rows, { withAgent: d.withAgent });
    const name = `policies-${d.scope === "mine" ? "mine" : d.scope === "team" ? "team" : "everyone"}-${d.today}.csv`;
    return new NextResponse(`﻿${csv}`, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${name}"`,
        "X-Content-Type-Options": "nosniff",
        ...NO_STORE,
      },
    });
  } catch (err) {
    // The class only; never a row.
    console.error("policies_export_failed", err instanceof Error ? err.name : "error");
    return NextResponse.json({ error: "The database didn't answer" }, { status: 503, headers: NO_STORE });
  }
}
