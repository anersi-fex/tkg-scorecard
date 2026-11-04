// Renders design/screens-mockups.html: the TV's three screens (Life, P&C, Agency total), the phone's
// This month in each, and Settings > TV screens, then composes the sheets the owner sees, into
// design/out/screens/.   node design/render-screens.mjs
import { mkdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_DIR ?? "playwright");
const PAGE = pathToFileURL(new URL("./screens-mockups.html", import.meta.url).pathname).href;
const OUT = new URL("./out/screens/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const T = process.env.THEME ?? "dark";

const browser = await chromium.launch();
async function shot(params, out, { width, height, ratio = 2, full = false }) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: ratio });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(`${PAGE}?${new URLSearchParams(params)}`);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(150);
  if (errors.length) throw new Error(`${out}: ${errors.join("; ")}`);
  await page.screenshot({ path: `${OUT}${out}`, fullPage: full });
  await ctx.close();
  return `${OUT}${out}`;
}
const tv = (screen, p) => shot({ s: "tv", screen, p, t: T }, `tv-${screen}-${T}.png`, { width: 1920, height: 1080, ratio: 1 });
const phone = (screen) => shot({ s: "phone", screen, t: T }, `phone-${screen}-${T}.png`, { width: 459, height: 900, ratio: 2, full: true });

const files = {
  tvLife: await tv("life", 35),
  tvPc: await tv("pc", 60),
  tvTotal: await tv("total", 20),
  phoneLife: await phone("life"),
  phonePc: await phone("pc"),
  phoneTotal: await phone("total"),
  settings: await shot({ s: "settings", t: T }, `settings-${T}.png`, { width: 459, height: 300, ratio: 2, full: true }),
};

const img = (f) => `data:image/png;base64,${readFileSync(f).toString("base64")}`;
const cap = (t, c) => `<div style="font:800 26px/1.2 -apple-system,Helvetica,Arial;margin:0 0 4px 2px">${t}</div><div style="font:500 17px/1.4 -apple-system,Helvetica,Arial;color:#555b69;margin:0 0 12px 2px">${c}</div>`;
const frame = (f, w) => `<img src="${img(f)}" style="width:${w}px;display:block;border-radius:18px;box-shadow:0 8px 30px rgba(0,0,0,.14)">`;
async function sheet(out, html, width) {
  const ctx = await browser.newContext({ viewport: { width, height: 800 }, deviceScaleFactor: 1.5 });
  const page = await ctx.newPage();
  await page.setContent(`<!doctype html><html><body style="margin:0;background:#f2f3f7;color:#15171c">${html}</body></html>`);
  await page.screenshot({ path: `${OUT}${out}`, fullPage: true });
  await ctx.close();
  console.log("sheet", `${OUT}${out}`);
}

// 1. The TV: three screens, one above the other (it reads top to bottom on a phone).
const W = 1100;
await sheet("sheet-tv.png", `<div style="padding:30px 30px 6px;font:800 34px/1.2 -apple-system,Helvetica,Arial">The office TV · three screens</div>
  <div style="padding:6px 30px 30px;display:flex;flex-direction:column;gap:30px">
    <div>${cap("1 · Life · 60 seconds", "The goal is life only: the ring, the pace, the bars and the rank. The pills up top show which screen is on and how long it has left.")}${frame(files.tvLife, W)}</div>
    <div>${cap("2 · P&amp;C · 15 seconds", "You, Moe and Maira: P&amp;C premium, policies and lines each, by carrier, by line, the latest P&amp;C sales. No goal on it.")}${frame(files.tvPc, W)}</div>
    <div>${cap("3 · Agency total · 15 seconds", "Life and P&amp;C added up: the same board as today, every premium counted, split in two colors.")}${frame(files.tvTotal, W)}</div>
  </div>`, W + 60);

// 2. Your control and the phone: Settings > TV screens, then This month with the same three views.
const PW = 390;
await sheet("sheet-phone.png", `<div style="padding:30px 30px 6px;font:800 34px/1.2 -apple-system,Helvetica,Arial">Your control, and the phone</div>
  <div style="padding:6px 30px 30px;display:flex;gap:28px;align-items:flex-start">
    <div style="width:${PW}px">${cap("Settings · TV screens", "Rotate, or keep the TV on one screen. Your phone sets it; the TV follows in a few seconds.")}${frame(files.settings, PW)}</div>
    <div style="width:${PW}px">${cap("This month · Life", "Opens on Life: the goal card and the bars are life only.")}${frame(files.phoneLife, PW)}</div>
    <div style="width:${PW}px">${cap("This month · P&amp;C", "The P&amp;C team, lines and carriers.")}${frame(files.phonePc, PW)}</div>
    <div style="width:${PW}px">${cap("This month · Total", "Life and P&amp;C added up.")}${frame(files.phoneTotal, PW)}</div>
  </div>`, PW * 4 + 28 * 3 + 60);
await browser.close();
console.log("done", OUT);
