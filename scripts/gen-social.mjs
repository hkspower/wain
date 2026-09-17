/**
 * Social cards — one Kuwaiti sentence, drawn big.
 *
 * Same two engines as gen-og.mjs, for the same reasons: Chromium lays the type
 * out because it has the real IBM Plex Sans Arabic and shapes Arabic
 * correctly, and sharp does the raster finish. See that file's header.
 *
 * WHAT THESE ARE NOT
 *
 * They carry no logo and no wordmark. A feed is a place where the picture is
 * seen before anything is read, and wain's mark is a pin — the same shape
 * every other map app uses at that size. The sentence is the thing nobody else
 * has: «وين الطلعة اليوم؟» is Kuwaiti, it is the question the site answers, and
 * it survives being a thumbnail. So the words ARE the identity here, set in the
 * site's own type and its own palette, and the only mark on the card is the
 * domain, small, for somebody who wants to go.
 *
 * Every sentence is lifted from the site or from صوت وين's own lines rather
 * than written for a poster — see src/lib/voice-lines.ts and WAIN_AI_COPY.
 * «قول» not «قل», «شنو» not «ماذا», «الربع» not «الأصدقاء»: the dialect rules
 * in wain-ai.ts apply to a caption exactly as they apply to a spoken line, and
 * an ad that slips into MSA sounds like a different company.
 *
 * These are NOT shipped with the site. They go to social/, which is gitignored:
 * deploy.php prunes anything in the artifact that is not in the manifest, and
 * marketing images have no reason to be in a docroot at all.
 *
 * Run: npm run build && npm run social
 */
import sharp from "sharp";

