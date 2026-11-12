import { test } from "node:test";
import assert from "node:assert/strict";
import { buildOrg } from "../src/lib/org";
import type { Agent } from "../src/lib/types";

const person = (id: string, name: string, upline: string | null, active = true): Agent => ({ id, name, active, sort: 0, pc_licensed: false, upline_id: upline, in_office: true, role: "member" });

/**
 *  top ── ann ── cy ── eve
 *      │      └─ dee (off the board) ── fay
 *      └─ bob ── gus (off the board)
 *  solo (nobody above, nobody under)
 */
const people: Agent[] = [
  person("top", "Tess Okafor", null),
  person("ann", "Ann Lindqvist", "top"),
  person("bob", "Bob Ferreira", "top"),
  person("cy", "Cy Navarro", "ann"),
  person("dee", "Dee Whitlock", "ann", false),
  person("eve", "Eve Castellan", "cy"),
  person("fay", "Fay Morrow", "dee"),
  person("gus", "Gus Halloran", "bob", false),
  person("solo", "Sol Vance", null),
];

test("children, the downline at every level, and a team with its leader", () => {
  const org = buildOrg(people);
  assert.deepEqual(org.childrenOf("top"), ["ann", "bob"]);
  assert.deepEqual(org.childrenOf("eve"), []);
  assert.deepEqual(org.downlineOf("ann").sort(), ["cy", "dee", "eve", "fay"]);
  assert.deepEqual(org.teamOf("ann")[0], "ann");
  assert.equal(org.teamOf("top").length, 8);
  assert.deepEqual(org.teamOf("solo"), ["solo"]);
  assert.deepEqual(org.downlineOf("nobody"), []);
});

test("someone off the board is not one of a team's people, but stays in the tree", () => {
  const org = buildOrg(people);
  // Dee is off the board: Ann's people are Ann, Cy, Eve and Fay (who is under Dee), four of them.
  assert.deepEqual(org.membersOf("ann").sort(), ["ann", "cy", "eve", "fay"]);
  // ...but Dee is still on Ann's team, so her sales this month count for it.
  assert.ok(org.teamOf("ann").includes("dee"));
  // Bob's only person is off the board: Bob is not a leader. Dee still has Fay under her.
  assert.deepEqual(org.leaders().sort(), ["ann", "cy", "dee", "top"]);
  assert.equal(org.isLeader("bob"), false);
  assert.equal(org.isLeader("cy"), true);
});

test("the uplines, nearest first, and names", () => {
  const org = buildOrg(people);
  assert.deepEqual(org.uplineChain("eve"), ["cy", "ann", "top"]);
  assert.deepEqual(org.uplineChain("top"), []);
  assert.equal(org.uplineOf("fay"), "dee");
  assert.equal(org.nameOf("cy"), "Cy Navarro");
  assert.equal(org.nameOf("nobody"), null);
});

test("a move that would make a loop is refused", () => {
  const org = buildOrg(people);
  assert.equal(org.wouldCycle("ann", "ann"), true); // their own upline
  assert.equal(org.wouldCycle("ann", "eve"), true); // under someone below them
  assert.equal(org.wouldCycle("top", "fay"), true);
  assert.equal(org.wouldCycle("eve", "bob"), false);
  assert.equal(org.wouldCycle("ann", null), false);
  assert.equal(org.wouldCycle("solo", "top"), false);
});

test("bad data never hangs: a loop, a person who is their own upline, an upline that is gone", () => {
  const loop: Agent[] = [person("a", "Ada", "c"), person("b", "Ben", "a"), person("c", "Cal", "b"), person("me", "Mel", "me"), person("lost", "Lou", "ghost")];
  const org = buildOrg(loop);
  assert.deepEqual(org.downlineOf("a").sort(), ["b", "c"]);
  assert.deepEqual(org.teamOf("b").sort(), ["a", "b", "c"]);
  assert.deepEqual(org.uplineChain("a"), ["c", "b"]);
  assert.deepEqual(org.leaders().sort(), ["a", "b", "c"]);
  assert.equal(org.uplineOf("me"), null);
  assert.deepEqual(org.downlineOf("me"), []);
  assert.equal(org.uplineOf("lost"), null);
  assert.deepEqual(org.uplineChain("lost"), []);
});

test("an empty agency", () => {
  const org = buildOrg([]);
  assert.deepEqual(org.leaders(), []);
  assert.deepEqual(org.teamOf("x"), ["x"]);
});
