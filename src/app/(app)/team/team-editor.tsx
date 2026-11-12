"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, useSyncExternalStore, useTransition, type ReactNode } from "react";
import type { Level } from "@/lib/viewer";
import type { AgentRole } from "@/lib/types";
import type { RoleChoice } from "@/lib/rules";
import { firstName } from "@/components/avatar";
import { PcTag } from "@/components/kind";
import { Switch } from "@/components/switch";
import { cn, formatDate } from "@/components/ui";
import { Icon } from "@/components/ui/icon";
import { CountBadge, EmptyState, Field, Initials, PageHead, Panel, RoleTag, SearchInput, SelectBox, TextInput, MoneyInput, btn } from "@/components/ui/kit";
import { Segmented } from "@/components/ui/segmented";
import { formatDollars } from "@/lib/money";
import { renamePerson, savePersonGoal, savePersonPcGoal, setPersonActive, setPersonPc } from "../actions";
import { confirmUpline, createPersonInvite, declineUpline, getJoinLink, resetJoinLink, resetPersonSignIn, setPersonInOffice, setPersonRole, setPersonUpline } from "../people-actions";
import { addPersonToTeam } from "./actions";
import { toast } from "@/components/toaster";
import s from "./team.module.css";

/** One person as the People page shows them. The phone, the sign-in mark and the join day are filled only for an admin. */
export interface PersonRow {
  id: string;
  name: string;
  active: boolean;
  tone: string;
  inOffice: boolean;
  role: AgentRole;
  /** Their upline as stored (confirmed), and where they sit in the list (their nearest upline on the board). */
  uplineId: string | null;
  parentId: string | null;
  /** "Mikal's team" for the person they sit under. */
  parentTeam: string | null;
  /** This month so far. */
  cents: number;
  policies: number;
  goalCents: number;
  /** Has people under them: the team is the leader and everyone below. */
  leader: boolean;
  teamSize: number;
  teamCents: number;
  teamPolicies: number;
  /** Only while the owner's P&C board is on. */
  pcLicensed: boolean;
  pcCents: number;
  pcGoalCents: number;
  phone: string;
  hasLogin: boolean;
  joinedThisWeek: boolean;
  joinedAt: string | null;
  /** What the viewer may do with this person (src/lib/rules.ts, asked on the server). */
  canEdit: boolean;
  canAccess: boolean;
  roles: RoleChoice[];
  /** A request about their level that waits for the owner. */
  pendingRole: string | null;
}

/** Someone who signed up on the agency link and picked an upline that waits to be confirmed. */
export interface JoinerRow {
  id: string;
  name: string;
  inOffice: boolean;
  uplineName: string;
  uplineFirst: string;
  pickedMe: boolean;
  signedUp: string | null;
  /** Admins only. */
  phone: string;
}

export interface TeamSummary {
  leaderId: string;
  name: string;
  people: number;
  sold: number;
  policies: number;
  cents: number;
}

type Filter = "all" | "office";

const noSubscribe = () => () => {};
const policiesLabel = (n: number) => `${n} ${n === 1 ? "policy" : "policies"}`;
const peopleLabel = (n: number) => `${n} ${n === 1 ? "person" : "people"}`;
const digits = (v: string) => v.replace(/\D/g, "");

async function attempt<T>(work: () => Promise<T>): Promise<T | null> {
  try {
    return await work();
  } catch {
    toast("Couldn't reach the server. Try again.", false);
    return null;
  }
}

/**
 * People: the directory (search, All or In the office, people by team), and by level the joiners
 * waiting for a yes, the join links, who joined this week, adding a person, the people off the
 * board and each person's card. Every button calls an action that checks the level again on the
 * server.
 */
