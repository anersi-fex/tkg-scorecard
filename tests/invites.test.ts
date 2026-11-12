import { test } from "node:test";
import assert from "node:assert/strict";
import Module from "node:module";
import { createHash } from "node:crypto";

// invites.ts is marked server-only (the marker throws outside a server bundle): stand in for it here.
// Only its pure parts run in this file: nothing here talks to a database.
const req = Module.createRequire(__filename);
const marker = req.resolve("server-only");
req.cache[marker] = { id: marker, filename: marker, loaded: true, exports: {} } as unknown as NodeJS.Module;
const { newToken, tokenShapeOk, hashToken, oneUseExpiry, inviteLive } = req("../src/lib/invites") as typeof import("../src/lib/invites");

test("a token is 32 random bytes as base64url: 43 characters, safe in an address", () => {
  const token = newToken();
  assert.match(token, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(Buffer.from(token, "base64url").length, 32);
  assert.equal(encodeURIComponent(token), token);
  assert.ok(tokenShapeOk(token));
});

test("tokens do not repeat", () => {
  const seen = new Set(Array.from({ length: 500 }, () => newToken()));
  assert.equal(seen.size, 500);
});

test("only something shaped like a token is looked up", () => {
  const token = newToken();
  for (const bad of ["", "short", token.slice(1), `${token}a`, `${token.slice(0, 42)}=`, `${token.slice(0, 42)}/`, `${token.slice(0, 42)}+`, ` ${token.slice(1)}`, null, undefined, 42, {}, [token]]) {
    assert.equal(tokenShapeOk(bad), false, String(bad));
  }
});

test("the stored value is the token's SHA-256 in hex: 64 characters, never the token", () => {
  const token = newToken();
  const hash = hashToken(token);
  assert.match(hash, /^[0-9a-f]{64}$/); // invites.token_hash: char_length = 64
  assert.equal(hash, createHash("sha256").update(token).digest("hex"));
  assert.equal(hashToken(token), hash);
  assert.notEqual(hashToken(newToken()), hash);
  assert.ok(!hash.includes(token));
  // A known value, so the stored form can never drift without this failing.
  assert.equal(hashToken("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
});

test("a one-use link lasts 7 days", () => {
  assert.equal(oneUseExpiry(new Date("2026-11-12T05:00:00.000Z")), "2026-11-19T05:00:00.000Z");
});

test("which links still work", () => {
  const now = new Date("2026-11-12T12:00:00Z");
  const base = { revoked_at: null, used_at: null, expires_at: null };
  // The agency link: many uses, until it is turned off.
  assert.equal(inviteLive({ ...base, kind: "agency" }, now), true);
  assert.equal(inviteLive({ ...base, kind: "agency", used_at: "2026-11-11T00:00:00Z" }, now), true);
  assert.equal(inviteLive({ ...base, kind: "agency", revoked_at: "2026-11-11T00:00:00Z" }, now), false);
  // One-use links: once, before they expire, unless turned off.
  for (const kind of ["person", "reset"] as const) {
    const fresh = { ...base, kind, expires_at: "2026-11-19T00:00:00Z" };
    assert.equal(inviteLive(fresh, now), true);
    assert.equal(inviteLive({ ...fresh, used_at: "2026-11-12T11:00:00Z" }, now), false);
    assert.equal(inviteLive({ ...fresh, revoked_at: "2026-11-12T11:00:00Z" }, now), false);
    assert.equal(inviteLive({ ...fresh, expires_at: "2026-11-12T11:59:59Z" }, now), false);
    assert.equal(inviteLive({ ...fresh, expires_at: "2026-11-12T12:00:00Z" }, now), false);
  }
});
