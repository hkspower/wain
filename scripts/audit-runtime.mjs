#!/usr/bin/env node
/**
 * Open every page and see what breaks:  npm run audit:runtime
 *
 * The suites drive the paths somebody thought to write a test for. This opens
 * every route the build produced and listens for the things nobody asserts on:
 * an uncaught exception, a rejected promise nobody handled, a request for a
 * file that is not there, a console error. Any of those is broken code that
 * ships silently because the page still mostly renders.
 *
 * Run on a phone and on a desktop, because a component that only mounts at one
 * width can only break at one width.
 */
import { createServer } from "node:http";
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, extname, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "out");
const CHROMIUM = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";
const PORT = 4203;

if (!existsSync(join(OUT, "index.html"))) {
  console.error("out/ is missing — run npm run build first.");
  process.exit(1);
}

/** Every route the build actually produced, not a list someone maintains. */
function routes(dir = OUT, acc = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) routes(full, acc);
    else if (name === "index.html") {
      const r = "/" + relative(OUT, dirname(full)).replace(/\\/g, "/");
      acc.push(r === "/." ? "/" : r + "/");
    }
  }
  return acc;
}
const ALL = routes().sort();
// One place page stands for all thirty-six: they are the same component with
// different data, and opening every one would spend ten minutes proving it.
const PAGES = ALL.filter((r) => !r.startsWith("/places/") || r === "/places/kuwait-towers/");

const MIME = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript",
  ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg",
  ".svg": "image/svg+xml", ".woff2": "font/woff2", ".ico": "image/x-icon",
  ".webmanifest": "application/manifest+json", ".txt": "text/plain", ".xml": "application/xml" };
const missed = new Set();
const server = createServer((req, res) => {
  let p = decodeURIComponent(req.url.split("?")[0]);
  if (p.endsWith("/")) p += "index.html";
  let f = join(OUT, p);
  if (!existsSync(f) && existsSync(f + ".html")) f += ".html";
  if (!existsSync(f) || !f.startsWith(OUT)) {
    missed.add(decodeURIComponent(req.url));
    res.writeHead(404);
    return res.end("not found");
  }
  res.writeHead(200, { "content-type": MIME[extname(f)] || "application/octet-stream" });
  res.end(readFileSync(f));
});
await new Promise((r) => server.listen(PORT, r));

const { chromium } = await import("playwright");
const browser = await chromium.launch({ executablePath: CHROMIUM });

const VIEWPORTS = [
  { name: "phone", width: 390, height: 844, isMobile: true, hasTouch: true },
  { name: "desktop", width: 1280, height: 900 },
];

const external = new Set();
let problems = 0;
console.log(`\nOpening ${PAGES.length} routes on ${VIEWPORTS.length} viewports.\n`);

for (const vp of VIEWPORTS) {
  const ctx = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    isMobile: vp.isMobile, hasTouch: vp.hasTouch, locale: "ar-KW",
  });
  for (const url of PAGES) {
    const page = await ctx.newPage();
    const found = [];
    page.on("pageerror", (e) => found.push(`uncaught: ${e.message}`));
    page.on("console", (m) => {
      if (m.type() === "error") found.push(`console.error: ${m.text().slice(0, 160)}`);
    });
    // Whether a third party is reachable is not a fact about this codebase,
    // and a sandbox with no route to openstreetmap.org would otherwise report
    // two failures on every run until people stopped reading the output.
    const ours = (u) => u.startsWith(`http://localhost:${PORT}`) || u.startsWith("data:") || u.startsWith("blob:");
    page.on("requestfailed", (r) => {
      const f = r.failure()?.errorText ?? "";
      // Aborts are the app cancelling its own work, which is correct.
      if (/ABORTED|aborted/i.test(f)) return;
      if (ours(r.url())) found.push(`request failed: ${r.url()} (${f})`);
      else external.add(new URL(r.url()).host);
    });
    page.on("response", (r) => {
      if (r.status() >= 400 && ours(r.url())) found.push(`HTTP ${r.status()}: ${r.url()}`);
    });

    try {
      await page.goto(`http://localhost:${PORT}${url}`, { waitUntil: "networkidle", timeout: 25000 });
      // Let anything deferred to after hydration have its chance to throw.
      await page.waitForTimeout(900);
    } catch (e) {
      found.push(`navigation: ${String(e).slice(0, 140)}`);
    }

    if (found.length) {
      problems += found.length;
      console.log(`✗ ${url}  [${vp.name}]`);
      [...new Set(found)].forEach((f) => console.log("    " + f));
    } else {
      console.log(`✓ ${url}  [${vp.name}]`);
    }
    await page.close();
  }
  await ctx.close();
}

await browser.close();
server.close();

/**
 * Images only a crawler ever asks for.
 *
 * Opening every page cannot find these: og:image and twitter:image are read by
 * WhatsApp, Twitter and Facebook when a link is shared, and never fetched by
 * the browser rendering the page — so a missing card is invisible to every
 * check above and to anyone testing the site by using it.
 *
 * It had gone wrong exactly that way. Place pages advertise /og/<slug>.jpg
 * unconditionally, the generator that makes those cards was broken (it needed
 * a server nothing started), and 19 of 36 places were pointing at a 404. Not a
 * fallback image — no preview at all, on more than half the catalogue.
 */
const shared = new Set();
function socialImages(dir = OUT) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) socialImages(full);
    else if (name.endsWith(".html")) {
      const html = readFileSync(full, "utf8");
      for (const m of html.matchAll(
        /(?:og:image|twitter:image)"\s+content="([^"]+)"/g
      )) {
        shared.add(m[1]);
      }
    }
  }
}
socialImages();
const brokenCards = [...shared].filter((url) => {
  const path = url.replace(/^https?:\/\/[^/]+/, "");
  if (!path.startsWith("/")) return false;
  return !existsSync(join(OUT, decodeURIComponent(path)));
});
console.log(`\n${shared.size} distinct share image(s) advertised to crawlers.`);
if (brokenCards.length) {
  console.log(`${brokenCards.length} of them do not exist in the build:`);
  brokenCards.slice(0, 20).forEach((u) => console.log("    " + u));
  problems += brokenCards.length;
} else {
  console.log("  Every one exists — a shared link shows a picture.");
}

if (missed.size) {
  console.log(`\n${missed.size} request(s) for files the build did not produce:`);
  [...missed].slice(0, 20).forEach((m) => console.log("    " + m));
  problems += missed.size;
}

if (external.size) {
  console.log(`\nUnreachable third parties (not this codebase's problem, listed so a real\noutage is not mistaken for clean): ${[...external].join(", ")}`);
}
console.log(problems ? `\n${problems} problem(s) found.` : "\nEvery route loads clean: no exceptions, no console errors, nothing missing.");
process.exit(problems ? 1 : 0);