export function TeamEditor({
  head,
  people,
  joiners,
  teams,
  level,
  owner,
  viewerId,
  month,
  base,
  pcEnabled = false,
  agency,
  joinUrl,
  joinError,
  numbers = true,
}: {
  /** False for the shared team password: names and teams, no numbers. */
  numbers?: boolean;
  head: { people: number; sold: number; notJoined: number; cents: string; policies: number };
  people: PersonRow[];
  joiners: JoinerRow[];
  teams: TeamSummary[];
  level: Level;
  owner: boolean;
  viewerId: string | null;
  month: string;
  base: string;
  /** The owner's P&C board is on; off (the default), nothing here names P&C. */
  pcEnabled?: boolean;
  agency: string;
  /** An admin's agency link, or a manager's own team link. */
  joinUrl: string | null;
  joinError: string | null;
}) {
  const admin = level === "owner" || level === "admin";
  const manager = level === "manager";
  const active = useMemo(() => people.filter((p) => p.active), [people]);
  const gone = people.filter((p) => !p.active);
  const byId = useMemo(() => new Map(people.map((p) => [p.id, p])), [people]);
  const kids = useMemo(() => {
    const map = new Map<string | null, PersonRow[]>();
    for (const p of active) {
      const key = p.parentId && byId.get(p.parentId)?.active ? p.parentId : null;
      const list = map.get(key);
      if (list) list.push(p);
      else map.set(key, [p]);
    }
    // Leaders first, then by name (the demo's order).
    for (const list of map.values()) list.sort((a, b) => Number(b.leader) - Number(a.leader) || a.name.localeCompare(b.name));
    return map;
  }, [active, byId]);
  /** Everyone below a person, all levels. */
  const below = useMemo(() => {
    const out = new Map<string, Set<string>>();
    const walk = (id: string, seen: Set<string>): Set<string> => {
      const hit = out.get(id);
      if (hit) return hit;
      const set = new Set<string>();
      out.set(id, set);
      for (const c of kids.get(id) ?? []) {
        if (seen.has(c.id)) continue;
        set.add(c.id);
        for (const d of walk(c.id, new Set(seen).add(c.id))) set.add(d);
      }
      return set;
    };
    for (const p of active) walk(p.id, new Set([p.id]));
    return out;
  }, [active, kids]);

  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  // Every team starts open (the demo); a tap folds one.
  const [closed, setClosed] = useState<Set<string>>(() => new Set());
  const [editing, setEditing] = useState<string | null>(null);
  const editingPerson = editing ? byId.get(editing) : undefined;

  const q = query.trim().toLowerCase();
  const qDigits = admin ? digits(query) : "";
  const inFilter = (p: PersonRow) => filter === "all" || p.inOffice;
  // In the office: a leader stays in the list while someone on their team is in the office.
  const shows = (p: PersonRow): boolean => inFilter(p) || [...(below.get(p.id) ?? [])].some((id) => byId.get(id)?.inOffice);
  const matches = q ? active.filter((p) => inFilter(p) && (p.name.toLowerCase().includes(q) || (qDigits.length >= 3 && digits(p.phone).includes(qDigits)))).sort((a, b) => a.name.localeCompare(b.name)) : [];
  const toggle = (id: string) =>
    setClosed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // A manager's own team first, then everyone else (the demo); everyone else sees one list.
  const mine = manager && viewerId && byId.get(viewerId)?.active ? viewerId : null;
  const myTeam = mine ? new Set([mine, ...(below.get(mine) ?? [])]) : null;

  const row = (p: PersonRow, depth: number, opts: { flat?: boolean; skip?: Set<string> | null } = {}): ReactNode => {
    const children = !opts.flat ? (kids.get(p.id) ?? []).filter((c) => shows(c) && !opts.skip?.has(c.id)) : [];
    const team = !opts.flat && p.leader && children.length > 0;
    const open = team && !closed.has(p.id);
    const sub = opts.flat
      ? p.parentTeam
        ? `On ${p.parentTeam}`
        : p.leader
          ? `Team of ${p.teamSize}`
          : "No upline yet"
      : p.leader
        ? numbers
          ? `Team of ${p.teamSize} · ${formatDollars(p.teamCents)}`
          : `Team of ${p.teamSize}`
        : p.parentTeam
          ? `On ${p.parentTeam}`
          : "No upline yet";
    return (
      <li key={p.id} data-person={p.id}>
        <div className={cn(s.row, admin && s.withCell, p.id === viewerId && s.me)}>
          <div className={s.nameCell} style={{ paddingLeft: 12 + depth * 22 }}>
            {team ? (
              <button type="button" onClick={() => toggle(p.id)} aria-expanded={open} aria-label={`${p.name}'s team, ${p.teamSize} people`} className={cn(s.toggle, !open && s.closed)}>
                <Icon name="chevron-down" size={16} />
              </button>
            ) : (
              <span className={s.spacer} />
            )}
            <span className={s.who}>
              <span className={s.name}>
                <span className={cn(!inFilter(p) && s.dimName)}>{p.name}</span>
                {p.id === viewerId && <span className="you">You</span>}
                {filter === "all" && p.inOffice && (
                  <span className={s.office} title="Works in the office">
                    <Icon name="building" size={13} />
                  </span>
                )}
                {pcEnabled && p.pcLicensed && <PcTag className="shrink-0" />}
                {admin && p.hasLogin && (
                  <span className={s.signed} role="img" aria-label="Has their own sign-in" title="Has their own sign-in">
                    <Icon name="check-circle" size={14} />
                  </span>
                )}
              </span>
              <span className={s.whoSub}>{sub}</span>
            </span>
          </div>
          <div className={s.roleCell}>
            <RoleTag level={p.role} />
            {admin && !p.hasLogin && <span className="pill pill-dim sm">Not joined yet</span>}
          </div>
          <div className={cn(s.num, s.numCol)}>{numbers ? p.policies || "—" : ""}</div>
          <div className={s.money}>{numbers ? (p.cents ? formatDollars(p.cents) : "—") : ""}</div>
          {admin ? <div className={s.cell}>{p.phone || "—"}</div> : <div className={s.cell} />}
          <div className={s.act}>
            {p.canEdit ? (
              <button type="button" onClick={() => setEditing(p.id)} aria-label={`Edit ${p.name}`} className={s.iconBtn}>
                <Icon name="pencil" size={17} />
              </button>
            ) : null}
          </div>
        </div>
        {open && <ul className={cn(s.list, s.sub)}>{children.map((c) => row(c, depth + 1, opts))}</ul>}
      </li>
    );
  };

  const tableHead = (
    <div className={cn(s.head, admin && s.withCell)} aria-hidden>
      <span>Name</span>
      <span>Role</span>
      <span className={cn(s.num, s.numCol)}>{numbers ? "Policies" : ""}</span>
      <span className={s.num}>{numbers ? "This month" : ""}</span>
      <span>{admin ? "Cell" : ""}</span>
      <span />
    </div>
  );
  const totalsOf = (ids: PersonRow[]) => {
    const cents = ids.reduce((n, p) => n + p.cents, 0);
    const pol = ids.reduce((n, p) => n + p.policies, 0);
    const sold = ids.filter((p) => p.policies > 0).length;
    return `${formatDollars(cents)} · ${policiesLabel(pol)} · ${sold} sold this month`;
  };
  const directory = (title: string, members: PersonRow[], roots: PersonRow[], skip: Set<string> | null, key: string) => (
    <Panel key={key} flush title={`${title} · ${peopleLabel(members.length)}`} sub={numbers ? totalsOf(members) : undefined} data-directory={key}>
      {roots.length === 0 ? (
        <p className={s.empty}>{filter === "office" ? "Nobody here is marked in the office yet." : "Nobody yet."}</p>
      ) : (
        <>
          {tableHead}
          <ul className={s.list}>{roots.map((p) => row(p, 0, { skip }))}</ul>
        </>
      )}
    </Panel>
  );

  let main: ReactNode;
  if (q) {
    main = (
      <Panel flush title={`Found · ${peopleLabel(matches.length)}`} data-directory="found">
        {matches.length === 0 ? (
          <p className={s.empty}>Nobody by that {admin && qDigits.length >= 3 ? "name or number" : "name"}{filter === "office" ? " in the office" : ""}.</p>
        ) : (
          <>
            {tableHead}
            <ul className={s.list}>{matches.map((p) => row(p, 0, { flat: true }))}</ul>
          </>
        )}
      </Panel>
    );
  } else if (active.length === 0) {
    main = (
      <Panel>
        <EmptyState icon="people" title="Nobody yet." body={admin ? "Send the join link, or add your people by hand." : undefined} />
      </Panel>
    );
  } else if (myTeam && mine) {
    const meRow = byId.get(mine)!;
    const teamMembers = active.filter((p) => myTeam.has(p.id));
    const others = active.filter((p) => !myTeam.has(p.id));
    const otherRoots = (kids.get(null) ?? []).filter((p) => !myTeam.has(p.id) && shows(p));
    main = (
      <>
        {directory("Your team", teamMembers, shows(meRow) ? [meRow] : [], null, "mine")}
        {others.length > 0 && directory("Everyone else", others, otherRoots, myTeam, "others")}
      </>
    );
  } else {
    main = directory("Everyone", active, (kids.get(null) ?? []).filter(shows), null, "all");
  }

  const searchLabel = admin ? "Find a person or a cell number" : "Find a person";
  return (
    <div className={s.wrap}>
      <PageHead
        title="People"
        sub={`${peopleLabel(head.people)}${numbers ? ` · ${head.sold} sold this month` : ""}${admin && head.notJoined ? ` · ${head.notJoined} not joined yet` : ""}`}
        right={
          <div className={s.tools}>
            <div className={s.search}>
              <SearchInput value={query} onChange={(e) => setQuery(e.target.value)} placeholder={searchLabel} aria-label="Find a person" />
            </div>
            <Segmented<Filter>
              label="Who to show"
              value={filter}
              onChange={setFilter}
              items={[
                { key: "all", label: "All" },
                { key: "office", label: "In the office" },
              ]}
            />
          </div>
        }
      />
      <div className={s.grid}>
        <div className={s.main}>{main}</div>
        <div className={s.side}>
          {(admin || manager) && joiners.length > 0 && <Joiners joiners={joiners} admin={admin} />}
          {admin && <JoinCard url={joinUrl} error={joinError} agency={agency} people={active} />}
          {manager && <TeamLinkCard url={joinUrl} error={joinError} agency={agency} />}
          {admin && <NewThisWeek people={active} onOpen={setEditing} />}
          {admin && <AddPerson people={active} />}
          {admin && gone.length > 0 && <OffBoard gone={gone} owner={owner} />}
          {!admin && <TeamsCard teams={teams} numbers={numbers} />}
        </div>
      </div>

      {editingPerson && editingPerson.active && editingPerson.canEdit && (
        <Drawer label={`Edit ${editingPerson.name}`} title={editingPerson.name} tag={<RoleTag level={editingPerson.role} />} sub={[editingPerson.parentTeam ? `On ${editingPerson.parentTeam}` : editingPerson.leader ? `Leads a team of ${editingPerson.teamSize}` : "No upline yet", editingPerson.phone].filter(Boolean).join(" · ")} onClose={() => setEditing(null)}>
          <PersonEditor
            key={editingPerson.id}
            person={editingPerson}
            upline={editingPerson.uplineId ? (byId.get(editingPerson.uplineId) ?? null) : null}
            choices={active.filter((p) => p.id !== editingPerson.id && !below.get(editingPerson.id)?.has(p.id))}
            owner={owner}
            month={month}
            base={base}
            pcEnabled={pcEnabled}
            onClose={() => setEditing(null)}
          />
        </Drawer>
      )}
    </div>
  );
}

