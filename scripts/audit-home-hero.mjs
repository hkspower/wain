#!/usr/bin/env node
/**
 * The home hero, at every width:  npm run audit:home-hero   (needs npm run build)
 *
 * The hero is one picture (brand-source/home-hero.png, shipped by
 * gen-home-hero.mjs) with two controls placed on it in its own coordinates:
 * the sun is the link to /find and carries «إلى وين؟ / ابحث». Nothing else
 * goes on it: «دوّر باسم المكان» sat on the sea for a day and was moved to a
 * row under the picture on request. Placing things on a picture is a promise about
 * pixels the layout code never sees — that the label is on the yellow of the
 * disc and not across a tower — so
 * this keeps it by looking: it maps each control's rendered box back into the
 * master and reads the pixels under it.
 *
 * Until 2 October this audited a drawn skyline with a sun dial floating over
 * it, where the question was whether the dial covered the dome or the spheres
 * at a given width; it failed at 9 of these 14 widths on the layout before
 * that one. The picture is laid out in its own coordinates, so that question
 * is gone, and the one that replaced it is above.
 *
 * What is checked, at each width:
 *
 *   1. The generated half is current (gen-home-hero.mjs --check).
 *   2. The page does not slide sideways.
 *   3. The picture is whole: its box has the master's ratio, sits inside the
 *      section and the screen, and actually loaded.
 *   4. The sun link is a circle on the picture's sun: centre and diameter
 *      within SUN_TOL_PX of the disc's, measured in the master.
 *   5. The label («إلى وين؟» and «ابحث») lies on the disc: at least
 *      ON_SUN_MIN of the master's pixels under each box are the disc's yellow.
 *   6. The way to /search is under the picture, not on it, and on screen.
 *   7. Nothing is too small to read or tap: «ابحث» at the 11px floor, the sun
 *      no smaller than SUN_MIN_PX.
 *   8. Text drawn straight on the picture reads against the pixels under it
 *      (WCAG AA). audit:color cannot do this one: it reads backgrounds from
 *      CSS, and the picture is an <img>, so to it the label is on the page.
 *
 * It fails if it finds no picture, so a selector that drifts cannot pass
 * vacuously.
 */
import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { join, extname, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import sharp from "sharp";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "out");
const CHROMIUM = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";
const PORT = 4239;

/** Phone, small tablet, tablet, laptops, desktop, wide, and a phone on its side. */
const VIEWPORTS = [
  [320, 640], [360, 780], [390, 844], [430, 932], [640, 900], [768, 1024], [1024, 768],
  [1100, 900], [1280, 800], [1366, 768], [1440, 900], [1680, 1050], [1920, 1080], [844, 390],
];
const SUN_TOL_PX = 2;
const ON_SUN_MIN = 0.97;
const SUN_MIN_PX = 120;
const FLOOR_PX = 11;

try {
  execFileSync("node", [join(ROOT, "scripts/gen-home-hero.mjs"), "--check"], { cwd: ROOT, stdio: "pipe" });
} catch (e) {
  console.error(`${e.stderr}`.trim() + "\n— run `npm run home-hero` and commit the result");
  process.exit(1);
}
if (!existsSync(join(OUT, "index.html"))) {
  console.error("out/ is missing — run npm run build first.");
  process.exit(1);
}

// The master, as pixels, and what counts as disc and as water in it. The disc
// is one flat yellow (#ffc93c); the sea is five flat blues, every one with
// blue well above red, where a sail is cream, a hull black and a flag red.
const { data: px, info } = await sharp(join(ROOT, "brand-source/home-hero.png"))
  .removeAlpha().raw().toBuffer({ resolveWithObject: true });
const at = (x, y) => {
  const i = (Math.min(info.height - 1, Math.max(0, y)) * info.width + Math.min(info.width - 1, Math.max(0, x))) * 3;
  return [px[i], px[i + 1], px[i + 2]];
};
const isSun = ([r, g, b]) => Math.abs(r - 0xff) < 8 && Math.abs(g - 0xc9) < 10 && Math.abs(b - 0x3c) < 14;
const lum = (c) => {
  const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
};
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
/** Share of the master's pixels in [x0,x1)×[y0,y1) (master px) that pass `test`. */
function share(box, test) {
  let hit = 0, n = 0;
  for (let y = Math.round(box.y0); y < box.y1; y += 2)
    for (let x = Math.round(box.x0); x < box.x1; x += 2) { n++; if (test(at(x, y))) hit++; }
  return n ? hit / n : 0;
}

