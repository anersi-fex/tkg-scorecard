import { test } from "node:test";
import assert from "node:assert/strict";
import Module from "node:module";

// passwords.ts is marked server-only (the marker throws outside a server bundle): stand in for it here.
const req = Module.createRequire(__filename);
const marker = req.resolve("server-only");
req.cache[marker] = { id: marker, filename: marker, loaded: true, exports: {} } as unknown as NodeJS.Module;
const { hashPassword, verifyPassword, passwordProblem, burnPasswordCheck } = req("../src/lib/passwords") as typeof import("../src/lib/passwords");

test("a hash has the stored shape: scrypt, N 2^15, r 8, p 3, a 16-byte salt, a 32-byte key", async () => {
  const stored = await hashPassword("correct horse battery");
  const parts = stored.split("$");
  assert.equal(parts.length, 6);
  assert.deepEqual(parts.slice(0, 4), ["scrypt", "32768", "8", "3"]);
  assert.equal(Buffer.from(parts[4], "base64").length, 16);
  assert.equal(Buffer.from(parts[5], "base64").length, 32);
  assert.ok(!stored.includes("correct horse"));
});

test("the right password verifies; a wrong one, a near one and an empty one do not", async () => {
  const stored = await hashPassword("correct horse battery");
  assert.equal(await verifyPassword("correct horse battery", stored), true);
  assert.equal(await verifyPassword("correct horse batterY", stored), false);
  assert.equal(await verifyPassword("correct horse battery ", stored), false);
  assert.equal(await verifyPassword("", stored), false);
});

test("the same password hashes differently each time (a fresh salt), and both verify", async () => {
  const [a, b] = await Promise.all([hashPassword("same-password-1"), hashPassword("same-password-1")]);
  assert.notEqual(a, b);
  assert.equal(await verifyPassword("same-password-1", a), true);
  assert.equal(await verifyPassword("same-password-1", b), true);
});

test("a hash made with other settings still verifies (the settings ride in the stored value)", async () => {
  const { scryptSync } = req("node:crypto") as typeof import("node:crypto");
  const salt = Buffer.from("0123456789abcdef");
  const key = scryptSync("older-password", salt, 32, { N: 2 ** 14, r: 8, p: 1 });
  const stored = `scrypt$16384$8$1$${salt.toString("base64")}$${key.toString("base64")}`;
  assert.equal(await verifyPassword("older-password", stored), true);
  assert.equal(await verifyPassword("older-passwore", stored), false);
});

test("a malformed stored value is false, never a throw", async () => {
  const good = await hashPassword("a-good-password");
  const [, n, r, p, salt, hash] = good.split("$");
  const bad: unknown[] = [
    null,
    undefined,
    "",
    "plain-text-password",
    "a-good-password",
    `bcrypt$${n}$${r}$${p}$${salt}$${hash}`,
    `scrypt$${n}$${r}$${p}$${salt}`,
    `scrypt$${n}$${r}$${p}$${salt}$${hash}$extra`,
    `scrypt$0$${r}$${p}$${salt}$${hash}`,
    `scrypt$32769$${r}$${p}$${salt}$${hash}`,
    `scrypt$1073741824$${r}$${p}$${salt}$${hash}`,
    `scrypt$${n}$0$${p}$${salt}$${hash}`,
    `scrypt$${n}$${r}$99$${salt}$${hash}`,
    `scrypt$${n}$${r}$${p}$$${hash}`,
    `scrypt$${n}$${r}$${p}$${salt}$`,
    `scrypt$${n}$${r}$${p}$not base64!$${hash}`,
    `scrypt$-1$${r}$${p}$${salt}$${hash}`,
    `scrypt$1e5$${r}$${p}$${salt}$${hash}`,
    42,
    {},
    "x".repeat(5000),
  ];
  for (const stored of bad) assert.equal(await verifyPassword("a-good-password", stored as string), false, String(stored).slice(0, 40));
  // A changed salt or a changed hash is simply a wrong password.
  assert.equal(await verifyPassword("a-good-password", `scrypt$${n}$${r}$${p}$${Buffer.from("fedcba9876543210").toString("base64")}$${hash}`), false);
});

test("the dummy check for an unknown number never throws", async () => {
  await burnPasswordCheck("whatever they typed");
  await burnPasswordCheck("");
});

test("a new password is 8 to 200 characters, said in plain words", () => {
  assert.equal(passwordProblem("12345678"), null);
  assert.equal(passwordProblem("x".repeat(200)), null);
  assert.match(passwordProblem("1234567") ?? "", /8 characters/);
  assert.match(passwordProblem("x".repeat(201)) ?? "", /200/);
  assert.ok(passwordProblem(""));
  assert.ok(passwordProblem(undefined));
  assert.ok(passwordProblem(12345678));
});
