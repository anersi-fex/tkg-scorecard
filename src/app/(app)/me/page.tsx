import type { Metadata } from "next";
import { pageViewer } from "@/lib/auth";
import { getPerson } from "@/lib/people";
import { formatPhone } from "@/lib/phone";
import { dbConfigured } from "@/lib/supabase";
import { ListRow, PageHead, Panel, RoleTag } from "@/components/ui/kit";
import { Icon } from "@/components/ui/icon";
import { ProfileForms } from "./profile-forms";

export const metadata: Metadata = { title: "Your profile" };

/** The row every kind of sign-in gets: the phone guide. */
function InstallRow() {
  return (
    <Panel>
      <div className="list">
        <ListRow href="/install" lead={<Icon name="phone" size={20} />} title="Put Scorecard on your phone" sub="A few taps, with pictures." chevron />
      </div>
    </Panel>
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
      <div className="page page-narrow">
        <PageHead title="Your profile" />
        <Panel>
          <p data-me="shared">{viewer.via === "owner-password" ? "You're on the owner password. Add yourself on the People page to get a profile." : "You're on the team password. Ask for a join link to get your own sign-in."}</p>
        </Panel>
        <InstallRow />
      </div>
    );
  }
  const upline = me.upline_id ? await getPerson(me.upline_id) : null;
  return (
    <div className="page">
      <PageHead
        title={
          <>
            Your profile
            <RoleTag level={viewer.level} />
          </>
        }
        sub={viewer.via === "owner-password" ? "You're signed in with the owner password." : "Only you and the admins see your number."}
      />
      <div className="stack">
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
    </div>
  );
}
