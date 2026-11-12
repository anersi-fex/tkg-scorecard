import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { ScoreLockup } from "@/components/brand";
import { clientAddress, JOIN_MAX_PER_IP, joinKey, loginThrottled, recordLoginFailure } from "@/lib/auth";
import { listAgents } from "@/lib/data";
import { readInvite, type Invite } from "@/lib/invites";
import { loadLook } from "@/lib/look-setting";
import { getPerson } from "@/lib/people";
import { PHONE_VIEWPORT } from "@/lib/phone-viewport";
import { dbConfigured } from "@/lib/supabase";
import { JoinForm, type JoinFormProps } from "./join-form";

// The link is the key: no search engine keeps it and no other site is told it.
export const metadata: Metadata = { title: "Join", robots: { index: false, follow: false }, referrer: "no-referrer" };
/** Drawn at the app's 85% on a phone, like the sign-in screen. */
export const viewport = PHONE_VIEWPORT;

function Shell({ agency, children }: { agency: string; children: ReactNode }) {
  return (
    <main className="flex flex-1 flex-col items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="rounded-[28px] bg-surface px-5 pt-7 pb-6 shadow-card sm:px-7">
          <div className="flex flex-col items-center text-center">
            <ScoreLockup size={52} agency={agency} />
          </div>
          {children}
        </div>
        <p className="mt-4 text-center text-[12px] text-gray-500">Private to The Koka Group and {agency}.</p>
      </div>
    </main>
  );
}

/** One calm card for a link that cannot be used (or an address that tried too often). */
function Closed({ agency, title, line }: { agency: string; title: string; line: string }) {
  return (
    <Shell agency={agency}>
      <div className="mt-7 text-center" data-join="closed">
        <h1 className="text-[22px] leading-tight font-extrabold tracking-[-0.03em] text-gray-900">{title}</h1>
        <p className="mt-2 text-[14px] leading-snug text-gray-600">{line}</p>
        <p className="mt-5 text-[14px] text-gray-600">
          Already joined?{" "}
          <Link href="/login" className="font-bold text-accent-text">
            Sign in
          </Link>
        </p>
      </div>
    </Shell>
  );
}

const firstOf = (name: string) => name.trim().split(/\s+/)[0] || name;

/**
 * A join link (owner, 2026-11-12: "send everyone something, and it automatically makes them sign
 * up for the first time"). Public: the person has no sign-in yet. The agency's link asks who
 * they are; a personal link greets the person it was made for; a reset link asks only for a new
 * password. A link that is unknown, used, expired or turned off says one thing and nothing more.
 */
export default async function JoinPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const look = await loadLook();
  const agency = look.agencyName;
  const bad = <Closed agency={agency} title="This link isn't good anymore." line="Ask for a new one." />;
  if (!dbConfigured()) return bad;

  const key = joinKey(await clientAddress());
  if (await loginThrottled(key, JOIN_MAX_PER_IP)) return <Closed agency={agency} title="Too many tries." line="Wait 15 minutes and try again." />;

  let invite: Invite | null;
  try {
    invite = await readInvite(token);
  } catch {
    return <Closed agency={agency} title="Scorecard isn't answering." line="Try this link again in a minute." />;
  }
  if (!invite) {
    await recordLoginFailure(key);
    return bad;
  }

  let props: Omit<JoinFormProps, "token">;
  try {
    if (invite.kind === "agency") {
      // Names only (never a number): the list a new person picks their upline from.
      const people = (await listAgents()).map((a) => ({ id: a.id, name: a.name }));
      const leader = invite.upline_id && people.some((p) => p.id === invite.upline_id) ? invite.upline_id : null;
      props = { kind: "agency", people, leaderId: leader, needsPhone: true, inOffice: false };
    } else {
      const person = invite.agent_id ? await getPerson(invite.agent_id) : null;
      if (!person || !person.active) return bad;
      // A reset keeps the number they have; only someone with no number is asked for one.
      props = { kind: invite.kind, firstName: firstOf(person.name), people: [], leaderId: null, needsPhone: invite.kind === "person" || !person.phone, inOffice: person.in_office === true };
    }
  } catch {
    return <Closed agency={agency} title="Scorecard isn't answering." line="Try this link again in a minute." />;
  }

  const title = props.kind === "agency" ? `Join ${agency} on Scorecard` : props.kind === "person" ? `Hi ${props.firstName}, set up your sign-in` : "Set a new password";
  const line =
    props.kind === "agency"
      ? "It takes a minute. Your cell number and a password are how you sign in from now on."
      : props.kind === "person"
        ? "Your cell number and a password are how you sign in from now on."
        : `${props.firstName}, pick a new password. It signs your other phones and computers out.`;
  return (
    <Shell agency={agency}>
      <div className="mt-7 text-center">
        <h1 className="text-[22px] leading-tight font-extrabold tracking-[-0.03em] text-balance text-gray-900">{title}</h1>
        <p className="mt-1.5 text-[14px] leading-snug text-gray-600">{line}</p>
      </div>
      <div className="mt-6">
        <JoinForm token={token} {...props} />
      </div>
    </Shell>
  );
}
