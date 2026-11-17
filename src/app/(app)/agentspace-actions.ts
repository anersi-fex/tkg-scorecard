"use server";

import { revalidatePath } from "next/cache";
import { requireViewer } from "@/lib/auth";
import { lineFor } from "@/lib/data";
import { ERROR_LINE, connected, runSync, type RunCounts } from "@/lib/agentspace";

export type SyncNowResult = { ok: true; message: string } | { ok: false; error: string };

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** What a run did, in a short line: counts only. */
function countsLine(c: RunCounts): string {
  const parts = [
    c.inserted ? `${plural(c.inserted, "new policy", "new policies")}` : "",
    c.linked ? `${plural(c.linked, "linked", "linked")}` : "",
    c.updated ? `${plural(c.updated, "updated", "updated")}` : "",
    c.removed ? `${plural(c.removed, "taken off", "taken off")}` : "",
    c.revived ? `${plural(c.revived, "put back", "put back")}` : "",
    c.newAgents ? `${plural(c.newAgents, "new person", "new people")}` : "",
  ].filter(Boolean);
  const head = parts.length ? parts.join(", ") : "Nothing new";
  return c.stopped ? `${head}. Still working through the rest; it goes on by itself.` : `${head}.`;
}

/**
 * Settings > AgentSpace > Sync now (the owner and the admins). Runs a sync at once (the minimum
 * gap is ignored, a run already going is not) and says what it did, in counts. The key is read on
 * the server and never reaches the browser.
 */
export async function syncNow(): Promise<SyncNowResult> {
  try {
    await requireViewer("admin");
    if (!connected()) return { ok: false, error: "Not connected. Add AGENTSPACE_API_KEY in Vercel." };
    const result = await runSync({ force: true });
    revalidatePath("/settings");
    if (!result.ran) return result.why === "busy" ? { ok: true, message: "A sync is already running. Check back in a minute." } : { ok: false, error: "Not connected. Add AGENTSPACE_API_KEY in Vercel." };
    if (!result.ok) return { ok: false, error: ERROR_LINE[result.error] };
    revalidatePath("/", "layout");
    return { ok: true, message: countsLine(result.counts) };
  } catch (err) {
    return { ok: false, error: lineFor(err) };
  }
}
