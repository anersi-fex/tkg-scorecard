// Draws Scorecard's app icons, link card and iPhone opening screens into public/.
// Run: npm run icons
// Needs playwright-core (`npm install --no-save playwright-core`; no browser download) and a
// Chromium: CHROMIUM_PATH, else the one under /opt/pw-browsers. The mark is the same as ScoreMark
// in src/components/brand.tsx (keep the two geometries in sync).
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC = join(ROOT, "public");
const FONT = join(ROOT, "node_modules/@fontsource-variable/plus-jakarta-sans/files/plus-jakarta-sans-latin-wght-normal.woff2");

// The same geometry as brand.tsx: three podium steps with rounded tops, a star over the middle
// one on big marks; small marks (favicon) drop the star and grow the steps.
const STEPS_BIG = [
  [152, 224, 432, 776],
  [400, 224, 312, 776],
  [648, 224, 512, 776],
];
const STEPS_SMALL = [
  [136, 240, 384, 808],
  [392, 240, 232, 808],
  [648, 240, 488, 808],
];
const STAR = { cx: 512, cy: 196, outer: 74, inner: 31 };

function stepPath([x, w, top, bottom], r = 44) {
  return `M${x} ${bottom}V${top + r}Q${x} ${top} ${x + r} ${top}H${x + w - r}Q${x + w} ${top} ${x + w} ${top + r}V${bottom}Z`;
}
function starPath() {
  const pts = [];
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? STAR.outer : STAR.inner;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    pts.push(`${(STAR.cx + r * Math.cos(a)).toFixed(1)} ${(STAR.cy + r * Math.sin(a)).toFixed(1)}`);
  }
  return `M${pts.join("L")}Z`;
}
function podiumPath(small) {
  const steps = (small ? STEPS_SMALL : STEPS_BIG).map((s) => stepPath(s)).join("");
  return small ? steps : steps + starPath();
}

// Crimson, the default colorway (owner pick, 2026-10-27): the icons stay Crimson whatever Settings says.
const GRAD_FROM = "#c42b32";
const GRAD_TO = "#ff6b57";
const MARK_RADIUS = 0.27; // corner radius / size, as ScoreMark draws it

// iPhone screens in CSS points and pixel ratio (the same list as Sales Coach's layout).
const SPLASH_SCREENS = [
  [440, 956, 3], // 16 Pro Max, 17 Pro Max, 18 Pro Max
  [420, 912, 3], // Air
  [402, 874, 3], // 16 Pro, 17, 17 Pro, 18 Pro
  [430, 932, 3], // 14 Pro Max, 15 Plus, 15 Pro Max, 16 Plus
  [393, 852, 3], // 14 Pro, 15, 15 Pro, 16
  [428, 926, 3], // 12 Pro Max, 13 Pro Max, 14 Plus
  [390, 844, 3], // 12, 13, 14, 16e, 17e
  [375, 812, 3], // X, XS, 11 Pro, 12 mini, 13 mini
  [414, 896, 3], // XS Max, 11 Pro Max
  [414, 896, 2], // XR, 11
  [375, 667, 2], // 8, SE (2nd and 3rd generation)
  [414, 736, 3], // 6s Plus to 8 Plus
];

const THEMES = {
  light: { bg: "#f2f3f7", text: "#15171c", muted: "#646a78", suffix: "" },
  dark: { bg: "#0b0d12", text: "#eef0f5", muted: "#8c93a5", suffix: "-dark" },
};

/** The mark as standalone SVG. `rx` is the corner radius on the 1024 canvas (0 = full bleed). */
function markSvg({ small = false, rx = Math.round(1024 * MARK_RADIUS), scale = 1 } = {}) {
  const t = scale === 1 ? "" : ` transform="translate(512 512) scale(${scale}) translate(-512 -512)"`;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">` +
    `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${GRAD_FROM}"/><stop offset="1" stop-color="${GRAD_TO}"/></linearGradient></defs>` +
    `<rect width="1024" height="1024"${rx ? ` rx="${rx}"` : ""} fill="url(#g)"/>` +
    `<path d="${podiumPath(small)}" fill="#fff"${t}/>` +
    `</svg>`
  );
}

