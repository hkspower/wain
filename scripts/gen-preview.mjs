/**
 * App preview PDF — scripts/gen-preview.mjs
 *
 * Renders docs/wain-app-preview.pdf: a five-page A4 landscape deck of the app
 * as it actually runs. Screens are captured from the real static export, so the
 * deck can never drift from the product the way a hand-made mockup does.
 *
 *   node scripts/gen-preview.mjs            # expects `npm run build` first
 *
 * Quality: phones are captured at deviceScaleFactor 3 (1170x2532) and placed
 * 58mm wide, which is ~512dpi; the desktop plate lands at ~320dpi. Type is NOT
 * rasterised — the page is printed through Chromium with preferCSSPageSize, so
 * Arabic stays live, selectable, subsetted vector text in the PDF.
 *
 * Fonts come from the build's own IBM Plex Sans Arabic woff2 files, embedded as
 * data URIs. Adobe Fonts serves the same family, but its CDN is not reachable
 * from a build box, and using the app's own files guarantees the deck and the
 * app are set in identical faces.
 *
 * Layout follows Adobe's fixed-canvas rules (single root class per page,
 * explicit mm dimensions, hz: metadata) so the same HTML can also be imported
 * into Adobe Express without rework.
 */

import { chromium } from 'playwright';
import sharp from 'sharp';
import { readFileSync, mkdirSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Counted from the data, never typed into the deck.
 *
 * The cover said "سبعة عشر مكان" and "١٧" in three places. The catalogue has
 * since doubled, and a preview that misstates the size of the product is worse
 * than no preview — so the numbers are read from the source they describe.
 */
const placesSrc = readFileSync(join(ROOT, 'src/lib/places.ts'), 'utf8');
const PLACES_N = (placesSrc.slice(placesSrc.indexOf('export const places')).match(/^ {4}slug: /gm) || []).length;
const CATS_N = (placesSrc.match(/^ {4}id: "[a-z]+",$/gm) || []).length;
if (PLACES_N < 5 || CATS_N < 3) {
  console.error(`gen-preview: read ${PLACES_N} places and ${CATS_N} categories — refusing to print that.`);
  process.exit(1);
}
const arabicDigits = (n) => String(n).replace(/\d/g, (d) => '٠١٢٣٤٥٦٧٨٩'[+d]);
const OUT = join(ROOT, 'out');
const WORK = join(ROOT, '.preview-cache');
const PDF = join(ROOT, 'docs', 'wain-app-preview.pdf');
const IMG = join(ROOT, 'docs', 'preview-pages');
const PORT = 4178;
const EXEC = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium';

if (!existsSync(join(OUT, 'index.html'))) {
  console.error('gen-preview: out/ is missing — run `npm run build` first.');
  process.exit(1);
}
mkdirSync(WORK, { recursive: true });
mkdirSync(join(ROOT, 'docs'), { recursive: true });

/* ---------------------------------------------------------------- serve out/ */
const { createServer } = await import('http');
const { extname } = await import('path');
const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json',
  '.txt': 'text/plain', '.xml': 'application/xml', '.ico': 'image/x-icon' };

const server = createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p.endsWith('/')) p += 'index.html';
  let f = join(OUT, p);
  if (!existsSync(f) && existsSync(f + '.html')) f += '.html';
  if (!existsSync(f) || !f.startsWith(OUT)) { res.writeHead(404); return res.end('nope'); }
  res.writeHead(200, { 'content-type': MIME[extname(f)] || 'application/octet-stream' });
  res.end(readFileSync(f));
});
await new Promise((r) => server.listen(PORT, r));
const base = `http://localhost:${PORT}`;

/* ------------------------------------------------------------------ capture */
const SCREENS = [
  { id: 'home',    url: '/' },
  { id: 'explore', url: '/explore/' },
  { id: 'search',  url: '/search/?q=' + encodeURIComponent('بحر') },
  { id: 'place',   url: '/places/kuwait-towers/' },
  { id: 'place2',  url: '/places/al-shaheed-park/' },
  { id: 'add',     url: '/add/' },
];

