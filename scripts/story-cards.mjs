#!/usr/bin/env node
// Sixteen Instagram Story cards, one per car in the showroom.
//
//   npm run stories:images     # lift the renders out of the dark first
//   npm run stories            # then this
//
// Writes ONE self-contained HTML file with sixteen 1080x1920 roots, per
// the Adobe visual-design skill: fixed canvas, absolute positioning,
// self-describing metadata, Adobe Fonts embedded in the head, and every
// image inlined as a data URI so the file can be handed to the Express
// importer as-is.
//
// THE NAMES COME FROM THE GAME, NOT FROM THE RENDER SHEET
//
// press/cars/cars.json is written beside the renders and it looked like
// the obvious source — it has every field a card needs. It is also a
// snapshot, and the first sixteen cards built from it went out saying
// "Sahara GT-12", "Desert Storm S8" and "Falcon 720 Veloce": names the
// showroom had already dropped in the change that made every car's
// English, Arabic and id agree. A card is a thing you post; it cannot
// quote a name the game stopped using.
//
// So the text comes from src/game/mods.ts, live, and cars.json is used
// for nothing. The renders are matched to it by id, which is the one
// field that does not change.
import sharp from "sharp";
import { writeFileSync, existsSync, mkdirSync } from "node:fs";
import { CARS as SHOWROOM } from "../src/game/mods.ts";

const CLASS_LABEL = { supercar: "SUPERCAR", sport: "SPORT", normal: "STREET" };
const CARS = SHOWROOM.map((c) => ({
  id: c.id,
  name: c.name,
  arabicName: c.ar,
  cls: c.cls,
  price: c.price,
  topSpeedKmh: c.topSpeedKmh,
  lengthM: c.lengthM,
  lockedRivals: c.locked?.rivals ?? 0,
}));
const IMG = "press/stories/img";
const OUT = "press/stories";
mkdirSync(OUT, { recursive: true });

const W = 1080, H = 1920;
// The card ground. The hero image is composited onto exactly this colour
// so its edges can be faded to nothing without needing an alpha channel
// — which keeps sixteen inlined images to about a megabyte instead of
// eight.
const GROUND = { r: 11, g: 11, b: 13 };
const HERO_W = 1080, HERO_H = 620;

/** Arabic-Indic digits, because the Arabic half of every card is set in
 *  them and a card that mixes ٤٠٥ with 405 looks like two documents. */
const AR_DIGITS = "٠١٢٣٤٥٦٧٨٩";
const toAr = (s) => String(s).replace(/[0-9]/g, (d) => AR_DIGITS[+d]);
const kd = (n) => n.toLocaleString("en-US");

/**
 * The hero: the render, cropped to the band, faded into the ground at
 * every edge, and baked to a JPEG.
 *
 * The fade is a linear alpha ramp on all four sides rather than a
 * vignette: a vignette darkens the middle of the car too, and the whole
 * reason these images were lifted in the first place is that the car was
 * too dark.
 */
async function hero(id) {
  const src = `${IMG}/${id}.png`;
  if (!existsSync(src)) throw new Error(`no lifted render for ${id} — run npm run stories:images`);

  // Crop to the CAR, not to the frame. The renders are lit in a studio
  // with a lot of empty floor and ceiling around the machine; dropped
  // straight into the band, the car came out small with a third of the
  // card given to dark nothing. So find where the car actually is —
  // every pixel that differs from the backdrop by more than a threshold
  // — and crop to that plus a margin.
  const box = await carBounds(src);
  const car = await sharp(src)
    .extract(box)
    .resize({ width: HERO_W, height: HERO_H, fit: "cover", position: "centre" })
    .toBuffer();

  // A mask that is opaque in the middle and runs to nothing over the
  // outer 12% of each edge.
  const fx = 0.12, fy = 0.16;
  const mask = Buffer.alloc(HERO_W * HERO_H);
  for (let y = 0; y < HERO_H; y++) {
    const ty = Math.min(y / (HERO_H * fy), (HERO_H - 1 - y) / (HERO_H * fy), 1);
    for (let x = 0; x < HERO_W; x++) {
      const tx = Math.min(x / (HERO_W * fx), (HERO_W - 1 - x) / (HERO_W * fx), 1);
      mask[y * HERO_W + x] = Math.round(255 * Math.max(0, Math.min(1, tx)) * Math.max(0, Math.min(1, ty)));
    }
  }
  const cut = await sharp(car)
    .ensureAlpha()
    .composite([{ input: mask, raw: { width: HERO_W, height: HERO_H, channels: 1 }, blend: "dest-in" }])
    .png()
    .toBuffer();

  const flat = await sharp({
    create: { width: HERO_W, height: HERO_H, channels: 3, background: GROUND },
  })
    .composite([{ input: cut }])
    .jpeg({ quality: 84, chromaSubsampling: "4:4:4" })
    .toBuffer();
  return `data:image/jpeg;base64,${flat.toString("base64")}`;
}

