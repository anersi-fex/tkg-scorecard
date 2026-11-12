import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ScoreLockup } from "@/components/brand";
import { currentViewer } from "@/lib/auth";
import { loadLook } from "@/lib/look-setting";
import { anyoneHasSignIn } from "@/lib/people";
import { safeNextPath } from "@/lib/safe-next";
import { PHONE_VIEWPORT } from "@/lib/phone-viewport";
import { dbConfigured } from "@/lib/supabase";
import { LoginForm, type LoginWay } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };
/** The sign-in screen draws at the app's 85% on a phone too. */
export const viewport = PHONE_VIEWPORT;

/** Which form the screen opens on: the team password for the TV and until someone has their own sign-in. */
async function startWay(toBoard: boolean, asked: string | null): Promise<LoginWay> {
  if (asked === "team" || asked === "person") return asked;
  if (toBoard || !dbConfigured()) return "team";
  try {
    return (await anyoneHasSignIn()) ? "person" : "team";
  } catch {
    return "team";
  }
}

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const params = await searchParams;
  const next = safeNextPath(typeof params.next === "string" ? params.next : null);
  // The proxy sends a shared password's session on; a person's is checked here (its row, its version).
  if (await currentViewer()) redirect(next);
  const toBoard = next.startsWith("/board");
  const [look, start] = await Promise.all([loadLook(), startWay(toBoard, typeof params.way === "string" ? params.way : null)]);
  return (
    <main className="flex flex-1 flex-col items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="rounded-[28px] bg-surface px-5 pt-7 pb-5 shadow-card sm:px-7">
          <div className="flex flex-col items-center text-center">
            <ScoreLockup size={52} agency={look.agencyName} />
            <h1 className="mt-7 text-[24px] leading-tight font-extrabold tracking-[-0.03em] text-gray-900">{toBoard ? "Sign in the TV" : "Sign in"}</h1>
            <p className="mt-1.5 text-[14px] leading-snug text-gray-600">
              {toBoard ? "Type the team password once; the board stays signed in." : "The team's month, live."}
            </p>
          </div>
          <div className="mt-6">
            <LoginForm next={next} start={start} />
          </div>
        </div>
        {!toBoard && <p className="mt-4 text-center text-[13px] leading-snug text-gray-600">New here? Open the join link you were sent.</p>}
        <p className="mt-2 text-center text-[12px] text-gray-500">Private to The Koka Group and {look.agencyName}.</p>
      </div>
    </main>
  );
}
