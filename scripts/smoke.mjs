// End-to-end smoke test against a running app (invented data only). Signs in as the owner, adds
// a team, sets a goal, logs sales, checks the team sign-in, the Shortcut endpoint and the TV
// board's celebration, and saves screenshots to test-results/. Run it on a fresh database:
//   scripts/local-db/start.sh --reset
//   set -a; . .local-db/env; set +a
//   OWNER_PASSWORD=owner-pass TEAM_PASSWORD=team-pass LOG_TOKEN=abcdefghijklmnop npm run build && npm start
//   APP=http://localhost:3000 OWNER_PASSWORD=owner-pass TEAM_PASSWORD=team-pass LOG_TOKEN=... node scripts/smoke.mjs
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";

// Playwright from the project, else a global install (NODE_PATH), else PLAYWRIGHT_DIR.
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_DIR ?? "playwright");

const APP = process.env.APP ?? "http://localhost:3000";
const OWNER = process.env.OWNER_PASSWORD ?? "owner-pass";
const TEAM = process.env.TEAM_PASSWORD ?? "team-pass";
const TOKEN = process.env.LOG_TOKEN ?? "";
const OUT = "test-results";
mkdirSync(OUT, { recursive: true });

let failures = 0;
const check = (ok, what) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failures++;
};

const PEOPLE = ["Anersi Koka", "Alex Alekseyev", "Mark Dusevic", "Moe Karim", "Brandon Lee", "Maira Santos", "James Park"];

