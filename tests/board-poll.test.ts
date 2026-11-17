import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { POLL_TIMEOUT_MS, RETRY_MS, fetchWithin, pollGate } from "../src/components/board/poll";

test("one poll at a time: a tick that finds one in flight is skipped, and the next goes through once it ends", () => {
  const gate = pollGate();
  assert.equal(gate.begin(), true);
  assert.equal(gate.busy(), true);
  assert.equal(gate.begin(), false, "second tick skipped");
  assert.equal(gate.begin(), false, "third tick skipped");
  gate.end();
  assert.equal(gate.busy(), false);
  assert.equal(gate.begin(), true, "recovers on the next tick");
  gate.end();
  gate.end(); // harmless twice
  assert.equal(gate.begin(), true);
});

test("a slow database: ticks every 5 s over a 40 s stall start one request, not eight", async () => {
  const gate = pollGate();
  let started = 0;
  const slow = new Promise<void>((r) => setTimeout(r, 30));
  const tick = async () => {
    if (!gate.begin()) return;
    started++;
    try {
      await slow;
    } finally {
      gate.end();
    }
  };
  await Promise.all(Array.from({ length: 8 }, () => tick()));
  assert.equal(started, 1);
  await tick();
  assert.equal(started, 2, "the next tick after it finished polls again");
});

test("the limits: a poll gives up at 8 s, the failure page asks again every 15 s", () => {
  assert.equal(POLL_TIMEOUT_MS, 8000);
  assert.equal(RETRY_MS, 15000);
});

test("fetchWithin cuts a request that never answers, and passes one that does", async () => {
  let stall = true;
  const server = http.createServer((_q, res) => {
    if (stall) return; // never answers
    res.end("{}");
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/board`;
  try {
    const started = Date.now();
    await assert.rejects(() => fetchWithin(url, 150), (e: unknown) => ["TimeoutError", "AbortError"].includes((e as Error).name));
    assert.ok(Date.now() - started < 1000);
    stall = false;
    const ok = await fetchWithin(url, 2000);
    assert.equal(ok.status, 200);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
  }
});
