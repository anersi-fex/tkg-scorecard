"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { addAgent, deleteSale, getSale, insertSale, listAgents, saveSettings, setAgentGoal, setTeamGoal, updateAgent, updateSale, getSettings } from "@/lib/data";
import { isDateKey, isMonthKey, todayInDetroit, addDays } from "@/lib/month";
import { parseDollars } from "@/lib/money";
import { DEFAULT_CARRIERS, DEFAULT_PRODUCTS } from "@/lib/types";
import { isColorwayKey } from "@/lib/colorways";

export type ActionResult = { ok: true; message?: string; id?: string } | { ok: false; error: string };

function message(err: unknown): string {
  return err instanceof Error ? err.message : "Something went wrong.";
}

function refresh() {
  revalidatePath("/", "layout");
}

const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((s) => (s.length ? s : null));

const SaleInput = z.object({
  agent_id: z.string().uuid(),
  premium: z.string().trim().min(1),
  policies: z.coerce.number().int().min(1).max(50).default(1),
  product: text(40).nullable().default(null),
  carrier: text(40).nullable().default(null),
  note: text(200).nullable().default(null),
  sold_on: z.string().trim().default(""),
});

/** Anyone signed in logs a sale. Returns the new sale's id so the screen can offer Undo. */
export async function logSale(form: FormData): Promise<ActionResult> {
  try {
    const role = await requireRole();
    const parsed = SaleInput.safeParse(Object.fromEntries(form));
    if (!parsed.success) return { ok: false, error: "Pick who sold it and type the annual premium." };
    const input = parsed.data;
    const cents = parseDollars(input.premium);
    if (cents == null) return { ok: false, error: "The annual premium needs to be an amount, like 1250 or 1,250.50." };
    if (cents === 0) return { ok: false, error: "The annual premium can't be $0." };
    if (!input.carrier) return { ok: false, error: "Tap the carrier it was written with." };
    const today = todayInDetroit();
    const soldOn = input.sold_on || today;
    if (!isDateKey(soldOn)) return { ok: false, error: "That date isn't right." };
    if (soldOn > today) return { ok: false, error: "That date is in the future." };
    if (soldOn < addDays(today, -400)) return { ok: false, error: "That date is over a year ago." };
    const agents = await listAgents();
    const agent = agents.find((a) => a.id === input.agent_id);
    if (!agent) return { ok: false, error: "That person isn't on the team anymore." };
    const sale = await insertSale({
      agent_id: agent.id,
      premium_cents: cents,
      policies: input.policies,
      product: input.product,
      carrier: input.carrier,
      client: null,
      note: input.note,
      sold_on: soldOn,
      logged_by: role,
    });
    refresh();
    return { ok: true, id: sale.id, message: "Logged. The board is celebrating." };
  } catch (err) {
    return { ok: false, error: message(err) };
  }
}

const UNDO_WINDOW_MS = 15 * 60 * 1000;

/** The owner removes any sale; the team can take back one logged in the last 15 minutes (a typo). */
export async function removeSale(id: string): Promise<ActionResult> {
  try {
    const role = await requireRole();
    if (!z.string().uuid().safeParse(id).success) return { ok: false, error: "That sale isn't here." };
    const sale = await getSale(id);
    if (!sale) return { ok: false, error: "That sale is already gone." };
    if (role !== "owner" && Date.now() - new Date(sale.created_at).getTime() > UNDO_WINDOW_MS) {
      return { ok: false, error: "Only the owner can remove a sale after 15 minutes. Ask Anersi." };
    }
    await deleteSale(id);
    refresh();
    return { ok: true, message: "Removed." };
  } catch (err) {
    return { ok: false, error: message(err) };
  }
}

const EditInput = z.object({
  premium: z.string().trim().min(1),
  policies: z.coerce.number().int().min(1).max(50),
  product: text(40).nullable().default(null),
  carrier: text(40).nullable().default(null),
  note: text(200).nullable().default(null),
  sold_on: z.string().trim(),
  agent_id: z.string().uuid(),
});

/** The owner fixes a sale (wrong amount, wrong person, wrong day). */
export async function editSale(id: string, form: FormData): Promise<ActionResult> {
  try {
    await requireRole("owner");
    if (!z.string().uuid().safeParse(id).success) return { ok: false, error: "That sale isn't here." };
    const parsed = EditInput.safeParse(Object.fromEntries(form));
    if (!parsed.success) return { ok: false, error: "Check the amount, the person and the date." };
    const input = parsed.data;
    const cents = parseDollars(input.premium);
    if (cents == null || cents === 0) return { ok: false, error: "The annual premium needs to be an amount over $0." };
    if (!isDateKey(input.sold_on)) return { ok: false, error: "That date isn't right." };
    const agents = await listAgents({ includeInactive: true });
    if (!agents.some((a) => a.id === input.agent_id)) return { ok: false, error: "That person isn't on the team." };
    const found = await updateSale(id, {
      agent_id: input.agent_id,
      premium_cents: cents,
      policies: input.policies,
      product: input.product,
      carrier: input.carrier,
      note: input.note,
      sold_on: input.sold_on,
    });
    refresh();
    if (!found) return { ok: false, error: "That sale is already gone." };
    return { ok: true, message: "Saved." };
  } catch (err) {
    return { ok: false, error: message(err) };
  }
}

