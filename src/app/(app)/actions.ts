"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireViewer } from "@/lib/auth";
import { addAgent, deleteSale, getAgent, getSale, insertSale, lineFor, listAgents, saveSettings, setAgentGoal, setAgentPcGoal, setTeamGoal, setTeamPcGoal, touchBoard, updateAgent, updateSale, getSettings } from "@/lib/data";
import { requestApproval } from "@/lib/approvals";
import { bumpSession, sameName } from "@/lib/people";
import { revokeInvitesMadeBy, revokePersonInvites } from "@/lib/invites";
import { isManager, isOwner } from "@/lib/viewer";
import { isDateKey, isMonthKey, todayInDetroit, addDays, dayLabel } from "@/lib/month";
import { formatDollars, formatMoney, parseDollars } from "@/lib/money";
import { DEFAULT_CARRIERS, DEFAULT_PC_CARRIERS, DEFAULT_PRODUCTS, isBoardTheme, isTvScreens, type PcCarrier } from "@/lib/types";
import { isColorwayKey } from "@/lib/colorways";
import { isPcColorKey } from "@/lib/pc-colors";
import { isSoundKey } from "@/lib/sounds";

export type ActionResult = { ok: true; message?: string; id?: string } | { ok: false; error: string };

/**
 * The line a person sees when an action fails: the words the code threw on purpose ("Only an
 * admin can do that"), and for anything else (the database, its client) "That didn't save. Try
 * again." with the class logged, so no table or column wording reaches a screen (data.ts lineFor).
 */
function message(err: unknown): string {
  return lineFor(err);
}

/**
 * After a change: the pages read again, and the TV is told (touchBoard moves the stamp its
 * 5-second poll watches), so a goal, a person or a fixed sale shows on the TV within one poll.
 */
async function refresh(): Promise<void> {
  revalidatePath("/", "layout");
  await touchBoard();
}

/**
 * Who may do what (owner, 2026-11-12; src/lib/viewer.ts). Every action checks the level here,
 * on the server, before it reads the request:
 *   owner   everything
 *   admin   goals, people, any sale of this month, the board's settings; a sale of a past month
 *           and making or removing an admin wait for the owner's yes (an approvals row)
 *   member  logs sales for themselves, takes back their own sale within 15 minutes
 *   team    the shared team password: logs for anyone and takes back any sale within 15 minutes
 *           while Settings allows it, view only otherwise
 */
const SENT_FOR_OK = "Sent to Anersi for a quick OK.";
// Any id Postgres holds (the shape only: zod's uuid() also wants an RFC version, which refuses ids typed by hand).
const Id = z.guid();
const KIND_OFF = "That kind of sale is turned off.";
const TEAM_VIEW_ONLY = "The team password only looks now. Sign in with your own number to log a sale.";

/** A sale's month is over (its day is before this month in Detroit). */
const inPastMonth = (soldOn: string) => soldOn.slice(0, 7) < todayInDetroit().slice(0, 7);

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
 * Logs a sale. A member logs for themselves only (whatever person the request names); the owner
 * and an admin for anyone; the team password for anyone while Settings allows it. Returns the
 * new sale's id so the screen can offer Undo.
 */
export async function logSale(form: FormData): Promise<ActionResult> {
  try {
    const viewer = await requireViewer();
    const settings = await getSettings();
    if (viewer.level === "team" && !settings.teamPasswordLogs) return { ok: false, error: TEAM_VIEW_ONLY };
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
    // The carrier must be on the list for the kind (a screen left on the other kind cannot slip one through),
    // and a P&C line must be one the carrier writes.
    const wanted = input.carrier.toLowerCase();
    const pcCarrier = input.kind === "pc" ? settings.pcCarriers.find((c) => c.name.toLowerCase() === wanted) : undefined;
    const carrier = input.kind === "pc" ? pcCarrier?.name : settings.carriers.find((c) => c.toLowerCase() === wanted);
    if (!carrier) return { ok: false, error: "Tap the carrier it was written with." };
    const product = input.kind === "pc" ? (pcCarrier?.lines.find((l) => l.toLowerCase() === input.product?.toLowerCase()) ?? null) : input.product;
    const sale = await insertSale({
      agent_id: agent.id,
      premium_cents: cents,
      policies: input.policies,
      product,
      carrier,
      kind: input.kind,
      client: null,
      note: input.note,
      sold_on: soldOn,
      // The kind of session (the database knows owner, team and shortcut), and the person when the session names one.
      logged_by: isManager(viewer) ? "owner" : "team",
      logged_by_agent: viewer.agentId,
    });
    await refresh();
    return { ok: true, id: sale.id, message: "Logged. The board is celebrating." };
  } catch (err) {
    return { ok: false, error: message(err) };
  }
}