// Playwright is not a dependency of this project — same as gen-og.mjs, and the
// same sentence rather than a module-not-found stack.
let chromium;
try {
  ({ chromium } = await import("playwright"));
} catch {
  console.error(
    "gen-social needs Playwright, which this project does not depend on.\n" +
    "  npm i -D playwright && npx playwright install chromium"
  );
  process.exit(1);
}
import { mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { join, extname } from "node:path";

const SITE = join(process.cwd(), "out");
const PORT = 4174;
const OUT = "social";

/** Square for the feed, 9:16 for a story. Both at the platforms' native width. */
const FORMATS = {
  square: { w: 1080, h: 1080 },
  story: { w: 1080, h: 1920 },
};

/**
 * The palette, read off theme.css rather than picked again here.
 *
 * audit:color's finding is that every colour on the site comes from a token;
 * these cards are not audited by it (they are not pages), so the discipline
 * has to be kept by hand. Any value below is a copy of a --color-* token.
 */
const C = {
  ink900: "#14120f",
  ink800: "#221f1b",
  sea600: "#2277b4",
  sea700: "#1e6092",
  sea800: "#1d5179",
  sea950: "#132c42",
  sun200: "#fde08a",
  sun300: "#fccb4d",
  sun400: "#fbb724",
  sun500: "#f5960b",
  sun900: "#78320f",
  coral500: "#ef4d43",
  coral600: "#dc2f25",
  coral700: "#b9241b",
  palm500: "#2f8a4e",
  palm700: "#1b5832",
  sand50: "#ffffff",
  sand100: "#f6f5f3",
  heroCoffee1: "#422c00",
  heroCoffee3: "#1d0f00",
};

/**
 * Accent art, drawn rather than borrowed.
 *
 * Deliberately not the skyline from the home page: that scene is 1200 units
 * wide and reads as a stripe at the bottom of a square. These are three shapes
 * the brand already uses — the sun, the gulf, the dial's rings — at a size
 * where each one still reads as itself.
 */
const ART = {
  // The disc has to be nearly opaque. At 16% over the sea gradient the amber
  // desaturated straight to olive — a low-opacity warm colour over a deep cold
  // one does not read as "faint sun", it reads as a grey-green blob, which is
  // what the first render produced. The halo stays faint; the sun itself is
  // the colour it claims to be.
  sun: (c = C.sun300) => `
    <circle cx="880" cy="200" r="184" fill="${c}" opacity="0.07"/>
    <circle cx="880" cy="200" r="126" fill="${c}" opacity="0.13"/>
    <circle cx="880" cy="200" r="82" fill="${c}" opacity="0.94"/>`,
  // `y` because a wave has a place to be. Drawn at a fixed height they landed
  // in the coffee half of the gahwa card — brown strokes on brown, invisible
  // and meaningless. They belong where that gradient turns to sea.
  waves: (c = C.sand50, y = 0) => `
    <g fill="none" stroke="${c}" stroke-width="7" stroke-linecap="round" opacity="0.26"
       transform="translate(0 ${y})">
      <path d="M -40 118 q 70 -34 140 0 t 140 0 t 140 0 t 140 0 t 140 0 t 140 0 t 140 0"/>
      <path d="M -40 176 q 70 -34 140 0 t 140 0 t 140 0 t 140 0 t 140 0 t 140 0 t 140 0"/>
      <path d="M -40 234 q 70 -34 140 0 t 140 0 t 140 0 t 140 0 t 140 0 t 140 0 t 140 0"/>
    </g>`,
  // No centre dot, and that is not a simplification. The rings are concentric
  // on the canvas, the type block is centred on the canvas, so the dot landed
  // inside «حواليك» — an amber spot sitting on the letterforms, which on a
  // script where dots ARE diacritics reads as a misprint rather than a marker.
  // The rings say "around you" without it.
  rings: (c = C.sun400, cy = 540) => `
    <g fill="none" stroke="${c}" stroke-linecap="round">
      <circle cx="540" cy="${cy}" r="180" stroke-width="3" opacity="0.30"/>
      <circle cx="540" cy="${cy}" r="300" stroke-width="3" opacity="0.20"/>
      <circle cx="540" cy="${cy}" r="420" stroke-width="3" opacity="0.13"/>
      <circle cx="540" cy="${cy}" r="540" stroke-width="3" opacity="0.08"/>
    </g>`,
  none: () => "",
};

/**
 * The set.
 *
 * `lead` is the sentence and carries the whole card. `kicker` is the quiet line
 * above it and `foot` the one below — both optional, and both are allowed to be
 * nothing: three of these are stronger with one line on the card than with
 * three.
 *
 * `accentWord` colours ONE word (or the question mark) inside the lead. It is a
 * substring match on purpose — Arabic words here are short and distinct, and a
 * span injected by index would break the moment a sentence is edited.
 */
const CARDS = [
  {
    id: "talaa",
    lead: "وين الطلعة اليوم؟",
    accentWord: "؟",
    accent: C.sun300,
    foot: "٥٢ مكان بالكويت — معالم، مطاعم، قهوة، بحر وأسواق",
    fg: C.sand50,
    bg: `linear-gradient(155deg, ${C.sea700} 0%, ${C.sea950} 78%)`,
    art: ART.sun(C.sun300),
    artStory: ART.sun(C.sun300),
  },
  {
    id: "shnu",
    lead: "شنو تدوّر؟",
    kicker: "قول وش تبي",
    foot: "قهوة هادية · مطعم للعائلة · بحر",
    fg: C.ink900,
    bg: `linear-gradient(160deg, ${C.sun300} 0%, ${C.sun500} 100%)`,
    art: ART.none(),
    artStory: ART.none(),
  },
  {
    id: "yalla",
    lead: "يالله نروح",
    foot: "رسّلها للربع بالوقت والموقع — ما بقى شي يتناقش فيه",
    fg: C.sand50,
    bg: `linear-gradient(150deg, ${C.coral500} 0%, ${C.coral700} 100%)`,
    art: ART.none(),
    artStory: ART.none(),
  },
  {
    id: "gahwa",
    lead: "قهوة هادية ولا بحر؟",
    accentWord: "بحر",
    accent: C.sun300,
    kicker: "اختر الجو",
    fg: C.sand50,
    bg: `linear-gradient(155deg, ${C.heroCoffee1} 0%, ${C.heroCoffee3} 55%, ${C.sea800} 100%)`,
    art: ART.waves(C.sand50, 660),
    artStory: ART.waves(C.sand50, 1450),
  },
  {
    id: "dawwir",
    lead: "دوّر حواليك",
    kicker: "إلى وين؟",
    foot: "أقرب الأماكن من موقعك",
    fg: C.sand50,
    bg: `linear-gradient(165deg, ${C.ink800} 0%, ${C.ink900} 70%)`,
    art: ART.rings(C.sun400),
    artStory: ART.rings(C.sun400, 960),
  },
  {
    id: "waqtaha",
    lead: "كل وحدة ولها وقتها",
    kicker: "طلعة عيال ولا ليلة هادية",
    fg: C.sand50,
    bg: `linear-gradient(150deg, ${C.palm500} 0%, ${C.palm700} 100%)`,
    art: ART.none(),
    artStory: ART.none(),
  },
];

/**
 * Type size from sentence length, not from a fixed value.
 *
 * «يالله نروح» is ten characters and «قهوة هادية ولا بحر؟» is nineteen; one
 * size cannot serve both without either wrapping the long one to three lines or
 * leaving the short one floating in the middle of a square.
 */
function leadSize(text, story) {
  const n = text.length;
  const base = story ? 1.08 : 1;
  const px = n > 17 ? 116 : n > 12 ? 136 : 168;
  return Math.round(px * base);
}

/**
 * The accent word, wrapped where it appears.
 *
 * Arabic joins, so a span inside a word would break the letterforms either side
 * of it — these only ever mark a whole word or a standalone mark like «؟»,
 * which is why the match is on the word with its spaces intact.
 */
function markAccent(text, word, colour) {
  if (!word || !text.includes(word)) return text;
  return text.replace(word, `<span style="color:${colour}">${word}</span>`);
}

function card(c, fmt) {
  const { w, h } = FORMATS[fmt];
  const story = fmt === "story";
  const pad = story ? 112 : 96;
  const size = leadSize(c.lead, story);
  const art = story ? c.artStory : c.art;

  // dir="ltr" on the canvas and dir="rtl" only on the text block — the same
  // split gen-og.mjs settled on. A fixed canvas has physical lanes; logical
  // insets flip the whole composition when the host page is RTL.
  return `
<div dir="ltr" style="width:${w}px;height:${h}px;position:relative;overflow:hidden;
     background:${c.bg};font-family:'IBM Plex Sans Arabic',system-ui,sans-serif;">

  <svg viewBox="0 0 1080 ${story ? 1920 : 1080}" style="position:absolute;inset:0;width:100%;height:100%;">
    ${art}
  </svg>

  <!-- A light wash from the top so the accent art never competes with the
       first line of type, and a deeper one at the foot where the small line
       sits. Both are the card's own ink, not black: neutral black goes muddy
       over this palette (see the shadow note in theme.css). -->
  <div style="position:absolute;inset:0;background:linear-gradient(180deg,
       rgba(20,18,15,0.10) 0%, rgba(20,18,15,0) 34%,
       rgba(20,18,15,0) 62%, rgba(20,18,15,0.22) 100%);"></div>

  <div dir="rtl" style="position:absolute;inset:0;display:flex;flex-direction:column;
       justify-content:${story ? "center" : "center"};gap:${story ? 40 : 30}px;
       padding:${pad}px;box-sizing:border-box;">

    ${c.kicker ? `
    <div style="display:flex;align-items:center;gap:18px;">
      <span style="width:${story ? 64 : 52}px;height:5px;border-radius:999px;
            background:${c.accent ?? c.fg};opacity:0.85;"></span>
      <span style="font-size:${story ? 40 : 34}px;font-weight:600;color:${c.fg};
            opacity:0.82;letter-spacing:0.2px;">${c.kicker}</span>
    </div>` : ""}

    <!-- 1.22, not the 1.05 the site gives a 46px heading. Arabic descenders
         and the dots under ب ت ث ي need room, and at this size two lines that
         clear each other on the metrics can still touch once one of them
         carries ق or ج. Checked by rendering, which is the only way. -->
    <div style="font-size:${size}px;font-weight:700;color:${c.fg};line-height:1.22;
         text-wrap:balance;letter-spacing:-0.5px;">${markAccent(c.lead, c.accentWord, c.accent ?? c.fg)}</div>

    ${c.foot ? `
    <div style="font-size:${story ? 34 : 29}px;font-weight:500;color:${c.fg};
         opacity:0.74;line-height:1.5;max-width:${story ? 820 : 760}px;">${c.foot}</div>` : ""}
  </div>

  <!-- The only mark on the card. Not a logo: a destination, set in the same
       face as everything else and kept quiet enough that the sentence is still
       what is seen first. -->
  <div dir="ltr" style="position:absolute;left:${pad}px;bottom:${story ? 84 : 72}px;
       font-size:${story ? 30 : 26}px;font-weight:600;color:${c.fg};opacity:0.62;
       letter-spacing:1.6px;">wainkw.com</div>
</div>`;
}

/**
 * Seeded gaussian grain — lifted from gen-og.mjs, and seeded for the same
 * reason: libvips reseeds every call, so an unseeded generator rewrites every
 * file on every run and a diff stops meaning anything.
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
    px[i * 3] = c; px[i * 3 + 1] = c; px[i * 3 + 2] = c;
  }
  return px;
}

/**
 * Softer finish than the OG cards get.
 *
 * Those are 1200×630 served under heavy compression, so they carry sigma 9 and
 * a real vignette. These are flat colour fields at q92: the same grain would be
 * visible as dirt, and the same vignette would put a grey ring around a solid
 * coral ground. Grain 4 is there only to stop the gradients banding.
 */
async function finish(png, w, h) {
  // 0.18 at the very edge, and nothing at all before 76%. The first version
  // used 0.55 from 68% and did precisely what the paragraph above says to
  // avoid: the amber card's corners went olive-brown and the sea card grew a
  // dark ring, so a flat brand colour stopped being that colour. On a
  // photograph a vignette is shaping; on a solid ground it is just dirt.
  const vignette = Buffer.from(
    `<svg width="${w}" height="${h}"><defs><radialGradient id="v" cx="50%" cy="50%" r="86%">
       <stop offset="76%" stop-color="#fff" stop-opacity="1"/>
       <stop offset="100%" stop-color="#000" stop-opacity="0.18"/>
     </radialGradient></defs><rect width="${w}" height="${h}" fill="url(#v)"/></svg>`
  );
  const grain = await sharp(grainPixels(w, h, 4), {
    raw: { width: w, height: h, channels: 3 },
  }).png().toBuffer();

  return sharp(png)
    .composite([
      { input: vignette, blend: "multiply" },
      { input: grain, blend: "overlay" },
    ])
    // 4:4:4 rather than the OG cards' default: these are saturated flats with
    // white type on them, and chroma subsampling frays a coral/white edge.
    .jpeg({ quality: 92, chromaSubsampling: "4:4:4", mozjpeg: true })
    .toBuffer();
}

/** Serve out/, the same way every sibling script here does. */
async function serveOut() {
  if (process.env.SOCIAL_BASE) return { base: process.env.SOCIAL_BASE, stop: () => {} };
  if (!existsSync(join(SITE, "index.html"))) {
    console.error("gen-social: out/ is missing — run npm run build first.");
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
  await new Promise((r) => server.listen(PORT, "127.0.0.1", r));
  return { base: `http://127.0.0.1:${PORT}`, stop: () => server.close() };
}

const { base: BASE, stop: stopServer } = await serveOut();
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM ?? "/opt/pw-browsers/chromium",
});
const ctx = await browser.newContext({ viewport: { width: 1080, height: 1080 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();

// The real page first — it is what carries IBM Plex Sans Arabic. Rasterising
// without it silently substitutes a system face and unjoins the letterforms.
await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
await page.evaluate(() => document.fonts.ready);

let made = 0;
for (const c of CARDS) {
  for (const fmt of Object.keys(FORMATS)) {
    const { w, h } = FORMATS[fmt];
    await page.setViewportSize({ width: w, height: h });
    await page.evaluate((html) => {
      document.body.innerHTML = html;
      document.body.style.margin = "0";
    }, card(c, fmt));
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(90);

    const raw = await page.screenshot({ clip: { x: 0, y: 0, width: w, height: h } });
    const name = `${OUT}/wain-${c.id}-${fmt}.jpg`;
    writeFileSync(name, await finish(raw, w, h));
    made++;
  }
}

await browser.close();
stopServer();
console.log(`gen-social: ${made} cards written to ${OUT}/ ✓`);
