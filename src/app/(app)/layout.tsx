import type { ReactNode } from "react";
import { pageViewer } from "@/lib/auth";
import { countPendingApprovals } from "@/lib/approvals";
import { loadLook } from "@/lib/look-setting";
import { PHONE_VIEWPORT } from "@/lib/phone-viewport";
import { dbConfigured } from "@/lib/supabase";
import { isOwner } from "@/lib/viewer";
import { Sidebar, TabBar, TopBar } from "@/components/nav-bar";
import { Toaster } from "@/components/toaster";
import { Notice } from "@/components/ui";

/** Phones draw the app at 85% (see phone-viewport.ts); the TV board at /board keeps the root's 100%. */
export const viewport = PHONE_VIEWPORT;

/** The owner's waiting requests for the badge, best effort (the bar asks again on its own). */
async function waitingFor(owner: boolean): Promise<number> {
  if (!owner || !dbConfigured()) return 0;
  try {
    return await countPendingApprovals();
  } catch {
    return 0;
  }
}

/**
 * The app's frame (2026-11-12, the demo): on a computer (1024px and up) the sidebar and the content
 * beside it; on a phone the top bar, the content and the tab bar at the end. The content is
 * `.app-main`: full width up to 1600px with comfortable gutters (globals.css); pages lay out their
 * own columns (`.cols`, `.grid-2/3/4`) and a page that reads best narrow wraps itself in `.page-narrow`.
 */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const viewer = await pageViewer();
  const [look, approvals] = await Promise.all([loadLook(), waitingFor(isOwner(viewer))]);
  const shell = {
    level: viewer.level,
    name: viewer.name?.trim() || (viewer.level === "team" ? "Team" : "Owner"),
    agency: look.agencyName,
    approvals,
  };
  return (
    <div className="app-frame">
      <Sidebar {...shell} />
      <div className="app-body">
        <TopBar {...shell} />
        <main className="app-main">
          {!dbConfigured() && (
            <div className="mb-4">
              <Notice tone="amber">The database isn&apos;t connected yet. Add SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in Vercel (SETUP.md, step 5).</Notice>
            </div>
          )}
          {children}
        </main>
        <TabBar level={viewer.level} />
      </div>
      <Toaster />
    </div>
  );
}