/**
 * Where the car is in its render.
 *
 * The backdrop is a smooth dark gradient, so "differs from the backdrop"
 * cannot be measured against one colour — the top of the frame and the
 * floor are different colours. It is measured per ROW and per COLUMN
 * instead: a row that contains the car has a much wider spread between
 * its darkest and brightest pixel than a row of empty gradient does.
 */
async function carBounds(src) {
  const { data, info } = await sharp(src).raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  const at = (x, y) => {
    const o = (y * width + x) * channels;
    return 0.2126 * data[o] + 0.7152 * data[o + 1] + 0.0722 * data[o + 2];
  };
  const spread = (px) => {
    let lo = 255, hi = 0;
    for (const v of px) { if (v < lo) lo = v; if (v > hi) hi = v; }
    return hi - lo;
  };
  const rows = [], cols = [];
  for (let y = 0; y < height; y++) {
    const px = [];
    for (let x = 0; x < width; x += 3) px.push(at(x, y));
    rows.push(spread(px));
  }
  for (let x = 0; x < width; x++) {
    const px = [];
    for (let y = 0; y < height; y += 3) px.push(at(x, y));
    cols.push(spread(px));
  }
  // 18 of 255: comfortably above the gradient's own roll-off across one
  // row (measured at 4-9) and well below the contrast any part of a car
  // puts into one.
  const T = 18;
  const first = (a) => { for (let i = 0; i < a.length; i++) if (a[i] > T) return i; return 0; };
  const last = (a) => { for (let i = a.length - 1; i >= 0; i--) if (a[i] > T) return i; return a.length - 1; };
  let x0 = first(cols), x1 = last(cols), y0 = first(rows), y1 = last(rows);
  // Margin, so the car is not jammed against the edge of the band.
  const mx = Math.round((x1 - x0) * 0.07), my = Math.round((y1 - y0) * 0.16);
  x0 = Math.max(0, x0 - mx); x1 = Math.min(width - 1, x1 + mx);
  y0 = Math.max(0, y0 - my); y1 = Math.min(height - 1, y1 + my);
  return { left: x0, top: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 };
}

const CLASS_AR = { supercar: "سوبر", sport: "رياضية", normal: "عادية" };
const CLASS_EN = CLASS_LABEL;

/**
 * A value that fits its column.
 *
 * "240,000 KD" at 68px wrapped onto a second line and landed on top of
 * the Arabic price under it. The column is 312px, and this solves for
 * the size rather than picking one that happens to suit whichever car
 * is being looked at.
 *
 * 0.62 is measured, not assumed. The first version of this guessed 0.42
 * for a condensed face, which made the widest price on the shelf come
 * out at 68px — the cap — and change nothing at all: the string went on
 * wrapping exactly as before. Rendered, those ten characters occupied
 * about 400px at 68px, which is 0.59 per character; 0.62 leaves a
 * little room for the comma-heavy ones.
 */
const fit = (text, box = 292, max = 68) =>
  Math.min(max, Math.floor(box / (text.length * 0.62)));