// The disc, re-measured off the master rather than trusted from the generator,
// so a wrong number there (or a replaced picture) is caught here.
const G = JSON.parse(readFileSync(join(ROOT, "src/lib/home-hero.g.ts"), "utf8").match(/HOME_HERO_PX = (\{.*\}) as const/)[1]);
{
  // The first rim-coloured pixel from the left along the disc's row, and from
  // the top along its column. Rim and fill are both strongly yellow; the
  // halo, the sky and the Liberation Tower's cream all carry far more blue.
  const rim = ([r, g, b]) => r > 0xd0 && g > 0x90 && b < 0x40;
  let left = -1, top = -1;
  for (let x = 0; x < G.sun.cx && left < 0; x++) if (rim(at(x, G.sun.cy))) left = x;
  for (let y = 0; y < G.sun.cy && top < 0; y++) if (rim(at(G.sun.cx, y))) top = y;
  if (Math.abs(G.sun.cx - left - G.sun.r) > 2 || Math.abs(G.sun.cy - top - G.sun.r) > 2) {
    console.error(`the sun in home-hero.png is not where gen-home-hero.mjs says: rim at x ${left} (row ${G.sun.cy}) and y ${top} (column ${G.sun.cx}), expected ${G.sun.cx - G.sun.r} and ${G.sun.cy - G.sun.r}. Re-measure SUN.`);
    process.exit(1);
  }
}

const MIME = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript",
  ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg", ".avif": "image/avif", ".webp": "image/webp",
  ".svg": "image/svg+xml", ".woff2": "font/woff2", ".ico": "image/x-icon", ".txt": "text/plain" };
const server = createServer((req, res) => {
  let p = decodeURIComponent(req.url.split("?")[0]);
  if (p.endsWith("/")) p += "index.html";
  let f = join(OUT, p);
  if (!existsSync(f) && existsSync(f + ".html")) f += ".html";
  if (!existsSync(f) || !f.startsWith(OUT)) { res.writeHead(404); return res.end("nope"); }
  res.writeHead(200, { "content-type": MIME[extname(f)] || "application/octet-stream" });
  res.end(readFileSync(f));
});
await new Promise((r) => server.listen(PORT, r));

const { chromium } = await import("playwright");
const browser = await chromium.launch({ executablePath: CHROMIUM });

let problems = 0;
const say = (msg) => { console.log("  ✗ " + msg); problems++; };

console.log("\n── the home hero: the picture, its sun, and the search link under it ──");

