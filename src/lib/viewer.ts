/**
 * Who is looking, and what they may do (owner, 2026-11-12). Browser-safe: types and pure rules.
 *   owner  Anersi: everything, plus the approvals inbox and the technical settings.
 *   admin  runs the agency (Jack): goals, people, sales, the board's look, join links. Two things
 *          wait for the owner's yes: making or removing an admin, and changing a past month's sales.
 *   manager leads a team (0006): logs for themself and their confirmed downline, sees that team's
 *          clients, updates the status, underwriting and notes on their team's policies, confirms joiners.
 *   member everyone else with their own sign-in ("Agent" on screen): logs their own sales, edits their own profile.
 *   team   the shared team password (the TV, and phones that have not joined yet).
 */
export type Level = "owner" | "admin" | "manager" | "member" | "team";

export interface Viewer {
  level: Level;
  /** The person this session names; null for the shared team password (and for the owner password when no owner row exists). */
  agentId: string | null;
  name: string | null;
  via: "owner-password" | "team-password" | "person";
}

export const isOwner = (v: Pick<Viewer, "level">): boolean => v.level === "owner";
/** Owner or admin: the day-to-day controls (goals, people, any sale of this month, the board's settings). The need "admin" in pageViewer/requireViewer. */
export const isAdmin = (v: Pick<Viewer, "level">): boolean => v.level === "owner" || v.level === "admin";
export const isManager = (v: Pick<Viewer, "level">): boolean => v.level === "manager";
/** A person's own sign-in (or the owner password): anyone but the shared team password. */
export const isPerson = (v: Pick<Viewer, "level">): boolean => v.level !== "team";

/** The words on screen for a level: "Admin · owner", "Admin", "Manager", "Agent", "Team password". */
export const LEVEL_LABEL: Record<Level, string> = { owner: "Admin · owner", admin: "Admin", manager: "Manager", member: "Agent", team: "Team password" };

/** What needs the owner's yes when an admin asks for it. */
export type ApprovalKind = "make_admin" | "remove_admin" | "edit_past_sale" | "remove_past_sale";
export const APPROVAL_KINDS: ApprovalKind[] = ["make_admin", "remove_admin", "edit_past_sale", "remove_past_sale"];
