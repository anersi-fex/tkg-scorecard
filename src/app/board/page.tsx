import type { Metadata } from "next";
import { requirePage } from "@/lib/auth";
import { dbConfigured } from "@/lib/supabase";
import { loadMonthSnapshot, type MonthSnapshot } from "@/lib/board";
import { monthKeyOf, todayInDetroit } from "@/lib/month";
import { BoardView } from "@/components/board/board-view";
import { ScoreLockup } from "@/components/brand";

export const metadata: Metadata = { title: "TV board" };
export const dynamic = "force-dynamic";

/** The TV: full screen, no menus, refreshes itself. Opened once on the Mac mini and left there. */
export default async function BoardPage({ searchParams }: PageProps<"/board">) {
  await requirePage();
  const params = await searchParams;
  const theme = params.theme === "light" ? "light" : params.theme === "dark" ? "dark" : null;
  let initial: MonthSnapshot | null = null;
  let problem: string | null = null;
  if (!dbConfigured()) problem = "The database isn't connected yet. Add SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in Vercel (SETUP.md, step 5).";
  else {
    try {
      const today = todayInDetroit();
      initial = await loadMonthSnapshot(monthKeyOf(today), { today, recentLimit: 12 });
    } catch {
      problem = "The database didn't answer. Check that the setup SQL ran (SETUP.md, step 3).";
    }
  }
  if (!initial) {
    return (
      <main className="flex flex-1 flex-col items-center justify-center gap-6 p-10 text-center">
        <ScoreLockup size={64} />
        <p className="max-w-md text-[20px] font-semibold text-gray-600">{problem}</p>
      </main>
    );
  }
  return <BoardView initial={initial} theme={theme} />;
}
