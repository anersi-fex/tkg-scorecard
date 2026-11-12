"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui";
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
    <div className="mt-2.5 flex gap-2">
      <Button type="button" className="h-11 flex-1 rounded-xl" disabled={pending} onClick={() => decide(true)}>
        {pending ? "One moment..." : "Approve"}
      </Button>
      <Button type="button" variant="secondary" className="h-11 flex-1 rounded-xl" disabled={pending} onClick={() => decide(false)}>
        Decline
      </Button>
    </div>
  );
}
