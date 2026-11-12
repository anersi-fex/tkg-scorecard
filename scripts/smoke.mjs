// End-to-end smoke test against a running app (invented people and invented clients only). It
// walks the release the way an agency meets it: the owner signs in with the owner password, adds
// people, sets a goal, sends the join link; people join and sign in with their own number; Log a
// sale's three steps (policy, client, review) and the policy page that keeps the sale afterwards;
// who sees which policy and its client (an agent their own, a manager their confirmed team, an
// admin everyone, the shared team password none); who may change what and for how long (the
// first 15 minutes, a manager's status, underwriting and notes, an admin's past month that asks the
// owner); the Scoreboard, the teams and the office group checked against the sales the test
// logged; the TV's screens, its rotation and its feed stamp; that no client detail reaches the TV,
// its feed, the Scoreboard or its file; the owner's P&C switch (off by default: no screen may name
// P&C before it is turned on or after it is turned off again); and last a full office, 47 people,
// on Home, the phone and the TV. Along the way: the sign-in limits the way an office meets them
// (everybody behind one address: each form keeps its own count, and tries sent at the same moment
// are counted), the join card's "Already on the board? Tap your name.", a joiner who waits for
// their upline to confirm them, what ends with a place on the board or an admin's level (sessions
// and one-time links), and a goal or an upline change reaching the TV within a poll. Screenshots
// go to test-results/. With no LOG_TOKEN the Shortcut steps are skipped and the numbers are
// smaller; everything else still runs.
// Start the server fresh for each run: its own memory keeps wrong tries for 15 minutes.
// Run it on a fresh database (psql must be on the PATH: the 15-minute locks are tested by moving a
// sale's created_at back, through LOCAL_DB_URL from .local-db/env):
//   scripts/local-db/start.sh --reset
//   set -a; . .local-db/env; set +a
//   OWNER_PASSWORD=owner-pass TEAM_PASSWORD=team-pass LOG_TOKEN=abcdefghijklmnop APP_URL=http://localhost:3000 npm run build && npm start
//   APP=http://localhost:3000 OWNER_PASSWORD=owner-pass TEAM_PASSWORD=team-pass LOG_TOKEN=... node scripts/smoke.mjs
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";

// Playwright from the project, else a global install (NODE_PATH), else PLAYWRIGHT_DIR.
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_DIR ?? "playwright");

const APP = process.env.APP ?? "http://localhost:3000";
const OWNER = process.env.OWNER_PASSWORD ?? "owner-pass";
const TEAM = process.env.TEAM_PASSWORD ?? "team-pass";
const TOKEN = process.env.LOG_TOKEN ?? "";
const AGENCY = "Lineage Financial";
const OUT = "test-results";
mkdirSync(OUT, { recursive: true });
const started = Date.now();

// The local test database itself (scripts/local-db/start.sh writes LOCAL_DB_URL into .local-db/env).
const DB_URL =
  process.env.LOCAL_DB_URL ??
  (() => {
    try {
      return readFileSync(".local-db/env", "utf8").match(/^LOCAL_DB_URL=(.+)$/m)?.[1]?.trim() ?? "";
    } catch {
      return "";
    }
  })();
/** One SQL statement on the local test database, its rows as psql prints them ("a|b" per line). */
const sql = (statement) => {
  if (!DB_URL) throw new Error("LOCAL_DB_URL is not set (source .local-db/env)");
  return execFileSync("psql", [DB_URL, "-X", "-q", "-At", "-v", "ON_ERROR_STOP=1", "-c", statement], { encoding: "utf8" }).trim();
};
/** Moves a sale's logging time back past the 15 minutes it stays its logger's. */
const ageSale = (id, minutes = 20) => sql(`update sales set created_at = now() - interval '${Number(minutes)} minutes' where id = '${String(id).replace(/[^0-9a-f-]/gi, "")}'`);

let failures = 0;
let checks = 0;
const check = (ok, what) => {
  checks++;
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failures++;
};
/** True once fn() holds on the page, false after ms. */
const settles = async (page, fn, ms, arg = null) => {
  try {
    await page.waitForFunction(fn, arg, { timeout: ms });
    return true;
  } catch {
    return false;
  }
};
/** True once the selector shows, false after ms (a check, where waitForSelector would end the run). */
const appears = async (page, selector, ms = 8000) => {
  try {
    await page.waitForSelector(selector, { timeout: ms });
    return true;
  } catch {
    return false;
  }
};
/**
 * Waits until React has taken over an element. The sign-in, join, profile, settings and sale forms
 * submit through onSubmit: a click that lands before that would send the form the browser's own way.
 */
const hydrated = (page, selector) =>
  page.waitForFunction((s) => {
    const el = document.querySelector(s);
    return !!el && Object.keys(el).some((k) => k.startsWith("__reactProps$") || k.startsWith("__reactFiber$"));
  }, selector);
/** Opens a page of the app and waits for the piece the next step uses. */
const go = async (page, path, selector) => {
  await page.goto(`${APP}${path}`);
  if (selector) {
    await page.waitForSelector(selector);
    await hydrated(page, selector);
  }
};
/** A CSS custom property as the page resolves it on <html> ("#86a6d6"). */
const cssVar = (page, name) => page.evaluate((n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim(), name);

/** Today in Detroit as [year, month, day] (the sandbox's own clock may sit in another zone). */
const detroitToday = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Detroit" }).split("-").map(Number);
/** "November 2026": a month as Home's title names it. */
const monthName = (key) => new Date(Date.UTC(Number(key.slice(0, 4)), Number(key.slice(5, 7)) - 1, 1)).toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });

// Invented people. The first four work in the office; the last three do not. Three join by the
// agency link: Ivy (claims her row by typing her name), Dana (new, under Ivy, in the office) and
// Wes (claims his by tapping it under "Already on the board? Tap your name."). Later Rhea joins
// and picks Nora, a manager, who confirms her.
const NORA = "Nora Vance";
const THEO = "Theo Marsh";
const PRIYA = "Priya Nolan";
const GUS = "Gus Hartley";
const LENA = "Lena Ortiz";
const WES = "Wes Calder";
const IVY = "Ivy Brandt";
const DANA = "Dana Whitlow";
const RHEA = "Rhea Quint";
const PEOPLE = [
  [NORA, true],
  [THEO, true],
  [PRIYA, true],
  [GUS, true],
  [LENA, false],
  [WES, false],
  [IVY, false],
];
const PHONE = { [DANA]: "248 555 0142", [IVY]: "248 555 0143", [PRIYA]: "248 555 0144", [WES]: "248 555 0145", [NORA]: "248 555 0146", [THEO]: "248 555 0147", [RHEA]: "248 555 0148" };
/** Any of the people's cell numbers, in any spelling. */
const CELLS = /555[-\s.)]*01(4[2-8])/;

// What the test logged and still stands, this month, life only: the numbers every screen must show.
// Log a sale takes the monthly premium; the board counts it times twelve.
const ledger = new Map();
const sold = (name, dollars) => {
  const e = ledger.get(name) ?? { cents: 0, policies: 0 };
  e.cents += Math.round(dollars * 100);
  e.policies += 1;
  ledger.set(name, e);
};
const unsold = (name, dollars) => {
  const e = ledger.get(name);
  e.cents -= Math.round(dollars * 100);
  e.policies -= 1;
  if (e.policies === 0) ledger.delete(name);
};
/** The annual dollars a monthly premium counts as on the board (cents x 12, as the server does). */
const yearOf = (monthly) => (Math.round(Number(monthly) * 100) * 12) / 100;
const centsOf = (...names) => names.reduce((s, n) => s + (ledger.get(n)?.cents ?? 0), 0);
const totalCents = () => centsOf(...ledger.keys());
const totalPolicies = () => [...ledger.values()].reduce((s, e) => s + e.policies, 0);
/** The most production among these names (ties never happen in this run). */
const topOf = (names) => names.filter((n) => ledger.has(n)).sort((a, b) => centsOf(b) - centsOf(a))[0];
/** "$12,450": the app's whole dollars. */
const dollars = (cents) => `$${Math.round(cents / 100).toLocaleString("en-US")}`;
/**
 * "$91.6K", "$57K", "$950": the short money on the Scoreboard's top cards, the phone's and the
 * TV's alike (compactDollars in src/lib/views.ts): a tenth, the half rounded up, a zero tenth
 * dropped, and $999.50 and up is "$1K".
 */
const shortMoney = (cents) => {
  const d = Math.abs(cents) / 100;
  const one = (n) => String(Math.round(n * 10) / 10);
  if (d >= 999_950) return `$${one(d / 1_000_000)}M`;
  if (Math.round(d) >= 1000) return `$${one(d / 1_000)}K`;
  return `$${Math.round(d)}`;
};
/** The TV prints what the phone prints (2026-11-12; it used to keep ".0" and round a half down). */
const tvMoney = shortMoney;

// Invented clients, one per sale logged through the form. Every one of their details carries a
// mark (the last name "Quintrell…", the email, the 313 555 07xx number, "Orchard Way", the policy
// and application numbers, the beneficiary), so a page or a file that leaks any of them is caught.
let clientNo = 0;
const newClient = () => {
  const n = ++clientNo;
  const tag = "abcdefghijklmnopqrstuvwxyz"[n % 26] + "abcdefghijklmnopqrstuvwxyz"[Math.floor(n / 26) % 26];
  return {
    first: `Marlo${tag}`,
    last: `Quintrell${tag}`,
    dob: `19${50 + (n % 20)}-0${1 + (n % 9)}-1${n % 10}`,
    email: `marlo.${tag}@quintrell.example`,
    phone: `313555${String(700 + n).padStart(4, "0")}`,
    address: `${n} Orchard Way, Troy MI 48083`,
    policy: `QPN${90000 + n}`,
    application: `QAP${70000 + n}`,
    ben: `Benno Quintrell${tag}`,
  };
};
/** Anything a client typed into Log a sale (names, email, phone, address, numbers, beneficiaries). */
const CLIENT_MARK = /Quintrell|Marlo[a-z]{2}\b|quintrell\.example|555[-\s.)]*07\d\d|5550[67]\d\d|Orchard Way|QPN9\d{4}|QAP7\d{4}/i;
/** The policies logged through the form, by seller: { id, client }. */
const POLICIES = new Map();
const policiesOf = (name) => POLICIES.get(name) ?? [];
const dropPolicy = (name, id) => POLICIES.set(name, policiesOf(name).filter((p) => p.id !== id));

// Words no screen may show while the owner's P&C switch is off (the contract's decision 8).
const PC_WORDS = /P&C|agency total|life \+ P&C/i;
/**
 * What the page says to a person: the words on screen, the page's title, and the labels a screen
 * reader speaks (aria-label, title, placeholder, alt). Left out: the owner's own row of Settings,
 * the one switch that names P&C.
 */
const shownText = (page) =>
  page.evaluate(() => {
    const own = document.querySelector("[data-other-lines]");
    const was = own ? own.style.display : "";
    if (own) own.style.display = "none";
    const text = document.body.innerText;
    if (own) own.style.display = was;
    const spoken = [...document.querySelectorAll("[aria-label], [title], [placeholder], [alt]")]
      .filter((el) => !own || !own.contains(el))
      .map((el) => ["aria-label", "title", "placeholder", "alt"].map((a) => el.getAttribute(a) ?? "").join(" "))
      .join("\n");
    return [document.title, text, spoken].join("\n");
  });
const saysNoPc = async (page, what) => {
  const text = await shownText(page);
  const hit = text.match(PC_WORDS);
  check(!hit, `${what} says nothing about P&C or an agency total${hit ? ` (found "${hit[0]}")` : ""}`);
};

/** The shared passwords: the form behind ?way=team (plain /login opens on the phone form once anyone has a sign-in). */
async function signIn(page, password) {
  await go(page, "/login?way=team", "form[data-way=team]");
  await page.fill("#password", password);
  await Promise.all([page.waitForURL((u) => !u.pathname.startsWith("/login")), page.click("button[type=submit]")]);
}
/** A person's own sign-in: cell number and password. */
async function signInPerson(page, phone, password) {
  await go(page, "/login?way=person", "form[data-way=person]");
  await page.fill("#phone", phone);
  await page.fill("#password", password);
  await Promise.all([page.waitForURL((u) => !u.pathname.startsWith("/login")), page.click("button[type=submit]")]);
}
/** Log a sale: picks who sold it in the picker (left alone when that person is already picked). */
async function pickWho(page, who) {
  // The person kept from the address shows right after React takes over: give that one beat.
  await page.waitForTimeout(150);
  if (((await page.textContent("[data-who]")) ?? "").includes(who)) return;
  await page.click("#log-who");
  await page.fill("input[aria-label='Find who sold it']", who);
  await page.click(`[role=listbox][aria-label='Who sold it'] [role=option]:has-text("${who}")`);
}
/**
 * Log a sale's three steps: 1 the policy (carrier, product, the 1st of next month, the monthly
 * premium, rate class, billing, a policy number, lead source), 2 the client (an invented one, with
 * a beneficiary), 3 the review, then Log sale. `soldOn` sets the submitted date (else the server's
 * today). Lands on /log?done=<id>; returns the policy's id and its client.
 */
async function logPolicy(page, { who = null, monthly, carrier, product = "", soldOn = "", path = "/log" }) {
  await go(page, path, "#premium");
  if (who) await pickWho(page, who);
  await page.selectOption("#carrier", carrier);
  if (product) await page.selectOption("#product", product);
  await page.click(".qchip:has-text('1st of next month')");
  await page.fill("#premium", String(monthly));
  await page.selectOption("#rateClass", "Standard");
  await page.selectOption("#ss", "no");
  await page.selectOption("#billingCycle", "Monthly");
  const c = newClient();
  await page.fill("#policyNumber", c.policy);
  await page.fill("#applicationNumber", c.application);
  await page.selectOption("#leadSource", "Referral");
  if (soldOn) await page.fill("#soldOn", soldOn);
  await page.click("#log-next");
  await page.waitForSelector(".log-card[data-step='2']");
  await page.fill("#firstName", c.first);
  await page.fill("#lastName", c.last);
  await page.fill("#dob", c.dob);
  await page.fill("#email", c.email);
  await page.fill("#phone", c.phone);
  await page.fill("#address", c.address);
  await page.fill("#ben-0-name", c.ben);
  await page.fill("#ben-0-rel", "Spouse");
  await page.click("#log-next");
  await page.waitForSelector(".log-card[data-step='3']");
  await Promise.all([page.waitForURL((u) => u.searchParams.has("done")), page.click("#log-go")]);
  await page.waitForSelector("[data-log-done]");
  const id = new URL(page.url()).searchParams.get("done");
  return { id, client: c };
}
/** Logs through the form and books it: the ledger (this month's) and the seller's policy list. */
async function logged(page, who, monthly, carrier, product = "", more = {}) {
  const r = await logPolicy(page, { who: more.picker === false ? null : who, monthly, carrier, product, ...more });
  if (!more.soldOn || more.soldOn.slice(0, 7) === new Date().toLocaleDateString("en-CA", { timeZone: "America/Detroit" }).slice(0, 7)) sold(who, yearOf(monthly));
  POLICIES.set(who, [...policiesOf(who), r]);
  return r;
}
/** Opens a policy's page; the answer's status (404 for a policy the viewer may not see). */
async function openPolicy(page, id) {
  const res = await page.goto(`${APP}/policies/${id}`);
  if (res?.status() === 200) await page.waitForSelector("[data-policy]").catch(() => {});
  return res?.status() ?? 0;
}
/** One section of the policy page in Edit: `fill` types the change, then Save; the words the toast says. */
async function editSection(page, title, fill) {
  await hydrated(page, `button[aria-label='Edit ${title}']`);
  await page.click(`button[aria-label='Edit ${title}']`);
  await page.waitForSelector("form.pv-form");
  await fill();
  await page.click("form.pv-form button[type=submit]");
}
/** Take it back / Remove policy on the policy page, with its "Are you sure?". */
async function removeOnPage(page) {
  await hydrated(page, "[data-remove]");
  await page.click("[data-remove]");
  await page.click("[data-confirm-remove]");
}
/** One line of a CSV file the app writes (every text quoted, "" inside a quote). */
const csvCells = (line) => {
  const out = [];
  let i = 0;
  while (i < line.length) {
    if (line[i] === '"') {
      let j = i + 1;
      let s = "";
      while (j < line.length) {
        if (line[j] === '"' && line[j + 1] === '"') {
          s += '"';
          j += 2;
        } else if (line[j] === '"') break;
        else s += line[j++];
      }
      out.push(s);
      i = j + 2;
    } else {
      const k = line.indexOf(",", i);
      const end = k < 0 ? line.length : k;
      out.push(line.slice(i, end));
      i = end + 1;
    }
  }
  if (line.endsWith(",")) out.push("");
  return out;
};
/** The Policies file as this session gets it: the status, the header and the rows (cells). */
async function policiesFile(ctx, query = "") {
  const res = await ctx.request.get(`${APP}/api/policies/export${query}`);
  const text = (await res.text()).replace(/^﻿/, "");
  const lines = text.split("\r\n").filter(Boolean).map(csvCells);
  return { status: res.status(), head: lines[0] ?? [], rows: lines.slice(1), text };
}
/** The tab bar's labels on a phone for this session's cookies. */
async function tabLabels(cookies) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await ctx.addCookies(cookies);
  const pg = await ctx.newPage();
  await pg.goto(`${APP}/`);
  await pg.waitForSelector("nav[data-tabbar]");
  const labels = (await pg.locator("nav[data-tabbar] > div a").allInnerTexts()).map((s) => s.replace(/\s+/g, " ").trim());
  await ctx.close();
  return labels.join(",");
}
/** People: opens one person's editor sheet (found through the search box, so a folded team never hides them). */
async function openEditor(page, name) {
  await go(page, "/team", "input[aria-label='Find a person']");
  await page.fill("input[aria-label='Find a person']", name);
  await page.click(`button[aria-label="Edit ${name}"]`);
  const sheet = page.locator(`[role=dialog][aria-label="Edit ${name}"]`);
  await sheet.waitFor();
  return sheet;
}
/** The level picker on a person's card (Agent, Manager, Admin). */
const roleRadio = (sheet, label) => sheet.locator(`[data-admin-row] [role=radio]:has-text("${label}")`);
/**
 * The request a server action made, so the test can send the same call again as someone else.
 * `has` names a piece of its body when another call (the menu's own count) could come first.
 */
async function actionShot(page, act, has = "") {
  const wait = page.waitForRequest((r) => r.method() === "POST" && "next-action" in r.headers() && (!has || (r.postDataBuffer()?.toString("latin1") ?? "").includes(has)));
  await act();
  const req = await wait;
  return { url: req.url(), headers: await req.allHeaders(), body: req.postDataBuffer() };
}
/** Sends a captured server action call with another session's cookie (the page never offers it to them). */
async function replay(ctx, shot, body, extra = {}) {
  const headers = { origin: new URL(APP).origin, ...extra };
  for (const k of ["next-action", "content-type", "accept", "next-router-state-tree", "next-url"]) if (shot.headers[k]) headers[k] = shot.headers[k];
  const res = await ctx.request.post(shot.url, { headers, data: body ?? shot.body });
  return { status: res.status(), text: await res.text() };
}
/** A captured call's body with one text swapped (an id, an amount), as bytes. */
const swapIn = (shot, from, to) => Buffer.from((shot.body?.toString("latin1") ?? "").split(from).join(to), "latin1");

// Every context but the owner's comes from an address of its own, so a wrong try in one place
// (they stay counted for 15 minutes) never adds up with another's.
let lastAddress = Math.floor(Math.random() * 120);
const address = () => `203.0.113.${1 + (lastAddress++ % 250)}`;

