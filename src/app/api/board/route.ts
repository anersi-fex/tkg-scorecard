import { NextResponse } from "next/server";
import { currentRole } from "@/lib/auth";
import { boardStamp, loadMonthSnapshot } from "@/lib/board";
import { monthKeyOf, todayInDetroit } from "@/lib/month";

export const dynamic = "force-dynamic";

/**
 * The board's live feed: the current month's snapshot, for a signed-in viewer (the TV polls it).
 * It carries the Scoreboard (`scoreboard`) and never a phone number or a sign-in detail: the
 * snapshot and the Scoreboard are built field by field from rows read without those columns.
 * `?stamp=` (what the TV got with its last full answer): while nothing it shows has changed the
 * answer is 204 with no body, after three tiny reads (see boardStamp).
 */
export async function GET(request: Request) {
  if (!(await currentRole())) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  try {
    const today = todayInDetroit();
    // If the stamp cannot be read the feed still answers in full, without one.
    const stamp = await boardStamp(today).catch(() => null);
    const held = new URL(request.url).searchParams.get("stamp");
    if (stamp && held === stamp) return new NextResponse(null, { status: 204, headers: { "Cache-Control": "private, no-store" } });
    const snapshot = await loadMonthSnapshot(monthKeyOf(today), { today, recentLimit: 12 });
    // The TV reads the feed and the totals; the month's full list is for the Home page.
    return NextResponse.json({ ...snapshot, sales: [], stamp }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (err) {
    // The class only; never a row.
    console.error("board_snapshot_failed", err instanceof Error ? err.name : "error");
    return NextResponse.json({ error: "The database didn't answer" }, { status: 503 });
  }
}
