"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireViewer } from "@/lib/auth";
import { addAgent, getAgent, lineFor, listAgents, saveSettings, setAgentGoal, setAgentPcGoal, setTeamGoal, setTeamPcGoal, touchBoard, updateAgent, getSettings } from "@/lib/data";
import { bumpSession, sameName } from "@/lib/people";
import { revokeInvitesMadeBy, revokePersonInvites } from "@/lib/invites";
import { isOwner } from "@/lib/viewer";
import { isMonthKey } from "@/lib/month";
import { parseDollars } from "@/lib/money";
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
 *   admin   goals, people, the board's settings; making or removing an admin waits for the
 *           owner's yes (an approvals row)
 * Logging, fixing and removing a sale (a policy) live in ./sale-actions.ts (src/lib/policies.ts
 * checks the rules there).
 */
// Any id Postgres holds (the shape only: zod's uuid() also wants an RFC version, which refuses ids typed by hand).
const Id = z.guid();

const Name = z.string().trim().min(1).max(60);

export async function addPerson(form: FormData): Promise<ActionResult> {
  try {
    const viewer = await requireViewer("admin");
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
    const viewer = await requireViewer("admin");
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
    const viewer = await requireViewer("admin");
    if (!Id.safeParse(id).success) return { ok: false, error: "That person isn't here." };
    const person = await getAgent(id);
    if (!person) return { ok: false, error: "That person isn't here." };
    // Off the board ends a person's sign-in, and back on the board lets their number and password
    // sign in again, so for the owner's row or an admin's both ways are the owner's call (making
    // an admin always waits for the owner).
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
    await requireViewer("admin");
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
    await requireViewer("admin");
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
    await requireViewer("admin");
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
    await requireViewer("admin");
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
    await requireViewer("admin");
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
    await requireViewer("admin");
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
    const viewer = await requireViewer("admin");
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

/** "Americo: WL/FEX, TERM, IUL", one carrier per line, into each carrier with its products (up to 30 carriers, 12 products each). */
function carrierLines(raw: FormDataEntryValue | null): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const line of String(raw ?? "").split(/\n/)) {
    const at = line.indexOf(":");
    const name = (at >= 0 ? line.slice(0, at) : line).trim().slice(0, 40);
    if (!name || Object.keys(out).some((k) => k.toLowerCase() === name.toLowerCase())) continue;
    const products = (at >= 0 ? line.slice(at + 1) : "")
      .split(",")
      .map((x) => x.trim().slice(0, 40))
      .filter(Boolean)
      .filter((x, i, all) => all.findIndex((q) => q.toLowerCase() === x.toLowerCase()) === i)
      .slice(0, 12);
    out[name] = products.length ? products : ["WL/FEX"];
    if (Object.keys(out).length === 30) break;
  }
  return out;
}

/** One per line, each cut to `max` characters, no repeats, up to 20. */
function lineList(raw: FormDataEntryValue | null, max: number): string[] {
  return String(raw ?? "")
    .split(/\n/)
    .map((x) => x.trim().slice(0, max))
    .filter(Boolean)
    .filter((x, i, all) => all.findIndex((q) => q.toLowerCase() === x.toLowerCase()) === i)
    .slice(0, 20);
}

/**
 * Settings > Carriers and products, Rate classes, Lead sources (the owner or an admin; contract
 * decision 15): the lists Log a sale offers. Each box changes only when the form sends it; an
 * empty box keeps what is stored. The carriers on the board follow the carriers listed here.
 */
export async function saveSaleLists(form: FormData): Promise<ActionResult> {
  try {
    await requireViewer("admin");
    const current = await getSettings();
    const next = { ...current };
    if (form.has("carrier_products")) {
      const cp = carrierLines(form.get("carrier_products"));
      if (!Object.keys(cp).length) return { ok: false, error: "List at least one carrier, like \"Americo: WL/FEX, TERM\"." };
      next.carrierProducts = cp;
      next.carriers = Object.keys(cp).slice(0, 20);
      next.products = [...new Set(Object.values(cp).flat())].slice(0, 20);
    }
    if (form.has("rate_classes")) {
      const list = lineList(form.get("rate_classes"), 40);
      if (!list.length) return { ok: false, error: "List at least one rate class." };
      next.rateClasses = list;
    }
    if (form.has("lead_sources")) {
      const list = lineList(form.get("lead_sources"), 60);
      if (!list.length) return { ok: false, error: "List at least one lead source." };
      next.leadSources = list;
    }
    await saveSettings(next);
    await refresh();
    return { ok: true, message: "Saved. Log a sale offers it now." };
  } catch (err) {
    return { ok: false, error: message(err) };
  }
}
