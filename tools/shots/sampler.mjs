// The sampler: the game, its menus and its cars on one sheet.
//
//   npm run sampler          press/sampler/sampler.jpg, from the stills on disk
//
// It is a sampler in the other sense of the word: a little of everything,
// laid out so the whole game can be taken in at once. Three bands.
//
//   the road   the in-game reference stills (npm run shots), 4 x 2
//   the menus  the menu screens (node tools/shots/menus.mjs), 6 across
//   the cars   all 17 studio stills (npm run cars:render), 6 across
//
// It builds nothing itself. Every picture is a file some other tool wrote,
// and this stops, naming each one, if any is missing: a sampler with a hole
// in it says the game has a hole in it.
//
// WHY CHROMIUM, and why not tools/shots/sheet.py. The old contact sheet is
// drawn with PIL, which sets Arabic as disconnected letterforms
// (press/logo/README.md says so), and it reads its fonts from a path
// outside the repo. This is HTML with the repo's own vendored faces
// (press/logo/fonts) embedded in it, rendered the way press/logo/render.mjs
// renders the marks, so the Arabic is shaped and nothing depends on the
// machine it runs on.
//
// WHY THE PICTURES ARE SCALED HERE. Each still is brought down once, by
// sharp's Lanczos, to exactly the size it is shown at, and embedded as that.
// The browser does no scaling at all, so what is on the sheet is not at the
// mercy of its downscaler (a 2560 px still shown at 492 px is the case where
// a bilinear one aliases the thin lines worst).
import sharp from "sharp";
import { chromium } from "playwright-core";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync, rmSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const OUT_DIR = "press/sampler";
const OUT = `${OUT_DIR}/sampler.jpg`;

// ------------------------------------------------------------- the picture --
const W = 3200, MARGIN = 64, GAP = 24;
const INNER = W - 2 * MARGIN;
const tile = (cols, aspect) => {
  const w = Math.floor((INNER - (cols - 1) * GAP) / cols);
  return { cols, w, h: Math.round(w / aspect) };
};
const ROAD = tile(4, 16 / 9);     // 750 x 422
const MENU = tile(6, 1280 / 860); // 492 x 331
const CAR = tile(6, 16 / 9);      // 492 x 277

// What the stills are of. The hours are the capture tool's own
// (tools/shots/capture.mjs SHOTS): the game races midnight to 05:50, so
// "night" is half past two.
const ROAD_SHOTS = [
  ["night", "NIGHT 02:30", "the shipped look"],
  ["dawn", "DAWN 05:36", "lamps still lit"],
  ["noon", "NOON 12:30", "towers still black at midday"],
  ["dusk", "DUSK 18:12", "the key light low and warm"],
  ["coast", "COAST 02:30", "the seaward leg"],
  ["city", "CITY 02:30", "towers behind the road"],
  ["drift", "DRIFT", "full lock"],
  ["rain", "RAIN", "a downpour on the coast road"],
];
// A picture that shows something known to be wrong says so, in amber, as the
// old contact sheet did (tools/shots/sheet.py FLAGGED): anything still wrong
// is called out rather than quietly presented as finished work. The noon
// towers are the 2 Nov finding in press/shots/README.md, and they are still
// black on the 18 Nov re-shoot.
const FLAGGED = new Set(["noon"]);
// Arabic only where the game itself says it (src/app/race/page.tsx): the
// main menu and the pause screen have no Arabic name there, and none is made up.
const MENU_SHOTS = [
  ["menu", "MAIN MENU", ""],
  ["garage", "GARAGE", "الكراج"],
  ["hub", "ONLINE HUB", "التجمع"],
  ["pause", "PAUSE", ""],
  ["settings", "SETTINGS", "الإعدادات"],
  ["howto", "HOW TO PLAY", "كيف تلعب"],
];