const esc = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const cards = [];
let bytes = 0;
for (let i = 0; i < CARS.length; i++) {
  const c = CARS[i];
  const img = await hero(c.id);
  bytes += img.length;
  const n = String(i + 1).padStart(2, "0");
  const total = String(CARS.length).padStart(2, "0");
  const priceEn = c.price === 0 ? "FREE" : `${kd(c.price)} KD`;
  const priceAr = c.price === 0 ? "مجانا" : `${toAr(kd(c.price))} د.ك`;
  cards.push(`
  <section class="story" data-canvas-width="${W}" data-canvas-height="${H}">
    <div class="brand">GULF ROAD NIGHTS</div>
    <div class="brand-ar">ليالي شارع الخليج</div>
    <div class="index">${n}<span class="of">/${total}</span></div>

    <img class="hero" src="${img}" width="${HERO_W}" height="${HERO_H}" alt="${esc(c.name)}">

    <div class="rule"></div>
    <div class="klass">${CLASS_EN[c.cls] ?? c.cls}<span class="klass-ar">${CLASS_AR[c.cls] ?? ""}</span></div>
    <h1 class="name">${esc(c.name)}</h1>
    <div class="name-ar">${esc(c.arabicName)}</div>

    <div class="specs">
      <div class="spec">
        <div class="k">PRICE<span class="k-ar">السعر</span></div>
        <div class="v" style="font-size:${fit(priceEn)}px">${priceEn}</div>
        <div class="v-ar">${priceAr}</div>
      </div>
      <div class="spec">
        <div class="k">TOP SPEED<span class="k-ar">السرعة</span></div>
        <div class="v">${c.topSpeedKmh}<span class="u">km/h</span></div>
        <div class="v-ar">${toAr(c.topSpeedKmh)} كم/س</div>
      </div>
      <div class="spec">
        <div class="k">LENGTH<span class="k-ar">الطول</span></div>
        <div class="v">${c.lengthM.toFixed(2)}<span class="u">m</span></div>
        <div class="v-ar">${toAr(c.lengthM.toFixed(2))} م</div>
      </div>
    </div>

    ${c.lockedRivals ? `<div class="locked">LOCKED UNTIL ALL ${c.lockedRivals} LEGENDS ARE BEATEN<span class="locked-ar">مقفلة حتى تهزم كل الأساطير</span></div>` : ""}

    <div class="foot">PLAYS IN YOUR BROWSER<span class="foot-ar">تشتغل في المتصفح</span></div>
    <div class="flag"><span class="s1"></span><span class="s2"></span><span class="s3"></span><span class="tri"></span></div>
  </section>`);
}

