"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { endSession, requireViewer, startPersonSession } from "@/lib/auth";
import { getAgent, getSettings, lineFor, listAgents, saveSettings, touchBoard } from "@/lib/data";
import { bumpSession, checkOwnPassword, cleanName, confirmUpline as confirmPickedUpline, declineUpline as declinePickedUpline, getPerson, sameName, setInOffice, setName, setPersonPassword, setPhone, setRole, setUpline, type Person } from "@/lib/people";
import { agencyToken, createInvite, joinUrl, revokeAgencyInvites, revokeInvitesMadeBy, revokeOwnTeamLinks, revokePersonInvites } from "@/lib/invites";
import { decideApproval as decide, listApprovals, requestApproval, type Approval } from "@/lib/approvals";
import { passwordProblem } from "@/lib/passwords";
import { normalizePhone } from "@/lib/phone";
import { isAdmin, isOwner, type Viewer } from "@/lib/viewer";
import { canConfirmJoiner, canGetJoinLink, canManageAccess, ruleContext } from "@/lib/rules";
import type { ActionResult } from "./actions";

/**
 * People, join links, approvals and the owner's switches (owner, 2026-11-12). Every action
 * checks the level first, on the server (src/lib/viewer.ts, src/lib/rules.ts): most need an admin
 * (the owner or an admin); a manager confirms the people who picked them (or someone under them)
 * and gets their own team's join link. A phone number or a link goes back only to whoever may
 * have it; nothing here is logged.
 */
export type LinkResult = { ok: true; url: string } | { ok: false; error: string };

// Any id Postgres holds (the shape only: zod's uuid() also wants an RFC version, which refuses ids typed by hand).
const Id = z.guid();
const SENT_FOR_OK = "Sent to Anersi for a quick OK.";

/**
 * The line a person sees when an action fails: the words the code threw on purpose ("Only an
 * admin can do that"), and for anything else (the database, its client) "That didn't save. Try
 * again." with the class logged, so no table or column wording reaches a screen (data.ts lineFor).
 */
function message(err: unknown): string {
  return lineFor(err);
}

/** After a change: the pages read again, and the TV is told, so it shows within one poll (data.ts touchBoard). */
async function refresh(): Promise<void> {
  revalidatePath("/", "layout");
  await touchBoard();
}

/** Whose team a person is on (null: nobody above them). The owner or an admin. */
export async function setPersonUpline(id: string, uplineId: string | null): Promise<ActionResult> {
  try {
    await requireViewer("admin");
    if (!Id.safeParse(id).success || (uplineId !== null && !Id.safeParse(uplineId).success)) return { ok: false, error: "That person isn't here." };
    await setUpline(id, uplineId);
    await refresh();
    return { ok: true, message: "Saved." };
  } catch (err) {
    return { ok: false, error: message(err) };
  }
}

/** In the office or not (the office group leads every board). The owner or an admin; a person sets their own on their profile. */
export async function setPersonInOffice(id: string, on: boolean): Promise<ActionResult> {
  try {
    await requireViewer("admin");
    if (!Id.safeParse(id).success) return { ok: false, error: "That person isn't here." };
    if (!(await getAgent(id))) return { ok: false, error: "That person isn't here." };
    await setInOffice(id, on === true);
    await refresh();
    return { ok: true, message: on ? "In the office: at the top of the boards." : "Not in the office." };
  } catch (err) {
    return { ok: false, error: message(err) };
  }
}

const LEVEL_WORDS: Record<"admin" | "manager" | "member", string> = { admin: "an admin", manager: "a manager", member: "an agent" };

/**
 * Sets someone's level: "member" (an agent), "manager" or "admin" (contract decision 7). An admin
 * makes someone an agent or a manager at once. Making an admin, or taking an admin's level away,
 * is the owner's: the owner does it at once, an admin's ask goes to the owner and nothing changes
 * until the owner says yes. Nobody changes their own level; the owner's never changes.
 */
