import "server-only";
import { goalsForMonth, listAgents, recentSales, salesForMonth, getSettings } from "./data";
import { monthKeyOf, todayInDetroit } from "./month";
import { buildScoreboard } from "./scoreboard";
import { salesBeforeMonth } from "./scoreboard-load";
import type { ScoreSale, Scoreboard } from "./scoreboard-types";
import { buildSnapshot, lifeOnlyInput, type MonthSnapshot, type SnapshotInput } from "./snapshot";

export { buildSnapshot } from "./snapshot";
export type { AgentLine, DayPoint, FeedSale, MonthSnapshot } from "./snapshot";

/**
 * The month's snapshot from the database (the TV, Home and the Wrap read it; see snapshot.ts).
 * While Settings has P&C off (the default since 2026-11-12) the P&C sales and goals are dropped
 * before any math. The current month also carries the Scoreboard (the whole agency, through today).
 */
export async function loadMonthSnapshot(month: string, opts: { today?: string; recentLimit?: number } = {}): Promise<MonthSnapshot> {
  const today = opts.today ?? todayInDetroit();
  const limit = opts.recentLimit ?? 12;
  const current = month === monthKeyOf(today);
  const [agents, sales, goals, recent, settings, before] = await Promise.all([
    listAgents({ includeInactive: true }),
    salesForMonth(month),
    goalsForMonth(month),
    // A few more than asked for, so the feed stays full once the P&C ones are taken out.
    recentSales(limit * 4),
    getSettings(),
    // The Scoreboard compares with the month before: its life sales, read beside the rest.
    current
      ? salesBeforeMonth(month).catch((err: unknown) => {
          // The class only; the leaderboard still answers without the Scoreboard.
          console.error("scoreboard_load_failed", err instanceof Error ? err.name : "error");
          return null;
        })
      : Promise.resolve(null),
  ]);
  let input: SnapshotInput = { month, today, agents, sales, goals, recent, message: settings.message, colorway: settings.colorway, pcColor: settings.pcColor, boardTheme: settings.boardTheme, sound: settings.sound, tvScreens: settings.tvScreens, agencyName: settings.agencyName, pcEnabled: settings.pcEnabled };
  if (!settings.pcEnabled) input = lifeOnlyInput(input);
  input = { ...input, recent: input.recent.slice(0, limit) };

  let scoreboard: Scoreboard | null = null;
  if (current && before) {
    // The Scoreboard is life only whatever the P&C switch says; a running month ends today.
    const monthLife: ScoreSale[] = [];
    for (const s of sales) if (s.kind !== "pc" && s.sold_on <= today) monthLife.push({ agent_id: s.agent_id, premium_cents: s.premium_cents, policies: s.policies, product: s.product, carrier: s.carrier, sold_on: s.sold_on });
    scoreboard = buildScoreboard({ agents, sales: [...before, ...monthLife], from: `${month}-01`, to: today, today, agencyName: settings.agencyName });
  }
  return buildSnapshot({ ...input, scoreboard });
}
