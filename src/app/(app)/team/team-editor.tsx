"use client";

import { useEffect, useMemo, useState, useSyncExternalStore, useTransition, type ReactNode } from "react";
import type { Level } from "@/lib/viewer";
import type { AgentRole } from "@/lib/types";
import { Avatar, firstName } from "@/components/avatar";
import { PcTag } from "@/components/kind";
import { Switch } from "@/components/switch";
import { ListCard, ListTitle } from "@/components/tide";
import { Button, Input, Label, Select, cn, formatDate } from "@/components/ui";
import { formatDollars } from "@/lib/money";
import { renamePerson, savePersonGoal, savePersonPcGoal, setPersonActive, setPersonPc } from "../actions";
import { createPersonInvite, getJoinLink, resetJoinLink, resetPersonSignIn, setPersonInOffice, setPersonRole, setPersonUpline } from "../people-actions";
import { addPersonToTeam } from "./actions";
import { toast } from "@/components/toaster";

/** One person as the People page shows them. The phone, the sign-in mark and the join day are filled only for a manager. */
export interface PersonRow {
  id: string;
  name: string;
  active: boolean;
  tone: string;
  inOffice: boolean;
  role: AgentRole;
  /** Their upline as stored, and where they sit in the list (their nearest upline on the board). */
  uplineId: string | null;
  parentId: string | null;
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
}

type Filter = "everyone" | "office";

const noSubscribe = () => () => {};
const policiesLabel = (n: number) => `${n} ${n === 1 ? "policy" : "policies"}`;

/**
 * People: the directory (search, In the office or Everyone, people grouped by team), and for the
 * owner and the admins the join link, who joined this week, adding a person and each person's
 * controls. Every button calls an action that checks the level again on the server.
 */