const UNDO_WINDOW_MS = 15 * 60 * 1000;

/**
 * Removes a sale. The owner: any sale. An admin: any sale of this month; a past month's goes to
 * the owner for a yes and nothing changes yet. A member: their own, within 15 minutes (a typo).
 * The team password: any, within 15 minutes, while Settings lets it log.
 */
export async function removeSale(id: string): Promise<ActionResult> {
  try {
    const viewer = await requireViewer();
    if (!Id.safeParse(id).success) return { ok: false, error: "That sale isn't here." };
    if (viewer.level === "team" && !(await getSettings()).teamPasswordLogs) return { ok: false, error: TEAM_VIEW_ONLY };
    const sale = await getSale(id);
    if (!sale) return { ok: false, error: "That sale is already gone." };
    if (!isManager(viewer)) {
      if (viewer.level === "member" && sale.agent_id !== viewer.agentId) return { ok: false, error: "You can take back your own sales only. Ask an admin about this one." };
      if (Date.now() - new Date(sale.created_at).getTime() > UNDO_WINDOW_MS) return { ok: false, error: "A sale can be taken back for 15 minutes. After that, ask an admin." };
    } else if (!isOwner(viewer) && inPastMonth(sale.sold_on)) {
      await requestApproval({
        kind: "remove_past_sale",
        payload: { sale_id: sale.id },
        summary: `Remove ${sale.agent_name}'s ${formatDollars(sale.premium_cents)} sale of ${dayLabel(sale.sold_on)}`,
        requestedBy: viewer.agentId,
      });
      await refresh();
      return { ok: true, message: SENT_FOR_OK };
    }
    await deleteSale(id);
    await refresh();
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
  kind: z.enum(["life", "pc"]).default("life"),
  note: text(200).nullable().default(null),
  sold_on: z.string().trim(),
  agent_id: z.guid(),
});

/**
 * Fixes a sale (wrong amount, wrong person, wrong day): the owner or an admin. An admin's fix
 * that touches a past month (the sale is in one, or the new day is) goes to the owner for a yes
 * and nothing changes yet.
 */
export async function editSale(id: string, form: FormData): Promise<ActionResult> {
  try {
    const viewer = await requireViewer("manager");
    if (!Id.safeParse(id).success) return { ok: false, error: "That sale isn't here." };
    const parsed = EditInput.safeParse(Object.fromEntries(form));
    if (!parsed.success) return { ok: false, error: "Check the amount, the person and the date." };
    const input = parsed.data;
    const cents = parseDollars(input.premium);
    if (cents == null || cents === 0) return { ok: false, error: "The annual premium needs to be an amount over $0." };
    if (!isDateKey(input.sold_on)) return { ok: false, error: "That date isn't right." };
    if (input.sold_on > todayInDetroit()) return { ok: false, error: "That date is in the future." };
    if (input.kind === "pc" && !(await getSettings()).pcEnabled) return { ok: false, error: KIND_OFF };
    const agents = await listAgents({ includeInactive: true });
    const agent = agents.find((a) => a.id === input.agent_id);
    if (!agent) return { ok: false, error: "That person isn't on the team." };
    const patch = {
      agent_id: input.agent_id,
      premium_cents: cents,
      policies: input.policies,
      product: input.product,
      carrier: input.carrier,
      kind: input.kind,
      note: input.note,
      sold_on: input.sold_on,
    };
    if (!isOwner(viewer)) {
      const sale = await getSale(id);
      if (!sale) return { ok: false, error: "That sale is already gone." };
      if (inPastMonth(sale.sold_on) || inPastMonth(input.sold_on)) {
        // The owner approves one sentence, so it names everything the fix changes: the amount with
        // its cents when there are any ($777.00 to $777.49 must not read as no change), the day,
        // the person, and a changed kind, policy count, carrier, product or note.
        const cut = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);
        const sentence = (nameMax: number, values: boolean) => {
          const was = `${cut(sale.agent_name, nameMax)}'s ${formatMoney(sale.premium_cents)} sale of ${dayLabel(sale.sold_on)}`;
          const now = `${sale.agent_id === agent.id ? "" : `${cut(agent.name, nameMax)}, `}${formatMoney(cents)}, ${dayLabel(input.sold_on)}`;
          const more = [
            input.kind !== sale.kind ? (input.kind === "pc" ? "now a P&C sale" : "now a life sale") : "",
            input.policies !== sale.policies ? `${input.policies} ${input.policies === 1 ? "policy" : "policies"}` : "",
            (input.carrier ?? "") !== (sale.carrier ?? "") ? (values ? `carrier ${input.carrier ?? "none"}` : "a new carrier") : "",
            (input.product ?? "") !== (sale.product ?? "") ? (values ? `product ${input.product ?? "none"}` : "a new product") : "",
            (input.note ?? "") !== (sale.note ?? "") ? "a new note" : "",
          ].filter(Boolean);
          return `Fix ${was} to ${now}${more.length ? ` (${more.join(", ")})` : ""}`;
        };
        // The row holds 200 characters. A line that is too long is written shorter (long names cut,
        // the carrier and product named without their new values) so every change is still named;
        // if even that is too long it says there is more instead of being cut silently.
        let summary = sentence(60, true);
        if (summary.length > 200) summary = sentence(28, false);
        if (summary.length > 200) summary = `${summary.slice(0, 181)}… and more changes`;
        await requestApproval({ kind: "edit_past_sale", payload: { sale_id: sale.id, patch }, summary, requestedBy: viewer.agentId });
        await refresh();
        return { ok: true, message: SENT_FOR_OK };
      }
    }
    const found = await updateSale(id, patch);
    await refresh();
    if (!found) return { ok: false, error: "That sale is already gone." };
    return { ok: true, message: "Saved." };
  } catch (err) {
    return { ok: false, error: message(err) };
  }
}

