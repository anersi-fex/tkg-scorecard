"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/ui/icon";
import { btn } from "@/components/ui/kit";
import { toast } from "@/components/toaster";
import { APPROVALS_CHANGED } from "@/components/nav-bar";
import { decideApproval } from "../people-actions";

/** Approve or Decline one request. The server checks it is the owner and that nobody answered it first. */
export function ApprovalButtons({ id }: { id: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const decide = (approve: boolean) =>
    start(async () => {
      try {
        const r = await decideApproval(id, approve);
        toast(r.ok ? (r.message ?? (approve ? "Approved." : "Declined.")) : r.error, r.ok);
        router.refresh();
        // The badge on the initials counts again.
        window.dispatchEvent(new Event(APPROVALS_CHANGED));
      } catch {
        toast("Couldn't reach the server. Try again.", false);
      }
    });
  return (
    <div className="mt-4 flex flex-wrap gap-2">
      <button type="button" className={btn("primary")} disabled={pending} onClick={() => decide(true)}>
        <Icon name="check" size={17} />
        <span>{pending ? "One moment..." : "Approve"}</span>
      </button>
      <button type="button" className={btn("secondary")} disabled={pending} onClick={() => decide(false)}>
        Decline
      </button>
    </div>
  );
}
