import http from "node:http";
import type { AddressInfo } from "node:net";

/**
 * A stand-in for AgentSpace's API (GET only, invented people), for tests/agentspace-sync.test.ts:
 * the Scoreboard (per agent per day, only deals that count), client search (a name or email
 * fragment, or three or more phone digits; pages of up to 100; 404 past the last page) and one
 * deal in full (404 when it is gone). Knobs: a key to require, queued 429s and 500s, and per-path
 * call counts.
 */
export interface MockDeal {
  id: string;
  clientFirst: string;
  clientLast: string;
  email: string;
  phone: string;
  agentId: string;
  agentName: string;
  day: string;
  annual: number;
  monthly?: number;
  status?: string;
  post?: boolean;
  /** The deal answers without its post_a_deal flag. */
  omitFlag?: boolean;
  carrier?: string;
  product?: string;
  policyNumber?: string | null;
  notes?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export class MockAgentSpace {
  deals = new Map<string, MockDeal>();
  key = "test-key";
  /** Deals whose own page answers 404 while the Scoreboard still counts them. */
  hidden = new Set<string>();
  /** Answers to give before the real one: "429", "429:0" (with Retry-After seconds) or "500". */
  queue: string[] = [];
  calls: Record<string, number> = { scoreboard: 0, search: 0, deal: 0, other: 0 };
  total = 0;
  /** An answer ("429:600") given to the first call after the Scoreboard's, until cleared. */
  afterScoreboard: string | null = null;
  private seenScoreboard = false;
  private server = http.createServer((req, res) => this.handle(req, res));
  base = "";

  async start(): Promise<void> {
    await new Promise<void>((r) => this.server.listen(0, "127.0.0.1", r));
    this.base = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}/api/v1/`;
  }
  async stop(): Promise<void> {
    this.server.closeAllConnections();
    await new Promise<void>((r) => this.server.close(() => r()));
  }
  resetCalls(): void {
    this.seenScoreboard = false;
    this.afterScoreboard = null;
    this.calls = { scoreboard: 0, search: 0, deal: 0, other: 0 };
    this.total = 0;
  }
  add(d: MockDeal): void {
    this.deals.set(d.id, { post: true, status: "pending", carrier: "Test Mutual", product: "WL/FEX", monthly: Math.round(d.annual / 12), ...d });
  }

  private full(d: MockDeal) {
    const now = new Date().toISOString();
    return {
      id: d.id,
      client: { id: `c-${d.clientFirst}-${d.clientLast}`, first_name: d.clientFirst, last_name: d.clientLast, name: `${d.clientFirst} ${d.clientLast}`, email: d.email, phone: d.phone, address: "1 Test Road, Troy, MI", date_of_birth: "1950-01-02" },
      agent: { id: d.agentId, name: d.agentName },
      carrier: { display_name: d.carrier },
      product: { name: d.product },
      policy_number: d.policyNumber ?? null,
      application_number: null,
      status: { code: d.status, raw: d.status, label: d.status, portfolio_bucket: "pipeline" },
      annual_premium: d.annual.toFixed(2),
      monthly_premium: (d.monthly ?? d.annual / 12).toFixed(2),
      face_value: "10000.00",
      policy_effective_date: d.day,
      submission_date: d.day,
      billing_cycle: "monthly",
      billing_day_of_month: "5th",
      billing_weekday: null,
      lead_source: "Referral",
      rate_class: "Standard",
      notes: d.notes ?? null,
      post_a_deal: d.omitFlag ? undefined : d.post !== false,
      beneficiaries: [],
      created_at: d.createdAt ?? now,
      updated_at: d.updatedAt ?? d.createdAt ?? now,
    };
  }
  private summary(d: MockDeal) {
    const f = this.full(d);
    return { id: f.id, status: f.status, annual_premium: f.annual_premium, submission_date: f.submission_date, agent: f.agent, created_at: f.created_at, updated_at: f.updated_at };
  }

  private handle(req: http.IncomingMessage, res: http.ServerResponse): void {
    const send = (status: number, body: unknown, headers: Record<string, string> = {}) => {
      res.writeHead(status, { "Content-Type": "application/json", ...headers });
      res.end(JSON.stringify(body));
    };
    this.total++;
    const url = new URL(req.url ?? "/", "http://x");
    if (req.method !== "GET") return send(405, { error: "GET only" });
    if (req.headers.authorization !== `Bearer ${this.key}`) return send(401, { error: "AuthenticationFailed" });
    const path = url.pathname.replace(/^\/api\/v1\//, "");
    const kind = path.startsWith("scoreboard") ? "scoreboard" : path.startsWith("clients/search") ? "search" : path.startsWith("deals/") ? "deal" : "other";
    this.calls[kind]++;
    let next = this.queue.shift();
    if (!next && kind !== "scoreboard" && this.afterScoreboard && this.seenScoreboard) next = this.afterScoreboard;
    if (kind === "scoreboard") this.seenScoreboard = true;
    if (next) {
      const [code, after] = next.split(":");
      return send(Number(code), { error: "busy" }, after !== undefined ? { "Retry-After": after } : {});
    }
    if (kind === "scoreboard") {
      const from = url.searchParams.get("start_date") ?? "";
      const to = url.searchParams.get("end_date") ?? "";
      const by = new Map<string, { name: string; days: Record<string, number>; n: number }>();
      for (const d of this.deals.values()) {
        if (d.post === false || d.day < from || d.day > to) continue;
        const row = by.get(d.agentId) ?? { name: d.agentName, days: {}, n: 0 };
        row.days[d.day] = Math.round(((row.days[d.day] ?? 0) + d.annual) * 100) / 100;
        row.n++;
        by.set(d.agentId, row);
      }
      const leaderboard = [...by.entries()].map(([agentId, r], i) => ({ rank: i + 1, entityId: agentId, agentId, name: r.name, rowType: "producer", total: Object.values(r.days).reduce((a, b) => a + b, 0), dealCount: r.n, dailyBreakdown: r.days }));
      return send(200, { kind: "producer", leaderboard, stats: { totalDeals: leaderboard.reduce((a, r) => a + r.dealCount, 0) } });
    }
    if (kind === "search") {
      const q = (url.searchParams.get("query") ?? "").toLowerCase();
      if (q.length < 2) return send(400, { error: "ValidationError" });
      const size = Math.min(100, Math.max(1, Number(url.searchParams.get("page_size") ?? 10)));
      const page = Math.max(1, Number(url.searchParams.get("page") ?? 1));
      const clients = new Map<string, { first: string; last: string; email: string; phone: string; deals: MockDeal[] }>();
      for (const d of this.deals.values()) {
        const k = `${d.clientFirst}|${d.clientLast}`;
        const c = clients.get(k) ?? { first: d.clientFirst, last: d.clientLast, email: d.email, phone: d.phone, deals: [] };
        c.deals.push(d);
        clients.set(k, c);
      }
      const digits = q.replace(/\D/g, "");
      const hits = [...clients.values()].filter((c) => `${c.first} ${c.last} ${c.email}`.toLowerCase().includes(q) || (digits.length >= 3 && c.phone.replace(/\D/g, "").includes(digits)));
      const slice = hits.slice((page - 1) * size, page * size);
      if (page > 1 && !slice.length) return send(404, { error: "NotFound", message: "Invalid page." });
      return send(200, {
        count: hits.length,
        next: page * size < hits.length ? "more" : null,
        previous: null,
        results: slice.map((c) => ({ id: `c-${c.first}-${c.last}`, first_name: c.first, last_name: c.last, name: `${c.first} ${c.last}`, email: c.email, phone: c.phone, deal_count: c.deals.length, deals: c.deals.map((d) => this.summary(d)) })),
      });
    }
    if (kind === "deal") {
      const d = this.deals.get(decodeURIComponent(path.split("/")[1] ?? ""));
      return d && !this.hidden.has(d.id) ? send(200, this.full(d)) : send(404, { error: "NotFound", message: "Deal not found" });
    }
    return send(404, { error: "NotFound" });
  }
}
