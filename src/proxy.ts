// Next 16 proxy (the middleware successor): an optimistic session gate. Real checks also run in
// every page (requirePage) and every server action and route (requireRole / the log token).
import { NextResponse, type NextRequest } from "next/server";
import { verifySessionToken, SESSION_COOKIE } from "@/lib/session";

export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  let role: string | null = null;
  try {
    role = await verifySessionToken(request.cookies.get(SESSION_COOKIE)?.value);
  } catch {
    role = null; // a missing secret locks the app; it never shows a 500
  }
  if (pathname === "/login") return role ? NextResponse.redirect(new URL("/", request.url)) : NextResponse.next();
  if (!role) {
    const login = new URL("/login", request.url);
    // Back to the screen that was asked for after signing in (the TV's /board, a desk tag's /log?agent=...).
    if (pathname !== "/") login.searchParams.set("next", pathname + search);
    return NextResponse.redirect(login);
  }
  return NextResponse.next();
}

export const config = {
  // Everything except API routes (they check their own auth), Next internals, and the public
  // files a phone fetches without a session (icons, opening screens, manifest).
  matcher: ["/((?!api/|_next/static|_next/image|splash/|manifest.webmanifest|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|ico)$).*)"],
};
