/**
 * Per-place Open Graph cards.
 *
 * Every place page pointed at one shared og.jpg, so sharing any of the
 * seventeen on WhatsApp showed the same picture. This composites each place's
 * own hero art, name and area into its own 1200×630 card.
 *
 * Two engines, each doing what it is good at:
 *
 *   Chromium lays out the card. It has the real IBM Plex Sans Arabic and it
 *   shapes Arabic correctly — rasterising the SVG directly would need the font
 *   installed system-wide and would still risk unjoined letterforms.
 *
 *   sharp does the raster finish: a vignette, film grain and a levels nudge,
 *   then the JPEG encode. That is the part a designer would do in Photoshop,
 *   and it is what stops seventeen flat exports looking like screenshots.
 *
 * Run: npm run build && npm run og
 *
 * It reads the built site, and serves out/ itself to do so. Set OG_BASE to
 * point it at a server you are already running instead.
 */
import sharp from "sharp";

// Playwright is NOT a dependency of this project: the generated cards are
// committed, so a normal build and deploy never needs it. It is only required
// to REGENERATE them, which is why this fails with a sentence rather than a
// module-not-found stack.
let chromium;
try {
  ({ chromium } = await import("playwright"));
} catch {
  console.error(
    "gen-og needs Playwright, which this project does not depend on.\n" +
    "  npm i -D playwright && npx playwright install chromium\n" +
    "The cards in public/og/ are committed, so you only need this after\n" +
    "changing a place's name, area, rating or art."
  );
  process.exit(1);
}
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { createServer } from "node:http";
import { join, extname } from "node:path";

const SITE = join(process.cwd(), "out");
const OG_PORT = 4173;
const OUT = "public/og";
const W = 1200;
const H = 630;

/** The safe region of the 400×160 hero art — see design/places/SafeBox. */
const ART_VIEWBOX = "60 14 280 130";

/**
 * dir="ltr" on the card is deliberate. The page this is injected into is
 * dir="rtl", so logical insets flipped the whole layout — the first run put
 * the coral edge on the wrong side and ran the art straight through the name.
 * The card is a fixed canvas, so its lanes are physical; only the Arabic text
 * block is RTL.
 */
function card({ nameAr, name, areaAr, rating, art }) {
  // Long names need to come down a step or they wrap into three lines.
  const nameSize = nameAr.length > 18 ? 48 : nameAr.length > 13 ? 56 : 66;
  return `
<div dir="ltr" style="width:${W}px;height:${H}px;position:relative;overflow:hidden;display:flex;
            background:linear-gradient(155deg,#35302a 0%,#14120f 62%);
            font-family:'IBM Plex Sans Arabic',system-ui,sans-serif;">

  <!-- Art full-bleed, so the scene stays whole and there is no lane seam.
       At 1200×630 against a 280×130 viewBox, cover scales by height and trims
       only a little from the sides. -->
  <svg viewBox="${ART_VIEWBOX}" preserveAspectRatio="xMidYMid slice"
       style="position:absolute;inset:0;width:100%;height:100%;opacity:0.95;">${art}</svg>

  <!-- Scrim: fully opaque under the text, so nothing can show through it. -->
  <div style="position:absolute;inset:0;background:linear-gradient(90deg,
              rgba(20,18,15,0.12) 0%, rgba(20,18,15,0.5) 34%,
              rgba(20,18,15,0.93) 55%, #14120f 68%);"></div>

  <!-- TEXT -->
  <div dir="rtl" style="position:absolute;right:0;top:0;bottom:0;width:52%;
              display:flex;flex-direction:column;justify-content:center;
              gap:14px;padding:0 64px 0 24px;">
    <div style="display:flex;align-items:center;gap:10px;">
      <span style="font-size:26px;font-weight:700;color:#ffffff;line-height:1;">وين<span style="color:#f97970;">؟</span></span>
      <span style="width:1px;height:20px;background:rgba(255,255,255,0.3);"></span>
      <span style="font-size:17px;font-weight:600;color:#fbb724;">${areaAr}</span>
    </div>

    <div style="font-size:${nameSize}px;font-weight:700;color:#ffffff;line-height:1.2;text-wrap:balance;">${nameAr}</div>
    <div dir="ltr" style="font-size:22px;color:#a8a29a;text-align:right;">${name}</div>

    <div style="display:flex;align-items:center;gap:10px;margin-top:8px;">
      <span style="display:inline-flex;align-items:center;gap:6px;background:rgba(255,255,255,0.12);
                   padding:8px 14px;border-radius:999px;font-size:18px;font-weight:600;color:#ffffff;">
        <svg viewBox="0 0 24 24" style="width:17px;height:17px;" fill="#fbb724"><path d="M12 2.6l2.9 5.9 6.5.9-4.7 4.6 1.1 6.5-5.8-3-5.8 3 1.1-6.5L2.6 9.4l6.5-.9z"/></svg>
        ${rating}
      </span>
      <span style="font-size:17px;color:#8f8a80;">وين الطلعة اليوم؟</span>
    </div>
  </div>

  <!-- coral edge, physically on the right so it reads as Wain in a thumbnail -->
  <div style="position:absolute;right:0;top:0;bottom:0;width:14px;background:#dc2f25;"></div>
</div>`;
}