/** A panel from the right (the whole screen on a phone); a tap on the scrim or Escape closes it. */
function Drawer({ label, title, tag, sub, onClose, children }: { label: string; title: string; tag?: ReactNode; sub?: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    // Over the header and the tab bar (z-30), under the toasts (z-40): "Saved." shows over the card.
    <div className="ov-wrap" style={{ zIndex: 35 }}>
      <div className="ov-scrim" onClick={onClose} aria-hidden />
      <div className="drawer" role="dialog" aria-modal="true" aria-label={label} style={{ ["--drawer-w" as string]: "560px" }}>
        <div className="drawer-head">
          <div className="drawer-titles">
            <div className="drawer-title flex flex-wrap items-center gap-2">
              {title}
              {tag}
            </div>
            {sub && <div className="drawer-sub">{sub}</div>}
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className={btn("ghost", "sm", "btn-icon")}>
            <Icon name="close" size={18} />
          </button>
        </div>
        <div className="drawer-body">{children}</div>
      </div>
    </div>
  );
}

/** "Wants to join": people who picked an upline on the agency link; Confirm, or Not on that team. */
function Joiners({ joiners, admin }: { joiners: JoinerRow[]; admin: boolean }) {
  const [pending, start] = useTransition();
  const [done, setDone] = useState<Set<string>>(() => new Set());
  const list = joiners.filter((j) => !done.has(j.id));
  if (list.length === 0) return null;
  const answer = (j: JoinerRow, yes: boolean) =>
    start(async () => {
      const r = await attempt(() => (yes ? confirmUpline(j.id) : declineUpline(j.id)));
      if (!r) return;
      toast(r.ok ? (r.message ?? "Saved.") : r.error, r.ok);
      if (r.ok) setDone((prev) => new Set(prev).add(j.id));
    });
  return (
    <Panel
      className={s.joinFirst}
      data-joiners
      title={
        <span className="inline-flex items-center gap-2">
          {admin ? "Wants to join" : "Wants to join your team"}
          <CountBadge n={list.length} />
        </span>
      }
      sub={admin ? "People who signed up and picked an upline" : "They picked you or someone on your team as their upline"}
    >
      <div>
        {list.map((j) => (
          <div key={j.id} className={s.joiner} data-joiner={j.id}>
            <div className={s.joinerName}>
              {j.name}
              {j.inOffice && (
                <span className={s.office}>
                  <Icon name="building" size={13} />
                  Office
                </span>
              )}
            </div>
            <div className={s.joinerLine}>{j.pickedMe && !admin ? "Picked you as their upline" : `Picked ${j.uplineName} as their upline`}</div>
            <div className={s.joinerLine}>{[j.signedUp ? `Signed up ${j.signedUp}` : null, j.phone || null].filter(Boolean).join(" · ")}</div>
            <div className={s.joinerBtns}>
              <button type="button" className={btn("secondary", "sm")} disabled={pending} onClick={() => answer(j, true)}>
                <Icon name="check" size={16} />
                <span>Confirm</span>
              </button>
              <button type="button" className={btn("ghost", "sm")} disabled={pending} onClick={() => answer(j, false)}>
                <span>{j.pickedMe && !admin ? "Not on my team" : `Not on ${j.uplineFirst}'s team`}</span>
              </button>
            </div>
          </div>
        ))}
      </div>
      <p className={s.lockNote}>
        <Icon name="lock" size={14} />
        <span>{admin ? "Until someone confirms them, their upline doesn't see their clients." : "Until you confirm, you don't see their clients."}</span>
      </p>
    </Panel>
  );
}

