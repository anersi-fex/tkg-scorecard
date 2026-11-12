"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { clearLoginFailures, clientAddress, loginThrottled, recordLoginFailure, roleForPassword, startPersonSession } from "@/lib/auth";
import { verifyPersonLogin } from "@/lib/people";
import { createSessionToken, passwordFor, SESSION_COOKIE, SESSION_TTL_SECONDS } from "@/lib/session";
import { safeNextPath } from "@/lib/safe-next";

export type LoginState = { error: string | null };

const TOO_MANY = "Too many tries. Wait 15 minutes and try again.";

/** The shared passwords (the team's, the TV's and the owner's), as they always worked. */
export async function login(_prev: LoginState, form: FormData): Promise<LoginState> {
  const password = String(form.get("password") ?? "");
  const next = safeNextPath(String(form.get("next") ?? "/"));
  const ip = await clientAddress();
  if (await loginThrottled(ip)) return { error: TOO_MANY };
  if (!passwordFor("owner")) return { error: "The app has no password yet. Add OWNER_PASSWORD in Vercel (see SETUP.md)." };
  const role = roleForPassword(password);
  if (!role) {
    await recordLoginFailure(ip);
    return { error: "That password isn't right." };
  }
  await clearLoginFailures(ip);
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
  const ip = await clientAddress();
  if (await loginThrottled(ip)) return { error: TOO_MANY };
  let person: Awaited<ReturnType<typeof verifyPersonLogin>> = null;
  try {
    person = await verifyPersonLogin(phone, password);
  } catch {
    return { error: "Scorecard can't check that right now. Try again in a minute." };
  }
  if (!person) {
    await recordLoginFailure(ip);
    return { error: "That phone number and password don't match." };
  }
  await clearLoginFailures(ip);
  await startPersonSession(person.id, person.sessionVersion);
  redirect(next);
}

export async function logout(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
  redirect("/login");
}