for (const [width, height] of VIEWPORTS) {
  const ctx = await browser.newContext({ viewport: { width, height }, locale: "ar-KW" });
  const page = await ctx.newPage();
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: "networkidle" });
  await page.waitForTimeout(150);

  const m = await page.evaluate(() => {
    const img = document.querySelector("main section img");
    if (!img) return null;
    const sec = img.closest("section");
    const box = (e) => { const r = e.getBoundingClientRect(); return { l: r.left, t: r.top, w: r.width, h: r.height }; };
    const sun = sec.querySelector('a[href^="/find"]');
    const spans = sun ? [...sun.querySelectorAll("span")].filter((s) => s.children.length === 0 && s.textContent.trim()) : [];
    // The visible one: AppTabBar's tab is in the DOM and painted by nothing.
    const pill = [...document.querySelectorAll('main a[href^="/search"]')]
      .find((a) => a.getClientRects().length && getComputedStyle(a).visibility !== "hidden");
    return {
      img: box(img), sec: box(sec), loaded: img.complete && img.naturalWidth > 0,
      sun: sun && box(sun),
      labels: spans.map((s) => {
        const cs = getComputedStyle(s);
        return { text: s.textContent.trim(), box: box(s), font: parseFloat(cs.fontSize), weight: parseInt(cs.fontWeight, 10),
          color: cs.color, ownBg: cs.backgroundColor !== "rgba(0, 0, 0, 0)",
          stroke: parseFloat(cs.webkitTextStrokeWidth) || 0, strokeColor: cs.webkitTextStrokeColor,
          strokeUnder: (cs.paintOrder || "").startsWith("stroke") };
      }),
      pill: pill && box(pill),
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      vw: document.documentElement.clientWidth,
    };
  });

  const where = `${width}×${height}`;
  if (!m) { say(`${where}: no picture in the hero — the audit would pass vacuously`); await ctx.close(); continue; }
  const before = problems;
  const { img } = m;
  const k = info.width / img.w; // master px per css px
  const toMaster = (b) => ({ x0: (b.l - img.l) * k, y0: (b.t - img.t) * k, x1: (b.l + b.w - img.l) * k, y1: (b.t + b.h - img.t) * k });

  if (m.overflow > 1) say(`${where}: the page is ${m.overflow}px wider than the screen`);
  if (!m.loaded) say(`${where}: the picture did not load`);
  if (Math.abs(img.h / img.w - info.height / info.width) > 0.01) say(`${where}: the picture is ${Math.round(img.w)}×${Math.round(img.h)}, not the master's ratio — it is being stretched or cropped`);
  if (img.l < -0.5 || img.l + img.w > m.vw + 0.5) say(`${where}: the picture runs off the screen`);
  if (img.t < m.sec.t - 0.5 || img.t + img.h > m.sec.t + m.sec.h + 0.5) say(`${where}: the section cuts the picture`);

  // Phones: the hero is the whole first screen (2 October, on request, option
  // B on the canvas): the picture stays whole at full width and the sky above
  // it and the sea below it fill the rest, so it is centred in a section at
  // least the screen's height.
  if (width < 640) {
    if (m.sec.h < height - 1) say(`${where}: the hero is ${Math.round(m.sec.h)}px tall on a ${height}px phone — it should fill the screen`);
    const above = img.t - m.sec.t, below = m.sec.t + m.sec.h - (img.t + img.h);
    if (Math.abs(above - below) > 1) say(`${where}: the picture is not centred in the hero (${Math.round(above)}px of sky above, ${Math.round(below)}px of sea below)`);
  }

  if (!m.sun) say(`${where}: no sun link to /find`);
  else {
    const cx = (m.sun.l + m.sun.w / 2 - img.l) * k, cy = (m.sun.t + m.sun.h / 2 - img.t) * k, d = m.sun.w * k;
    const tol = SUN_TOL_PX * k;
    if (Math.abs(cx - G.sun.cx) > tol || Math.abs(cy - G.sun.cy) > tol || Math.abs(d - 2 * G.sun.r) > 2 * tol || Math.abs(m.sun.w - m.sun.h) > 1)
      say(`${where}: the sun link is not on the sun — centre (${cx.toFixed(0)}, ${cy.toFixed(0)}) ⌀${d.toFixed(0)} in the master, the disc is (${G.sun.cx}, ${G.sun.cy}) ⌀${2 * G.sun.r}`);
    if (m.sun.w < SUN_MIN_PX) say(`${where}: the sun is ${Math.round(m.sun.w)}px — under ${SUN_MIN_PX}px it stops being the page's main control`);
  }
  if (m.labels.length < 2) say(`${where}: the sun carries ${m.labels.length} label(s), expected «إلى وين؟» and «ابحث»`);
  for (const l of m.labels) {
    const on = share(toMaster(l.box), isSun);
    if (on < ON_SUN_MIN) say(`${where}: «${l.text}» is ${(on * 100).toFixed(0)}% on the sun's yellow — it reaches past the disc or over a tower`);
    if (l.font < FLOOR_PX - 0.05) say(`${where}: «${l.text}» is ${l.font.toFixed(1)}px — under the ${FLOOR_PX}px floor`);
    const fg = l.color.match(/\d+/g).slice(0, 3).map(Number);
    // Outlined text (the title since 2 October: white with an ink outline
    // painted under the fill) is read against its outline, which is what
    // touches every letter's edge — but only a real outline counts, at least
    // a tenth of the size and under the fill. Without it this falls through
    // to the picture, where white on the sun's yellow is 1.4:1.
    const outlined = l.stroke >= Math.max(1.5, l.font * 0.1) && l.strokeUnder;
    if (outlined) {
      const need = l.font >= 24 || (l.font >= 18.66 && l.weight >= 700) ? 3 : 4.5;
      const c = contrast(fg, l.strokeColor.match(/\d+/g).slice(0, 3).map(Number));
      if (c < need) say(`${where}: «${l.text}» is ${c.toFixed(2)}:1 against its own outline — needs ${need}`);
    } else if (!l.ownBg) {
      // Against the darkest and the lightest pixel under it: the worst case.
      const b = toMaster(l.box);
      let worst = Infinity;
      for (let y = Math.round(b.y0); y < b.y1; y += 2)
        for (let x = Math.round(b.x0); x < b.x1; x += 2) worst = Math.min(worst, contrast(fg, at(x, y)));
      const need = l.font >= 24 || (l.font >= 18.66 && l.weight >= 700) ? 3 : 4.5;
      if (worst < need) say(`${where}: «${l.text}» is ${worst.toFixed(2)}:1 against the picture under it — needs ${need}`);
    }
  }
  if (!m.pill) say(`${where}: no visible link to /search on the home page — it is the web's only one`);
  else if (m.pill.t < img.t + img.h - 0.5) say(`${where}: «دوّر باسم المكان» is on the picture (top ${Math.round(m.pill.t)}px, picture ends ${Math.round(img.t + img.h)}px) — it belongs in the row under it`);

  if (problems === before) {
    const lab = m.labels.map((l) => `${l.font.toFixed(0)}px`).join("/");
    console.log(`  ✓ ${where.padEnd(10)} picture ${Math.round(img.w)}×${Math.round(img.h)} · sun ⌀${Math.round(m.sun.w)} · labels ${lab}`);
  }
  await ctx.close();
}

await browser.close();
server.close();

if (problems) {
  console.log(`\n${problems} problem(s) — see the header of scripts/audit-home-hero.mjs and src/components/HomeHero.tsx\n`);
  process.exit(1);
}
console.log(`\n0 errors — the picture is whole and the sun is where it says and the search link is under it, at ${VIEWPORTS.length} sizes.\n`);