const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Gulf Road Nights — the showroom, 16 Story cards</title>
<meta name="hz:slide-selector" content=".story">
<meta name="hz:canvas-width" content="${W}">
<meta name="hz:canvas-height" content="${H}">
<link rel="stylesheet" href="https://use.typekit.net/smu4rjf.css">
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body { background: #17171a; display: flex; flex-direction: column; align-items: center; gap: 40px; padding: 40px 0; }

.story {
  position: relative;
  width: ${W}px;
  height: ${H}px;
  overflow: hidden;
  background: #0b0b0d;
}

/* The masthead. Condor is a condensed athletic italic, so it carries the
   speed without a single effect on it. */
.brand {
  position: absolute; left: 72px; top: 96px;
  font-family: "condor", sans-serif; font-weight: 900; font-style: italic;
  font-size: 40px; letter-spacing: 0.06em; color: #f5a524;
}
.brand-ar {
  position: absolute; left: 72px; top: 146px; direction: rtl;
  font-family: "otta-arabic", sans-serif; font-weight: 700;
  font-size: 30px; color: #6f7076;
}
.index {
  position: absolute; right: 72px; top: 92px;
  font-family: "condor", sans-serif; font-weight: 900; font-style: italic;
  font-size: 54px; color: #ffffff;
}
.index .of { color: #4a4b50; }

.hero { position: absolute; left: 0; top: 300px; display: block; }

.rule {
  position: absolute; left: 72px; top: 986px; width: 132px; height: 5px;
  background: #f5a524;
}

.klass {
  position: absolute; left: 72px; top: 1016px;
  font-family: "source-sans-3", sans-serif; font-weight: 700;
  font-size: 27px; letter-spacing: 0.24em; color: #8a8b91;
}
.klass-ar {
  font-family: "otta-arabic", sans-serif; font-weight: 700;
  letter-spacing: normal; direction: rtl; margin-left: 18px; color: #5f6066;
}

.name {
  position: absolute; left: 68px; top: 1062px; width: 944px;
  font-family: "condor", sans-serif; font-weight: 900; font-style: italic;
  font-size: 116px; line-height: 0.96; color: #ffffff;
}
.name-ar {
  position: absolute; right: 72px; top: 1206px; direction: rtl;
  font-family: "otta-arabic", sans-serif; font-weight: 900;
  font-size: 62px; color: #f5a524;
}

.specs { position: absolute; left: 72px; top: 1360px; width: 936px; display: flex; }
.spec { width: 312px; }
.spec .k {
  font-family: "source-sans-3", sans-serif; font-weight: 700;
  font-size: 22px; letter-spacing: 0.18em; color: #6f7076;
}
.spec .k-ar {
  font-family: "otta-arabic", sans-serif; font-weight: 400;
  letter-spacing: normal; direction: rtl; unicode-bidi: isolate;
  margin-left: 12px; color: #55565b;
}
.spec .v {
  margin-top: 12px;
  font-family: "condor", sans-serif; font-weight: 900; font-style: italic;
  font-size: 68px; color: #ffffff;
}
.spec .v .u {
  font-family: "source-sans-3", sans-serif; font-weight: 400; font-style: normal;
  font-size: 26px; color: #7c7d83; margin-left: 8px;
}
/* Right-to-left TEXT, left-aligned BOX. The Arabic reads right to left
   — that is what direction does — but the column it sits in is aligned
   to the left with the English above it, and without this the line
   drifted to the right-hand edge of its column and looked like it
   belonged to the spec next door. */
.spec .v-ar {
  margin-top: 4px; direction: rtl; text-align: left; unicode-bidi: isolate;
  font-family: "otta-arabic", sans-serif; font-weight: 400;
  font-size: 28px; color: #7c7d83;
}

.locked {
  position: absolute; left: 72px; top: 1614px; width: 936px;
  padding: 20px 26px; border: 2px solid rgba(245, 165, 36, 0.42);
  background: rgba(245, 165, 36, 0.09);
  font-family: "source-sans-3", sans-serif; font-weight: 700;
  font-size: 24px; letter-spacing: 0.12em; color: #f5a524;
}
.locked-ar {
  display: block; margin-top: 8px; direction: rtl; letter-spacing: normal;
  font-family: "otta-arabic", sans-serif; font-weight: 400; font-size: 26px;
  color: #c9973c;
}

.foot {
  position: absolute; left: 72px; bottom: 96px;
  font-family: "source-sans-3", sans-serif; font-weight: 700;
  font-size: 24px; letter-spacing: 0.2em; color: #6f7076;
}
.foot-ar {
  font-family: "otta-arabic", sans-serif; font-weight: 400;
  letter-spacing: normal; direction: rtl; margin-left: 16px; color: #55565b;
}

/* The flag, drawn rather than fetched: three bars and the black hoist
   trapezoid, which is the one detail a rectangle gets wrong. */
.flag { position: absolute; right: 72px; bottom: 92px; width: 96px; height: 64px; overflow: hidden; }
.flag span { position: absolute; left: 0; width: 96px; height: 21.34px; display: block; }
.flag .s1 { top: 0; background: #007a3d; }
.flag .s2 { top: 21.34px; background: #ffffff; }
.flag .s3 { top: 42.68px; background: #ce1126; }
.flag .tri {
  top: 0; left: 0; width: 0; height: 0; background: none;
  border-top: 32px solid transparent; border-bottom: 32px solid transparent;
  border-left: 34px solid #000000;
}
</style>
</head>
<body>
${cards.join("\n")}
</body>
</html>
`;

writeFileSync(`${OUT}/stories.html`, html);
const mb = (n) => `${(n / 1024 / 1024).toFixed(2)} MB`;
console.log(`${CARS.length} cards -> ${OUT}/stories.html`);
console.log(`  ${W}x${H}, images inlined: ${mb(bytes)} of base64, file ${mb(html.length)}`);