const browser = await chromium.launch({ executablePath: EXEC });
const phoneCtx = await browser.newContext({
  viewport: { width: 390, height: 844 }, deviceScaleFactor: 3,
  isMobile: true, hasTouch: true, locale: 'ar-KW',
});
const pp = await phoneCtx.newPage();
for (const s of SCREENS) {
  const r = await pp.goto(base + s.url, { waitUntil: 'networkidle' });
  if (!r.ok()) throw new Error(`capture ${s.id}: ${r.status()}`);
  await pp.evaluate(() => document.fonts.ready);
  await pp.waitForTimeout(700);
  if (s.id === 'place' || s.id === 'search') {
    // Both screens embed an OpenStreetMap iframe, and a build box has no route
    // to OSM — it captures as an empty grey box with a broken-image glyph.
    // Drop it rather than ship a screenshot of a failure.
    await pp.evaluate(() => document.querySelectorAll('iframe').forEach((f) => f.closest('div')?.remove()));
    await pp.waitForTimeout(300);
  }
  if (s.id === 'place') {
    // Scroll to the detail panels — highlights, best time, and الجو والموسم.
    // The hero art is already on the cover and across the explore grid; what
    // has never been in the deck is the part that answers "should I go now".
    // behavior:'instant' matters — the site sets scroll-behavior:smooth, so a
    // default scrollIntoView animates and the screenshot lands mid-flight,
    // which silently produced an unscrolled capture.
    const y = await pp.evaluate(() => {
      const h = [...document.querySelectorAll('h2')].find((x) => x.textContent.includes('أبرز ما فيه'));
      const top = h?.closest('div')?.getBoundingClientRect().top ?? 0;
      window.scrollTo({ top: window.scrollY + top - 72, behavior: 'instant' });
      return window.scrollY;
    });
    if (y < 100) throw new Error(`capture place: expected to scroll to the detail panels, got scrollY ${y}`);
    await pp.waitForTimeout(400);
  }
  await pp.screenshot({ path: join(WORK, `${s.id}.png`) });
}

// وين AI, caught mid-listen. There is no microphone on a build box, and the
// panel only reaches this state from a real three-second hold, so the
// recogniser is stubbed and the gesture driven directly. Everything rendered
// is the real component in its real state.
await pp.addInitScript(() => {
  class FakeRec {
    constructor() { this.onresult = null; this.onerror = null; this.onend = null; }
    start() { setTimeout(() => this.onresult?.({ results: [[{ transcript: 'قهوة هادية' }]] }), 250); }
    stop() {} abort() {}
  }
  window.SpeechRecognition = FakeRec;
});
await pp.goto(base + '/', { waitUntil: 'networkidle' });
await pp.evaluate(() => document.fonts.ready);
const fab = pp.locator('button[aria-label*="وين AI"]');
await fab.dispatchEvent('pointerdown', { pointerType: 'touch', button: 0, pointerId: 1 });
await pp.waitForTimeout(3400);
await pp.waitForSelector('#wain-ai-panel', { timeout: 5000 });
await pp.waitForTimeout(600);
await pp.screenshot({ path: join(WORK, 'ai.png') });

await phoneCtx.close();

// deviceScaleFactor 3, not 2: this plate is placed 257mm wide, which at
// 300dpi wants 3035px. At dsf 2 it captured 2880px and the page raster was
// upscaling it slightly — the one asset in the deck that was not comfortably
// above its printed size.
const deskCtx = await browser.newContext({ viewport: { width: 1440, height: 1010 }, deviceScaleFactor: 3, locale: 'ar-KW' });
const dp = await deskCtx.newPage();
await dp.goto(base + '/explore/', { waitUntil: 'networkidle' });
await dp.evaluate(() => document.fonts.ready);
await dp.waitForTimeout(700);
await dp.screenshot({ path: join(WORK, 'desk-explore.png') });
await deskCtx.close();

/* -------------------------------------------------------------- build deck */
const B = join(OUT, '_next/static/media') + '/';
const P = WORK + '/';

