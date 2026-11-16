import "server-only";
import { after } from "next/server";
import { MIN_GAP_MS, connected, runSync } from "./agentspace";

/**
 * Starts a sync from a page or the TV's poll, without anyone asking (owner, 2026-11-16: it should
 * happen "on its own, within minutes"). Cheap on purpose: the TV polls every 5 seconds, so this
 * does nothing but compare two numbers until a run is due (about every 4 minutes, per server
 * instance); only then does it schedule a run after the response, and the run reads the sync's row
 * and claims its lock before doing anything (so two instances never run at once, and an instance
 * that finds one not due or already running waits for the time the row names). Without
 * AGENTSPACE_API_KEY it returns at once and never reads the database.
 */
let nextCheckAt = 0;

export function maybeSync(): void {
  if (!connected()) return;
  const now = Date.now();
  if (now < nextCheckAt) return;
  nextCheckAt = now + MIN_GAP_MS;
  after(async () => {
    try {
      const r = await runSync();
      // Not due, or someone else is running: the row says when to look again.
      if (!r.ran && r.dueAt) nextCheckAt = Math.max(Date.now() + 15_000, r.dueAt);
    } catch (err) {
      console.error("agentspace_trigger_failed", err instanceof Error ? err.name : "error");
    }
  });
}