const Name = z.string().trim().min(1).max(60);

export async function addPerson(form: FormData): Promise<ActionResult> {
  try {
    const viewer = await requireViewer("manager");
    const name = Name.safeParse(form.get("name"));
    if (!name.success) return { ok: false, error: "Type the person's name." };
    const existing = await listAgents({ includeInactive: true });
    // The same person however the name was typed (case, spaces, the kind of apostrophe); someone on the board first.
    const same = existing.filter((a) => sameName(a.name, name.data));
    const dup = same.find((a) => a.active) ?? same[0];
    if (dup) {
      if (dup.active) return { ok: false, error: `${dup.name} is already on the team.` };
      // Back on the board brings an old sign-in back with it: for someone who was an admin that is the owner's call.
      if (!isOwner(viewer) && (dup.role === "admin" || dup.role === "owner")) return { ok: false, error: `${dup.name} was an admin. Only the owner can put them back.` };
      await updateAgent(dup.id, { active: true });
      await refresh();
      return { ok: true, message: `${dup.name} is back on the board.` };
    }
    await addAgent(name.data);
    await refresh();
    return { ok: true, message: `${name.data} is on the board.` };
  } catch (err) {
    return { ok: false, error: message(err) };
  }
}

export async function renamePerson(id: string, form: FormData): Promise<ActionResult> {
  try {
    const viewer = await requireViewer("manager");
    const name = Name.safeParse(form.get("name"));
    if (!name.success || !Id.safeParse(id).success) return { ok: false, error: "Type the person's name." };
    const person = await getAgent(id);
    if (!person) return { ok: false, error: "That person isn't here." };
    // The owner's row is the owner's to change (an admin runs everyone else's).
    if (person.role === "owner" && !isOwner(viewer)) return { ok: false, error: "Only the owner can change the owner's name." };
    // Two people on the board with one name: an approval could name the wrong one, and the Shortcut finds neither.
    const taken = (await listAgents()).find((a) => a.id !== id && sameName(a.name, name.data));
    if (taken) return { ok: false, error: `Someone else on the board is ${taken.name}. Add a middle initial.` };
    await updateAgent(id, { name: name.data });
    await refresh();
    return { ok: true, message: "Saved." };
  } catch (err) {
    return { ok: false, error: message(err) };
  }
}

/** Off the board (their sales stay in the history); the same action brings them back. */
export async function setPersonActive(id: string, active: boolean): Promise<ActionResult> {
  try {
    const viewer = await requireViewer("manager");
    if (!Id.safeParse(id).success) return { ok: false, error: "That person isn't here." };
    const person = await getAgent(id);
    if (!person) return { ok: false, error: "That person isn't here." };
    // Off the board ends a person's sign-in and back on the board returns it, so for the owner's
    // row or an admin's both ways are the owner's call (making an admin always waits for the owner).
    if (!isOwner(viewer) && (person.role === "owner" || person.role === "admin")) return { ok: false, error: "Only the owner can take an admin off the board or bring one back." };
    if (!active) {
      // Off the board ends more than today's access: the one-time links they made for others and
      // the unused ones made for them are turned off, and their session version goes up, so no
      // old cookie and no old link works again if they are put back later (their number and
      // password sign in again then). Before the row changes, so a try that fails halfway leaves
      // them on the board and the next try does all of it.
      await revokeInvitesMadeBy(id);
      await revokePersonInvites(id);
      await bumpSession(id);
    }
    await updateAgent(id, { active });
    await refresh();
    return { ok: true, message: active ? "Back on the board." : "Off the board. Their sales stay in the history." };
  } catch (err) {
    return { ok: false, error: message(err) };
  }
}