const browser = await chromium.launch();
try {
  // --- Signed out: everything bounces to /login, the API refuses ---
  // The signed-out checks come from their own address (a fresh one per run: the lockout they
  // trigger lasts 15 minutes in the server's memory), so it never touches the rest.
  const anon = await browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": `198.51.100.${1 + Math.floor(Math.random() * 250)}` } });
  const a = await anon.newPage();
  await a.goto(`${APP}/board`);
  check(a.url().includes("/login") && a.url().includes("next=%2Fboard"), "signed out: /board goes to /login?next=/board");
  const r401 = await anon.request.get(`${APP}/api/board`);
  check(r401.status() === 401, "signed out: /api/board is 401");
  const rNoTok = await anon.request.post(`${APP}/api/sales`, { data: { agent: "Theo", premium: 100 } });
  check(rNoTok.status() === 401, "no token: /api/sales is 401");
  const csv401 = await anon.request.get(`${APP}/api/scoreboard/export`);
  check(csv401.status() === 401, "signed out: the Scoreboard export is 401");
  // The lockup (owner, 2026-11-12: "you can still put 'by tkg' ... just needs to also say Lineage Financial")
  await hydrated(a, "form[data-way]");
  const lockup = await a.evaluate(() => {
    const by = document.querySelector("[data-lockup-by]");
    return { tkg: !!by?.querySelector('svg[aria-label="TKG"]'), agency: by?.querySelector("[data-agency]")?.textContent?.trim() ?? "", by: by?.textContent ?? "", page: document.body.innerText };
  });
  check(lockup.tkg && lockup.agency === AGENCY && lockup.by.includes("by") && lockup.by.includes("×"), `the sign-in page's lockup reads "by TKG × ${AGENCY}" (the TKG mark kept, the agency beside it)`);
  check(lockup.page.includes(`Private to The Koka Group and ${AGENCY}.`), "the sign-in page is private to The Koka Group and the agency");
  check((await a.getAttribute("form[data-way]", "data-way")) === "team" && lockup.page.includes("Sign in the TV"), "the way to the TV opens on the team password");
  await a.fill("#password", "wrong-password");
  await a.click("button[type=submit]");
  await a.waitForSelector("text=That password isn't right");
  check(true, "wrong password is refused");
  // Each try must finish (the form empties the box after a wrong one) before the next one is typed.
  const tryOnce = async (password) => {
    await a.fill("#password", password);
    await a.click("button[type=submit]");
    await a.waitForFunction(() => document.querySelector("#password")?.value === "" && !document.querySelector("form button[type=submit]")?.disabled);
  };
  for (let i = 0; i < 11; i++) await tryOnce("wrong-password");
  await tryOnce(OWNER);
  await a.waitForSelector("text=Too many tries");
  check(true, "12 wrong tries lock that address for 15 minutes, even with the right password");
  const other = await browser.newContext();
  const b = await other.newPage();
  await signIn(b, OWNER);
  check(!b.url().includes("/login"), "another address still signs in");
  await other.close();
  await anon.close();

  // --- The owner (the owner password, as before) ---
  const owner = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
  const o = await owner.newPage();
  const feed = async () => (await owner.request.get(`${APP}/api/board`)).json();
  /** The board feed once fn(json) holds (a save landed), else the last answer. */
  const feedUntil = async (fn, tries = 20) => {
    let json = null;
    for (let i = 0; i < tries; i++) {
      json = await feed();
      if (fn(json)) return json;
      await new Promise((r) => setTimeout(r, 250));
    }
    return json;
  };
  const idOf = async (name) => (await feed()).agents.find((p) => p.name === name)?.id ?? null;
  await signIn(o, OWNER);
  check(o.url() === `${APP}/`, "owner signs in and lands on Home");
  check((await owner.request.get(`${APP}/wrap`)).status() === 404, "the Wrap is gone: /wrap is a 404");
  await o.goto(`${APP}/login?next=/board`);
  check(o.url() === `${APP}/board`, "signed in, /login?next=/board goes straight to the board");
  await o.goto(`${APP}/`);
  await o.screenshot({ path: `${OUT}/01-home-empty.png`, fullPage: true });

  // People: seven people added by hand, four of them in the office
  await go(o, "/team", "#new-name");
  check((await o.textContent("h1")).includes("People"), "the Team page is called People");
  // The office mark starts off (the first person added must not become the whole office group
  // at the top of every board) and then keeps what was set while more people are added.
  check((await o.getAttribute("[data-add-person] [role=switch]", "aria-checked")) === "false", "Add a person starts with the office mark off");
  let officeTaps = 0;
  for (const [name, office] of PEOPLE) {
    await o.waitForFunction(() => document.querySelector("#new-name")?.value === "" && !document.querySelector("#new-name")?.disabled);
    await o.fill("#new-name", name);
    const mark = o.locator("[data-add-person] [role=switch]");
    if (((await mark.getAttribute("aria-checked")) === "true") !== office) {
      await mark.click();
      officeTaps++;
    }
    await o.click("[data-add-person] button[type=submit]");
    await o.waitForSelector(`text=${name} is on the board.`);
  }
  check(officeTaps === 2, `the office mark keeps what was set from one person to the next (${officeTaps} taps for four in the office, then three outside)`);
  const added = await feedUntil((j) => j.agents.length === 7);
  check(added.agents.length === 7 && added.agents.filter((p) => p.inOffice).length === 4, "seven people on the board, four marked in the office");
  // A duplicate is refused
  await o.waitForFunction(() => document.querySelector("#new-name")?.value === "");
  await o.fill("#new-name", THEO.toLowerCase());
  await o.click("[data-add-person] button[type=submit]");
  await o.waitForSelector(`text=${THEO} is already on the board.`);
  check(true, "duplicate name refused");
  const ID = {};
  for (const [name] of PEOPLE) ID[name] = await idOf(name);
  // Nobody has an upline yet: the Teams view says what makes a team, not just that there is none
  await o.goto(`${APP}/scoreboard?who=teams`);
  check((await appears(o, "p[data-empty=no-uplines]", 8000)) && (await o.textContent("p[data-empty=no-uplines]")).includes("Teams show here once people have an upline. Set uplines on the People page."), "with no uplines yet, the Scoreboard's Teams view says that uplines make teams");
  // Goal for one person
  {
    const sheet = await openEditor(o, THEO);
    await sheet.locator("input[name=goal]").fill("30000");
    await sheet.locator("form:has(input[name=goal]) button[type=submit]").click();
    await o.waitForSelector("text=Goal saved");
    check((await feedUntil((j) => j.agents.find((p) => p.id === ID[THEO])?.goalCents === 3_000_000)).agents.find((p) => p.id === ID[THEO])?.goalCents === 3_000_000, "a person's goal saves from their editor");
  }
  await o.screenshot({ path: `${OUT}/02-team.png`, fullPage: true });

  // Settings: team goal and message
  await go(o, "/settings", "input[name=goal]");
  // The goal's save call is kept: a member sends the very same call further down and must be refused.
  const goalShot = await actionShot(o, async () => {
    await o.locator("input[name=goal]").first().fill("150000");
    await o.locator("form:has(input[name=goal])").first().locator("button[type=submit]").click();
  }, "150000"); // the goal's own call, not another action that may fire first
  await o.waitForSelector("text=Goal saved. The board shows it now.");
  check((await o.locator("input[name=pc_goal]").count()) === 0 && (await o.locator("[role=radiogroup][aria-label='P&C color']").count()) === 0, "Settings has no P&C goal and no P&C color while the P&C board is off");
  await o.fill("#message", "Finish strong. Every policy counts.");
  await o.locator("form:has(#message) button[type=submit]").click();
  await o.waitForSelector("text=Saved. The board updates");
  check((await o.getAttribute("html", "data-colorway")) === "crimson", "Crimson is the default colorway");
  await o.click("[role=radiogroup][aria-label=Colorway] [data-colorway=emerald]");
  await o.waitForSelector("text=Saved. The TV changes");
  await o.goto(`${APP}/`);
  check((await o.getAttribute("html", "data-colorway")) === "emerald", "the colorway setting colors the next screen");
  check((await feed()).colorway === "emerald", "the board feed carries the colorway");
  await go(o, "/settings", "input[name=goal]");
  await o.click("[role=radiogroup][aria-label=Colorway] [data-colorway=crimson]");
  await o.waitForSelector("text=Saved. The TV changes");
  // TV look: dark by default, Light saved on tap, carried by the feed (the TV checks below)
  const tvLook = "[role=radiogroup][aria-label='TV look']";
  check((await o.getAttribute(`${tvLook} [role=radio][aria-checked=true]`, "aria-checked")) === "true" && (await o.textContent(`${tvLook} [role=radio][aria-checked=true]`)).includes("Dark"), "the TV look starts on Dark");
  check((await o.getAttribute("html", "data-board-theme")) === "dark", "the page carries the TV look for the pre-paint script");
  await o.click(`${tvLook} [role=radio]:has-text('Light')`);
  check((await feedUntil((j) => j.boardTheme === "light")).boardTheme === "light", "the board feed carries the TV look (light)");
  // TV screens (2026-11-12): rotate the screens, or keep the TV on one; Rotate to start
  const tvScreens = "[role=radiogroup][aria-label='TV screens']";
  const tvScreen = (label) => `${tvScreens} [role=radio]:has(span:text-is("${label}"))`;
  const screenRows = (await o.locator(`${tvScreens} [role=radio] span.min-w-0 > span:first-child`).allTextContents()).map((s) => s.trim());
  check(screenRows.join(",") === "Rotate,Leaderboard,Scoreboard,Production,Teams" && (await o.textContent(`${tvScreens} [role=radio][aria-checked=true]`)).includes("Rotate"), `Settings offers the TV's screens (Rotate, Leaderboard, Scoreboard, Production, Teams), Rotate to start (${screenRows.join(", ")})`);
  check((await feed()).tvScreens === "rotate", "the board feed carries the TV screens setting");
  // Sale sound (2026-11-04): the owner's four sounds plus Off, a play button each, picked on a tap, carried by the feed
  const soundRows = "[role=radiogroup][aria-label='Sale sound']";
  check((await o.locator(`${soundRows} [role=radio]`).count()) === 5 && (await o.locator(`${soundRows} button[aria-label^='Play ']`).count()) === 4, "Settings offers four sale sounds and Off, each sound with a play button");
  check((await o.textContent(`${soundRows} [role=radio][aria-checked=true]`)).includes("Cash register"), "the cash register is the sale sound to start");
  await o.click(`${soundRows} [role=radio]:has-text('Air horn')`);
  await o.waitForSelector("text=Saved. The TV plays it on the next sale.");
  check((await feedUntil((j) => j.sound === "air-horn")).sound === "air-horn", "the board feed carries the sale sound (air horn)");
  for (const f of ["register", "air-horn", "guitar-riff", "upbeat-intro"]) {
    const r = await owner.request.get(`${APP}/sounds/${f}.mp3`);
    check(r.ok() && /audio\/mpeg/.test(r.headers()["content-type"] ?? ""), `the ${f} sound is served (${r.status()})`);
  }
  await o.screenshot({ path: `${OUT}/03-settings.png`, fullPage: true });

  // --- The join link (owner, 2026-11-12: "send everyone something, and it automatically makes them sign up") ---
  await go(o, "/team", "#new-name");
  const joinUrl = ((await o.textContent("[data-join-card] [data-link-box] code")) ?? "").trim();
  const joinPath = joinUrl.startsWith("http") ? new URL(joinUrl).pathname : joinUrl;
  check(/^\/join\/[A-Za-z0-9_-]{16,}$/.test(joinPath), "the owner's People page shows the join link");
  const newVisitor = () => browser.newContext({ viewport: { width: 1280, height: 900 }, extraHTTPHeaders: { "x-forwarded-for": address() } });
  const dana = await newVisitor();
  const d = await dana.newPage();
  await go(d, joinPath, "form[data-join=agency]");
  const joinCard = await d.evaluate(() => ({ h1: document.querySelector("h1")?.textContent ?? "", tkg: !!document.querySelector('[data-lockup-by] svg[aria-label="TKG"]'), agency: document.querySelector("[data-lockup-by] [data-agency]")?.textContent?.trim() }));
  check(joinCard.h1 === `Join ${AGENCY} on Scorecard` && joinCard.tkg && joinCard.agency === AGENCY, "signed out, the link opens the join page with the agency's name");
  await d.screenshot({ path: `${OUT}/16-join.png`, fullPage: true });
  {
    const bad = await dana.newPage();
    await bad.goto(`${APP}/join/not-a-real-link-0000000000000000`);
    const closed = await bad.evaluate(() => ({ h1: document.querySelector("[data-join=closed] h1")?.textContent ?? "", all: document.querySelector("[data-join=closed]")?.textContent ?? "", form: !!document.querySelector("form[data-join]") }));
    check(closed.h1 === "This link isn't good anymore." && closed.all.includes("Ask for a new one.") && !closed.form, "a bad link shows the \"isn't good anymore\" card and no form");
    await bad.close();
  }
  // Joining with the name of someone already on the board who has no sign-in claims that row. Ivy
  // joins before Dana picks her as an upline: a row with someone under it is no longer claimed by
  // a typed name (it would open that person's clients), only through its own one-time link.
  const ivy = await newVisitor();
  const iv = await ivy.newPage();
  await go(iv, joinPath, "form[data-join=agency]");
  // The card lists the people an admin already added who have no sign-in yet (names only), so
  // nobody comes on a second time under another spelling.
  const claimNames = (page) => page.locator("[data-claim] button[data-claim-name]").evaluateAll((els) => els.map((e) => e.getAttribute("data-claim-name")));
  const waiting = [GUS, IVY, LENA, NORA, PRIYA, THEO, WES].sort((x, y) => x.localeCompare(y));
  check((await iv.getAttribute("[data-claim]", "data-claim")) === "chips" && (await iv.textContent("[data-claim]")).includes("Already on the board? Tap your name.") && (await claimNames(iv)).join() === waiting.join(), `the join card asks "Already on the board? Tap your name." over the people with no sign-in yet, A to Z (${(await claimNames(iv)).length} names, no ${DANA})`);
  await iv.fill("#name", IVY.toLowerCase());
  check((await appears(iv, "[data-claim-chosen]", 3000)) && (await iv.getAttribute(`button[data-claim-name="${IVY}"]`, "aria-pressed")) === "true", "typing the board's spelling by hand, in any case, marks that name as hers too");
  await iv.fill("#phone", PHONE[IVY]);
  await iv.click("form[data-join] button:has-text(\"I'm not sure\")");
  await iv.fill("#password", "ivy-first-pass");
  await Promise.all([iv.waitForURL((u) => u.pathname === "/install"), iv.click("form[data-join] button[type=submit]")]);
  check((await iv.textContent("h1")) === "Welcome, Ivy.", "someone already on the board joins under the name they were added with");
  const afterIvy = await feed();
  check(afterIvy.agents.length === 7 && afterIvy.agents.filter((p) => p.name.toLowerCase() === IVY.toLowerCase()).length === 1 && afterIvy.agents.find((p) => p.name === IVY)?.id === ID[IVY], "a name that matches an unclaimed person claims that row (no second Ivy Brandt)");
  // A new person joins: name, cell number, upline, in the office, a password of their own
  await d.fill("#name", DANA);
  await d.fill("#phone", PHONE[DANA]);
  await d.fill("#upline-search", "ivy");
  await d.click(`#upline-list button:has-text("${IVY}")`);
  check((await d.getAttribute("[data-upline]", "data-upline")) === ID[IVY], "the upline is picked by typing a few letters of their name");
  await d.click("form[data-join] button[role=switch]");
  await d.fill("#password", "dana-first-pass");
  await Promise.all([d.waitForURL((u) => u.pathname === "/install"), d.click("form[data-join] button[type=submit]")]);
  await d.waitForSelector("[data-install]:not([data-install=checking])");
  const welcome = await d.evaluate(() => ({ url: location.pathname + location.search, h1: document.querySelector("h1")?.textContent ?? "", text: document.body.innerText, kind: document.querySelector("[data-install]")?.getAttribute("data-install") }));
  check(welcome.url === "/install?welcome=1" && welcome.h1 === "Welcome, Dana." && welcome.text.includes("One last step: put Scorecard on your phone.") && welcome.text.includes("Skip for now"), "the new person lands on /install?welcome=1 with the welcome");
  check(welcome.kind === "computer" && welcome.text.includes("simply bookmark this site") && (await d.locator("[data-address]").count()) === 1, "on a computer the guide is the computer card with the address to open on the phone");
  await d.screenshot({ path: `${OUT}/17-install-welcome.png`, fullPage: true });
  const afterDana = await feedUntil((j) => j.agents.some((p) => p.name === DANA));
  const danaLine = afterDana.agents.find((p) => p.name === DANA);
  ID[DANA] = danaLine?.id ?? null;
  check(afterDana.agents.length === 8 && danaLine?.inOffice === true && danaLine?.uplineId == null, "the new person is on the board and in the office, on nobody's team until the upline they picked is confirmed");
  check(sql(`select upline_id || '|' || upline_confirmed from agents where id = '${ID[DANA]}'`) === `${ID[IVY]}|false`, "the upline picked on the agency link is kept, waiting to be confirmed");
  // The owner confirms her on People ("Wants to join"): then she is on Ivy's team
  await go(o, "/team", "input[aria-label='Find a person']");
  check((await o.locator(`[data-joiners] [data-joiner="${ID[DANA]}"]`).count()) === 1 && (await o.textContent(`[data-joiner="${ID[DANA]}"]`)).includes(`Picked ${IVY} as their upline`), "People shows the owner the joiner who waits to be confirmed, with the upline they picked");
  await o.click(`[data-joiner="${ID[DANA]}"] button:has-text("Confirm")`);
  check((await appears(o, `text=${DANA} is on Ivy's team.`)) && (await feedUntil((j) => j.agents.find((p) => p.id === ID[DANA])?.uplineId === ID[IVY])).agents.find((p) => p.id === ID[DANA])?.uplineId === ID[IVY], "Confirm puts the joiner on the team of the upline they picked");
  check(!JSON.stringify(afterDana).includes("5550142") && !/pass_hash|"phone"/.test(JSON.stringify(afterDana)), "the board feed carries no phone number and no password hash");
  // The phone guide, by phone: the iPhone steps, the Android ones, each detected from the phone itself
  for (const [label, userAgent, kind, lines] of [
    ["an iPhone", "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1", "ios-safari", ["Tap the Share button (a square with an arrow pointing up).", "If you don't see it, tap the three dots first."]],
    ["an Android phone", "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36", "android-chrome", ["Tap the three dots in the corner of the screen."]],
  ]) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent });
    await ctx.addCookies(await dana.cookies());
    const g = await ctx.newPage();
    await g.goto(`${APP}/install`);
    await g.waitForSelector("[data-install]:not([data-install=checking])");
    const guide = await g.evaluate(() => ({ kind: document.querySelector("[data-install]")?.getAttribute("data-install"), taps: document.querySelector("[data-taps]")?.textContent?.trim() ?? "", text: document.body.innerText }));
    check(guide.kind === kind && lines.every((l) => guide.text.includes(l)) && guide.taps.startsWith("3"), `/install shows the ${kind === "ios-safari" ? "iPhone" : "Android"} steps on ${label}, with the number of taps (${guide.kind}, ${guide.taps})`);
    if (kind === "ios-safari") {
      await g.click("[data-step='1'] [data-next]");
      check(await appears(g, "[data-step='2'][aria-current=step] >> text=Scroll down and tap Add to Home Screen.", 3000), "the guide moves to the next step on a tap");
      await g.screenshot({ path: `${OUT}/17b-install-iphone.png`, fullPage: true });
    }
    await ctx.close();
  }
  // Wes starts to type his name another way, then taps it on the card: the tap puts the board's
  // own spelling in the box, and the join claims his row.
  {
    const wes = await newVisitor();
    const w = await wes.newPage();
    await go(w, joinPath, "form[data-join=agency]");
    const left = await claimNames(w);
    check(left.join() === waiting.filter((n) => n !== IVY).join(), `someone who has a sign-in now is off the card's list (${left.length} names, no ${IVY})`);
    await w.fill("#name", "Wesley Calder");
    const typed = { chosen: await w.locator("[data-claim-chosen]").count(), pressed: await w.getAttribute(`button[data-claim-name="${WES}"]`, "aria-pressed") };
    await w.click(`button[data-claim-name="${WES}"]`);
    check(typed.chosen === 0 && typed.pressed === "false" && (await w.inputValue("#name")) === WES && (await w.getAttribute(`button[data-claim-name="${WES}"]`, "aria-pressed")) === "true" && ((await w.textContent("[data-claim-chosen]")) ?? "").includes("That's you on the board. Your numbers stay with you."), "a tap on a name puts the board's own spelling in the name box and says the numbers stay");
    await w.screenshot({ path: `${OUT}/16b-join-chips.png`, fullPage: true });
    await w.fill("#phone", PHONE[WES]);
    await w.click("form[data-join] button:has-text(\"I'm not sure\")");
    await w.fill("#password", "wes-first-pass");
    await Promise.all([w.waitForURL((u) => u.pathname === "/install"), w.click("form[data-join] button[type=submit]")]);
    const afterWes = await feed();
    const wesLines = afterWes.agents.filter((p) => /calder/i.test(p.name));
    check((await w.textContent("h1")) === "Welcome, Wes." && afterWes.agents.length === 8 && wesLines.length === 1 && wesLines[0].id === ID[WES] && wesLines[0].name === WES && wesLines[0].inOffice === false, "the tapped name claims the row that was there: no second Wes, and the office mark an admin left stays");
    await wes.close();
  }
  // A number that already has a sign-in is told to sign in; a short password is refused in plain words
  const zed = await newVisitor();
  const z = await zed.newPage();
  await go(z, joinPath, "form[data-join=agency]");
  await z.fill("#name", "Zed Quill");
  await z.fill("#phone", "(248) 555-0142");
  await z.click("form[data-join] button:has-text(\"I'm not sure\")");
  await z.fill("#password", "zed-long-enough");
  await z.click("form[data-join] button[type=submit]");
  check(await appears(z, "text=That number already has a sign-in. Sign in instead."), "a cell number that already has a sign-in is told to sign in");
  await z.fill("#phone", "248 555 0199");
  await z.fill("#password", "");
  await z.locator("#password").pressSequentially("short");
  await z.click("form[data-join] button[type=submit]");
  await z.waitForTimeout(400);
  check((await z.evaluate(() => document.querySelector("#password").validity.tooShort)) && new URL(z.url()).pathname === joinPath, "a typed password under 8 characters never leaves the join card (the phone itself says to make it longer)");
  // The same refusal from the server, in its own words (the box filled without typing, as a password manager does)
  await z.evaluate(() => (document.querySelector("#password").value = "tiny1"));
  await z.click("form[data-join] button[type=submit]");
  check(await appears(z, "text=Use 8 characters or more for the password."), "the server refuses a short password in plain words");
  check((await feed()).agents.length === 8, "neither refused join added anybody");
  await zed.close();
  await ivy.close();

  // Sign out, then sign in with the phone number and the password
  await d.goto(`${APP}/`);
  await d.click("button[aria-controls='account-menu']");
  check((await d.textContent("#account-menu")).includes(DANA), "the initials menu names the person signed in");
  await Promise.all([d.waitForURL(`${APP}/login`), d.click("#account-menu button:has-text('Sign out')")]);
  await hydrated(d, "form[data-way]");
  check((await d.getAttribute("form[data-way]", "data-way")) === "person" && (await d.locator("#phone").count()) === 1, "once someone has a sign-in, the sign-in page opens on cell number and password");
  check((await d.innerText("body")).includes("New here? Open the join link you were sent."), "the sign-in page points a new person to the join link");
  await d.fill("#phone", PHONE[DANA]);
  await d.fill("#password", "not-her-password");
  await d.click("button[type=submit]");
  check(await appears(d, "text=That phone number and password don't match."), "a wrong password says one neutral line");
  check((await d.inputValue("#phone")) === PHONE[DANA], "a wrong try keeps the number that was typed");
  await d.fill("#password", "dana-first-pass");
  await Promise.all([d.waitForURL(`${APP}/`), d.click("button[type=submit]")]);
  check(d.url() === `${APP}/`, "the phone number and the password sign in");

  // Your profile: what is there, a new password, Sign out everywhere
  await go(d, "/me", "form[data-me=about]");
  const me = await d.evaluate(() => ({ name: document.querySelector("#me-name")?.value, phone: document.querySelector("#me-phone")?.value, upline: document.querySelector("[data-me=upline]")?.textContent ?? "", office: document.querySelector("[role=switch][aria-label='I work in the office']")?.getAttribute("aria-checked") }));
  check(me.name === DANA && me.phone === "(248) 555-0142" && me.upline.includes(IVY) && me.office === "true", "the profile shows the name, the cell number, the upline and the office mark");
  await d.screenshot({ path: `${OUT}/18-me.png`, fullPage: true });
  await hydrated(d, "form[data-me=password]");
  await d.fill("#me-current", "dana-first-pass");
  await d.fill("#me-password", "dana-second-pass");
  await d.press("#me-password", "Enter");
  check(await appears(d, "text=Password changed. Your other devices are signed out."), "change password works");
  await d.goto(`${APP}/`);
  check(d.url() === `${APP}/`, "the device that changed the password stays signed in");
  // A second device signs in with the new password; the old one no longer works
  const dana2 = await browser.newContext({ viewport: { width: 1280, height: 900 }, extraHTTPHeaders: { "x-forwarded-for": address() } });
  const d2 = await dana2.newPage();
  await go(d2, "/login?way=person", "form[data-way=person]");
  await d2.fill("#phone", PHONE[DANA]);
  await d2.fill("#password", "dana-first-pass");
  await d2.click("button[type=submit]");
  check(await appears(d2, "text=That phone number and password don't match."), "the old password stops working");
  await d2.fill("#password", "dana-second-pass");
  await Promise.all([d2.waitForURL(`${APP}/`), d2.click("button[type=submit]")]);
  check(d2.url() === `${APP}/`, "the new password signs in on another device");
  await go(d, "/me", "button[data-me=signout]");
  d.once("dialog", (dlg) => dlg.accept());
  await Promise.all([d.waitForURL((u) => u.pathname === "/login"), d.click("button[data-me=signout]")]);
  await d2.goto(`${APP}/`);
  check(new URL(d.url()).pathname === "/login" && new URL(d2.url()).pathname === "/login", "Sign out everywhere ends this session and the other device's");
  check((await dana2.request.get(`${APP}/api/board`)).status() === 401, "the other device's session no longer reads the board feed");
  await dana2.close();
  await signInPerson(d, PHONE[DANA], "dana-second-pass");

  // A tap that lands before the page's script has loaded (a slow phone on a weak signal) sends a
  // form the browser's own way. A cell number or a password must never land in the address,
  // where the phone's history and the server's request log would keep it.
  {
    const early = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 390, height: 844 }, extraHTTPHeaders: { "x-forwarded-for": address() } });
    const e = await early.newPage();
    /** Sends the form with the page's script off and says how the browser sent it and where it landed. */
    const sendEarly = async (button) => {
      const sent = e.waitForRequest((r) => r.isNavigationRequest());
      await e.click(button);
      const method = (await sent).method();
      await e.waitForLoadState("load");
      return { method, clean: !/555[-\s%+0-9A-F]*01(77|78)|too-early/i.test(e.url()) && !new URL(e.url()).search.includes("password") };
    };
    await e.goto(`${APP}/login?way=person`);
    await e.fill("#phone", "248 555 0177");
    await e.fill("#password", "typed-too-early");
    const earlySignIn = await sendEarly("form[data-way] button[type=submit]");
    check(earlySignIn.method === "POST" && earlySignIn.clean && (await e.locator("form[data-way=person] #password").count()) === 1 && new URL(e.url()).pathname === "/login", `a tap on Sign in before the page is ready keeps the number and the password out of the address (${earlySignIn.method} ${new URL(e.url()).pathname}${new URL(e.url()).search.slice(0, 40)})`);
    await e.goto(`${APP}/login?way=team`);
    await e.fill("#password", "typed-too-early");
    const earlyTeam = await sendEarly("form[data-way] button[type=submit]");
    check(earlyTeam.method === "POST" && earlyTeam.clean, "the same for the team password's form");
    await e.goto(`${APP}${joinPath}`);
    await e.fill("#name", "Early Tapper");
    await e.fill("#phone", "248 555 0178");
    await e.fill("#password", "typed-too-early");
    const earlyJoin = await sendEarly("form[data-join] button[type=submit]");
    check(earlyJoin.method === "POST" && earlyJoin.clean && (await e.locator("form[data-join=agency]").count()) === 1 && (await feed()).agents.length === 8, "a tap on Join before the page is ready keeps them out of the address too, and adds nobody");
    await early.addCookies(await dana.cookies());
    await e.goto(`${APP}/me`);
    await e.fill("#me-current", "too-early-current");
    await e.fill("#me-password", "too-early-new-pass");
    const earlyMe = await sendEarly("form[data-me=password] button[type=submit]");
    check(earlyMe.method === "POST" && earlyMe.clean && new URL(e.url()).pathname === "/me", "and so does Change password on the profile");
    await early.close();
  }

  // --- The sign-in limits, the way an office meets them: everybody behind one address ---
  // (owner, 2026-11-12: "the ones in the office are like a group of like 27": they all sign in for
  // the first time from one network, next to the TV.) Each form keeps a count of its own, a try is
  // counted before it is looked at, and a number nobody has is typed here, so no account is touched.
  {
    const PERSONAL_LIMIT = 60;
    const SHARED_LIMIT = 10;
    const NO_MATCH = "That phone number and password don't match.";
    const CLOSED_PERSONAL = "Too many tries from this network. Wait a few minutes, or ask an admin for a new sign-in link.";
    const at = (addr) => browser.newContext({ viewport: { width: 1280, height: 900 }, extraHTTPHeaders: { "x-forwarded-for": addr } });
    /** Types a shared password on the team form: true once it signed in, false when the form answered instead. */
    /** True once the page has left /login; false when the form said to wait, or nothing came. */
    const leavesLogin = async (page) =>
      (await Promise.race([
        page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 10000 }).then(() => "in", () => "no"),
        page.waitForSelector("text=Too many tries", { timeout: 10000 }).then(() => "wait", () => "no"),
      ])) === "in";
    const sharedSignsIn = async (page, password) => {
      await go(page, "/login?way=team", "form[data-way=team]");
      await page.fill("#password", password);
      await page.click("button[type=submit]");
      return leavesLogin(page);
    };
    const office = address();
    const desk = await at(office);
    const k = await desk.newPage();
    await go(k, "/login?way=person", "form[data-way=person]");
    await k.fill("#phone", "248 555 0190");
    await k.fill("#password", "not-anyones-pass");
    const wrongPersonal = await actionShot(k, () => k.click("button[type=submit]"), "0190");
    let looked = (await appears(k, `text=${NO_MATCH}`)) ? 1 : 0;
    const again = async (ctx, shot, addr) => (await replay(ctx, shot, undefined, { "x-forwarded-for": addr })).text;
    for (let i = 0; i < 9; i++) if ((await again(desk, wrongPersonal, office)).includes(NO_MATCH)) looked++;
    // The TV and a phone on the team password, at the same address
    const tvSide = await at(office);
    const tvp = await tvSide.newPage();
    const teamIn = await sharedSignsIn(tvp, TEAM);
    await tvp.goto(`${APP}/board`);
    check(looked === 10 && teamIn && (await appears(tvp, "main[data-screen]")) && tvp.url() === `${APP}/board`, `ten wrong tries on people's own sign-in (${looked} looked at) leave the team password and the TV's sign-in open for that address`);
    await tvSide.close();
    // The personal form closes at its own limit, 60 for an address: the 61st try is refused whatever was typed
    for (let i = looked; i < PERSONAL_LIMIT; i++) if ((await again(desk, wrongPersonal, office)).includes(NO_MATCH)) looked++;
    const past = await again(desk, wrongPersonal, office);
    await k.fill("#phone", PHONE[IVY]);
    await k.fill("#password", "ivy-first-pass");
    await k.click("button[type=submit]");
    check(looked === PERSONAL_LIMIT && past.includes(CLOSED_PERSONAL) && !past.includes(NO_MATCH) && (await appears(k, `text=${CLOSED_PERSONAL}`)) && new URL(k.url()).pathname === "/login", `the personal form closes at its own limit: ${looked} tries were looked at, and after that even the right password is told to wait`);
    const ownerSide = await at(office);
    const op = await ownerSide.newPage();
    check(await sharedSignsIn(op, OWNER), "while the personal form is closed for an address, the owner password still signs in there");
    await ownerSide.close();
    await desk.close();

    // The other way round, and a burst: thirty wrong shared passwords sent at the same moment
    // from one address. Each is counted before it is looked at, so no more than ten get an answer
    // about the password; the rest are told to wait.
    const lobby = address();
    const guest = await at(lobby);
    const g = await guest.newPage();
    await go(g, "/login?way=team", "form[data-way=team]");
    await g.fill("#password", "wrong-password");
    const wrongShared = await actionShot(g, () => g.click("button[type=submit]"));
    const first = (await appears(g, "text=That password isn't right")) ? 1 : 0;
    const burst = await Promise.all(Array.from({ length: 30 }, () => again(guest, wrongShared, lobby)));
    const answered = first + burst.filter((t) => t.includes("That password isn't right.")).length;
    const waited = burst.filter((t) => t.includes("Too many tries. Wait 15 minutes and try again.")).length;
    check(first === 1 && answered <= SHARED_LIMIT && answered + waited === 31 && waited >= 21, `a burst of wrong tries sent at once is counted: of 31, ${answered} were looked at and ${waited} were told to wait`);
    // Tries that were told to wait are not counted, so the form may still have room: fill it one at a time
    for (let i = 0; i < SHARED_LIMIT; i++) await again(guest, wrongShared, lobby);
    const closedShared = !(await sharedSignsIn(g, TEAM)) && (await g.innerText("body")).includes("Too many tries. Wait 15 minutes and try again.");
    const person = await guest.newPage();
    await go(person, "/login?way=person", "form[data-way=person]");
    await person.fill("#phone", PHONE[IVY]);
    await person.fill("#password", "ivy-first-pass");
    await person.click("button[type=submit]");
    check(closedShared && (await leavesLogin(person)), "ten wrong shared passwords close that form for the address, and a person's own sign-in still works there");
    await guest.close();
  }

  // --- Log a sale in three steps (the owner logs for anyone) ---
  await go(o, "/log", "#premium");
  await o.screenshot({ path: `${OUT}/04-log-empty.png`, fullPage: true });
  check((await o.locator("[role=radiogroup][aria-label='What kind']").count()) === 0, "Log a sale has no Life / P&C switch");
  check(((await o.textContent(".log-progress")) ?? "").includes("Step 1 of 3 · Policy information"), "Log a sale opens on step 1 of 3, Policy information");
  // Each step is checked before the next opens, in the demo's words
  await o.click("#log-next");
  check((await appears(o, ".form-alert:has-text('marked below')", 3000)) && (await o.getAttribute(".log-card", "data-step")) === "1" && (await o.locator(".field-error").count()) >= 5, `Next on an empty step 1 stays there and marks every required field (${(await o.textContent(".form-alert"))?.trim()})`);
  await pickWho(o, THEO);
  await o.selectOption("#carrier", "Americo");
  check((await o.locator("#product option").allTextContents()).join(",") === "Select product,WL/FEX,TERM,IUL", "the product list follows the carrier picked (Americo: WL/FEX, TERM, IUL)");
  await o.selectOption("#product", "TERM");
  await o.fill("#premium", "12.345");
  await o.click("#log-next");
  check((await appears(o, ".field-error:has-text('Enter an amount like 94.58')", 3000)) && (await o.getAttribute(".log-card", "data-step")) === "1", "a bad monthly premium is refused in plain words");
  await o.fill("#premium", "100");
  check(((await o.textContent(".pf-yr")) ?? "").includes("$1,200/yr"), "the yearly amount shows beside the monthly premium, in whole dollars");
  const todayKey = detroitToday().map((n) => String(n).padStart(2, "0")).join("-");
  check((await o.getAttribute("#soldOn", "max")) === todayKey, "the submitted date can't be later than today");
  await o.click(".qchip:has-text('1st of next month')");
  await o.selectOption("#rateClass", "Standard");
  await o.selectOption("#ss", "no");
  await o.selectOption("#billingCycle", "Monthly");
  check(((await o.inputValue("#billingDay")) ?? "") === "1st", "the billing day follows the effective date until it is picked");
  await o.click("#log-next");
  check((await appears(o, ".field-error:has-text('Enter at least one.')", 3000)) && (await o.getAttribute(".log-card", "data-step")) === "1", "step 1 wants a policy or an application number");
  await o.fill("#applicationNumber", "QAP79999");
  await o.selectOption("#leadSource", "Referral");
  await o.click("#log-next");
  await o.waitForSelector(".log-card[data-step='2']");
  await o.click("#log-next");
  check((await appears(o, ".form-alert:has-text('marked below')", 3000)) && (await o.getAttribute(".log-card", "data-step")) === "2", "Next on an empty step 2 stays there: the client's details are needed");
  await o.fill("#email", "not-an-email");
  await o.click("#log-next");
  check(await appears(o, ".field-error:has-text('Enter an email like name@example.com')", 3000), "a bad email is refused in plain words");
  await o.click("button:has-text('Previous')");
  await o.waitForSelector(".log-card[data-step='1']");
  check((await o.inputValue("#premium")) === "100" && (await o.inputValue("#carrier")) === "Americo", "Previous goes back with what was typed kept");
  // Nothing typed into the form is kept in the address or the browser's storage
  check(!/QAP79999|not-an-email/.test(o.url()) && !(await o.evaluate(() => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }))).match(/QAP79999|not-an-email/), "a draft lives in the page only: not in the address, not in the browser's storage");
  const sales = [
    [THEO, "1037.50", "Americo", "TERM"],
    [PRIYA, "683.40", "Foresters", "WL/FEX"],
    [NORA, "1250", "AHL", ""],
    [GUS, "500", "Royal", ""],
    [THEO, "775", "UHL", ""],
    [LENA, "362.50", "AmAm", "TERM"],
  ];
  for (const [who, monthly, carrier, product] of sales) {
    await logged(o, who, monthly, carrier, product);
    if (who === THEO && policiesOf(THEO).length === 1) {
      // The done state, once: where the sale landed, what the TV shows, and the way on
      const done = await o.evaluate(() => ({ text: document.querySelector("[data-log-done]")?.innerText ?? "", open: [...document.querySelectorAll("[data-log-done] a")].map((a) => `${a.textContent?.trim()}>${a.getAttribute("href")}`) }));
      const first = policiesOf(THEO)[0];
      check(done.text.includes("Logged. It's on the board.") && done.text.includes(`${first.client.first} ${first.client.last}`) && done.text.includes("$1,037.50/mo ($12,450/yr)"), "the done state says it's on the board, with the client and the premium (monthly with cents, yearly in whole dollars)");
      check(done.text.includes(`New sale · ${THEO} · $12,450 · Americo`) && done.text.includes("Never the client."), "and what the TV shows: the name, the amount and the carrier, never the client");
      check(done.open.includes(`Open the policy>/policies/${first.id}`) && done.open.some((x) => x.startsWith("Log another>/log")), "with Open the policy and Log another");
      await o.screenshot({ path: `${OUT}/05-log-done.png`, fullPage: true });
    }
  }
  check(policiesOf(THEO).length === 2 && ledger.size === 5, "six sales logged through the three steps, each with a carrier, a product and a client");

  // The policy page: the owner removes one (an admin's Remove), then it is logged again
  {
    const lena = policiesOf(LENA)[0];
    check((await openPolicy(o, lena.id)) === 200, "Open the policy opens the policy's page");
    const page = await o.evaluate(() => ({ h1: document.querySelector("h1")?.textContent ?? "", status: document.querySelector("[data-status]")?.textContent ?? "", history: document.querySelector("[data-sec=history]")?.textContent ?? "", seen: document.querySelector(".pv-seen")?.textContent ?? "" }));
    check(page.h1.includes(`${lena.client.first} ${lena.client.last}`) && page.status.includes("Submitted") && page.history.includes(`Logged the sale for ${LENA}`) && page.seen.includes("Never on the TV."), "the policy page names the client, starts Submitted, and its history says who logged it");
    await o.screenshot({ path: `${OUT}/05b-policy.png`, fullPage: true });
    await removeOnPage(o);
    check((await appears(o, "text=Removed.")) && (await feedUntil((j) => !j.agents.find((p) => p.id === ID[LENA])?.lifeCents)).agents.find((p) => p.id === ID[LENA])?.lifeCents === 0, "the owner removes a policy from its page, and it leaves the board");
    unsold(LENA, yearOf("362.50"));
    dropPolicy(LENA, lena.id);
  }
  // This call (the owner logging for Lena) is kept: a member and the team password send the very same one further down.
  const logShot = await actionShot(o, () => logged(o, LENA, "362.50", "AmAm", "TERM"), '_monthly"');

  await go(o, `/log?agent=${ID[GUS]}`, "#premium");
  check((await o.textContent("[data-who]")).includes(GUS), "a desk link opens Log a sale with the person picked");

  // Home shows the month
  await o.goto(`${APP}/`);
  await o.waitForSelector("[data-kpi=Production] [data-production]");
  const body = await o.innerText("main");
  check((await o.textContent("[data-production]")).trim() === dollars(totalCents()), `team production shows on Home (${(await o.textContent("[data-production]")).trim()}, ${dollars(totalCents())} logged)`);
  check(body.includes("of $150,000"), "goal shows on Home");
  check(((await o.textContent("[data-pace]")) ?? "").includes("On pace for"), "Home says what the month is on pace for");
  check(body.includes(THEO), "leader on Home");
  check((await o.innerText("[data-latest-sales]")).includes("Americo") && (await o.innerText("[data-latest-sales]")).includes("Foresters"), "the sales rows on Home name the carrier");
  check(!CLIENT_MARK.test(await o.content()), "the agency's Home shows no client, not even to the owner");
  check((await o.locator("nav[aria-label=View]").count()) === 0, "Home has no Life / P&C / Total switch");
  await o.screenshot({ path: `${OUT}/06-home.png`, fullPage: true });
  const tick = (await feed()).clock.elapsed > 0;

  // The owner fixes a sale from Home's row menu (the policy page, its Policy section open), then removes it
  {
    const lena = policiesOf(LENA)[0];
    await o.click(`[data-latest-sales] [data-sale="${lena.id}"] button[aria-label=More]`);
    await Promise.all([o.waitForURL((u) => u.pathname === `/policies/${lena.id}`), o.click(`[data-sale-menu="${lena.id}"] a:has-text('Fix this sale')`)]);
    await o.waitForSelector("form.pv-form #pe-premium");
    await hydrated(o, "form.pv-form #pe-premium");
    await o.fill("#pe-premium", "366.67");
    await o.click("form.pv-form button[type=submit]");
    const fixed = await feedUntil((j) => j.agents.find((p) => p.id === ID[LENA])?.lifeCents === Math.round(yearOf("366.67") * 100));
    check((await appears(o, "text=Saved.")) && fixed.agents.find((p) => p.id === ID[LENA])?.lifeCents === Math.round(yearOf("366.67") * 100), "the owner fixes a sale's premium from Home's row menu");
    check(await settles(o, () => (document.querySelector("[data-sec=history]")?.textContent ?? "").includes("Changed premium $362.50/mo → $366.67/mo"), 6000), "the history says what the premium was and what it is now");
    unsold(LENA, yearOf("362.50"));
    sold(LENA, yearOf("366.67"));
    await removeOnPage(o);
    check(await appears(o, "text=Removed."), "owner removed a sale");
    unsold(LENA, yearOf("366.67"));
    dropPolicy(LENA, lena.id);
  }

  // --- An agent: logs for themselves only, takes back their own sale, cannot reach the admin screens ---
  await go(d, "/log", "#premium");
  const mine = await d.evaluate(() => ({ forWho: document.querySelector("[data-logging-for]")?.textContent ?? "", picker: !!document.querySelector("[data-who]") }));
  check(mine.forWho.includes(`Logging for ${DANA}`) && !mine.picker, "an agent's Log a sale is for themselves, with no person picker");
  await d.goto(`${APP}/log?agent=${ID[THEO]}`);
  await d.waitForSelector("#premium");
  check((await d.textContent("[data-logging-for]")).includes(DANA) && (await d.locator("[data-who]").count()) === 0, "someone else's desk link still logs for the agent themselves");
  const danaSale = await logged(d, DANA, "250", "AHL", "", { picker: false });
  await d.goto(`${APP}/`);
  await d.waitForSelector("[data-kpi=Production] [data-production]");
  check((await d.textContent("[data-production]")).trim() === "$3,000" && (await feed()).agents.find((p) => p.id === ID[DANA])?.lifeCents === 300_000, "the agent's sale shows on their Home and on the board, under their own name");
  check((await d.innerText("main")).includes(danaSale.client.last), "an agent's own Home (Me) shows their own client");
  /** A person's newest sale that still stands, read from the database itself. */
  const newestSaleOf = (agentId) => sql(`select id from sales where agent_id = '${agentId}' and deleted_at is null order by created_at desc limit 1`) || null;
  // Her own policy: everything is hers to fix for 15 minutes, and she can take it back
  check((await openPolicy(d, danaSale.id)) === 200, "an agent opens their own policy");
  const ownPage = await d.evaluate(() => ({ edits: [...document.querySelectorAll("button.pv-edit")].map((b) => b.getAttribute("aria-label")), fresh: document.querySelector(".pv-fresh")?.textContent ?? "", remove: document.querySelector("[data-remove]")?.textContent ?? "" }));
  check(["Edit Policy", "Edit Client", "Edit Beneficiaries", "Edit Notes"].every((e) => ownPage.edits.includes(e)) && ownPage.fresh.includes("Just logged") && ownPage.remove.includes("Take it back"), "for 15 minutes the agent may fix anything on it, or take it back");
  // Her own take-back call is kept: it is sent again further down for other people's sales.
  const undoShot = await actionShot(d, () => removeOnPage(d), danaSale.id);
  check((await appears(d, "text=Taken back. It's off the board.")) && (await feedUntil((j) => j.agents.find((p) => p.id === ID[DANA])?.lifeCents === 0)).agents.find((p) => p.id === ID[DANA])?.lifeCents === 0, "an agent takes back their own sale within 15 minutes");
  unsold(DANA, yearOf("250"));
  dropPolicy(DANA, danaSale.id);
  /** The take-back call for another sale, as the body the agent's own call had. */
  const undoBody = (saleId) => swapIn(undoShot, danaSale.id, saleId ?? "");
  // Somebody else's policy: not there for her, and the server refuses the call itself
  const gusId = policiesOf(GUS)[0].id;
  check((await openPolicy(d, gusId)) === 404, "an agent can't open someone else's policy (a 404, the same as one that isn't there)");
  const forGus = await replay(dana, undoShot, undoBody(gusId));
  check(forGus.text.includes("You can take back your own sales only.") && (await feed()).agents.find((p) => p.id === ID[GUS])?.lifeCents === 600_000, "an agent who calls the take-back for someone else's sale directly is refused, and the sale stands");
  // The owner's "log a sale for Lena" call, sent with the agent's session: the server logs it for the agent
  {
    const forLena = await replay(dana, logShot);
    const landed = await feedUntil((j) => j.agents.find((p) => p.id === ID[DANA])?.lifeCents === 435_000);
    check(forLena.text.includes("Logged. It's on the board.") && landed.agents.find((p) => p.id === ID[DANA])?.lifeCents === 435_000 && !landed.agents.find((p) => p.id === ID[LENA])?.lifeCents, "an agent who calls the log action with someone else's name logs the sale for themselves, never for the other person");
    const hers = newestSaleOf(ID[DANA]);
    const back = await replay(dana, undoShot, undoBody(hers));
    check(!!hers && back.text.includes("Taken back.") && (await feedUntil((j) => j.agents.find((p) => p.id === ID[DANA])?.lifeCents === 0)).agents.find((p) => p.id === ID[DANA])?.lifeCents === 0, "and takes it back again");
  }
  await d.goto(`${APP}/settings`);
  await d.waitForURL(`${APP}/`);
  await d.goto(`${APP}/approvals`);
  await d.waitForURL(`${APP}/`);
  check(true, "an agent cannot open Settings or Approvals");
  await d.click("button[aria-controls='account-menu']");
  check((await d.locator("#account-menu a[href='/settings']").count()) === 0 && (await d.locator("#account-menu a[href='/approvals']").count()) === 0 && (await d.locator("#account-menu a[href='/install']").count()) === 1, "an agent's menu has the phone guide and no Settings or Approvals");
  // The goal's save call, sent with the agent's session: refused by the action itself
  const asMember = await replay(dana, goalShot);
  check(asMember.text.includes("Only an admin can do that") && (await feed()).team.goalCents === 15_000_000, `an agent who calls the goal's save action directly is refused and the goal stays (${asMember.status})`);
  await go(d, "/team", "input[aria-label='Find a person']");
  check((await d.locator("[data-join-card]").count()) === 0 && (await d.locator("button[aria-label^='Edit ']").count()) === 0 && (await d.locator("[data-add-person]").count()) === 0, "an agent sees People without the join link, Edit or Add");
  check(!(await d.innerText("body")).includes("555"), "an agent's People page shows no phone number");

  // A sale dated last month counts on last month's board
  const [ty, tm] = detroitToday();
  const lastMonthDay = new Date(Date.UTC(ty, tm - 1, 1) - 86400000 * 3).toISOString().slice(0, 10);
  const lastMonth = lastMonthDay.slice(0, 7);
  const thisMonth = todayKey.slice(0, 7);
  const lastMonthSale = await logged(o, IVY, "64.75", "Newbridge", "", { soldOn: lastMonthDay, path: `/log?agent=${ID[IVY]}` });
  await o.goto(`${APP}/?month=${lastMonth}`);
  await o.waitForSelector("[data-latest-sales]");
  check((await o.innerText("[data-latest-sales]")).includes("$777") && (await o.locator("[data-latest-sales] [data-sale]").count()) === 1, "a past month lists its own sales, with the row menu");
  // A sale dated in the future is refused by the server (the day field's max already stops it in the browser)
  const tomorrow = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
  if (TOKEN) {
    const future = await owner.request.post(`${APP}/api/sales`, { headers: { authorization: `Bearer ${TOKEN}` }, data: { agent: IVY, premium: "5", carrier: "AHL", date: tomorrow } });
    check(future.status() === 400, `a sale dated in the future is refused (${future.status()})`);
  }
  // Past month view
  await o.goto(`${APP}/?month=2026-09`);
  await o.waitForSelector("h1");
  check((await o.textContent("h1")).includes("September 2026"), "past month opens");
  await o.goto(`${APP}/?month=20-99`);
  await o.waitForSelector("h1");
  check((await o.textContent("h1")).includes(monthName(thisMonth)), "bad month falls back to this month");

  // The TV's rotation, part one. Nobody on a team has sold yet (the only team is Ivy's: her sale
  // is last month's and Dana took hers back), so Teams has nothing to show and is skipped.
  const rotation = async (label, order) => {
    const rc = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
    await rc.addCookies(await owner.cookies());
    const r = await rc.newPage();
    // Nothing changes while the rotation is watched: every poll that carries the stamp must come back empty.
    const polls = [];
    r.on("response", (res) => {
      if (res.url().includes("/api/board")) polls.push({ stamped: res.url().includes("stamp="), status: res.status() });
    });
    await r.clock.install();
    await r.goto(`${APP}/board`);
    await r.waitForSelector("main[data-screen]");
    const screenNow = () => r.getAttribute("main", "data-screen");
    // Waited for from this side: the page's own clock is the fake one.
    const becomes = async (want) => {
      for (let i = 0; i < 80; i++) {
        if ((await screenNow()) === want) return true;
        await new Promise((done) => setTimeout(done, 50));
      }
      return false;
    };
    const pills = await r.locator("[data-pill]").evaluateAll((els) => els.map((e) => e.getAttribute("data-pill")).join(","));
    check((await screenNow()) === "life" && pills === order.join(","), `${label}: the rotation starts on the leaderboard, one pill per screen in it (${pills})`);
    check((await r.locator("[data-pill][aria-current=true] .board-timer").count()) === 1, `${label}: the lit pill carries the line that runs out with its time`);
    // The margins leave room for the real seconds that pass while the test itself works.
    await r.clock.runFor(38_000);
    check((await screenNow()) === "life", `${label}: the leaderboard stays its 40 seconds`);
    await r.clock.runFor(3_000);
    for (let i = 1; i <= order.length; i++) {
      const want = order[i % order.length];
      check(await becomes(want), `${label}: then ${want === "life" ? "the leaderboard again" : want}`);
      if (i === order.length) break;
      if (i === 1) {
        await r.clock.runFor(17_000);
        check((await screenNow()) === want, `${label}: each other screen stays its 20 seconds`);
        await r.clock.runFor(3_500);
      } else await r.clock.runFor(20_500);
    }
    await new Promise((done) => setTimeout(done, 400));
    const stamped = polls.filter((x) => x.stamped);
    check(stamped.length >= 3 && stamped.every((x) => x.status === 204) && polls.some((x) => !x.stamped && x.status === 200), `${label}: while nothing changes, every poll that carries the stamp gets an empty answer (${stamped.length} of ${polls.length} polls, ${stamped.filter((x) => x.status === 204).length} empty)`);
    await rc.close();
  };
  check((await feed()).scoreboard.teams.length === 0, "no team has a sale yet");
  await rotation("rotation without Teams", ["life", "scoreboard", "production"]);

  // --- The owner makes an admin and a manager, sets uplines and an office mark ---
  let priyaPath = "";
  {
    const sheet = await openEditor(o, PRIYA);
    check((await sheet.locator("[data-admin-row] [role=radio]").allInnerTexts()).map((s) => s.trim()).join(",") === "Agent,Manager,Admin", "a person's card offers the three levels: Agent, Manager, Admin");
    o.once("dialog", (dlg) => dlg.accept());
    await roleRadio(sheet, "Admin").click();
    check(await appears(o, `text=${PRIYA} is an admin now.`), "the owner makes an admin at once");
    await sheet.locator("[data-sign-in] button:has-text('Make their sign-in link')").click();
    await sheet.locator("[data-sign-in] [data-link-box] code").waitFor();
    const link = ((await sheet.locator("[data-sign-in] [data-link-box] code").textContent()) ?? "").trim();
    priyaPath = link.startsWith("http") ? new URL(link).pathname : link;
    check(/^\/join\/[A-Za-z0-9_-]{16,}$/.test(priyaPath) && priyaPath !== joinPath, "the owner makes a one-time sign-in link for a person already on the board");
    await o.screenshot({ path: `${OUT}/19-people-editor.png` });
  }
  const priya = await newVisitor();
  const ad = await priya.newPage();
  await go(ad, priyaPath, "form[data-join=person]");
  check((await ad.textContent("h1")) === "Hi Priya, set up your sign-in" && (await ad.locator("#name").count()) === 0, "a personal link greets the person it was made for and asks no name");
  await ad.fill("#phone", PHONE[PRIYA]);
  await ad.fill("#password", "priya-first-pass");
  await Promise.all([ad.waitForURL((u) => u.pathname === "/install"), ad.click("form[data-join] button[type=submit]")]);
  check((await feed()).agents.length === 8, "the personal link added nobody: the admin has her own sign-in on her own row");
  {
    const stale = await newVisitor();
    const again = await stale.newPage();
    await again.goto(`${APP}${priyaPath}`);
    check((await again.locator("[data-join=closed]").count()) === 1 && (await again.locator("form[data-join]").count()) === 0, "a one-time link works once");
    await stale.close();
  }
  for (const name of [THEO, GUS]) {
    const sheet = await openEditor(o, name);
    await sheet.locator("[data-upline-picker] > button").click();
    await sheet.locator("input[aria-label='Find the upline']").fill("nora");
    await sheet.locator(`[role=option]:has-text("${NORA}")`).click();
    check((await feedUntil((j) => j.agents.find((p) => p.id === ID[name])?.uplineId === ID[NORA])).agents.find((p) => p.id === ID[name])?.uplineId === ID[NORA], `the owner puts ${name} on ${NORA}'s team (an upline an admin sets is confirmed at once)`);
  }
  {
    const sheet = await openEditor(o, NORA);
    await roleRadio(sheet, "Manager").click();
    check((await appears(o, `text=${NORA} is a manager now.`)) && sql(`select role from agents where id = '${ID[NORA]}'`) === "manager", "the owner makes the leader of a team a manager at once");
  }
  /** The owner's one-time sign-in link for someone on the board, used from a phone of their own. */
  const joinWithLink = async (name, password) => {
    const sheet = await openEditor(o, name);
    await sheet.locator("[data-sign-in] button:has-text('Make their sign-in link')").click();
    await sheet.locator("[data-sign-in] [data-link-box] code").waitFor();
    const link = ((await sheet.locator("[data-sign-in] [data-link-box] code").textContent()) ?? "").trim();
    const ctx = await newVisitor();
    const pg = await ctx.newPage();
    await go(pg, link.startsWith("http") ? new URL(link).pathname : link, "form[data-join=person]");
    await pg.fill("#phone", PHONE[name]);
    await pg.fill("#password", password);
    await Promise.all([pg.waitForURL((u) => u.pathname === "/install"), pg.click("form[data-join] button[type=submit]")]);
    return { ctx, pg };
  };
  const nora = await joinWithLink(NORA, "nora-first-pass");
  const theo = await joinWithLink(THEO, "theo-first-pass");
  check((await feed()).agents.length === 8, "a manager and an agent set up their own sign-ins on their own rows");
  {
    const sheet = await openEditor(o, LENA);
    await sheet.locator(`[role=switch][aria-label="${LENA} works in the office"]`).click();
    check((await appears(o, "text=In the office: at the top of the boards.")) && (await feedUntil((j) => j.agents.find((p) => p.id === ID[LENA])?.inOffice === true)).agents.find((p) => p.id === ID[LENA])?.inOffice === true, "the owner marks a person in the office");
    // Rename: a name someone else on the board already has is refused (two people with one name
    // would let an approval name the wrong one, and the Shortcut would find neither)
    await sheet.locator(`#name-${ID[LENA]}`).fill(WES.toLowerCase());
    await sheet.locator(`form:has(#name-${ID[LENA]}) button[type=submit]`).click();
    check((await appears(o, `text=Someone else on the board is ${WES}. Add a middle initial.`)) && (await feed()).agents.find((p) => p.id === ID[LENA])?.name === LENA, "renaming a person to a name someone else on the board has is refused, in any case");
  }
  const OFFICE = [NORA, THEO, PRIYA, GUS, DANA, LENA];
  const OTHERS = [WES, IVY];
  const NORA_TEAM = [NORA, THEO, GUS];

  // --- The admin: runs the board, never sees the owner's cards, asks before a past month changes ---
  await go(ad, "/settings", "input[name=goal]");
  const adminSettings = await ad.evaluate(() => ({ signIns: !!document.querySelector("[data-sign-ins]"), shortcut: !!document.querySelector("[data-shortcut]"), lines: !!document.querySelector("[data-other-lines]"), agency: !!document.querySelector("[data-agency-name] #agency_name"), lists: !!document.querySelector("[data-carriers] textarea") && !!document.querySelector("[data-rate-classes] textarea") && !!document.querySelector("[data-lead-sources] textarea"), switchGone: !document.querySelector("[data-team-password-logs]"), text: document.body.innerText }));
  check(!adminSettings.signIns && !adminSettings.shortcut && !adminSettings.lines && adminSettings.agency && adminSettings.text.includes("Only the admins and Anersi see this screen."), "the admin's Settings has the goals and the board, and no Sign-ins, Shortcut or lines-of-business rows");
  check(adminSettings.lists && adminSettings.switchGone, "the admin's Settings has the carriers and products, rate classes and lead sources, and no team-password switch");
  check(!/OWNER_PASSWORD|TEAM_PASSWORD|LOG_TOKEN/.test(adminSettings.text) && !PC_WORDS.test(adminSettings.text), "the admin's Settings names no password, no token and no P&C");
  await ad.screenshot({ path: `${OUT}/20-admin-settings.png`, fullPage: true });
  await ad.goto(`${APP}/approvals`);
  await ad.waitForURL(`${APP}/`);
  check(true, "the admin cannot open the owner's Approvals");
  // This month's policy: fixed at once
  check((await openPolicy(ad, gusId)) === 200, "the admin opens anyone's policy");
  await editSection(ad, "Policy", () => ad.fill("#pe-premium", "520"));
  check((await appears(ad, "text=Saved.")) && (await feedUntil((j) => j.agents.find((p) => p.id === ID[GUS])?.lifeCents === 624_000)).agents.find((p) => p.id === ID[GUS])?.lifeCents === 624_000, "the admin fixes the premium of a policy of this month directly");
  unsold(GUS, yearOf("500"));
  sold(GUS, yearOf("520"));
  // A past month's policy: its board numbers go to the owner, nothing changes yet
  await openPolicy(ad, lastMonthSale.id);
  check((await ad.locator("button[aria-label='Edit Policy']").count()) === 1 && (await ad.locator("[data-remove]").textContent()).includes("Remove policy"), "a past month's policy is the admin's to fix or remove");
  await editSection(ad, "Policy", () => ad.fill("#pe-premium", "64.83"));
  check(await appears(ad, "text=Sent to Anersi for a quick OK."), "the admin's change to a past month's premium says \"Sent to Anersi for a quick OK.\"");
  await openPolicy(ad, lastMonthSale.id);
  const stillOld = await ad.textContent(".pv-summary");
  check(stillOld.includes("$64.75/mo") && !stillOld.includes("$64.83/mo"), "and the policy is unchanged until the owner says yes");
  // Making an admin is the owner's call too
  {
    const sheet = await openEditor(ad, LENA);
    await roleRadio(sheet, "Admin").click();
    await sheet.locator("[data-role-note]").waitFor();
    check((await sheet.locator("[data-role-note]").textContent()).includes("Sent to Anersi for a quick OK."), "an admin who makes an admin is told it went to the owner");
    check((await sheet.locator("[data-sign-in]").count()) === 1 && (await ad.locator("[data-join-card]").count()) === 1, "the admin has the join link and the sign-in links for people");
  }
  // The owner's inbox
  await o.goto(`${APP}/approvals`);
  await o.waitForSelector("[data-approvals-waiting]");
  const asks = await o.locator("[data-approvals-waiting] [data-approval]").evaluateAll((els) => els.map((e) => ({ id: e.getAttribute("data-approval"), text: e.textContent ?? "" })));
  const saleAsk = asks.find((x) => x.text.includes(`Fix ${IVY}'s $64.75/mo sale`) && x.text.includes("$64.83/mo"));
  const roleAsk = asks.find((x) => x.text.includes(LENA));
  check(asks.length === 2 && !!saleAsk && !!roleAsk && asks.every((x) => x.text.includes(`${PRIYA} asked`)), `the owner's Approvals shows both requests, each in one sentence, with who asked (${asks.length})`);
  check(!CLIENT_MARK.test(asks.map((x) => x.text).join(" ")), "an approval's sentence names no client");
  check((await appears(o, "[data-approvals-badge]", 5000)) && (await o.textContent("[data-approvals-badge]")).trim() === "2", "the owner's initials carry the count of what is waiting");
  await o.screenshot({ path: `${OUT}/21-approvals.png`, fullPage: true });
  const declineShot = await actionShot(o, () => o.click(`[data-approval="${roleAsk?.id}"] button:has-text("Decline")`));
  check(await settles(o, () => document.querySelectorAll("[data-approvals-waiting] [data-approval]").length === 1, 8000), "Decline answers a request and changes nothing");
  // The same call, to approve her own past-month fix, sent with the admin's session: refused
  let declineArgs = null;
  try {
    declineArgs = JSON.parse(declineShot.body?.toString("utf8") ?? "");
  } catch {
    declineArgs = null;
  }
  check(Array.isArray(declineArgs) && declineArgs[0] === roleAsk?.id && declineArgs[1] === false, "the Decline call carries the request and the answer");
  const asAdmin = await replay(priya, declineShot, JSON.stringify([saleAsk?.id, true]));
  check(asAdmin.text.includes("Only the owner can do that"), `an admin who calls the approve action directly is refused (${asAdmin.status})`);
  await o.goto(`${APP}/?month=${lastMonth}`);
  await o.waitForSelector("[data-latest-sales]");
  check((await o.innerText("[data-latest-sales]")).includes("$777"), "and the past month's sale is still unchanged");
  // Approve: applied once
  await o.goto(`${APP}/approvals`);
  await o.waitForSelector(`[data-approval="${saleAsk?.id}"]`);
  const oneLeft = await settles(o, () => document.querySelector("[data-approvals-badge]")?.textContent?.trim() === "1", 6000);
  await o.click(`[data-approval="${saleAsk?.id}"] button:has-text("Approve")`);
  check(await settles(o, () => document.querySelectorAll("[data-approvals-waiting] [data-approval]").length === 0 && document.body.innerText.includes("Nothing is waiting"), 8000), "Approve clears the inbox");
  check(oneLeft && (await settles(o, () => !document.querySelector("[data-approvals-badge]"), 6000)), "the count on the owner's initials goes from 1 to nothing");
  const decided = await o.textContent("[data-approvals-decided]");
  check(decided.includes("Approved") && decided.includes("Declined"), "the answered list keeps what was approved and what was declined");
  await o.goto(`${APP}/?month=${lastMonth}`);
  await o.waitForSelector("[data-latest-sales]");
  const fixedOld = await o.innerText("[data-latest-sales]");
  check(fixedOld.includes("$778") && !fixedOld.includes("$777"), "the owner's yes applies the admin's fix to the past month's policy");
  await openPolicy(o, lastMonthSale.id);
  check((await o.textContent("[data-sec=history]")).includes("Changed premium $64.75/mo → $64.83/mo"), "and the policy's history says what changed");
  const twice = await replay(owner, declineShot, JSON.stringify([saleAsk?.id, true]));
  check(twice.text.includes("That one was already answered."), "a request is answered once: approving it again says it was already answered");
  {
    const sheet = await openEditor(o, LENA);
    check((await sheet.locator("[data-admin-row] [role=radio][aria-checked=true]").textContent()).includes("Agent"), "the declined request left the person an agent");
  }

  // Ivy's sale of this month (the owner logs it; the team password no longer logs)
  await logged(o, IVY, "166.58", "Royal", "", { path: `/log?agent=${ID[IVY]}` });

  // --- The shared team password: signs in and shows the boards, never a policy or a client ---
  const team = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, extraHTTPHeaders: { "x-forwarded-for": address() } });
  const m = await team.newPage();
  await signIn(m, TEAM);
  check(m.url() === `${APP}/`, "team password signs in");
  await m.waitForSelector("nav[data-tabbar]");
  const teamTabs = (await m.locator("nav[data-tabbar] > div a").allInnerTexts()).map((s) => s.replace(/\s+/g, " ").trim()).join(",");
  check(teamTabs === "Home,Scoreboard,People", `the team password's tab bar has Home, Scoreboard and People only (${teamTabs})`);
  check(!CLIENT_MARK.test(await m.content()) && (await m.locator("[data-sale-menu]").count()) === 0, "the team password's Home shows no client and no menu on a sale");
  await m.goto(`${APP}/settings`);
  await m.waitForURL(`${APP}/`);
  check(true, "team cannot open Settings");
  await m.goto(`${APP}/board`);
  check((await appears(m, "main[data-screen]")) && m.url() === `${APP}/board`, "the team password still opens the TV board");
  await go(m, "/team", "input[aria-label='Find a person']");
  check((await m.locator("button[aria-label^='Edit ']").count()) === 0 && (await m.locator("[data-join-card]").count()) === 0, "team sees People without Edit or the join link");
  await go(m, "/me", "[data-me=shared]");
  check((await m.textContent("[data-me=shared]")).includes("You're on the team password."), "the team password has no profile, only the way to a sign-in of one's own");
  for (const [what, path] of [
    ["Log a sale", "/log"],
    ["Policies", "/policies"],
    ["a policy", `/policies/${gusId}`],
  ]) {
    await m.goto(`${APP}${path}`);
    const own = await appears(m, "[data-own-sign-in]", 8000);
    const html = await m.content();
    check(own && (await m.textContent("[data-own-sign-in]")).includes("This needs your own sign-in.") && (await m.locator("#premium, [data-policies], [data-policy]").count()) === 0 && !CLIENT_MARK.test(html), `the team password's ${what} says "This needs your own sign-in." and shows no policy`);
  }
  await m.goto(`${APP}/log`);
  await m.waitForSelector("[data-own-sign-in]");
  await m.screenshot({ path: `${OUT}/13-phone-team-own-sign-in.png`, fullPage: true });
  const ivySale = newestSaleOf(ID[IVY]);
  const ivyCents = (await feed()).agents.find((p) => p.id === ID[IVY])?.lifeCents;
  const asLooker = await replay(team, undoShot, undoBody(ivySale));
  check(!!ivySale && asLooker.text.includes("This needs your own sign-in.") && (await feed()).agents.find((p) => p.id === ID[IVY])?.lifeCents === ivyCents, "the team password cannot take a sale back: the call itself is refused");
  const teamLog = await replay(team, logShot);
  check(teamLog.text.includes("This needs your own sign-in.") && (await feed()).agents.find((p) => p.id === ID[LENA])?.lifeCents === centsOf(LENA), "the team password cannot log a sale: the call itself is refused");
  check((await policiesFile(team)).status === 403, "the team password gets no Policies file");
  // The button signs this phone out of the shared password and opens the personal sign-in
  await m.goto(`${APP}/policies`);
  await hydrated(m, "[data-own-sign-in] button[type=submit]");
  await Promise.all([m.waitForURL((u) => u.pathname === "/login"), m.click("[data-own-sign-in] button[type=submit]")]);
  check(new URL(m.url()).searchParams.get("way") === "person" && (await team.request.get(`${APP}/api/board`)).status() === 401, "\"Sign in with your own number\" ends the shared session and opens the personal sign-in");
  await team.close();

  // --- What else an owner and an admin reach for in the first week ---
  // A cell number never reaches a browser that is not a manager's: read from the page as it was sent, not only from what shows
  {
    const sheet = await openEditor(o, DANA);
    check((await sheet.textContent()).includes("(248) 555-0142"), "an admin's People page shows a person's cell number");
    let sent = "";
    for (const path of ["/team", "/", "/scoreboard", "/log", "/policies"]) {
      await d.goto(`${APP}${path}`);
      sent += await d.content();
    }
    check(sent.length > 50_000 && !CELLS.test(sent), "nothing sent to an agent's People, Home, Scoreboard, Log a sale or Policies carries anybody's cell number");
    const looker = await newVisitor();
    const lk = await looker.newPage();
    await lk.goto(`${APP}${joinPath}`);
    const joinSent = await lk.content();
    check(joinSent.includes(NORA) && !CELLS.test(joinSent), "the join page sends names for the upline picker and no cell number");
    const memberCsv = await dana.request.get(`${APP}/api/scoreboard/export`);
    check(memberCsv.status() === 200 && /text\/csv/.test(memberCsv.headers()["content-type"] ?? "") && !CELLS.test(await memberCsv.text()), "an agent downloads the Scoreboard's file too, with no cell number in it");
    // Home's Me | <team> | Agency, for someone on a team
    await d.goto(`${APP}/`);
    await d.waitForSelector("nav[aria-label='Whose numbers']");
    const scopes = (await d.locator("nav[aria-label='Whose numbers'] a").allInnerTexts()).map((s) => s.trim()).join(",");
    check(scopes === "Me,Ivy's team,Agency", `an agent's Home has Me, their upline's team and the Agency (${scopes})`);
    await Promise.all([d.waitForURL((u) => u.searchParams.get("scope") === "team"), d.click("nav[aria-label='Whose numbers'] a:has-text(\"Ivy's team\")")]);
    await d.waitForSelector("[data-leaderboard-home]");
    const mineRows = await d.locator("[data-leaderboard-home] li[data-person]").evaluateAll((lis) => lis.map((li) => li.getAttribute("data-person")));
    check(mineRows.length === 2 && mineRows.includes(ID[IVY]) && mineRows.includes(ID[DANA]), `Home's team view lists the agent's own team only (${mineRows.length} people)`);

    // The agency's name: an admin changes it, every screen follows, then back
    await go(ad, "/settings", "#agency_name");
    await ad.fill("#agency_name", "Lineage Financial Group");
    await ad.click("[data-agency-name] button[type=submit]");
    check((await appears(ad, "text=Saved. Every screen shows it now.")) && (await feedUntil((j) => j.agencyName === "Lineage Financial Group")).agencyName === "Lineage Financial Group", "an admin changes the agency's name and the TV feed carries it");
    await lk.goto(`${APP}/login`);
    const renamed = await lk.evaluate(() => ({ agency: document.querySelector("[data-lockup-by] [data-agency]")?.textContent?.trim(), tkg: !!document.querySelector('[data-lockup-by] svg[aria-label="TKG"]'), text: document.body.innerText }));
    check(renamed.agency === "Lineage Financial Group" && renamed.tkg && renamed.text.includes("Private to The Koka Group and Lineage Financial Group."), "the sign-in page shows the new name beside TKG");
    await go(ad, "/settings", "#agency_name");
    await ad.fill("#agency_name", AGENCY);
    await ad.click("[data-agency-name] button[type=submit]");
    check((await feedUntil((j) => j.agencyName === AGENCY)).agencyName === AGENCY, "and back");

    // A new join link: the old one stops working. Then a link for one team.
    await go(o, "/team", "#new-name");
    o.once("dialog", (dlg) => dlg.accept());
    await o.click("[data-join-card] button:has-text('Make a new link')");
    await o.waitForSelector("text=New link made. The old one is off.");
    const freshUrl = ((await o.locator("[data-join-card] [data-link-box] code").first().textContent()) ?? "").trim();
    const freshPath = freshUrl.startsWith("http") ? new URL(freshUrl).pathname : freshUrl;
    await lk.goto(`${APP}${joinPath}`);
    const oldClosed = (await lk.locator("[data-join=closed]").count()) === 1 && (await lk.locator("form[data-join]").count()) === 0;
    await lk.goto(`${APP}${freshPath}`);
    check(freshPath !== joinPath && oldClosed && (await lk.locator("form[data-join=agency]").count()) === 1, "Make a new link turns the old join link off and the new one opens the join page");
    await go(o, "/team", "#new-name");
    check(((await o.locator("[data-join-card] [data-link-box] code").first().textContent()) ?? "").trim() === freshUrl, "the new join link is still there to copy after a reload");
    await o.selectOption("#join-leader", ID[NORA]);
    await o.waitForSelector("[data-team-link] code");
    const teamUrl = ((await o.textContent("[data-team-link] code")) ?? "").trim();
    await go(lk, new URL(teamUrl).pathname, "form[data-join=agency]");
    check(teamUrl !== freshUrl && (await lk.getAttribute("[data-upline]", "data-upline")) === ID[NORA] && (await lk.textContent("[data-upline]")).includes(NORA), "a link for one team opens the join page with that leader already picked");
    // A manager has a link of their own team, and no agency link or person editor
    await go(nora.pg, "/team", "input[aria-label='Find a person']");
    const noraUrl = ((await nora.pg.textContent("[data-team-link-card] [data-link-box] code").catch(() => "")) ?? "").trim();
    check(!!noraUrl && (await nora.pg.locator("[data-join-card]").count()) === 0 && (await nora.pg.locator("button[aria-label^='Edit ']").count()) === 0, "a manager's People has the join link for their own team, and no agency link and no person editor");
    if (noraUrl) {
      await go(lk, new URL(noraUrl).pathname, "form[data-join=agency]");
      check((await lk.getAttribute("[data-upline]", "data-upline")) === ID[NORA], "the manager's link opens the join page with the manager picked");
    }
    await looker.close();

    // Off the board: the person's sign-in stops working until they are back, and the links and
    // the cookies they had are gone for good
    {
      const off = await openEditor(o, DANA);
      // A reset link made for her before she is taken off: it must not outlive her place on the board
      await off.locator("[data-sign-in] button:has-text('Make a reset link')").click();
      await off.locator("[data-sign-in] [data-link-box] code").waitFor();
      const early = ((await off.locator("[data-sign-in] [data-link-box] code").textContent()) ?? "").trim();
      const earlyPath = early.startsWith("http") ? new URL(early).pathname : early;
      const holder = await newVisitor();
      const hp = await holder.newPage();
      await hp.goto(`${APP}${earlyPath}`);
      const openBefore = (await hp.locator("form[data-join=reset]").count()) === 1;
      o.once("dialog", (dlg) => dlg.accept());
      await off.locator("button:has-text('Take off the board')").click();
      await o.waitForSelector("text=Off the board. Their sales stay in the history.");
      await d.goto(`${APP}/`);
      const bounced = new URL(d.url()).pathname === "/login";
      await hydrated(d, "form[data-way]");
      await d.fill("#phone", PHONE[DANA]);
      await d.fill("#password", "dana-second-pass");
      await d.click("button[type=submit]");
      check(bounced && (await appears(d, "text=That phone number and password don't match.")) && (await feed()).agents.length === 7, "taking a person off the board ends their session and their sign-in, with the same neutral line");
      await hp.goto(`${APP}${earlyPath}`);
      check(/^\/join\/[A-Za-z0-9_-]{16,}$/.test(earlyPath) && openBefore && (await hp.locator("[data-join=closed]").count()) === 1 && (await hp.locator("form[data-join]").count()) === 0, "and the unused reset link that was made for them is turned off");
      // The agency link is not a way back in: not under their name, and not under a new name with their number
      const ASK = "Ask an admin to put you back on the board.";
      const tryJoin = async (name, phone) => {
        await go(hp, freshPath, "form[data-join=agency]");
        await hp.fill("#name", name);
        await hp.fill("#phone", phone);
        await hp.click("form[data-join] button:has-text(\"I'm not sure\")");
        await hp.fill("#password", "back-in-again");
        await hp.click("form[data-join] button[type=submit]");
        return (await appears(hp, `text=${ASK}`)) && new URL(hp.url()).pathname === freshPath;
      };
      await go(hp, freshPath, "form[data-join=agency]");
      const offList = !(await hp.locator("[data-claim] button[data-claim-name]").evaluateAll((els) => els.map((e) => e.getAttribute("data-claim-name")))).includes(DANA);
      const byName = await tryJoin(DANA, "248 555 0188");
      const byNumber = await tryJoin("Dee Whitlow", PHONE[DANA]);
      const stillOff = await feed();
      check(offList && byName && byNumber && stillOff.agents.length === 7 && !stillOff.agents.some((x) => /whitlow/i.test(x.name)), `the join card refuses the name of someone taken off the board, and a new name with their number ("${ASK}"): nobody is added`);
      await holder.close();
      await go(o, "/team", "#new-name");
      await o.click(`li:has-text("${DANA}") button:has-text("Put back")`);
      await o.waitForSelector("text=Back on the board.");
      // Back on the board the number and the password work again; the cookie the phone had does not.
      await d.goto(`${APP}/`);
      check(new URL(d.url()).pathname === "/login" && (await feedUntil((j) => j.agents.length === 8)).agents.length === 8, "back on the board, the session the phone had does not come back: it is asked to sign in");
      await signInPerson(d, PHONE[DANA], "dana-second-pass");
      check(d.url() === `${APP}/`, "the same number and password sign that phone in again");
      const again = await newVisitor();
      const ag = await again.newPage();
      await signInPerson(ag, PHONE[DANA], "dana-second-pass");
      check(ag.url() === `${APP}/`, "and the same number and password sign in on another device");
      await again.close();
    }

    // A forgotten password: the owner makes a reset link; it asks for a new password only and signs the old devices out
    {
      const editor = await openEditor(o, DANA);
      await editor.locator("[data-sign-in] button:has-text('Make a reset link')").click();
      await editor.locator("[data-sign-in] [data-link-box] code").waitFor();
      const resetUrl = ((await editor.locator("[data-sign-in] [data-link-box] code").textContent()) ?? "").trim();
      const forgot = await newVisitor();
      const f = await forgot.newPage();
      await go(f, new URL(resetUrl).pathname, "form[data-join=reset]");
      check((await f.textContent("h1")) === "Set a new password" && (await f.locator("#name").count()) === 0 && (await f.locator("#phone").count()) === 0, "a reset link asks for a new password and nothing else");
      await f.fill("#password", "dana-third-pass");
      await Promise.all([f.waitForURL(`${APP}/`), f.click("form[data-join] button[type=submit]")]);
      await d.goto(`${APP}/`);
      check(f.url() === `${APP}/` && new URL(d.url()).pathname === "/login", "the new password signs that phone in and signs the other devices out");
      await f.goto(`${APP}${new URL(resetUrl).pathname}`);
      check((await f.locator("[data-join=closed]").count()) === 1, "a reset link works once");
      await forgot.close();
      await signInPerson(d, PHONE[DANA], "dana-third-pass");
      check(d.url() === `${APP}/`, "and the new password is the one that signs in from then on");
    }

    // The links an admin made go with the admin: the owner removes Priya as an admin, and the
    // sign-in link she made for Lena stops working. Then she is made an admin again.
    {
      const sheet = await openEditor(ad, LENA);
      await sheet.locator("[data-sign-in] button:has-text('Make their sign-in link')").click();
      await sheet.locator("[data-sign-in] [data-link-box] code").waitFor();
      const made = ((await sheet.locator("[data-sign-in] [data-link-box] code").textContent()) ?? "").trim();
      const lenaPath = made.startsWith("http") ? new URL(made).pathname : made;
      const holder = await newVisitor();
      const hp = await holder.newPage();
      await hp.goto(`${APP}${lenaPath}`);
      const openBefore = (await hp.locator("form[data-join=person]").count()) === 1 && (await hp.textContent("h1")) === "Hi Lena, set up your sign-in";
      const ownerSheet = await openEditor(o, PRIYA);
      o.once("dialog", (dlg) => dlg.accept());
      await roleRadio(ownerSheet, "Agent").click();
      const removed = await appears(o, `text=${PRIYA} is not an admin anymore.`);
      await hp.goto(`${APP}${lenaPath}`);
      check(/^\/join\/[A-Za-z0-9_-]{16,}$/.test(lenaPath) && openBefore && removed && (await hp.locator("[data-join=closed]").count()) === 1 && (await hp.locator("form[data-join]").count()) === 0, "when the owner removes an admin, the unused sign-in link that admin made stops working");
      await ad.goto(`${APP}/settings`);
      await ad.waitForURL(`${APP}/`);
      check(true, "and Settings is closed to her from then on");
      await holder.close();
      const backSheet = await openEditor(o, PRIYA);
      o.once("dialog", (dlg) => dlg.accept());
      await roleRadio(backSheet, "Admin").click();
      const adminAgain = await appears(o, `text=${PRIYA} is an admin now.`);
      await ad.goto(`${APP}/settings`);
      check(adminAgain && (await appears(ad, "input[name=goal]")), "the owner makes her an admin again, and Settings opens for her");
    }

    // --- Who sees which policy, and who may change what (contract decisions 4 to 8) ---
    {
      const th = theo.pg;
      const np = nora.pg;
      // An agent: his own policies and clients only, on the page and in the file
      const theoOwn = await logged(th, THEO, "120", "Americo", "IUL", { picker: false });
      check((await openPolicy(th, theoOwn.id)) === 200 && (await th.textContent("h1")).includes(theoOwn.client.last), "an agent opens the policy they just logged, with its client");
      // Within 15 minutes he fixes his own premium (a board field). The call is kept: it is sent again later.
      const fixShot = await actionShot(th, () => editSection(th, "Policy", () => th.fill("#pe-premium", "125")), '_monthly"');
      check((await appears(th, "text=Saved.")) && (await feedUntil((j) => j.agents.find((p) => p.id === ID[THEO])?.lifeCents === centsOf(THEO) + Math.round((yearOf("125") - yearOf("120")) * 100))).agents.find((p) => p.id === ID[THEO])?.lifeCents === centsOf(THEO) + Math.round((yearOf("125") - yearOf("120")) * 100), "in the first 15 minutes the seller fixes a board field (the premium)");
      unsold(THEO, yearOf("120"));
      sold(THEO, yearOf("125"));
      const theoClients = policiesOf(THEO).map((p) => p.client.last);
      const theoFile = await policiesFile(theo.ctx, "?scope=all");
      check(theoFile.status === 200 && !theoFile.head.includes("Agent") && theoFile.rows.length === theoClients.length && theoFile.rows.every((r) => theoClients.some((l) => r[0].includes(l))), `an agent's Policies file holds their own policies only, even when it asks for everyone's (${theoFile.rows.length} rows)`);
      await go(th, "/policies", "[data-policies]");
      const listed = [...new Set(await th.locator("[data-policy]").evaluateAll((els) => els.map((e) => e.getAttribute("data-policy"))))];
      check((await th.textContent("h1")).includes("My policies") && listed.length === theoClients.length && policiesOf(THEO).every((p) => listed.includes(p.id)), `an agent's list is "My policies", their own only (${listed.length})`);
      check((await openPolicy(th, gusId)) === 404 && (await openPolicy(th, policiesOf(NORA)[0].id)) === 404, "an agent can't open a teammate's or their upline's policy");

      // A manager: their confirmed team's policies and clients, not another team's
      const teamClients = NORA_TEAM.flatMap((n) => policiesOf(n).map((p) => p.client.last));
      const noraFile = await policiesFile(nora.ctx, "?scope=team");
      const agentCol = noraFile.head.indexOf("Agent");
      check(noraFile.status === 200 && agentCol >= 0 && noraFile.rows.length === teamClients.length && noraFile.rows.every((r) => NORA_TEAM.includes(r[agentCol])) && teamClients.every((l) => noraFile.rows.some((r) => r[0].includes(l))), `a manager's team file holds their own and their team's policies, with the clients (${noraFile.rows.length} rows)`);
      check(!noraFile.text.includes(policiesOf(PRIYA)[0].client.last) && !noraFile.text.includes(lastMonthSale.client.last), "and none of another team's or of someone on no team");
      check((await openPolicy(np, policiesOf(PRIYA)[0].id)) === 404 && (await openPolicy(np, lastMonthSale.id)) === 404, "a manager can't open a policy of someone outside their team");
      check((await openPolicy(np, gusId)) === 200 && (await np.textContent("h1")).includes(policiesOf(GUS)[0].client.last), "a manager opens a teammate's policy, client included");
      // ...and changes only its status, underwriting and notes
      const mgr = await np.evaluate(() => ({ edits: [...document.querySelectorAll("button.pv-edit")].map((b) => b.getAttribute("aria-label")), locks: [...document.querySelectorAll(".pv-lockline")].map((p) => p.textContent).join(" | "), remove: document.querySelectorAll("[data-remove]").length }));
      check(mgr.edits.includes("Edit Policy") && mgr.edits.includes("Edit Notes") && !mgr.edits.includes("Edit Client") && !mgr.edits.includes("Edit Beneficiaries") && mgr.remove === 0 && mgr.locks.includes("Only Gus or an admin can change this."), `a manager may edit a teammate's policy section (for underwriting) and notes, not the client or beneficiaries, and can't remove it (${mgr.edits.join(", ")})`);
      await np.click("button[aria-label='Edit Policy']");
      await np.waitForSelector("form.pv-form");
      check((await np.locator("#pe-premium").isDisabled()) && (await np.locator("#pe-carrier").isDisabled()) && (await np.locator("#pe-leadSource").isDisabled()) && !(await np.locator("#pe-underwriting").isDisabled()), "in its Policy section only the underwriter box is open to the manager");
      await np.click("form.pv-form button:has-text('Cancel')");
      await editSection(np, "Notes", () => np.fill("#pe-notes", "Called about the exam date."));
      check(await appears(np, "text=Saved."), "a manager adds a note to a teammate's policy");
      await np.click(".pv-status-btn");
      await np.click("[role=menuitemradio]:has-text('Issued')");
      check(await appears(np, "text=Submitted → Issued"), "a manager changes a teammate's policy status");
      await openPolicy(np, gusId);
      const hist = await np.textContent("[data-sec=history]");
      check(hist.includes("Status: Submitted → Issued") && (await np.textContent("[data-sec=notes]")).includes("Called about the exam date."), "the status change is in the history and the note is saved");
      check(!CLIENT_MARK.test(hist), "the history names no client detail");
      // The seller's premium call, sent with the manager's session: refused (the premium is not theirs)
      const asManager = await replay(nora.ctx, fixShot, swapIn(fixShot, '_monthly"\r\n\r\n125', '_monthly"\r\n\r\n130'));
      check(asManager.text.includes("Only Theo or an admin can change this.") && (await feed()).agents.find((p) => p.id === ID[THEO])?.lifeCents === centsOf(THEO), "a manager who calls the save action for a teammate's premium directly is refused, and the premium stands");

      // After 15 minutes the board fields lock for the seller; the rest stays theirs
      ageSale(theoOwn.id);
      await openPolicy(th, theoOwn.id);
      const late = await th.evaluate(() => ({ locks: [...document.querySelectorAll(".pv-lockline")].map((p) => p.textContent).join(" | "), remove: document.querySelectorAll("[data-remove]").length, fresh: document.querySelectorAll(".pv-fresh").length }));
      check(late.locks.includes("These count on the board. After 15 minutes, ask an admin to change them.") && late.remove === 0 && late.fresh === 0, "after 15 minutes the premium, carrier, product and submitted date lock for the seller, and Take it back is gone");
      await th.click("button[aria-label='Edit Policy']");
      await th.waitForSelector("form.pv-form");
      check((await th.locator("#pe-premium").isDisabled()) && (await th.locator("#pe-carrier").isDisabled()) && !(await th.locator("#pe-leadSource").isDisabled()) && !(await th.locator("#pe-policyNumber").isDisabled()), "the seller still changes the tracking fields (lead source, numbers)");
      await th.click("form.pv-form button:has-text('Cancel')");
      const lateFix = await replay(theo.ctx, fixShot, swapIn(fixShot, '_monthly"\r\n\r\n125', '_monthly"\r\n\r\n135'));
      check(lateFix.text.includes("These count on the board. After 15 minutes, ask an admin to change them.") && (await feed()).agents.find((p) => p.id === ID[THEO])?.lifeCents === centsOf(THEO), "after 15 minutes the server refuses the seller's premium call too");
      const lateBack = await replay(theo.ctx, undoShot, undoBody(theoOwn.id));
      check(lateBack.text.includes("A sale can be taken back for 15 minutes. After that, ask an admin.") && sql(`select deleted_at is null from sales where id = '${theoOwn.id}'`) === "t", "and the take-back: the sale stands");
      await editSection(th, "Client", () => th.fill("#pe-email", `late.${theoOwn.client.email}`));
      check(await appears(th, "text=Saved."), "the seller changes the client's details any time");
      await openPolicy(th, theoOwn.id);
      const theoHist = await th.textContent("[data-sec=history]");
      check(theoHist.includes("Updated client details") && !CLIENT_MARK.test(theoHist), "the history says the client's details changed, never what they are");

      // A joiner who picks a manager on the agency link: on the agency board at once, on the team once confirmed
      const rhea = await newVisitor();
      const rp = await rhea.newPage();
      await go(rp, freshPath, "form[data-join=agency]");
      await rp.fill("#name", RHEA);
      await rp.fill("#phone", PHONE[RHEA]);
      await rp.fill("#upline-search", "nora");
      await rp.click(`#upline-list button:has-text("${NORA}")`);
      await rp.fill("#password", "rhea-first-pass");
      await Promise.all([rp.waitForURL((u) => u.pathname === "/install"), rp.click("form[data-join] button[type=submit]")]);
      ID[RHEA] = (await feedUntil((j) => j.agents.some((p) => p.name === RHEA))).agents.find((p) => p.name === RHEA)?.id ?? null;
      OTHERS.push(RHEA);
      const rheaSale = await logged(rp, RHEA, "180", "Foresters", "TERM", { picker: false });
      const waitingFeed = await feedUntil((j) => j.agents.find((p) => p.id === ID[RHEA])?.lifeCents === 216_000);
      const noraTeamBefore = waitingFeed.scoreboard?.teams?.find((t) => t.leaderId === ID[NORA]);
      check(waitingFeed.agents.find((p) => p.id === ID[RHEA])?.lifeCents === 216_000 && waitingFeed.agents.find((p) => p.id === ID[RHEA])?.uplineId == null && !(noraTeamBefore?.memberIds ?? []).includes(ID[RHEA]), "a joiner who waits for their upline counts on the agency board, and is on nobody's team yet");
      check((await openPolicy(np, rheaSale.id)) === 404 && !(await policiesFile(nora.ctx, "?scope=team")).text.includes(rheaSale.client.last), "until the manager confirms them, the manager sees none of the joiner's policies or clients");
      await go(np, "/team", "input[aria-label='Find a person']");
      check(((await np.textContent(`[data-joiners] [data-joiner="${ID[RHEA]}"]`).catch(() => "")) ?? "").includes("Picked you as their upline"), "the manager's People says who wants to join their team");
      await np.click(`[data-joiner="${ID[RHEA]}"] button:has-text("Confirm")`);
      check(await appears(np, `text=${RHEA} is on Nora's team.`), "the manager confirms the joiner");
      NORA_TEAM.push(RHEA);
      check((await openPolicy(np, rheaSale.id)) === 200 && (await np.textContent("h1")).includes(rheaSale.client.last) && (await policiesFile(nora.ctx, "?scope=team")).text.includes(rheaSale.client.last), "once confirmed, the manager sees the joiner's policies and clients");
      check((await feedUntil((j) => j.agents.find((p) => p.id === ID[RHEA])?.uplineId === ID[NORA])).agents.find((p) => p.id === ID[RHEA])?.uplineId === ID[NORA], "and the joiner is on the manager's team on the board");

      // An admin sees everyone's
      const standing = Number(sql("select count(*) from sales where deleted_at is null and kind = 'life'"));
      const priyaFile = await policiesFile(priya, "?scope=all");
      check(priyaFile.status === 200 && priyaFile.head.includes("Agent") && priyaFile.rows.length === standing && [rheaSale, theoOwn, lastMonthSale].every((p) => priyaFile.text.includes(p.client.last)), `an admin's file holds every policy in the agency (${priyaFile.rows.length} of ${standing})`);
      check((await openPolicy(ad, rheaSale.id)) === 200, "an admin opens anyone's policy");
      check((await policiesFile(dana)).rows.length === 0, "an agent with no policy of their own gets an empty file");
      // The phone's tab bar, by level
      const personTabs = "Home,Scoreboard,Log a sale,Policies,People";
      for (const [who, ctx] of [
        ["an agent", dana],
        ["a manager", nora.ctx],
        ["an admin", priya],
      ]) {
        const tabs = await tabLabels(await ctx.cookies());
        check(tabs === personTabs, `${who}'s phone tab bar: ${tabs}`);
      }
      await rhea.close();

      // No client detail reaches the TV, its feed, the Scoreboard or the Scoreboard's file
      const sweep = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
      await sweep.addCookies(await owner.cookies());
      const sw = await sweep.newPage();
      const leaks = [];
      const look = (what, text) => {
        const hit = text.match(CLIENT_MARK);
        if (hit) leaks.push(`${what}: ${hit[0]}`);
      };
      look("/api/board", JSON.stringify(await feed()));
      await sw.goto(`${APP}/board`);
      await sw.waitForSelector("main[data-screen]");
      look("/board", await sw.content());
      for (const path of ["/scoreboard", "/scoreboard?who=teams", "/scoreboard?view=carrier"]) {
        await sw.goto(`${APP}${path}`);
        await sw.waitForSelector("[data-scoreboard]");
        look(path, await sw.content());
      }
      for (const q of ["", "?who=teams", "?view=product"]) look(`the Scoreboard's file${q}`, await (await owner.request.get(`${APP}/api/scoreboard/export${q}`)).text());
      check(leaks.length === 0, `no client detail in the board feed, the TV, the Scoreboard or its file${leaks.length ? ` (${leaks.join("; ")})` : ""}`);
      await sweep.close();
    }
  }

  // --- Phone size (the owner's session) ---
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await phone.addCookies(await owner.cookies());
  const p = await phone.newPage();
  await p.goto(`${APP}/`);
  await p.waitForSelector("[data-kpi=Production]");
  await p.screenshot({ path: `${OUT}/07-phone-home.png`, fullPage: true });
  const overflow = await p.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  check(!overflow, "phone Home has no sideways scroll");
  const ownerTabs = (await p.locator("nav[data-tabbar] > div a").allInnerTexts()).map((s) => s.replace(/\s+/g, " ").trim()).join(",");
  check(ownerTabs === "Home,Scoreboard,Log a sale,Policies,People", `the owner's phone tab bar: ${ownerTabs}`);
  // The dock (owner, 2026-11-04): its own strip at the very end of the page, the last card fully above it
  await p.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await p.waitForTimeout(250);
  const dock = await p.evaluate(() => {
    const nav = document.querySelector("nav[data-tabbar]").getBoundingClientRect();
    const cards = [...document.querySelectorAll("main .card")];
    const last = cards[cards.length - 1].getBoundingClientRect();
    return { navTop: nav.top, navBottom: nav.bottom, lastRowBottom: last.bottom, h: window.innerHeight };
  });
  check(dock.lastRowBottom <= dock.navTop + 1 && dock.navBottom <= dock.h + 1 && dock.navBottom >= dock.h - 1, `the dock sits in its own strip at the very bottom and the last card ends above it (card ${Math.round(dock.lastRowBottom)}, dock ${Math.round(dock.navTop)} to ${Math.round(dock.navBottom)} of ${dock.h})`);
  await p.screenshot({ path: `${OUT}/07b-phone-home-bottom.png` });
  await p.evaluate(() => window.scrollTo(0, 0));
  await p.goto(`${APP}/log`);
  await p.screenshot({ path: `${OUT}/08-phone-log.png`, fullPage: true });
  // The keyboard (owner, 2026-11-04): while a field that takes typing has focus on a touch screen the tab bar is gone
  await p.waitForSelector("nav[data-tabbar]", { state: "visible" });
  await hydrated(p, "#premium");
  await p.focus("#premium");
  check(await settles(p, () => document.querySelector("nav[data-tabbar]")?.offsetParent === null, 2000), "the tab bar hides while the premium box has focus (the keyboard is up)");
  await p.evaluate(() => document.activeElement.blur());
  check(await settles(p, () => document.querySelector("nav[data-tabbar]")?.offsetParent !== null, 2000), "the tab bar comes back once the keyboard goes");
  await p.goto(`${APP}/policies`);
  await p.waitForSelector("[data-policies]");
  check(!(await p.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)), "the phone's Policies has no sideways scroll");
  await p.screenshot({ path: `${OUT}/08b-phone-policies.png`, fullPage: true });
  // Three more sales through the Shortcut (the Scoreboard's numbers below count them).
  if (TOKEN) {
    for (const who of [LENA, IVY, WES]) {
      const r = await owner.request.post(`${APP}/api/sales`, { headers: { authorization: `Bearer ${TOKEN}` }, data: { agent: who, premium: "1,250", carrier: "Royal", product: "Term" } });
      check(r.ok(), `a sale for ${who} through the Shortcut (${r.status()})`);
      if (r.ok()) sold(who, 1250);
    }
  }
  await p.goto(`${APP}/`);
  await p.waitForSelector("[data-kpi=Production]");
  await p.screenshot({ path: `${OUT}/09-phone-home-dark.png`, fullPage: true });
  await p.goto(`${APP}/scoreboard`);
  await p.waitForSelector("[data-scoreboard]");
  check(!(await p.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)), "the phone Scoreboard has no sideways scroll");
  check((await p.locator("select#scoreboard-sort").count()) === 1 && (await p.locator(`li[data-agent="${ID[THEO]}"]`).isVisible()), "the phone Scoreboard lists a block per agent with a sort");
  await p.screenshot({ path: `${OUT}/22b-phone-scoreboard-dark.png`, fullPage: true });
  await phone.close();

  // --- The Scoreboard: the agency's numbers, the same as the sales this test logged ---
  const today = detroitToday().map((n) => String(n).padStart(2, "0")).join("-");
  const monthKey = today.slice(0, 7);
  const shortDay = (date) => `${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][Number(date.slice(5, 7)) - 1]} ${Number(date.slice(8, 10))}`;
  await o.goto(`${APP}/scoreboard`);
  await o.waitForSelector("[data-scoreboard=agency]");
  const sb = (await feed()).scoreboard;
  const kpi = (title) =>
    o.evaluate((t) => {
      const el = document.querySelector(`section[data-kpi="${t}"]`);
      return { value: el?.querySelector("p.font-mono")?.textContent?.trim() ?? "", text: el?.innerText ?? "" };
    }, title);
  const [kProd, kPol, kAct] = [await kpi("Production"), await kpi("Policies sold"), await kpi("Active agents")];
  check(sb.kpis.productionCents === totalCents() && kProd.value === shortMoney(totalCents()), `Production is what the test logged (${kProd.value}, ${dollars(totalCents())} logged)`);
  check(sb.kpis.policies === totalPolicies() && kPol.value === String(totalPolicies()), `Policies sold is the count logged (${kPol.value})`);
  check(sb.kpis.activeAgents === ledger.size && kAct.value === String(ledger.size), `Active agents is the number of people who sold (${kAct.value})`);
  const gain = Math.abs(sb.kpis.productionCents - sb.kpis.prevProductionCents);
  // The board starts clean (2026-11-01): with no sale at all in the days compared, the chip says so instead of an arrow
  const firstMonth = sb.kpis.prevProductionCents === 0 && sb.kpis.prevPolicies === 0;
  const chipWords = firstMonth ? "First month on Scorecard" : `vs ${sb.compare.label}`;
  check([kProd, kPol, kAct].every((k) => k.text.includes(chipWords)) && (firstMonth || gain === 0 || kProd.text.includes(shortMoney(gain))) && kProd.text.includes("Annual premium sold") && kPol.text.includes("Policies with premium") && kAct.text.includes("Agents who sold"), `each top number carries its chip against the same days of the month before ("${chipWords}")`);
  check(kProd.text.includes("On pace for"), "the Production card says what the month is on pace for");
  check((await o.textContent("[data-scoreboard] h1 + p")).trim() === `${AGENCY} · ${sb.range.label}` && sb.range.label.startsWith(shortDay(`${monthKey}-01`)), `the Scoreboard names the agency and the range (${sb.range.label})`);
  const stand = await o.evaluate(() => ({ text: document.querySelector("[data-section=stand]")?.innerText ?? "", bars: document.querySelector("[data-section=stand] [role=img]")?.getAttribute("aria-label") ?? "" }));
  const barCounts = stand.bars.split(", ").map((s) => Number(s.split(": ").pop()));
  check(stand.text.includes(`${ledger.size} agents on the board`) && barCounts.length === 5 && barCounts.reduce((s, n) => s + n, 0) === ledger.size && stand.bars === sb.stand.buckets.map((b) => `${b.label}: ${b.count}`).join(", "), `"Where agents stand" counts every agent who sold in its five ranges (${stand.bars})`);
  check(stand.text.includes(`The middle agent is at ${dollars(sb.stand.medianCents)}.`) && [...ledger.values()].some((e) => e.cents === sb.stand.medianCents) && stand.text.includes("Each bar counts the agents whose production falls in that range"), "the middle agent is a real person's total");
  const movers = await o.evaluate(() => ({ title: document.querySelector("[data-section=movers] h2")?.textContent ?? "", sub: document.querySelector("[data-section=movers] h2 + p")?.textContent ?? "", up: [...document.querySelectorAll("[data-movers=up] li")].map((li) => li.innerText.replace(/\s+/g, " ")), down: document.querySelector("[data-movers=down]")?.innerText ?? "" }));
  const best = topOf([...ledger.keys()]);
  check(movers.title === "Moved most this week" && movers.sub.includes(sb.movers.label) && movers.up.length > 0 && movers.up.length <= 3 && movers.up[0].includes(best) && movers.up[0].includes(`+${dollars(centsOf(best))}`) && movers.down.includes("Slipping"), `"Moved most this week" leads with the biggest mover (${movers.up[0]})`);
  const table = await o.evaluate(() => ({ heads: [...document.querySelectorAll("[data-leaderboard=agents] thead th")].map((th) => th.innerText.trim()), rows: [...document.querySelectorAll("[data-leaderboard=agents] tbody tr[data-agent]")].map((tr) => ({ id: tr.getAttribute("data-agent"), cells: [...tr.querySelectorAll("td")].map((td) => td.innerText.replace(/\s+/g, " ").trim()) })) }));
  check(table.heads[0] === "Name" && table.heads[1] === "Policies" && table.heads.at(-1) === "Total" && table.heads.length === sb.range.days.length + 3 && table.heads.at(-2) === shortDay(today), `the leaderboard has a column for each day through today (${table.heads.length - 3} days, the last ${table.heads.at(-2)})`);
  const rowOf = (name) => table.rows.find((r) => r.id === ID[name]);
  check(table.rows.length === ledger.size && [...ledger.keys()].every((n) => rowOf(n)?.cells.at(-1) === dollars(centsOf(n)) && rowOf(n)?.cells[1] === String(ledger.get(n).policies) && rowOf(n)?.cells.at(-2) === dollars(centsOf(n))), "every agent's row shows their policies, today's column and their total");
  check(table.rows[0].id === ID[best] && table.rows[0].cells[0].startsWith("1") && table.rows[0].cells[0].includes(best) && rowOf(THEO).cells[0].includes(NORA), "the leaderboard is ranked by production, each agent under their upline's name");
  await o.screenshot({ path: `${OUT}/22-scoreboard.png`, fullPage: true });
  // Sort
  const names = () => o.locator("[data-leaderboard=agents] tbody tr[data-agent]").evaluateAll((trs) => trs.map((tr) => tr.getAttribute("data-agent")));
  const byName = [...ledger.keys()].sort((x, y) => x.localeCompare(y)).map((n) => ID[n]);
  await o.click("[data-leaderboard=agents] thead th button:has-text('Name')");
  check((await names()).join() === byName.join() && (await o.getAttribute("[data-leaderboard=agents] thead th:first-child", "aria-sort")) === "ascending", "a tap on Name sorts the leaderboard by name");
  await o.click("[data-leaderboard=agents] thead th button:has-text('Total')");
  check((await names())[0] === ID[best] && (await o.getAttribute("[data-leaderboard=agents] thead th:last-child", "aria-sort")) === "descending", "a tap on Total sorts it by production again, highest first");
  // Columns by product and by carrier
  await o.click("nav[aria-label=Columns] a:has-text('Carrier')");
  await o.waitForURL((u) => u.searchParams.get("view") === "carrier");
  check(await settles(o, () => [...document.querySelectorAll("[data-leaderboard=agents] thead th")].some((th) => th.innerText.trim() === "Americo"), 5000), "the columns switch from dates to carriers");
  // Teams: a leader and everyone under them, all levels, added up
  await o.goto(`${APP}/scoreboard?who=teams`);
  await o.waitForSelector("[data-leaderboard=teams]");
  const teamRows = await o.locator("[data-leaderboard=teams] tbody tr[data-team]").evaluateAll((trs) => trs.map((tr) => ({ id: tr.getAttribute("data-team"), text: tr.innerText.replace(/\s+/g, " ").trim() })));
  const noraTeam = teamRows.find((r) => r.id === ID[NORA]);
  const ivyTeam = teamRows.find((r) => r.id === ID[IVY]);
  const soldOf = (names) => names.filter((n) => ledger.has(n)).length;
  check(teamRows.length === 2 && !!noraTeam && /Nora Vance['’]s team/.test(noraTeam.text) && noraTeam.text.includes(`${NORA_TEAM.length} people · ${soldOf(NORA_TEAM)} sold`) && noraTeam.text.endsWith(dollars(centsOf(...NORA_TEAM))), `the Teams view adds up a leader's whole confirmed downline (${NORA}'s team: ${dollars(centsOf(...NORA_TEAM))})`);
  check(!!ivyTeam && ivyTeam.text.includes(`2 people · ${soldOf([IVY, DANA])} sold`) && ivyTeam.text.endsWith(dollars(centsOf(IVY, DANA))), `and a team where only the leader sold (${IVY}'s team: ${dollars(centsOf(IVY, DANA))})`);
  await o.click(`[data-leaderboard=teams] button[aria-label="Show the people on ${NORA}'s team"]`);
  check(await settles(o, (n) => document.querySelectorAll("[data-leaderboard=teams] tbody tr[data-agent]").length === n, 4000, soldOf(NORA_TEAM)), "a team opens to show the people on it who sold");
  await o.screenshot({ path: `${OUT}/23-scoreboard-teams.png`, fullPage: true });
  // The month control
  await o.goto(`${APP}/scoreboard`);
  await o.waitForSelector("[data-scoreboard=agency]");
  await hydrated(o, "[data-scoreboard] select");
  await Promise.all([o.waitForURL((u) => u.searchParams.get("month") === lastMonth), o.getByLabel("Month").selectOption(lastMonth)]);
  await o.waitForSelector("text=Final places for the month");
  const past = await o.evaluate(() => document.querySelector("[data-scoreboard]")?.innerText ?? "");
  check(past.includes("Moved most in the last week") && past.includes("$778") && past.includes(IVY) && !past.includes(THEO), "the month control opens last month's Scoreboard with that month's own sale");
  // Export CSV: the file's rows are the table's rows
  await o.goto(`${APP}/scoreboard`);
  await o.waitForSelector("[data-scoreboard=agency]");
  const [download] = await Promise.all([o.waitForEvent("download"), o.click("a:has-text('Export CSV')")]);
  const csv = readFileSync(await download.path(), "utf8");
  const lines = csv.replace(/^﻿/, "").split("\r\n").filter(Boolean).map((l) => l.split(",").map((c) => c.replace(/^"|"$/g, "")));
  const csvRow = (name) => lines.find((l) => l[1] === name);
  check(download.suggestedFilename() === `scoreboard-${monthKey}.csv` && csv.charCodeAt(0) === 0xfeff && lines[0].slice(0, 5).join() === "Rank,Name,Upline,In office,Policies" && lines[0].at(-1) === "Total" && lines[0].at(-2) === shortDay(today), `Export CSV downloads ${download.suggestedFilename()} with the table's columns`);
  check(lines.length === ledger.size + 1 && [...ledger.keys()].every((n) => csvRow(n)?.at(-1) === (centsOf(n) / 100).toFixed(2) && csvRow(n)?.[4] === String(ledger.get(n).policies)), "the file has one row per agent who sold, with their policies and total to the cent");
  check(csvRow(THEO)?.[0] === "1" && csvRow(THEO)?.[2] === NORA && csvRow(THEO)?.[3] === "Yes" && csvRow(IVY)?.[3] === "No", "the file carries the rank, the upline and the office mark");
  const teamsCsv = await (await owner.request.get(`${APP}/api/scoreboard/export?who=teams`)).text();
  check(teamsCsv.includes(`"${NORA}'s team",${NORA_TEAM.length},${soldOf(NORA_TEAM)},`) && teamsCsv.includes(`,${(centsOf(...NORA_TEAM) / 100).toFixed(2)}\r\n`), "the teams export adds up the same team total");
  const badExports = await Promise.all(["month=2099-01", "who=x", "team=00000000-0000-4000-8000-000000000000"].map(async (q) => (await owner.request.get(`${APP}/api/scoreboard/export?${q}`)).status()));
  check(badExports.join() === "400,400,400", `the export refuses a month that has not started, an unknown table and a team that is nobody's (${badExports.join(", ")})`);
  // <Upline>'s team | Agency, for an agent: her upline's team
  await d.goto(`${APP}/scoreboard`);
  await d.waitForSelector("[data-scoreboard=agency]");
  const whose = await d.locator("nav[aria-label='Whose numbers'] a").evaluateAll((links) => links.map((l) => `${l.textContent.trim()}${l.getAttribute("aria-current") === "true" ? "*" : ""}`).join(","));
  check(whose === "Ivy's team,Agency*", `an agent gets their upline's team | Agency, on Agency to start (${whose})`);
  check((await d.innerText("[data-scoreboard]")).includes("You're not on the board yet this month"), "an agent with no sale this month is told so, with the way to log one");
  await d.click("nav[aria-label='Whose numbers'] a:has-text(\"Ivy's team\")");
  await d.waitForSelector("[data-scoreboard=team]");
  const myTeam = await d.evaluate(() => ({ sub: document.querySelector("[data-scoreboard] h1 + p")?.textContent ?? "", production: document.querySelector("section[data-kpi=Production] p.font-mono")?.textContent?.trim(), rows: [...document.querySelectorAll("[data-leaderboard=agents] tbody tr[data-agent]")].map((tr) => tr.getAttribute("data-agent")) }));
  check(myTeam.sub.startsWith(`${IVY}'s team`) && myTeam.production === shortMoney(centsOf(IVY, DANA)) && myTeam.rows.join() === ID[IVY], `the team view narrows every number to the agent's team (${myTeam.sub.trim()}: ${myTeam.production})`);
  await d.click("nav[aria-label='Whose numbers'] a:has-text('Agency')");
  check(await appears(d, "[data-scoreboard=agency]"), "Agency widens it again");

  // --- The office group first (owner, 2026-11-12: "their numbers should be showing at the top") ---
  await o.goto(`${APP}/`);
  await o.waitForSelector("section[data-group]");
  const homeGroups = await o.locator("[data-leaderboard-home] section[data-group]").evaluateAll((secs) => secs.map((s) => ({ title: s.getAttribute("data-group"), rows: [...s.querySelectorAll("li[data-person]")].map((li) => li.innerText.replace(/\s+/g, " ").trim()), first: s.querySelector("li[data-place='1']")?.innerText ?? "" })));
  check(homeGroups.map((g) => g.title).join() === "In the office,Everyone else" && homeGroups[0].rows.length === OFFICE.length && homeGroups[1].rows.length === OTHERS.length && OFFICE.every((n) => homeGroups[0].rows.some((r) => r.includes(n))), `Home lists the office group first (${homeGroups.map((g) => `${g.title} ${g.rows.length}`).join(", ")})`);
  check(homeGroups[0].first.includes(topOf(OFFICE)) && homeGroups[1].first.includes(topOf(OTHERS)), `each group has ranks of its own on Home (1 ${topOf(OFFICE)}; 1 ${topOf(OTHERS)})`);
  await o.screenshot({ path: `${OUT}/06b-home-office.png`, fullPage: true });

  // --- The TV board ---
  /** Every piece named by the selector sits whole between the TV's header and footer, inside the screen. */
  const fits = (page, selector) =>
    page.evaluate((sel) => {
      const top = document.querySelector("main > header").getBoundingClientRect().bottom;
      const bottom = document.querySelector("main > footer").getBoundingClientRect().top;
      const els = [...document.querySelectorAll(sel)];
      const page = document.documentElement;
      return els.length > 0 && page.scrollHeight <= page.clientHeight + 1 && page.scrollWidth <= page.clientWidth + 1 && els.every((e) => ((r) => r.width > 0 && r.height > 0 && r.top >= top - 1 && r.bottom <= bottom + 1 && r.left >= -1 && r.right <= window.innerWidth + 1)(e.getBoundingClientRect()));
    }, selector);
  const tv = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  await tv.addCookies(await owner.cookies());
  const t = await tv.newPage();
  // What the TV itself asks the feed, and what it gets back
  const tvPolls = [];
  t.on("response", (res) => {
    if (res.url().includes("/api/board")) tvPolls.push({ stamped: res.url().includes("stamp="), status: res.status() });
  });
  // Settings says Light (set above): the TV opens light before its first paint
  await t.goto(`${APP}/board`, { waitUntil: "commit" });
  check((await t.getAttribute("html", "data-theme")) === "light", "the TV opens in the owner's TV look (light) before the first paint");
  await t.waitForSelector("main[data-screen]");
  await t.waitForTimeout(1200);
  await t.screenshot({ path: `${OUT}/11-board-light.png` });
  const tvLockup = await t.evaluate(() => {
    const by = document.querySelector("main > header [data-lockup-by]");
    return { tkg: !!by?.querySelector('svg[aria-label="TKG"]'), agency: by?.querySelector("[data-agency]")?.textContent?.trim() ?? "", by: by?.textContent ?? "" };
  });
  check(tvLockup.tkg && tvLockup.agency === AGENCY && tvLockup.by.includes("×"), `the TV's lockup reads "by TKG × ${AGENCY}"`);
  // Back to Dark on the owner's phone: the TV follows on its next poll
  await go(o, "/settings", "input[name=goal]");
  await o.click(`${tvLook} [role=radio]:has-text('Dark')`);
  check(await settles(t, () => document.documentElement.getAttribute("data-theme") === "dark", 12000), "a TV look change in Settings reaches the TV within a poll");
  await t.waitForTimeout(400);
  await t.screenshot({ path: `${OUT}/10-board-dark.png` });
  const tvOverflow = await t.evaluate(() => document.documentElement.scrollHeight > document.documentElement.clientHeight + 1);
  check(!tvOverflow, "board fits the TV with no scroll");
  await t.keyboard.press("t");
  await t.waitForTimeout(400);
  check((await t.getAttribute("html", "data-theme")) === "dark", "nothing on the TV itself changes the look (T does nothing)");
  check((await t.evaluate(() => localStorage.getItem("theme"))) === null, "the TV never saves a look in the browser");
  // Settings is the only control, whatever the address says
  const pinned = await tv.newPage();
  await pinned.goto(`${APP}/board?theme=light`, { waitUntil: "commit" });
  check((await pinned.getAttribute("html", "data-theme")) === "dark", "?theme=light in the address changes nothing");
  await pinned.close();
  // The leaderboard screen: the office group on top with its own places, then everyone else
  const tvGroups = await t.evaluate(() =>
    [...document.querySelectorAll("main section[data-group]")].map((s) => ({ name: s.getAttribute("data-group"), top: s.getBoundingClientRect().top, title: s.querySelector("h2")?.innerText.replace(/\s+/g, " ") ?? "", rows: [...s.querySelectorAll("li[data-person]")].map((li) => ({ id: li.getAttribute("data-person"), place: li.getAttribute("data-place") })) })),
  );
  const tvOffice = tvGroups.find((g) => g.name === "office");
  const tvOthers = tvGroups.find((g) => g.name === "others");
  check(tvGroups.length === 2 && tvOffice.top < tvOthers.top && tvOffice.title.startsWith("In the office") && tvOthers.title.startsWith("Everyone else") && tvOffice.rows.length === OFFICE.length && tvOthers.rows.length === OTHERS.length, `the TV's leaderboard has the office group on top (${tvOffice?.title}; ${tvOthers?.title})`);
  check(tvOffice.rows.find((r) => r.place === "1")?.id === ID[topOf(OFFICE)] && tvOthers.rows.find((r) => r.place === "1")?.id === ID[topOf(OTHERS)], "each group has places of its own on the TV");
  check(await fits(t, "section[data-group], li[data-person]"), "every row of the leaderboard fits the TV at 1920x1080");

  // The feed's stamp: the TV asks "anything new?" and gets nothing back until something changed
  const stamp1 = (await feed()).stamp;
  const same = await owner.request.get(`${APP}/api/board?stamp=${encodeURIComponent(stamp1)}`);
  check(typeof stamp1 === "string" && stamp1.length > 0 && same.status() === 204 && (await same.body()).length === 0, "the same stamp answers 204 with no body");
  // A new sale (a Shortcut's, when there is a token; else the form's): the stamp moves and the board celebrates within a poll
  if (TOKEN) {
    const api = await owner.request.post(`${APP}/api/sales`, { headers: { authorization: `Bearer ${TOKEN}` }, data: { agent: "wes", premium: "2,750", product: "Term", carrier: "americo" } });
    check(api.ok() && (await api.json()).sale.carrier === "Americo", `Shortcut endpoint logs a sale with the carrier (${api.status()})`);
    sold(WES, 2750);
  } else {
    await logged(o, WES, "229.17", "Americo", "TERM");
  }
  const moved = await owner.request.get(`${APP}/api/board?stamp=${encodeURIComponent(stamp1)}`);
  const stamp2 = moved.status() === 200 ? (await moved.json()).stamp : null;
  check(moved.status() === 200 && !!stamp2 && stamp2 !== stamp1, "a new sale changes the stamp: the feed answers in full");
  await t.waitForSelector("text=New sale", { timeout: 15000 });
  await t.waitForTimeout(900);
  await t.screenshot({ path: `${OUT}/12-board-celebration.png` });
  const celebrate = await t.textContent("[role=status][data-sound]");
  check((await t.getAttribute("[role=status][data-sound]", "data-sound")) === "air-horn", "the celebration carries the chosen sale sound (air horn)");
  check(!(await t.textContent("footer")).includes("Click or press a key once for sound"), "a sale sound that plays leaves no sound hint on the TV");
  check(celebrate.includes(WES) && celebrate.includes("$2,750") && celebrate.includes("Americo") && !PC_WORDS.test(celebrate), "the board celebrates the new sale with the name, the amount and the carrier");
  check(!CLIENT_MARK.test(celebrate) && !CLIENT_MARK.test(await t.content()), "and never a client");
  await go(o, "/settings", "#message");
  await o.fill("#message", "Finish strong. Every policy counts!");
  await o.locator("form:has(#message) button[type=submit]").click();
  await o.waitForSelector("text=Saved. The board updates");
  const afterSave = await owner.request.get(`${APP}/api/board?stamp=${encodeURIComponent(stamp2 ?? "")}`);
  check(afterSave.status() === 200 && (await afterSave.json()).stamp !== stamp2, "a Settings save changes the stamp too");
  check(await settles(t, () => document.querySelector("main > footer")?.textContent?.includes("Every policy counts!"), 12000), "and the saved message reaches the TV within a poll");
  if (TOKEN) {
    const post = (data, token = TOKEN) => owner.request.post(`${APP}/api/sales`, { headers: { authorization: `Bearer ${token}` }, data });
    const noCarrier = await post({ agent: "wes", premium: "10" });
    check(noCarrier.status() === 400, "Shortcut endpoint needs a carrier");
    const badCarrier = await post({ agent: "wes", premium: "10", carrier: "Nope" });
    check(badCarrier.status() === 400 && (await badCarrier.json()).carriers.length === 7, "Shortcut endpoint lists the carriers on a wrong one");
    const pcOff = await post({ agent: "Gus", premium: "2,000", kind: "pc", carrier: "geico", product: "umbrella" });
    check(pcOff.status() === 400 && (await pcOff.json()).error === "That kind of sale is turned off", "Shortcut endpoint refuses the other kind of sale while the owner's switch is off");
    const people = await owner.request.get(`${APP}/api/sales`, { headers: { authorization: `Bearer ${TOKEN}` } });
    const list = people.ok() ? await people.json() : {};
    check(people.ok() && list.people.length === 9 && !("pcPeople" in list) && !("pcCarriers" in list), "Shortcut endpoint lists the people (and nothing about the other kind)");
    const bad = await post({ agent: "Nobody", premium: "100", carrier: "AHL" });
    check(bad.status() === 404, "Shortcut endpoint refuses an unknown person");
    const wrongTok = await post({ agent: "Theo", premium: "100", carrier: "AHL" }, "nope-nope-nope-nope");
    check(wrongTok.status() === 401, "Shortcut endpoint refuses a wrong token");
  } else {
    console.log("skip Shortcut endpoint (no LOG_TOKEN)");
  }
  await t.waitForSelector("[role=status][data-sound]", { state: "detached", timeout: 30000 });
  const tvMain = (await t.innerText("main")).toLowerCase(); // innerText: what the screen shows, in the eyebrows' capitals
  check((await t.getAttribute("main", "data-screen")) === "life" && tvMain.includes("in the office") && tvMain.includes("production") && tvMain.includes("latest sales") && tvMain.includes("on pace for"), `the TV opens on the leaderboard, with production, what it is on pace for and the latest sales${tick ? "" : " (before the month's first business day)"}`);
  check(!PC_WORDS.test(tvMain) && !tvMain.includes("life production") && !tvMain.includes("life leaderboard"), "the TV's leaderboard says nothing about P&C, an agency total or \"life\"");
  // Settings > TV screens: keep the TV on one screen
  await go(o, "/settings", `${tvScreens} [role=radio]`);
  const keep = async (label, screen) => {
    await o.click(tvScreen(label));
    return settles(t, (s) => document.querySelector("main")?.dataset.screen === s && document.querySelectorAll("[data-pill]").length === 1 && document.querySelector("[data-pill]")?.getAttribute("data-pill") === s, 12000, screen);
  };
  check(await keep("Scoreboard", "scoreboard"), "Scoreboard in Settings keeps the TV on the Scoreboard within a poll, with only its own pill");
  const tvKpis = await t.evaluate(() => Object.fromEntries([...document.querySelectorAll("main [data-kpi]")].map((el) => [el.getAttribute("data-kpi"), el.innerText.replace(/\s+/g, " ")])));
  // The phone's Scoreboard at this same moment: both print one text for the same production
  await d.goto(`${APP}/scoreboard`);
  await d.waitForSelector("[data-scoreboard=agency]");
  const phoneProduction = ((await d.textContent("section[data-kpi=Production] p.font-mono")) ?? "").trim();
  check(phoneProduction === shortMoney(totalCents()) && (tvKpis["Production"] ?? "").split(" ").includes(phoneProduction), `the phone's Scoreboard and the TV print the same short money for Production (${phoneProduction})`);
  check((tvKpis["Production"] ?? "").includes(tvMoney(totalCents())) && (tvKpis["Policies sold"] ?? "").includes(` ${totalPolicies()} `) && (tvKpis["Active agents"] ?? "").includes(` ${ledger.size} `), `the TV's Scoreboard shows the three top numbers the test logged (${tvMoney(totalCents())}, ${totalPolicies()} policies, ${ledger.size} agents)`);
  const tvScore = await t.innerText("main");
  const tvChip = sb.kpis.prevProductionCents === 0 && sb.kpis.prevPolicies === 0 ? "First month on Scorecard" : `vs ${sb.compare.label}`;
  check(tvScore.includes("Where agents stand") && tvScore.includes("Moved most this week") && tvScore.includes("Going up") && tvScore.includes(tvChip) && !PC_WORDS.test(tvScore), `the TV's Scoreboard has where agents stand and who moved most ("${tvChip}")`);
  check(await fits(t, "[data-kpi], [data-card]"), "the Scoreboard screen fits the TV at 1920x1080");
  await t.screenshot({ path: `${OUT}/10d-board-scoreboard.png` });
  check(await keep("Production", "production"), "Production keeps the TV on the day-by-day table");
  const tvRow1 = (await t.innerText('main li[data-row="1"]')).replace(/\s+/g, " ");
  const tvBest = topOf([...ledger.keys()]);
  check(tvRow1.includes(tvBest) && tvRow1.includes(dollars(centsOf(tvBest))) && (await t.locator("main li[data-row]").count()) === ledger.size && !PC_WORDS.test(await t.innerText("main")), `the Production screen ranks everyone who sold (${ledger.size} rows, first ${tvBest} with ${dollars(centsOf(tvBest))})`);
  check(await fits(t, "li[data-row]"), "the Production screen fits the TV at 1920x1080");
  await t.screenshot({ path: `${OUT}/10e-board-production.png` });
  check(await keep("Teams", "teams"), "Teams keeps the TV on the teams");
  const tvTeam = (await t.innerText(`main li[data-team="${ID[NORA]}"]`)).replace(/\s+/g, " ");
  check(/Nora Vance['’]s team/.test(tvTeam) && tvTeam.includes(`${NORA_TEAM.length} people`) && tvTeam.includes(`${NORA_TEAM.filter((n) => ledger.has(n)).length} sold`) && tvTeam.includes(dollars(centsOf(...NORA_TEAM))) && (await t.locator("main li[data-team]").count()) === 2 && !PC_WORDS.test(await t.innerText("main")), `the TV's Teams screen adds up the leader's whole downline (${dollars(centsOf(...NORA_TEAM))})`);
  check(await fits(t, "li[data-team]"), "the Teams screen fits the TV at 1920x1080");
  await t.screenshot({ path: `${OUT}/10f-board-teams.png` });
  // An upline change is not a Settings row either: the stamp moves, and the team on the TV grows within a poll
  {
    const teamOnTv = (people) => settles(t, ([id, words]) => (document.querySelector(`main li[data-team="${id}"]`)?.innerText ?? "").replace(/\s+/g, " ").includes(words), 12000, [ID[IVY], people]);
    const before = (await feed()).stamp;
    const sheet = await openEditor(o, WES);
    await sheet.locator("[data-upline-picker] > button").click();
    await sheet.locator("input[aria-label='Find the upline']").fill("ivy");
    await sheet.locator(`[role=option]:has-text("${IVY}")`).click();
    const moved = await feedUntil((j) => j.agents.find((x) => x.id === ID[WES])?.uplineId === ID[IVY]);
    const asked = await owner.request.get(`${APP}/api/board?stamp=${encodeURIComponent(before)}`);
    check(moved.agents.find((x) => x.id === ID[WES])?.uplineId === ID[IVY] && asked.status() === 200, "an upline change moves the stamp");
    check(await teamOnTv("3 people"), `and ${IVY}'s team on the TV counts three people within a poll`);
    await sheet.locator("[data-upline-picker] > button", { hasText: IVY }).waitFor();
    await sheet.locator("[data-upline-picker] > button").click();
    await sheet.locator("[role=option]:has-text('No upline')").click();
    check((await feedUntil((j) => j.agents.find((x) => x.id === ID[WES])?.uplineId == null)).agents.find((x) => x.id === ID[WES])?.uplineId == null && (await teamOnTv("2 people")), "and two again once the upline is taken off");
    await go(o, "/settings", `${tvScreens} [role=radio]`);
  }
  check(await keep("Leaderboard", "life"), "Leaderboard keeps the TV on the leaderboard");
  // A goal is not a Settings row, yet its save moves the stamp too ("Goal saved. The board shows it
  // now."): the leaderboard's goal follows within a poll, there and back
  for (const [amount, shown] of [
    ["155000", "$155,000"],
    ["150000", "$150,000"],
  ]) {
    const before = (await feed()).stamp;
    await o.locator("input[name=goal]").first().fill(amount);
    await o.locator("form:has(input[name=goal])").first().locator("button[type=submit]").click();
    const saved = await feedUntil((j) => j.team.goalCents === Number(amount) * 100);
    const asked = await owner.request.get(`${APP}/api/board?stamp=${encodeURIComponent(before)}`);
    check(saved.team.goalCents === Number(amount) * 100 && asked.status() === 200 && (await asked.json()).team.goalCents === Number(amount) * 100, `a goal save moves the stamp: the TV's next question gets the whole feed, with ${shown}`);
    check(await settles(t, (text) => (document.querySelector("main")?.innerText ?? "").includes(`of ${text}`), 12000, shown), `and the goal on the TV reads ${shown} within a poll`);
  }
  await o.click(tvScreen("Rotate"));
  check(await settles(t, () => document.querySelector("main")?.dataset.screen === "life" && [...document.querySelectorAll("[data-pill]")].map((e) => e.getAttribute("data-pill")).join() === "life,scoreboard,production,teams", 12000), "Rotate brings the TV back to rotating, with a pill for each of its four screens");
  // This TV was shown a change at almost every poll (the test kept saving Settings), so here only
  // the asking is checked: the first poll is a full read, every later one carries the stamp (but each
  // twelfth, the once-a-minute full read). The rotation runs check the empty answers.
  const asked = tvPolls.map((x) => `${x.stamped ? "stamp" : "full"} ${x.status}`).join(", ");
  check(tvPolls.length >= 5 && !tvPolls[0].stamped && tvPolls[0].status === 200 && tvPolls.slice(1).every((x, i) => x.stamped || (i + 1) % 12 === 0) && tvPolls.every((x) => x.status === 200 || x.status === 204), `the TV's own polls: one full read, then each asks with the stamp (${asked})`);
  await tv.close();

  // The rotation, part two: a team has sold now, so Teams takes its turn
  await rotation("rotation with Teams", ["life", "scoreboard", "production", "teams"]);

  // The sound check (2026-11-04): a browser that holds sound back until a click says so on the TV
  // before any sale (headless Chromium allows sound, so this one is launched with the desktop rule).
  const gated = await chromium.launch({ args: ["--autoplay-policy=document-user-activation-required"] });
  try {
    // The session cookie, no sign-in click: like the TV after it reloads itself, nobody has touched the page
    const gc = await gated.newContext({ viewport: { width: 1920, height: 1080 } });
    await gc.addCookies(await owner.cookies());
    const g = await gc.newPage();
    await g.goto(`${APP}/board`);
    // Wait without touching the page: Playwright's own waits run with a user gesture, which would
    // count as the click the browser is waiting for. The board asks the browser at load.
    await g.waitForTimeout(2500);
    const hinted = (await g.innerText("footer")).includes("Click or press a key once for sound");
    check(hinted, "a browser that holds sound back gets the sound hint on the TV before any sale");
    await g.keyboard.press("Shift");
    check(await settles(g, () => !document.querySelector("footer")?.textContent?.includes("Click or press a key once for sound"), 3000), "a key on the TV clears the sound hint");
  } finally {
    await gated.close();
  }

  // --- Life only (owner, 2026-11-12: "I do not want any mention of the PNC or the agency total") ---
  /** Every screen people see, read as the screen shows it: none may name P&C or an agency total. */
  const lifeOnlySweep = async (when) => {
    for (const [what, path, ready] of [
      ["Home", "/", "[data-kpi=Production]"],
      ["Log a sale", "/log", "#premium"],
      ["Policies", "/policies", "[data-policies]"],
      ["People", "/team", "#new-name"],
      ["Settings", "/settings", "input[name=goal]"],
      ["the Scoreboard", "/scoreboard", "[data-scoreboard]"],
      ["the Scoreboard's teams", "/scoreboard?who=teams", "[data-leaderboard=teams]"],
      ["Your profile", "/me", "h1"],
      ["the phone guide", "/install", "[data-install]:not([data-install=checking])"],
    ]) {
      await o.goto(`${APP}${path}`);
      await o.waitForSelector(ready);
      await saysNoPc(o, `${when}: ${what}`);
    }
    const sweepTv = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
    await sweepTv.addCookies(await owner.cookies());
    const s = await sweepTv.newPage();
    await s.goto(`${APP}/board`);
    await s.waitForSelector("main[data-screen]");
    await saysNoPc(s, `${when}: the TV`);
    const pills = await s.locator("[data-pill]").evaluateAll((els) => els.map((e) => e.getAttribute("data-pill")).join());
    check(pills === "life,scoreboard,production,teams", `${when}: the TV rotates the leaderboard, the Scoreboard, Production and Teams only (${pills})`);
    await sweepTv.close();
    const j = await feed();
    check(j.pcEnabled === false && j.team.pcCents === 0 && j.agents.every((x) => x.pcCents === 0) && j.scoreboard.kpis.productionCents === totalCents() && j.team.lifeCents === totalCents(), `${when}: the feed counts life only, to the cent (${dollars(j.team.lifeCents)})`);
  };
  await lifeOnlySweep("before the P&C board is on");

  // --- The owner's P&C board: off by default, one switch at the bottom of Settings brings it back ---
  {
    await go(o, "/settings", "[data-other-lines] [role=switch]");
    check((await o.getAttribute("[data-other-lines] [role=switch]", "aria-checked")) === "false" && (await o.locator("[data-owner-only-settings] [data-other-lines] [role=switch]").count()) === 1, "the P&C board switch is on the owner's own card of Settings, off to start");
    await o.click("[data-other-lines] [role=switch]");
    check((await appears(o, "text=On. P&C and the agency total are back on every screen.")) && (await feedUntil((j) => j.pcEnabled === true)).pcEnabled === true, "the owner turns the P&C board on");
    // P&C has a goal of its own (owner, 2026-11-04): this month's, next to the life goal
    await go(o, "/settings", "input[name=pc_goal]");
    await o.locator("input[name=pc_goal]").first().fill("30000");
    await o.locator("form:has(input[name=pc_goal])").first().locator("button[type=submit]").click();
    await o.waitForSelector("text=P&C goal saved. The board shows it now.");
    check((await feedUntil((j) => j.team.pcGoalCents === 3_000_000)).team.pcGoalCents === 3_000_000, "the P&C goal saves and the feed carries it");
    // P&C color (owner, 2026-11-04): Dusty blue by default; Silver, Sage and Ocean in Settings
    const pcColors = "[role=radiogroup][aria-label='P&C color']";
    check((await o.locator(`${pcColors} [role=radio]`).count()) === 4 && (await o.textContent(`${pcColors} [role=radio][aria-checked=true]`)).includes("Dusty blue"), "Settings offers four P&C colors, Dusty blue to start");
    check((await o.getAttribute("html", "data-pc-color")) === "dusty" && (await cssVar(o, "--t-pc")) === "#86a6d6", "every screen draws P&C in dusty blue by default (the dark look)");
    await o.click(`${pcColors} [role=radio]:has-text('Sage')`);
    check((await feedUntil((j) => j.pcColor === "sage")).pcColor === "sage", "the board feed carries the P&C color");
    await o.goto(`${APP}/`);
    check((await o.getAttribute("html", "data-pc-color")) === "sage" && (await cssVar(o, "--t-pc")) === "#8fc1a9", "the P&C color setting colors the next screen (sage, dark)");
    await go(o, "/settings", "input[name=pc_goal]");
    await o.click(`${pcColors} [role=radio]:has-text('Dusty blue')`);
    check((await feedUntil((j) => j.pcColor === "dusty")).pcColor === "dusty", "back to dusty blue");
    const withPc = (await o.locator(`${tvScreens} [role=radio] span.min-w-0 > span:first-child`).allTextContents()).map((s) => s.trim());
    check(withPc.join(",") === "Rotate,Leaderboard,Scoreboard,Production,Teams,P&C only,Agency total only", `with P&C on, Settings offers the P&C and agency total screens too (${withPc.join(", ")})`);

    // P&C alongside life (2026-11-04): the owner marks Gus P&C licensed and gives him a P&C goal; a P&C sale counts on P&C and in the total, never on Life
    const sheet = await openEditor(o, GUS);
    await sheet.locator(`[role=switch][aria-label="${GUS} is P&C licensed"]`).click();
    await o.waitForSelector("text=P&C licensed. Log a sale offers");
    check(true, "the owner marks Gus P&C licensed on the People page");
    await sheet.locator("input[name=pc_goal]").waitFor();
    await sheet.locator("input[name=pc_goal]").fill("5000");
    await sheet.locator("form:has(input[name=pc_goal]) button[type=submit]").click();
    await o.waitForSelector("text=P&C goal saved.");
    check(true, "a P&C licensed person gets their own P&C goal on the People page");
    // A P&C sale for Gus (Log a sale's three steps are life only): through the Shortcut, else straight into the test database
    const gusLife = dollars(centsOf(GUS));
    const gusTotal = dollars(centsOf(GUS) + 186_000);
    if (TOKEN) {
      const pcFirst = await owner.request.post(`${APP}/api/sales`, { headers: { authorization: `Bearer ${TOKEN}` }, data: { agent: "Gus", premium: "1,860", kind: "pc", carrier: "progressive", product: "auto" } });
      check(pcFirst.ok() && (await pcFirst.json()).sale.carrier === "Progressive", `with P&C on, the Shortcut logs a P&C sale for someone P&C licensed (${pcFirst.status()})`);
    } else {
      sql(`insert into sales (agent_id, premium_cents, policies, product, carrier, kind, sold_on, logged_by, source, status) values ('${ID[GUS]}', 186000, 1, 'Auto', 'Progressive', 'pc', (now() at time zone 'America/Detroit')::date, 'owner', 'scorecard', 'Submitted')`);
    }
    check((await feedUntil((j) => j.agents.find((p) => p.id === ID[GUS])?.pcCents === 186_000)).agents.find((p) => p.id === ID[GUS])?.pcCents === 186_000, "the P&C sale counts on Gus's P&C");
    await o.goto(`${APP}/`);
    await o.waitForSelector("[data-kpi=Production]");
    // The goal is life (owner, 2026-11-04): Home opens on Life, where Gus's P&C does not count
    check((await o.locator("nav[aria-label=View] a").count()) === 3 && (await o.textContent("nav[aria-label=View] a[aria-current=page]")).includes("Life"), "Home opens on Life, with Life, P&C and Total to switch");
    const lifeGus = (await o.locator(`[data-leaderboard-home] li[data-person="${ID[GUS]}"]`).first().textContent()) ?? "";
    check(lifeGus.includes(gusLife) && !lifeGus.includes(gusTotal), `the Life view counts life only (Gus: ${gusLife} of life, his P&C left out)`);
    await o.click("nav[aria-label=View] a:has-text('Total')");
    await o.waitForSelector("text=Agency leaderboard");
    const totalHome = await o.textContent("body");
    const gusRow = await o.locator(`li:has-text("${GUS}")`).first().textContent();
    check(totalHome.includes("Agency total") && totalHome.includes("P&C $1,860") && gusRow.includes(gusTotal) && gusRow.includes(`Life ${gusLife} · 1`) && gusRow.includes("P&C $1,860 · 1"), "the Total view adds life and P&C up and splits them on Gus's row");
    await o.click("nav[aria-label=View] a:has-text('P&C')");
    await o.waitForSelector("text=P&C leaderboard");
    const pcView = await o.textContent("body");
    const pcGus = await o.locator(`li:has-text("${GUS}")`).first().textContent();
    check(pcView.includes("P&C production") && pcView.includes("of $30,000") && pcGus.includes("$1,860") && pcGus.includes("37%") && pcGus.includes("Auto 1") && pcView.includes("By carrier") && pcView.includes("Progressive"), "the P&C view: its goal, Gus on the P&C board against his own P&C goal, his line, the carrier");
    check(!(await o.textContent("[data-board=pc]")).includes(THEO), "the P&C board leaves out people who are not P&C licensed");
    {
      const ph = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: "dark" });
      await ph.addCookies(await owner.cookies());
      const pp = await ph.newPage();
      await pp.goto(`${APP}/?view=pc`);
      await pp.waitForSelector("text=P&C leaderboard");
      await pp.screenshot({ path: `${OUT}/09b-phone-home-pc.png`, fullPage: true });
      await pp.goto(`${APP}/?view=total`);
      await pp.waitForSelector("text=Agency leaderboard");
      await pp.screenshot({ path: `${OUT}/09c-phone-home-total.png`, fullPage: true });
      await ph.close();
    }

    // The TV with P&C on
    const tv2 = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
    await tv2.addCookies(await owner.cookies());
    const t2 = await tv2.newPage();
    await t2.goto(`${APP}/board`);
    await t2.waitForSelector("main[data-screen]");
    // P&C color on the TV: dusty blue in dark by default, and a change in Settings arrives with the next poll
    check((await t2.getAttribute("html", "data-pc-color")) === "dusty" && (await cssVar(t2, "--t-pc")) === "#86a6d6", "the TV draws P&C in dusty blue by default (dark)");
    await go(o, "/settings", "input[name=pc_goal]");
    await o.click(`${pcColors} [role=radio]:has-text('Silver')`);
    check((await settles(t2, () => document.documentElement.getAttribute("data-pc-color") === "silver", 12000)) && (await cssVar(t2, "--t-pc")) === "#a5b4c8", "a P&C color change in Settings reaches the TV within a poll");
    await o.click(`${pcColors} [role=radio]:has-text('Dusty blue')`);
    check(await settles(t2, () => document.documentElement.getAttribute("data-pc-color") === "dusty", 12000), "and back to dusty blue on the TV");
    const tvLife = await t2.innerText("main");
    check((await t2.getAttribute("main", "data-screen")) === "life" && tvLife.toLowerCase().includes("life production") && [...(await t2.locator("[data-pill]").evaluateAll((els) => els.map((e) => e.getAttribute("data-pill"))))].join() === "life,scoreboard,production,teams,pc,total", "with P&C on the TV's leaderboard measures life and the rotation gains the P&C and agency total screens");
    if (TOKEN) {
      const post = (data) => owner.request.post(`${APP}/api/sales`, { headers: { authorization: `Bearer ${TOKEN}` }, data });
      const pcApi = await post({ agent: "Gus", premium: "2,000", kind: "pc", carrier: "geico", product: "umbrella" });
      const pcJson = pcApi.ok() ? await pcApi.json() : null;
      check(pcApi.ok() && pcJson.sale.kind === "pc" && pcJson.sale.carrier === "Geico", `Shortcut endpoint logs a P&C sale (${pcApi.status()})`);
      const pcNo = await post({ agent: "Theo", premium: "10", kind: "pc", carrier: "Progressive" });
      check(pcNo.status() === 400, "Shortcut endpoint refuses a P&C sale for someone not P&C licensed");
      const pcBad = await post({ agent: "Gus", premium: "10", kind: "pc", carrier: "AHL" });
      check(pcBad.status() === 400 && (await pcBad.json()).carriers.includes("Progressive"), "a P&C sale needs a P&C carrier");
      const lists = await (await owner.request.get(`${APP}/api/sales`, { headers: { authorization: `Bearer ${TOKEN}` } })).json();
      check(lists.pcPeople?.join() === GUS && lists.pcCarriers?.some((c) => c.name === "Geico"), "with P&C on the Shortcut endpoint lists the P&C people and carriers");
      await t2.waitForSelector("[role=status][data-sound]", { timeout: 15000 });
      const pcCheer = await t2.textContent("[role=status][data-sound]");
      check(pcCheer.includes(GUS) && pcCheer.includes("$2,000") && pcCheer.includes("P&C"), "the celebration of a P&C sale says P&C");
      await t2.waitForSelector("[role=status][data-sound]", { state: "detached", timeout: 30000 });
    }
    const pcTotalDollars = TOKEN ? 3860 : 1860;
    // Settings > TV screens: keep the TV on the agency total, then on P&C, then back to rotating
    await go(o, "/settings", `${tvScreens} [role=radio]`);
    await o.click(tvScreen("Agency total only"));
    check(await settles(t2, () => document.querySelector("main")?.dataset.screen === "total", 12000), "Agency total only in Settings puts the TV on the agency total within a poll");
    // innerText: what the screen shows (the split line is "Life" over "$6,240 · 1", "P&C" over its own)
    const totalText = (await t2.innerText("main")).replace(/\s+/g, " ");
    check(totalText.includes("Agency leaderboard") && /Life \$[\d,]+ · \d/.test(totalText) && /P&C \$[\d,]+ · \d/.test(totalText) && totalText.includes("Agency total · life + P&C") && totalText.includes("of $180,000 goal"), "the agency total screen adds life and P&C up against both goals and splits them");
    check((await t2.locator("[data-pill]").count()) === 1, "a kept screen shows only its own pill");
    await t2.screenshot({ path: `${OUT}/10c-board-total.png` });
    await o.click(tvScreen("P&C only"));
    check(await settles(t2, () => document.querySelector("main")?.dataset.screen === "pc", 12000), "P&C only puts the TV on the P&C screen within a poll");
    // innerText: what the screen shows (the page's own data script carries every name)
    const pcText = await t2.innerText("main");
    check(pcText.includes("P&C leaderboard") && pcText.includes(GUS) && pcText.includes("By carrier") && pcText.includes(TOKEN ? "Geico" : "Progressive") && pcText.includes("By line") && pcText.includes(TOKEN ? "Umbrella" : "Auto") && !pcText.includes(THEO), "the P&C screen: the P&C team, by carrier, by line, no one without P&C");
    const pcLower = pcText.toLowerCase(); // innerText follows the eyebrows' capitals
    check(pcLower.includes("p&c production") && pcLower.includes("of $30,000") && /ahead by|behind by|goal hit/.test(pcLower) && pcLower.includes("on pace for") && pcLower.includes("policies sold") && pcLower.includes("latest p&c sales") && pcText.includes(dollars(pcTotalDollars * 100)), "the P&C screen's right side is like the others: its goal, on pace for, the tiles, the latest sales");
    await t2.screenshot({ path: `${OUT}/10b-board-pc.png` });
    await o.click(tvScreen("Rotate"));
    check(await settles(t2, () => document.querySelector("main")?.dataset.screen === "life" && document.querySelectorAll("[data-pill]").length === 6, 12000), "Rotate brings the TV back to the leaderboard with all six pills");
    // The rotation with P&C on: the four screens, then P&C and the agency total for 20 s each
    await rotation("rotation with P&C on", ["life", "scoreboard", "production", "teams", "pc", "total"]);

    // Off again: the board is life insurance only, and the P&C sales that were logged stay out of every number
    await go(o, "/settings", "[data-other-lines] [role=switch]");
    await o.click(tvScreen("Agency total only"));
    await settles(t2, () => document.querySelector("main")?.dataset.screen === "total", 12000);
    await o.click("[data-other-lines] [role=switch]");
    check((await appears(o, "text=Off. Scorecard is life insurance only.")) && (await feedUntil((j) => j.pcEnabled === false)).pcEnabled === false, "the owner turns the P&C board off again");
    check((await feed()).tvScreens === "rotate", "a TV that was kept on the agency total goes back to rotating");
    check(await settles(t2, () => document.querySelector("main")?.dataset.screen !== "total" && !document.querySelector("[data-pill=pc]") && !document.querySelector("[data-pill=total]") && !/P&C|agency total/i.test(document.querySelector("main")?.innerText ?? ""), 12000), "the TV drops the P&C and agency total screens within a poll");
    await tv2.close();
    if (TOKEN) {
      const off = await owner.request.post(`${APP}/api/sales`, { headers: { authorization: `Bearer ${TOKEN}` }, data: { agent: "Gus", premium: "10", kind: "pc", carrier: "Geico" } });
      check(off.status() === 400, "with the switch off again the Shortcut endpoint refuses a P&C sale");
    }
    await o.goto(`${APP}/?view=total`);
    await o.waitForSelector("[data-kpi=Production]");
    const afterOff = (await o.locator(`[data-leaderboard-home] li[data-person="${ID[GUS]}"]`).first().textContent()) ?? "";
    check((await o.locator("nav[aria-label=View]").count()) === 0 && !afterOff.includes(gusTotal) && afterOff.includes(gusLife), "an old ?view=total link opens the life board: Gus is back to his life premium");
  }
  await lifeOnlySweep("after the P&C board is off again");

  // --- A full office (owner, 2026-11-12: "the ones in the office are like a group of like 27", "maybe 60 or 70" in all): 38 more people ---
  {
    const FIRST = ["Ada", "Ben", "Cal", "Dee", "Eli", "Fay", "Gil", "Hal", "Ida", "Jon", "Kit", "Lou", "Max", "Ned", "Ora", "Pat", "Quin", "Rae", "Sam", "Tess", "Uma", "Vic", "Wyn", "Xan", "Yul", "Zoe", "Abe", "Bea", "Cy", "Dot"];
    const LAST = ["Pine", "Reed", "Stone"];
    // The first 34 work in the office (40 with the six already there), the last four do not (seven with Wes, Ivy and Rhea).
    const crowd = Array.from({ length: 38 }, (_, i) => ({ name: `${FIRST[i % FIRST.length]} ${i < FIRST.length ? LAST[i % 3] : "Vale"}`, office: i < 34 }));
    const ALL = 9 + crowd.length;
    const IN_OFFICE = OFFICE.length + crowd.filter((c) => c.office).length;
    const OUTSIDE = ALL - IN_OFFICE;
    await go(o, "/team", "#new-name");
    for (const c of crowd) {
      await o.waitForFunction(() => document.querySelector("#new-name")?.value === "" && !document.querySelector("[data-add-person] button[type=submit]")?.textContent?.includes("Adding"));
      await o.fill("#new-name", c.name);
      const mark = o.locator("[data-add-person] [role=switch]");
      if (((await mark.getAttribute("aria-checked")) === "true") !== c.office) await mark.click();
      await o.click("[data-add-person] button[type=submit]");
      await o.waitForSelector(`text=${c.name} is on the board.`);
    }
    const big = await feedUntil((j) => j.agents.length === ALL);
    check(big.agents.length === ALL && big.agents.filter((x) => x.inOffice).length === IN_OFFICE, `${crowd.length} more people are on the board: ${IN_OFFICE} in the office, ${OUTSIDE} outside`);
    // Twenty of them sell (a Shortcut each), so the office group has both sellers and people with no sale yet
    if (TOKEN) {
      let landed = 0;
      for (let i = 0; i < 20; i++) {
        const amount = 500 + i * 137;
        const r = await owner.request.post(`${APP}/api/sales`, { headers: { authorization: `Bearer ${TOKEN}` }, data: { agent: crowd[i].name, premium: String(amount), carrier: "AHL", product: "Term" } });
        if (r.ok()) {
          landed++;
          sold(crowd[i].name, amount);
        }
      }
      check(landed === 20, `twenty of them log a sale (${landed})`);
    }
    const officeNames = [...OFFICE, ...crowd.filter((c) => c.office).map((c) => c.name)];
    const officeSellers = officeNames.filter((n) => ledger.has(n)).length;
    const quietOffice = IN_OFFICE - officeSellers;
    const crowdFeed = await feedUntil((j) => j.scoreboard?.kpis.activeAgents === ledger.size);
    check(crowdFeed.scoreboard.kpis.activeAgents === ledger.size && crowdFeed.scoreboard.kpis.productionCents === totalCents() && crowdFeed.team.lifeCents === totalCents() && crowdFeed.scoreboard.rows.length === ledger.size, `at that size the feed still adds up to what was logged (${dollars(totalCents())}, ${ledger.size} agents)`);
    // Home: a long board shows its top rows and "Show all"; all of it lists the office's sellers and folds the people with no sale yet
    await o.goto(`${APP}/`);
    await o.waitForSelector("[data-leaderboard-home] section[data-group='In the office']");
    const capped = await o.evaluate(() => ({ office: document.querySelectorAll("section[data-group='In the office'] li[data-person]").length, all: document.querySelector("[data-board-all]")?.textContent ?? "" }));
    check(capped.office <= 11 && capped.all.includes(`Show all ${ALL}`), `a long board on Home shows its top rows and "Show all ${ALL}" (${capped.office} office rows; "${capped.all.trim()}")`);
    await o.goto(`${APP}/?all=1`);
    await o.waitForSelector("[data-leaderboard-home] section[data-group='In the office']");
    const officeRows = () =>
      o.evaluate(() => {
        const office = document.querySelector("section[data-group='In the office']");
        return { all: office.querySelectorAll("li[data-person]").length, shown: [...office.querySelectorAll("li[data-person]")].filter((li) => li.checkVisibility()).length, fold: office.querySelector("details summary")?.innerText.replace(/\s+/g, " ") ?? "", others: document.querySelectorAll("section[data-group='Everyone else'] li[data-person]").length };
      });
    const folded = await officeRows();
    check(folded.all === IN_OFFICE && folded.shown === officeSellers && folded.fold.includes("Show everyone") && folded.fold.includes(`${quietOffice} with no sale yet`) && folded.others === OUTSIDE, `Home lists the office's ${officeSellers} sellers and folds the ${quietOffice} with no sale yet (${folded.shown} of ${folded.all} rows showing; "${folded.fold}")`);
    await o.click("section[data-group='In the office'] details summary");
    const opened = await officeRows();
    check(opened.shown === IN_OFFICE && opened.fold.includes("Show less"), `Show everyone opens the rest of the office group (${opened.shown} rows showing)`);
    await o.screenshot({ path: `${OUT}/24-home-full-office.png`, fullPage: true });
    {
      const ph = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
      await ph.addCookies(await owner.cookies());
      const pp = await ph.newPage();
      for (const [what, path, ready] of [
        ["Home", "/", "section[data-group]"],
        ["Scoreboard", "/scoreboard", "[data-scoreboard]"],
        ["People", "/team", "input[aria-label='Find a person']"],
        ["Log a sale", "/log", "#premium"],
        ["Policies", "/policies", "[data-policies]"],
      ]) {
        await pp.goto(`${APP}${path}`);
        await pp.waitForSelector(ready);
        check(!(await pp.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)), `with ${ALL} people the phone's ${what} has no sideways scroll`);
      }
      await pp.goto(`${APP}/`);
      await pp.waitForSelector("[data-kpi=Production]");
      await pp.screenshot({ path: `${OUT}/24b-phone-home-full-office.png`, fullPage: true });
      await ph.close();
    }
    // The TV at that size: the office group in three columns, a page at a time, the second page taking its turn
    const tv3 = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
    await tv3.addCookies(await owner.cookies());
    const t3 = await tv3.newPage();
    await t3.goto(`${APP}/board`);
    await t3.waitForSelector("main section[data-group=office]");
    const officeOf = () =>
      t3.evaluate(() => {
        const s = document.querySelector("main section[data-group=office]");
        const rows = [...s.querySelectorAll("li[data-person]")];
        return { pages: s.getAttribute("data-pages"), title: s.querySelector("h2")?.parentElement?.innerText.replace(/\s+/g, " ") ?? "", rows: rows.length, columns: new Set(rows.map((li) => Math.round(li.getBoundingClientRect().left))).size, firstPlace: rows[0]?.getAttribute("data-place"), dots: s.querySelector("[aria-label^='Page ']")?.getAttribute("aria-label") ?? "", others: document.querySelectorAll("main section[data-group=others] li[data-person]").length, otherPages: Number(document.querySelector("main section[data-group=others]")?.getAttribute("data-pages") ?? 0) };
      });
    await settles(t3, () => document.querySelector("main section[data-group=office] [aria-label^='Page ']")?.getAttribute("aria-label") === "Page 1 of 2", 5000);
    const page1 = await officeOf();
    check(page1.pages === "2" && page1.rows >= 24 && page1.rows < IN_OFFICE && page1.rows % 3 === 0 && page1.columns === 3 && page1.title.startsWith(`In the office ${IN_OFFICE} people · ${officeSellers} sold`) && page1.dots === "Page 1 of 2" && page1.firstPlace === "1" && page1.others >= 1 && page1.others * page1.otherPages >= OUTSIDE, `the TV shows the office group a page at a time in three columns (${page1.title}; ${page1.rows} rows, ${page1.columns} columns, ${page1.dots}; everyone else ${page1.others} a page over ${page1.otherPages} pages)`);
    check(await fits(t3, "section[data-group], li[data-person]"), `a full page of the office group (${page1.rows} rows) and everyone else fit the TV at 1920x1080`);
    const cut = await t3.evaluate(() => [...document.querySelectorAll("main li[data-person] p")].filter((el) => el.scrollWidth > el.clientWidth + 1).map((el) => el.textContent).slice(0, 5));
    check(cut.length === 0, `no name or amount on the TV's leaderboard is cut off${cut.length ? ` (${cut.join(", ")})` : ""}`);
    await t3.screenshot({ path: `${OUT}/25-board-full-office.png` });
    check(await settles(t3, () => document.querySelector("main section[data-group=office] [aria-label^='Page ']")?.getAttribute("aria-label") === "Page 2 of 2", 14000), "the second page of the office group takes its turn after eight seconds");
    const page2 = await officeOf();
    check(page2.rows === IN_OFFICE - page1.rows && (await fits(t3, "section[data-group], li[data-person]")), `and holds the rest (${page2.rows} rows)`);
    // The other screens at that size
    await go(o, "/settings", `${tvScreens} [role=radio]`);
    const keep3 = async (label, screen) => {
      await o.click(tvScreen(label));
      return settles(t3, (s) => document.querySelector("main")?.dataset.screen === s, 12000, screen);
    };
    check((await keep3("Production", "production")) && (await settles(t3, (n) => document.querySelectorAll("main li[data-row]").length === n, 3000, Math.min(15, ledger.size))), `Production shows the first ${Math.min(15, ledger.size)} of ${ledger.size} sellers (15 rows a page)`);
    check((await fits(t3, "li[data-row]")) && (ledger.size <= 15 || (await t3.locator("main [aria-label='Page 1 of 2']").count()) === 1), "the Production screen's page fits the TV, with its page dots");
    await t3.waitForTimeout(900); // the page's fade-in
    await t3.screenshot({ path: `${OUT}/25b-board-production-full.png` });
    check((await keep3("Scoreboard", "scoreboard")) && (await fits(t3, "[data-kpi], [data-card]")) && (await t3.innerText("main [data-kpi='Active agents']")).replace(/\s+/g, " ").includes(` ${ledger.size} `) && (await t3.innerText("main [data-kpi='Production']")).includes(tvMoney(totalCents())), `the Scoreboard screen fits and counts ${ledger.size} agents and ${tvMoney(totalCents())}`);
    check((await keep3("Teams", "teams")) && (await fits(t3, "li[data-team]")), "the Teams screen fits");
    await o.click(tvScreen("Rotate"));
    check(await settles(t3, () => document.querySelectorAll("[data-pill]").length === 4, 12000), "and the TV goes back to rotating");
    await tv3.close();
    // The Scoreboard page at that size
    await o.goto(`${APP}/scoreboard`);
    await o.waitForSelector("[data-scoreboard=agency]");
    const bigPage = await o.evaluate(() => ({ production: document.querySelector("section[data-kpi=Production] p.font-mono")?.textContent?.trim(), agents: document.querySelector("section[data-kpi='Active agents'] p.font-mono")?.textContent?.trim(), rows: document.querySelectorAll("[data-leaderboard=agents] tbody tr[data-agent]").length }));
    check(bigPage.production === shortMoney(totalCents()) && bigPage.agents === String(ledger.size) && bigPage.rows === ledger.size, `the Scoreboard page lists all ${ledger.size} sellers (${bigPage.production})`);
    await saysNoPc(o, "with a full office: the Scoreboard");
  }

  await priya.close();
  await nora.ctx.close();
  await theo.ctx.close();
  await dana.close();
  await owner.close();
} catch (err) {
  // A step that never came (a button or a line that did not show): say where, and count it.
  failures++;
  console.log(`FAIL the run stopped: ${String(err?.message ?? err).split("\n").slice(0, 3).join(" | ")}`);
  console.log(
    String(err?.stack ?? "")
      .split("\n")
      .filter((l) => l.includes("smoke.mjs"))
      .slice(0, 3)
      .join("\n"),
  );
} finally {
  await browser.close();
}
const seconds = Math.round((Date.now() - started) / 1000);
console.log(failures ? `\n${failures} of ${checks} checks FAILED (${seconds} s)` : `\nall ${checks} checks passed (${seconds} s)`);
process.exit(failures ? 1 : 0);