const Name = z.string().trim().min(1).max(60);

export async function addPerson(form: FormData): Promise<ActionResult> {
  try {
    await requireRole("owner");
    const name = Name.safeParse(form.get("name"));
    if (!name.success) return { ok: false, error: "Type the person's name." };
    const existing = await listAgents({ includeInactive: true });
    const dup = existing.find((a) => a.name.toLowerCase() === name.data.toLowerCase());
    if (dup) {
      if (dup.active) return { ok: false, error: `${dup.name} is already on the team.` };
      await updateAgent(dup.id, { active: true });
      refresh();
      return { ok: true, message: `${dup.name} is back on the board.` };
    }
    await addAgent(name.data);
    refresh();
    return { ok: true, message: `${name.data} is on the board.` };
  } catch (err) {
    return { ok: false, error: message(err) };
  }
}

export async function renamePerson(id: string, form: FormData): Promise<ActionResult> {
  try {
    await requireRole("owner");
    const name = Name.safeParse(form.get("name"));
    if (!name.success || !z.string().uuid().safeParse(id).success) return { ok: false, error: "Type the person's name." };
    await updateAgent(id, { name: name.data });
    refresh();
    return { ok: true, message: "Saved." };
  } catch (err) {
    return { ok: false, error: message(err) };
  }
}

/** Off the board (their sales stay in the history); the same action brings them back. */
export async function setPersonActive(id: string, active: boolean): Promise<ActionResult> {
  try {
    await requireRole("owner");
    if (!z.string().uuid().safeParse(id).success) return { ok: false, error: "That person isn't here." };
    await updateAgent(id, { active });
    refresh();
    return { ok: true, message: active ? "Back on the board." : "Off the board. Their sales stay in the history." };
  } catch (err) {
    return { ok: false, error: message(err) };
  }
}

const Month = z.string().refine(isMonthKey, "month");

/** The team's goal for a month, in dollars ("150000" or "150,000"); 0 clears it. */
export async function saveTeamGoal(month: string, form: FormData): Promise<ActionResult> {
  try {
    await requireRole("owner");
    if (!Month.safeParse(month).success) return { ok: false, error: "That month isn't right." };
    const raw = String(form.get("goal") ?? "").trim();
    const cents = raw === "" ? 0 : parseDollars(raw);
    if (cents == null) return { ok: false, error: "The goal needs to be an amount, like 150000." };
    await setTeamGoal(month, cents);
    refresh();
    return { ok: true, message: cents ? "Goal saved. The board shows it now." : "Goal cleared." };
  } catch (err) {
    return { ok: false, error: message(err) };
  }
}

export async function savePersonGoal(month: string, agentId: string, form: FormData): Promise<ActionResult> {
  try {
    await requireRole("owner");
    if (!Month.safeParse(month).success || !z.string().uuid().safeParse(agentId).success) return { ok: false, error: "That person or month isn't right." };
    const raw = String(form.get("goal") ?? "").trim();
    const cents = raw === "" ? 0 : parseDollars(raw);
    if (cents == null) return { ok: false, error: "The goal needs to be an amount, like 25000." };
    await setAgentGoal(month, agentId, cents);
    refresh();
    return { ok: true, message: cents ? "Goal saved." : "Goal cleared." };
  } catch (err) {
    return { ok: false, error: message(err) };
  }
}

/** The colorway on every screen and the TV (Settings > Colorway). */
export async function saveColorway(key: string): Promise<ActionResult> {
  try {
    await requireRole("owner");
    if (!isColorwayKey(key)) return { ok: false, error: "That colorway isn't one of the choices." };
    const current = await getSettings();
    await saveSettings({ ...current, colorway: key });
    refresh();
    return { ok: true, message: "Saved. The TV changes within a few seconds." };
  } catch (err) {
    return { ok: false, error: message(err) };
  }
}

/** The board message and the product chips. */
export async function saveBoardSettings(form: FormData): Promise<ActionResult> {
  try {
    await requireRole("owner");
    const current = await getSettings();
    const msg = String(form.get("message") ?? "")
      .replace(/[\r\n\t]+/g, " ")
      .trim()
      .slice(0, 120);
    const chips = (raw: FormDataEntryValue | null, fallback: string[]) => {
      const items = String(raw ?? "")
        .split(/[,\n]/)
        .map((p) => p.trim().slice(0, 40))
        .filter(Boolean)
        .filter((p, i, all) => all.findIndex((q) => q.toLowerCase() === p.toLowerCase()) === i)
        .slice(0, 20);
      return items.length ? items : fallback;
    };
    await saveSettings({ ...current, message: msg, products: chips(form.get("products"), DEFAULT_PRODUCTS), carriers: chips(form.get("carriers"), DEFAULT_CARRIERS) });
    refresh();
    return { ok: true, message: "Saved. The board updates within a few seconds." };
  } catch (err) {
    return { ok: false, error: message(err) };
  }
}