export async function setPersonRole(id: string, role: string): Promise<ActionResult> {
  try {
    const viewer = await requireViewer("admin");
    if (!Id.safeParse(id).success || (role !== "admin" && role !== "manager" && role !== "member")) return { ok: false, error: "That isn't one of the levels." };
    const person = await getAgent(id);
    if (!person) return { ok: false, error: "That person isn't here." };
    if (person.role === "owner") return { ok: false, error: "The owner stays the owner." };
    if (viewer.agentId && person.id === viewer.agentId) return { ok: false, error: "Ask someone else to change your own level." };
    const was = person.role ?? "member";
    if (was === role) return { ok: true, message: `${person.name} is already ${LEVEL_WORDS[role]}.` };
    if (role === "admin" && !person.active) return { ok: false, error: `${person.name} is off the board. Bring them back first.` };
    const touchesAdmin = role === "admin" || was === "admin";
    if (touchesAdmin && !isOwner(viewer)) {
      await requestApproval({
        kind: role === "admin" ? "make_admin" : "remove_admin",
        // Taking an admin's level away lands on the level asked for (an agent, or a manager).
        payload: role === "admin" ? { agent_id: person.id } : { agent_id: person.id, role },
        summary: role === "admin" ? `Make ${person.name} an admin` : `Make ${person.name} ${LEVEL_WORDS[role]} (not an admin)`,
        requestedBy: viewer.agentId,
      });
      await refresh();
      return { ok: true, message: SENT_FOR_OK };
    }
    // The one-time links an admin made for others stop with the level. First, so a try that
    // fails halfway leaves the level as it was and the next try does both.
    if (was === "admin") await revokeInvitesMadeBy(person.id);
    // An agent hands out no team link: the ones they made for their own team as a manager or an
    // admin stop (contract decision 7).
    if (role === "member") await revokeOwnTeamLinks(person.id);
    await setRole(person.id, role);
    // A personal link made while they were an agent must not hand out an admin's sign-in.
    if (role === "admin") await revokePersonInvites(person.id);
    await refresh();
    if (role === "admin") return { ok: true, message: `${person.name} is an admin now.` };
    if (was === "admin") return { ok: true, message: `${person.name} is not an admin anymore.` };
    return { ok: true, message: `${person.name} is ${LEVEL_WORDS[role]} now.` };
  } catch (err) {
    return { ok: false, error: message(err) };
  }
}

/**
 * The upline a joiner picked is confirmed: they join that team (team numbers, My team) and the
 * people above them see their clients. That upline, a manager above them, or an admin (rules.ts
 * canConfirmJoiner, checked here on the server).
 */
export async function confirmUpline(id: string): Promise<ActionResult> {
  return answerJoiner(id, true);
}

/** "Not on my team": the picked upline is cleared; the person stays on the board, on nobody's team. */
export async function declineUpline(id: string): Promise<ActionResult> {
  return answerJoiner(id, false);
}