async function signIn(page, password) {
  await page.goto(`${APP}/login`);
  await page.fill("#password", password);
  await Promise.all([page.waitForURL((u) => !u.pathname.startsWith("/login")), page.click("button[type=submit]")]);
}

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
  const rNoTok = await anon.request.post(`${APP}/api/sales`, { data: { agent: "Alex", premium: 100 } });
  check(rNoTok.status() === 401, "no token: /api/sales is 401");
  await a.fill("#password", "wrong-password");
  await a.click("button[type=submit]");
  await a.waitForSelector("text=That password isn't right");
  check(true, "wrong password is refused");
  // Each try must finish (React resets the form after the action) before the next one is typed.
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
  await b.goto(`${APP}/login`);
  await b.fill("#password", OWNER);
  await Promise.all([b.waitForURL((u) => !u.pathname.startsWith("/login")), b.click("button[type=submit]")]);
  check(!b.url().includes("/login"), "another address still signs in");
  await other.close();
  await anon.close();

  // --- Owner ---
  const owner = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const o = await owner.newPage();
  await signIn(o, OWNER);
  check(o.url() === `${APP}/`, "owner signs in and lands on This month");
  await o.goto(`${APP}/login?next=/board`);
  check(o.url() === `${APP}/board`, "signed in, /login?next=/board goes straight to the board");
  await o.screenshot({ path: `${OUT}/01-home-empty.png`, fullPage: true });

  // Team page: add seven people
  await o.goto(`${APP}/team`);
  for (const name of PEOPLE) {
    await o.fill("#new-name", name);
    await o.click("button:has-text('Add')");
    await o.waitForSelector(`li:has-text("${name}")`);
  }
  check((await o.locator("li:has(button:has-text('Edit'))").count()) === 7, "seven people on the team");
  // A duplicate is refused
  await o.fill("#new-name", "alex alekseyev");
  await o.click("button:has-text('Add')");
  await o.waitForSelector("text=is already on the team");
  check(true, "duplicate name refused");
  // Goal for one person
  await o.click("li:has-text('Alex Alekseyev') button:has-text('Edit')");
  await o.fill("li:has-text('Alex Alekseyev') input[name=goal]", "30000");
  await o.click("li:has-text('Alex Alekseyev') form:has(input[name=goal]) button");
  await o.waitForSelector("text=Goal saved");
  await o.screenshot({ path: `${OUT}/02-team.png`, fullPage: true });

  // Settings: team goal and message
  await o.goto(`${APP}/settings`);
  const goalInput = o.locator("input[name=goal]").first();
  await goalInput.fill("150000");
  await o.locator("form:has(input[name=goal])").first().locator("button[type=submit]").click();
  await o.waitForSelector("text=Goal saved. The board shows it now.");
  await o.fill("#message", "Finish strong. Every policy counts.");
  await o.locator("form:has(#message) button[type=submit]").click();
  await o.waitForSelector("text=Saved. The board updates");
  await o.screenshot({ path: `${OUT}/03-settings.png`, fullPage: true });

  // Log sales through the form
  await o.goto(`${APP}/log`);
  await o.screenshot({ path: `${OUT}/04-log-empty.png`, fullPage: true });
  const sales = [
    ["Alex Alekseyev", "12450", "Term", "Maria"],
    ["Mark Dusevic", "8200.50", "Whole life", ""],
    ["Anersi Koka", "15000", "IUL", "Dana"],
    ["Moe Karim", "6100", "Final expense", ""],
    ["Alex Alekseyev", "9300", "Term", "Luis"],
    ["Brandon Lee", "4350", "", ""],
  ];
  for (const [who, premium, product, client] of sales) {
    await o.goto(`${APP}/log`);
    await o.click(`[role=radio]:has-text("${who}")`);
    await o.fill("#premium", premium);
    if (product) await o.click(`button[aria-pressed]:has-text("${product}")`);
    if (client) {
      await o.click("button:has-text('Client name, day, note')");
      await o.fill("#client", client);
    }
    await o.click("button[type=submit]:has-text('Log')");
    await o.waitForSelector("h2:has-text('Logged')");
  }
  check(true, "six sales logged through the form");
  await o.screenshot({ path: `${OUT}/05-log-done.png`, fullPage: true });

  // Undo the last one, then log it again
  await o.click("button:has-text('Oops, take it back')");
  await o.waitForSelector("#premium");
  check(true, "undo after logging works");
  await o.click(`[role=radio]:has-text("Brandon Lee")`);
  await o.fill("#premium", "4350");
  await o.click("button[type=submit]:has-text('Log')");
  await o.waitForSelector("h2:has-text('Logged')");

  // A sale with a bad amount is refused
  await o.goto(`${APP}/log`);
  await o.click(`[role=radio]:has-text("Moe Karim")`);
  await o.fill("#premium", "12.345");
  check(await o.locator("form:has(#premium) button[type=submit]").isDisabled(), "a bad amount keeps the button off");

  // Home shows the month
  await o.goto(`${APP}/`);
  await o.waitForSelector("text=Leaderboard");
  const body = await o.textContent("body");
  check(body.includes("$55,401") || body.includes("$55,400"), `team production shows on Home (${body.match(/\$5\d,\d{3}/)?.[0]})`);
  check(body.includes("of $150,000"), "goal shows on Home");
  check(body.includes("Alex Alekseyev"), "leader on Home");
  await o.screenshot({ path: `${OUT}/06-home.png`, fullPage: true });

  // Owner fixes a sale and removes one
  await o.locator("button[aria-label=More]").first().click();
  await o.click("button:has-text('Fix this sale')");
  await o.fill("#e-premium", "4400");
  await o.click("form:has(#e-premium) button:has-text('Save')");
  await o.waitForSelector("text=$4,400");
  check(true, "owner fixed a sale");
  o.once("dialog", (d) => d.accept());
  await o.locator("button[aria-label=More]").first().click();
  await o.click("button:has-text('Remove')");
  await o.waitForSelector("text=Removed.");
  check(true, "owner removed a sale");

  // A sale dated last month shows up in that month's own list, fixable there
  const lastMonthDay = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1) - 86400000 * 3).toISOString().slice(0, 10);
  const lastMonth = lastMonthDay.slice(0, 7);
  await o.goto(`${APP}/log`);
  await o.click(`[role=radio]:has-text("James Park")`);
  await o.fill("#premium", "777");
  await o.click("button:has-text('Client name, day, note')");
  await o.fill("#sold_on", lastMonthDay);
  await o.click("button[type=submit]:has-text('Log')");
  await o.waitForSelector("h2:has-text('Logged')");
  await o.goto(`${APP}/?month=${lastMonth}`);
  await o.waitForSelector("text=Leaderboard");
  check((await o.textContent("body")).includes("$777") && (await o.locator("button[aria-label=More]").count()) === 1, "a past month lists its own sales with the row menu");
  // A sale dated in the future is refused by the server (the day field's max already stops it in the browser)
  const tomorrow = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
  if (TOKEN) {
    const future = await owner.request.post(`${APP}/api/sales`, { headers: { authorization: `Bearer ${TOKEN}` }, data: { agent: "James Park", premium: "5", date: tomorrow } });
    check(future.status() === 400, `a sale dated in the future is refused (${future.status()})`);
  }
  // Past month view
  await o.goto(`${APP}/?month=2026-09`);
  await o.waitForSelector("text=September 2026");
  check(true, "past month opens");
  await o.goto(`${APP}/?month=20-99`);
  await o.waitForSelector("text=This month");
  check(true, "bad month falls back to this month");

  // Phone-size screenshots
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await phone.addCookies(await owner.cookies());
  const p = await phone.newPage();
  await p.goto(`${APP}/`);
  await p.waitForSelector("text=Leaderboard");
  await p.screenshot({ path: `${OUT}/07-phone-home.png`, fullPage: true });
  const overflow = await p.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  check(!overflow, "phone Home has no sideways scroll");
  await p.goto(`${APP}/log`);
  await p.screenshot({ path: `${OUT}/08-phone-log.png`, fullPage: true });
  await p.emulateMedia({ colorScheme: "dark" });
  await p.goto(`${APP}/`);
  await p.waitForSelector("text=Leaderboard");
  await p.screenshot({ path: `${OUT}/09-phone-home-dark.png`, fullPage: true });
  await phone.close();

  // --- The TV board ---
  const tv = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  await tv.addCookies(await owner.cookies());
  const t = await tv.newPage();
  await t.goto(`${APP}/board`, { waitUntil: "commit" });
  check((await t.getAttribute("html", "data-theme")) === "dark", "board is dark before the first paint");
  await t.waitForSelector("text=Leaderboard");
  await t.waitForTimeout(1200);
  await t.screenshot({ path: `${OUT}/10-board-dark.png` });
  const tvOverflow = await t.evaluate(() => document.documentElement.scrollHeight > document.documentElement.clientHeight + 1);
  check(!tvOverflow, "board fits the TV with no scroll");
  await t.keyboard.press("t");
  await t.waitForTimeout(400);
  check((await t.getAttribute("html", "data-theme")) === "light", "T flips the board to light");
  await t.screenshot({ path: `${OUT}/11-board-light.png` });
  await t.keyboard.press("t");

  // A Shortcut logs a sale: the board celebrates within a poll
  if (TOKEN) {
    const api = await owner.request.post(`${APP}/api/sales`, { headers: { authorization: `Bearer ${TOKEN}` }, data: { agent: "maira", premium: "2,750", product: "Term", client: "Rosa" } });
    check(api.ok(), `Shortcut endpoint logs a sale (${api.status()})`);
    const people = await owner.request.get(`${APP}/api/sales`, { headers: { authorization: `Bearer ${TOKEN}` } });
    check(people.ok() && (await people.json()).people.length === 7, "Shortcut endpoint lists the people");
    const bad = await owner.request.post(`${APP}/api/sales`, { headers: { authorization: `Bearer ${TOKEN}` }, data: { agent: "Nobody", premium: "100" } });
    check(bad.status() === 404, "Shortcut endpoint refuses an unknown person");
    const wrongTok = await owner.request.post(`${APP}/api/sales`, { headers: { authorization: `Bearer nope-nope-nope-nope` }, data: { agent: "Alex", premium: "100" } });
    check(wrongTok.status() === 401, "Shortcut endpoint refuses a wrong token");
    await t.waitForSelector("text=New sale", { timeout: 15000 });
    await t.waitForTimeout(900);
    await t.screenshot({ path: `${OUT}/12-board-celebration.png` });
    const celebrate = await t.textContent("[role=status]");
    check(celebrate.includes("Maira Santos") && celebrate.includes("$2,750"), "the board celebrates the new sale with the name and the amount");
  } else {
    console.log("skip Shortcut endpoint (no LOG_TOKEN)");
  }
  await tv.close();

  // --- Team sign-in ---
  const team = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const m = await team.newPage();
  await signIn(m, TEAM);
  check(m.url() === `${APP}/`, "team password signs in");
  await m.goto(`${APP}/settings`);
  await m.waitForURL(`${APP}/`);
  check(true, "team cannot open Settings");
  // A desk link preselects the person
  const agentsRes = await owner.request.get(`${APP}/api/sales`, { headers: { authorization: `Bearer ${TOKEN || "x"}` } });
  await m.goto(`${APP}/team`);
  check((await m.locator("button:has-text('Edit')").count()) === 0, "team sees the team without Edit");
  await m.goto(`${APP}/log`);
  await m.click(`[role=radio]:has-text("James Park")`);
  await m.fill("#premium", "1999");
  await m.click("button[type=submit]:has-text('Log')");
  await m.waitForSelector("h2:has-text('Logged')");
  check(true, "team logs a sale");
  await m.screenshot({ path: `${OUT}/13-phone-team-logged.png`, fullPage: true });
  await m.goto(`${APP}/`);
  await m.waitForSelector("text=Leaderboard");
  await m.locator("button[aria-label=More]").first().click();
  check(await m.locator("button:has-text('Undo (just logged)')").isVisible(), "team can undo a fresh sale from Home");
  check((await m.locator("button:has-text('Fix this sale')").count()) === 0, "team cannot fix a sale");
  await m.goto(`${APP}/`);
  await m.click("button[aria-label^='Account:']");
  await Promise.all([m.waitForURL(`${APP}/login`), m.click("button:has-text('Sign out')")]);
  check(m.url() === `${APP}/login`, "sign out from the menu works");
  await team.close();
  void agentsRes;

  await owner.close();
} finally {
  await browser.close();
}
console.log(failures ? `\n${failures} check(s) FAILED` : "\nall checks passed");
process.exit(failures ? 1 : 0);
