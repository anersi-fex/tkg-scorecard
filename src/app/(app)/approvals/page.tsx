import type { Metadata } from "next";
import { pageViewer } from "@/lib/auth";
import { dbConfigured } from "@/lib/supabase";
import { listApprovals, type Approval } from "@/lib/approvals";
import { ListCard, ListTitle } from "@/components/tide";
import { PageTitle, formatDateTime } from "@/components/ui";
import { ApprovalButtons } from "./approval-buttons";

export const metadata: Metadata = { title: "Approvals" };

const DECIDED_SHOWN = 20;

/**
 * The owner's inbox (owner, 2026-11-12: "if unsure about privileges or permissions, then make it
 * so that that's something that I need to approve ... through my login portal"): what an admin
 * asked for that waits for a yes, each in one sentence, then the last ones answered. Owner only.
 */
export default async function ApprovalsPage() {
  await pageViewer("owner");
  if (!dbConfigured()) return <PageTitle>Approvals</PageTitle>;
  let all: Approval[] = [];
  let failed = false;
  try {
    all = await listApprovals();
  } catch {
    failed = true;
  }
  const waiting = all.filter((a) => a.status === "pending");
  const decided = all.filter((a) => a.status !== "pending").slice(0, DECIDED_SHOWN);
  const who = (a: Approval) => `${a.requested_by_name ?? "An admin"} asked · ${formatDateTime(a.requested_at)}`;
  return (
    <>
      <PageTitle sub="What an admin asked for that needs your yes.">Approvals</PageTitle>
      <div className="space-y-6">
        <section data-approvals-waiting>
          <ListTitle count={waiting.length}>Waiting for you</ListTitle>
          <ListCard className="mt-2">
            {failed && <li className="px-4 py-5 text-[14px] text-gray-600">The requests could not be read just now. Pull down to try again.</li>}
            {!failed && waiting.length === 0 && <li className="px-4 py-5 text-[14px] text-gray-600">Nothing is waiting. You are all caught up.</li>}
            {waiting.map((a) => (
              <li key={a.id} data-approval={a.id} className="relative px-4 py-3 not-first:before:absolute not-first:before:top-0 not-first:before:right-0 not-first:before:left-4 not-first:before:h-px not-first:before:bg-line">
                <p className="text-[15.5px] leading-snug font-bold text-gray-900">{a.summary}</p>
                <p className="mt-0.5 text-[13px] font-medium text-gray-500">{who(a)}</p>
                <ApprovalButtons id={a.id} />
              </li>
            ))}
          </ListCard>
          <p className="mt-2 px-1 text-[12.5px] font-medium text-gray-500">Nothing changes until you approve. Admins ask you before making or removing an admin, and before changing a sale of a past month.</p>
        </section>

        {decided.length > 0 && (
          <section data-approvals-decided>
            <ListTitle>Answered</ListTitle>
            <ListCard className="mt-2">
              {decided.map((a) => (
                <li key={a.id} className="relative flex items-start gap-3 px-4 py-2.5 not-first:before:absolute not-first:before:top-0 not-first:before:right-0 not-first:before:left-4 not-first:before:h-px not-first:before:bg-line">
                  <div className="min-w-0 flex-1">
                    <p className="text-[14px] leading-snug font-semibold text-gray-500">{a.summary}</p>
                    <p className="mt-0.5 text-[12.5px] font-medium text-gray-400">
                      {who(a)}
                      {a.decided_at ? ` · answered ${formatDateTime(a.decided_at)}` : ""}
                    </p>
                  </div>
                  <span className="mt-0.5 shrink-0 rounded-full bg-gray-100 px-2 py-0.5 text-[11.5px] font-bold text-gray-600">{a.status === "approved" ? "Approved" : "Declined"}</span>
                </li>
              ))}
            </ListCard>
          </section>
        )}
      </div>
    </>
  );
}
