import { NextResponse } from "next/server";
import { createHash, timingSafeEqual } from "node:crypto";
import { currentViewer } from "@/lib/auth";
import { ERROR_LINE, connected, runSync } from "@/lib/agentspace";
import { isAdmin } from "@/lib/viewer";

export const dynamic = "force-dynamic";
/** A run stops starting new calls after about 45 seconds; the rest of the minute is for saving. */
export const maxDuration = 60;

function bearerOk(header: string | null): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const supplied = header?.replace(/^Bearer\s+/i, "").trim() ?? "";
  if (!supplied) return false;
  return timingSafeEqual(createHash("sha256").update(supplied).digest(), createHash("sha256").update(expected).digest());
}

/**
 * Runs the AgentSpace sync now (GET or POST): for a scheduler holding CRON_SECRET (Authorization:
 * Bearer), or the owner or an admin signed in. Answers counts only. The sync also runs on its own
 * (src/lib/agentspace-trigger.ts), so nothing has to call this.
 */
async function handle(request: Request) {
  // A session cookie counts for POST only: a GET can be sent by any page an admin opens (SameSite=Lax lets a link carry the cookie).
  const ok = bearerOk(request.headers.get("authorization")) || (request.method === "POST" && (await currentViewer().then((v) => !!v && isAdmin(v)).catch(() => false)));
  if (!ok) return NextResponse.json({ ok: false, error: "Not allowed" }, { status: 401, headers: { "Cache-Control": "private, no-store" } });
  if (!connected()) return NextResponse.json({ ok: false, connected: false, error: "Not connected" }, { headers: { "Cache-Control": "private, no-store" } });
  const result = await runSync({ force: true });
  const headers = { "Cache-Control": "private, no-store" };
  if (!result.ran) return NextResponse.json({ ok: false, connected: true, ran: false, why: result.why }, { headers });
  if (!result.ok) return NextResponse.json({ ok: false, connected: true, ran: true, error: result.error, message: ERROR_LINE[result.error], counts: result.counts }, { headers });
  return NextResponse.json({ ok: true, connected: true, ran: true, counts: result.counts }, { headers });
}

export const GET = handle;
export const POST = handle;
