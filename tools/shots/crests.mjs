// The crew sheet: every crest on the roster, drawn by the game.
//
//   npm run dev
//   npm run shot:crests
//
// The crests are DATA — four fields each, sitting on the rival records —
// and teams.ts turns those four fields into a picture. This sheet goes
// through the game's own routine (window.__grnShowroom.crestUrl) rather
// than reimplementing shapePath and the tag stamp, for the same reason
// tools/shots/accel.mjs drives the real engine: a press asset that draws
// its subject a second way is a press asset that will one day disagree
// with the product and look correct while doing it.
//
// So this file lays out and annotates. It does not draw a crest.

import { chromium } from "playwright-core";
import { existsSync, statSync } from "node:fs";

const C = [
  process.env.CHROME_PATH,
  process.env.PLAYWRIGHT_BROWSERS_PATH && `${process.env.PLAYWRIGHT_BROWSERS_PATH}/chromium`,
  process.env.PLAYWRIGHT_BROWSERS_PATH && `${process.env.PLAYWRIGHT_BROWSERS_PATH}/chromium/chrome-linux/chrome`,
  "/usr/bin/chromium", "/usr/bin/google-chrome",
].filter(Boolean);
// isFile, not exists. PLAYWRIGHT_BROWSERS_PATH is itself a directory and
// existsSync says yes to a directory, so a candidate list that only asks
// "is it there" picks the folder and playwright dies on EACCES trying to
// spawn it.
const exe = C.find((p) => existsSync(p) && statSync(p).isFile());
if (!exe) { console.error("No Chromium found. Set CHROME_PATH."); process.exit(2); }

const browser = await chromium.launch({
  executablePath: exe,
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--force-color-profile=srgb"],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
page.setDefaultTimeout(120000);
await page.goto("http://localhost:3000/race", { waitUntil: "networkidle" });
await page.evaluate(() => {
  localStorage.clear();
  localStorage.setItem("gulf-road-nights-onboarded", "2");
  localStorage.setItem("gulf-road-nights-coach", "3");
});
await page.reload({ waitUntil: "networkidle" });
await page.click("text=START ENGINE");
await page.waitForFunction(() => !!window.__grnShowroom?.crews, null, { timeout: 180000 });

// Pull the crests out at 4x the size they are laid out at, so the sheet
// is a 4K plate rather than an upscale of a card-sized PNG.
const crews = await page.evaluate(() =>
  window.__grnShowroom.crews().map((c) => ({
    ...c,
    url: c.crest ? window.__grnShowroom.crestUrl(c.crest, 512, c.tag) : null,
  }))
);
await page.close();

const withCrest = crews.filter((c) => c.url).length;
console.log(`${crews.length} crews, ${withCrest} with a crest`);

// The sheet, in the house style: night ground, sodium annotation, the
// same palette press/logo/PHILOSOPHY.md sets out.
const cell = (c) => `
  <div class="cell">
    <div class="art">${
      c.url
        ? `<img src="${c.url}" alt="">`
        : `<div class="none"><span>—</span></div>`
    }</div>
    <div class="crew">${c.crew}</div>
    <div class="meta">${c.area} · ${c.driver}</div>
    <div class="ar" dir="rtl" lang="ar">${c.arabicName}</div>
  </div>`;

const html = `<!doctype html><meta charset="utf-8">
<title>Night Racer — crew crests</title>
<style>
  @font-face { font-family:"Shoulders"; src:url("file://${process.cwd()}/press/logo/fonts/BigShoulders-Bold.ttf"); font-weight:700; }
  @font-face { font-family:"Mono"; src:url("file://${process.cwd()}/press/logo/fonts/GeistMono-Regular.ttf"); }
  @font-face { font-family:"PlexAr"; src:url("file://${process.cwd()}/press/logo/fonts/IBMPlexSansArabic-Bold.woff2") format("woff2"); font-weight:700; }
  * { margin:0; padding:0; box-sizing:border-box; }
  html, body { width:1600px; height:860px; }
  body { background:#05070e; font-family:"Mono",monospace; -webkit-font-smoothing:antialiased; overflow:hidden;
    background-image:
      radial-gradient(90% 60% at 50% 40%, rgba(255,176,60,0.055) 0%, rgba(0,0,0,0) 68%),
      linear-gradient(180deg,#070b16 0%,#05070e 55%,#04060c 100%); }
  header { padding:52px 72px 0; display:flex; justify-content:space-between; align-items:baseline; }
  h1 { font-family:"Shoulders",sans-serif; font-weight:700; transform:skewX(-11deg);
       font-size:58px; letter-spacing:0.06em; color:#e8ecf4; text-transform:uppercase; line-height:1; }
  h1 em { font-style:normal; color:#ffb03c; }
  .lab { font-family:"Mono",monospace; font-size:11px; letter-spacing:0.34em; text-transform:uppercase;
         color:rgba(232,236,244,0.34); }
  .rule { margin:26px 72px 0; height:1px; background:linear-gradient(90deg,
          rgba(255,176,60,0) 0%, rgba(255,176,60,0.45) 12%, rgba(255,176,60,0.45) 88%, rgba(255,176,60,0) 100%); }
  .grid { display:grid; grid-template-columns:repeat(4,1fr); gap:30px 22px; padding:40px 72px 0; }
  .cell { text-align:center; }
  .art { height:150px; display:flex; align-items:center; justify-content:center; }
  .art img { width:132px; height:132px; }
  .none { width:132px; height:132px; display:flex; align-items:center; justify-content:center;
          border:1px dashed rgba(232,236,244,0.16); border-radius:50%;
          color:rgba(232,236,244,0.22); font-size:34px; }
  .crew { margin-top:12px; font-family:"Shoulders",sans-serif; font-weight:700; font-size:22px;
          letter-spacing:0.05em; text-transform:uppercase; color:#e8ecf4; line-height:1.05; }
  .meta { margin-top:5px; font-size:10.5px; letter-spacing:0.18em; text-transform:uppercase;
          color:rgba(255,176,60,0.68); }
  .ar { margin-top:4px; font-family:"PlexAr",sans-serif; font-weight:700; font-size:15px;
        color:rgba(232,236,244,0.45); font-synthesis:none; }
  footer { position:absolute; left:72px; right:72px; bottom:34px; display:flex;
           justify-content:space-between; }
</style>
<header>
  <h1>Crew <em>Crests</em></h1>
  <div class="lab">Night Racer · متسابق الليل</div>
</header>
<div class="rule"></div>
<div class="grid">${crews.map(cell).join("")}</div>
<footer>
  <div class="lab">${withCrest} of ${crews.length} crews · shield · circle · hex · diamond</div>
  <div class="lab">Drawn by teams.ts — the same routine the challenge card uses</div>
</footer>`;

const out = await browser.newPage({ viewport: { width: 1600, height: 860 }, deviceScaleFactor: 3840 / 1600 });
await out.setContent(html, { waitUntil: "networkidle" });
await out.evaluate(() => document.fonts.ready);
await out.waitForTimeout(300);
await out.screenshot({ path: "press/logo/crew-crests.png", clip: { x: 0, y: 0, width: 1600, height: 860 } });
await browser.close();
console.log("press/logo/crew-crests.png  3840x2064");
