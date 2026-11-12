import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MSG,
  STEP_FIELDS,
  ageOn,
  autoBillingDay,
  blankForm,
  errorLine,
  firstOpenStep,
  formFromFormData,
  formatPhoneInput,
  premiumText,
  summaryLine,
  validatePolicyForm,
  valuesOf,
  type PolicyForm,
} from "../src/lib/policy-validate";
import { DEFAULT_CARRIER_PRODUCTS, DEFAULT_LEAD_SOURCES, DEFAULT_RATE_CLASSES, carrierProductsFrom } from "../src/lib/policy-types";

/** Log a sale's three steps: the fields, the messages and the formats (src/lib/policy-validate.ts). Invented clients only. */
const ctx = { today: "2026-11-12", carrierProducts: DEFAULT_CARRIER_PRODUCTS, rateClasses: DEFAULT_RATE_CLASSES, leadSources: DEFAULT_LEAD_SOURCES };
const filled = (extra: Partial<PolicyForm> = {}): PolicyForm => ({
  ...blankForm("33333333-3333-4333-8333-333333333333", "2026-11-12"),
  carrier: "AmAm",
  product: "TERM",
  effectiveDate: "2026-12-01",
  monthly: "100",
  rateClass: "Standard",
  coverage: "50,000",
  ss: "yes",
  billingDay: "3rd Wednesday",
  policyNumber: "AA7777777",
  leadSource: "Referral",
  underwriting: true,
  firstName: "Zelda",
  lastName: "Quarry",
  dob: "1958-03-14",
  email: "zelda@example.com",
  phone: "(586) 555-0199",
  address: "12 Elm St, Troy, MI 48083",
  bens: [{ name: "Link Quarry", relationship: "Son" }],
  ...extra,
});

test("an empty first step: every required field says Required, the numbers say Enter at least one.", () => {
  const blank = blankForm("33333333-3333-4333-8333-333333333333", "2026-11-12");
  const e = validatePolicyForm(blank, ctx, STEP_FIELDS[1]);
  assert.deepEqual(Object.keys(e).sort(), ["billingDay", "carrier", "effectiveDate", "leadSource", "monthly", "numbers", "product", "rateClass"].sort());
  assert.ok(Object.values(e).every((m) => m === MSG.required || m === MSG.numbers));
  assert.equal(errorLine(Object.keys(e).length), "Fill in the 8 fields marked below.");
  assert.equal(errorLine(1), "Fill in the field marked below.");
  const e2 = validatePolicyForm(blank, ctx, STEP_FIELDS[2]);
  assert.deepEqual(Object.keys(e2).sort(), ["address", "dob", "email", "firstName", "lastName", "phone"]);
  assert.equal(firstOpenStep(blank, ctx), 1);
  assert.equal(firstOpenStep(filled(), ctx), 3);
  assert.equal(firstOpenStep(filled({ phone: "" }), ctx), 2);
});

test("a filled sale passes, and its values are cleaned: monthly cents, yes as true, Settings' spelling", () => {
  assert.deepEqual(validatePolicyForm(filled(), ctx), {});
  const v = valuesOf(filled({ carrier: "amam", product: "term", email: " zelda@example.com " }), ctx.carrierProducts);
  assert.equal(v.carrier, "AmAm");
  assert.equal(v.product, "TERM");
  assert.equal(v.monthlyCents, 10_000);
  assert.equal(v.coverageCents, 5_000_000);
  assert.equal(v.ssBenefit, true);
  assert.equal(v.client.email, "zelda@example.com");
  assert.deepEqual(v.beneficiaries, [{ name: "Link Quarry", relationship: "Son" }]);
  assert.equal(valuesOf(filled({ noEmail: true })).client.email, "", "no email: none kept");
  assert.equal(valuesOf(filled({ bens: [{ name: " ", relationship: "x" }] })).beneficiaries.length, 0, "an empty row is dropped");
});