/** P&C licensed or not (owner, 2026-11-04): Log a sale offers the Life / P&C switch for them. */
export async function setPersonPc(id: string, licensed: boolean): Promise<ActionResult> {
  try {
    await requireViewer("owner");
    if (!Id.safeParse(id).success) return { ok: false, error: "That person isn't here." };
    await updateAgent(id, { pc_licensed: licensed });
    await refresh();
    return { ok: true, message: licensed ? "P&C licensed. Log a sale offers Life or P&C for them." : "Life only on Log a sale for them." };
  } catch (err) {
    return { ok: false, error: message(err) };
  }
}

const Month = z.string().refine(isMonthKey, "month");

/** The team's goal for a month, in dollars ("150000" or "150,000"); 0 clears it. */
export async function saveTeamGoal(month: string, form: FormData): Promise<ActionResult> {
  try {
    await requireViewer("manager");
    if (!Month.safeParse(month).success) return { ok: false, error: "That month isn't right." };
    const raw = String(form.get("goal") ?? "").trim();
    const cents = raw === "" ? 0 : parseDollars(raw);
    if (cents == null) return { ok: false, error: "The goal needs to be an amount, like 150000." };
    await setTeamGoal(month, cents);
    await refresh();
    return { ok: true, message: cents ? "Goal saved. The board shows it now." : "Goal cleared." };
  } catch (err) {
    return { ok: false, error: message(err) };
  }
}

export async function savePersonGoal(month: string, agentId: string, form: FormData): Promise<ActionResult> {
  try {
    await requireViewer("manager");
    if (!Month.safeParse(month).success || !Id.safeParse(agentId).success) return { ok: false, error: "That person or month isn't right." };
    const raw = String(form.get("goal") ?? "").trim();
    const cents = raw === "" ? 0 : parseDollars(raw);
    if (cents == null) return { ok: false, error: "The goal needs to be an amount, like 25000." };
    await setAgentGoal(month, agentId, cents);
    await refresh();
    return { ok: true, message: cents ? "Goal saved." : "Goal cleared." };
  } catch (err) {
    return { ok: false, error: message(err) };
  }
}

/** Settings > P&C goal: the team's P&C goal for a month (the P&C screen measures it). */
export async function saveTeamPcGoal(month: string, form: FormData): Promise<ActionResult> {
  try {
    await requireViewer("owner");
    if (!Month.safeParse(month).success) return { ok: false, error: "That month isn't right." };
    const raw = String(form.get("pc_goal") ?? "").trim();
    const cents = raw === "" ? 0 : parseDollars(raw);
    if (cents == null) return { ok: false, error: "The goal needs to be an amount, like 30000." };
    await setTeamPcGoal(month, cents);
    await refresh();
    return { ok: true, message: cents ? "P&C goal saved. The board shows it now." : "P&C goal cleared." };
  } catch (err) {
    return { ok: false, error: message(err) };
  }
}

/** Team > Edit: a P&C licensed person's own P&C goal for the month. */
export async function savePersonPcGoal(month: string, agentId: string, form: FormData): Promise<ActionResult> {
  try {
    await requireViewer("owner");
    if (!Month.safeParse(month).success || !Id.safeParse(agentId).success) return { ok: false, error: "That person or month isn't right." };
    const raw = String(form.get("pc_goal") ?? "").trim();
    const cents = raw === "" ? 0 : parseDollars(raw);
    if (cents == null) return { ok: false, error: "The goal needs to be an amount, like 8000." };
    await setAgentPcGoal(month, agentId, cents);
    await refresh();
    return { ok: true, message: cents ? "P&C goal saved." : "P&C goal cleared." };
  } catch (err) {
    return { ok: false, error: message(err) };
  }
}

