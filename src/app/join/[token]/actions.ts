"use server";

import { redirect } from "next/navigation";
import { beginTry, clientAddress, JOIN_MAX_PER_IP, JOINED_MAX_PER_IP, joinKey, joinedKey, startPersonSession, type Try } from "@/lib/auth";
import { touchBoard } from "@/lib/data";
import { readInvite, type Invite } from "@/lib/invites";
import { BAD_LINK, joinWithInvite, type JoinResult } from "@/lib/people";

export type JoinState = { error: string | null };

const TOO_MANY = "Too many tries. Wait 15 minutes and try again.";
const DOWN = "Scorecard couldn't save that. Try again in a minute.";
const TOO_MANY_JOINED = "A lot of people just joined from this Wi-Fi. Wait 15 minutes and try again.";

/**
 * Joining through a link (form fields "token", "name", "phone", "password", "upline_id",
 * "in_office" = "1" or "0"). Everything is checked on the server (joinWithInvite); this only
 * keeps the address's counts, signs the new person in and sends them to the phone guide.
 *
 * Both counts are written BEFORE anything is checked (auth.ts beginTry), so tries sent at the
 * same moment cannot all get under a limit:
 *   "join:<address>"    30  tries that say something about who is on Scorecard (a dead link, a
 *                           number or a name that already has a sign-in); a join that works, or a
 *                           typo, takes its row back
 *   "joined:<address>"  60  people made through the agency link; a try that makes nobody takes its row back
 */
export async function join(form: FormData): Promise<JoinState> {
  const token = String(form.get("token") ?? "");
  const address = await clientAddress();
  const probe = await beginTry(joinKey(address), JOIN_MAX_PER_IP);
  if (probe.closed) return { error: TOO_MANY };
  let invite: Invite | null;
  try {
    invite = await readInvite(token);
  } catch {
    await probe.takeBack();
    return { error: DOWN };
  }
  // A dead link stays counted.
  if (!invite) return { error: BAD_LINK };
  // The agency link makes people: each one made from this address is counted, and past the limit
  // (well above one office's first day) the link waits, so a link that got out cannot flood the board.
  let made: Try | null = null;
  if (invite.kind === "agency") {
    made = await beginTry(joinedKey(address), JOINED_MAX_PER_IP);
    if (made.closed) {
      await probe.takeBack();
      return { error: TOO_MANY_JOINED };
    }
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
    await made?.takeBack();
    await probe.takeBack();
    return { error: DOWN };
  }
  if (!result.ok) {
    // Nobody was made; a refusal that says something about who is on Scorecard stays counted, a typo does not.
    await made?.takeBack();
    if (!result.counts) await probe.takeBack();
    return { error: result.error };
  }
  // They are in: the try was not a wrong one (the "joined" row stays: a person was made).
  await probe.takeBack();
  // The TV is told, so a new person shows within one poll.
  await touchBoard();
  await startPersonSession(result.agentId, result.sessionVersion);
  // A new sign-in goes to the phone guide; a new password for an old one goes straight in.
  redirect(invite.kind === "reset" ? "/" : "/install?welcome=1");
}
