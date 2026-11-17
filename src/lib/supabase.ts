import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * The one database client: server only, service role key. The browser never talks to Supabase;
 * every page, action and route checks the session first (src/lib/auth.ts). Lazy so `next build`
 * runs without env vars.
 */
let client: SupabaseClient | null = null;

/**
 * How long one database request may take. supabase-js has no timeout of its own, so a slow
 * database would leave every page spinning for good. Long enough for the biggest page read (1000
 * sales); past it the request is cut and the client answers with an error, which data.ts turns
 * into a DataError like any other failed read.
 */
export const DB_TIMEOUT_MS = 8000;

/**
 * A fetch that gives up after `ms` (and also when the caller's own signal fires). The give-up is
 * thrown as an AbortError on purpose: postgrest-js retries a GET that fails with a TimeoutError
 * (a few more waits of `ms` each) but never one that was aborted.
 */
export function timeoutFetch(ms: number = DB_TIMEOUT_MS): typeof fetch {
  return async (input, init) => {
    const limit = AbortSignal.timeout(ms);
    const signal = init?.signal ? AbortSignal.any([init.signal, limit]) : limit;
    try {
      return await fetch(input, { ...init, signal });
    } catch (err) {
      if (limit.aborted && !init?.signal?.aborted) throw new DOMException("The database did not answer in time", "AbortError");
      throw err;
    }
  };
}

export function db(): SupabaseClient {
  if (!client) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not configured");
    client = createClient(url.replace(/\/rest\/v1\/?$/, "").replace(/\/$/, ""), key, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: timeoutFetch() },
    });
  }
  return client;
}

/** True when the database env vars are set (pages show a setup notice otherwise). */
export function dbConfigured(): boolean {
  return !!process.env.SUPABASE_URL && !!process.env.SUPABASE_SERVICE_ROLE_KEY;
}
