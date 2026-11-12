import type { ReactNode } from "react";
import * as auth from "@/lib/auth";
import { loadLook } from "@/lib/look-setting";
import { PHONE_VIEWPORT } from "@/lib/phone-viewport";
import { dbConfigured } from "@/lib/supabase";
import type { Viewer } from "@/lib/viewer";
import { NavBar, TabBar } from "@/components/nav-bar";
import { Toaster } from "@/components/toaster";
import { Notice } from "@/components/ui";

/** Phones draw the app at 85% (see phone-viewport.ts); the TV board at /board keeps the root's 100%. */
export const viewport = PHONE_VIEWPORT;

/**
 * The signed-in person, when the accounts work is in (`currentViewer` in auth.ts); null with the
 * shared passwords alone. Read through the module so this file compiles before and after.
 */
async function signedInPerson(): Promise<Pick<Viewer, "name" | "level"> | null> {
  const read = (auth as unknown as { currentViewer?: () => Promise<Viewer | null> }).currentViewer;
  if (typeof read !== "function") return null;
  try {
    const v = await read();
    return v ? { name: v.name, level: v.level } : null;
  } catch {
    return null;
  }
}

export default async function AppLayout({ children }: { children: ReactNode }) {
  const role = await auth.requirePage();
  const [look, person] = await Promise.all([loadLook(), signedInPerson()]);
  return (
    <>
      <NavBar role={role} agency={look.agencyName} name={person?.name} level={person?.level} />
      <div className="mx-auto w-full max-w-3xl flex-1 px-4 pt-2 pb-6">
        {!dbConfigured() && (
          <div className="mb-4">
            <Notice tone="amber">The database isn&apos;t connected yet. Add SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in Vercel (SETUP.md, step 5).</Notice>
          </div>
        )}
        {children}
      </div>
      <TabBar />
      <Toaster />
    </>
  );
}
