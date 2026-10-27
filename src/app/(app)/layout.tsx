import type { ReactNode } from "react";
import { requirePage } from "@/lib/auth";
import { dbConfigured } from "@/lib/supabase";
import { NavBar, TabBar } from "@/components/nav-bar";
import { Toaster } from "@/components/toaster";
import { Notice } from "@/components/ui";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const role = await requirePage();
  return (
    <>
      <NavBar role={role} />
      <div className="mx-auto w-full max-w-3xl flex-1 px-4 pt-2 pb-8">
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
