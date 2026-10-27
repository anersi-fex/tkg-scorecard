// Renders the live app (local build on :3000, seeded by scripts/smoke.mjs) under each colorway in
// design/colorways.mjs: the TV board and the phone's This month screen, dark and light, then one
// contact sheet per colorway and an overview sheet, into design/out/.
//   node design/render-colorways.mjs
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { COLORWAYS, overrideCss } from "./colorways.mjs";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_DIR ?? "playwright");
const APP = process.env.APP ?? "http://localhost:3000";
const PASSWORD = process.env.TEAM_PASSWORD ?? "team-pass";
const OUT = new URL("./out/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const base = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const p0 = await base.newPage();
await p0.goto(`${APP}/login`);
await p0.fill("#password", PASSWORD);
await Promise.all([p0.waitForURL((u) => !u.pathname.startsWith("/login")), p0.click("button[type=submit]")]);
const cookies = await base.cookies();
await base.close();

async function shot({ url, width, height, ratio = 1, mode, css, out, mobile = false }) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: ratio, isMobile: mobile, hasTouch: mobile, colorScheme: mode });
  await ctx.addCookies(cookies);
  await ctx.addInitScript((m) => {
    try {
      localStorage.setItem("theme", m);
    } catch {}
  }, mode);
  const page = await ctx.newPage();
  await page.goto(url);
  await page.waitForSelector("text=Leaderboard");
  await page.addStyleTag({ content: css });
  await page.evaluate(() => document.body.classList.add("board-idle"));
  await page.waitForTimeout(700);
  await page.screenshot({ path: out });
  await ctx.close();
}

