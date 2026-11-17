import { test } from "node:test";
import assert from "node:assert/strict";
import Module from "node:module";
import http from "node:http";
import type { AddressInfo } from "node:net";

/**
 * The database client gives up on a request that does not answer (src/lib/supabase.ts), and the
 * give-up reaches a caller as a failed read, not a hang and not a crash. Runs the REAL client
 * against a local server that accepts a request and never answers.
 */
const req = Module.createRequire(__filename);
const marker = req.resolve("server-only");
req.cache[marker] = { id: marker, filename: marker, loaded: true, exports: {} } as unknown as NodeJS.Module;
const { timeoutFetch, DB_TIMEOUT_MS } = req("../src/lib/supabase") as typeof import("../src/lib/supabase");
const { createClient } = req("@supabase/supabase-js") as typeof import("@supabase/supabase-js");

function stalledServer(): Promise<{ url: string; hits: () => number; close: () => Promise<void> }> {
  let hits = 0;
  const sockets = new Set<import("node:net").Socket>();
  const server = http.createServer(() => {
    hits++; // never answers
  });
  server.on("connection", (s) => {
    sockets.add(s);
    s.on("close", () => sockets.delete(s));
  });
  return new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () =>
      resolve({
        url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
        hits: () => hits,
        close: () => new Promise<void>((done) => {
          for (const s of sockets) s.destroy();
          server.close(() => done());
        }),
      }),
    ),
  );
}

test("the timeout is about 8 seconds", () => {
  assert.equal(DB_TIMEOUT_MS, 8000);
});

test("a database that stalls: the read comes back as an error after the timeout, once (no retries), never a hang or a throw", async () => {
  const stalled = await stalledServer();
  try {
    const client = createClient(stalled.url, "service-key", { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: timeoutFetch(300) } });
    const started = Date.now();
    const { data, error } = await client.from("sales").select("id").limit(1);
    const took = Date.now() - started;
    assert.equal(data, null);
    assert.ok(error, "the read answered with an error");
    assert.match(String(error.message), /AbortError|aborted|did not answer/i);
    assert.ok(took >= 250 && took < 900, `gave up after ${took} ms (limit 300, no retries)`);
    assert.equal(stalled.hits(), 1, "the stalled read was not retried");
  } finally {
    await stalled.close();
  }
});

test("a write that stalls is cut the same way", async () => {
  const stalled = await stalledServer();
  try {
    const client = createClient(stalled.url, "service-key", { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: timeoutFetch(200) } });
    const { error } = await client.from("sales").insert({ agent_id: "x" });
    assert.ok(error);
    assert.match(String(error.message), /AbortError|aborted|did not answer/i);
  } finally {
    await stalled.close();
  }
});

test("a database that answers in time is untouched, and the caller's own signal still cancels", async () => {
  const server = http.createServer((_q, res) => {
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify([{ id: "a" }]));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const client = createClient(url, "service-key", { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: timeoutFetch(2000) } });
    const { data, error } = await client.from("sales").select("id");
    assert.equal(error, null);
    assert.deepEqual(data, [{ id: "a" }]);
    const ctl = new AbortController();
    ctl.abort();
    await assert.rejects(() => timeoutFetch(2000)(url, { signal: ctl.signal }), (e: unknown) => (e as Error).name === "AbortError");
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
});
