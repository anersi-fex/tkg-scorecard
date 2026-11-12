import type { Agent } from "./types";

/**
 * The agency's tree, from `agents.upline_id` (0005_lineage.sql). Pure and browser-safe.
 *
 * A leader is anyone with at least one active person under them; a team is the leader and
 * everyone below, all levels. A person taken off the board (`active` false) is not counted as
 * one of a team's people, but they stay in the tree: their sales still belong to the team they
 * are on, and the people under them still reach the leaders above.
 *
 * Bad data never hangs anything: an upline that does not exist counts as none, a person who is
 * their own upline counts as having none, and a loop is walked once (every walk stops at a repeat).
 *
 * Confirmed uplines only (0006_crm.sql, contract decision 6): an upline a joiner picked that waits
 * to be confirmed (`upline_confirmed` false) counts as none, so that person is on nobody's team
 * (team numbers, Teams, My team) and nobody above sees their clients, while they still count on
 * the agency board. `{ includeUnconfirmed: true }` builds the tree as typed (the People page's
 * "wants to join" list, and a loop check, read the waiting upline too).
 */
export interface Org {
  /** The people directly under `id`, by name. */
  childrenOf(id: string): string[];
  /** Everyone below `id`, all levels, without `id`. Nearest levels first. */
  downlineOf(id: string): string[];
  /** `id` and everyone below. */
  teamOf(id: string): string[];
  /** The active people of `id`'s team, the leader included when active (what "N people" counts). */
  membersOf(id: string): string[];
  /** Everyone with at least one active person under them, by name. */
  leaders(): string[];
  /** The uplines of `id`, nearest first, up to the top. */
  uplineChain(id: string): string[];
  /** True when putting `id` under `newUplineId` would make a loop (themself, or someone below them). */
  wouldCycle(id: string, newUplineId: string | null): boolean;
  nameOf(id: string): string | null;
  /** The upline's id, or null at the top (or when the stored upline does not exist). */
  uplineOf(id: string): string | null;
  isLeader(id: string): boolean;
  /**
   * The leader of the team a person calls theirs ("My team"): themself when they have people
   * under them, else their nearest upline; null for someone alone at the top (or not on the list).
   */
  myTeamLeader(id: string): string | null;
}

export interface OrgOptions {
  /** Count an upline that waits to be confirmed as if it were confirmed (default false). */
  includeUnconfirmed?: boolean;
}

/** The upline that counts for teams and client visibility: null while a picked upline waits to be confirmed. */
export function confirmedUplineOf(a: Pick<Agent, "upline_id" | "upline_confirmed">): string | null {
  return a.upline_confirmed === false ? null : (a.upline_id ?? null);
}

export function buildOrg(agents: Agent[], opts: OrgOptions = {}): Org {
  const byId = new Map<string, Agent>();
  for (const a of agents) byId.set(a.id, a);
  const byName = (x: string, y: string) => (byId.get(x)?.name ?? "").localeCompare(byId.get(y)?.name ?? "") || x.localeCompare(y);

  const upline = new Map<string, string | null>();
  const children = new Map<string, string[]>();
  for (const a of agents) {
    const raw = opts.includeUnconfirmed ? (a.upline_id ?? null) : confirmedUplineOf(a);
    const up = raw && raw !== a.id && byId.has(raw) ? raw : null;
    upline.set(a.id, up);
    if (up) {
      const list = children.get(up);
      if (list) list.push(a.id);
      else children.set(up, [a.id]);
    }
  }
  for (const list of children.values()) list.sort(byName);

  const downCache = new Map<string, string[]>();
  function downlineOf(id: string): string[] {
    const hit = downCache.get(id);
    if (hit) return hit;
    const seen = new Set<string>([id]);
    const out: string[] = [];
    let level = children.get(id) ?? [];
    while (level.length) {
      const next: string[] = [];
      for (const c of level) {
        if (seen.has(c)) continue;
        seen.add(c);
        out.push(c);
        const kids = children.get(c);
        if (kids) next.push(...kids);
      }
      level = next;
    }
    downCache.set(id, out);
    return out;
  }

  function uplineChain(id: string): string[] {
    const seen = new Set<string>([id]);
    const out: string[] = [];
    let at = upline.get(id) ?? null;
    while (at && !seen.has(at)) {
      seen.add(at);
      out.push(at);
      at = upline.get(at) ?? null;
    }
    return out;
  }

  let leaderList: string[] | null = null;
  let leaderSet: Set<string> | null = null;
  function leaders(): string[] {
    if (!leaderList) {
      leaderList = agents.filter((a) => downlineOf(a.id).some((d) => byId.get(d)?.active !== false)).map((a) => a.id).sort(byName);
      leaderSet = new Set(leaderList);
    }
    return leaderList;
  }

  return {
    childrenOf: (id) => children.get(id) ?? [],
    downlineOf,
    teamOf: (id) => [id, ...downlineOf(id)],
    membersOf: (id) => [id, ...downlineOf(id)].filter((m) => byId.get(m)?.active !== false && byId.has(m)),
    leaders,
    uplineChain,
    wouldCycle: (id, newUplineId) => {
      if (!newUplineId) return false;
      if (newUplineId === id) return true;
      return downlineOf(id).includes(newUplineId) || uplineChain(newUplineId).includes(id);
    },
    nameOf: (id) => byId.get(id)?.name ?? null,
    uplineOf: (id) => upline.get(id) ?? null,
    isLeader: (id) => {
      leaders();
      return leaderSet!.has(id);
    },
    myTeamLeader: (id) => {
      if (!byId.has(id)) return null;
      leaders();
      return leaderSet!.has(id) ? id : (upline.get(id) ?? null);
    },
  };
}
