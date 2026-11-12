import { NextResponse } from "next/server";
import { timingSafeEqual, createHash } from "crypto";
import { z } from "zod";
import { getSettings, insertSale, listAgents } from "@/lib/data";
import { addDays, isDateKey, todayInDetroit } from "@/lib/month";
import { parseDollars } from "@/lib/money";
import { LOG_TOKEN_MIN } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * An iPhone Shortcut (or an NFC tag that runs one) logs a sale here with the LOG_TOKEN:
 *   POST /api/sales   Authorization: Bearer <LOG_TOKEN>
 *   { "agent": "Alex", "premium": "1250", "carrier": "Americo", "policies": 1, "product": "Term", "date": "2026-10-27" }
 * `agent` is a name (first name is enough when it is unique) or an id; `carrier` is one of the
 * names in Settings (any case). While the owner has P&C on (settings.app.pcEnabled; off since
 * 2026-11-12), a P&C sale sends `"kind": "pc"` with one of the P&C carriers and, as `product`,
 * the line (Auto, Home …), for a person marked P&C licensed; while it is off, that kind is
 * refused. Answers { ok, sale }.
 */
const Body = z.object({
  agent: z.string().trim().min(1).max(80),
  premium: z.union([z.string(), z.number()]),
  policies: z.coerce.number().int().min(1).max(50).optional(),
  product: z.string().trim().max(40).optional(),
  carrier: z.string().trim().min(1).max(40),
  kind: z.enum(["life", "pc"]).optional(),
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
  if (!parsed.success) return NextResponse.json({ ok: false, error: "Send agent, premium and carrier" }, { status: 400 });
  const body = parsed.data;
  const cents = parseDollars(String(body.premium));
  if (cents == null || cents === 0) return NextResponse.json({ ok: false, error: "premium must be an amount over 0" }, { status: 400 });
  const today = todayInDetroit();
  const soldOn = body.date || today;
  if (!isDateKey(soldOn) || soldOn > today || soldOn < addDays(today, -400)) return NextResponse.json({ ok: false, error: "date must be YYYY-MM-DD, not in the future" }, { status: 400 });

  const [agents, settings] = await Promise.all([listAgents(), getSettings()]);
  const kind = body.kind ?? "life";
  // Life only (owner, 2026-11-12): the other kind is refused while the owner's switch is off.
  if (kind === "pc" && !settings.pcEnabled) return NextResponse.json({ ok: false, error: "That kind of sale is turned off" }, { status: 400 });
  const pcCarrier = kind === "pc" ? settings.pcCarriers.find((c) => c.name.toLowerCase() === body.carrier.toLowerCase()) : undefined;
  const carrier = kind === "pc" ? pcCarrier?.name : settings.carriers.find((c) => c.toLowerCase() === body.carrier.toLowerCase());
  if (!carrier) return NextResponse.json({ ok: false, error: kind === "pc" ? "No such P&C carrier" : "No such carrier", carriers: kind === "pc" ? settings.pcCarriers.map((c) => c.name) : settings.carriers }, { status: 400 });
  // A P&C line is kept as the carrier writes it ("auto" becomes "Auto"); anything else is kept as sent.
  const product = kind === "pc" && body.product ? (pcCarrier?.lines.find((l) => l.toLowerCase() === body.product!.toLowerCase()) ?? body.product) : body.product;
  const want = body.agent.toLowerCase();
  const byId = agents.find((a) => a.id === body.agent);
  const byName = agents.filter((a) => a.name.toLowerCase() === want);
  const byFirst = agents.filter((a) => a.name.toLowerCase().split(/\s+/)[0] === want);
  const match = byId ?? (byName.length === 1 ? byName[0] : byFirst.length === 1 ? byFirst[0] : null);
  if (!match) {
    const names = agents.map((a) => a.name);
    return NextResponse.json({ ok: false, error: byFirst.length > 1 ? "Two people share that first name; send the full name" : "No such person", people: names }, { status: 404 });
  }
  if (kind === "pc" && !match.pc_licensed) return NextResponse.json({ ok: false, error: `${match.name} isn't marked P&C licensed (People page)` }, { status: 400 });
  try {
    const sale = await insertSale({
      agent_id: match.id,
      premium_cents: cents,
      policies: body.policies ?? 1,
      product: product || null,
      carrier,
      kind,
      client: null,
      note: body.note || null,
      sold_on: soldOn,
      logged_by: "shortcut",
    });
    return NextResponse.json({ ok: true, sale: { id: sale.id, agent: sale.agent_name, premium_cents: sale.premium_cents, carrier: sale.carrier, kind: sale.kind, sold_on: sale.sold_on } });
  } catch (err) {
    console.error("sale_api_failed", err instanceof Error ? err.name : "error");
    return NextResponse.json({ ok: false, error: "The database didn't answer" }, { status: 503 });
  }
}

/** The people a Shortcut can pick from ("Choose from list"), with the same token. */
export async function GET(request: Request) {
  if (!tokenOk(request.headers.get("authorization"))) return NextResponse.json({ ok: false, error: "Not allowed" }, { status: 401 });
  try {
    const [agents, settings] = await Promise.all([listAgents(), getSettings()]);
    const life = { ok: true, people: agents.map((a) => a.name), carriers: settings.carriers };
    // The P&C lists ride along only while the owner has P&C on.
    return NextResponse.json(settings.pcEnabled ? { ...life, pcPeople: agents.filter((a) => a.pc_licensed).map((a) => a.name), pcCarriers: settings.pcCarriers } : life);
  } catch {
    return NextResponse.json({ ok: false, error: "The database didn't answer" }, { status: 503 });
  }
}
