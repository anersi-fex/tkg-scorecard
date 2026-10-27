import { NextResponse } from "next/server";
import { timingSafeEqual, createHash } from "crypto";
import { z } from "zod";
import { insertSale, listAgents } from "@/lib/data";
import { addDays, isDateKey, todayInDetroit } from "@/lib/month";
import { parseDollars } from "@/lib/money";
import { LOG_TOKEN_MIN } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * An iPhone Shortcut (or an NFC tag that runs one) logs a sale here with the LOG_TOKEN:
 *   POST /api/sales   Authorization: Bearer <LOG_TOKEN>
 *   { "agent": "Alex", "premium": "1250", "policies": 1, "product": "Term", "client": "Maria", "date": "2026-10-27" }
 * `agent` is a name (first name is enough when it is unique) or an id. Answers { ok, sale }.
 */
const Body = z.object({
  agent: z.string().trim().min(1).max(80),
  premium: z.union([z.string(), z.number()]),
  policies: z.coerce.number().int().min(1).max(50).optional(),
  product: z.string().trim().max(40).optional(),
  client: z.string().trim().max(40).optional(),
  note: z.string().trim().max(200).optional(),
  date: z.string().trim().optional(),
});

function tokenOk(header: string | null): boolean {
  const expected = process.env.LOG_TOKEN;
  if (!expected || expected.length < LOG_TOKEN_MIN) return false;
  const supplied = header?.replace(/^Bearer\s+/i, "").trim() ?? "";
  if (!supplied) return false;
  const a = createHash("sha256").update(supplied).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

export async function POST(request: Request) {
  if (!tokenOk(request.headers.get("authorization"))) return NextResponse.json({ ok: false, error: "Not allowed" }, { status: 401 });
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Send JSON" }, { status: 400 });
  }
  const parsed = Body.safeParse(json);
  if (!parsed.success) return NextResponse.json({ ok: false, error: "Send agent and premium" }, { status: 400 });
  const body = parsed.data;
  const cents = parseDollars(String(body.premium));
  if (cents == null || cents === 0) return NextResponse.json({ ok: false, error: "premium must be an amount over 0" }, { status: 400 });
  const today = todayInDetroit();
  const soldOn = body.date || today;
  if (!isDateKey(soldOn) || soldOn > today || soldOn < addDays(today, -400)) return NextResponse.json({ ok: false, error: "date must be YYYY-MM-DD, not in the future" }, { status: 400 });

  const agents = await listAgents();
  const want = body.agent.toLowerCase();
  const byId = agents.find((a) => a.id === body.agent);
  const byName = agents.filter((a) => a.name.toLowerCase() === want);
  const byFirst = agents.filter((a) => a.name.toLowerCase().split(/\s+/)[0] === want);
  const match = byId ?? (byName.length === 1 ? byName[0] : byFirst.length === 1 ? byFirst[0] : null);
  if (!match) {
    const names = agents.map((a) => a.name);
    return NextResponse.json({ ok: false, error: byFirst.length > 1 ? "Two people share that first name; send the full name" : "No such person", people: names }, { status: 404 });
  }
  try {
    const sale = await insertSale({
      agent_id: match.id,
      premium_cents: cents,
      policies: body.policies ?? 1,
      product: body.product || null,
      client: body.client || null,
      note: body.note || null,
      sold_on: soldOn,
      logged_by: "shortcut",
    });
    return NextResponse.json({ ok: true, sale: { id: sale.id, agent: sale.agent_name, premium_cents: sale.premium_cents, sold_on: sale.sold_on } });
  } catch (err) {
    console.error("sale_api_failed", err instanceof Error ? err.name : "error");
    return NextResponse.json({ ok: false, error: "The database didn't answer" }, { status: 503 });
  }
}

/** The people a Shortcut can pick from ("Choose from list"), with the same token. */
export async function GET(request: Request) {
  if (!tokenOk(request.headers.get("authorization"))) return NextResponse.json({ ok: false, error: "Not allowed" }, { status: 401 });
  try {
    const agents = await listAgents();
    return NextResponse.json({ ok: true, people: agents.map((a) => a.name) });
  } catch {
    return NextResponse.json({ ok: false, error: "The database didn't answer" }, { status: 503 });
  }
}
