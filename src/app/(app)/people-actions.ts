"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { endSession, requireViewer, startPersonSession } from "@/lib/auth";
import { getAgent, getSettings, lineFor, listAgents, saveSettings, touchBoard } from "@/lib/data";
import { bumpSession, checkOwnPassword, cleanName, getPerson, sameName, setInOffice, setName, setPersonPassword, setPhone, setRole, setUpline, type Person } from "@/lib/people";
import { agencyToken, createInvite, joinUrl, revokeAgencyInvites, revokeInvitesMadeBy, revokePersonInvites } from "@/lib/invites";
import { decideApproval as decide, listApprovals, requestApproval, type Approval } from "@/lib/approvals";
import { passwordProblem } from "@/lib/passwords";
import { normalizePhone } from "@/lib/phone";
import { isOwner, type Viewer } from "@/lib/viewer";
import type { ActionResult } from "./actions";

/**
 * People, join links, approvals and the owner's switches (owner, 2026-11-12). Every action
 * checks the level first, on the server (src/lib/viewer.ts): a manager is the owner or an admin.
 * A phone number or a link goes back only to a manager; nothing here is logged.
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

/**
 * Makes someone an admin, or a member again. The owner: at once. An admin: the request goes to
 * the owner and nothing changes until the owner says yes. The owner's own level never changes.
 */
export async function setPersonRole(id: string, role: string): Promise<ActionResult> {
  try {
    const viewer = await requireViewer("admin");
    if (!Id.safeParse(id).success || (role !== "admin" && role !== "member")) return { ok: false, error: "That isn't one of the levels." };
    const person = await getAgent(id);
    if (!person) return { ok: false, error: "That person isn't here." };
    if (person.role === "owner") return { ok: false, error: "The owner stays the owner." };
    if ((person.role ?? "member") === role) return { ok: true, message: role === "admin" ? `${person.name} is already an admin.` : `${person.name} is not an admin.` };
    if (role === "admin" && !person.active) return { ok: false, error: `${person.name} is off the board. Bring them back first.` };
    if (!isOwner(viewer)) {
      await requestApproval({
        kind: role === "admin" ? "make_admin" : "remove_admin",
        payload: { agent_id: person.id },
        summary: role === "admin" ? `Make ${person.name} an admin` : `Make ${person.name} a member again (not an admin)`,
        requestedBy: viewer.agentId,
      });
      await refresh();
      return { ok: true, message: SENT_FOR_OK };
    }
    // The one-time links an admin made for others stop with the level. First, so a try that
    // fails halfway leaves the level as it was and the next try does both.
    if (role === "member") await revokeInvitesMadeBy(person.id);
    await setRole(person.id, role);
    // A personal link made while they were a member must not hand out an admin's sign-in.
    if (role === "admin") await revokePersonInvites(person.id);
    await refresh();
    return { ok: true, message: role === "admin" ? `${person.name} is an admin now.` : `${person.name} is not an admin anymore.` };
  } catch (err) {
    return { ok: false, error: message(err) };
  }
}

/**
 * The join link to send people (made the first time it is asked for, the same link after that).
 * With a leader's id: a link that puts whoever joins on that leader's team. The owner or an admin.
 */
export async function getJoinLink(uplineId?: string | null): Promise<LinkResult> {
  try {
    const viewer = await requireViewer("admin");
    const leader = uplineId ?? null;
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

/** A person whose sign-in a manager may hand out: an admin only for members, the owner for anyone. */
async function linkTarget(id: string, viewer: Viewer): Promise<{ person: Person; error?: undefined } | { person?: undefined; error: string }> {
  if (!Id.safeParse(id).success) return { error: "That person isn't here." };
  const person = await getPerson(id);
  if (!person) return { error: "That person isn't here." };
  if (!person.active) return { error: `${person.name} is off the board. Bring them back first.` };
  // A link is a way to sign in as that person: an admin's or the owner's is the owner's to give.
  if (!isOwner(viewer) && (person.role ?? "member") !== "member") return { error: "Only the owner can make a link for an admin." };
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

/** Whether the shared team password may still log sales (off: it only looks). Owner only. */
export async function saveTeamPasswordLogs(on: boolean): Promise<ActionResult> {
  try {
    await requireViewer("owner");
    const current = await getSettings();
    await saveSettings({ ...current, teamPasswordLogs: on === true });
    await refresh();
    return { ok: true, message: on ? "The team password can log sales." : "The team password only looks now. People log with their own sign-in." };
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
