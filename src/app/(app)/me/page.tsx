import type { Metadata } from "next";
import Link from "next/link";
import { pageViewer } from "@/lib/auth";
import { getPerson } from "@/lib/people";
import { formatPhone } from "@/lib/phone";
import { dbConfigured } from "@/lib/supabase";
import { Card, PageTitle } from "@/components/ui";
import { ListCard, RowChevron } from "@/components/tide";
import { ProfileForms } from "./profile-forms";

export const metadata: Metadata = { title: "Your profile" };

/** The row every kind of sign-in gets: the phone guide. */
function InstallRow() {
  return (
    <ListCard>
      <li>
        <Link href="/install" className="flex min-h-14 items-center gap-3 px-4 py-3">
          <span className="min-w-0 flex-1">
            <span className="block text-[16px] font-semibold text-gray-900">Put Scorecard on your phone</span>
            <span className="block text-[13px] text-gray-500">A few taps, with pictures.</span>
          </span>
          <RowChevron />
        </Link>
      </li>
    </ListCard>
  );
}

/**
 * "Your profile": a person's own name, cell number, office mark and password. Only ever the
 * signed-in person's own row (the page and its actions name nobody). The shared passwords name
 * no person, so they get one line and the way to a sign-in of their own.
 */
export default async function MePage() {
  const viewer = await pageViewer();
  const me = viewer.agentId && dbConfigured() ? await getPerson(viewer.agentId) : null;
  if (!me) {
    return (
      <>
        <PageTitle>Your profile</PageTitle>
        <div className="space-y-4">
          <Card>
            <p className="text-[15px] leading-snug text-gray-900" data-me="shared">
              {viewer.via === "owner-password" ? "You're on the owner password. Add yourself on the Team page to get a profile." : "You're on the team password. Ask for a join link to get your own sign-in."}
            </p>
          </Card>
          <InstallRow />
        </div>
      </>
    );
  }
  const upline = me.upline_id ? await getPerson(me.upline_id) : null;
  return (
    <>
      <PageTitle sub={viewer.via === "owner-password" ? "You're signed in with the owner password." : undefined}>Your profile</PageTitle>
      <div className="space-y-4">
        <ProfileForms
          name={me.name}
          // A person's own number, on their own screen.
          phone={formatPhone(me.phone)}
          inOffice={me.in_office === true}
          upline={upline?.name ?? null}
          hasLogin={me.has_login}
          ownSession={viewer.via === "person"}
        />
        <InstallRow />
      </div>
    </>
  );
}
