import Module from "node:module";
import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";

/**
 * A stand-in for the database and for Next's request, for tests that run the REAL server actions
 * and libraries (tests/throttle.test.ts, tests/people-actions.test.ts): tables in memory behind
 * the same calls the Supabase client takes, with an optional round trip's delay so tries sent at
 * the same moment really interleave. No Postgres, no server, no network. Not a test file itself
 * (npm test runs tests/*.test.ts).
 *
 * Import this before anything from src is loaded: it stands in for `server-only`,
 * src/lib/supabase, next/headers, next/navigation and next/cache through the require cache
 * (tsx runs the tests as CommonJS, like tests/invites.test.ts relies on).
 */
export const req = Module.createRequire(__filename);
export function stub(id: string, exports: unknown): void {
  const file = req.resolve(id);
  req.cache[file] = { id: file, filename: file, loaded: true, exports } as unknown as NodeJS.Module;
}

process.env.OWNER_PASSWORD = "owner-right-pass";
process.env.TEAM_PASSWORD = "team-right-pass";
process.env.SESSION_SECRET = "s".repeat(48);

// ---- the stand-in database ------------------------------------------------------------------
export type Row = Record<string, unknown>;
export const tables: Record<string, Row[]> = { login_attempts: [], agents: [], invites: [], settings: [], approvals: [], sales: [], goals: [], agent_goals: [] };
/** Milliseconds each way for a database call: 0 answers on the next tick (one-at-a-time tests), more makes bursts interleave. */
export const lag = { ms: 0 };
const sleep = (ms: number) => new Promise((r) => (ms > 0 ? setTimeout(r, ms) : setImmediate(r)));
const trip = () => sleep(lag.ms > 0 ? lag.ms * (0.5 + Math.random()) : 0);
/** Tables that answer with an error, the way a missing table or a database that is down does. */
export const broken = new Set<string>();
const like = (pattern: string) => new RegExp(`^${pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*")}$`);
const ids = { next: 1 };
/** A login_attempts row as a counted try leaves it (to fill a count without running 60 tries). */
export const attemptRow = (key: string): Row => ({ id: ids.next++, ip: key, at: new Date().toISOString() });

