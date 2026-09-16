/**
 * The whole site, as one PDF — scripts/gen-site-pdf.mjs
 *
 *   npm run build && npm run pdf     # writes wainkw-site.pdf
 *
 * Every route in `out/` gets one PDF page showing that route in full, top to
 * bottom. 62 routes today: the home page, the nine other screens, and a page
 * for each of the 52 places.
 *
 * NOT screenshots. The pages are printed through Chromium, so Arabic stays
 * live, selectable, subsetted vector text — the same reason gen-preview.mjs
 * prints rather than rasterises. A reviewer can search this PDF for «قهوة»
 * and land on the right page.
 *
 * ONE TALL PAGE PER ROUTE, rather than A4. The site is a continuous scroll
 * with a sticky header and no print stylesheet; chopping it into A4 slices
 * cuts cards in half and repeats nothing useful at the seam. A page sized to
 * the route's own scrollHeight is what someone reviewing the site actually
 * wants to look at — the screen, whole.
 *
 * `content-visibility` has to be switched off before printing, and that is
 * the trap this file exists to remember. `.card-defer` sets
 * `content-visibility: auto` so /explore can skip laying out the cards below
 * the fold (see globals.css). In a print that optimisation is a liability:
 * the skipped cards are not rendered, so the page prints with a correctly
 * sized blank hole where 30-odd places should be. The override below is not
 * tidying — without it this deck is silently wrong on its biggest page.
 *
 * pdf-lib is NOT a dependency of this project, the same call gen-og.mjs makes
 * about Playwright: this artefact is generated on demand, so a normal build
 * and deploy never needs either. Hence a sentence rather than a
 * module-not-found stack.
 */
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { join, extname, relative, sep } from "node:path";

let chromium, PDFDocument;
try {
  ({ chromium } = await import("playwright"));
  ({ PDFDocument } = await import("pdf-lib"));
} catch {
  console.error(
    "gen-site-pdf needs Playwright and pdf-lib, which this project does not depend on.\n" +
    "  npm i -D playwright pdf-lib && npx playwright install chromium\n" +
    "The PDF is an on-demand artefact, so a normal build and deploy needs neither."
  );
  process.exit(1);
}

const ROOT = process.cwd();
const SITE = join(ROOT, "out");
const PORT = 4175;
const OUT = join(ROOT, "wainkw-site.pdf");

/** A route taller than this is clamped. Nothing on the site comes close; the
 *  clamp exists so one runaway page cannot produce a PDF no reader will open. */
const MAX_PX = 24000;
const WIDTH = 1280;

if (!existsSync(join(SITE, "index.html"))) {
  console.error("gen-site-pdf: out/ is missing — run npm run build first.");
  process.exit(1);
}

/** Every directory in out/ that has an index.html is a route — trailingSlash:
 *  true is what makes that true, so this mirrors how Apache serves it. */
function routes(dir = SITE, found = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (!statSync(p).isDirectory()) continue;
    if (name === "_next") continue;
    if (existsSync(join(p, "index.html"))) {
      found.push("/" + relative(SITE, p).split(sep).join("/") + "/");
    }
    routes(p, found);
  }
  return found;
}

// Home first, then the other screens, then the 52 places. Sorted within each
// group so re-running produces the same order and a diff means a real change.
const all = routes();
const places = all.filter((r) => r.startsWith("/places/")).sort();
const screens = all.filter((r) => !r.startsWith("/places/")).sort();
const ordered = ["/", ...screens.filter((r) => r !== "/"), ...places];

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
const BASE = `http://127.0.0.1:${PORT}`;

const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM ?? "/opt/pw-browsers/chromium",
});
const page = await (await browser.newContext({
  viewport: { width: WIDTH, height: 900 },
  deviceScaleFactor: 1,
})).newPage();

const merged = await PDFDocument.create();
let done = 0;
let clamped = 0;

for (const route of ordered) {
  await page.goto(`${BASE}${route}`, { waitUntil: "networkidle" });

  // See the header: without this /explore prints a blank hole where the
  // deferred cards are. `animation: none` stops a mid-animation frame being
  // what gets printed — the pulse ring and the drifting clouds are otherwise
  // caught wherever they happened to be.
  await page.addStyleTag({
    content: `*, *::before, *::after {
      content-visibility: visible !important;
      contain-intrinsic-size: auto !important;
      animation: none !important;
      transition: none !important;
    }
    html { scroll-behavior: auto !important; }`,
  });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(150);

  let height = await page.evaluate(() =>
    Math.ceil(Math.max(
      document.documentElement.scrollHeight,
      document.body ? document.body.scrollHeight : 0,
    )));
  if (height > MAX_PX) { height = MAX_PX; clamped++; }
  if (height < 200) height = 900;

  // pageRanges:'1' because a height that rounds a hair over still produces a
  // second, near-empty page otherwise — 62 blank pages interleaved is the
  // difference between a document someone reads and one they close.
  const buf = await page.pdf({
    width: `${WIDTH}px`,
    height: `${height}px`,
    printBackground: true,
    pageRanges: "1",
    margin: { top: "0px", right: "0px", bottom: "0px", left: "0px" },
  });

  const doc = await PDFDocument.load(buf);
  const [copied] = await merged.copyPages(doc, [0]);
  merged.addPage(copied);
  done++;
  process.stdout.write(`\rgen-site-pdf: ${done}/${ordered.length} ${route}`.padEnd(70));
}

await browser.close();
server.close();

merged.setTitle("وين؟ — wainkw.com");
merged.setSubject(`${ordered.length} routes captured from the static export`);
merged.setCreator("scripts/gen-site-pdf.mjs");

writeFileSync(OUT, await merged.save());
const mb = (readFileSync(OUT).length / 1e6).toFixed(2);
console.log(`\ngen-site-pdf: wainkw-site.pdf — ${done} pages, ${mb} MB ✓`);
if (clamped) console.warn(`gen-site-pdf: ${clamped} route(s) clamped at ${MAX_PX}px`);
