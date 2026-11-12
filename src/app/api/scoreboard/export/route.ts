import { NextResponse, type NextRequest } from "next/server";
import { currentRole } from "@/lib/auth";
import { isMonthKey, monthKeyOf, todayInDetroit } from "@/lib/month";
import { CSV_VIEWS, CSV_WHO, type CsvView, type CsvWho } from "@/lib/scoreboard";
import { loadScoreboard, scoreboardCsv } from "@/lib/scoreboard-load";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const bad = (error: string) => NextResponse.json({ error }, { status: 400, headers: { "Cache-Control": "private, no-store" } });

/**
 * The Scoreboard's table as a CSV file, for any signed-in viewer.
 *   month  "YYYY-MM", this month when left out; never a month that has not started
 *   team   a leader's id: only that leader's team; the whole agency when left out
 *   who    agents (default) or teams
 *   view   dates (default), product or carrier
 */
export async function GET(req: NextRequest) {
  if (!(await currentRole())) return NextResponse.json({ error: "Not signed in" }, { status: 401, headers: { "Cache-Control": "private, no-store" } });
  const q = req.nextUrl.searchParams;
  const today = todayInDetroit();
  const month = q.get("month") || monthKeyOf(today);
  if (!isMonthKey(month) || month > monthKeyOf(today) || month < "2020-01") return bad("That month is not one we can export");
  const who = (q.get("who") || "agents") as CsvWho;
  if (!CSV_WHO.includes(who)) return bad("Pick agents or teams");
  const view = (q.get("view") || "dates") as CsvView;
  if (!CSV_VIEWS.includes(view)) return bad("Pick dates, product or carrier");
  const team = q.get("team") || null;
  if (team && !UUID.test(team)) return bad("That team was not found");
  try {
    const sb = await loadScoreboard({ month, leaderId: team, today });
    // An id that is nobody's would be an empty file with no reason given.
    if (team && sb.scopeName === "This team") return bad("That team was not found");
    // A team's file says whose it is, so it never shares a name with the agency's.
    const leader = sb.scopeName.replace(/['’]s team$/, "").toLowerCase();
    const slug = leader.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    const whose = team && slug ? `-${slug}-team` : "";
    const name = `scoreboard${whose}${who === "teams" ? "-teams" : ""}${view === "dates" ? "" : `-by-${view}`}-${month}.csv`;
    // The mark at the start tells a spreadsheet the file is UTF-8 (names with accents stay right).
    return new NextResponse(`﻿${scoreboardCsv(sb, who, view)}`, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${name}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (err) {
    // The class only; never a row.
    console.error("scoreboard_export_failed", err instanceof Error ? err.name : "error");
    return NextResponse.json({ error: "The database didn't answer" }, { status: 503, headers: { "Cache-Control": "private, no-store" } });
  }
}