const font = (f) => readFileSync(B + f).toString('base64');
const shot = (f) => readFileSync(P + f + '.png').toString('base64');
// The app's own typeface, taken from the app's own build — same faces the site
// serves, embedded so the PDF renders identically anywhere.
const FACES = [
  { w: 400, ar: '9da48a48bf6500f8-s.p.woff2', la: '17efc7caebbb6a73-s.p.woff2' },
  { w: 600, ar: 'e4efb0298547fad0-s.p.woff2', la: '79d9077e4fd7eddc-s.p.woff2' },
  { w: 700, ar: 'fb66eb17bf011c3b-s.p.woff2', la: '99dc19e540dbb87b-s.p.woff2' },
];
const AR_RANGE = 'U+0600-06FF,U+0750-077F,U+0870-088E,U+08A0-08FF,U+200C-200E,U+2010-2011,U+FB50-FDFF,U+FE70-FEFC';
const fontCss = FACES.map(f => `
@font-face{font-family:'Plex Arabic';font-style:normal;font-weight:${f.w};font-display:block;
src:url(data:font/woff2;base64,${font(f.ar)}) format('woff2');unicode-range:${AR_RANGE};}
@font-face{font-family:'Plex Arabic';font-style:normal;font-weight:${f.w};font-display:block;
src:url(data:font/woff2;base64,${font(f.la)}) format('woff2');}`).join('');

const CAPTIONS = {
  home:    ['الرئيسية', 'قرص «إلى وين؟» يقترح أماكن قريبة بضغطة وحدة'],
  explore: ['استكشف', 'كل الأماكن، مرتّبة بالتصنيف ولون لكل فئة'],
  search:  ['البحث والخريطة', 'نتائج فورية بلون التصنيف — والخريطة فوقها على نفس الشاشة'],
  place:   ['صفحة المكان', 'أبرز ما فيه، أحسن وقت، والجو والموسم'],
  place2:  ['مكان ثاني', 'نفس التصميم بلون التصنيف — حدائق وشواطئ'],
  add:     ['سجّل نشاطك', 'تسجيل مجاني لأي نشاط في الكويت'],
  about:   ['عن وين', 'الفكرة والفريق'],
  ai:      ['وين AI', 'اضغط ٣ ثواني وقل وش تبي — شوق ترد بصوتها'],
};

const PHONE_W = 58;              // mm
const PHONE_H = +(PHONE_W * 844 / 390).toFixed(2);

const phone = (id) => {
  const [title, sub] = CAPTIONS[id];
  return `<figure class="dev">
      <div class="bez"><img src="data:image/png;base64,${shot(id)}" width="${Math.round(PHONE_W * 3.78)}" height="${Math.round(PHONE_H * 3.78)}" alt=""></div>
      <figcaption><span class="cap-t">${title}</span><span class="cap-s">${sub}</span></figcaption>
    </figure>`;
};

const CATS = [
  ['معالم الكويت', '#023550', '#dcf0ff', '#1870a1'],
  ['مطاعم', '#4f2022', '#ffe6e5', '#9e4c4e'],
  ['وجبات سريعة', '#4d240f', '#ffe7dd', '#9c522e'],
  ['قهوة', '#422c00', '#f8ebd7', '#896100'],
  ['شواطئ وحدائق', '#113a1d', '#dff3e2', '#317a45'],
  ['تسوّق', '#48213c', '#fce5f3', '#924d7d'],
  ['ثقافة', '#312a52', '#eceaff', '#695ca3'],
  ['عائلة', '#003939', '#d7f4f3', '#007879'],
];

const page = (cls, inner) =>
  `<div class="page ${cls}" data-canvas-width="1123" data-canvas-height="794">${inner}</div>`;

