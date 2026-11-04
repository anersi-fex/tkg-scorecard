// Renders the P&C color ideas (owner, 2026-11-04: "i don't like that much purple on the screen. Be
// more creative") from design/screens-mockups.html: the TV's P&C screen and its Agency total screen
// for each idea, into design/out/screens/pc-colors.png.   node design/render-pc-colors.mjs
import { mkdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_DIR ?? "playwright");
const PAGE = pathToFileURL(new URL("./screens-mockups.html", import.meta.url).pathname).href;
const OUT = new URL("./out/screens/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
async function tv(screen, pc) {
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(`${PAGE}?${new URLSearchParams({ s: "tv", screen, pc, t: "dark", p: screen === "pc" ? "60" : "20" })}`);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(150);
  if (errors.length) throw new Error(errors.join("; "));
  const file = `${OUT}pc-${pc}-${screen}.png`;
  await page.screenshot({ path: file });
  await ctx.close();
  return file;
}
const IDEAS = [
  ["teal", "A · Teal tide", "The opposite of the brand's red on the color wheel: coral and teal. Only the bars, the dots and the screen pill are teal; numbers stay white."],
  ["stripes", "B · Brand stripes", "No second color at all. P&C is the brand red with stripes, life is solid, so the two still read apart."],
  ["steel", "C · Steel", "A quiet silver-blue, so P&C reads as the side dish next to life."],
];
const shots = {};
for (const [pc] of IDEAS) shots[pc] = { pc: await tv("pc", pc), total: await tv("total", pc) };
const img = (f) => `data:image/png;base64,${readFileSync(f).toString("base64")}`;
const W = 760;
const col = ([pc, title, note]) => `<div style="width:${W}px">
  <div style="font:800 28px/1.2 -apple-system,Helvetica,Arial">${title}${pc === "teal" ? ` <span style="font:700 16px/1 -apple-system,Helvetica,Arial;background:#15171c;color:#fff;border-radius:999px;padding:6px 12px;vertical-align:5px">my pick</span>` : ""}</div>
  <div style="font:500 17px/1.4 -apple-system,Helvetica,Arial;color:#555b69;margin:6px 0 12px;min-height:48px">${note}</div>
  <img src="${img(shots[pc].pc)}" style="width:${W}px;display:block;border-radius:16px;box-shadow:0 8px 30px rgba(0,0,0,.14)">
  <div style="font:700 15px/1 -apple-system,Helvetica,Arial;color:#555b69;margin:14px 0 8px">Agency total screen</div>
  <img src="${img(shots[pc].total)}" style="width:${W}px;display:block;border-radius:16px;box-shadow:0 8px 30px rgba(0,0,0,.14)"></div>`;
const html = `<!doctype html><html><body style="margin:0;background:#f2f3f7;color:#15171c">
  <div style="padding:30px 30px 4px;font:800 34px/1.2 -apple-system,Helvetica,Arial">P&amp;C color · three ideas, far less color on screen</div>
  <div style="padding:16px 30px 30px;display:flex;gap:30px;align-items:flex-start">${IDEAS.map(col).join("")}</div></body></html>`;
const ctx = await browser.newContext({ viewport: { width: W * 3 + 30 * 4, height: 800 }, deviceScaleFactor: 1.5 });
const page = await ctx.newPage();
await page.setContent(html);
await page.screenshot({ path: `${OUT}pc-colors.png`, fullPage: true });
await browser.close();
console.log("done", `${OUT}pc-colors.png`);
