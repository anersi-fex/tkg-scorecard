// End-to-end smoke test against a running app (invented people only). It walks the release the
// way an agency meets it: the owner signs in with the owner password, adds people, sets a goal,
// sends the join link; people join and sign in with their own number; a member, an admin and the
// shared team password each do what their level allows; the Scoreboard, the teams and the office
// group are checked against the sales the test logged; the TV's screens, its rotation and its
// feed stamp; the owner's P&C switch (off by default: no screen may name P&C before it is turned
// on or after it is turned off again); and last a full office, 46 people, on Home, the phone and
// the TV. Screenshots go to test-results/. With no LOG_TOKEN the Shortcut steps are skipped and
// the numbers are smaller; everything else still runs.
// Run it on a fresh database:
//   scripts/local-db/start.sh --reset
//   set -a; . .local-db/env; set +a
//   OWNER_PASSWORD=owner-pass TEAM_PASSWORD=team-pass LOG_TOKEN=abcdefghijklmnop APP_URL=http://localhost:3000 npm run build && npm start
//   APP=http://localhost:3000 OWNER_PASSWORD=owner-pass TEAM_PASSWORD=team-pass LOG_TOKEN=... node scripts/smoke.mjs
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
 * Waits until React has taken over an element. The sign-in, join, profile and settings forms
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
/** A CSS custom property as the page resolves it on <html> ("#4a6fa3"). */
const cssVar = (page, name) => page.evaluate((n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim(), name);

/** Today in Detroit as [year, month, day] (the sandbox's own clock may sit in another zone). */
const detroitToday = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Detroit" }).split("-").map(Number);
/** Detroit dates walked back from today in UTC arithmetic, so the sandbox's zone never shifts a weekday. */
const daysBack = (stop) => {
  const [y, m, d] = detroitToday();
  const t = new Date(Date.UTC(y, m - 1, d));
  do t.setUTCDate(t.getUTCDate() - 1);
  while (!stop(t.getUTCDay()));
  return t.toISOString().slice(0, 10);
};
/** The Detroit date of the last weekday before today. */
const lastBusinessDay = () => daysBack((w) => w !== 0 && w !== 6);
/** The Detroit date of the Sunday before this week's Monday: always an earlier week. */
const lastSunday = () => daysBack((w) => w === 0);

// Invented people. The first four work in the office; the last three do not. Two more join by
// link: Dana (new, under Ivy, in the office) and Ivy herself (claims her row by typing her name).
const NORA = "Nora Vance";
const THEO = "Theo Marsh";
const PRIYA = "Priya Nolan";
const GUS = "Gus Hartley";
const LENA = "Lena Ortiz";
const WES = "Wes Calder";
const IVY = "Ivy Brandt";
const DANA = "Dana Whitlow";
const PEOPLE = [
  [NORA, true],
  [THEO, true],
  [PRIYA, true],
  [GUS, true],
  [LENA, false],
  [WES, false],
  [IVY, false],
];
const PHONE = { [DANA]: "248 555 0142", [IVY]: "248 555 0143", [PRIYA]: "248 555 0144" };

// What the test logged and still stands, this month, life only: the numbers every screen must show.
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
const centsOf = (...names) => names.reduce((s, n) => s + (ledger.get(n)?.cents ?? 0), 0);
const totalCents = () => centsOf(...ledger.keys());
const totalPolicies = () => [...ledger.values()].reduce((s, e) => s + e.policies, 0);
/** The most production among these names (ties never happen in this run). */
const topOf = (names) => names.filter((n) => ledger.has(n)).sort((a, b) => centsOf(b) - centsOf(a))[0];
/** "$12,450": the app's whole dollars. */
const dollars = (cents) => `$${Math.round(cents / 100).toLocaleString("en-US")}`;
/** "$91.6K", "$950": the short money on the Scoreboard's top cards. */
const shortMoney = (cents) => {
  const d = Math.abs(cents) / 100;
  const one = (n) => (Math.round(n * 10) / 10).toFixed(1).replace(/\.0$/, "");
  if (d >= 999_950) return `$${one(d / 1_000_000)}M`;
  if (d >= 1_000) return `$${one(d / 1_000)}K`;
  return `$${Math.round(d)}`;
};
/** The TV's short money: always one decimal past a thousand ("$57.0K"). */
const tvMoney = (cents) => {
  const d = Math.abs(cents) / 100;
  if (d >= 999_950) return "$" + (d / 1_000_000).toFixed(1) + "M";
  if (Math.round(d) >= 1000) return "$" + (d / 1000).toFixed(1) + "K";
  return "$" + Math.round(d);
};

// Words no screen may show while the owner's P&C switch is off (the contract's decision 8).
const PC_WORDS = /P&C|agency total|life \+ P&C/i;
/**
 * What the page says to a person: the words on screen, the page's title, and the labels a screen
 * reader speaks (aria-label, title, placeholder, alt). Left out: the owner's own last row of
 * Settings, the one switch that names P&C.
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
/** Log a sale: picks the person in the picker (after Change when someone is preselected). */
async function pickWho(page, who) {
  // The person kept from the last visit shows right after React takes over: give that one beat.
  await page.waitForTimeout(150);
  const change = page.locator("[data-who] button:has-text('Change')");
  if (await change.count()) await change.click();
  await page.fill("input[aria-label='Find who sold it']", who);
  await page.click(`[role=radiogroup][aria-label='Who sold it'] [role=radio]:has-text("${who}")`);
}
async function logSale(page, who, premium, product, carrier, more) {
  await go(page, "/log", "#premium");
  if (who) await pickWho(page, who);
  await page.fill("#premium", premium);
  if (product) await page.click(`button[aria-pressed]:has-text("${product}")`);
  await page.click(`[role=radiogroup][aria-label=Carrier] [role=radio]:has-text("${carrier}")`);
  if (more) await more();
  await page.click("button[type=submit]:has-text('Log')");
  await page.waitForSelector("h2:has-text('Logged')");
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
async function replay(ctx, shot, body) {
  const headers = { origin: new URL(APP).origin };
  for (const k of ["next-action", "content-type", "accept", "next-router-state-tree", "next-url"]) if (shot.headers[k]) headers[k] = shot.headers[k];
  const res = await ctx.request.post(shot.url, { headers, data: body ?? shot.body });
  return { status: res.status(), text: await res.text() };
}

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
  check(o.url() === `${APP}/`, "owner signs in and lands on This month");
  await o.goto(`${APP}/login?next=/board`);
  check(o.url() === `${APP}/board`, "signed in, /login?next=/board goes straight to the board");
  await o.goto(`${APP}/`);
  await o.screenshot({ path: `${OUT}/01-home-empty.png`, fullPage: true });

  // People: seven people added by hand, four of them in the office
  await go(o, "/team", "#new-name");
  check((await o.textContent("h1")).includes("People"), "the Team page is called People");
  for (const [name, office] of PEOPLE) {
    await o.waitForFunction(() => document.querySelector("#new-name")?.value === "" && !document.querySelector("#new-name")?.disabled);
    await o.fill("#new-name", name);
    const mark = o.locator("[data-add-person] [role=switch]");
    if (((await mark.getAttribute("aria-checked")) === "true") !== office) await mark.click();
    await o.click("[data-add-person] button[type=submit]");
    await o.waitForSelector(`text=${name} is on the board.`);
  }
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
  });
  await o.waitForSelector("text=Goal saved. The board shows it now.");
  check((await o.locator("input[name=pc_goal]").count()) === 0 && (await o.locator("[role=radiogroup][aria-label='P&C color']").count()) === 0, "Settings has no P&C goal and no P&C color while the P&C board is off");
  await o.fill("#message", "Finish strong. Every policy counts.");
  await o.locator("form:has(#message) button[type=submit]").click();
  await o.waitForSelector("text=Saved. The board updates");
  check((await o.getAttribute("html", "data-colorway")) === "crimson", "Crimson is the default colorway");
  await o.click("[role=radio]:has-text('Emerald')");
  await o.waitForSelector("text=Saved. The TV changes");
  await o.goto(`${APP}/`);
  check((await o.getAttribute("html", "data-colorway")) === "emerald", "the colorway setting colors the next screen");
  check((await feed()).colorway === "emerald", "the board feed carries the colorway");
  await go(o, "/settings", "input[name=goal]");
  await o.click("[role=radio]:has-text('Crimson')");
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
  const screenRows = (await o.locator(`${tvScreens} [role=radio] span.block:first-child`).allTextContents()).map((s) => s.trim());
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
  check(afterDana.agents.length === 8 && danaLine?.inOffice === true && danaLine?.uplineId === ID[IVY], "the new person is on the board, in the office, on the team of the upline they picked");
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
  // Joining with the name of someone already on the board who has no sign-in claims that row
  const ivy = await newVisitor();
  const iv = await ivy.newPage();
  await go(iv, joinPath, "form[data-join=agency]");
  await iv.fill("#name", IVY.toLowerCase());
  await iv.fill("#phone", PHONE[IVY]);
  await iv.click("form[data-join] button:has-text(\"I'm not sure\")");
  await iv.fill("#password", "ivy-first-pass");
  await Promise.all([iv.waitForURL((u) => u.pathname === "/install"), iv.click("form[data-join] button[type=submit]")]);
  check((await iv.textContent("h1")) === "Welcome, Ivy.", "someone already on the board joins under the name they were added with");
  const afterIvy = await feed();
  check(afterIvy.agents.length === 8 && afterIvy.agents.filter((p) => p.name.toLowerCase() === IVY.toLowerCase()).length === 1 && afterIvy.agents.find((p) => p.name === IVY)?.id === ID[IVY], "a name that matches an unclaimed person claims that row (no second Ivy Brandt)");
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

  // --- Sales through the form (the owner logs for anyone) ---
  await go(o, "/log", "#premium");
  await o.screenshot({ path: `${OUT}/04-log-empty.png`, fullPage: true });
  check((await o.locator("[role=radiogroup][aria-label='What kind']").count()) === 0, "Log a sale has no Life / P&C switch");
  const sales = [
    [THEO, "12450", "Term", "Americo"],
    [PRIYA, "8200.50", "Whole life", "Foresters"],
    [NORA, "15000", "IUL", "AHL"],
    [GUS, "6100", "Final expense", "Royal"],
    [THEO, "9300", "Term", "UHL"],
    [LENA, "4350", "", "AmAm"],
  ];
  for (const [who, premium, product, carrier] of sales) {
    await logSale(o, who, premium, product, carrier);
    sold(who, Number(premium));
  }
  check(true, "six sales logged through the form, each with a carrier");
  await o.screenshot({ path: `${OUT}/05-log-done.png`, fullPage: true });

  // Undo the last one, then log it again
  await o.click("button:has-text('Oops, take it back')");
  await o.waitForSelector("#premium");
  check(true, "undo after logging works");
  // This call (the owner logging for Lena) is kept: a member sends the very same one further down.
  const logShot = await actionShot(o, () => logSale(o, LENA, "4350", "", "AmAm"), '_premium"');

  await go(o, `/log?agent=${ID[GUS]}`, "#premium");
  check((await o.textContent("[data-who]")).includes(GUS), "a desk link opens Log a sale with the person picked");
  await o.fill("#premium", "500");
  check(await o.locator("form:has(#premium) button[type=submit]").isDisabled(), "no carrier keeps the button off");
  // A sale with a bad amount is refused
  await go(o, `/log?agent=${ID[GUS]}`, "#premium");
  await o.fill("#premium", "12.345");
  check(await o.locator("form:has(#premium) button[type=submit]").isDisabled(), "a bad amount keeps the button off");

  // Home shows the month
  await o.goto(`${APP}/`);
  await o.waitForSelector("text=Leaderboard");
  const body = await o.textContent("body");
  check(body.includes("$55,401") || body.includes("$55,400"), `team production shows on Home (${body.match(/\$5\d,\d{3}/)?.[0]})`);
  check(body.includes("of $150,000"), "goal shows on Home");
  check(body.includes(THEO), "leader on Home");
  check(body.includes("Americo") && body.includes("Foresters"), "the sales rows on Home name the carrier");
  check((await o.locator("nav[aria-label=View]").count()) === 0, "Home has no Life / P&C / Total switch");
  await o.screenshot({ path: `${OUT}/06-home.png`, fullPage: true });
  // Home and the TV draw the goal-line legend only once a business day of the month has passed: never on a month's first weekend.
  const tick = (await feed()).clock.elapsed > 0;
  check((await o.innerText("body")).includes("goal line today") === tick, tick ? "Home names the goal line tick" : "Home hides the goal line tick before the month's first business day");

  // Owner fixes a sale and removes one
  await o.locator("button[aria-label=More]").first().click();
  await o.click("button:has-text('Fix this sale')");
  await o.fill("#e-premium", "4400");
  await o.click("form:has(#e-premium) button:has-text('Save')");
  await o.waitForSelector("text=$4,400");
  check(true, "owner fixed a sale");
  o.once("dialog", (dlg) => dlg.accept());
  await o.locator("button[aria-label=More]").first().click();
  await o.click("button:has-text('Remove')");
  await o.waitForSelector("text=Removed.");
  check(true, "owner removed a sale");
  unsold(LENA, 4350);

  // --- A member: logs for themselves only, takes back their own sale, cannot reach the admin screens ---
  await go(d, "/log", "#premium");
  const mine = await d.evaluate(() => ({ forWho: document.querySelector("[data-logging-for]")?.textContent ?? "", picker: !!document.querySelector("[data-who]") }));
  check(mine.forWho.includes(`Logging for ${DANA}`) && !mine.picker, "a member's Log a sale is for themselves, with no person picker");
  await d.goto(`${APP}/log?agent=${ID[THEO]}`);
  await d.waitForSelector("#premium");
  check((await d.textContent("[data-logging-for]")).includes(DANA) && (await d.locator("[data-who]").count()) === 0, "someone else's desk link still logs for the member themselves");
  await logSale(d, null, "3000", "Term", "AHL");
  await d.goto(`${APP}/`);
  await d.waitForSelector("text=Leaderboard");
  const danaRow = d.locator(`li:has(button[aria-label=More]):has-text("${DANA}")`);
  check((await danaRow.count()) === 1 && (await danaRow.textContent()).includes("$3,000") && (await feed()).agents.find((p) => p.id === ID[DANA])?.lifeCents === 300_000, "the member's sale shows on Home, under their own name");
  check((await d.locator("button:has-text('Fix this sale')").count()) === 0, "a member is offered no Fix on a sale");
  d.once("dialog", (dlg) => dlg.accept());
  await danaRow.locator("button[aria-label=More]").click();
  await d.click("button:has-text('Undo (just logged)')");
  check((await appears(d, "text=Removed.")) && (await feedUntil((j) => j.agents.find((p) => p.id === ID[DANA])?.lifeCents === 0)).agents.find((p) => p.id === ID[DANA])?.lifeCents === 0, "a member takes back their own sale");
  // Somebody else's sale: the menu offers the undo, the server refuses it
  d.once("dialog", (dlg) => dlg.accept());
  await d.locator(`li:has(button[aria-label=More]):has-text("${GUS}") button[aria-label=More]`).click();
  await d.click("button:has-text('Undo (just logged)')");
  check((await appears(d, "text=You can take back your own sales only.")) && (await feed()).agents.find((p) => p.id === ID[GUS])?.lifeCents === 610_000, "a member cannot take back someone else's sale");
  // The owner's "log a sale for Lena" call, sent with the member's session: the server logs it for the member
  {
    const forLena = await replay(dana, logShot);
    const landed = await feedUntil((j) => j.agents.find((p) => p.id === ID[DANA])?.lifeCents === 435_000);
    check(forLena.text.includes("Logged. The board is celebrating.") && landed.agents.find((p) => p.id === ID[DANA])?.lifeCents === 435_000 && landed.agents.find((p) => p.id === ID[LENA])?.lifeCents === 0, "a member who calls the log action with someone else's name logs the sale for themselves, never for the other person");
    await d.goto(`${APP}/`);
    await d.waitForSelector("text=Leaderboard");
    d.once("dialog", (dlg) => dlg.accept());
    await d.locator(`li:has(button[aria-label=More]):has-text("${DANA}") button[aria-label=More]`).click();
    await d.click("button:has-text('Undo (just logged)')");
    await feedUntil((j) => j.agents.find((p) => p.id === ID[DANA])?.lifeCents === 0);
  }
  await d.goto(`${APP}/settings`);
  await d.waitForURL(`${APP}/`);
  await d.goto(`${APP}/approvals`);
  await d.waitForURL(`${APP}/`);
  check(true, "a member cannot open Settings or Approvals");
  await d.click("button[aria-controls='account-menu']");
  check((await d.locator("#account-menu a[href='/settings']").count()) === 0 && (await d.locator("#account-menu a[href='/approvals']").count()) === 0 && (await d.locator("#account-menu a[href='/install']").count()) === 1, "a member's menu has the phone guide and no Settings or Approvals");
  // The goal's save call, sent with the member's session: refused by the action itself
  const asMember = await replay(dana, goalShot);
  check(asMember.text.includes("Only an admin can do that") && (await feed()).team.goalCents === 15_000_000, `a member who calls the goal's save action directly is refused and the goal stays (${asMember.status})`);
  await go(d, "/team", "input[aria-label='Find a person']");
  check((await d.locator("[data-join-card]").count()) === 0 && (await d.locator("button[aria-label^='Edit ']").count()) === 0 && (await d.locator("[data-add-person]").count()) === 0, "a member sees People without the join link, Edit or Add");
  check(!(await d.innerText("body")).includes("555"), "a member's People page shows no phone number");

  // A sale dated last month shows up in that month's own list, fixable there
  const [ty, tm] = detroitToday();
  const lastMonthDay = new Date(Date.UTC(ty, tm - 1, 1) - 86400000 * 3).toISOString().slice(0, 10);
  const lastMonth = lastMonthDay.slice(0, 7);
  await go(o, `/log?agent=${ID[IVY]}`, "#premium");
  await o.fill("#premium", "777");
  await o.click(`[role=radiogroup][aria-label=Carrier] [role=radio]:has-text("Newbridge")`);
  await o.click("button:has-text('Day and note')");
  await o.fill("#sold_on", lastMonthDay);
  await o.click("button[type=submit]:has-text('Log')");
  await o.waitForSelector("h2:has-text('Logged')");
  await o.goto(`${APP}/?month=${lastMonth}`);
  await o.waitForSelector("text=Leaderboard");
  check((await o.textContent("body")).includes("$777") && (await o.locator("button[aria-label=More]").count()) === 1, "a past month lists its own sales with the row menu");
  // A sale dated in the future is refused by the server (the day field's max already stops it in the browser)
  const tomorrow = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
  if (TOKEN) {
    const future = await owner.request.post(`${APP}/api/sales`, { headers: { authorization: `Bearer ${TOKEN}` }, data: { agent: IVY, premium: "5", carrier: "AHL", date: tomorrow } });
    check(future.status() === 400, `a sale dated in the future is refused (${future.status()})`);
  }
  // Past month view
  await o.goto(`${APP}/?month=2026-09`);
  await o.waitForSelector("text=September 2026");
  check(true, "past month opens");
  await o.goto(`${APP}/?month=20-99`);
  await o.waitForSelector("text=This month");
  check(true, "bad month falls back to this month");

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

  // --- The owner makes an admin, sets uplines and an office mark ---
  let priyaPath = "";
  {
    const sheet = await openEditor(o, PRIYA);
    o.once("dialog", (dlg) => dlg.accept());
    await sheet.locator("[data-admin-row] button").click();
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
    check((await feedUntil((j) => j.agents.find((p) => p.id === ID[name])?.uplineId === ID[NORA])).agents.find((p) => p.id === ID[name])?.uplineId === ID[NORA], `the owner puts ${name} on ${NORA}'s team`);
  }
  {
    const sheet = await openEditor(o, LENA);
    await sheet.locator(`[role=switch][aria-label="${LENA} works in the office"]`).click();
    check((await appears(o, "text=In the office: at the top of the boards.")) && (await feedUntil((j) => j.agents.find((p) => p.id === ID[LENA])?.inOffice === true)).agents.find((p) => p.id === ID[LENA])?.inOffice === true, "the owner marks a person in the office");
  }
  const OFFICE = [NORA, THEO, PRIYA, GUS, DANA, LENA];
  const OTHERS = [WES, IVY];

  // --- The admin: runs the board, never sees the owner's cards, asks before a past month changes ---
  await go(ad, "/settings", "input[name=goal]");
  const adminSettings = await ad.evaluate(() => ({ signIns: !!document.querySelector("[data-sign-ins]"), shortcut: !!document.querySelector("[data-shortcut]"), lines: !!document.querySelector("[data-other-lines]"), agency: !!document.querySelector("[data-agency-name] #agency_name"), text: document.body.innerText }));
  check(!adminSettings.signIns && !adminSettings.shortcut && !adminSettings.lines && adminSettings.agency && adminSettings.text.includes("Only the admins and Anersi see this screen."), "the admin's Settings has the goals and the board, and no Sign-ins, Shortcut or lines-of-business rows");
  check(!/OWNER_PASSWORD|TEAM_PASSWORD|LOG_TOKEN/.test(adminSettings.text) && !PC_WORDS.test(adminSettings.text), "the admin's Settings names no password, no token and no P&C");
  await ad.screenshot({ path: `${OUT}/20-admin-settings.png`, fullPage: true });
  await ad.goto(`${APP}/approvals`);
  await ad.waitForURL(`${APP}/`);
  check(true, "the admin cannot open the owner's Approvals");
  // This month's sale: fixed at once
  await ad.waitForSelector("text=Leaderboard");
  await ad.locator(`li:has(button[aria-label=More]):has-text("${GUS}") button[aria-label=More]`).click();
  await ad.click("button:has-text('Fix this sale')");
  await ad.fill("#e-premium", "6200");
  await ad.click("form:has(#e-premium) button:has-text('Save')");
  check((await appears(ad, "text=$6,200")) && (await feedUntil((j) => j.agents.find((p) => p.id === ID[GUS])?.lifeCents === 620_000)).agents.find((p) => p.id === ID[GUS])?.lifeCents === 620_000, "the admin fixes a sale of this month directly");
  unsold(GUS, 6100);
  sold(GUS, 6200);
  // A past month's sale: sent to the owner, nothing changes yet
  await ad.goto(`${APP}/?month=${lastMonth}`);
  await ad.waitForSelector("text=Leaderboard");
  await ad.locator("button[aria-label=More]").first().click();
  await ad.click("button:has-text('Fix this sale')");
  await ad.fill("#e-premium", "778");
  await ad.click("form:has(#e-premium) button:has-text('Save')");
  check(await appears(ad, "text=Sent to Anersi for a quick OK."), "the admin's change to a past month's sale says \"Sent to Anersi for a quick OK.\"");
  await ad.goto(`${APP}/?month=${lastMonth}`);
  await ad.waitForSelector("text=Leaderboard");
  const stillOld = await ad.textContent("body");
  check(stillOld.includes("$777") && !stillOld.includes("$778"), "and the sale is unchanged until the owner says yes");
  // Making an admin is the owner's call too
  {
    const sheet = await openEditor(ad, LENA);
    await sheet.locator("[data-admin-row] button").click();
    await sheet.locator("[data-role-note]").waitFor();
    check((await sheet.locator("[data-role-note]").textContent()).includes("Sent to Anersi for a quick OK."), "an admin who makes an admin is told it went to the owner");
    check((await sheet.locator("[data-sign-in]").count()) === 1 && (await ad.locator("[data-join-card]").count()) === 1, "the admin has the join link and the sign-in links for people");
  }
  // The owner's inbox
  await o.goto(`${APP}/approvals`);
  await o.waitForSelector("[data-approvals-waiting]");
  const asks = await o.locator("[data-approvals-waiting] li[data-approval]").evaluateAll((els) => els.map((e) => ({ id: e.getAttribute("data-approval"), text: e.textContent ?? "" })));
  const saleAsk = asks.find((x) => x.text.includes(`Fix ${IVY}'s $777 sale`) && x.text.includes("$778"));
  const roleAsk = asks.find((x) => x.text.includes(LENA));
  check(asks.length === 2 && !!saleAsk && !!roleAsk && asks.every((x) => x.text.includes(`${PRIYA} asked`)), `the owner's Approvals shows both requests, each in one sentence, with who asked (${asks.length})`);
  check((await appears(o, "[data-approvals-badge]", 5000)) && (await o.textContent("[data-approvals-badge]")).trim() === "2", "the owner's initials carry the count of what is waiting");
  await o.screenshot({ path: `${OUT}/21-approvals.png`, fullPage: true });
  const declineShot = await actionShot(o, () => o.click(`li[data-approval="${roleAsk?.id}"] button:has-text("Decline")`));
  check(await settles(o, () => document.querySelectorAll("[data-approvals-waiting] li[data-approval]").length === 1, 8000), "Decline answers a request and changes nothing");
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
  await o.waitForSelector("text=Leaderboard");
  check((await o.textContent("body")).includes("$777"), "and the past month's sale is still unchanged");
  // Approve: applied once
  await o.goto(`${APP}/approvals`);
  await o.waitForSelector(`li[data-approval="${saleAsk?.id}"]`);
  const oneLeft = await settles(o, () => document.querySelector("[data-approvals-badge]")?.textContent?.trim() === "1", 6000);
  await o.click(`li[data-approval="${saleAsk?.id}"] button:has-text("Approve")`);
  check(await settles(o, () => document.querySelectorAll("[data-approvals-waiting] li[data-approval]").length === 0 && document.body.innerText.includes("Nothing is waiting"), 8000), "Approve clears the inbox");
  check(oneLeft && (await settles(o, () => !document.querySelector("[data-approvals-badge]"), 6000)), "the count on the owner's initials goes from 1 to nothing");
  const decided = await o.textContent("[data-approvals-decided]");
  check(decided.includes("Approved") && decided.includes("Declined"), "the answered list keeps what was approved and what was declined");
  await o.goto(`${APP}/?month=${lastMonth}`);
  await o.waitForSelector("text=Leaderboard");
  const fixedOld = await o.textContent("body");
  check(fixedOld.includes("$778") && !fixedOld.includes("$777"), "the owner's yes applies the admin's fix to the past month's sale");
  const twice = await replay(owner, declineShot, JSON.stringify([saleAsk?.id, true]));
  check(twice.text.includes("That one was already answered."), "a request is answered once: approving it again says it was already answered");
  {
    const sheet = await openEditor(o, LENA);
    check((await sheet.locator("[data-admin-row]").textContent()).includes("Not an admin"), "the declined request left the person a member");
  }

  // --- The shared team password: still signs in, still opens the board, logs while the owner lets it ---
  const team = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, extraHTTPHeaders: { "x-forwarded-for": address() } });
  const m = await team.newPage();
  await signIn(m, TEAM);
  check(m.url() === `${APP}/`, "team password signs in");
  await m.goto(`${APP}/settings`);
  await m.waitForURL(`${APP}/`);
  check(true, "team cannot open Settings");
  await m.goto(`${APP}/board`);
  check((await appears(m, "main[data-screen]")) && m.url() === `${APP}/board`, "the team password still opens the TV board");
  await go(m, "/team", "input[aria-label='Find a person']");
  check((await m.locator("button[aria-label^='Edit ']").count()) === 0 && (await m.locator("[data-join-card]").count()) === 0, "team sees People without Edit or the join link");
  await go(m, "/me", "[data-me=shared]");
  check((await m.textContent("[data-me=shared]")).includes("You're on the team password."), "the team password has no profile, only the way to a sign-in of one's own");
  await logSale(m, IVY, "1999", "", "Royal");
  sold(IVY, 1999);
  check(true, "team logs a sale");
  await m.screenshot({ path: `${OUT}/13-phone-team-logged.png`, fullPage: true });
  await m.goto(`${APP}/`);
  await m.waitForSelector("text=Leaderboard");
  await m.locator("button[aria-label=More]").first().click();
  check(await m.locator("button:has-text('Undo (just logged)')").isVisible(), "team can undo a fresh sale from Home");
  check((await m.locator("button:has-text('Fix this sale')").count()) === 0, "team cannot fix a sale");
  // The owner's switch: off, the team password only looks
  await go(o, "/settings", "[data-team-password-logs] [role=switch]");
  check((await o.getAttribute("[data-team-password-logs] [role=switch]", "aria-checked")) === "true", "the team password logs sales until the owner turns that off");
  await o.click("[data-team-password-logs] [role=switch]");
  check(await appears(o, "text=The team password only looks now. People log with their own sign-in."), "the owner turns logging off for the team password");
  await m.goto(`${APP}/log`);
  await m.waitForSelector("text=The team password only looks now.");
  check((await m.locator("#premium").count()) === 0 && (await m.locator("button:has-text('Sign out and sign in with your own number')").count()) === 1, "with the switch off the team password's Log a sale only says how to sign in");
  await m.goto(`${APP}/`);
  await m.waitForSelector("text=Leaderboard");
  m.once("dialog", (dlg) => dlg.accept());
  await m.locator("button[aria-label=More]").first().click();
  await m.click("button:has-text('Undo (just logged)')");
  check((await appears(m, "text=The team password only looks now. Sign in with your own number to log a sale.")) && (await feed()).agents.find((p) => p.id === ID[IVY])?.lifeCents === 199_900, "and it cannot take a sale back either: view-only");
  await m.goto(`${APP}/board`);
  check(await appears(m, "main[data-screen]"), "view-only, the team password still opens the TV board");
  await m.goto(`${APP}/`);
  await m.click("button[aria-controls='account-menu']");
  await Promise.all([m.waitForURL(`${APP}/login`), m.click("#account-menu button:has-text('Sign out')")]);
  check(m.url() === `${APP}/login`, "sign out from the menu works");
  await team.close();

  // --- What else an owner and an admin reach for in the first week ---
  // A cell number never reaches a browser that is not a manager's: read from the page as it was sent, not only from what shows
  {
    const numbers = /555[-\s.)]*01(42|43|44)/;
    const sheet = await openEditor(o, DANA);
    check((await sheet.textContent()).includes("(248) 555-0142"), "a manager's People page shows a person's cell number");
    let sent = "";
    for (const path of ["/team", "/", "/scoreboard", "/log", "/wrap"]) {
      await d.goto(`${APP}${path}`);
      sent += await d.content();
    }
    check(sent.length > 50_000 && !numbers.test(sent), "nothing sent to a member's People, Home, Scoreboard, Log a sale or Wrap carries anybody's cell number");
    const looker = await newVisitor();
    const lk = await looker.newPage();
    await lk.goto(`${APP}${joinPath}`);
    const joinSent = await lk.content();
    check(joinSent.includes(NORA) && !numbers.test(joinSent), "the join page sends names for the upline picker and no cell number");
    const memberCsv = await dana.request.get(`${APP}/api/scoreboard/export`);
    check(memberCsv.status() === 200 && /text\/csv/.test(memberCsv.headers()["content-type"] ?? "") && !numbers.test(await memberCsv.text()), "a member downloads the Scoreboard's file too, with no cell number in it");
    // Home's Everyone | My team, for someone on a team
    await d.goto(`${APP}/`);
    await d.waitForSelector("nav[data-filter=team]");
    await Promise.all([d.waitForURL((u) => u.searchParams.get("team") === "mine"), d.click("nav[data-filter=team] a:has-text('My team')")]);
    await d.waitForSelector("nav[data-filter=team] a[aria-current=true]:has-text('My team')");
    const mineRows = await d.locator("section[data-group] li").evaluateAll((lis) => lis.map((li) => li.innerText.replace(/\s+/g, " ").trim()));
    check(mineRows.length === 2 && mineRows.some((r) => r.includes(IVY)) && mineRows.some((r) => r.includes(DANA)), `Home's My team lists the member's own team only (${mineRows.length} people)`);

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
    await o.click("[data-join-card] summary");
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
    await o.click("[data-join-card] summary");
    await o.selectOption("#join-leader", ID[NORA]);
    await o.waitForSelector("[data-team-link] code");
    const teamUrl = ((await o.textContent("[data-team-link] code")) ?? "").trim();
    await go(lk, new URL(teamUrl).pathname, "form[data-join=agency]");
    check(teamUrl !== freshUrl && (await lk.getAttribute("[data-upline]", "data-upline")) === ID[NORA] && (await lk.textContent("[data-upline]")).includes(NORA), "a link for one team opens the join page with that leader already picked");
    await looker.close();

    // Off the board: the person's sign-in stops working until they are back
    {
      const off = await openEditor(o, DANA);
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
      await go(o, "/team", "#new-name");
      await o.click(`li:has-text("${DANA}") button:has-text("Put back")`);
      await o.waitForSelector("text=Back on the board.");
      // Back on the board returns the sign-in they had: the phone that was signed in is signed in again.
      await d.goto(`${APP}/`);
      check(d.url() === `${APP}/` && (await feedUntil((j) => j.agents.length === 8)).agents.length === 8, "back on the board, the phone that was signed in is signed in again");
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
  }

  // --- Phone size (the owner's session) ---
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await phone.addCookies(await owner.cookies());
  const p = await phone.newPage();
  await p.goto(`${APP}/`);
  await p.waitForSelector("text=Leaderboard");
  await p.screenshot({ path: `${OUT}/07-phone-home.png`, fullPage: true });
  const overflow = await p.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  check(!overflow, "phone Home has no sideways scroll");
  // The dock (owner, 2026-11-04): its own strip at the very end of the page, the last row fully above it
  await p.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await p.waitForTimeout(250);
  const dock = await p.evaluate(() => {
    const nav = document.querySelector("nav[data-tabbar]").getBoundingClientRect();
    const rows = [...document.querySelectorAll("button[aria-label=More]")];
    const last = rows[rows.length - 1].getBoundingClientRect();
    return { navTop: nav.top, navBottom: nav.bottom, lastRowBottom: last.bottom, h: window.innerHeight };
  });
  check(dock.lastRowBottom <= dock.navTop && dock.navBottom <= dock.h + 1 && dock.navBottom >= dock.h - 1, `the dock sits in its own strip at the very bottom and the last row ends above it (row ${Math.round(dock.lastRowBottom)}, dock ${Math.round(dock.navTop)} to ${Math.round(dock.navBottom)} of ${dock.h})`);
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
  // The Wrap: today's top producer, everybody, the carriers; one iPhone screenshot above the tab bar,
  // measured on the fullest day: everyone who can sell today has sold.
  if (TOKEN) {
    for (const who of [LENA, IVY, WES]) {
      const r = await owner.request.post(`${APP}/api/sales`, { headers: { authorization: `Bearer ${TOKEN}` }, data: { agent: who, premium: "1,250", carrier: "Royal", product: "Term" } });
      check(r.ok(), `a sale for ${who} before the Wrap (${r.status()})`);
      if (r.ok()) sold(who, 1250);
    }
  }
  await p.goto(`${APP}/wrap`);
  await p.waitForSelector("text=Player of the day");
  const wrapText = await p.textContent("body");
  check(wrapText.includes(THEO) && wrapText.includes("$21,750"), "the Wrap names today's player of the day with the day's premium");
  check(wrapText.includes("Everybody today") && wrapText.includes("Best deal"), "the Wrap lists everybody and the best deal");
  check(wrapText.includes("Day won") || wrapText.includes("short of") || /(Saturday|Sunday)/.test(wrapText), "the Wrap judges the day against what the goal needed (or names the weekend)");
  const fit = await p.evaluate(() => ({ bottom: document.querySelector("[data-wrap-foot]").getBoundingClientRect().bottom, pill: document.querySelector("nav[data-tabbar] > div").getBoundingClientRect().top, height: window.innerHeight }));
  check(fit.bottom <= fit.pill - 8, `the Wrap fits one iPhone screenshot above the tab bar (ends at ${Math.round(fit.bottom)}px, the tab bar starts at ${Math.round(fit.pill)} of ${fit.height})`);
  const wrapSign = await p.evaluate(() => ({ sign: document.querySelector("[data-wrap-sign]")?.textContent ?? "", foot: document.querySelector("[data-wrap-foot]")?.textContent ?? "" }));
  check(`${wrapSign.sign} ${wrapSign.foot}`.includes(AGENCY), "the Wrap signs with the agency's name");
  // Royal leads only once the token's three Royal sales landed; AHL is in the top three either way.
  const square = TOKEN ? "Royal" : "AHL";
  check(wrapText.includes("Top carriers") && new RegExp(`${square}\\s*\\d+\\s*polic`).test(wrapText), "the Wrap shows the month's top carriers with their policy counts");
  check(wrapText.includes("Day") && wrapText.includes("Week") && wrapText.includes("Month"), "the Wrap offers Day, Week and Month");
  const wrapOverflow = await p.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  check(!wrapOverflow, "the Wrap has no sideways scroll");
  const tabs = await p.evaluate(() => {
    const pill = document.querySelector("nav[data-tabbar] > div");
    return { right: pill.getBoundingClientRect().right, links: [...pill.querySelectorAll("a")].map((l) => l.textContent.trim()), width: window.innerWidth };
  });
  check(tabs.links.join(",") === "This month,Scoreboard,Log a sale,Wrap,People" && tabs.right <= tabs.width, `the phone tab bar holds its five tabs inside the screen (${tabs.links.join(", ")}; ${Math.round(tabs.right)} of ${tabs.width}px)`);
  await p.screenshot({ path: `${OUT}/14-phone-wrap.png`, fullPage: true });
  // The week and the month: the same screen over a longer stretch, each still one screenshot
  const fitOf = async () => p.evaluate(() => ({ bottom: document.querySelector("[data-wrap-foot]").getBoundingClientRect().bottom, pill: document.querySelector("nav[data-tabbar] > div").getBoundingClientRect().top, height: window.innerHeight }));
  await p.goto(`${APP}/wrap?view=week`);
  await p.waitForSelector("text=Player of the week");
  const weekText = await p.textContent("body");
  check(weekText.includes("Everybody this week") && weekText.includes(THEO), "the week view lists everybody this week with its player");
  check(weekText.includes("Week won") || weekText.includes("short of") || weekText.includes("Weekend") || weekText.includes("Goal already hit"), "the week view judges the week against what the goal needed");
  const fitWeek = await fitOf();
  check(fitWeek.bottom <= fitWeek.pill - 8, `the week view fits one screenshot (ends at ${Math.round(fitWeek.bottom)}px, the tab bar starts at ${Math.round(fitWeek.pill)})`);
  await p.screenshot({ path: `${OUT}/14b-phone-wrap-week.png`, fullPage: true });
  await p.goto(`${APP}/wrap?view=month`);
  await p.waitForSelector("text=Player of the month");
  const monthText = await p.textContent("body");
  check(monthText.includes("Everybody this month") && /Ahead by|Behind by|On the goal line|Goal hit/.test(monthText), "the month view lists everybody this month and reads the month against the goal line");
  const fitMonth = await fitOf();
  check(fitMonth.bottom <= fitMonth.pill - 8, `the month view fits one screenshot (ends at ${Math.round(fitMonth.bottom)}px, the tab bar starts at ${Math.round(fitMonth.pill)})`);
  await p.screenshot({ path: `${OUT}/14c-phone-wrap-month.png`, fullPage: true });
  // An earlier week (anchored on last Sunday, always before this week) shows the This week pill and a live later arrow
  await p.goto(`${APP}/wrap?view=week&day=${lastSunday()}`);
  await p.waitForSelector("text=Player of the week");
  const earlierWeek = await p.evaluate(() => ({ text: document.body.textContent, later: document.querySelector("a[aria-label='Later week']")?.getAttribute("aria-disabled") }));
  check(earlierWeek.text.includes("Everybody that week") && earlierWeek.text.includes("This week") && earlierWeek.later === "false", "an earlier week opens with the This week pill and a live later arrow");
  // The last business day before today has no sales in this run
  await p.goto(`${APP}/wrap?day=${lastBusinessDay()}`);
  await p.waitForSelector("text=Player of the day");
  check((await p.textContent("body")).includes("No sales"), "a day without sales says so");
  await p.emulateMedia({ colorScheme: "dark" });
  await p.goto(`${APP}/wrap`);
  await p.waitForSelector("text=Player of the day");
  await p.screenshot({ path: `${OUT}/15-phone-wrap-dark.png`, fullPage: true });
  await p.goto(`${APP}/`);
  await p.waitForSelector("text=Leaderboard");
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
  check([kProd, kPol, kAct].every((k) => k.text.includes(`vs ${sb.compare.label}`)) && (gain === 0 || kProd.text.includes(shortMoney(gain))) && kProd.text.includes("Annual premium sold") && kPol.text.includes("Policies with premium") && kAct.text.includes("Agents who sold"), `each top number carries its chip against the same days of the month before ("vs ${sb.compare.label}")`);
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
  check(table.rows[0].id === ID[best] && table.rows[0].cells[0].startsWith("1") && table.rows[0].cells[0].includes(THEO) && rowOf(THEO).cells[0].includes(NORA), "the leaderboard is ranked by production, each agent under their upline's name");
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
  check(teamRows.length === 2 && !!noraTeam && noraTeam.text.includes(`${NORA}’s team`) && noraTeam.text.includes("3 people · 3 sold") && noraTeam.text.endsWith(dollars(centsOf(NORA, THEO, GUS))), `the Teams view adds up a leader's whole downline (${NORA}'s team: ${dollars(centsOf(NORA, THEO, GUS))})`);
  check(!!ivyTeam && ivyTeam.text.includes("2 people · 1 sold") && ivyTeam.text.endsWith(dollars(centsOf(IVY, DANA))), `and a team where only the leader sold (${IVY}'s team: ${dollars(centsOf(IVY, DANA))})`);
  await o.click(`[data-leaderboard=teams] button[aria-label="Show the people on ${NORA}'s team"]`);
  check(await settles(o, () => document.querySelectorAll("[data-leaderboard=teams] tbody tr[data-agent]").length === 3, 4000), "a team opens to show the people on it who sold");
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
  check(teamsCsv.includes(`"${NORA}'s team",3,3,`) && teamsCsv.includes(`,${(centsOf(NORA, THEO, GUS) / 100).toFixed(2)}\r\n`), "the teams export adds up the same team total");
  const badExports = await Promise.all(["month=2099-01", "who=x", "team=00000000-0000-4000-8000-000000000000"].map(async (q) => (await owner.request.get(`${APP}/api/scoreboard/export?${q}`)).status()));
  check(badExports.join() === "400,400,400", `the export refuses a month that has not started, an unknown table and a team that is nobody's (${badExports.join(", ")})`);
  // My team | Agency, for a member: her upline's team
  await d.goto(`${APP}/scoreboard`);
  await d.waitForSelector("[data-scoreboard=agency]");
  const whose = await d.locator("nav[aria-label='Whose numbers'] a").evaluateAll((links) => links.map((l) => `${l.textContent.trim()}${l.getAttribute("aria-current") === "true" ? "*" : ""}`).join(","));
  check(whose === "My team,Agency*", `a member gets My team | Agency, on Agency to start (${whose})`);
  check((await d.innerText("[data-scoreboard]")).includes("You're not on the board yet this month"), "a member with no sale this month is told so, with the way to log one");
  await d.click("nav[aria-label='Whose numbers'] a:has-text('My team')");
  await d.waitForSelector("[data-scoreboard=team]");
  const myTeam = await d.evaluate(() => ({ sub: document.querySelector("[data-scoreboard] h1 + p")?.textContent ?? "", production: document.querySelector("section[data-kpi=Production] p.font-mono")?.textContent?.trim(), rows: [...document.querySelectorAll("[data-leaderboard=agents] tbody tr[data-agent]")].map((tr) => tr.getAttribute("data-agent")) }));
  check(myTeam.sub.startsWith(`${IVY}'s team`) && myTeam.production === shortMoney(centsOf(IVY, DANA)) && myTeam.rows.join() === ID[IVY], `My team narrows every number to the member's team (${myTeam.sub.trim()}: ${myTeam.production})`);
  await d.click("nav[aria-label='Whose numbers'] a:has-text('Agency')");
  check(await appears(d, "[data-scoreboard=agency]"), "Agency widens it again");

  // --- The office group first (owner, 2026-11-12: "their numbers should be showing at the top") ---
  await o.goto(`${APP}/`);
  await o.waitForSelector("section[data-group]");
  const homeGroups = await o.locator("section[data-group]").evaluateAll((secs) => secs.map((s) => ({ title: s.getAttribute("data-group"), rows: [...s.querySelectorAll("li")].map((li) => li.innerText.replace(/\s+/g, " ").trim()) })));
  check(homeGroups.map((g) => g.title).join() === "In the office,Everyone else" && homeGroups[0].rows.length === OFFICE.length && homeGroups[1].rows.length === OTHERS.length && OFFICE.every((n) => homeGroups[0].rows.some((r) => r.includes(n))), `Home lists the office group first (${homeGroups.map((g) => `${g.title} ${g.rows.length}`).join(", ")})`);
  check(homeGroups[0].rows[0].startsWith("1 ") && homeGroups[0].rows[0].includes(topOf(OFFICE)) && homeGroups[1].rows[0].startsWith("1 ") && homeGroups[1].rows[0].includes(topOf(OTHERS)), `each group has ranks of its own on Home (1 ${topOf(OFFICE)}; 1 ${topOf(OTHERS)})`);
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
  } else {
    await logSale(o, WES, "2750", "Term", "Americo");
  }
  sold(WES, 2750);
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
    check(people.ok() && list.people.length === 8 && !("pcPeople" in list) && !("pcCarriers" in list), "Shortcut endpoint lists the people (and nothing about the other kind)");
    const bad = await post({ agent: "Nobody", premium: "100", carrier: "AHL" });
    check(bad.status() === 404, "Shortcut endpoint refuses an unknown person");
    const wrongTok = await post({ agent: "Theo", premium: "100", carrier: "AHL" }, "nope-nope-nope-nope");
    check(wrongTok.status() === 401, "Shortcut endpoint refuses a wrong token");
  } else {
    console.log("skip Shortcut endpoint (no LOG_TOKEN)");
  }
  await t.waitForSelector("[role=status][data-sound]", { state: "detached", timeout: 30000 });
  const tvMain = (await t.innerText("main")).toLowerCase(); // innerText: what the screen shows, in the eyebrows' capitals
  check((await t.getAttribute("main", "data-screen")) === "life" && tvMain.includes("in the office") && tvMain.includes("production") && tvMain.includes("latest sales") && tvMain.includes("goal line today") === tick, "the TV opens on the leaderboard, with the goal line legend once a business day has passed");
  check(!PC_WORDS.test(tvMain) && !tvMain.includes("life production") && !tvMain.includes("life leaderboard"), "the TV's leaderboard says nothing about P&C, an agency total or \"life\"");
  // Settings > TV screens: keep the TV on one screen
  await go(o, "/settings", `${tvScreens} [role=radio]`);
  const keep = async (label, screen) => {
    await o.click(tvScreen(label));
    return settles(t, (s) => document.querySelector("main")?.dataset.screen === s && document.querySelectorAll("[data-pill]").length === 1 && document.querySelector("[data-pill]")?.getAttribute("data-pill") === s, 12000, screen);
  };
  check(await keep("Scoreboard", "scoreboard"), "Scoreboard in Settings keeps the TV on the Scoreboard within a poll, with only its own pill");
  const tvKpis = await t.evaluate(() => Object.fromEntries([...document.querySelectorAll("main [data-kpi]")].map((el) => [el.getAttribute("data-kpi"), el.innerText.replace(/\s+/g, " ")])));
  check((tvKpis["Production"] ?? "").includes(tvMoney(totalCents())) && (tvKpis["Policies sold"] ?? "").includes(` ${totalPolicies()} `) && (tvKpis["Active agents"] ?? "").includes(` ${ledger.size} `), `the TV's Scoreboard shows the three top numbers the test logged (${tvMoney(totalCents())}, ${totalPolicies()} policies, ${ledger.size} agents)`);
  const tvScore = await t.innerText("main");
  check(tvScore.includes("Where agents stand") && tvScore.includes("Moved most this week") && tvScore.includes("Going up") && tvScore.includes(`vs ${sb.compare.label}`) && !PC_WORDS.test(tvScore), "the TV's Scoreboard has where agents stand and who moved most");
  check(await fits(t, "[data-kpi], [data-card]"), "the Scoreboard screen fits the TV at 1920x1080");
  await t.screenshot({ path: `${OUT}/10d-board-scoreboard.png` });
  check(await keep("Production", "production"), "Production keeps the TV on the day-by-day table");
  const tvRow1 = (await t.innerText('main li[data-row="1"]')).replace(/\s+/g, " ");
  check(tvRow1.includes(THEO) && tvRow1.includes("$21,750") && (await t.locator("main li[data-row]").count()) === ledger.size && !PC_WORDS.test(await t.innerText("main")), `the Production screen ranks everyone who sold (${ledger.size} rows, first ${THEO})`);
  check(await fits(t, "li[data-row]"), "the Production screen fits the TV at 1920x1080");
  await t.screenshot({ path: `${OUT}/10e-board-production.png` });
  check(await keep("Teams", "teams"), "Teams keeps the TV on the teams");
  const tvTeam = (await t.innerText(`main li[data-team="${ID[NORA]}"]`)).replace(/\s+/g, " ");
  check(tvTeam.includes(`${NORA}’s team`) && tvTeam.includes("3 people") && tvTeam.includes("3 sold") && tvTeam.includes(dollars(centsOf(NORA, THEO, GUS))) && (await t.locator("main li[data-team]").count()) === 2 && !PC_WORDS.test(await t.innerText("main")), `the TV's Teams screen adds up the leader's whole downline (${dollars(centsOf(NORA, THEO, GUS))})`);
  check(await fits(t, "li[data-team]"), "the Teams screen fits the TV at 1920x1080");
  await t.screenshot({ path: `${OUT}/10f-board-teams.png` });
  check(await keep("Leaderboard", "life"), "Leaderboard keeps the TV on the leaderboard");
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
      ["Home", "/", "text=Leaderboard"],
      ["Log a sale", "/log", "#premium"],
      ["People", "/team", "#new-name"],
      ["Settings", "/settings", "input[name=goal]"],
      ["the Wrap", "/wrap", "text=Player of the day"],
      ["the Wrap's month", "/wrap?view=month", "text=Player of the month"],
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
    check((await o.getAttribute("[data-other-lines] [role=switch]", "aria-checked")) === "false" && (await o.evaluate(() => [...document.querySelectorAll("section")].at(-1)?.hasAttribute("data-other-lines") === true)), "the P&C board switch is the last row of the owner's Settings, off to start");
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
    check((await o.getAttribute("html", "data-pc-color")) === "dusty" && (await cssVar(o, "--t-pc")) === "#4a6fa3", "every screen draws P&C in dusty blue by default");
    await o.click(`${pcColors} [role=radio]:has-text('Sage')`);
    check((await feedUntil((j) => j.pcColor === "sage")).pcColor === "sage", "the board feed carries the P&C color");
    await o.goto(`${APP}/`);
    check((await o.getAttribute("html", "data-pc-color")) === "sage" && (await cssVar(o, "--t-pc")) === "#4f8a6e", "the P&C color setting colors the next screen");
    await go(o, "/settings", "input[name=pc_goal]");
    await o.click(`${pcColors} [role=radio]:has-text('Dusty blue')`);
    check((await feedUntil((j) => j.pcColor === "dusty")).pcColor === "dusty", "back to dusty blue");
    const withPc = (await o.locator(`${tvScreens} [role=radio] span.block:first-child`).allTextContents()).map((s) => s.trim());
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
    await go(o, `/log?agent=${ID[THEO]}`, "#premium");
    check((await o.locator("[role=radiogroup][aria-label='What kind']").count()) === 0, "no Life / P&C switch for someone who is not P&C licensed");
    await go(o, `/log?agent=${ID[GUS]}`, "#premium");
    await o.waitForSelector("[role=radiogroup][aria-label='What kind']");
    await o.click("[role=radiogroup][aria-label='What kind'] [role=radio]:has-text('P&C')");
    await o.fill("#premium", "1860");
    await o.click(`[role=radiogroup][aria-label=Carrier] [role=radio]:has-text("Progressive")`);
    check((await o.locator("button[aria-pressed]").allTextContents()).join(",") === "Auto,Renters,ATV", "P&C mode offers the lines Progressive writes");
    await o.click(`button[aria-pressed]:has-text("Auto")`);
    await o.click("button[type=submit]:has-text('Log')");
    await o.waitForSelector("h2:has-text('Logged')");
    check((await o.textContent("body")).includes("Progressive · P&C"), "a P&C sale logs with its carrier and kind");
    await o.goto(`${APP}/`);
    await o.waitForSelector("text=Leaderboard");
    const pcHome = await o.textContent("body");
    // The goal is life (owner, 2026-11-04): This month opens on Life, where Gus's P&C does not count
    check((await o.locator("nav[aria-label=View] a").count()) === 3 && (await o.textContent("nav[aria-label=View] a[aria-current=true]")).includes("Life"), "This month opens on Life, with Life, P&C and Total to switch");
    const lifeGus = await o.locator(`section[data-group] li:has-text("${GUS}")`).first().textContent();
    check(pcHome.includes("Life production") && pcHome.includes("Life leaderboard") && lifeGus.includes("$6,200") && !lifeGus.includes("$8,060"), "the Life view counts life only (Gus: $6,200 of life, his P&C left out)");
    await o.click("nav[aria-label=View] a:has-text('Total')");
    await o.waitForSelector("text=Agency leaderboard");
    const totalHome = await o.textContent("body");
    const gusRow = await o.locator(`li:has-text("${GUS}")`).first().textContent();
    check(totalHome.includes("Agency total") && totalHome.includes("P&C $1,860") && gusRow.includes("$8,060") && gusRow.includes("Life $6,200 · 1") && gusRow.includes("P&C $1,860 · 1"), "the Total view adds life and P&C up and splits them on Gus's row");
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
    const totalText = await t2.textContent("body");
    check(totalText.includes("Agency leaderboard") && totalText.includes("Life $") && totalText.includes("P&C $") && totalText.includes("of $180,000 · life + P&C goals"), "the agency total screen adds life and P&C up against both goals and splits them");
    check((await t2.locator("[data-pill]").count()) === 1, "a kept screen shows only its own pill");
    await t2.screenshot({ path: `${OUT}/10c-board-total.png` });
    await o.click(tvScreen("P&C only"));
    check(await settles(t2, () => document.querySelector("main")?.dataset.screen === "pc", 12000), "P&C only puts the TV on the P&C screen within a poll");
    // innerText: what the screen shows (the page's own data script carries every name)
    const pcText = await t2.innerText("main");
    check(pcText.includes("P&C leaderboard") && pcText.includes(GUS) && pcText.includes("By carrier") && pcText.includes(TOKEN ? "Geico" : "Progressive") && pcText.includes("By line") && pcText.includes(TOKEN ? "Umbrella" : "Auto") && !pcText.includes(THEO), "the P&C screen: the P&C team, by carrier, by line, no one without P&C");
    const pcLower = pcText.toLowerCase(); // innerText follows the eyebrows' capitals
    check(pcLower.includes("p&c production") && pcLower.includes("of $30,000") && /needed a day|needed today|to go/.test(pcLower) && pcLower.includes("the month so far") && pcLower.includes("latest p&c sales") && pcText.includes(dollars(pcTotalDollars * 100)), "the P&C screen's right side is like the others: its goal, the tiles, the chart, the latest sales");
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
    await o.waitForSelector("text=Leaderboard");
    const afterOff = await o.innerText("body");
    check((await o.locator("nav[aria-label=View]").count()) === 0 && !afterOff.includes("$8,060") && afterOff.includes("$6,200"), "an old ?view=total link opens the life board: Gus is back to his life premium");
  }
  await lifeOnlySweep("after the P&C board is off again");

  // --- A full office (owner, 2026-11-12: "the ones in the office are like a group of like 27", "maybe 60 or 70" in all): 38 more people ---
  {
    const FIRST = ["Ada", "Ben", "Cal", "Dee", "Eli", "Fay", "Gil", "Hal", "Ida", "Jon", "Kit", "Lou", "Max", "Ned", "Ora", "Pat", "Quin", "Rae", "Sam", "Tess", "Uma", "Vic", "Wyn", "Xan", "Yul", "Zoe", "Abe", "Bea", "Cy", "Dot"];
    const LAST = ["Pine", "Reed", "Stone"];
    // The first 34 work in the office (40 with the six already there), the last four do not (six with Wes and Ivy).
    const crowd = Array.from({ length: 38 }, (_, i) => ({ name: `${FIRST[i % FIRST.length]} ${i < FIRST.length ? LAST[i % 3] : "Vale"}`, office: i < 34 }));
    const ALL = 8 + crowd.length;
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
    check(big.agents.length === ALL && big.agents.filter((x) => x.inOffice).length === IN_OFFICE && (await o.innerText("body")).includes(`${IN_OFFICE} in the office`), `${crowd.length} more people are on the board: ${IN_OFFICE} in the office, ${OUTSIDE} outside`);
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
    // Home: the long office group lists its sellers and folds the people with no sale yet
    await o.goto(`${APP}/`);
    await o.waitForSelector("section[data-group='In the office']");
    const officeRows = () =>
      o.evaluate(() => {
        const office = document.querySelector("section[data-group='In the office']");
        return { all: office.querySelectorAll("li").length, shown: [...office.querySelectorAll("li")].filter((li) => li.checkVisibility()).length, fold: office.querySelector("details summary")?.innerText.replace(/\s+/g, " ") ?? "", others: document.querySelectorAll("section[data-group='Everyone else'] li").length };
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
      ]) {
        await pp.goto(`${APP}${path}`);
        await pp.waitForSelector(ready);
        check(!(await pp.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)), `with ${ALL} people the phone's ${what} has no sideways scroll`);
      }
      await pp.goto(`${APP}/`);
      await pp.waitForSelector("section[data-group]");
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
        return { pages: s.getAttribute("data-pages"), title: s.querySelector("h2")?.innerText.replace(/\s+/g, " ") ?? "", rows: rows.length, columns: new Set(rows.map((li) => Math.round(li.getBoundingClientRect().left))).size, firstPlace: rows[0]?.getAttribute("data-place"), dots: s.querySelector("[aria-label^='Page ']")?.getAttribute("aria-label") ?? "", others: document.querySelectorAll("main section[data-group=others] li[data-person]").length };
      });
    await settles(t3, () => document.querySelector("main section[data-group=office] [aria-label^='Page ']")?.getAttribute("aria-label") === "Page 1 of 2", 5000);
    const page1 = await officeOf();
    check(page1.pages === "2" && page1.rows >= 30 && page1.rows < IN_OFFICE && page1.rows % 3 === 0 && page1.columns === 3 && page1.title.startsWith(`In the office ${IN_OFFICE} people · ${officeSellers} sold`) && page1.dots === "Page 1 of 2" && page1.firstPlace === "1" && page1.others === OUTSIDE, `the TV shows the office group a page at a time in three columns (${page1.title}; ${page1.rows} rows, ${page1.columns} columns, ${page1.dots})`);
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
    check((await keep3("Production", "production")) && (await settles(t3, (n) => document.querySelectorAll("main li[data-row]").length === n, 3000, Math.min(20, ledger.size))), `Production shows the first ${Math.min(20, ledger.size)} of ${ledger.size} sellers`);
    check((await fits(t3, "li[data-row]")) && (ledger.size <= 20 || (await t3.locator("main [aria-label='Page 1 of 2']").count()) === 1), "the Production screen's page fits the TV, with its page dots");
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