export function TeamEditor({
  people,
  level,
  owner,
  viewerId,
  month,
  base,
  pcEnabled = false,
  agency,
  joinUrl,
  joinError,
}: {
  people: PersonRow[];
  level: Level;
  owner: boolean;
  viewerId: string | null;
  month: string;
  base: string;
  /** The owner's P&C board is on; off (the default), nothing here names P&C. */
  pcEnabled?: boolean;
  agency: string;
  joinUrl: string | null;
  joinError: string | null;
}) {
  const manager = level === "owner" || level === "admin";
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
    for (const list of map.values()) list.sort((a, b) => a.name.localeCompare(b.name));
    return map;
  }, [active, byId]);
  /** Everyone below a person, all levels (an upline picker never offers them: that would make a loop). */
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
  const [filter, setFilter] = useState<Filter>("everyone");
  // The top of the tree starts open, and so does the way down to the person looking.
  const [openTeams, setOpenTeams] = useState<Set<string>>(() => {
    const open = new Set<string>((kids.get(null) ?? []).filter((p) => p.leader).map((p) => p.id));
    for (let at = viewerId ? byId.get(viewerId) : undefined, n = 0; at && n < 50; at = at.parentId ? byId.get(at.parentId) : undefined, n++) if (at.leader) open.add(at.id);
    return open;
  });
  const [editing, setEditing] = useState<string | null>(null);
  const editingPerson = editing ? byId.get(editing) : undefined;

  const officeCount = active.filter((p) => p.inOffice).length;
  const signedIn = active.filter((p) => p.hasLogin).length;
  const q = query.trim().toLowerCase();
  const inFilter = (p: PersonRow) => filter === "everyone" || p.inOffice;
  // In the office: a leader stays in the list while someone on their team is in the office.
  const shows = (p: PersonRow): boolean => inFilter(p) || [...(below.get(p.id) ?? [])].some((id) => byId.get(id)?.inOffice);
  const matches = q ? active.filter((p) => p.name.toLowerCase().includes(q) && inFilter(p)).sort((a, b) => a.name.localeCompare(b.name)) : [];
  const roots = (kids.get(null) ?? []).filter(shows);
  const teams = roots.filter((p) => p.leader);
  const solo = roots.filter((p) => !p.leader);
  const newPeople = active.filter((p) => p.joinedThisWeek).sort((a, b) => (b.joinedAt ?? "").localeCompare(a.joinedAt ?? ""));
  const toggle = (id: string) =>
    setOpenTeams((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const row = (p: PersonRow, depth: number, opts: { flat?: boolean } = {}): ReactNode => {
    const open = !opts.flat && p.leader && openTeams.has(p.id);
    const children = open ? (kids.get(p.id) ?? []).filter(shows) : [];
    const parent = p.parentId ? byId.get(p.parentId) : undefined;
    const body = (
      <>
        <Avatar name={p.name} tone={p.tone} size={36} />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className={cn("truncate text-[15px] font-bold", inFilter(p) ? "text-gray-900" : "text-gray-500")}>{p.name}</span>
            {p.role !== "member" && <span className="shrink-0 rounded-full bg-chip px-1.5 py-px text-[10.5px] font-bold text-chip-text">{p.role === "owner" ? "Owner" : "Admin"}</span>}
            {filter === "everyone" && p.inOffice && <span className="shrink-0 rounded-full bg-tint px-1.5 py-px text-[10.5px] font-bold text-accent-text">Office</span>}
            {pcEnabled && p.pcLicensed && <PcTag className="shrink-0" />}
            {manager && p.hasLogin && (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" role="img" aria-label="Has their own sign-in" className="shrink-0 text-up">
                <title>Has their own sign-in</title>
                <circle cx="12" cy="12" r="9.5" />
                <path d="M7.5 12.5l3 3 6-6.5" />
              </svg>
            )}
          </span>
          <span className="block truncate text-[12.5px] font-medium text-gray-500">
            {opts.flat
              ? parent
                ? `On ${firstName(parent.name)}'s team`
                : p.leader
                  ? `Team of ${p.teamSize}`
                  : "No upline yet"
              : p.leader
                ? `Team of ${p.teamSize} · ${formatDollars(p.teamCents)} · ${policiesLabel(p.teamPolicies)}`
                : `${policiesLabel(p.policies)}${p.goalCents > 0 ? ` · goal ${formatDollars(p.goalCents)}` : ""}`}
          </span>
        </span>
        <span className="shrink-0 text-right">
          <span className="block font-mono text-[14.5px] font-bold text-gray-900">{formatDollars(p.cents)}</span>
          {(p.leader || opts.flat) && <span className="block text-[11.5px] font-medium text-gray-500">{p.leader && !opts.flat ? "their own" : policiesLabel(p.policies)}</span>}
        </span>
      </>
    );
    return (
      <li key={p.id} data-person={p.id} className="relative not-first:before:pointer-events-none not-first:before:absolute not-first:before:top-0 not-first:before:right-0 not-first:before:left-4 not-first:before:h-px not-first:before:bg-line">
        <div className="flex items-center gap-1 pr-2" style={{ paddingLeft: 16 + depth * 16 }}>
          {p.leader && !opts.flat ? (
            <button type="button" onClick={() => toggle(p.id)} aria-expanded={open} aria-label={`${p.name}'s team, ${p.teamSize} people`} className="flex min-h-[56px] min-w-0 flex-1 items-center gap-2.5 py-2 text-left">
              {body}
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden className={cn("shrink-0 text-gray-400 transition-transform", open && "rotate-90")}>
                <path d="M9 6l6 6-6 6" />
              </svg>
            </button>
          ) : (
            <div className={cn("flex min-h-[56px] min-w-0 flex-1 items-center gap-2.5 py-2", !manager && "pr-2")}>{body}</div>
          )}
          {manager ? (
            <button type="button" onClick={() => setEditing(p.id)} aria-label={`Edit ${p.name}`} className="flex h-11 w-9 shrink-0 items-center justify-center rounded-full text-accent-text hover:bg-tint">
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M4 20h4L19 9l-4-4L4 16v4zM13.5 6.5l4 4" />
              </svg>
            </button>
          ) : (
            p.leader && !opts.flat && <span className="w-2" />
          )}
        </div>
        {children.length > 0 && <ul className="border-t border-line bg-surface-2/60">{children.map((c) => row(c, depth + 1))}</ul>}
      </li>
    );
  };

  return (
    <div className="space-y-5">
      {manager && <JoinCard url={joinUrl} error={joinError} agency={agency} people={active} />}

      {manager && (
        <section data-new-this-week>
          <ListTitle count={newPeople.length}>New this week</ListTitle>
          {newPeople.length === 0 ? (
            <p className="mt-1 px-1 text-[13px] font-medium text-gray-500">Nobody has joined in the last 7 days. {signedIn} of {active.length} have their own sign-in.</p>
          ) : (
            <>
              <ListCard className="mt-2">
                {newPeople.map((p) => (
                  <li key={p.id} className="relative flex items-center gap-2.5 px-4 py-2 not-first:before:absolute not-first:before:top-0 not-first:before:right-0 not-first:before:left-4 not-first:before:h-px not-first:before:bg-line">
                    <Avatar name={p.name} tone={p.tone} size={32} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[14.5px] font-bold text-gray-900">{p.name}</span>
                      <span className="block truncate text-[12.5px] font-medium text-gray-500">
                        Joined {formatDate(p.joinedAt)}
                        {p.parentId && byId.get(p.parentId) ? ` · on ${firstName(byId.get(p.parentId)!.name)}'s team` : " · no upline yet"}
                      </span>
                    </span>
                    <button type="button" onClick={() => setEditing(p.id)} className="min-h-11 shrink-0 rounded-full px-3 text-[13.5px] font-bold text-accent-text hover:bg-tint">
                      Open
                    </button>
                  </li>
                ))}
              </ListCard>
              <p className="mt-1.5 px-1 text-[12.5px] font-medium text-gray-500">{signedIn} of {active.length} have their own sign-in.</p>
            </>
          )}
        </section>
      )}

      <section>
        <div className="flex items-end justify-between gap-3">
          <ListTitle count={active.length}>Everyone</ListTitle>
          <p className="pb-0.5 text-[12.5px] font-medium text-gray-500">{officeCount} in the office</p>
        </div>
        <div className="mt-2 flex items-center gap-2">
          <div className="relative min-w-0 flex-1">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-gray-400">
              <circle cx="11" cy="11" r="7" />
              <path d="M20 20l-3.5-3.5" />
            </svg>
            <Input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find a person" aria-label="Find a person" autoComplete="off" className="rounded-full pl-9" />
          </div>
          <div role="radiogroup" aria-label="Who to show" className="grid shrink-0 grid-cols-2 gap-1 rounded-full bg-track p-1">
            {(
              [
                ["office", "In the office"],
                ["everyone", "Everyone"],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                role="radio"
                aria-checked={filter === key}
                onClick={() => setFilter(key)}
                className={cn("min-h-9 rounded-full px-2.5 text-[12.5px] font-bold whitespace-nowrap transition", filter === key ? "bg-segment text-gray-900 shadow-card" : "text-gray-600")}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {q ? (
          <ListCard className="mt-2 overflow-hidden">
            {matches.length === 0 && <li className="px-4 py-5 text-[14px] text-gray-600">Nobody by that name{filter === "office" ? " in the office" : ""}.</li>}
            {matches.map((p) => row(p, 0, { flat: true }))}
          </ListCard>
        ) : active.length === 0 ? (
          <ListCard className="mt-2">
            <li className="px-4 py-5 text-[14px] text-gray-600">Nobody yet.{manager ? " Send the join link, or add your people below." : ""}</li>
          </ListCard>
        ) : (
          <>
            {teams.length > 0 && <ListCard className="mt-2 overflow-hidden">{teams.map((p) => row(p, 0))}</ListCard>}
            {solo.length > 0 && (
              <>
                {teams.length > 0 && <p className="mt-4 px-1 text-[13px] font-bold tracking-[0.06em] text-gray-500 uppercase">Not on a team yet</p>}
                <ListCard className="mt-2 overflow-hidden">{solo.map((p) => row(p, 0))}</ListCard>
              </>
            )}
            {roots.length === 0 && (
              <ListCard className="mt-2">
                <li className="px-4 py-5 text-[14px] text-gray-600">Nobody is marked in the office yet.</li>
              </ListCard>
            )}
          </>
        )}
      </section>

      {manager && <AddPerson people={active} />}

      {manager && gone.length > 0 && (
        <section>
          <ListTitle count={gone.length}>Off the board</ListTitle>
          <ListCard className="mt-2">
            {gone.map((p) => (
              <li key={p.id} className="relative flex items-center gap-3 px-4 py-2.5 not-first:before:absolute not-first:before:top-0 not-first:before:right-0 not-first:before:left-4 not-first:before:h-px not-first:before:bg-line">
                <Avatar name={p.name} tone={p.tone} size={36} />
                <p className="min-w-0 flex-1 truncate text-[15px] font-bold text-gray-700">{p.name}</p>
                <BackButton id={p.id} />
              </li>
            ))}
          </ListCard>
          <p className="mt-2 px-1 text-[12px] text-gray-500">Their sales stay in every month&apos;s history.</p>
        </section>
      )}

      {manager && editingPerson && editingPerson.active && (
        <Sheet label={`Edit ${editingPerson.name}`} onClose={() => setEditing(null)}>
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
        </Sheet>
      )}
    </div>
  );
}

/** A sheet from the bottom of a phone (centered on a computer); a tap outside or Escape closes it. */
function Sheet({ label, onClose, children }: { label: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div
      // Over the header and the tab bar (z-30), under the toasts (z-40): "Saved." and "Sent to Anersi" show over the sheet.
      className="fixed inset-0 z-[35] flex items-end justify-center bg-ink/70 p-3 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label={label}
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="max-h-[calc(100dvh-24px)] w-full max-w-md overflow-y-auto overscroll-contain rounded-[26px] bg-surface p-4 shadow-float">{children}</div>
    </div>
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
      <code aria-label={label} className="block truncate rounded-xl bg-surface-2 px-3 py-2.5 font-mono text-[12.5px] text-gray-700">
        {url}
      </code>
      <div className="mt-2 flex gap-2">
        <Button type="button" className="h-11 flex-1 rounded-xl" onClick={copy}>
          {copied ? "Copied" : "Copy"}
        </Button>
        {canShare && (
          <Button
            type="button"
            variant="secondary"
            className="h-11 flex-1 rounded-xl"
            onClick={() => {
              // The person closing the share sheet is not an error.
              navigator.share({ title: "Scorecard", text: shareText, url }).catch(() => {});
            }}
          >
            Share
          </Button>
        )}
      </div>
    </div>
  );
}

/** The join link: one link for everyone, a new one when the old should stop working, and a link for one team. */
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
      try {
        const r = await getJoinLink(id);
        if (r.ok) setTeamLink({ id, url: r.url });
        else toast(r.error, false);
      } catch {
        toast("Couldn't reach the server. Try again.", false);
      }
    });
  };
  return (
    <section data-join-card className="rounded-[22px] bg-surface p-4 shadow-card">
      <h2 className="text-[17px] font-extrabold tracking-[-0.02em] text-gray-900">Join link</h2>
      <p className="mt-0.5 text-[13.5px] font-medium text-gray-600">Send this to everyone. They sign up themselves.</p>
      <div className="mt-3">
        {link ? (
          <LinkBox url={link} label="The join link" shareText={`Join Scorecard for ${agency}. Tap the link and set up your own sign-in.`} />
        ) : (
          <p className="rounded-xl bg-surface-2 px-3 py-2.5 text-[13.5px] text-gray-700">{error ?? "The join link isn't ready yet."}</p>
        )}
      </div>
      <details className="group mt-3 border-t border-line pt-1">
        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between text-[14px] font-bold text-gray-900 [&::-webkit-details-marker]:hidden">
          Link for one team, or a new link
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="text-gray-400 transition-transform group-open:rotate-90">
            <path d="M9 6l6 6-6 6" />
          </svg>
        </summary>
        <div className="space-y-3 pb-1">
          <div>
            <Label htmlFor="join-leader">Link for one team: people who use it land on that leader&apos;s team.</Label>
            <Select id="join-leader" value={leader} disabled={pending} onChange={(e) => pickLeader(e.target.value)}>
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
            </Select>
            {teamLink && teamLink.id === leader && (
              <div className="mt-2" data-team-link>
                <LinkBox url={teamLink.url} label={`The join link for ${leaderName}'s team`} shareText={`Join Scorecard for ${agency} on ${leaderName}'s team. Tap the link and set up your own sign-in.`} />
              </div>
            )}
          </div>
          <div className="flex items-center justify-between gap-3">
            <p className="min-w-0 text-[12.5px] font-medium text-gray-500">A new link turns off every join link that is out now.</p>
            <Button
              type="button"
              variant="secondary"
              className="h-10 shrink-0 rounded-xl px-3 text-[13px]"
              disabled={pending}
              onClick={() => {
                if (!window.confirm("Make a new join link? The old one stops working, and so does each team's link.")) return;
                start(async () => {
                  try {
                    const r = await resetJoinLink();
                    if (r.ok) {
                      setFresh(r.url);
                      setTeamLink(null);
                      setLeader("");
                      toast("New link made. The old one is off.");
                    } else toast(r.error, false);
                  } catch {
                    toast("Couldn't reach the server. Try again.", false);
                  }
                });
              }}
            >
              Make a new link
            </Button>
          </div>
        </div>
      </details>
    </section>
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
      <button
        type="button"
        id={id}
        disabled={disabled}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex min-h-11 w-full items-center justify-between gap-2 rounded-xl border border-line bg-surface px-3 text-left text-[15px] font-semibold text-gray-900 disabled:opacity-60"
      >
        <span className="truncate">{value ? value.name : "No upline"}</span>
        <span className="shrink-0 text-[13px] font-bold text-accent-text">{open ? "Close" : "Change"}</span>
      </button>
      {open && (
        <div className="mt-2 rounded-xl border border-line bg-surface p-2">
          <Input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Type a name" aria-label="Find the upline" autoComplete="off" autoFocus />
          <ul role="listbox" aria-label="Upline" className="mt-2 max-h-56 overflow-y-auto overscroll-contain">
            {!q && (
              <li>
                <button type="button" role="option" aria-selected={!value} onClick={() => pick(null)} className={cn("flex min-h-11 w-full items-center rounded-lg px-2 text-left text-[14.5px] font-bold hover:bg-gray-50", !value ? "text-accent-text" : "text-gray-700")}>
                  No upline
                </button>
              </li>
            )}
            {list.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={value?.id === p.id}
                  onClick={() => pick(p.id)}
                  className={cn("flex min-h-11 w-full items-center gap-2 rounded-lg px-2 text-left text-[14.5px] font-semibold hover:bg-gray-50", value?.id === p.id ? "text-accent-text" : "text-gray-900")}
                >
                  <Avatar name={p.name} tone={p.tone} size={26} />
                  <span className="min-w-0 flex-1 truncate">{p.name}</span>
                  {p.leader && <span className="shrink-0 text-[12px] font-medium text-gray-500">team of {p.teamSize}</span>}
                </button>
              </li>
            ))}
            {list.length === 0 && <li className="px-2 py-3 text-[13.5px] text-gray-600">Nobody by that name.</li>}
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
  const [inOffice, setInOffice] = useState(true);
  return (
    <section data-add-person>
      <ListTitle>Add a person</ListTitle>
      <p className="mt-1 px-1 text-[13px] text-gray-500">For someone who has not joined with the link. They can make their sign-in later.</p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const form = new FormData();
          form.set("name", name);
          form.set("upline_id", upline ?? "");
          form.set("in_office", inOffice ? "1" : "0");
          start(async () => {
            try {
              const r = await addPersonToTeam(form);
              toast(r.ok ? (r.message ?? "Added.") : r.error, r.ok);
              if (r.ok) setName("");
            } catch {
              toast("Couldn't reach the server. Try again.", false);
            }
          });
        }}
        className="mt-2 space-y-3 rounded-[22px] bg-surface p-4 shadow-card"
      >
        <div>
          <Label htmlFor="new-name">Name</Label>
          <Input id="new-name" name="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="First and last name" maxLength={60} autoComplete="off" required />
        </div>
        <div>
          <Label htmlFor="new-upline">Their upline (whose team they are on)</Label>
          <UplinePicker id="new-upline" value={people.find((p) => p.id === upline) ?? null} choices={people} onPick={setUpline} disabled={pending} />
        </div>
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[14px] font-bold text-gray-900">In the office</p>
            <p className="text-[12px] font-medium text-gray-500">The office group is at the top of every board.</p>
          </div>
          <Switch checked={inOffice} disabled={pending} label="The new person works in the office" onChange={setInOffice} />
        </div>
        <Button type="submit" className="h-11 w-full rounded-xl" disabled={pending || !name.trim()}>
          {pending ? "Adding..." : "Add to the board"}
        </Button>
      </form>
    </section>
  );
}

