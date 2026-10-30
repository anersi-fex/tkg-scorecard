// Renders design/leaderboard-mockups.html: the four progress variants on the phone (dark and light)
// and on the TV, plus the corner-radius comparison, then composes contact sheets, into
// design/out/leaderboard/.   node design/render-leaderboard.mjs
import { mkdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_DIR ?? "playwright");
const PAGE = pathToFileURL(new URL("./leaderboard-mockups.html", import.meta.url).pathname).href;
const OUT = new URL("./out/leaderboard/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
async function shot(params, out, { width, height, ratio = 2, full = false, clip }) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: ratio });
  const page = await ctx.newPage();
  await page.goto(`${PAGE}?${new URLSearchParams(params)}`);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(150);
  await page.screenshot({ path: `${OUT}${out}`, fullPage: full, ...(clip ? { clip } : {}) });
  await ctx.close();
  return `${OUT}${out}`;
}

// The phone frame is the real layout width under the 85% zoom (459px for a 390pt iPhone); the sheets show it at 390.
const phone = (p, out) => shot(p, out, { width: 459, height: 993, ratio: 2, full: true });
const tv = (p, out) => shot(p, out, { width: 1920, height: 1080, ratio: 1 });

const files = {};
for (const v of ["A", "B", "C", "D"]) {
  files[`phone-${v}-dark`] = await phone({ v, s: "phone", t: "dark", r: 22 }, `phone-${v}-dark.png`);
  files[`phone-${v}-light`] = await phone({ v, s: "phone", t: "light", r: 22 }, `phone-${v}-light.png`);
  files[`tv-${v}`] = await tv({ v, s: "tv", t: "dark", r: 22 }, `tv-${v}-dark.png`);
}
for (const r of [22, 10, 6]) {
  files[`phone-r${r}`] = await phone({ v: "A", s: "phone", t: "dark", r }, `phone-r${r}-dark.png`);
  files[`phone-r${r}-light`] = await phone({ v: "A", s: "phone", t: "light", r }, `phone-r${r}-light.png`);
  files[`tv-r${r}`] = await tv({ v: "A", s: "tv", t: "dark", r }, `tv-r${r}-dark.png`);
  // Close-ups, so a 10px curve can be told from a 6px one.
  files[`tv-r${r}-zoom`] = await shot({ v: "A", s: "tv", t: "dark", r }, `tv-r${r}-zoom.png`, { width: 1920, height: 1080, ratio: 1, clip: { x: 24, y: 160, width: 1120, height: 560 } });
  files[`phone-r${r}-zoom`] = await shot({ v: "A", s: "phone", t: "dark", r }, `phone-r${r}-zoom.png`, { width: 459, height: 993, ratio: 3, clip: { x: 8, y: 150, width: 260, height: 190 } });
}

/** A contact sheet: tiles of images with a caption each, laid out in a row (or rows). */
async function sheet(out, { title, tiles, tileWidth, perRow = tiles.length, pageWidth }) {
  const img = (f) => `data:image/png;base64,${readFileSync(f).toString("base64")}`;
  const html = `<!doctype html><html><body style="margin:0;background:#f2f3f7;font-family:-apple-system,Helvetica,Arial,sans-serif;color:#15171c">
  <div style="padding:28px 28px 8px;font:800 30px/1.2 -apple-system,Helvetica,Arial">${title}</div>
  <div style="display:grid;grid-template-columns:repeat(${perRow},${tileWidth}px);gap:28px;padding:12px 28px 28px">
  ${tiles.map((t) => `<div><div style="font:800 20px/1.25 -apple-system,Helvetica,Arial;margin:0 0 4px 2px">${t.label}</div><div style="font:500 14px/1.35 -apple-system,Helvetica,Arial;color:#555b69;margin:0 0 10px 2px;min-height:38px">${t.caption ?? ""}</div><img src="${img(t.file)}" style="width:${tileWidth}px;display:block;border-radius:16px;box-shadow:0 8px 30px rgba(0,0,0,.12)"></div>`).join("")}
  </div></body></html>`;
  const ctx = await browser.newContext({ viewport: { width: pageWidth, height: 800 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await page.setContent(html);
  await page.screenshot({ path: `${OUT}${out}`, fullPage: true });
  await ctx.close();
  console.log("sheet", out);
}

const CAPTIONS = {
  A: "Even bars: one track, the same length for everyone. Percent at the end, green once the goal is hit.",
  B: "Rings: progress wraps each person's initials. Two lines per row, nothing stretches.",
  C: "Percent pill: no bar at all. The number does the work; green at the goal, red tint from 75%, gray below.",
  D: "Same scale: every bar measured against the leader, with a tick where each person's own goal sits.",
};
await sheet("progress-phone-dark.png", { title: "Progress to goal · phone · dark", tiles: ["A", "B", "C", "D"].map((v) => ({ label: `${v}`, caption: CAPTIONS[v], file: files[`phone-${v}-dark`] })), tileWidth: 390, pageWidth: 390 * 4 + 28 * 5 });
await sheet("progress-phone-light.png", { title: "Progress to goal · phone · light", tiles: ["A", "B", "C", "D"].map((v) => ({ label: `${v}`, caption: CAPTIONS[v], file: files[`phone-${v}-light`] })), tileWidth: 390, pageWidth: 390 * 4 + 28 * 5 });
await sheet("progress-tv.png", { title: "Progress to goal · the office TV", tiles: ["A", "B", "C", "D"].map((v) => ({ label: `${v}`, caption: CAPTIONS[v], file: files[`tv-${v}`] })), tileWidth: 900, perRow: 2, pageWidth: 900 * 2 + 28 * 3 });
const RADII = [["22", "Today: 22 px cards, pill chips"], ["10", "Slight: 10 px cards, 8 px tiles, 4 px chips"], ["6", "Very slight: 6 px cards, 5 px tiles, 3 px chips"]];
await sheet("corners-phone.png", { title: "Corners · phone (shown with option A)", tiles: [...RADII.map(([r, c]) => ({ label: `${r} px`, caption: c, file: files[`phone-r${r}`] })), ...RADII.map(([r]) => ({ label: `${r} px · close up`, caption: "", file: files[`phone-r${r}-zoom`] }))], tileWidth: 390, perRow: 3, pageWidth: 390 * 3 + 28 * 4 });
await sheet("corners-tv.png", { title: "Corners · the office TV", tiles: [...RADII.map(([r, c]) => ({ label: `${r} px`, caption: c.split(":")[0], file: files[`tv-r${r}`] })), ...RADII.map(([r]) => ({ label: `${r} px · close up`, caption: "", file: files[`tv-r${r}-zoom`] }))], tileWidth: 620, perRow: 3, pageWidth: 620 * 3 + 28 * 4 });
await browser.close();
console.log("done", OUT);