class Query {
  private op: "select" | "insert" | "update" | "delete" | "upsert" = "select";
  private filters: ((r: Row) => boolean)[] = [];
  private payload: Row = {};
  private head = false;
  private one: null | "single" | "maybe" = null;
  private returning = false;
  private sort: [string, boolean] | null = null;
  private max: number | null = null;
  constructor(private table: string) {}
  select(_columns?: string, opts?: { count?: string; head?: boolean }) {
    if (this.op === "select") this.head = !!opts?.head;
    else this.returning = true;
    return this;
  }
  insert(p: Row) {
    this.op = "insert";
    this.payload = p;
    return this;
  }
  upsert(p: Row) {
    this.op = "upsert";
    this.payload = p;
    return this;
  }
  update(p: Row) {
    this.op = "update";
    this.payload = p;
    return this;
  }
  delete() {
    this.op = "delete";
    return this;
  }
  eq(c: string, v: unknown) {
    this.filters.push((r) => r[c] === v);
    return this;
  }
  neq(c: string, v: unknown) {
    this.filters.push((r) => r[c] !== v);
    return this;
  }
  gte(c: string, v: string) {
    this.filters.push((r) => String(r[c]) >= v);
    return this;
  }
  gt(c: string, v: string) {
    this.filters.push((r) => r[c] != null && String(r[c]) > v);
    return this;
  }
  is(c: string, v: unknown) {
    this.filters.push((r) => (r[c] ?? null) === v);
    return this;
  }
  in(c: string, vs: unknown[]) {
    this.filters.push((r) => vs.includes(r[c]));
    return this;
  }
  not(c: string, op: string, v: unknown) {
    if (op === "like") {
      const re = like(String(v));
      this.filters.push((r) => !re.test(String(r[c])));
    } else if (op === "is") this.filters.push((r) => (r[c] ?? null) !== v);
    else throw new Error(`stand-in: not ${op}`);
    return this;
  }
  order(c: string, opts?: { ascending?: boolean }) {
    this.sort = [c, opts?.ascending !== false];
    return this;
  }
  limit(n: number) {
    this.max = n;
    return this;
  }
  maybeSingle() {
    this.one = "maybe";
    return this;
  }
  single() {
    this.one = "single";
    return this;
  }
  private run(): { data: unknown; error: unknown; count?: number | null } {
    const rows = tables[this.table];
    if (!rows) throw new Error(`stand-in: no table ${this.table}`);
    if (broken.has(this.table)) return { data: null, error: { message: `relation "public.${this.table}" does not exist`, code: "42P01" } };
    const hit = (r: Row) => this.filters.every((f) => f(r));
    let out: Row[] = [];
    if (this.op === "insert" || this.op === "upsert") {
      const p = this.payload;
      if (this.table === "agents" && p.phone && rows.some((r) => r.phone === p.phone)) return { data: null, error: { code: "23505", message: "duplicate key" } };
      if (this.op === "upsert" && rows.some((r) => r.key === p.key)) return { data: null, error: null };
      const row: Row =
        this.table === "login_attempts"
          ? { id: ids.next++, at: new Date().toISOString(), ...p }
          : this.table === "agents"
            ? { id: randomUUID(), active: true, role: "member", session_version: 1, pass_hash: null, phone: null, upline_id: null, in_office: false, ...p }
            : { id: randomUUID(), ...p };
      rows.push(row);
      out = [row];
    } else if (this.op === "update") {
      const p = this.payload;
      if (this.table === "agents" && p.phone && rows.some((r) => r.phone === p.phone && !hit(r))) return { data: null, error: { code: "23505", message: "duplicate key" } };
      out = rows.filter(hit);
      for (const r of out) Object.assign(r, p);
    } else if (this.op === "delete") {
      out = rows.filter(hit);
      tables[this.table] = rows.filter((r) => !hit(r));
    } else {
      out = rows.filter(hit);
      if (this.sort) {
        const [c, asc] = this.sort;
        out = [...out].sort((a, b) => ((a[c] as number) < (b[c] as number) ? -1 : 1) * (asc ? 1 : -1));
      }
      if (this.max != null) out = out.slice(0, this.max);
      if (this.head) return { data: null, error: null, count: out.length };
    }
    if (this.one) return out.length === 1 ? { data: out[0], error: null } : out.length === 0 && this.one === "maybe" ? { data: null, error: null } : { data: null, error: { message: `rows: ${out.length}` } };
    return { data: this.op === "select" || this.returning ? out : null, error: null };
  }
  then<A, B>(ok: (v: { data: unknown; error: unknown; count?: number | null }) => A, bad?: (e: unknown) => B) {
    return trip()
      .then(() => this.run())
      .then(async (v) => {
        await trip();
        return v;
      })
      .then(ok, bad);
  }
}

stub("server-only", {});
stub("../src/lib/supabase", { db: () => ({ from: (t: string) => new Query(t) }), dbConfigured: () => true });
// Each call carries the address it came from and the session cookie it holds (the way a request does).
export const request = new AsyncLocalStorage<{ address: string; cookie?: string }>();
const jar = {
  set() {},
  get: () => {
    const cookie = request.getStore()?.cookie;
    return cookie ? { value: cookie } : undefined;
  },
  delete() {},
};
stub("next/headers", { headers: async () => ({ get: (k: string) => (k === "x-forwarded-for" ? (request.getStore()?.address ?? "203.0.113.250") : null) }), cookies: async () => jar });
export class Redirect extends Error {}
stub("next/navigation", {
  redirect: () => {
    throw new Redirect("redirect");
  },
});
stub("next/cache", { revalidatePath() {} });

const SUPABASE = req.resolve("../src/lib/supabase");
/**
 * One server instance: forgets every module of the app that is loaded (and so its in-memory
 * counts); what is loaded next is a fresh copy on the same database.
 */
export function freshInstance(): void {
  for (const file of Object.keys(req.cache)) if (file.includes("/src/") && file !== SUPABASE) delete req.cache[file];
}

export const form = (fields: Record<string, string>): FormData => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
};
