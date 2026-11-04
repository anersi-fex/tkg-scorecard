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
/** True once fn() holds on the page, false after ms. */
const settles = async (page, fn, ms) => {
  try {
    await page.waitForFunction(fn, null, { timeout: ms });
    return true;
  } catch {
    return false;
  }
};
/** A CSS custom property as the page resolves it on <html> ("#4a6fa3"). */
const cssVar = (page, name) => page.evaluate((n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim(), name);
/** The board feed once fn(json) holds (the settings save landed), else the last answer. */
const feedUntil = async (ctx, fn, tries = 20) => {
  let json = null;
  for (let i = 0; i < tries; i++) {
    json = await (await ctx.request.get(`${APP}/api/board`)).json();
    if (fn(json)) return json;
    await new Promise((r) => setTimeout(r, 250));
  }
  return json;
};

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
  // P&C has a goal of its own (owner, 2026-11-04): this month's, next to the life goal
  await o.locator("input[name=pc_goal]").first().fill("30000");
  await o.locator("form:has(input[name=pc_goal])").first().locator("button[type=submit]").click();
  await o.waitForSelector("text=P&C goal saved. The board shows it now.");
  check((await (await owner.request.get(`${APP}/api/board`)).json()).team.pcGoalCents === 3_000_000, "the P&C goal saves and the feed carries it");
  await o.fill("#message", "Finish strong. Every policy counts.");
  await o.locator("form:has(#message) button[type=submit]").click();
  await o.waitForSelector("text=Saved. The board updates");
  check((await o.getAttribute("html", "data-colorway")) === "crimson", "Crimson is the default colorway");
  await o.click("[role=radio]:has-text('Emerald')");
  await o.waitForSelector("text=Saved. The TV changes");
  await o.goto(`${APP}/`);
  check((await o.getAttribute("html", "data-colorway")) === "emerald", "the colorway setting colors the next screen");
  const boardJson = await owner.request.get(`${APP}/api/board`);
  check((await boardJson.json()).colorway === "emerald", "the board feed carries the colorway");
  await o.goto(`${APP}/settings`);
  await o.click("[role=radio]:has-text('Crimson')");
  await o.waitForSelector("text=Saved. The TV changes");
  // P&C color (owner, 2026-11-04): Dusty blue by default; Silver, Sage and Ocean in Settings
  const pcColors = "[role=radiogroup][aria-label='P&C color']";
  check((await o.locator(`${pcColors} [role=radio]`).count()) === 4 && (await o.textContent(`${pcColors} [role=radio][aria-checked=true]`)).includes("Dusty blue"), "Settings offers four P&C colors, Dusty blue to start");
  check((await o.getAttribute("html", "data-pc-color")) === "dusty" && (await cssVar(o, "--t-pc")) === "#4a6fa3", "every screen draws P&C in dusty blue by default");
  await o.click(`${pcColors} [role=radio]:has-text('Sage')`);
  check((await feedUntil(owner, (j) => j.pcColor === "sage")).pcColor === "sage", "the board feed carries the P&C color");
  await o.goto(`${APP}/`);
  check((await o.getAttribute("html", "data-pc-color")) === "sage" && (await cssVar(o, "--t-pc")) === "#4f8a6e", "the P&C color setting colors the next screen");
  await o.goto(`${APP}/settings`);
  await o.click(`${pcColors} [role=radio]:has-text('Dusty blue')`);
  check((await feedUntil(owner, (j) => j.pcColor === "dusty")).pcColor === "dusty", "back to dusty blue");
  // TV look: dark by default, Light saved on tap, carried by the feed (the TV checks below)
  const tvLook = "[role=radiogroup][aria-label='TV look']";
  check((await o.getAttribute(`${tvLook} [role=radio][aria-checked=true]`, "aria-checked")) === "true" && (await o.textContent(`${tvLook} [role=radio][aria-checked=true]`)).includes("Dark"), "the TV look starts on Dark");
  check((await o.getAttribute("html", "data-board-theme")) === "dark", "the page carries the TV look for the pre-paint script");
  await o.click(`${tvLook} [role=radio]:has-text('Light')`);
  check((await feedUntil(owner, (j) => j.boardTheme === "light")).boardTheme === "light", "the board feed carries the TV look (light)");
  // TV screens (2026-11-04): rotate the three screens, or keep the TV on one; Rotate to start
  const tvScreens = "[role=radiogroup][aria-label='TV screens']";
  check((await o.locator(`${tvScreens} [role=radio]`).count()) === 4 && (await o.textContent(`${tvScreens} [role=radio][aria-checked=true]`)).includes("Rotate"), "Settings offers the TV screens, Rotate to start");
  check((await (await owner.request.get(`${APP}/api/board`)).json()).tvScreens === "rotate", "the board feed carries the TV screens setting");
  // Sale sound (2026-11-04): the owner's four sounds plus Off, a play button each, picked on a tap, carried by the feed
  const soundRows = "[role=radiogroup][aria-label='Sale sound']";
  check((await o.locator(`${soundRows} [role=radio]`).count()) === 5 && (await o.locator(`${soundRows} button[aria-label^='Play ']`).count()) === 4, "Settings offers four sale sounds and Off, each sound with a play button");
  check((await o.textContent(`${soundRows} [role=radio][aria-checked=true]`)).includes("Cash register"), "the cash register is the sale sound to start");
  await o.click(`${soundRows} [role=radio]:has-text('Air horn')`);
  await o.waitForSelector("text=Saved. The TV plays it on the next sale.");
  check((await feedUntil(owner, (j) => j.sound === "air-horn")).sound === "air-horn", "the board feed carries the sale sound (air horn)");
  for (const f of ["register", "air-horn", "guitar-riff", "upbeat-intro"]) {
    const r = await owner.request.get(`${APP}/sounds/${f}.mp3`);
    check(r.ok() && /audio\/mpeg/.test(r.headers()["content-type"] ?? ""), `the ${f} sound is served (${r.status()})`);
  }
  await o.screenshot({ path: `${OUT}/03-settings.png`, fullPage: true });

  // Log sales through the form
  await o.goto(`${APP}/log`);
  await o.screenshot({ path: `${OUT}/04-log-empty.png`, fullPage: true });
  const sales = [
    ["Alex Alekseyev", "12450", "Term", "Americo"],
    ["Mark Dusevic", "8200.50", "Whole life", "Foresters"],
    ["Anersi Koka", "15000", "IUL", "AHL"],
    ["Moe Karim", "6100", "Final expense", "Royal"],
    ["Alex Alekseyev", "9300", "Term", "UHL"],
    ["Brandon Lee", "4350", "", "AmAm"],
  ];
  for (const [who, premium, product, carrier] of sales) {
    await o.goto(`${APP}/log`);
    await o.click(`[role=radio]:has-text("${who}")`);
    await o.fill("#premium", premium);
    if (product) await o.click(`button[aria-pressed]:has-text("${product}")`);
    await o.click(`[role=radiogroup][aria-label=Carrier] [role=radio]:has-text("${carrier}")`);
    await o.click("button[type=submit]:has-text('Log')");
    await o.waitForSelector("h2:has-text('Logged')");
  }
  check(true, "six sales logged through the form, each with a carrier");
  await o.screenshot({ path: `${OUT}/05-log-done.png`, fullPage: true });

  // Undo the last one, then log it again
  await o.click("button:has-text('Oops, take it back')");
  await o.waitForSelector("#premium");
  check(true, "undo after logging works");
  await o.click(`[role=radio]:has-text("Brandon Lee")`);
  await o.fill("#premium", "4350");
  await o.click(`[role=radiogroup][aria-label=Carrier] [role=radio]:has-text("AmAm")`);
  await o.click("button[type=submit]:has-text('Log')");
  await o.waitForSelector("h2:has-text('Logged')");

  await o.goto(`${APP}/log`);
  await o.click(`[role=radio]:has-text("Moe Karim")`);
  await o.fill("#premium", "500");
  check(await o.locator("form:has(#premium) button[type=submit]").isDisabled(), "no carrier keeps the button off");
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
  check(body.includes("Americo") && body.includes("Foresters"), "the sales rows on Home name the carrier");
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

  // P&C alongside life (2026-11-04): the owner marks Moe P&C licensed and gives him a P&C goal; a P&C sale counts on P&C and in the total, never on Life
  await o.goto(`${APP}/team`);
  await o.click("li:has-text('Moe Karim') button:has-text('Edit')");
  await o.click("li:has-text('Moe Karim') [role=switch]");
  await o.waitForSelector("text=P&C licensed. Log a sale offers");
  check(true, "the owner marks Moe P&C licensed on the Team page");
  await o.waitForSelector("li:has-text('Moe Karim') input[name=pc_goal]");
  await o.fill("li:has-text('Moe Karim') input[name=pc_goal]", "5000");
  await o.click("li:has-text('Moe Karim') form:has(input[name=pc_goal]) button");
  await o.waitForSelector("text=P&C goal saved.");
  check(true, "a P&C licensed person gets their own P&C goal on the Team page");
  await o.goto(`${APP}/log`);
  await o.click(`[role=radio]:has-text("Alex Alekseyev")`);
  check((await o.locator("[role=radiogroup][aria-label='What kind']").count()) === 0, "no Life / P&C switch for someone who is not P&C licensed");
  await o.click(`[role=radio]:has-text("Moe Karim")`);
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
  // The goal is life (owner, 2026-11-04): This month opens on Life, where Moe's P&C does not count
  check((await o.locator("nav[aria-label=View] a").count()) === 3 && (await o.textContent("nav[aria-label=View] a[aria-current=true]")).includes("Life"), "This month opens on Life, with Life, P&C and Total to switch");
  const lifeMoe = await o.locator("li:has-text('Moe Karim')").first().textContent();
  check(pcHome.includes("Life production") && pcHome.includes("Life leaderboard") && lifeMoe.includes("$6,100") && !lifeMoe.includes("$7,960"), "the Life view counts life only (Moe: $6,100 of life, his P&C left out)");
  await o.click("nav[aria-label=View] a:has-text('Total')");
  await o.waitForSelector("text=Agency leaderboard");
  const totalHome = await o.textContent("body");
  const moeRow = await o.locator("li:has-text('Moe Karim')").first().textContent();
  check(totalHome.includes("Agency total") && totalHome.includes("P&C $1,860") && moeRow.includes("$7,960") && moeRow.includes("Life $6,100 · 1") && moeRow.includes("P&C $1,860 · 1"), "the Total view adds life and P&C up and splits them on Moe's row");
  await o.click("nav[aria-label=View] a:has-text('P&C')");
  await o.waitForSelector("text=P&C leaderboard");
  const pcView = await o.textContent("body");
  const pcMoe = await o.locator("li:has-text('Moe Karim')").first().textContent();
  check(pcView.includes("P&C production") && pcView.includes("of $30,000") && pcMoe.includes("$1,860") && pcMoe.includes("37%") && pcMoe.includes("Auto 1") && pcView.includes("By carrier") && pcView.includes("Progressive"), "the P&C view: its goal, Moe on the P&C board against his own P&C goal, his line, the carrier");
  check(!(await o.textContent("[data-board=pc]")).includes("Alex Alekseyev"), "the P&C board leaves out people who are not P&C licensed");
  await o.goto(`${APP}/`);
  await o.waitForSelector("text=Leaderboard");
  // Home and the TV draw the goal-line legend only once a business day of the month has passed: never on a month's first weekend.
  const tick = (await (await owner.request.get(`${APP}/api/board`)).json()).clock.elapsed > 0;
  check(pcHome.includes("goal line today") === tick, tick ? "Home names the goal line tick" : "Home hides the goal line tick before the month's first business day");

  // A sale dated last month shows up in that month's own list, fixable there
  const [ty, tm] = detroitToday();
  const lastMonthDay = new Date(Date.UTC(ty, tm - 1, 1) - 86400000 * 3).toISOString().slice(0, 10);
  const lastMonth = lastMonthDay.slice(0, 7);
  await o.goto(`${APP}/log`);
  await o.click(`[role=radio]:has-text("James Park")`);
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
    const future = await owner.request.post(`${APP}/api/sales`, { headers: { authorization: `Bearer ${TOKEN}` }, data: { agent: "James Park", premium: "5", carrier: "AHL", date: tomorrow } });
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
  await p.focus("#premium");
  check(await settles(p, () => document.querySelector("nav[data-tabbar]")?.offsetParent === null, 2000), "the tab bar hides while the premium box has focus (the keyboard is up)");
  await p.evaluate(() => document.activeElement.blur());
  check(await settles(p, () => document.querySelector("nav[data-tabbar]")?.offsetParent !== null, 2000), "the tab bar comes back once the keyboard goes");
  // The Wrap: today's top producer, everybody, the carriers; one iPhone screenshot above the tab bar,
  // measured on the fullest day: everyone sells.
  if (TOKEN) {
    for (const who of ["Brandon Lee", "James Park", "Maira Santos"]) {
      const r = await owner.request.post(`${APP}/api/sales`, { headers: { authorization: `Bearer ${TOKEN}` }, data: { agent: who, premium: "1,250", carrier: "Royal", product: "Term" } });
      check(r.ok(), `a sale for ${who} before the Wrap (${r.status()})`);
    }
  }
  await p.goto(`${APP}/wrap`);
  await p.waitForSelector("text=Player of the day");
  const wrapText = await p.textContent("body");
  check(wrapText.includes("Alex Alekseyev") && wrapText.includes("$21,750"), "the Wrap names today's player of the day with the day's premium");
  check(wrapText.includes("Everybody today") && wrapText.includes("Best deal"), "the Wrap lists everybody and the best deal");
  check(wrapText.includes("Day won") || wrapText.includes("short of") || /(Saturday|Sunday)/.test(wrapText), "the Wrap judges the day against what the goal needed (or names the weekend)");
  const fit = await p.evaluate(() => ({ bottom: document.querySelector("[data-wrap-foot]").getBoundingClientRect().bottom, pill: document.querySelector("nav[data-tabbar] > div").getBoundingClientRect().top, height: window.innerHeight }));
  check(fit.bottom <= fit.pill - 8, `the Wrap fits one iPhone screenshot above the tab bar (ends at ${Math.round(fit.bottom)}px, the tab bar starts at ${Math.round(fit.pill)} of ${fit.height})`);
  // Royal leads only once the token's three Royal sales landed; AHL is in the top three either way.
  const square = TOKEN ? "Royal" : "AHL";
  check(wrapText.includes("Top carriers") && new RegExp(`${square}\\s*\\d+\\s*polic`).test(wrapText), "the Wrap shows the month's top carriers with their policy counts");
  check(wrapText.includes("Day") && wrapText.includes("Week") && wrapText.includes("Month"), "the Wrap offers Day, Week and Month");
  const wrapOverflow = await p.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  check(!wrapOverflow, "the Wrap has no sideways scroll");
  const tabs = await p.evaluate(() => {
    const pill = document.querySelector("nav[data-tabbar] > div");
    return { right: pill.getBoundingClientRect().right, links: pill.querySelectorAll("a").length, width: window.innerWidth };
  });
  check(tabs.links === 4 && tabs.right <= tabs.width, `the phone tab bar holds four tabs inside the screen (${Math.round(tabs.right)} of ${tabs.width}px)`);
  await p.screenshot({ path: `${OUT}/14-phone-wrap.png`, fullPage: true });
  // The week and the month: the same screen over a longer stretch, each still one screenshot
  const fitOf = async () => p.evaluate(() => ({ bottom: document.querySelector("[data-wrap-foot]").getBoundingClientRect().bottom, pill: document.querySelector("nav[data-tabbar] > div").getBoundingClientRect().top, height: window.innerHeight }));
  await p.goto(`${APP}/wrap?view=week`);
  await p.waitForSelector("text=Player of the week");
  const weekText = await p.textContent("body");
  check(weekText.includes("Everybody this week") && weekText.includes("Alex Alekseyev"), "the week view lists everybody this week with its player");
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
  await p.goto(`${APP}/?view=pc`);
  await p.waitForSelector("text=P&C leaderboard");
  await p.screenshot({ path: `${OUT}/09b-phone-home-pc.png`, fullPage: true });
  await p.goto(`${APP}/?view=total`);
  await p.waitForSelector("text=Agency leaderboard");
  await p.screenshot({ path: `${OUT}/09c-phone-home-total.png`, fullPage: true });
  await phone.close();

  // --- The TV board ---
  const tv = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  await tv.addCookies(await owner.cookies());
  const t = await tv.newPage();
  // Settings says Light (set above): the TV opens light before its first paint
  await t.goto(`${APP}/board`, { waitUntil: "commit" });
  check((await t.getAttribute("html", "data-theme")) === "light", "the TV opens in the owner's TV look (light) before the first paint");
  await t.waitForSelector("text=Leaderboard");
  await t.waitForTimeout(1200);
  await t.screenshot({ path: `${OUT}/11-board-light.png` });
  // Back to Dark on the owner's phone: the TV follows on its next poll
  await o.goto(`${APP}/settings`);
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
  // P&C color on the TV: dusty blue in dark by default, and a change in Settings arrives with the next poll
  check((await t.getAttribute("html", "data-pc-color")) === "dusty" && (await cssVar(t, "--t-pc")) === "#86a6d6", "the TV draws P&C in dusty blue by default (dark)");
  await o.goto(`${APP}/settings`);
  await o.click(`${pcColors} [role=radio]:has-text('Silver')`);
  check((await settles(t, () => document.documentElement.getAttribute("data-pc-color") === "silver", 12000)) && (await cssVar(t, "--t-pc")) === "#a5b4c8", "a P&C color change in Settings reaches the TV within a poll");
  await o.click(`${pcColors} [role=radio]:has-text('Dusty blue')`);
  check(await settles(t, () => document.documentElement.getAttribute("data-pc-color") === "dusty", 12000), "and back to dusty blue on the TV");

  // A Shortcut logs a sale: the board celebrates within a poll
  if (TOKEN) {
    const api = await owner.request.post(`${APP}/api/sales`, { headers: { authorization: `Bearer ${TOKEN}` }, data: { agent: "maira", premium: "2,750", product: "Term", carrier: "americo" } });
    check(api.ok() && (await api.json()).sale.carrier === "Americo", `Shortcut endpoint logs a sale with the carrier (${api.status()})`);
    const noCarrier = await owner.request.post(`${APP}/api/sales`, { headers: { authorization: `Bearer ${TOKEN}` }, data: { agent: "maira", premium: "10" } });
    check(noCarrier.status() === 400, "Shortcut endpoint needs a carrier");
    const badCarrier = await owner.request.post(`${APP}/api/sales`, { headers: { authorization: `Bearer ${TOKEN}` }, data: { agent: "maira", premium: "10", carrier: "Nope" } });
    check(badCarrier.status() === 400 && (await badCarrier.json()).carriers.length === 7, "Shortcut endpoint lists the carriers on a wrong one");
    const pcApi = await owner.request.post(`${APP}/api/sales`, { headers: { authorization: `Bearer ${TOKEN}` }, data: { agent: "Moe", premium: "2,000", kind: "pc", carrier: "geico", product: "umbrella" } });
    const pcJson = pcApi.ok() ? await pcApi.json() : null;
    check(pcApi.ok() && pcJson.sale.kind === "pc" && pcJson.sale.carrier === "Geico", `Shortcut endpoint logs a P&C sale (${pcApi.status()})`);
    const pcNo = await owner.request.post(`${APP}/api/sales`, { headers: { authorization: `Bearer ${TOKEN}` }, data: { agent: "Alex", premium: "10", kind: "pc", carrier: "Progressive" } });
    check(pcNo.status() === 400, "Shortcut endpoint refuses a P&C sale for someone not P&C licensed");
    const pcBad = await owner.request.post(`${APP}/api/sales`, { headers: { authorization: `Bearer ${TOKEN}` }, data: { agent: "Moe", premium: "10", kind: "pc", carrier: "AHL" } });
    check(pcBad.status() === 400 && (await pcBad.json()).carriers.includes("Progressive"), "a P&C sale needs a P&C carrier");
    const people = await owner.request.get(`${APP}/api/sales`, { headers: { authorization: `Bearer ${TOKEN}` } });
    check(people.ok() && (await people.json()).people.length === 7, "Shortcut endpoint lists the people");
    const bad = await owner.request.post(`${APP}/api/sales`, { headers: { authorization: `Bearer ${TOKEN}` }, data: { agent: "Nobody", premium: "100", carrier: "AHL" } });
    check(bad.status() === 404, "Shortcut endpoint refuses an unknown person");
    const wrongTok = await owner.request.post(`${APP}/api/sales`, { headers: { authorization: `Bearer nope-nope-nope-nope` }, data: { agent: "Alex", premium: "100", carrier: "AHL" } });
    check(wrongTok.status() === 401, "Shortcut endpoint refuses a wrong token");
    await t.waitForSelector("text=New sale", { timeout: 15000 });
    await t.waitForTimeout(900);
    await t.screenshot({ path: `${OUT}/12-board-celebration.png` });
    const celebrate = await t.textContent("[role=status]");
    check((await t.getAttribute("[role=status]", "data-sound")) === "air-horn", "the celebration carries the chosen sale sound (air horn)");
    check(!(await t.textContent("footer")).includes("Click or press a key once for sound"), "a sale sound that plays leaves no sound hint on the TV");
    check(celebrate.includes("Maira Santos") && celebrate.includes("$2,750") && celebrate.includes("Americo"), "the board celebrates the new sale with the name, the amount and the carrier");
    // Two sales came in (Maira's, then Moe's P&C): 9 s each on screen
    await t.waitForSelector("[role=status]", { state: "detached", timeout: 40000 });
    const tvText = await t.textContent("body");
    check((await t.getAttribute("main", "data-screen")) === "life" && tvText.includes("Life leaderboard") && tvText.includes("Life production") && tvText.includes("goal line today") === tick, "the TV opens on the life screen, with the goal line legend once a business day has passed");
    // Settings > TV screens: keep the TV on the agency total, then on P&C, then back to rotating
    await o.goto(`${APP}/settings`);
    await o.click("[role=radiogroup][aria-label='TV screens'] [role=radio]:has-text('Agency total only')");
    check(await settles(t, () => document.querySelector("main")?.dataset.screen === "total", 12000), "Agency total only in Settings puts the TV on the agency total within a poll");
    const totalText = await t.textContent("body");
    check(totalText.includes("Agency leaderboard") && totalText.includes("Life $") && totalText.includes("P&C $") && totalText.includes("of $180,000 · life + P&C goals"), "the agency total screen adds life and P&C up against both goals and splits them");
    check((await t.locator("[data-pill]").count()) === 1, "a kept screen shows only its own pill");
    await t.screenshot({ path: `${OUT}/10c-board-total.png` });
    await o.click("[role=radiogroup][aria-label='TV screens'] [role=radio]:has-text('P&C only')");
    check(await settles(t, () => document.querySelector("main")?.dataset.screen === "pc", 12000), "P&C only puts the TV on the P&C screen within a poll");
    // innerText: what the screen shows (the page's own data script carries every name)
    const pcText = await t.innerText("main");
    check(pcText.includes("P&C leaderboard") && pcText.includes("Moe Karim") && pcText.includes("By carrier") && pcText.includes("Geico") && pcText.includes("By line") && pcText.includes("Umbrella") && !pcText.includes("Alex Alekseyev"), "the P&C screen: the P&C team, by carrier, by line, no one without P&C");
    const pcLower = pcText.toLowerCase(); // innerText follows the eyebrows' capitals
    check(pcLower.includes("p&c production") && pcLower.includes("of $30,000") && pcLower.includes("needed a day") && pcLower.includes("the month so far") && pcLower.includes("latest p&c sales"), "the P&C screen's right side is like the others: its goal, the tiles, the chart, the latest sales");
    await t.screenshot({ path: `${OUT}/10b-board-pc.png` });
    await o.click("[role=radiogroup][aria-label='TV screens'] [role=radio]:has-text('Rotate')");
    check(await settles(t, () => document.querySelector("main")?.dataset.screen === "life" && document.querySelectorAll("[data-pill]").length === 3, 12000), "Rotate brings the TV back to life with all three pills");
  } else {
    console.log("skip Shortcut endpoint (no LOG_TOKEN)");
  }
  await tv.close();

  // The rotation (2026-11-04): life for a minute, then P&C and the agency total for 15 s each
  {
    const rc = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
    await rc.addCookies(await owner.cookies());
    const r = await rc.newPage();
    await r.clock.install();
    await r.goto(`${APP}/board`);
    await r.waitForSelector("main[data-screen]");
    const screenNow = () => r.getAttribute("main", "data-screen");
    check((await screenNow()) === "life", "the rotation starts on life");
    await r.clock.runFor(59_000);
    check((await screenNow()) === "life", "life stays the whole minute");
    await r.clock.runFor(2_000);
    check((await screenNow()) === "pc", "then P&C");
    await r.clock.runFor(15_500);
    check((await screenNow()) === "total", "then the agency total");
    await r.clock.runFor(15_500);
    check((await screenNow()) === "life", "then life again");
    await rc.close();
  }

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
  await m.click(`[role=radiogroup][aria-label=Carrier] [role=radio]:has-text("Royal")`);
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