const html = `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8">
<title>وين؟ — معاينة التطبيق</title>
<meta name="hz:slide-selector" content=".page">
<meta name="hz:canvas-width" content="1123">
<meta name="hz:canvas-height" content="794">
<style>
*{margin:0;padding:0;box-sizing:border-box}
${fontCss}
@page{size:297mm 210mm;margin:0}
body{background:#d8d5d0;font-family:'Plex Arabic',sans-serif}

.page{position:relative;width:297mm;height:210mm;background:#ffffff;overflow:hidden;page-break-after:always}
.page:last-child{page-break-after:auto}

/* type roles — one set, used on every page */
.h1{font-weight:700;font-size:23pt;color:#14120f;line-height:1.15;letter-spacing:-.01em}
.h2{font-weight:700;font-size:14pt;color:#14120f;line-height:1.2}
.body{font-weight:400;font-size:9.5pt;color:#585044;line-height:1.55}
.label{font-weight:600;font-size:7pt;color:#8b6836;letter-spacing:.14em}

/* ---- cover ---- */
.cover{background:linear-gradient(155deg,#faf8f5 0%,#f1eadc 48%,#e2d4b6 100%)}
.cover .mark{position:absolute;top:30mm;right:24mm;display:flex;align-items:center;gap:5mm}
.cover .wm{font-weight:700;font-size:50pt;color:#14120f;letter-spacing:-.02em;line-height:1}
.cover .q{color:#dc2f25}
.cover .lede{position:absolute;top:74mm;right:24mm;width:132mm}
.cover .foot{position:absolute;bottom:20mm;right:24mm;width:132mm;display:flex;justify-content:space-between;align-items:flex-end}
.cover .url{font-weight:700;font-size:13pt;color:#1e6092;direction:ltr}
/* the app itself, on the cover — the left half was dead space without it */
.cover .hero{position:absolute;top:22mm;left:26mm;width:${PHONE_W * 1.28}mm;height:${PHONE_H * 1.28}mm;
  border-radius:6.4mm;overflow:hidden;background:#14120f;border:.9mm solid #14120f;
  box-shadow:0 6mm 16mm rgba(20,18,15,.28);transform:rotate(-4deg)}
.cover .hero img{display:block;width:100%;height:100%;object-fit:cover}
.skyline{position:absolute;bottom:0;left:0;width:297mm;height:52mm}

/* ---- screen pages ---- */
.head{position:absolute;top:16mm;right:20mm;left:20mm;display:flex;justify-content:space-between;align-items:baseline;
      border-bottom:.4mm solid #dbd8d2;padding-bottom:4mm}
.row{position:absolute;top:38mm;right:20mm;left:20mm;display:flex;justify-content:space-between;align-items:flex-start}
.dev{width:${PHONE_W}mm}
.bez{width:${PHONE_W}mm;height:${PHONE_H}mm;border-radius:5mm;overflow:hidden;background:#14120f;
     border:.7mm solid #14120f;box-shadow:0 2mm 5mm rgba(20,18,15,.22)}
.bez img{display:block;width:100%;height:100%;object-fit:cover}
figcaption{margin-top:4mm;display:flex;flex-direction:column;gap:1mm}
.cap-t{font-weight:600;font-size:9.5pt;color:#14120f}
.cap-s{font-weight:400;font-size:7.5pt;color:#585044;line-height:1.45}

/* ---- desktop page ---- */
.wide{position:absolute;top:34mm;right:20mm;left:20mm;height:152mm;border-radius:3mm;overflow:hidden;
      border:.4mm solid #cdc9c2;box-shadow:0 2mm 6mm rgba(20,18,15,.14)}
.wide img{display:block;width:100%;height:100%;object-fit:cover;object-position:top center}

/* ---- system page ---- */
.grid{position:absolute;top:36mm;right:20mm;left:20mm;display:grid;grid-template-columns:repeat(4,1fr);gap:7mm}
.sw{border-radius:2.6mm;overflow:hidden;border:.3mm solid #dbd8d2}
.sw .ground{height:34mm;display:flex;align-items:flex-end;padding:3mm}
.sw .ground span{font-weight:600;font-size:8.5pt;color:#fff}
.sw .pair{display:flex;align-items:center;gap:2.5mm;padding:3mm}
.sw .chip{width:10mm;height:10mm;border-radius:2.2mm;display:flex;align-items:center;justify-content:center}
.sw .chip b{font-weight:700;font-size:10pt}
.sw .meta{font-weight:400;font-size:6.5pt;color:#585044;direction:ltr;line-height:1.4}
.notes{position:absolute;bottom:22mm;right:20mm;left:20mm;display:flex;gap:10mm;
       border-top:.3mm solid #dbd8d2;padding-top:6mm}
.note{flex:1}
.note .k{font-weight:700;font-size:16pt;color:#14120f}
.foot-rule{position:absolute;bottom:12mm;right:20mm;left:20mm;display:flex;justify-content:space-between;
           border-top:.3mm solid #dbd8d2;padding-top:3mm;font-size:7pt;color:#8b6836;font-weight:600}
</style>
</head>
<body>

${page('cover', `
  <svg class="skyline" viewBox="0 0 1123 197" preserveAspectRatio="none" aria-hidden="true">
    <path d="M0 197V128c52-8 84 10 126 6s60-22 104-20 62 20 104 18 64-24 108-22 66 22 110 20 66-24 110-22 68 18 112 16 72-12 110-8 84 14 118 10v71Z"
          fill="#d9c8a6" opacity=".55"/>
    <path d="M0 197V161c58-6 92 8 136 6s62-16 106-14 62 16 106 14 66-18 110-16 66 16 110 14 68-16 112-14 72 12 112 10 78-8 114-4v40Z"
          fill="#c9b189" opacity=".6"/>
  </svg>
  <div class="hero"><img src="data:image/png;base64,${shot('home')}" width="${Math.round(PHONE_W * 1.28 * 3.78)}" height="${Math.round(PHONE_H * 1.28 * 3.78)}" alt=""></div>
  <div class="mark">
    <svg width="76" height="76" viewBox="0 0 48 48" aria-hidden="true">
      <path d="M6 12l11-4 14 5 11-4v27l-11 4-14-5-11 4Z" fill="#2277b4" opacity=".16"/>
      <path d="M6 12l11-4 14 5 11-4v27l-11 4-14-5-11 4Z" fill="none" stroke="#1e6092" stroke-width="2.2"
            stroke-linejoin="round"/>
      <path d="M17 8v27M31 13v27" stroke="#1e6092" stroke-width="1.6" opacity=".5"/>
      <path d="M24 9a8 8 0 0 0-8 8c0 6 8 14 8 14s8-8 8-14a8 8 0 0 0-8-8Z" fill="#dc2f25"/>
      <circle cx="24" cy="17" r="3.1" fill="#fff"/>
    </svg>
    <div class="wm">وين<span class="q">؟</span></div>
  </div>
  <div class="lede">
    <div class="label">معاينة التطبيق · ٢٠٢٦</div>
    <h1 class="h1" style="margin-top:5mm">دليل الأماكن في الكويت،<br>بالعربي وباللهجة الكويتية</h1>
    <p class="body" style="margin-top:6mm">
      تطبيق ويب يشتغل على الجوال بدون إنترنت بعد أول زيارة. ${arabicDigits(PLACES_N)} مكان،
      مساعدة صوتية بالكويتي، خريطة بحث دقيقة، وتسجيل مجاني لأصحاب الأنشطة.
    </p>
    <div style="margin-top:9mm;display:flex;gap:9mm">
      <div><div style="font-weight:700;font-size:17pt;color:#14120f">${arabicDigits(PLACES_N)}</div><div class="body" style="font-size:8pt">مكان</div></div>
      <div><div style="font-weight:700;font-size:17pt;color:#14120f">${arabicDigits(CATS_N)}</div><div class="body" style="font-size:8pt">تصنيفات</div></div>
      <div><div style="font-weight:700;font-size:17pt;color:#14120f">١٠٠٪</div><div class="body" style="font-size:8pt">عربي</div></div>
    </div>
  </div>
  <div class="foot">
    <div class="url">wainkw.com</div>
    <div class="label">صُمّم وبُني في الكويت</div>
  </div>
