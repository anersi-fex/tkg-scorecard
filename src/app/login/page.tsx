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
      <div className="w-full max-w-[400px]">
        <div className="mb-6 flex justify-center">
          <ScoreLockup size={44} agency={look.agencyName} />
        </div>
        <div className="rounded-2xl border border-line bg-surface px-5 pt-6 pb-5 sm:px-7 sm:pt-7">
          <div className="text-center">
            <h1 className="text-[24px] leading-tight font-medium tracking-[-0.01em] text-fg">{toBoard ? "Sign in the TV" : "Sign in"}</h1>
            <p className="mt-1.5 text-[13.5px] leading-snug text-fg-2">
              {toBoard ? "Type the team password once; the board stays signed in." : "The team's month, live."}
            </p>
          </div>
          <div className="mt-6">
            <LoginForm next={next} start={start} />
          </div>
        </div>
        {!toBoard && <p className="mt-4 text-center text-[13px] leading-snug text-fg-2">New here? Open the join link you were sent.</p>}
        <p className="mt-2 text-center text-[12px] text-fg-3">Private to The Koka Group and {look.agencyName}.</p>
      </div>
    </main>
  );
}
