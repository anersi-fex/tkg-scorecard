import type { Metadata } from "next";
import { pageViewer } from "@/lib/auth";
import { dbConfigured } from "@/lib/supabase";
import { listApprovals, type Approval } from "@/lib/approvals";
import { listAgents } from "@/lib/data";
import { formatDateTime } from "@/components/ui";
import { Icon, type IconName } from "@/components/ui/icon";
import { CountBadge, PageHead, Panel, Pill, RoleTag } from "@/components/ui/kit";
import { ApprovalButtons } from "./approval-buttons";

export const metadata: Metadata = { title: "Approvals" };

const DECIDED_SHOWN = 20;

const KIND_LABEL: Record<Approval["kind"], string> = {
  make_admin: "Making someone an admin",
  remove_admin: "Taking away an admin's role",
  edit_past_sale: "Fixing a sale of a past month",
  remove_past_sale: "Removing a sale of a past month",
};

const COMES_HERE: Array<{ icon: IconName; title: string; body?: string }> = [
  { icon: "shield", title: "Making someone an admin.", body: "Jack or another admin asks; you decide." },
  { icon: "pencil", title: "Fixing a sale of a past month.", body: "The one line names everything it changes." },
  { icon: "trash", title: "Removing a sale of a past month." },
];

/**
 * The owner's inbox (owner, 2026-11-12: "if unsure about privileges or permissions, then make it
 * so that that's something that I need to approve ... through my login portal"): what an admin
 * asked for that waits for a yes, each in one sentence, then the last ones answered. Owner only.
 */
export default async function ApprovalsPage() {
  await pageViewer("owner");
  if (!dbConfigured())
    return (
      <div className="page">
        <PageHead title="Approvals" />
      </div>
    );
  let all: Approval[] = [];
  let failed = false;
  const [list, agents] = await Promise.all([listApprovals().catch(() => null), listAgents().catch(() => [])]);
  if (list) all = list;
  else failed = true;
  const waiting = all.filter((a) => a.status === "pending");
  const decided = all.filter((a) => a.status !== "pending").slice(0, DECIDED_SHOWN);
  const who = (a: Approval) => `${a.requested_by_name ?? "An admin"} asked · ${formatDateTime(a.requested_at)}`;
  const admins = agents.filter((a) => a.active && (a.role === "owner" || a.role === "admin")).sort((a, b) => (a.role === "owner" ? -1 : b.role === "owner" ? 1 : a.name.localeCompare(b.name)));
  return (
    <div className="page">
      <PageHead title="Approvals" sub="What an admin asked for that needs your yes." />
      <div className="cols" style={{ ["--cols" as string]: "minmax(0, 1fr) 380px" }}>
        <div className="col">
          <Panel
            title={
              <span className="inline-flex items-center gap-2">
                Waiting for you
                <CountBadge n={waiting.length} />
              </span>
            }
            sub="Nothing changes until you approve."
            data-approvals-waiting
          >
            {failed && <p className="muted">The requests could not be read just now. Try again in a moment.</p>}
            {!failed && waiting.length === 0 && <p className="muted">Nothing is waiting. You&apos;re all caught up.</p>}
            <div className="stack lg">
              {waiting.map((a) => (
                <div key={a.id} data-approval={a.id} className="border-t border-line pt-4 first:border-t-0 first:pt-0">
                  <p className="small muted">{KIND_LABEL[a.kind] ?? "A request"}</p>
                  <p className="mt-1 text-[17px] leading-snug font-medium">{a.summary}.</p>
                  <p className="mt-1 small muted">{who(a)}</p>
                  <ApprovalButtons id={a.id} />
                </div>
              ))}
            </div>
          </Panel>
          <Panel title="Answered" data-approvals-decided>
            {decided.length === 0 ? (
              <p className="muted">Nothing answered yet. What you approve or decline lands here.</p>
            ) : (
              <div className="list">
                {decided.map((a) => (
                  <div key={a.id} className="list-row">
                    <span className="lr-main">
                      <span className="lr-title wrap-text">{a.summary}</span>
                      <span className="lr-sub">
                        {who(a)}
                        {a.decided_at ? ` · answered ${formatDateTime(a.decided_at)}` : ""}
                      </span>
                    </span>
                    <Pill tone={a.status === "approved" ? "up" : "dim"}>{a.status === "approved" ? "Approved" : "Declined"}</Pill>
                  </div>
                ))}
              </div>
            )}
          </Panel>
        </div>
        <div className="col">
          <Panel title="Admins now" sub="Who runs people, goals and settings">
            <div className="list">
              {admins.map((a) => (
                <div key={a.id} className="list-row">
                  <span className="lr-main">
                    <span className="lr-title">{a.name}</span>
                    <span className="lr-sub">{a.role === "owner" ? "The owner" : "Admin"}</span>
                  </span>
                  <RoleTag level={a.role === "owner" ? "owner" : "admin"} />
                </div>
              ))}
            </div>
          </Panel>
          <Panel title="What comes here">
            <div className="list">
              {COMES_HERE.map((c) => (
                <div key={c.title} className="list-row items-start">
                  <span className="lr-lead muted pt-0.5">
                    <Icon name={c.icon} size={16} />
                  </span>
                  <span className="lr-main">
                    <span className="wrap-text small">
                      <b className="strong">{c.title}</b> {c.body && <span className="muted">{c.body}</span>}
                    </span>
                  </span>
                </div>
              ))}
            </div>
            <p className="mt-3 border-t border-line pt-3 small muted">Only you see this page. The count on your initials shows what&apos;s waiting.</p>
          </Panel>
        </div>
      </div>
    </div>
  );
}
