"use server";

import { redirect } from "next/navigation";
import { clientAddress, JOIN_MAX_PER_IP, JOINED_MAX_PER_IP, joinKey, joinedKey, loginThrottled, recordLoginFailure, startPersonSession } from "@/lib/auth";
import { readInvite, type Invite } from "@/lib/invites";
import { BAD_LINK, joinWithInvite, type JoinResult } from "@/lib/people";

export type JoinState = { error: string | null };

const TOO_MANY = "Too many tries. Wait 15 minutes and try again.";
const DOWN = "Scorecard couldn't save that. Try again in a minute.";
const TOO_MANY_JOINED = "A lot of people just joined from this Wi-Fi. Wait 15 minutes and try again.";

/**
 * Joining through a link (form fields "token", "name", "phone", "password", "upline_id",
 * "in_office" = "1" or "0"). Everything is checked on the server (joinWithInvite); this only
 * keeps the address's count, signs the new person in and sends them to the phone guide.
 */
export async function join(form: FormData): Promise<JoinState> {
  const token = String(form.get("token") ?? "");
  const address = await clientAddress();
  const key = joinKey(address);
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
  // The agency link makes people: each one made from this address is counted, and past the limit
  // (well above one office's first day) the link waits, so a link that got out cannot flood the board.
  const joined = joinedKey(address);
  if (invite.kind === "agency" && (await loginThrottled(joined, JOINED_MAX_PER_IP))) return { error: TOO_MANY_JOINED };
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
  if (invite.kind === "agency") await recordLoginFailure(joined);
  await startPersonSession(result.agentId, result.sessionVersion);
  // A new sign-in goes to the phone guide; a new password for an old one goes straight in.
  redirect(invite.kind === "reset" ? "/" : "/install?welcome=1");
}