// ------------------------------------------------------------------ inputs --
const cars = JSON.parse(readFileSync("press/renders/cars.json", "utf8"));
const sources = [
  ...ROAD_SHOTS.map(([id]) => ({ id: `shot ${id}`, file: `press/shots/${id}.png`, box: ROAD })),
  ...MENU_SHOTS.map(([id]) => ({ id: `menu ${id}`, file: `press/menus/${id}.png`, box: MENU })),
  ...cars.map((c) => ({ id: `car ${c.id}`, file: `press/renders/${c.id}.png`, box: CAR })),
];
const missing = sources.filter((s) => !existsSync(s.file));
if (missing.length) {
  console.error(`The sampler needs ${missing.length} picture${missing.length === 1 ? "" : "s"} that ${missing.length === 1 ? "is" : "are"} not on disk:`);
  for (const m of missing) console.error(`  ${m.file}  (${m.id})`);
  console.error("Shoot them first: npm run shots, node tools/shots/menus.mjs, npm run cars:render.");
  process.exit(1);
}

const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const dataUri = (buf, mime) => `data:${mime};base64,${buf.toString("base64")}`;
const font = (file) => readFileSync(`press/logo/fonts/${file}`);

async function scaled(s) {
  const buf = await sharp(s.file)
    .removeAlpha()
    .resize(s.box.w, s.box.h, { fit: "cover", kernel: "lanczos3" })
    .png({ compressionLevel: 9 })
    .toBuffer();
  return dataUri(buf, "image/png");
}
const pics = new Map();
for (const s of sources) pics.set(s.file, await scaled(s));

// -------------------------------------------------------------------- page --
const figure = (file, box, left, right = "", leftClass = "") => `
  <figure style="width:${box.w}px">
    <img src="${pics.get(file)}" width="${box.w}" height="${box.h}" alt="">
    <figcaption><span class="en ${leftClass}">${esc(left)}</span>${right ? `<span class="ar" lang="ar" dir="rtl">${esc(right)}</span>` : ""}</figcaption>
  </figure>`;

