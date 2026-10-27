import { NextResponse } from "next/server";
import { currentRole } from "@/lib/auth";
import { loadMonthSnapshot } from "@/lib/board";
import { monthKeyOf, todayInDetroit } from "@/lib/month";

export const dynamic = "force-dynamic";

/** The board's live feed: the current month's snapshot, for a signed-in viewer (the TV polls it). */
export async function GET() {
  if (!(await currentRole())) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  try {
    const today = todayInDetroit();
    const snapshot = await loadMonthSnapshot(monthKeyOf(today), { today, recentLimit: 12 });
    return NextResponse.json(snapshot, { headers: { "Cache-Control": "private, no-store" } });
  } catch (err) {
    // The class only; never a row.
    console.error("board_snapshot_failed", err instanceof Error ? err.name : "error");
    return NextResponse.json({ error: "The database didn't answer" }, { status: 503 });
  }
}