`)}

${page('', `
  <div class="head"><h2 class="h2">الشاشات الأساسية</h2><span class="label">١ / ٣</span></div>
  <div class="row">${phone('home')}${phone('explore')}${phone('search')}</div>
  <div class="foot-rule"><span>وين؟ — معاينة التطبيق</span><span>٢</span></div>
`)}

${page('', `
  <div class="head"><h2 class="h2">اسأل بصوتك، وسجّل نشاطك</h2><span class="label">٢ / ٣</span></div>
  <div class="row">${phone('ai')}${phone('place')}${phone('add')}</div>
  <div class="foot-rule"><span>وين؟ — معاينة التطبيق</span><span>٣</span></div>
`)}

${page('', `
  <div class="head"><h2 class="h2">على الشاشة الكبيرة</h2><span class="label">٣ / ٣</span></div>
  <div class="wide"><img src="data:image/png;base64,${shot("desk-explore")}" width="2880" height="2020" alt=""></div>
  <div class="foot-rule"><span>وين؟ — معاينة التطبيق</span><span>٤</span></div>
`)}

${page('', `
  <div class="head"><h2 class="h2">نظام الألوان</h2><span class="label">تصنيف = لون</span></div>
  <div class="grid">
    ${CATS.map(([n, g, t, k]) => `<div class="sw">
      <div class="ground" style="background:${g}"><span>${n}</span></div>
      <div class="pair" style="background:#fff">
        <span class="chip" style="background:${t}"><b style="color:${k}">و</b></span>
        <span class="meta">${g}<br>${k}</span>
      </div>
    </div>`).join('')}
  </div>
  <div class="notes">
    <div class="note"><div class="k">٠٫٠١٨</div><p class="body">فرق التشبّع بين كل التصنيفات — كانت ٠٫١٦٣ قبل التوحيد.</p></div>
    <div class="note"><div class="k">٣٫٣٠:١</div><p class="body">تباين حدود الحقول والأزرار، فوق حد WCAG للعناصر التفاعلية.</p></div>
    <div class="note"><div class="k">٤٫٥:١+</div><p class="body">تباين كل أيقونة مكان على خلفيتها الملوّنة.</p></div>
  </div>
  <div class="foot-rule"><span>وين؟ — معاينة التطبيق</span><span>٥</span></div>
