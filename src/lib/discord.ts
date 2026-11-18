import "server-only";
import { after } from "next/server";

/**
 * New deals posted to the agency's Discord (owner, 2026-11-18: "It should only ever be posting in
 * the channel called 💰-numbers-chat", in his format). Posted by the "Scorecard Bot" bot with the
 * token in `DISCORD_BOT_TOKEN` (Vercel); without it nothing is sent. The channel is fixed here, on
 * purpose not a setting: the bot posts in that one channel and nowhere else.
 *
 * Only deals logged in Scorecard (Log a sale, the Shortcut) are posted: AgentSpace's own "AgentSpace Deal
 * Bot" already posts the deals logged there, in the same channel, so the sync never posts.
 *
 * Only board fields go out (the seller's name, carrier, product, annual premium): never a client,
 * a policy number or a note. Best effort: a post that fails never fails the sale, and the log holds
 * the error class only. No @mentions are ever parsed, so a name can never ping anyone.
 */
export const NUMBERS_CHAT_CHANNEL_ID = "1556762836133355540";

export interface DealPost {
  agent: string;
  carrier: string | null;
  product: string | null;
  /** The annual premium, in cents. */
  annualCents: number;
}

/** "$1,134.96", or "$1,200" when there are no cents. */
export function annualDollars(cents: number): string {
  const whole = cents % 100 === 0;
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: whole ? 0 : 2 });
}

/** The message, exactly in the owner's format. Pure; tested. */
export function dealMessage(d: DealPost): string {
  const clean = (s: string | null) => (s ?? "").replace(/\s+/g, " ").trim() || "—";
  return ["New Deal Posted!", "", `Agent: ${clean(d.agent)}`, `Carrier: ${clean(d.carrier)}`, `Product: ${clean(d.product)}`, `Annual Premium: ${annualDollars(d.annualCents)}`].join("\n");
}

/** Posts a new deal now and waits for Discord (at most 8 seconds); never throws. */
export async function postDeal(d: DealPost): Promise<void> {
  const token = process.env.DISCORD_BOT_TOKEN?.trim();
  if (!token) return;
  try {
    const res = await fetch(`https://discord.com/api/v10/channels/${NUMBERS_CHAT_CHANNEL_ID}/messages`, {
      method: "POST",
      headers: { Authorization: `Bot ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ content: dealMessage(d), allowed_mentions: { parse: [] } }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) console.error("discord_post_failed", { status: res.status });
  } catch (err) {
    console.error("discord_post_failed", { error: err instanceof Error ? err.name : "unknown" });
  }
}

/**
 * Posts a new deal to 💰-numbers-chat after the response is sent (the save never waits on Discord).
 * Outside a request (a test, a script) it runs at once instead.
 */
export function announceDeal(d: DealPost): void {
  if (!process.env.DISCORD_BOT_TOKEN?.trim()) return;
  try {
    after(() => postDeal(d));
  } catch {
    void postDeal(d);
  }
}
