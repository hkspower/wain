#!/usr/bin/env node
/**
 * The home hero's two layers, at every width:  npm run audit:home-hero   (needs npm run build)
 *
 * The hero is a drawing (KuwaitSkyline) with a sun dial and a search pill laid
 * over it. The drawing scales with the viewport; the dial does not, it is in
 * CSS pixels. Where one lies over the other is therefore a function of the
 * width, and for as long as nothing measured it the answer was wrong across
 * most of the range that real people use. Run against the old layout (a fixed
 * 288px dial, one overlay layout from 640px up) it fails at 9 of the 14 widths
 * below, 640 to 1440px: at 768px the dial lay over the dome, its crescent, the
 * minaret's cap, the big sphere and the flag; at 1024px over the dome, the
 * sphere and the flag; at 1280px it still touched the dome and the sphere. It
 * first cleared at 1536px. Nothing else in `scan` could see any of it — every
 * other audit asks about one element, and this is a question about two.
 *
 * It measures BOUNDING BOXES, so it is conservative about round shapes: the
 * corner of a dome's box is empty sky, and a part may read as touching the
 * dial or the pill when the painted shapes still have air between them. Clear
 * by this audit is clear by eye; the reverse is not promised.
 *
 * What is checked, at each width:
 *
 *   1. The page does not slide sideways, and the dial sits wholly on screen.
 *   2. The dial's circle (ticks included) is clear of every part of the
 *      drawing marked `data-clear` — the spheres, the dome and its crescent,
 *      the flag, the minaret's cap, the Liberation Tower's pod, the clock
 *      tower. Found by that attribute, not by coordinates, so a moved or new
 *      landmark is protected by marking it.
 *   3. The search pill is clear of them by at least PILL_GAP_PX. The dial is
 *      the sun, and a sun may sit in front of the sky; a chip lying across a
 *      dome reads as a mistake.
 *   4. The dial is still a dial: not shrunk below DIAL_MIN_PX to make room.
 *
 * It is a real browser against `out/`, so it measures what ships. It fails if
 * it finds NO marked parts — a selector that drifts must not pass vacuously.
 */
import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { join, extname, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "out");
const CHROMIUM = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";
const PORT = 4239;

/** Phone, small tablet, the 1024 boundary on both sides, laptops, desktop, wide. */
const WIDTHS = [320, 390, 640, 768, 1023, 1024, 1100, 1180, 1280, 1366, 1440, 1536, 1680, 1920];
/** The dial may touch nothing the drawing marks. 0 = not overlapping. */
const DIAL_GAP_PX = 0;
/** The pill is a smaller, sharper-edged thing; give it room to breathe. */
const PILL_GAP_PX = 8;
/** The smallest the dial may be made. It is the page's primary control. */
const DIAL_MIN_PX = 220;

if (!existsSync(join(OUT, "index.html"))) {
  console.error("out/ is missing — run npm run build first.");
  process.exit(1);
}

const MIME = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript",
  ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg",
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

console.log("\n── the sun dial and the search pill against the drawing ──");

for (const width of WIDTHS) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 }, locale: "ar-KW" });
  const page = await ctx.newPage();
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: "networkidle" });
  await page.waitForTimeout(250);

  const m = await page.evaluate(() => {
    const sec = document.querySelector("main section");
    const link = sec.querySelector('a[href^="/find"]');
    const ring = link.parentElement.querySelector("svg"); // the tick ring: the dial as it is SEEN
    const pill = sec.querySelector('a[href^="/search"]');
    const marked = [...sec.querySelectorAll("svg [data-clear]")];
    const box = (e) => {
      const r = e.getBoundingClientRect();
      return { l: r.left, t: r.top, r: r.right, b: r.bottom };
    };
    const rr = box(ring), pp = box(pill);
    const cx = (rr.l + rr.r) / 2, cy = (rr.t + rr.b) / 2, rad = (rr.r - rr.l) / 2;
    // distance from a point to the nearest point of a rectangle
    const toRect = (x, y, q) => Math.hypot(Math.max(q.l - x, 0, x - q.r), Math.max(q.t - y, 0, y - q.b));
    // gap between two rectangles (0 when they overlap or touch)
    const rects = (a, q) => Math.hypot(Math.max(a.l - q.r, q.l - a.r, 0), Math.max(a.t - q.b, q.t - a.b, 0));
    let dial = { gap: Infinity, name: "" }, pl = { gap: Infinity, name: "" };
    for (const e of marked) {
      const q = box(e);
      const dg = toRect(cx, cy, q) - rad;
      if (dg < dial.gap) dial = { gap: dg, name: e.getAttribute("data-clear") };
      const pg = rects(pp, q);
      if (pg < pl.gap) pl = { gap: pg, name: e.getAttribute("data-clear") };
    }
    const vw = document.documentElement.clientWidth;
    return {
      marked: marked.length,
      dialPx: Math.round(link.getBoundingClientRect().width),
      heroH: Math.round(sec.getBoundingClientRect().height),
      overflow: document.documentElement.scrollWidth - vw,
      dialOff: Math.round(Math.max(0, -(rr.l), rr.r - vw)),
      dial, pill: pl,
    };
  });

  const where = `${width}px`;
  if (m.marked === 0) { say(`${where}: found no part of the drawing marked data-clear — the audit would pass vacuously`); await ctx.close(); continue; }
  if (m.overflow > 1) say(`${where}: the page is ${m.overflow}px wider than the screen`);
  if (m.dialOff > 0) say(`${where}: the dial runs ${m.dialOff}px off the screen`);
  if (m.dialPx < DIAL_MIN_PX) say(`${where}: the dial is ${m.dialPx}px — under ${DIAL_MIN_PX}px it stops being the page's main control`);
  if (m.dial.gap < DIAL_GAP_PX) say(`${where}: the dial covers the ${m.dial.name} (by ${Math.round(-m.dial.gap)}px)`);
  if (m.pill.gap < PILL_GAP_PX) say(`${where}: the search pill is ${Math.round(m.pill.gap)}px from the ${m.pill.name} — under ${PILL_GAP_PX}px`);
  else if (m.dial.gap >= DIAL_GAP_PX && m.dialPx >= DIAL_MIN_PX) {
    console.log(`  ✓ ${where.padEnd(7)} dial ${m.dialPx}px · hero ${m.heroH}px · nearest to the dial: ${m.dial.name} ${Math.round(m.dial.gap)}px · to the pill: ${m.pill.name} ${Math.round(m.pill.gap)}px`);
  }
  await ctx.close();
}

await browser.close();
server.close();

if (problems) {
  console.log(`\n${problems} problem(s) — see the header of scripts/audit-home-hero.mjs and the hero comment in src/app/page.tsx\n`);
  process.exit(1);
}
console.log(`\n0 errors — the dial and the pill stay clear of the drawing at ${WIDTHS.length} widths.\n`);