/** The colorway on every screen and the TV (Settings > Colorway). */
export async function saveColorway(key: string): Promise<ActionResult> {
  try {
    await requireViewer("manager");
    if (!isColorwayKey(key)) return { ok: false, error: "That colorway isn't one of the choices." };
    const current = await getSettings();
    await saveSettings({ ...current, colorway: key });
    await refresh();
    return { ok: true, message: "Saved. The TV changes within a few seconds." };
  } catch (err) {
    return { ok: false, error: message(err) };
  }
}

/** Settings > P&C color: P&C's own color on every screen; the TV follows it on its next poll. */
export async function savePcColor(key: string): Promise<ActionResult> {
  try {
    await requireViewer("owner");
    if (!isPcColorKey(key)) return { ok: false, error: "That P&C color isn't one of the choices." };
    const current = await getSettings();
    await saveSettings({ ...current, pcColor: key });
    await refresh();
    return { ok: true, message: "Saved. The TV changes within a few seconds." };
  } catch (err) {
    return { ok: false, error: message(err) };
  }
}

/** Settings > TV look: dark or light on the TV, which follows it on its next poll. */
export async function saveBoardTheme(theme: string): Promise<ActionResult> {
  try {
    await requireViewer("manager");
    if (!isBoardTheme(theme)) return { ok: false, error: "The TV look is Dark or Light." };
    const current = await getSettings();
    await saveSettings({ ...current, boardTheme: theme });
    await refresh();
    return { ok: true, message: "Saved. The TV changes within a few seconds." };
  } catch (err) {
    return { ok: false, error: message(err) };
  }
}

/** Settings > TV screens: rotate the three screens, or keep the TV on one; the TV follows on its next poll. */
export async function saveTvScreens(choice: string): Promise<ActionResult> {
  try {
    await requireViewer("manager");
    if (!isTvScreens(choice)) return { ok: false, error: "That isn't one of the TV screens." };
    const current = await getSettings();
    if ((choice === "pc" || choice === "total") && !current.pcEnabled) return { ok: false, error: "That isn't one of the TV screens." };
    await saveSettings({ ...current, tvScreens: choice });
    await refresh();
    return { ok: true, message: "Saved. The TV changes within a few seconds." };
  } catch (err) {
    return { ok: false, error: message(err) };
  }
}

/** Settings > Sale sound: what the TV plays when a sale lands; the TV follows it on its next poll. */
export async function saveSaleSound(key: string): Promise<ActionResult> {
  try {
    await requireViewer("manager");
    if (!isSoundKey(key)) return { ok: false, error: "That sound isn't one of the choices." };
    const current = await getSettings();
    await saveSettings({ ...current, sound: key });
    await refresh();
    return { ok: true, message: key === "off" ? "Saved. The TV stays quiet." : "Saved. The TV plays it on the next sale." };
  } catch (err) {
    return { ok: false, error: message(err) };
  }
}

/** The board message and the product and carrier chips (the owner or an admin). */
export async function saveBoardSettings(form: FormData): Promise<ActionResult> {
  try {
    const viewer = await requireViewer("manager");
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
    // "Progressive: Auto, Renters, ATV", one carrier per line; a line without a colon is a carrier with no lines yet.
    const pcCarriers: PcCarrier[] = [];
    for (const row of String(form.get("pc_carriers") ?? "").split(/\n/)) {
      const [head, rest = ""] = row.split(":");
      const name = head.trim().slice(0, 40);
      if (!name || pcCarriers.some((c) => c.name.toLowerCase() === name.toLowerCase())) continue;
      const lines = rest
        .split(",")
        .map((l) => l.trim().slice(0, 40))
        .filter(Boolean)
        .filter((l, i, all) => all.findIndex((q) => q.toLowerCase() === l.toLowerCase()) === i)
        .slice(0, 12);
      pcCarriers.push({ name, lines });
      if (pcCarriers.length === 20) break;
    }
    // The P&C carriers change only when the owner's form sent them: a form without that box
    // (P&C is off, or an admin's Settings) keeps what is stored, and so does a missing chips box.
    const keepPc = !isOwner(viewer) || !form.has("pc_carriers");
    await saveSettings({
      ...current,
      message: msg,
      products: form.has("products") ? chips(form.get("products"), DEFAULT_PRODUCTS) : current.products,
      carriers: form.has("carriers") ? chips(form.get("carriers"), DEFAULT_CARRIERS) : current.carriers,
      pcCarriers: keepPc ? current.pcCarriers : pcCarriers.length ? pcCarriers : DEFAULT_PC_CARRIERS,
    });
    await refresh();
    return { ok: true, message: "Saved. The board updates within a few seconds." };
  } catch (err) {
    return { ok: false, error: message(err) };
  }
}
