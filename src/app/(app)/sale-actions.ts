"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireViewer } from "@/lib/auth";
import { getSettings, lineFor, listAgents } from "@/lib/data";
import { NEEDS_OWN_SIGN_IN, createPolicy, fixBoardSale, logBoardSale, removePolicy, setPolicyStatus, updatePolicy, type PolicyResult } from "@/lib/policies";
import { formFromFormData, type FormKey } from "@/lib/policy-validate";
import { addDays, isDateKey, todayInDetroit } from "@/lib/month";
import { parseDollars } from "@/lib/money";
import type { ActionResult } from "./actions";

/**
 * Logging, fixing and removing a sale (a policy). Every action reads the viewer from the session
 * first; src/lib/policies.ts then checks the rules (src/lib/rules.ts) on the server before it reads
 * or writes anything, whatever the request names. The shared team password never logs or changes
 * a policy (contract decision 2). A failure shows its own words when they were written for the
 * screen, else "That didn't save. Try again." (data.ts lineFor); nothing here logs a value.
 */

/** ActionResult, plus each field's message when a form did not pass (Log a sale's steps, a record's section). */
export type PolicyActionResult = ActionResult | { ok: false; error: string; errors?: Partial<Record<FormKey, string>> };

// Any id Postgres holds (the shape only: zod's uuid() also wants an RFC version, which refuses ids typed by hand).
const Id = z.guid();

/** After a change the pages read again (policies.ts already told the TV, data.ts touchBoard). */
function refresh(): void {
  revalidatePath("/", "layout");
}

function result(r: PolicyResult): PolicyActionResult {
  if (!r.ok) return r.errors ? { ok: false, error: r.error, errors: r.errors } : { ok: false, error: r.error };
  return { ok: true, ...(r.message ? { message: r.message } : {}), ...(r.id ? { id: r.id } : {}) };
}

/**
 * Log a sale's three steps (form fields: policy-validate.ts PolicyForm's names; beneficiaries as
 * repeated "benName" and "benRelationship"). An agent logs for themself whatever "agentId" says; a
 * manager for themself or their confirmed downline; an admin for anyone on the board. Returns the
 * new policy's id.
 */
export async function logPolicy(form: FormData): Promise<PolicyActionResult> {
  try {
    const viewer = await requireViewer();
    if (viewer.level === "team") return { ok: false, error: NEEDS_OWN_SIGN_IN };
    const r = await createPolicy(viewer, formFromFormData(form).form);
    if (r.ok) refresh();
    return result(r);
  } catch (err) {
    return { ok: false, error: lineFor(err) };
  }
}

/**
 * Fixes a policy from one of its sections (send only that section's fields: a field not sent is
 * left as it is). Only the fields the rules let this viewer change, and only what changed.
 */
export async function updatePolicyAction(id: string, form: FormData): Promise<PolicyActionResult> {
  try {
    const viewer = await requireViewer();
    if (viewer.level === "team") return { ok: false, error: NEEDS_OWN_SIGN_IN };
    if (!Id.safeParse(id).success) return { ok: false, error: "That policy isn't here." };
    const r = await updatePolicy(viewer, id, formFromFormData(form));
    if (r.ok) refresh();
    return result(r);
  } catch (err) {
    return { ok: false, error: lineFor(err) };
  }
}

/** The status menu: one of the six statuses, written to the history. */
export async function setPolicyStatusAction(id: string, status: string): Promise<PolicyActionResult> {
  try {
    const viewer = await requireViewer();
    if (viewer.level === "team") return { ok: false, error: NEEDS_OWN_SIGN_IN };
    if (!Id.safeParse(id).success) return { ok: false, error: "That policy isn't here." };
    const r = await setPolicyStatus(viewer, id, String(status));
    if (r.ok) refresh();
    return result(r);
  } catch (err) {
    return { ok: false, error: lineFor(err) };
  }
}

/** Take it back (the seller or whoever logged it, first 15 minutes) or Remove policy (an admin; a past month asks the owner). */
export async function removePolicyAction(id: string): Promise<PolicyActionResult> {
  try {
    const viewer = await requireViewer();
    if (viewer.level === "team") return { ok: false, error: NEEDS_OWN_SIGN_IN };
    if (!Id.safeParse(id).success) return { ok: false, error: "That sale isn't here." };
    const r = await removePolicy(viewer, id);
    if (r.ok) refresh();
    return result(r);
  } catch (err) {
    return { ok: false, error: lineFor(err) };
  }
}

// ---- the one-screen form and Home's sale rows (until Phase B replaces those screens) --------------

const KIND_OFF = "That kind of sale is turned off.";
const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((s) => (s.length ? s : null));