const sheets = [];
for (const c of COLORWAYS) {
  const css = overrideCss(c);
  const files = {};
  for (const mode of ["dark", "light"]) {
    files[`board-${mode}`] = `${OUT}${c.key}-board-${mode}.png`;
    await shot({ url: `${APP}/board?theme=${mode}`, width: 1920, height: 1080, mode, css, out: files[`board-${mode}`] });
    files[`phone-${mode}`] = `${OUT}${c.key}-phone-${mode}.png`;
    await shot({ url: `${APP}/`, width: 390, height: 844, ratio: 2, mode, css, out: files[`phone-${mode}`], mobile: true });
  }
  // The contact sheet: the name and idea, swatches, the two boards, the two phones.
  const sw = (t) => `<span style="display:inline-block;width:34px;height:34px;border-radius:10px;background:linear-gradient(135deg,${t.gradFrom},${t.gradTo})"></span><span style="display:inline-block;width:22px;height:22px;border-radius:7px;background:${t.bar};margin-left:6px"></span><span style="display:inline-block;width:22px;height:22px;border-radius:7px;background:${t.tint};margin-left:6px;border:1px solid #ddd"></span>`;
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
  @font-face{font-family:"Plus Jakarta Sans";src:url("${pathToFileURL("/home/user/tkg-scorecard/node_modules/@fontsource-variable/plus-jakarta-sans/files/plus-jakarta-sans-latin-wght-normal.woff2").href}") format("woff2");font-weight:200 800}
  body{margin:0;background:#f2f3f7;font-family:"Plus Jakarta Sans",sans-serif;color:#15171c;width:1800px}
  .wrap{padding:36px 40px 40px}
  h1{font-size:44px;margin:0;letter-spacing:-0.03em;font-weight:800}
  h1 small{font-size:20px;color:#646a78;font-weight:600;margin-left:14px;letter-spacing:0}
  p{font-size:20px;color:#3d424d;margin:8px 0 22px;max-width:1300px}
  .row{display:flex;gap:24px;align-items:flex-start}
  .board{width:848px;border-radius:14px;box-shadow:0 8px 24px rgba(21,23,28,.12)}
  .phone{width:300px;border-radius:26px;box-shadow:0 8px 24px rgba(21,23,28,.14)}
  .lab{font-size:15px;font-weight:700;color:#646a78;letter-spacing:.08em;text-transform:uppercase;margin:0 0 8px}
  .sw{display:flex;align-items:center;gap:10px;margin-top:10px}
  </style></head><body><div class="wrap">
  <h1>${c.name} <small>Scorecard colorway</small></h1><p>${c.idea}</p>
  <div class="row"><div><div class="lab">TV board, dark</div><img class="board" src="${pathToFileURL(files["board-dark"]).href}"></div><div><div class="lab">TV board, light</div><img class="board" src="${pathToFileURL(files["board-light"]).href}"></div></div>
  <div class="row" style="margin-top:26px"><div><div class="lab">Phone, dark</div><img class="phone" src="${pathToFileURL(files["phone-dark"]).href}"></div><div><div class="lab">Phone, light</div><img class="phone" src="${pathToFileURL(files["phone-light"]).href}"></div>
  <div style="margin-left:30px"><div class="lab">Swatches</div><div class="sw">${sw(c.dark)}<span style="font-size:15px;color:#646a78;margin-left:8px">dark: gradient · bar · tint</span></div><div class="sw">${sw(c.light)}<span style="font-size:15px;color:#646a78;margin-left:8px">light: gradient · bar · tint</span></div></div></div>
  </div></body></html>`;
  const file = `${OUT}${c.key}.html`;
  writeFileSync(file, html);
  const ctx = await browser.newContext({ viewport: { width: 1800, height: 1400 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  await page.goto(pathToFileURL(file).href);
  await page.waitForTimeout(400);
  const h = await page.evaluate(() => document.body.scrollHeight);
  await page.setViewportSize({ width: 1800, height: h });
  const sheet = `${OUT}sheet-${c.key}.png`;
  await page.screenshot({ path: sheet });
  await ctx.close();
  sheets.push({ c, sheet, files });
  console.log("sheet", c.name);
}

// The overview: every colorway's dark board and light phone side by side.
const cells = sheets
  .map(
    ({ c, files }, i) =>
      `<div class="cell"><div class="t">${i + 1}. ${c.name}</div><img class="b" src="${pathToFileURL(files["board-dark"]).href}"><div class="ph"><img src="${pathToFileURL(files["phone-light"]).href}"><img src="${pathToFileURL(files["phone-dark"]).href}"></div></div>`,
  )
  .join("");
const overview = `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face{font-family:"Plus Jakarta Sans";src:url("${pathToFileURL("/home/user/tkg-scorecard/node_modules/@fontsource-variable/plus-jakarta-sans/files/plus-jakarta-sans-latin-wght-normal.woff2").href}") format("woff2");font-weight:200 800}
body{margin:0;background:#f2f3f7;font-family:"Plus Jakarta Sans",sans-serif;color:#15171c;width:1800px}
.wrap{padding:36px 40px 40px}h1{font-size:40px;margin:0 0 18px;letter-spacing:-0.03em;font-weight:800}
.grid{display:grid;grid-template-columns:repeat(2,1fr);gap:28px}
.cell{background:#fff;border-radius:22px;padding:18px;box-shadow:0 8px 24px rgba(21,23,28,.08)}
.t{font-size:24px;font-weight:800;margin:0 0 10px;letter-spacing:-0.02em}
.b{width:100%;border-radius:12px;display:block}
.ph{display:flex;gap:12px;margin-top:12px}.ph img{width:calc(50% - 6px);border-radius:16px}
</style></head><body><div class="wrap"><h1>Scorecard colorways: pick one (or mix)</h1><div class="grid">${cells}</div></div></body></html>`;
writeFileSync(`${OUT}overview.html`, overview);
const ctx = await browser.newContext({ viewport: { width: 1800, height: 1400 } });
const page = await ctx.newPage();
await page.goto(pathToFileURL(`${OUT}overview.html`).href);
await page.waitForTimeout(400);
const h = await page.evaluate(() => document.body.scrollHeight);
await page.setViewportSize({ width: 1800, height: h });
await page.screenshot({ path: `${OUT}overview.png` });
await ctx.close();
await browser.close();
console.log("done", sheets.length);
