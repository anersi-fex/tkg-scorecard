import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ScoreLockup } from "@/components/brand";
import { currentRole } from "@/lib/auth";
import { safeNextPath } from "@/lib/safe-next";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const params = await searchParams;
  const next = safeNextPath(typeof params.next === "string" ? params.next : null);
  if (await currentRole()) redirect(next);
  const toBoard = next.startsWith("/board");
  return (
    <main className="flex flex-1 flex-col items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="rounded-[28px] bg-surface px-5 pt-7 pb-6 shadow-card sm:px-7">
          <div className="flex flex-col items-center text-center">
            <ScoreLockup size={52} />
            <h1 className="mt-7 text-[24px] leading-tight font-extrabold tracking-[-0.03em] text-gray-900">{toBoard ? "Sign in the TV" : "Sign in"}</h1>
            <p className="mt-1.5 text-[14px] leading-snug text-gray-600">
              {toBoard ? "Type the team password once; the board stays signed in." : "The team's month, live. Use the team password."}
            </p>
          </div>
          <div className="mt-6">
            <LoginForm next={next} />
          </div>
        </div>
        <p className="mt-4 text-center text-[12px] text-gray-500">Private to The Koka Group.</p>
      </div>
    </main>
  );
}
