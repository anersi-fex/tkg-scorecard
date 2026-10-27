import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * The one database client: server only, service role key. The browser never talks to Supabase;
 * every page, action and route checks the session first (src/lib/auth.ts). Lazy so `next build`
 * runs without env vars.
 */
let client: SupabaseClient | null = null;

export function db(): SupabaseClient {
  if (!client) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not configured");
    client = createClient(url.replace(/\/rest\/v1\/?$/, "").replace(/\/$/, ""), key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return client;
}

/** True when the database env vars are set (pages show a setup notice otherwise). */
export function dbConfigured(): boolean {
  return !!process.env.SUPABASE_URL && !!process.env.SUPABASE_SERVICE_ROLE_KEY;
}
