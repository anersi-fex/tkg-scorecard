import { test } from "node:test";
import assert from "node:assert/strict";
import { formatPhone, normalizePhone } from "../src/lib/phone";

test("a US number is stored one way, however it was typed", () => {
  for (const typed of ["2485550100", "(248) 555-0100", "248.555.0100", "248-555-0100", " 248 555 0100 ", "1 248 555 0100", "1-248-555-0100", "+1 248 555 0100", "+12485550100", "+1 (248) 555-0100"]) {
    assert.equal(normalizePhone(typed), "+12485550100", typed);
  }
});

test("what is not a phone number is refused", () => {
  for (const typed of ["", "   ", "555-0100", "248555010", "24855501000", "2 248 555 0100", "248 555 0100 ext 5", "call me", "248555O100", "+1 248 555 010", "+1 248 555 01000", "0248555010", "1485550100", "2481550100", "+", "++12485550100", "1".repeat(41)]) {
    assert.equal(normalizePhone(typed), null, typed);
  }
  for (const notText of [null, undefined, 2485550100, {}, []]) assert.equal(normalizePhone(notText), null);
});

test("an international number that already has its plus is kept", () => {
  assert.equal(normalizePhone("+44 20 7946 0958"), "+442079460958");
  assert.equal(normalizePhone("+355 69 123 4567"), "+355691234567");
  // 8 to 15 digits, never starting with 0.
  assert.equal(normalizePhone("+4412345"), null);
  assert.equal(normalizePhone("+1234567890123456"), null);
  assert.equal(normalizePhone("+0442079460958"), null);
});

test("every stored number fits the database's rule", () => {
  const rule = /^\+[1-9][0-9]{7,14}$/; // agents_phone_check in 0005_lineage.sql
  for (const typed of ["2485550100", "+44 20 7946 0958", "+355 69 123 4567", "1 (313) 555 0199"]) assert.match(normalizePhone(typed) ?? "", rule);
});

test("a number reads the way people write it", () => {
  assert.equal(formatPhone("+12485550100"), "(248) 555-0100");
  assert.equal(formatPhone("+442079460958"), "+442079460958");
  assert.equal(formatPhone(null), "");
  assert.equal(formatPhone(undefined), "");
  // Round trip.
  assert.equal(normalizePhone(formatPhone("+13135550199")), "+13135550199");
});
