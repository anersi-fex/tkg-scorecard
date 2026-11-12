"use server";

import { currentViewer } from "@/lib/auth";
import { countPendingApprovals } from "@/lib/approvals";
import { isOwner } from "@/lib/viewer";

/** How many requests wait for the owner's yes: the badge on the initials menu. 0 for anyone else, and when it cannot be read. */
export async function pendingApprovalCount(): Promise<number> {
  try {
    const viewer = await currentViewer();
    if (!viewer || !isOwner(viewer)) return 0;
    return await countPendingApprovals();
  } catch {
    return 0;
  }
}