`)}

</body>
</html>`;


/* ---------------------------------------------------------------- print PDF */
const pdfPage = await browser.newPage();
await pdfPage.setContent(html, { waitUntil: 'load' });
await pdfPage.evaluate(() => document.fonts.ready);
await pdfPage.waitForTimeout(1200);
await pdfPage.pdf({
  path: PDF,
  printBackground: true,
  preferCSSPageSize: true,          // honours @page, so no scaling is applied
  margin: { top: 0, right: 0, bottom: 0, left: 0 },
});
/**
 * A PNG of every page beside the PDF — both to check the result without a PDF
 * viewer, and because the pages are wanted on their own for slides, posts and
 * print.
 *
 * 300dpi, and not more, is a deliberate ceiling. The deck's largest embedded
 * asset is the desktop plate, captured at 4320px and placed 257mm wide; 300dpi
 * asks 3035px of it, so nothing in the page is enlarged past what was actually
 * captured. At 450dpi it would want 4553px and the export would start
 * inventing detail — a bigger file that is not a better picture.
 *
 * The deck is laid out at 96dpi (1123px = 297mm), so the scale factor is
 * 300/96 = 3.125.
 */
const EXPORT_DPI = 300;
const SCALE = EXPORT_DPI / 96;
const PAGE_PX = { w: Math.round(1123 * SCALE), h: Math.round(794 * SCALE) };
const shotCtx = await browser.newContext({
  viewport: { width: 1123, height: 794 },
  deviceScaleFactor: SCALE,
});
const shotPage = await shotCtx.newPage();
await shotPage.setContent(html, { waitUntil: 'load' });
await shotPage.evaluate(() => document.fonts.ready);
await shotPage.waitForTimeout(1200);

mkdirSync(IMG, { recursive: true });
const pageCount = await shotPage.locator('.page').count();
const written = [];
for (let i = 0; i < pageCount; i++) {
  const file = join(IMG, `wain-preview-${i + 1}.png`);
  const raw = await shotPage.locator('.page').nth(i).screenshot();
  // Element screenshots round fractionally, so the pages came out 2481 or
  // 2484px tall depending on where each sat on the strip. A set of pages that
  // are not the same size is a set that will not place cleanly, so crop every
  // one to the exact page rectangle. The trim is 3px of the bottom margin.
  // Stamp the real density. A browser screenshot carries no pHYs chunk, so
  // every print tool reads it as 72dpi and places a 3509px page at 1.2 metres
  // wide — the pixels were right and the document was wrong. With this it
  // drops in at 297mm.
  await sharp(raw)
    .extract({ left: 0, top: 0, width: PAGE_PX.w, height: PAGE_PX.h })
    .withMetadata({ density: EXPORT_DPI })
    .png({ compressionLevel: 9 })
    .toFile(file);
  written.push(file);
}
await shotCtx.close();

await browser.close();
server.close();
console.log(`gen-preview: docs/wain-app-preview.pdf (${(readFileSync(PDF).length / 1e6).toFixed(2)} MB) ✓`);
for (const f of written) {
  const { width, height } = { width: Math.round(1123 * SCALE), height: Math.round(794 * SCALE) };
  console.log(`  ${f.replace(ROOT + '/', '')}  ${width}×${height}  ${EXPORT_DPI}dpi  ${(readFileSync(f).length / 1e6).toFixed(2)} MB`);
}
