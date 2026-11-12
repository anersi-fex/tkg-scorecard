import { test } from "node:test";
import assert from "node:assert/strict";

process.env.SESSION_SECRET = "test-secret-test-secret-test-secret-1234";
process.env.OWNER_PASSWORD = "owner-pass-for-tests";
process.env.TEAM_PASSWORD = "team-pass-for-tests";

import { createPersonToken, createSessionToken, readSessionToken, verifySessionToken } from "../src/lib/session";

const AGENT = "3f2b8c1e-9d4a-4c6b-8e21-7a5d0c9b1f34";
const b64url = (bytes: ArrayBuffer) => Buffer.from(bytes).toString("base64url");
/** Signs a payload with the test key, the way session.ts does, to forge tokens the app would never make. */
async function sign(payload: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(process.env.SESSION_SECRET!), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return `${payload}.${b64url(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload)))}`;
}

test("v1: a shared password's token still reads as its role", async () => {
  for (const role of ["owner", "team"] as const) {
    const token = await createSessionToken(role, 60);
    assert.match(token, new RegExp(`^v1\\.${role}\\.\\d+\\.[0-9a-f]{8}\\.[A-Za-z0-9_-]{43}$`));
    assert.equal(await verifySessionToken(token), role);
    assert.deepEqual(await readSessionToken(token), { kind: "shared", role });
  }
});

test("v1: a token this file signs by hand is the token the app makes (the format did not move)", async () => {
  const token = await createSessionToken("team", 600);
  const [v, role, exp, tag] = token.split(".");
  assert.equal(await sign(`${v}.${role}.${exp}.${tag}`), token);
});

test("v1: changing the password signs that role out; the other role stays", async () => {
  const owner = await createSessionToken("owner", 60);
  const team = await createSessionToken("team", 60);
  process.env.TEAM_PASSWORD = "a-new-team-password";
  try {
    assert.equal(await verifySessionToken(team), null);
    assert.equal(await readSessionToken(team), null);
    assert.equal(await verifySessionToken(owner), "owner");
  } finally {
    process.env.TEAM_PASSWORD = "team-pass-for-tests";
  }
  assert.equal(await verifySessionToken(team), "team");
});

test("v1: expiry and tampering are refused", async () => {
  assert.equal(await verifySessionToken(await createSessionToken("team", -1)), null);
  const token = await createSessionToken("team", 60);
  assert.equal(await verifySessionToken(token.replace("v1.team.", "v1.owner.")), null);
  assert.equal(await verifySessionToken(token.slice(0, -2) + (token.endsWith("AA") ? "BB" : "AA")), null);
  for (const junk of [undefined, null, "", "v1", "v1.team", "a.b.c.d.e", `${token}.x`]) assert.equal(await verifySessionToken(junk), null);
});

test("v2: a person's token round-trips with their id and session version", async () => {
  const token = await createPersonToken(AGENT, 3, 60);
  assert.match(token, new RegExp(`^v2\\.${AGENT}\\.\\d+\\.3\\.[A-Za-z0-9_-]{43}$`));
  assert.deepEqual(await readSessionToken(token), { kind: "person", agentId: AGENT, sessionVersion: 3 });
  // The v1 reader (kept for old callers) never accepts a person's token as a shared role.
  assert.equal(await verifySessionToken(token), null);
  // An id typed in capitals is stored lower case.
  assert.deepEqual(await readSessionToken(await createPersonToken(AGENT.toUpperCase(), 1, 60)), { kind: "person", agentId: AGENT, sessionVersion: 1 });
});

test("v2: only a real id and a whole session version can be signed", async () => {
  await assert.rejects(createPersonToken("owner", 1, 60));
  await assert.rejects(createPersonToken("", 1, 60));
  await assert.rejects(createPersonToken(AGENT, 0, 60));
  await assert.rejects(createPersonToken(AGENT, 1.5, 60));
  await assert.rejects(createPersonToken(AGENT, Number.NaN, 60));
});

test("v2: tampering is refused (another person, another version, a later expiry, a cut signature)", async () => {
  const token = await createPersonToken(AGENT, 2, 60);
  const [v, id, exp, ver, sig] = token.split(".");
  const other = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
  assert.equal(await readSessionToken([v, other, exp, ver, sig].join(".")), null);
  assert.equal(await readSessionToken([v, id, exp, "3", sig].join(".")), null);
  assert.equal(await readSessionToken([v, id, String(Number(exp) + 100000), ver, sig].join(".")), null);
  assert.equal(await readSessionToken([v, id, exp, ver, sig.slice(0, -1)].join(".")), null);
  assert.equal(await readSessionToken([v, id, exp, ver].join(".")), null);
  assert.equal(await readSessionToken(`${token}.extra`), null);
  assert.equal(await readSessionToken(token.toUpperCase()), null);
});

test("v2: an expired token is refused", async () => {
  assert.equal(await readSessionToken(await createPersonToken(AGENT, 1, -1)), null);
  assert.equal(await readSessionToken(await createPersonToken(AGENT, 1, 0)), null);
});

test("v2: a token signed with another key is refused", async () => {
  const token = await createPersonToken(AGENT, 1, 60);
  const keep = process.env.SESSION_SECRET;
  process.env.SESSION_SECRET = "another-secret-another-secret-another-12";
  try {
    assert.equal(await readSessionToken(token), null);
  } finally {
    process.env.SESSION_SECRET = keep;
  }
  assert.ok(await readSessionToken(token));
});

test("a v1 token relabeled v2, and a v2 token relabeled v1, are refused", async () => {
  const shared = await createSessionToken("owner", 60);
  assert.equal(await readSessionToken(shared.replace(/^v1\./, "v2.")), null);
  const person = await createPersonToken(AGENT, 1, 60);
  assert.equal(await readSessionToken(person.replace(/^v2\./, "v1.")), null);
  assert.equal(await verifySessionToken(person.replace(/^v2\./, "v1.")), null);
});

test("a rightly signed token of the wrong shape is still refused", async () => {
  const exp = Math.floor(Date.now() / 1000) + 60;
  // v2 with a role where the id goes, v2 with a password tag where the version goes, v1 with an id where the role goes.
  assert.equal(await readSessionToken(await sign(`v2.owner.${exp}.1`)), null);
  assert.equal(await readSessionToken(await sign(`v2.${AGENT}.${exp}.0`)), null);
  assert.equal(await readSessionToken(await sign(`v2.${AGENT}.${exp}.abcd1234`)), null);
  assert.equal(await readSessionToken(await sign(`v1.${AGENT}.${exp}.abcd1234`)), null);
  assert.equal(await readSessionToken(await sign(`v3.${AGENT}.${exp}.1`)), null);
  // And the same shapes, signed, are accepted when they are right (the forger above is a fair one).
  assert.deepEqual(await readSessionToken(await sign(`v2.${AGENT}.${exp}.7`)), { kind: "person", agentId: AGENT, sessionVersion: 7 });
});

test("nothing, junk and an oversized cookie read as nobody", async () => {
  for (const junk of [undefined, null, "", "v2", "v2.", "hello", "v2.a.b.c.d", "x".repeat(5000)]) assert.equal(await readSessionToken(junk), null);
});
