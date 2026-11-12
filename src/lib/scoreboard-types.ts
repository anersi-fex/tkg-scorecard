/**
 * The Scoreboard: the agency's CRM-style analytics (owner, 2026-11-12: "copy and pay attention to
 * analytics in the same way that their current CRM does ... matched exactly"). Browser-safe types;
 * the pure builder is src/lib/scoreboard.ts and the loader src/lib/scoreboard-load.ts.
 * Money is cents, dates are Detroit "YYYY-MM-DD". Life only.
 */

/** One sale as the builder needs it (life, not deleted). */
export interface ScoreSale {
  agent_id: string;
  premium_cents: number;
  policies: number;
  product: string | null;
  carrier: string | null;
  sold_on: string;
}

export interface ScoreRange {
  /** First and last day shown (a running month ends today). */
  from: string;
  to: string;
  /** "Nov 1 – 11" */
  label: string;
  /** Every day from..to, oldest first: the table's day columns. */
  days: string[];
}

export interface ScoreKpis {
  /** Production: annual premium sold in the range, and in the same day numbers of the month before. */
  productionCents: number;
  prevProductionCents: number;
  /** Policies sold (policies with premium). */
  policies: number;
  prevPolicies: number;
  /** Active agents: agents who sold. */
  activeAgents: number;
  prevActiveAgents: number;
  /** One number per day of the range, oldest first (the sparklines). */
  dailyCents: number[];
  dailyActiveAgents: number[];
}

export interface ScoreBucket {
  /** "Under $2K", "$2K–$4K", "$4K–$6K", "$6K–$8K", "$8K+" */
  label: string;
  count: number;
}

/** "Where agents stand": the agents who sold, in up to six ranges, and the middle agent. */
export interface ScoreStand {
  agents: number;
  medianCents: number;
  buckets: ScoreBucket[];
  /** Fewer than five sellers: "Too few agents on the board to compare" (AgentSpace's words). */
  tooFew: boolean;
}

/** "Moved most this week": the last 7 days against the 7 days before. */
export interface ScoreMover {
  agentId: string;
  name: string;
  nowCents: number;
  wasCents: number;
  deltaCents: number;
}

export interface ScoreRow {
  agentId: string;
  name: string;
  /** Avatar tint (teamTones). */
  tone: string;
  inOffice: boolean;
  uplineId: string | null;
  /** Their upline's name (null at the top). */
  uplineName: string | null;
  /** 1 = most production in the range (ties: more policies, then name). */
  rank: number;
  /** Places gained (+) or lost (−) since yesterday; 0 no change; null when they were not on the board yesterday. */
  rankChange: number | null;
  policies: number;
  totalCents: number;
  /** date -> cents, only days with production. */
  byDay: Record<string, number>;
  byProduct: Record<string, number>;
  byCarrier: Record<string, number>;
}

/** A team: a leader and everyone under them, added up ("Agency totals" in the CRM). */
export interface ScoreTeam {
  leaderId: string;
  /** The leader's name ("Anersi Koka"); screens say "Anersi Koka's team". */
  name: string;
  /** People on the team (leader included; someone off the board only while they sold in the range) and how many of them sold. */
  members: number;
  activeAgents: number;
  rank: number;
  rankChange: number | null;
  policies: number;
  totalCents: number;
  byDay: Record<string, number>;
  byProduct: Record<string, number>;
  byCarrier: Record<string, number>;
  /** The team's people who sold, most production first (agent ids into rows). */
  memberIds: string[];
}

export interface Scoreboard {
  /** "agency": everyone. "team": one leader's downline (the CRM's "Hierarchy"). */
  scope: "agency" | "team";
  scopeLeaderId: string | null;
  /** "Lineage Financial", or "Anersi Koka's team". */
  scopeName: string;
  range: ScoreRange;
  /** The comparison range: the same day numbers of the month before ("Oct 1 – 11"). */
  compare: { from: string; to: string; label: string };
  kpis: ScoreKpis;
  stand: ScoreStand;
  /** label: "Last 7 days vs the 7 days before". Up to three each; never the same person in both. */
  movers: { label: string; up: ScoreMover[]; down: ScoreMover[] };
  /** Everyone in scope who sold in the range, rank order. */
  rows: ScoreRow[];
  /** Every leader in scope (someone with people under them) whose team sold, rank order. */
  teams: ScoreTeam[];
  /** Column order for the Category view: most production first. */
  products: string[];
  carriers: string[];
  generatedAt: string;
}
