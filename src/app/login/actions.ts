"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { beginTry, clearLoginFailures, clientAddress, MAX_PER_IP, roleForPassword, signInKey, SIGNIN_MAX_PER_IP, startPersonSession } from "@/lib/auth";
import { verifyPersonLogin } from "@/lib/people";
import { createSessionToken, passwordFor, SESSION_COOKIE, SESSION_TTL_SECONDS } from "@/lib/session";
import { safeNextPath } from "@/lib/safe-next";

export type LoginState = { error: string | null };

const TOO_MANY = "Too many tries. Wait 15 minutes and try again.";
/** The personal form's own limit (an office is one address): the shared-password form is not closed with it. */
const TOO_MANY_PERSONAL = "Too many tries from this network. Wait a few minutes, or ask an admin for a new sign-in link.";

/**
 * The shared passwords (the team's, the TV's and the owner's), as they always worked. Ten wrong
 * tries from one address close this form for that address; a person's own sign-in is counted
 * beside it (signIn below), so neither form closes the other.
 */
export async function login(_prev: LoginState, form: FormData): Promise<LoginState> {
  const password = String(form.get("password") ?? "");
  const next = safeNextPath(String(form.get("next") ?? "/"));
  const ip = await clientAddress();
  // Counted before the password is looked at: tries sent at the same moment cannot all get through.
  const attempt = await beginTry(ip, MAX_PER_IP);
  if (attempt.closed) return { error: TOO_MANY };
  if (!passwordFor("owner")) {
    await attempt.takeBack();
    return { error: "The app has no password yet. Add OWNER_PASSWORD in Vercel (see SETUP.md)." };
  }
  const role = roleForPassword(password);
  // A wrong try stays counted for 15 minutes.
  if (!role) return { error: "That password isn't right." };
  // Only the owner password clears the address's wrong tries. The team password takes back its own
  // try and nothing else: the whole agency has it, and could guess at the owner password without
  // limit by typing it in between.
  if (role === "owner") await clearLoginFailures(ip);
  else await attempt.takeBack();
  const token = await createSessionToken(role, SESSION_TTL_SECONDS);
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
  redirect(next);
}

/**
 * A person's own sign-in: their cell number and the password they chose. One message for every
 * way it can fail (unknown number, wrong password, off the board, a locked account), so the
 * screen never says which numbers have a sign-in.
 */
export async function signIn(_prev: LoginState, form: FormData): Promise<LoginState> {
  const phone = String(form.get("phone") ?? "");
  const password = String(form.get("password") ?? "");
  const next = safeNextPath(String(form.get("next") ?? "/"));
  // Counted under the personal form's own key, before the password is looked at (60 in 15
  // minutes for one address; each account also closes to a guesser at 20, in verifyPersonLogin).
  const key = signInKey(await clientAddress());
  const attempt = await beginTry(key, SIGNIN_MAX_PER_IP);
  if (attempt.closed) return { error: TOO_MANY_PERSONAL };
  let person: Awaited<ReturnType<typeof verifyPersonLogin>> = null;
  try {
    person = await verifyPersonLogin(phone, password, key);
  } catch {
    // Nothing was checked, so nothing was guessed: the try is not counted.
    await attempt.takeBack();
    return { error: "Scorecard can't check that right now. Try again in a minute." };
  }
  // A wrong try stays counted for 15 minutes.
  if (!person) return { error: "That phone number and password don't match." };
  // A right sign-in takes back its own try and leaves the address's wrong ones counted (they age out in 15 minutes).
  await attempt.takeBack();
  await startPersonSession(person.id, person.sessionVersion);
  redirect(next);
}

export async function logout(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
  redirect("/login");
}
