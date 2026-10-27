import { NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/session";

/** Sign out: clear the cookie and go to the sign-in screen (a plain form post, so it works without JavaScript). */
export async function POST(request: Request) {
  const res = NextResponse.redirect(new URL("/login", request.url), { status: 303 });
  res.cookies.set(SESSION_COOKIE, "", { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 0 });
  return res;
}
