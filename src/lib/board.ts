import "server-only";
import { goalsForMonth, listAgents, recentSales, salesForMonth, getSettings } from "./data";
import { todayInDetroit } from "./month";
import { buildSnapshot, type MonthSnapshot } from "./snapshot";

export { buildSnapshot } from "./snapshot";
export type { AgentLine, DayPoint, FeedSale, MonthSnapshot } from "./snapshot";

/** The month's snapshot from the database (the TV, Home and the Wrap read it; see snapshot.ts). */
export async function loadMonthSnapshot(month: string, opts: { today?: string; recentLimit?: number } = {}): Promise<MonthSnapshot> {
  const today = opts.today ?? todayInDetroit();
  const [agents, sales, goals, recent, settings] = await Promise.all([
    listAgents({ includeInactive: true }),
    salesForMonth(month),
    goalsForMonth(month),
    recentSales(opts.recentLimit ?? 12),
    getSettings(),
  ]);
  return buildSnapshot({ month, today, agents, sales, goals, recent, message: settings.message, colorway: settings.colorway, boardTheme: settings.boardTheme, sound: settings.sound, tvScreens: settings.tvScreens });
}