/** A link with Copy and, where the phone has it, Share. */
function LinkBox({ url, shareText, label }: { url: string; shareText: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const canShare = useSyncExternalStore(
    noSubscribe,
    () => typeof navigator !== "undefined" && typeof navigator.share === "function",
    () => false,
  );
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      window.prompt("Copy this link", url);
    }
  };
  return (
    <div data-link-box>
      <div className={s.linkRow}>
        <code aria-label={label} className={s.linkText}>
          {url}
        </code>
        <button type="button" className={btn("secondary", "sm")} onClick={copy}>
          <Icon name="copy" size={15} />
          <span>{copied ? "Copied" : "Copy"}</span>
        </button>
      </div>
      {canShare && (
        <button
          type="button"
          className={btn("ghost", "sm", "mt-2")}
          onClick={() => {
            // The person closing the share sheet is not an error.
            navigator.share({ title: "Scorecard", text: shareText, url }).catch(() => {});
          }}
        >
          <Icon name="send" size={15} />
          <span>Share</span>
        </button>
      )}
    </div>
  );
}

/** A manager's link: people who sign up with it land on their team, confirmed. */
function TeamLinkCard({ url, error, agency }: { url: string | null; error: string | null; agency: string }) {
  return (
    <Panel title="Join link for your team" data-team-link-card>
      <p className="small muted mb-3">People who sign up with it land on your team. You confirm the ones who pick you on the agency link here.</p>
      {url ? <LinkBox url={url} label="The join link for your team" shareText={`Join Scorecard for ${agency} on my team. Tap the link and set up your own sign-in.`} /> : <p className="small muted">{error ?? "The link isn't ready yet."}</p>}
    </Panel>
  );
}