const SECTION = "border-t border-line pt-3";

/** One person's controls, for the owner and the admins. Each one saves on its own. */
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
  // What the server said about the admin change (an admin's request waits for the owner): kept on the row.
  const [roleNote, setRoleNote] = useState<string | null>(null);
  const first = firstName(person.name);
  const deskLink = `${base}/log?agent=${person.id}`;
  // The owner's row is the owner's; an admin's sign-in, name and place on the board too.
  const theirs = owner || person.role === "member";
  const run = (work: () => Promise<{ ok: true; message?: string } | { ok: false; error: string }>, after?: () => void) =>
    start(async () => {
      try {
        const r = await work();
        toast(r.ok ? (r.message ?? "Saved.") : r.error, r.ok);
        if (r.ok) after?.();
      } catch {
        toast("Couldn't reach the server. Try again.", false);
      }
    });
  return (
    <div className="space-y-3" data-person-editor={person.id}>
      <div className="flex items-center gap-3">
        <Avatar name={person.name} tone={person.tone} size={44} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[17px] font-extrabold tracking-[-0.02em] text-gray-900">{person.name}</p>
          <p className="truncate text-[13px] font-medium text-gray-500">
            {person.role === "owner" ? "Owner · " : person.role === "admin" ? "Admin · " : ""}
            {formatDollars(person.cents)} · {policiesLabel(person.policies)} this month
          </p>
        </div>
        <button type="button" onClick={onClose} aria-label="Close" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-gray-600 hover:bg-gray-100">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden>
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>

      <div className="rounded-2xl bg-surface-2 px-3 py-2.5">
        <p className="flex items-center gap-1.5 text-[14px] font-bold text-gray-900">
          {person.hasLogin ? (
            <>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="text-up">
                <circle cx="12" cy="12" r="9.5" />
                <path d="M7.5 12.5l3 3 6-6.5" />
              </svg>
              Has their own sign-in
            </>
          ) : (
            "No sign-in of their own yet"
          )}
        </p>
        <p className="mt-0.5 text-[13px] font-medium text-gray-600">
          Cell: <span className="font-mono text-gray-900">{person.phone || "none yet"}</span>
          {person.joinedAt ? ` · joined ${formatDate(person.joinedAt)}` : ""}
        </p>
      </div>

      {theirs && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const form = new FormData(e.currentTarget);
            run(() => renamePerson(person.id, form));
          }}
          className="flex items-end gap-2"
        >
          <div className="min-w-0 flex-1">
            <Label htmlFor={`name-${person.id}`}>Name</Label>
            <Input id={`name-${person.id}`} name="name" defaultValue={person.name} maxLength={60} required />
          </div>
          <Button type="submit" variant="secondary" className="h-11 rounded-xl" disabled={pending}>
            Save
          </Button>
        </form>
      )}

      <div>
        <Label htmlFor={`upline-${person.id}`}>Upline (whose team {first} is on)</Label>
        <UplinePicker id={`upline-${person.id}`} value={upline} choices={choices} disabled={pending} onPick={(next) => run(() => setPersonUpline(person.id, next))} />
      </div>

      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[14px] font-bold text-gray-900">In the office</p>
          <p className="text-[12px] font-medium text-gray-500">The office group is at the top of every board.</p>
        </div>
        <Switch
          checked={inOffice}
          disabled={pending}
          label={`${person.name} works in the office`}
          onChange={(next) => {
            setInOffice(next);
            start(async () => {
              try {
                const r = await setPersonInOffice(person.id, next);
                toast(r.ok ? (r.message ?? "Saved.") : r.error, r.ok);
                if (!r.ok) setInOffice(!next);
              } catch {
                toast("Couldn't reach the server. Try again.", false);
                setInOffice(!next);
              }
            });
          }}
        />
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          const form = new FormData(e.currentTarget);
          run(() => savePersonGoal(month, person.id, form));
        }}
        className="flex items-end gap-2"
      >
        <div className="min-w-0 flex-1">
          <Label htmlFor={`goal-${person.id}`}>{pcEnabled ? "Their life goal this month ($ annual premium; blank for none)" : "Their goal this month ($ annual premium; blank for none)"}</Label>
          <Input id={`goal-${person.id}`} name="goal" inputMode="decimal" defaultValue={person.goalCents ? String(person.goalCents / 100) : ""} placeholder="25000" className="font-mono" />
        </div>
        <Button type="submit" variant="secondary" className="h-11 rounded-xl" disabled={pending}>
          Save
        </Button>
      </form>

      {pcEnabled && owner && <PcRow person={person} />}
      {pcEnabled && owner && person.pcLicensed && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const form = new FormData(e.currentTarget);
            run(() => savePersonPcGoal(month, person.id, form));
          }}
          className="flex items-end gap-2"
        >
          <div className="min-w-0 flex-1">
            <Label htmlFor={`pc-goal-${person.id}`}>Their P&amp;C goal this month ($ annual premium; blank for none)</Label>
            <Input id={`pc-goal-${person.id}`} name="pc_goal" inputMode="decimal" defaultValue={person.pcGoalCents ? String(person.pcGoalCents / 100) : ""} placeholder="8000" className="font-mono" />
          </div>
          <Button type="submit" variant="secondary" className="h-11 rounded-xl" disabled={pending}>
            Save
          </Button>
        </form>
      )}

      {theirs && (
        <div className={SECTION} data-sign-in>
          <p className="text-[14px] font-bold text-gray-900">{person.hasLogin ? "Reset sign-in" : "Send a sign-in link"}</p>
          <p className="text-[12.5px] font-medium text-gray-500">
            {person.hasLogin ? `For a forgotten password: ${first} opens the link and picks a new one.` : `${first} opens the link, types their cell number and picks a password.`} The link works once, for 7 days.
          </p>
          {signIn ? (
            <div className="mt-2">
              <LinkBox url={signIn} label={`The one-time link for ${person.name}`} shareText={person.hasLogin ? `${first}, here is your link to set a new Scorecard password. It works once.` : `${first}, here is your link to set up your Scorecard sign-in. It works once.`} />
              <p className="mt-1.5 text-[12.5px] font-medium text-gray-500">Send it to {first} only. It is shown once: making another turns this one off.</p>
            </div>
          ) : (
            <Button
              type="button"
              variant="secondary"
              className="mt-2 h-11 w-full rounded-xl"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  try {
                    const r = person.hasLogin ? await resetPersonSignIn(person.id) : await createPersonInvite(person.id);
                    if (r.ok) setSignIn(r.url);
                    else toast(r.error, false);
                  } catch {
                    toast("Couldn't reach the server. Try again.", false);
                  }
                })
              }
            >
              {pending ? "One moment..." : person.hasLogin ? "Make a reset link" : "Make their sign-in link"}
            </Button>
          )}
        </div>
      )}

      {person.role !== "owner" && (
        <div className={cn(SECTION, "flex items-center justify-between gap-3")} data-admin-row>
          <div className="min-w-0">
            <p className="text-[14px] font-bold text-gray-900">{person.role === "admin" ? "Admin" : "Not an admin"}</p>
            <p className={cn("text-[12.5px] font-medium", roleNote ? "text-accent-text" : "text-gray-500")} data-role-note={roleNote ? "" : undefined}>
              {roleNote ?? (owner ? "An admin runs goals, people, this month's sales and the board." : "Anersi gets a quick OK request first.")}
            </p>
          </div>
          <Button
            type="button"
            variant="secondary"
            className="h-10 shrink-0 rounded-xl px-3 text-[13px]"
            disabled={pending}
            onClick={() => {
              const makeAdmin = person.role !== "admin";
              if (owner && !window.confirm(makeAdmin ? `Make ${person.name} an admin? They can change goals, people, this month's sales and the board.` : `Remove ${person.name} as an admin?`)) return;
              start(async () => {
                try {
                  const r = await setPersonRole(person.id, makeAdmin ? "admin" : "member");
                  toast(r.ok ? (r.message ?? "Saved.") : r.error, r.ok);
                  // An admin's request changes nothing yet: the server's words stay on the row.
                  if (r.ok && !owner) setRoleNote(r.message ?? "Sent to Anersi for a quick OK.");
                } catch {
                  toast("Couldn't reach the server. Try again.", false);
                }
              });
            }}
          >
            {person.role === "admin" ? "Remove admin" : "Make admin"}
          </Button>
        </div>
      )}

      <details className={cn(SECTION, "group")}>
        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between text-[14px] font-bold text-gray-900 [&::-webkit-details-marker]:hidden">
          Desk link
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="text-gray-400 transition-transform group-open:rotate-90">
            <path d="M9 6l6 6-6 6" />
          </svg>
        </summary>
        <p className="text-[12.5px] font-medium text-gray-500">For an NFC tag at a shared desk: opens Log a sale with {first} picked.</p>
        <div className="mt-1 flex items-center gap-2">
          <code className="min-w-0 flex-1 truncate rounded-xl bg-surface-2 px-3 py-2 font-mono text-[12px] text-gray-700">{deskLink}</code>
          <CopyButton text={deskLink} />
        </div>
        {pcEnabled && person.pcLicensed && (
          <>
            <p className="mt-2 text-[12.5px] font-medium text-gray-500">Their P&amp;C desk link: the same, already switched to P&amp;C (a second tag for P&amp;C days).</p>
            <div className="mt-1 flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded-xl bg-surface-2 px-3 py-2 font-mono text-[12px] text-gray-700">{`${deskLink}&kind=pc`}</code>
              <CopyButton text={`${deskLink}&kind=pc`} />
            </div>
          </>
        )}
      </details>

      <div className={cn(SECTION, "flex items-center justify-between gap-2")}>
        {theirs ? (
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              if (!window.confirm(`Take ${person.name} off the board? Their sales stay in the history${person.hasLogin ? ", and their sign-in stops working until they are back" : ""}.`)) return;
              run(() => setPersonActive(person.id, false), onClose);
            }}
            className="min-h-11 rounded-xl px-3 text-[14px] font-bold text-red-700 hover:bg-red-50"
          >
            Take off the board
          </button>
        ) : (
          <span />
        )}
        <button type="button" onClick={onClose} className="min-h-11 rounded-xl px-3 text-[14px] font-bold text-gray-600 hover:bg-gray-100">
          Done
        </button>
      </div>
    </div>
  );
}

/** P&C licensed, saved on the tap: Log a sale then offers Life or P&C for this person. */
function PcRow({ person }: { person: PersonRow }) {
  const [pending, start] = useTransition();
  const [on, setOn] = useState(person.pcLicensed);
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0">
        <p className="text-[14px] font-bold text-gray-900">P&amp;C licensed</p>
        <p className="text-[12px] font-medium text-gray-500">Log a sale offers Life or P&amp;C for them; a P&amp;C sale shows on its own P&amp;C board.</p>
      </div>
      <Switch
        checked={on}
        disabled={pending}
        label={`${person.name} is P&C licensed`}
        onChange={(next) => {
          setOn(next);
          start(async () => {
            const r = await setPersonPc(person.id, next);
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
    <Button
      type="button"
      variant="secondary"
      className="h-10 shrink-0 rounded-xl px-3 text-[13px]"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const r = await setPersonActive(id, true);
          toast(r.ok ? (r.message ?? "Done.") : r.error, r.ok);
        })
      }
    >
      {pending ? "..." : "Put back"}
    </Button>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      variant="secondary"
      className="h-10 shrink-0 rounded-xl px-3 text-[13px]"
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
      {copied ? "Copied" : "Copy"}
    </Button>
  );
}