/**
 * Monochrome gaussian grain from a fixed seed.
 *
 * xorshift32 for the uniforms and Box–Muller to shape them — the second
 * Box–Muller value is discarded, which costs nothing at this size and keeps
 * the loop readable. Grey (128) is the no-op for an overlay blend, so the
 * grain only ever nudges a pixel either side of what is underneath it.
 */
function grainPixels(w, h, sigma, seed = 0x7761696e /* "wain" */) {
  let s = seed >>> 0;
  const rnd = () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
  const px = Buffer.allocUnsafe(w * h * 3);
  for (let i = 0; i < w * h; i++) {
    const u = Math.max(rnd(), 1e-9);
    const g = 128 + sigma * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rnd());
    const c = g < 0 ? 0 : g > 255 ? 255 : Math.round(g);
    px[i * 3] = c;
    px[i * 3 + 1] = c;
    px[i * 3 + 2] = c;
  }
  return px;
}

/** Vignette + grain + a small levels lift. The Photoshop half. */
async function finish(png) {
  const vignette = Buffer.from(
    `<svg width="${W}" height="${H}"><defs><radialGradient id="v" cx="50%" cy="50%" r="72%">
       <stop offset="55%" stop-color="#fff" stop-opacity="1"/>
       <stop offset="100%" stop-color="#000" stop-opacity="1"/>
     </radialGradient></defs><rect width="${W}" height="${H}" fill="url(#v)"/></svg>`
  );
  // Gaussian grain, kept low — enough to stop flat gradients banding on the
  // heavy JPEG compression these get served under, not enough to see.
  //
  // Generated here rather than by libvips, which reseeds its noise on every
  // call: identical input produced different bytes each run, so re-running
  // this script rewrote all 36 JPEGs whether anything had changed or not. A
  // generator whose output churns for no reason cannot be checked against what
  // is committed, and 36 binary files of pure noise is a diff nobody can read.
  // Seeded, the same card is the same file, and a diff means a real change.
  const grain = await sharp(grainPixels(W, H, 9), {
    raw: { width: W, height: H, channels: 3 },
  }).png().toBuffer();

  return sharp(png)
    .composite([
      { input: vignette, blend: "multiply" },
      { input: grain, blend: "overlay" },
    ])
    // Slight contrast: pull the black a touch deeper, keep the white where it is.
    .linear(1.06, -8)
    .jpeg({ quality: 82, chromaSubsampling: "4:4:4", mozjpeg: true })
    .toBuffer();
}

