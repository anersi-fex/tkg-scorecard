"use server";

import { redirect } from "next/navigation";
import { clientAddress, JOIN_MAX_PER_IP, joinKey, loginThrottled, recordLoginFailure, startPersonSession } from "@/lib/auth";
import { readInvite, type Invite } from "@/lib/invites";
import { BAD_LINK, joinWithInvite, type JoinResult } from "@/lib/people";

export type JoinState = { error: string | null };

const TOO_MANY = "Too many tries. Wait 15 minutes and try again.";
const DOWN = "Scorecard couldn't save that. Try again in a minute.";

/**
 * Joining through a link (form fields "token", "name", "phone", "password", "upline_id",
 * "in_office" = "1" or "0"). Everything is checked on the server (joinWithInvite); this only
 * keeps the address's count, signs the new person in and sends them to the phone guide.
 */
export async function join(form: FormData): Promise<JoinState> {
  const token = String(form.get("token") ?? "");
  const key = joinKey(await clientAddress());
  if (await loginThrottled(key, JOIN_MAX_PER_IP)) return { error: TOO_MANY };
  let invite: Invite | null;
  try {
    invite = await readInvite(token);
  } catch {
    return { error: DOWN };
  }
  if (!invite) {
    await recordLoginFailure(key);
    return { error: BAD_LINK };
  }
  const upline = String(form.get("upline_id") ?? "");
  let result: JoinResult;
  try {
    result = await joinWithInvite({
      token,
      name: String(form.get("name") ?? ""),
      phone: String(form.get("phone") ?? ""),
      password: String(form.get("password") ?? ""),
      uplineId: upline || null,
      inOffice: String(form.get("in_office") ?? "") === "1",
    });
  } catch {
    return { error: DOWN };
  }
  if (!result.ok) {
    if (result.counts) await recordLoginFailure(key);
    return { error: result.error };
  }
  await startPersonSession(result.agentId, result.sessionVersion);
  // A new sign-in goes to the phone guide; a new password for an old one goes straight in.
  redirect(invite.kind === "reset" ? "/" : "/install?welcome=1");
}