async function answerJoiner(id: string, yes: boolean): Promise<ActionResult> {
  try {
    const viewer = await requireViewer();
    if (!Id.safeParse(id).success) return { ok: false, error: "That person isn't here." };
    const agents = await listAgents({ includeInactive: true });
    const person = agents.find((a) => a.id === id);
    if (!person) return { ok: false, error: "That person isn't here." };
    if (person.upline_confirmed !== false || !person.upline_id) return { ok: true, message: `${person.name} isn't waiting anymore.` };
    if (!canConfirmJoiner(viewer, person, ruleContext(agents))) return { ok: false, error: "Only their upline's managers or an admin can confirm them." };
    const done = yes ? await confirmPickedUpline(person.id, person.upline_id) : await declinePickedUpline(person.id, person.upline_id);
    if (!done) return { ok: true, message: `${person.name} isn't waiting anymore.` };
    await refresh();
    const upline = agents.find((a) => a.id === person.upline_id);
    return { ok: true, message: yes ? `${person.name} is on ${upline ? `${upline.name.split(" ")[0]}'s` : "the"} team.` : `${person.name} isn't on a team now. An admin can set their upline.` };
  } catch (err) {
    return { ok: false, error: message(err) };
  }
}

/**
 * The join link to send people (made the first time it is asked for, the same link after that).
 * With a leader's id: a link that puts whoever joins on that leader's team (confirmed at once).
 * The owner or an admin: any; a manager: their own team's only (contract decision 7).
 */
export async function getJoinLink(uplineId?: string | null): Promise<LinkResult> {
  try {
    const viewer = await requireViewer();
    const leader = uplineId ?? null;
    if (!canGetJoinLink(viewer, leader)) return { ok: false, error: isAdmin(viewer) || viewer.level !== "manager" ? "Only an admin can do that" : "You can share your own team's link." };
    if (leader !== null) {
      if (!Id.safeParse(leader).success) return { ok: false, error: "That person isn't here." };
      const person = await getAgent(leader);
      if (!person || !person.active) return { ok: false, error: "That person isn't on the board." };
    }
    return { ok: true, url: await joinUrl(await agencyToken(leader, viewer.agentId)) };
  } catch (err) {
    return { ok: false, error: message(err) };
  }
}

/** Turns off every join link that is out (the agency's and each leader's) and makes a new agency link. */
export async function resetJoinLink(): Promise<LinkResult> {
  try {
    const viewer = await requireViewer("admin");
    await revokeAgencyInvites();
    const url = await joinUrl(await agencyToken(null, viewer.agentId));
    await refresh();
    return { ok: true, url };
  } catch (err) {
    return { ok: false, error: message(err) };
  }
}

/** A person whose sign-in may be handed out: an admin for agents and managers, the owner for anyone (rules.ts canManageAccess). */
async function linkTarget(id: string, viewer: Viewer): Promise<{ person: Person; error?: undefined } | { person?: undefined; error: string }> {
  if (!Id.safeParse(id).success) return { error: "That person isn't here." };
  const person = await getPerson(id);
  if (!person) return { error: "That person isn't here." };
  if (!person.active) return { error: `${person.name} is off the board. Bring them back first.` };
  // A link is a way to sign in as that person: an admin's or the owner's is the owner's to give.
  if (!canManageAccess(viewer, person)) return { error: "Only the owner can make a link for an admin." };
  return { person };
}

/**
 * A one-time link for a person already on the board: they open it and set their own number and
 * password. Works once, for 7 days; a newer link turns the older one off. Returns the address
 * (shown once: only its hash is stored).
 */
export async function createPersonInvite(id: string): Promise<LinkResult> {
  try {
    const viewer = await requireViewer("admin");
    const target = await linkTarget(id, viewer);
    if (!target.person) return { ok: false, error: target.error };
    const { token } = await createInvite({ kind: "person", agentId: target.person.id, createdBy: viewer.agentId });
    return { ok: true, url: await joinUrl(token) };
  } catch (err) {
    return { ok: false, error: message(err) };
  }
}

/**
 * A one-time link for a person who forgot their password: they open it and set a new one (their
 * old password works until they do; setting the new one signs their other devices out). Someone
 * with no sign-in yet gets the set-up link instead. Returns the address, shown once.
 */
export async function resetPersonSignIn(id: string): Promise<LinkResult> {
  try {
    const viewer = await requireViewer("admin");
    const target = await linkTarget(id, viewer);
    if (!target.person) return { ok: false, error: target.error };
    const kind = target.person.has_login && target.person.phone ? "reset" : "person";
    const { token } = await createInvite({ kind, agentId: target.person.id, createdBy: viewer.agentId });
    return { ok: true, url: await joinUrl(token) };
  } catch (err) {
    return { ok: false, error: message(err) };
  }
}

/** The owner's inbox: what waits for a yes, then the last 30 answered. Owner only. */
export async function listApprovalsForOwner(): Promise<Approval[]> {
  await requireViewer("owner");
  return listApprovals();
}

/** The owner's yes or no to one request. Owner only; a second tap finds it already answered. */
export async function decideApproval(id: string, approve: boolean): Promise<ActionResult> {
  try {
    const viewer = await requireViewer("owner");
    const result = await decide(id, approve === true, viewer);
    await refresh();
    return result;
  } catch (err) {
    return { ok: false, error: message(err) };
  }
}

/** The agency's name on every screen (form field "agency_name"). The owner or an admin. */
export async function saveAgencyName(form: FormData): Promise<ActionResult> {
  try {
    await requireViewer("admin");
    const name = String(form.get("agency_name") ?? "")
      .replace(/\s+/g, " ")
      .trim();
    if (!name) return { ok: false, error: "Type the agency's name." };
    if (name.length > 40) return { ok: false, error: "Keep the agency's name to 40 characters." };
    const current = await getSettings();
    await saveSettings({ ...current, agencyName: name });
    await refresh();
    return { ok: true, message: "Saved. Every screen shows it now." };
  } catch (err) {
    return { ok: false, error: message(err) };
  }
}

/** The owner's switch for the second kind of sale and the combined total. Owner only. */
export async function savePcEnabled(on: boolean): Promise<ActionResult> {
  try {
    await requireViewer("owner");
    const current = await getSettings();
    // Back off: the TV cannot stay on a screen that no longer exists.
    const tvScreens = !on && (current.tvScreens === "pc" || current.tvScreens === "total") ? "rotate" : current.tvScreens;
    await saveSettings({ ...current, pcEnabled: on === true, tvScreens });
    await refresh();
    return { ok: true, message: on ? "On. P&C and the agency total are back on every screen." : "Off. Scorecard is life insurance only." };
  } catch (err) {
    return { ok: false, error: message(err) };
  }
}

/**
 * A person's own profile (form fields "name", "phone", "in_office" = "1" or "0"; a field that is
 * not sent is left alone). Only ever the signed-in person's own row: the request names nobody.
 */
export async function updateMyProfile(form: FormData): Promise<ActionResult> {
  try {
    const viewer = await requireViewer();
    if (!viewer.agentId) return { ok: false, error: "You're on the team password. Ask for a join link to get your own sign-in." };
    const me = await getPerson(viewer.agentId);
    if (!me) return { ok: false, error: "Sign in again." };
    // Everything is checked first and the one write that can be refused (the number) goes first,
    // so a save the screen calls refused has changed nothing.
    let rename: string | null = null;
    if (form.has("name")) {
      const name = cleanName(form.get("name"));
      if (!name) return { ok: false, error: "Type your first and last name." };
      if (name !== me.name) {
        const others = await listAgents();
        if (others.some((a) => a.id !== me.id && sameName(a.name, name))) return { ok: false, error: `Someone else on the board is ${name}. Add a middle initial.` };
        rename = name;
      }
    }
    if (form.has("phone")) {
      const typed = String(form.get("phone") ?? "").trim();
      const phone = normalizePhone(typed);
      // The number is the name they sign in with: it can change, but someone with a sign-in cannot clear it.
      if (!phone && (typed || me.has_login)) return { ok: false, error: "Type your cell number with the area code, like 248 555 0100." };
      if (phone !== me.phone) await setPhone(me.id, phone);
    }
    if (rename) await setName(me.id, rename);
    if (form.has("in_office")) {
      const v = String(form.get("in_office"));
      await setInOffice(me.id, v === "1" || v === "on" || v === "true");
    }
    await refresh();
    return { ok: true, message: "Saved." };
  } catch (err) {
    return { ok: false, error: message(err) };
  }
}

/**
 * A person changes their own password (form fields "current" and "password"). The current one is
 * asked for, except the first time (no password yet). Every other device is signed out; this one
 * stays signed in with a fresh session.
 */
export async function changeMyPassword(form: FormData): Promise<ActionResult> {
  try {
    const viewer = await requireViewer();
    if (!viewer.agentId) return { ok: false, error: "You're on the team password. Ask for a join link to get your own sign-in." };
    const me = await getPerson(viewer.agentId);
    if (!me) return { ok: false, error: "Sign in again." };
    const next = String(form.get("password") ?? "");
    const problem = passwordProblem(next);
    if (problem) return { ok: false, error: problem };
    if (me.has_login) {
      const current = String(form.get("current") ?? "");
      if (!current) return { ok: false, error: "Type your current password first." };
      if (!(await checkOwnPassword(me.id, current))) return { ok: false, error: "That isn't your current password." };
    } else if (!me.phone) {
      return { ok: false, error: "Add your cell number first: it is the name you sign in with." };
    }
    const version = await setPersonPassword(me.id, next);
    // This device keeps going on the new session; a shared-password session (the owner password) is left as it is.
    if (viewer.via === "person") await startPersonSession(me.id, version);
    // The page reads again: on the owner password the card now asks for the current password.
    await refresh();
    return { ok: true, message: "Password changed. Your other devices are signed out." };
  } catch (err) {
    return { ok: false, error: message(err) };
  }
}

/** Signs the person out on every device, this one too, and goes to the sign-in screen. */
export async function signOutEverywhere(): Promise<ActionResult> {
  try {
    const viewer = await requireViewer();
    if (viewer.via !== "person" || !viewer.agentId) return { ok: false, error: "You're on a shared password. Changing that password in Vercel signs every device out." };
    await bumpSession(viewer.agentId);
    await endSession();
  } catch (err) {
    return { ok: false, error: message(err) };
  }
  redirect("/login");
}