/** The join links (admins): the agency link, a link for one team, and a new link when the old should stop working. */
function JoinCard({ url, error, agency, people }: { url: string | null; error: string | null; agency: string; people: PersonRow[] }) {
  const [pending, start] = useTransition();
  const [fresh, setFresh] = useState<string | null>(null);
  const [leader, setLeader] = useState("");
  const [teamLink, setTeamLink] = useState<{ id: string; url: string } | null>(null);
  const link = fresh ?? url;
  const leaders = people.filter((p) => p.leader).sort((a, b) => a.name.localeCompare(b.name));
  const others = people.filter((p) => !p.leader).sort((a, b) => a.name.localeCompare(b.name));
  const leaderName = people.find((p) => p.id === leader)?.name ?? "";
  const pickLeader = (id: string) => {
    setLeader(id);
    setTeamLink(null);
    if (!id) return;
    start(async () => {
      const r = await attempt(() => getJoinLink(id));
      if (!r) return;
      if (r.ok) setTeamLink({ id, url: r.url });
      else toast(r.error, false);
    });
  };
  return (
    <Panel title="Join links" data-join-card>
      <div className={s.sectionTitle}>Agency join link</div>
      <p className={cn(s.sectionSub, "mb-3")}>Send this to everyone. They sign up themselves and pick their upline.</p>
      {link ? <LinkBox url={link} label="The join link" shareText={`Join Scorecard for ${agency}. Tap the link and set up your own sign-in.`} /> : <p className="small muted">{error ?? "The join link isn't ready yet."}</p>}
      <div className={s.section}>
        <div className={s.sectionTitle}>A link for one team</div>
        <p className={cn(s.sectionSub, "mb-3")}>People who use it land on that leader&apos;s team.</p>
        <SelectBox id="join-leader" aria-label="Pick the leader" value={leader} disabled={pending} onChange={(e) => pickLeader(e.target.value)}>
          <option value="">Pick the leader</option>
          {leaders.length > 0 && (
            <optgroup label="Team leaders">
              {leaders.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </optgroup>
          )}
          {others.length > 0 && (
            <optgroup label="Everyone else">
              {others.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </optgroup>
          )}
        </SelectBox>
        {teamLink && teamLink.id === leader && (
          <div className="mt-3" data-team-link>
            <LinkBox url={teamLink.url} label={`The join link for ${leaderName}'s team`} shareText={`Join Scorecard for ${agency} on ${leaderName}'s team. Tap the link and set up your own sign-in.`} />
          </div>
        )}
      </div>
      <div className={s.section}>
        <p className={cn(s.sectionSub, "mb-3")}>A new link turns off every join link that&apos;s out now.</p>
        <button
          type="button"
          className={btn("secondary", "sm")}
          disabled={pending}
          onClick={() => {
            if (!window.confirm("Make a new join link? The old one stops working, and so does each team's link.")) return;
            start(async () => {
              const r = await attempt(() => resetJoinLink());
              if (!r) return;
              if (r.ok) {
                setFresh(r.url);
                setTeamLink(null);
                setLeader("");
                toast("New link made. The old one is off.");
              } else toast(r.error, false);
            });
          }}
        >
          <Icon name="refresh" size={15} />
          <span>Make a new link</span>
        </button>
      </div>
    </Panel>
  );
}

/** Who joined in the last 7 days (the newest five, the rest behind a tap). */
function NewThisWeek({ people, onOpen }: { people: PersonRow[]; onOpen: (id: string) => void }) {
  const [all, setAll] = useState(false);
  const fresh = people.filter((p) => p.joinedThisWeek).sort((a, b) => (b.joinedAt ?? "").localeCompare(a.joinedAt ?? ""));
  const signedIn = people.filter((p) => p.hasLogin).length;
  return (
    <Panel title="New this week" sub={`${signedIn} of ${people.length} have their own sign-in`} data-new-this-week>
      {fresh.length === 0 ? (
        <p className="small muted">Nobody has joined in the last 7 days.</p>
      ) : (
        <div className="list">
          {(all ? fresh : fresh.slice(0, 5)).map((p) => (
            <div key={p.id} className="list-row">
              <span className="lr-lead">
                <Initials name={p.name} small />
              </span>
              <span className="lr-main">
                <span className="lr-title">{p.name}</span>
                <span className="lr-sub">
                  Joined {formatDate(p.joinedAt, { year: false })}
                  {p.parentTeam ? ` · on ${p.parentTeam}` : " · no upline yet"}
                </span>
              </span>
              {p.canEdit && (
                <button type="button" className="link" onClick={() => onOpen(p.id)}>
                  Open
                </button>
              )}
            </div>
          ))}
        </div>
      )}
      {fresh.length > 5 && (
        <button type="button" data-new-all aria-expanded={all} onClick={() => setAll((v) => !v)} className={cn("link", "mt-3")}>
          {all ? "Show the newest 5" : `Show all ${fresh.length}`}
        </button>
      )}
    </Panel>
  );
}

/** Teams (everyone but an admin): each leader with everyone under them, opening on the Scoreboard. */
function TeamsCard({ teams, numbers }: { teams: TeamSummary[]; numbers: boolean }) {
  return (
    <Panel title="Teams" sub="Each leader with everyone under them" data-teams>
      {teams.length === 0 ? (
        <p className="small muted">Teams show here once people have an upline.</p>
      ) : (
        <div className="list">
          {teams.map((t) => (
            <Link key={t.leaderId} href={`/scoreboard?scope=team&team=${t.leaderId}`} className="list-row is-action">
              <span className="lr-main">
                <span className="lr-title">{t.name}</span>
                <span className="lr-sub">{!numbers ? peopleLabel(t.people) : t.sold ? `${peopleLabel(t.people)} · ${t.sold} sold · ${policiesLabel(t.policies)}` : `${peopleLabel(t.people)} · no sale yet`}</span>
              </span>
              {numbers && (
                <span className="lr-right">
                  <span className="lr-amt">{t.cents ? formatDollars(t.cents) : "—"}</span>
                </span>
              )}
              <span className="lr-chev" aria-hidden>
                <Icon name="chevron-right" size={16} />
              </span>
            </Link>
          ))}
        </div>
      )}
    </Panel>
  );
}

/** Whose team: a search box over everyone on the board, with "No upline" on top. */
function UplinePicker({ value, choices, onPick, disabled, id }: { value: PersonRow | null; choices: PersonRow[]; onPick: (id: string | null) => void; disabled?: boolean; id: string }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const list = choices.filter((p) => !q || p.name.toLowerCase().includes(q)).sort((a, b) => Number(b.leader) - Number(a.leader) || a.name.localeCompare(b.name));
  const pick = (next: string | null) => {
    setOpen(false);
    setQuery("");
    if (next !== (value?.id ?? null)) onPick(next);
  };
  return (
    <div data-upline-picker>
      <button type="button" id={id} disabled={disabled} aria-expanded={open} onClick={() => setOpen((v) => !v)} className={s.pickerBtn}>
        <span className="truncate">
          {value ? value.name : "No upline"}
          {value?.leader && <span className="muted"> · {firstName(value.name)}&apos;s team</span>}
        </span>
        <span className="accent-text small">{open ? "Close" : "Change"}</span>
      </button>
      {open && (
        <div className="mt-2">
          <TextInput type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Type a name" aria-label="Find the upline" autoComplete="off" autoFocus />
          <ul role="listbox" aria-label="Upline" className={s.pickerList}>
            {!q && (
              <li>
                <button type="button" role="option" aria-selected={!value} onClick={() => pick(null)} className={cn(s.pickerItem, !value && s.on)}>
                  No upline
                </button>
              </li>
            )}
            {list.map((p) => (
              <li key={p.id}>
                <button type="button" role="option" aria-selected={value?.id === p.id} onClick={() => pick(p.id)} className={cn(s.pickerItem, value?.id === p.id && s.on)}>
                  <Initials name={p.name} small />
                  <span className="min-w-0 flex-1 truncate">{p.name}</span>
                  {p.leader && <span className="tiny muted">team of {p.teamSize}</span>}
                </button>
              </li>
            ))}
            {list.length === 0 && <li className="small muted px-2 py-3">Nobody by that name.</li>}
          </ul>
        </div>
      )}
    </div>
  );
}

/** Adding a person by hand: a name, whose team, and the office mark. (Most people join with the link.) */
function AddPerson({ people }: { people: PersonRow[] }) {
  const [pending, start] = useTransition();
  const [name, setName] = useState("");
  const [upline, setUpline] = useState<string | null>(null);
  // Off to start: the first person added with it on would be the whole office group, alone at the top of every board.
  const [inOffice, setInOffice] = useState(false);
  return (
    <Panel title="Add a person" sub="For someone who hasn't joined with the link. They can make their sign-in later." data-add-person>
      <form
        method="post"
        onSubmit={(e) => {
          e.preventDefault();
          const form = new FormData();
          form.set("name", name);
          form.set("upline_id", upline ?? "");
          form.set("in_office", inOffice ? "1" : "0");
          start(async () => {
            const r = await attempt(() => addPersonToTeam(form));
            if (!r) return;
            toast(r.ok ? (r.message ?? "Added.") : r.error, r.ok);
            if (r.ok) setName("");
          });
        }}
        className="stack"
      >
        <Field label="Name" htmlFor="new-name" required>
          <TextInput id="new-name" name="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="First and last name" maxLength={60} autoComplete="off" required />
        </Field>
        <Field label="Their upline (whose team they're on)" htmlFor="new-upline">
          <UplinePicker id="new-upline" value={people.find((p) => p.id === upline) ?? null} choices={people} onPick={setUpline} disabled={pending} />
        </Field>
        <div className={s.switchRow}>
          <div className="min-w-0">
            <p className="strong small">In the office</p>
            <p className="tiny muted">The office group is at the top of every board.</p>
          </div>
          <Switch checked={inOffice} disabled={pending} label="The new person works in the office" onChange={setInOffice} />
        </div>
        <button type="submit" className={btn("primary", undefined, "btn-full")} disabled={pending || !name.trim()}>
          <Icon name="user-plus" size={17} />
          <span>{pending ? "Adding..." : "Add to the board"}</span>
        </button>
      </form>
    </Panel>
  );
}

/** The people taken off the board, to put back (an admin's return is the owner's call). */
function OffBoard({ gone, owner }: { gone: PersonRow[]; owner: boolean }) {
  return (
    <Panel title="Off the board" sub="Their sales stay in every month's history.">
      <ul className={s.list}>
        {gone.map((p) => (
          <li key={p.id} className={s.offRow}>
            <Initials name={p.name} small />
            <span className="min-w-0 flex-1 truncate">{p.name}</span>
            {/* Back on the board brings an old sign-in back with it: for someone who was an admin that is the owner's call. */}
            {owner || p.canAccess ? (
              <BackButton id={p.id} />
            ) : (
              <span className="tiny muted" data-owner-only>
                Anersi puts an admin back
              </span>
            )}
          </li>
        ))}
      </ul>
    </Panel>
  );
}

const ROLE_NOTE: Record<"member" | "manager" | "admin", string> = {
  member: "Logs their own sales and sees their own clients.",
  manager: "Leads a team: logs for them, sees their clients and confirms who joins.",
  admin: "Runs people, goals, settings and any sale.",
};

/** One person's card, for the owner and the admins. Each part saves on its own. */
function PersonEditor({
  person,
  upline,
  choices,
  owner,
  month,
  base,
  pcEnabled,
  onClose,
}: {
  person: PersonRow;
  upline: PersonRow | null;
  choices: PersonRow[];
  owner: boolean;
  month: string;
  base: string;
  pcEnabled: boolean;
  onClose: () => void;
}) {
  const [pending, start] = useTransition();
  const [inOffice, setInOffice] = useState(person.inOffice);
  const [seenOffice, setSeenOffice] = useState(person.inOffice);
  if (seenOffice !== person.inOffice) {
    setSeenOffice(person.inOffice);
    setInOffice(person.inOffice);
  }
  const [signIn, setSignIn] = useState<string | null>(null);
  // Making someone an admin turns off the sign-in link made for them as an agent (the server does it): the dead link leaves the screen.
  const [linkOff, setLinkOff] = useState(false);
  // What the server said about a level change (an admin's request waits for the owner): kept on the card.
  const [roleNote, setRoleNote] = useState<string | null>(person.pendingRole);
  const first = firstName(person.name);
  const deskLink = `${base}/log?agent=${person.id}`;
  const current = person.role === "owner" || person.role === "admin" ? "admin" : person.role === "manager" ? "manager" : "member";
  const run = (work: () => Promise<{ ok: true; message?: string } | { ok: false; error: string }>, after?: () => void) =>
    start(async () => {
      const r = await attempt(work);
      if (!r) return;
      toast(r.ok ? (r.message ?? "Saved.") : r.error, r.ok);
      if (r.ok) after?.();
    });
  const goalText = person.goalCents ? String(person.goalCents / 100) : "";
  return (
    <div className={s.drawerBody} data-person-editor={person.id}>
      <section className={s.block}>
        <div className={s.statGrid}>
          <div className={s.stat}>
            <div className={s.statLabel}>This month</div>
            <div className={s.statValue}>{formatDollars(person.cents)}</div>
          </div>
          <div className={s.stat}>
            <div className={s.statLabel}>Policies</div>
            <div className={s.statValue}>{person.policies}</div>
          </div>
          <div className={s.stat}>
            <div className={s.statLabel}>Goal</div>
            <div className={s.statValue}>{person.goalCents ? formatDollars(person.goalCents) : "—"}</div>
          </div>
        </div>
        <p className={s.note}>
          {person.hasLogin ? "Has their own sign-in." : "No sign-in of their own yet."}
          {person.joinedAt ? ` Joined ${formatDate(person.joinedAt)}.` : ""} The cell number shows only to admins, and to {first} on their profile.
        </p>
      </section>

      <section className={s.block}>
        <h3 className={s.blockTitle}>Details</h3>
        <div className="stack">
          {person.canAccess && (
            <form
              method="post"
              onSubmit={(e) => {
                e.preventDefault();
                const form = new FormData(e.currentTarget);
                run(() => renamePerson(person.id, form));
              }}
              className={s.formRow}
            >
              <Field label="Name" htmlFor={`name-${person.id}`} required>
                <TextInput id={`name-${person.id}`} name="name" defaultValue={person.name} maxLength={60} required />
              </Field>
              <button type="submit" className={btn("secondary")} disabled={pending}>
                Save
              </button>
            </form>
          )}
          <form
            method="post"
            onSubmit={(e) => {
              e.preventDefault();
              const form = new FormData(e.currentTarget);
              run(() => savePersonGoal(month, person.id, form));
            }}
            className={s.formRow}
          >
            <Field label={pcEnabled ? "Life goal this month" : "Goal this month"} htmlFor={`goal-${person.id}`} help="Annual premium; blank for none.">
              <MoneyInput id={`goal-${person.id}`} name="goal" defaultValue={goalText} placeholder="No goal" />
            </Field>
            <button type="submit" className={cn(btn("secondary"), "mb-[22px]")} disabled={pending}>
              Save
            </button>
          </form>
          {pcEnabled && owner && <PcRow person={person} />}
          {pcEnabled && owner && person.pcLicensed && (
            <form
              method="post"
              onSubmit={(e) => {
                e.preventDefault();
                const form = new FormData(e.currentTarget);
                run(() => savePersonPcGoal(month, person.id, form));
              }}
              className={s.formRow}
            >
              <Field label="P&C goal this month" htmlFor={`pc-goal-${person.id}`}>
                <MoneyInput id={`pc-goal-${person.id}`} name="pc_goal" defaultValue={person.pcGoalCents ? String(person.pcGoalCents / 100) : ""} placeholder="No goal" />
              </Field>
              <button type="submit" className={btn("secondary")} disabled={pending}>
                Save
              </button>
            </form>
          )}
        </div>
      </section>

      <section className={s.block}>
        <h3 className={s.blockTitle}>Role and team</h3>
        <div className="stack">
          <div data-admin-row>
            <p className="field-label mb-2 block">Role</p>
            {person.roles.length > 0 ? (
              <Segmented<"member" | "manager" | "admin">
                label="Role"
                value={current}
                items={person.roles.map((r) => ({ key: r.role, label: r.label, disabled: pending }))}
                onChange={(next) => {
                  const choice = person.roles.find((r) => r.role === next);
                  if (!choice) return;
                  if (owner && next === "admin" && !window.confirm(`Make ${person.name} an admin? They can change goals, people, any sale and the board.`)) return;
                  if (owner && current === "admin" && !window.confirm(`Take away ${person.name}'s admin role?`)) return;
                  start(async () => {
                    const r = await attempt(() => setPersonRole(person.id, next));
                    if (!r) return;
                    // The owner's "make admin" turned off a link that is on screen: it goes, and the words say why.
                    const killedLink = r.ok && owner && next === "admin" && signIn !== null;
                    if (killedLink) {
                      setSignIn(null);
                      setLinkOff(true);
                    }
                    toast(r.ok ? `${r.message ?? "Saved."}${killedLink ? " That turned off the sign-in link you made. Make a new one." : ""}` : r.error, r.ok);
                    if (r.ok && choice.asksOwner) setRoleNote(r.message ?? "Sent to Anersi for a quick OK.");
                  });
                }}
              />
            ) : (
              <p className="small muted">{person.role === "owner" ? "The owner. Nobody changes this." : "You can't change your own role."}</p>
            )}
            <p className={roleNote ? s.noteAccent : s.note} data-role-note={roleNote ? "" : undefined}>
              {roleNote ?? `${ROLE_NOTE[current]}${owner ? "" : " Making or removing an admin asks Anersi first."}`}
            </p>
          </div>
          <Field label="Upline" htmlFor={`upline-${person.id}`} help={`Whose team ${first} is on.`}>
            <UplinePicker id={`upline-${person.id}`} value={upline} choices={choices} disabled={pending} onPick={(next) => run(() => setPersonUpline(person.id, next))} />
          </Field>
          <div className={s.switchRow}>
            <div className="min-w-0">
              <p className="strong small">In the office</p>
              <p className="tiny muted">The office group is at the top of every board.</p>
            </div>
            <Switch
              checked={inOffice}
              disabled={pending}
              label={`${person.name} works in the office`}
              onChange={(next) => {
                setInOffice(next);
                start(async () => {
                  const r = await attempt(() => setPersonInOffice(person.id, next));
                  if (!r) {
                    setInOffice(!next);
                    return;
                  }
                  toast(r.ok ? (r.message ?? "Saved.") : r.error, r.ok);
                  if (!r.ok) setInOffice(!next);
                });
              }}
            />
          </div>
        </div>
      </section>

      {person.canAccess && (
        <section className={s.block} data-sign-in>
          <h3 className={s.blockTitle}>{person.hasLogin ? "Reset sign-in" : "Send a sign-in link"}</h3>
          <p className="small muted">
            {person.hasLogin ? `For a forgotten password: ${first} opens the link and picks a new one.` : `${first} opens the link, types their cell number and picks a password.`} The link works once, for 7 days.
          </p>
          {linkOff && !signIn && (
            <p className={s.noteAccent} data-link-off>
              Making {first} an admin turned off the link you made. Make a new one and send that.
            </p>
          )}
          {signIn ? (
            <div className="mt-3">
              <LinkBox url={signIn} label={`The one-time link for ${person.name}`} shareText={person.hasLogin ? `${first}, here is your link to set a new Scorecard password. It works once.` : `${first}, here is your link to set up your Scorecard sign-in. It works once.`} />
              <p className={s.note}>Send it to {first} only. It is shown once: making another turns this one off.</p>
            </div>
          ) : (
            <button
              type="button"
              className={btn("secondary", undefined, "btn-full mt-3")}
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const r = await attempt(() => (person.hasLogin ? resetPersonSignIn(person.id) : createPersonInvite(person.id)));
                  if (!r) return;
                  if (r.ok) {
                    setSignIn(r.url);
                    setLinkOff(false);
                  } else toast(r.error, false);
                })
              }
            >
              <Icon name="link" size={16} />
              <span>{pending ? "One moment..." : person.hasLogin ? "Make a reset link" : "Make their sign-in link"}</span>
            </button>
          )}
        </section>
      )}

      <section className={s.block}>
        <h3 className={s.blockTitle}>Desk link</h3>
        <p className="small muted">For an NFC tag at a shared desk: opens Log a sale with {first} picked.</p>
        <div className={cn(s.linkRow, "mt-2")}>
          <code className={s.linkText}>{deskLink}</code>
          <CopyButton text={deskLink} />
        </div>
        {pcEnabled && person.pcLicensed && (
          <>
            <p className={s.note}>Their P&amp;C desk link: the same, already switched to P&amp;C.</p>
            <div className={cn(s.linkRow, "mt-2")}>
              <code className={s.linkText}>{`${deskLink}&kind=pc`}</code>
              <CopyButton text={`${deskLink}&kind=pc`} />
            </div>
          </>
        )}
      </section>

      <section className={cn(s.block, "flex items-center justify-between gap-2")}>
        {person.canAccess ? (
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              if (!window.confirm(`Take ${person.name} off the board? Their sales stay in the history${person.hasLogin ? ", and their sign-in stops working until they are back" : ""}.`)) return;
              run(() => setPersonActive(person.id, false), onClose);
            }}
            className={cn(btn("ghost"), s.danger)}
          >
            <Icon name="trash" size={16} />
            <span>Take off the board</span>
          </button>
        ) : (
          <span className="tiny muted" data-owner-only>
            Only Anersi changes an admin&apos;s sign-in or takes an admin off the board.
          </span>
        )}
        <button type="button" onClick={onClose} className={btn("secondary")}>
          Done
        </button>
      </section>
    </div>
  );
}