// Same shape of read as gen-schema: the source of truth is places.ts, and the
// \s* after the colon matters because long values wrap onto their own line.
const src = readFileSync("src/lib/places.ts", "utf8");
const str = (b, k) => (b.match(new RegExp(`${k}:\\s*"((?:[^"\\\\]|\\\\.)*)"`)) || [])[1];
const num = (b, k) => (b.match(new RegExp(`${k}:\\s*([-\\d.]+)`)) || [])[1];
const places = src
  .slice(src.indexOf("export const places"))
  .split(/\n {2}\{\n/)
  .slice(1)
  .map((b) => ({
    slug: str(b, "slug"),
    nameAr: str(b, "nameAr"),
    name: str(b, "name"),
    areaAr: str(b, "areaAr"),
    rating: num(b, "rating"),
  }));

/**
 * Serve out/ ourselves, unless someone has already pointed OG_BASE somewhere.
 *
 * The line above used to say "Run: npm run og (after a build)", and following
 * it exactly gave ERR_CONNECTION_REFUSED: the script read the built site over
 * HTTP but started nothing to serve it, and the port it expected was written
 * down in no document. Every sibling script here — audit:runtime, audit:color,
 * test:shouq, test:journey — starts its own server, so this one now does too.
 */
async function serveOut() {
  if (process.env.OG_BASE) return { base: process.env.OG_BASE, stop: () => {} };
  if (!existsSync(join(SITE, "index.html"))) {
    console.error("gen-og: out/ is missing — run npm run build first.");
    process.exit(1);
  }
  const MIME = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript",
    ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg",
    ".svg": "image/svg+xml", ".woff2": "font/woff2", ".ico": "image/x-icon",
    ".webmanifest": "application/manifest+json", ".txt": "text/plain", ".xml": "application/xml" };
  const server = createServer((req, res) => {
    let p = decodeURIComponent(req.url.split("?")[0]);
    if (p.endsWith("/")) p += "index.html";
    let f = join(SITE, p);
    if (!existsSync(f) && existsSync(f + ".html")) f += ".html";
    if (!existsSync(f) || !f.startsWith(SITE)) { res.writeHead(404); return res.end("not found"); }
    res.writeHead(200, { "content-type": MIME[extname(f)] ?? "application/octet-stream" });
    res.end(readFileSync(f));
  });
  await new Promise((r) => server.listen(OG_PORT, "127.0.0.1", r));
  return { base: `http://127.0.0.1:${OG_PORT}`, stop: () => server.close() };
}

const { base: BASE, stop: stopServer } = await serveOut();

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM ?? "/opt/pw-browsers/chromium",
});
const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
const page = await ctx.newPage();

let made = 0;
for (const p of places) {
  // Load the real page first: it carries the font and the hero art we lift.
  await page.goto(`${BASE}/places/${p.slug}/`, { waitUntil: "networkidle" });
  await page.waitForTimeout(120);

  const art = await page.evaluate(() => {
    const svg = document.querySelector("div.rounded-3xl.shadow-lg svg");
    return svg ? svg.innerHTML : "";
  });
  if (!art) {
    console.warn(`og: no hero art found for ${p.slug} — skipped`);
    continue;
  }

  const arabicDigits = String(p.rating).replace(/[0-9]/g, (d) => "٠١٢٣٤٥٦٧٨٩"[Number(d)]);
  await page.evaluate((html) => { document.body.innerHTML = html; document.body.style.margin = "0"; },
    card({ ...p, rating: arabicDigits, art }));
  await page.waitForTimeout(80);

  const raw = await page.screenshot({ clip: { x: 0, y: 0, width: W, height: H } });
  writeFileSync(`${OUT}/${p.slug}.jpg`, await finish(raw));
  made++;
}

await browser.close();
stopServer();
console.log(`gen-og: ${made} cards written to ${OUT}/ ✓`);
if (made !== places.length) {
  console.warn(`gen-og: expected ${places.length} — check the warnings above`);
  process.exitCode = 1;
}