/** The mark as ScoreMark renders it in the app: a CSS gradient squircle holding the white podium. */
function markHtml(size, radius = Math.round(size * MARK_RADIUS), extraStyle = "") {
  return (
    `<div style="width:${size}px;height:${size}px;border-radius:${radius}px;background:linear-gradient(135deg,${GRAD_FROM},${GRAD_TO});flex:none;${extraStyle}">` +
    `<svg viewBox="0 0 1024 1024" width="${size}" height="${size}" style="display:block"><path d="${podiumPath(size < 48)}" fill="#fff"/></svg>` +
    `</div>`
  );
}

function page(body, bg = "transparent") {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face { font-family: "Plus Jakarta Sans"; src: url("${pathToFileURL(FONT).href}") format("woff2"); font-weight: 200 800; font-style: normal; }
html, body { margin: 0; padding: 0; width: 100%; height: 100%; overflow: hidden; }
body { background: ${bg}; font-family: "Plus Jakarta Sans", sans-serif; -webkit-font-smoothing: antialiased; }
svg { display: block; }
.fill { width: 100vw; height: 100vh; }
.fill > svg { width: 100%; height: 100%; }
.center { position: fixed; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; }
</style></head><body>${body}</body></html>`;
}

function splashHtml(theme) {
  const { bg, text, muted } = THEMES[theme];
  return page(
    `<main class="center">` +
      markHtml(112, 26) +
      `<div style="margin-top:22px;font-size:28px;font-weight:800;letter-spacing:-0.025em;line-height:1.15;color:${text}">Scorecard</div>` +
      `<div style="margin-top:4px;font-size:14px;font-weight:600;line-height:1.3;color:${muted}">by TKG</div>` +
      `</main>`,
    bg,
  );
}

// The plain link card: the mark and the name on the light page color, with a faint row of
// leaderboard bars along the bottom (Sales Coach's card has a faint waveform there).
function ogHtml() {
  const heights = [120, 210, 160, 260, 90, 190, 300, 140, 230, 110, 270, 170, 200, 130, 240, 100, 220, 150];
  const bars = heights.map((h, i) => `<rect x="${-20 + i * 70}" y="${630 - 40 - h}" width="50" height="${h}" rx="14"/>`);
  const band =
    `<svg width="1200" height="630" viewBox="0 0 1200 630" style="position:fixed;inset:0">` +
    `<defs><linearGradient id="b" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="1200" y2="630"><stop offset="0" stop-color="${GRAD_FROM}"/><stop offset="1" stop-color="${GRAD_TO}"/></linearGradient></defs>` +
    `<g fill="url(#b)" opacity="0.13">${bars.join("")}</g></svg>`;
  const { text, muted } = THEMES.light;
  return page(
    band +
      `<main style="position:fixed;left:96px;top:130px;display:flex;align-items:center;gap:46px">` +
      markHtml(220, 59, "box-shadow:0 2px 6px rgba(21,23,28,0.06),0 18px 40px rgba(196,43,50,0.24)") +
      `<div><div style="font-size:104px;font-weight:800;letter-spacing:-0.035em;line-height:1.05;color:${text}">Scorecard</div>` +
      `<div style="margin-top:14px;font-size:38px;font-weight:600;line-height:1.2;color:${muted}">by The Koka Group</div></div>` +
      `</main>`,
    THEMES.light.bg,
  );
}

async function loadChromium() {
  const tries = ["playwright-core", "playwright", process.env.PLAYWRIGHT_CORE, "/opt/node-tools/node_modules/playwright-core/index.mjs"];
  for (const spec of tries.filter(Boolean)) {
    try {
      const mod = await import(spec.startsWith("/") ? pathToFileURL(spec).href : spec);
      const chromium = mod.chromium ?? mod.default?.chromium;
      if (chromium) return chromium;
    } catch {
      // try the next one
    }
  }
  throw new Error("playwright-core not found: run `npm install --no-save playwright-core`, or set PLAYWRIGHT_CORE to its index.mjs");
}

function findChromiumBinary() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  if (existsSync("/opt/pw-browsers/chromium")) return "/opt/pw-browsers/chromium";
  if (existsSync("/opt/pw-browsers")) {
    for (const dir of readdirSync("/opt/pw-browsers").filter((d) => /^chromium-\d+$/.test(d)).sort().reverse()) {
      const bin = join("/opt/pw-browsers", dir, "chrome-linux", "chrome");
      if (existsSync(bin)) return bin;
    }
  }
  return undefined; // let Playwright use its own download, if any
}

/** Width and height from a PNG's header. */
function pngSize(file) {
  const head = readFileSync(file).subarray(0, 24);
  if (head.toString("latin1", 1, 4) !== "PNG") throw new Error(`${file} is not a PNG`);
  return [head.readUInt32BE(16), head.readUInt32BE(20)];
}

async function main() {
  if (!existsSync(FONT)) throw new Error(`Plus Jakarta Sans not found at ${FONT} (run npm install)`);
  const chromium = await loadChromium();
  const browser = await chromium.launch({ executablePath: findChromiumBinary() });
  const work = mkdtempSync(join(tmpdir(), "sc-icons-"));
  const contexts = new Map();
  let n = 0;
  const written = [];

  // One browser context per pixel ratio; pages are file:// so the file:// font loads.
  async function render({ html, width, height, ratio = 1, out, transparent = false }) {
    if (!contexts.has(ratio)) contexts.set(ratio, await browser.newContext({ deviceScaleFactor: ratio }));
    const tab = await contexts.get(ratio).newPage();
    const file = join(work, `page-${n++}.html`);
    writeFileSync(file, html);
    await tab.setViewportSize({ width, height });
    await tab.goto(pathToFileURL(file).href);
    const fontOk = await tab.evaluate(async () => {
      await document.fonts.ready;
      const faces = await document.fonts.load('800 28px "Plus Jakarta Sans"');
      return faces.length > 0 && faces.every((f) => f.status === "loaded");
    });
    if (!fontOk) throw new Error("Plus Jakarta Sans did not load");
    const jpeg = out.endsWith(".jpg");
    await tab.screenshot({ path: out, type: jpeg ? "jpeg" : "png", quality: jpeg ? 90 : undefined, omitBackground: transparent });
    await tab.close();
    if (!jpeg) {
      const [w, h] = pngSize(out);
      if (w !== width * ratio || h !== height * ratio) throw new Error(`${out} is ${w}x${h}, expected ${width * ratio}x${height * ratio}`);
    }
    written.push(out.slice(ROOT.length + 1));
  }

  try {
    mkdirSync(join(PUBLIC, "splash"), { recursive: true });

    // The favicon scale uses the small podium (no star); every bigger icon the full one.
    writeFileSync(join(PUBLIC, "icon.svg"), markSvg({ small: true }) + "\n");
    written.push("public/icon.svg");

    const svgPage = (svg) => page(`<div class="fill">${svg}</div>`);
    // iOS rounds the corners itself: full bleed, no transparency.
    await render({ html: page(`<div class="fill">${markSvg({ rx: 0 })}</div>`, GRAD_FROM), width: 180, height: 180, out: join(PUBLIC, "apple-touch-icon.png") });
    for (const size of [192, 512]) {
      await render({ html: svgPage(markSvg()), width: size, height: size, out: join(PUBLIC, `icon-${size}.png`), transparent: true });
    }
    // Android crops maskable icons to as little as the central 80% circle: keep the podium inside it.
    await render({ html: page(`<div class="fill">${markSvg({ rx: 0, scale: 0.8 })}</div>`, GRAD_FROM), width: 512, height: 512, out: join(PUBLIC, "icon-maskable-512.png") });
    await render({ html: svgPage(markSvg({ small: true })), width: 32, height: 32, out: join(PUBLIC, "favicon-32.png"), transparent: true });

    await render({ html: ogHtml(), width: 1200, height: 630, out: join(PUBLIC, "og.jpg") });

    for (const [w, h, ratio] of SPLASH_SCREENS) {
      for (const theme of ["light", "dark"]) {
        const name = `splash-${w * ratio}x${h * ratio}${THEMES[theme].suffix}.png`;
        await render({ html: splashHtml(theme), width: w, height: h, ratio, out: join(PUBLIC, "splash", name) });
      }
    }
  } finally {
    await browser.close();
    rmSync(work, { recursive: true, force: true });
  }
  console.log(`Wrote ${written.length} files:\n  ${written.join("\n  ")}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