test("the demo's messages, field by field", () => {
  const one = (extra: Partial<PolicyForm>) => validatePolicyForm(filled(extra), ctx);
  assert.equal(one({ monthly: "0" }).monthly, MSG.zero);
  assert.equal(one({ monthly: "abc" }).monthly, MSG.monthly);
  assert.equal(one({ coverage: "lots" }).coverage, MSG.coverage);
  assert.equal(one({ carrier: "Acme" }).carrier, MSG.carrier);
  assert.equal(one({ product: "IUL" }).product, MSG.product, "AmAm writes no IUL");
  assert.equal(one({ soldOn: "2026-11-13" }).soldOn, MSG.future);
  assert.equal(one({ soldOn: "2025-09-01" }).soldOn, MSG.tooOld);
  assert.equal(one({ dob: "2026-11-12" }).dob, MSG.dobPast);
  assert.equal(one({ email: "zelda@" }).email, MSG.email);
  assert.deepEqual(one({ email: "", noEmail: true }), {}, "no email box ticked");
  assert.equal(one({ phone: "555-0199" }).phone, MSG.phone);
  assert.deepEqual(one({ phone: "1 (586) 555-0199" }), {}, "a leading 1 is fine");
  assert.equal(one({ policyNumber: "", applicationNumber: "" }).numbers, MSG.numbers);
  assert.deepEqual(one({ policyNumber: "", applicationNumber: "88001234567" }), {});
  assert.equal(one({ ss: "" }).ss, MSG.required);
  assert.equal(one({ billingDay: "5th" }).billingDay, MSG.list, "a Social Security policy bills on a benefit day");
  assert.deepEqual(one({ ss: "no", billingDay: "5th" }), {});
  assert.equal(one({ rateClass: "Platinum" }).rateClass, MSG.list);
  assert.equal(one({ leadSource: "Billboard" }).leadSource, MSG.list);
  assert.equal(one({ billingCycle: "Weekly" }).billingCycle, MSG.list);
  assert.equal(one({ firstName: "x".repeat(61) }).firstName, MSG.long(60));
  assert.equal(one({ bens: Array.from({ length: 11 }, (_, i) => ({ name: `B ${i}`, relationship: "" })) }).bens, MSG.bens);
});

test("fixing a policy: a value that left Settings still passes while it is unchanged", () => {
  const stored = filled({ carrier: "Old Carrier", product: "Old Product", rateClass: "Old Class", leadSource: "Old Source" });
  const keep = { ...stored };
  assert.deepEqual(validatePolicyForm(stored, { ...ctx, keep }), {});
  assert.equal(validatePolicyForm({ ...stored, leadSource: "Other Old" }, { ...ctx, keep }).leadSource, MSG.list);
});

test("the form from a FormData: the names as sent, the fields it carried, beneficiaries as pairs", () => {
  const fd = new FormData();
  fd.set("carrier", "Americo");
  fd.set("monthly", "94.58");
  fd.set("ss", "yes");
  fd.set("underwriting", "on");
  fd.append("benName", "Ann Doe");
  fd.append("benRelationship", "Daughter");
  fd.append("benName", "Bob Doe");
  fd.append("benRelationship", "");
  const { form, present } = formFromFormData(fd);
  assert.equal(form.carrier, "Americo");
  assert.equal(form.ss, "yes");
  assert.equal(form.underwriting, true);
  assert.deepEqual(form.bens, [
    { name: "Ann Doe", relationship: "Daughter" },
    { name: "Bob Doe", relationship: "" },
  ]);
  assert.deepEqual([...present].sort(), ["bens", "carrier", "monthly", "ss", "underwriting"]);
});

test("the helpers the form shows: billing day from the effective date, the phone as typed, age, premium words", () => {
  assert.equal(autoBillingDay("2026-12-01", false), "1st");
  assert.equal(autoBillingDay("2026-12-31", false), "28th");
  assert.equal(autoBillingDay("2026-12-03", true), "3rd of the month");
  assert.equal(autoBillingDay("2026-12-16", true), "3rd Wednesday");
  assert.equal(autoBillingDay("2026-12-02", true), "", "the 1st Wednesday is not a benefit day");
  assert.equal(autoBillingDay("2026-12-15", true), "");
  assert.equal(formatPhoneInput("5865550199"), "(586) 555-0199");
  assert.equal(formatPhoneInput("1586555"), "(158) 655-5");
  assert.equal(formatPhoneInput("15865550199"), "(586) 555-0199");
  assert.equal(formatPhoneInput("58"), "(58");
  assert.equal(ageOn("1952-03-14", "2026-11-12"), 74);
  assert.equal(ageOn("1952-11-13", "2026-11-12"), 73);
  assert.equal(premiumText(9458, 9458 * 12), "$94.58/mo ($1,135/yr)");
  assert.equal(premiumText(null, 300_000), "$3,000/yr");
  assert.equal(summaryLine({ client: valuesOf(filled()).client, carrier: "AmAm", product: "TERM", monthlyCents: 10_000, premiumCents: 120_000 }), "Zelda Quarry · AmAm TERM · $100.00/mo ($1,200/yr)");
  assert.equal(summaryLine({ client: valuesOf(filled()).client, carrier: "AmAm", product: "TERM", monthlyCents: 10_000, premiumCents: 120_000 }, false), "AmAm TERM · $100.00/mo ($1,200/yr)");
});

test("carriers and products from an older carriers list (contract decision 15)", () => {
  assert.deepEqual(carrierProductsFrom(["americo", "Mutual Test"]), { americo: ["WL/FEX", "TERM", "IUL"], "Mutual Test": ["WL/FEX"] });
});