const road = ROAD_SHOTS.map(([id, head, tail]) => figure(`press/shots/${id}.png`, ROAD, `${head} · ${tail}`, "", FLAGGED.has(id) ? "flag" : "")).join("");
const menus = MENU_SHOTS.map(([id, en, ar]) => figure(`press/menus/${id}.png`, MENU, en, ar)).join("");
const carsHtml = cars.map((c) => figure(`press/renders/${c.id}.png`, CAR, c.name, c.ar, "car")).join("");

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<style>
  @font-face { font-family: "Shoulders"; src: url("${dataUri(font("BigShoulders-Bold.ttf"), "font/ttf")}"); font-weight: 700; }
  @font-face { font-family: "Mono"; src: url("${dataUri(font("GeistMono-Regular.ttf"), "font/ttf")}"); }
  @font-face { font-family: "PlexAr"; src: url("${dataUri(font("IBMPlexSansArabic-Regular.woff2"), "font/woff2")}") format("woff2"); font-weight: 400; }
  @font-face { font-family: "PlexAr"; src: url("${dataUri(font("IBMPlexSansArabic-Bold.woff2"), "font/woff2")}") format("woff2"); font-weight: 700; }
  :root { --ground: #05070e; --ink: #e8ecf4; --soft: #b0bacc; --dim: #78849a; --line: #28303f; --sodium: #ffc45c; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { background: var(--ground); }
  body { width: ${W}px; padding: 64px ${MARGIN}px 56px; color: var(--ink); }
  header { display: flex; align-items: flex-end; justify-content: space-between; padding-bottom: 36px; border-bottom: 1px solid var(--line); }
  h1 { font: 700 168px/0.9 "Shoulders", sans-serif; letter-spacing: 0.005em; text-transform: uppercase; }
  h1 b { color: var(--sodium); font-weight: 700; }
  .title-ar { font: 400 58px/1.3 "PlexAr", sans-serif; color: var(--soft); margin-top: 14px; }
  .strap { font: 400 25px/1 "Mono", monospace; letter-spacing: 0.22em; color: var(--soft); text-transform: uppercase; }
  .note { font: 400 21px/1.5 "Mono", monospace; color: var(--dim); text-align: right; letter-spacing: 0.04em; }
  h2 { font: 700 50px/1 "Shoulders", sans-serif; letter-spacing: 0.08em; text-transform: uppercase; color: var(--sodium);
       display: flex; align-items: center; gap: 24px; margin: 52px 0 26px; }
  h2::after { content: ""; flex: 1; height: 1px; background: var(--line); }
  h2 small { font: 400 21px/1 "Mono", monospace; letter-spacing: 0.1em; color: var(--dim); order: 3; }
  .grid { display: flex; flex-wrap: wrap; gap: 24px ${GAP}px; }
  figure img { display: block; outline: 1px solid #2e3648; outline-offset: -1px; }
  figcaption { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; padding-top: 10px; height: 44px; overflow: hidden; }
  .en { font: 400 21px/1.2 "Mono", monospace; color: var(--soft); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .en.car { font: 700 25px/1.2 "Shoulders", sans-serif; letter-spacing: 0.07em; text-transform: uppercase; color: var(--ink); }
  .en.flag { color: var(--sodium); }
  .ar { font: 400 22px/1.2 "PlexAr", sans-serif; color: var(--soft); white-space: nowrap; }
  footer { margin-top: 44px; padding-top: 22px; border-top: 1px solid var(--line); display: flex; justify-content: space-between;
           font: 400 20px/1.4 "Mono", monospace; color: var(--dim); letter-spacing: 0.05em; }
  footer code { color: var(--soft); }
</style></head>
<body>
  <header>
    <div>
      <h1>Night <b>Racers</b></h1>
      <div class="title-ar" lang="ar" dir="rtl">متسابقو الليل</div>
    </div>
    <div style="text-align:right">
      <div class="strap">The road is yours after midnight</div>
      <div class="note" style="margin-top:18px">a sampler: the game, its menus<br>and all ${cars.length} of its cars</div>
    </div>
  </header>

  <h2>The road <small>${ROAD_SHOTS.length} reference stills · known states, not lucky frames</small></h2>
  <div class="grid">${road}</div>

  <h2>The menus <small>${MENU_SHOTS.length} screens</small></h2>
  <div class="grid">${menus}</div>

  <h2>The cars <small>${cars.length} studio stills</small></h2>
  <div class="grid">${carsHtml}</div>

  <footer>
    <span>reference stills <code>npm run shots</code> · menus <code>node tools/shots/menus.mjs</code> · cars <code>npm run cars:render</code></span>
    <span>this sheet <code>npm run sampler</code></span>
  </footer>
</body></html>`;

// ----------------------------------------------------------------- browser --
const candidates = [
  process.env.CHROME_PATH,
  process.env.PLAYWRIGHT_BROWSERS_PATH && `${process.env.PLAYWRIGHT_BROWSERS_PATH}/chromium/chrome-linux/chrome`,
  process.env.PLAYWRIGHT_BROWSERS_PATH && `${process.env.PLAYWRIGHT_BROWSERS_PATH}/chromium`,
  "/usr/bin/chromium", "/usr/bin/google-chrome",
].filter(Boolean);
const exe = candidates.find((p) => existsSync(p));
if (!exe) { console.error("No Chromium found. Set CHROME_PATH."); process.exit(2); }

mkdirSync(OUT_DIR, { recursive: true });
const tmp = mkdtempSync(join(tmpdir(), "sampler-"));
const pageFile = join(tmp, "sampler.html");
writeFileSync(pageFile, html);
const browser = await chromium.launch({ executablePath: exe, args: ["--no-sandbox", "--disable-dev-shm-usage", "--force-color-profile=srgb"] });
try {
  const page = await browser.newPage({ viewport: { width: W, height: 1000 }, deviceScaleFactor: 1 });
  await page.goto("file://" + resolve(pageFile), { waitUntil: "load" });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(300);
  await page.screenshot({ path: OUT, type: "jpeg", quality: 90, fullPage: true });
} finally {
  await browser.close();
  rmSync(tmp, { recursive: true, force: true });
}
const meta = await sharp(OUT).metadata();
console.log(`${OUT}  ${meta.width}x${meta.height}  ${(statSync(OUT).size / 1e6).toFixed(1)} MB  (${sources.length} pictures)`);
for (const s of sources) {
  const d = new Date(statSync(s.file).mtimeMs).toISOString().slice(0, 10);
  console.log(`  ${d}  ${s.file}`);
}