const SaleInput = z.object({
  agent_id: z.guid(),
  premium: z.string().trim().min(1),
  policies: z.coerce.number().int().min(1).max(50).default(1),
  product: text(40).nullable().default(null),
  carrier: text(40).nullable().default(null),
  kind: z.enum(["life", "pc"]).default("life"),
  note: text(200).nullable().default(null),
  sold_on: z.string().trim().default(""),
});

/**
 * Logs a sale from the one-screen form (the annual premium, no client details): status Submitted.
 * Who it may be for comes from the rules (an agent themself, a manager their confirmed team, an
 * admin anyone). The team password does not log (contract decision 2).
 */
export async function logSale(form: FormData): Promise<ActionResult> {
  try {
    const viewer = await requireViewer();
    if (viewer.level === "team") return { ok: false, error: NEEDS_OWN_SIGN_IN };
    const settings = await getSettings();
    const raw: Record<string, unknown> = Object.fromEntries(form);
    if (viewer.level === "member") {
      if (!viewer.agentId) return { ok: false, error: "Sign in again to log a sale." };
      raw.agent_id = viewer.agentId;
    }
    const parsed = SaleInput.safeParse(raw);
    if (!parsed.success) return { ok: false, error: "Pick who sold it and type the annual premium." };
    const input = parsed.data;
    if (input.kind === "pc" && !settings.pcEnabled) return { ok: false, error: KIND_OFF };
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
    if (input.kind === "pc" && !agent.pc_licensed) return { ok: false, error: `${agent.name} isn't marked P&C licensed. The owner can change that on the People page.` };
    // The carrier must be on the list for the kind, and a P&C line must be one the carrier writes.
    const wanted = input.carrier.toLowerCase();
    const pcCarrier = input.kind === "pc" ? settings.pcCarriers.find((c) => c.name.toLowerCase() === wanted) : undefined;
    const lifeCarriers = [...new Set([...settings.carriers, ...Object.keys(settings.carrierProducts)])];
    const carrier = input.kind === "pc" ? pcCarrier?.name : lifeCarriers.find((c) => c.toLowerCase() === wanted);
    if (!carrier) return { ok: false, error: "Tap the carrier it was written with." };
    const product = input.kind === "pc" ? (pcCarrier?.lines.find((l) => l.toLowerCase() === input.product?.toLowerCase()) ?? null) : input.product;
    const sale = await logBoardSale(viewer, { agentId: agent.id, premiumCents: cents, policies: input.policies, product, carrier, kind: input.kind, note: input.note, soldOn });
    refresh();
    return { ok: true, id: sale.id, message: "Logged. The board is celebrating." };
  } catch (err) {
    return { ok: false, error: lineFor(err) };
  }
}

/** Removes a sale from Home's rows and the one-screen form's Undo (the same rules as removePolicyAction). */
export async function removeSale(id: string): Promise<ActionResult> {
  const r = await removePolicyAction(id);
  return r.ok ? r : { ok: false, error: r.error };
}

const EditInput = z.object({
  premium: z.string().trim().min(1),
  policies: z.coerce.number().int().min(1).max(50),
  product: text(40).nullable().default(null),
  carrier: text(40).nullable().default(null),
  kind: z.enum(["life", "pc"]).default("life"),
  note: text(200).nullable().default(null),
  sold_on: z.string().trim(),
  agent_id: z.guid(),
});

/**
 * Fixes a sale from Home's rows (the annual premium, policies, kind, carrier, product, note, day and
 * who sold it): an admin. An admin who is not the owner fixing a past month (the sale is in one, or
 * the new day is) files a request for the owner and nothing changes yet.
 */
export async function editSale(id: string, form: FormData): Promise<ActionResult> {
  try {
    const viewer = await requireViewer("admin");
    if (!Id.safeParse(id).success) return { ok: false, error: "That sale isn't here." };
    const parsed = EditInput.safeParse(Object.fromEntries(form));
    if (!parsed.success) return { ok: false, error: "Check the amount, the person and the date." };
    const input = parsed.data;
    const cents = parseDollars(input.premium);
    if (cents == null || cents === 0) return { ok: false, error: "The annual premium needs to be an amount over $0." };
    if (!isDateKey(input.sold_on)) return { ok: false, error: "That date isn't right." };
    if (input.sold_on > todayInDetroit()) return { ok: false, error: "That date is in the future." };
    if (input.kind === "pc" && !(await getSettings()).pcEnabled) return { ok: false, error: KIND_OFF };
    const r = await fixBoardSale(viewer, id, {
      agent_id: input.agent_id,
      premium_cents: cents,
      policies: input.policies,
      product: input.product,
      carrier: input.carrier,
      kind: input.kind,
      note: input.note,
      sold_on: input.sold_on,
    });
    if (r.ok) refresh();
    return r.ok ? { ok: true, ...(r.message ? { message: r.message } : {}) } : { ok: false, error: r.error };
  } catch (err) {
    return { ok: false, error: lineFor(err) };
  }
}
