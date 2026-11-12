// Next 16 proxy (the middleware successor): an optimistic session gate. Real checks also run in
// every page (pageViewer) and every server action and route (requireViewer / the log token).
import { NextResponse, type NextRequest } from "next/server";
import { readSessionToken, SESSION_COOKIE, type SessionClaim } from "@/lib/session";
import { safeNextPath } from "@/lib/safe-next";

export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  // A join link is opened by someone with no sign-in yet (and works for someone who has one).
  if (pathname.startsWith("/join/")) return NextResponse.next();
  let claim: SessionClaim | null = null;
  try {
    // Either kind passes here: a shared password's token, or a person's own. A person's token is
    // only checked for its signature and its expiry (no database here); the page checks the row.
    claim = await readSessionToken(request.cookies.get(SESSION_COOKIE)?.value);
  } catch {
    claim = null; // a missing secret locks the app; it never shows a 500
  }
  // Already signed in with a shared password: straight to the screen the link asked for (the TV's
  // /board), else home. A person's token may have been ended since (signed out everywhere, a new
  // password), which only the sign-in page can tell: it sends a good one on itself, so an ended
  // one never bounces between here and a page.
  if (pathname === "/login") return claim?.kind === "shared" ? NextResponse.redirect(new URL(safeNextPath(request.nextUrl.searchParams.get("next")), request.url)) : NextResponse.next();
  if (!claim) {
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