/** P&C licensed, saved on the tap: Log a sale then offers Life or P&C for this person. */
function PcRow({ person }: { person: PersonRow }) {
  const [pending, start] = useTransition();
  const [on, setOn] = useState(person.pcLicensed);
  return (
    <div className={s.switchRow}>
      <div className="min-w-0">
        <p className="strong small">P&amp;C licensed</p>
        <p className="tiny muted">Log a sale offers Life or P&amp;C for them.</p>
      </div>
      <Switch
        checked={on}
        disabled={pending}
        label={`${person.name} is P&C licensed`}
        onChange={(next) => {
          setOn(next);
          start(async () => {
            const r = await attempt(() => setPersonPc(person.id, next));
            if (!r) return setOn(!next);
            toast(r.ok ? (r.message ?? "Saved.") : r.error, r.ok);
            if (!r.ok) setOn(!next);
          });
        }}
      />
    </div>
  );
}

function BackButton({ id }: { id: string }) {
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      className={btn("secondary", "sm")}
      disabled={pending}
      onClick={() =>
        start(async () => {
          const r = await attempt(() => setPersonActive(id, true));
          if (r) toast(r.ok ? (r.message ?? "Done.") : r.error, r.ok);
        })
      }
    >
      {pending ? "..." : "Put back"}
    </button>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className={btn("secondary", "sm")}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          window.prompt("Copy this link", text);
        }
      }}
    >
      <Icon name="copy" size={15} />
      <span>{copied ? "Copied" : "Copy"}</span>
    </button>
  );
}
