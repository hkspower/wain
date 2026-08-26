#!/usr/bin/env node
/**
 * Every file the site ships:  npm run audit:assets   (needs npm run build)
 *
 * Four questions, all about the bytes a visitor on Kuwaiti mobile data
 * actually pays for:
 *
 *   1. Is anything referenced that is not there? That is a 404 — and the OG
 *      cards proved these can hide for months, because the thing asking for
 *      them was a crawler rather than the page.
 *   2. Is anything there that nothing references? Dead weight is uploaded,
 *      cached and served for ever, and nobody notices because the site works.
 *   3. Do the icons declare the size they actually are? A manifest that
 *      promises 512×512 and ships 480×480 gets the icon rejected outright by
 *      some installers, silently.
 *   4. Is the same file shipped twice under two names?
 *
 * It reads out/, not public/ — out/ is what gets uploaded, and it contains
 * things public/ never had.
 */
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, extname, relative, basename, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "out");

if (!existsSync(join(OUT, "index.html"))) {
  console.error("out/ is missing — run npm run build first.");
  process.exit(1);
}

const ASSET = new Set([
  ".jpg", ".jpeg", ".png", ".svg", ".webp", ".avif", ".gif", ".ico",
  ".woff", ".woff2", ".ttf", ".otf", ".mp3", ".mp4", ".webm", ".ogg",
]);
const TEXT = new Set([
  ".html", ".js", ".css", ".json", ".webmanifest", ".txt", ".xml", ".md", ".htaccess",
]);

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}
const files = walk(OUT);
const rel = (f) => "/" + relative(OUT, f).replace(/\\/g, "/");

let problems = 0;
const say = (msg) => { console.log("  ✗ " + msg); problems++; };
const kb = (n) => (n < 1024 ? `${n}B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(0)}KB` : `${(n / 1048576).toFixed(1)}MB`);

// ---- what the shipped text refers to ---------------------------------------
/** Every asset-looking path mentioned anywhere in the shipped text. */
const referenced = new Set();
/** Basenames, for matching a file that is reached by a path we cannot rebuild. */
const mentioned = new Set();
let textBytes = 0;
for (const f of files) {
  const ext = extname(f).toLowerCase() || basename(f).toLowerCase();
  if (!TEXT.has(ext)) continue;
  const src = readFileSync(f, "utf8");
  textBytes += Buffer.byteLength(src);
  for (const m of src.matchAll(/[\w@./-]+\.(?:jpg|jpeg|png|svg|webp|avif|gif|ico|woff2?|ttf|otf|mp3|mp4|webm|ogg)\b/gi)) {
    const hit = m[0].split("?")[0];
    mentioned.add(basename(hit));
    // The site's own absolute URLs are site paths. The regex cannot include
    // "https:" (the colon would swallow other things), so an absolute URL
    // arrives here as "//www.wainkw.com/og/x.jpg" — which starts with a slash
    // and looks exactly like a rooted path. Taken literally that reported all
    // 25 share cards as missing while every one of them was present.
    const site = hit.replace(/^\/\/[^/]+/, "");
    if (site.startsWith("/") && !site.startsWith("//")) referenced.add(site);
  }
}

const assets = files.filter((f) => ASSET.has(extname(f).toLowerCase()));
const assetBytes = assets.reduce((n, f) => n + statSync(f).size, 0);
const totalBytes = files.reduce((n, f) => n + statSync(f).size, 0);

console.log(`\nout/ ships ${files.length} files, ${kb(totalBytes)} — ${assets.length} assets (${kb(assetBytes)}), the rest text (${kb(textBytes)}).`);

// ---- 1. referenced but missing ---------------------------------------------
console.log("\n── referenced but not shipped ──");
const missing = [...referenced].filter((p) => !existsSync(join(OUT, decodeURIComponent(p))));
if (!missing.length) console.log(`  None. All ${referenced.size} rooted asset paths resolve.`);
else {
  missing.slice(0, 25).forEach((p) => say(`${p} is referenced but does not exist`));
  // Never let a cap read as "that was all of them".
  if (missing.length > 25) console.log(`  … and ${missing.length - 25} more, not listed.`);
}

// ---- 2. shipped but unreferenced -------------------------------------------
// Files nothing can reference by name, and why. Everything else that no text
// file mentions is dead weight a visitor downloads or a host stores for ever.
const UNREFERENCED_BY_DESIGN = new Map([
  [".htaccess", "read by Apache, never linked"],
  ["robots.txt", "fetched by crawlers at a fixed path"],
  ["sitemap.xml", "fetched by crawlers at a fixed path"],
  ["favicon.ico", "fetched by browsers at a fixed path"],
  ["manifest.webmanifest", "linked from the document head as a relative path"],
  // Deliberate, and documented in brand-source/README.md: the Kuwait composite
  // is kept at a stable public URL so it can be shared directly, even though no
  // page links to it. Listed here rather than silently ignored, because a
  // permanently-failing check is one people learn to stop reading.
  ["kuwait-mix.png", "kept fetchable on purpose — a shareable URL, linked from no page"],
]);
console.log("\n── shipped but nothing points at it ──");
const orphans = [];
for (const f of files) {
  const name = basename(f);
  const ext = extname(f).toLowerCase();
  if (UNREFERENCED_BY_DESIGN.has(name)) continue;
  // Text files are pages and payloads, reached by routing rather than by name.
  if (TEXT.has(ext) && ext !== ".md") continue;
  if (mentioned.has(name)) continue;
  orphans.push(f);
}
if (!orphans.length) console.log("  None — every shipped asset is pointed at by something.");
else {
  const wasted = orphans.reduce((n, f) => n + statSync(f).size, 0);
  console.log(`  ${orphans.length} file(s), ${kb(wasted)}, uploaded and served for nothing:`);
  for (const f of orphans.sort((a, b) => statSync(b).size - statSync(a).size)) {
    say(`${rel(f)}  ${kb(statSync(f).size)}`);
  }
}

// ---- 3. do the icons declare what they are? --------------------------------
console.log("\n── icons declare the size they actually are ──");
const manifestFile = join(OUT, "manifest.webmanifest");
if (!existsSync(manifestFile)) say("manifest.webmanifest is missing entirely");
else {
  const { chromium } = await import("playwright");
  const manifest = JSON.parse(readFileSync(manifestFile, "utf8"));
  const icons = manifest.icons ?? [];
  if (!icons.length) say("the manifest declares no icons — the app cannot be installed with one");
  // Read the real pixel dimensions rather than trusting the filename, which is
  // the whole point: a file called app-icon-512.png is not evidence of 512.
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium" });
  const page = await browser.newPage();
  for (const icon of icons) {
    const path = join(OUT, decodeURIComponent(icon.src.replace(/^\//, "")));
    if (!existsSync(path)) { say(`manifest icon ${icon.src} does not exist`); continue; }
    // image/svg, which is what the extension gives, is not a MIME type any
    // browser accepts — Chromium refused the file and this reported wain's
    // own icon as undecodable.
    const ext = extname(path).slice(1).toLowerCase();
    const mime = ext === "svg" ? "svg+xml" : ext === "jpg" ? "jpeg" : ext;
    const dataUri = `data:image/${mime};base64,${readFileSync(path).toString("base64")}`;
    const real = await page.evaluate(
      (src) => new Promise((res) => {
        const i = new Image();
        i.onload = () => res(`${i.naturalWidth}x${i.naturalHeight}`);
        i.onerror = () => res("unreadable");
        i.src = src;
      }),
      dataUri
    );
    const declared = icon.sizes ?? "(none declared)";
    if (real === "unreadable") say(`${icon.src} could not be decoded as an image`);
    // sizes:"any" is not a claim about pixels, it is the correct declaration
    // for a scalable icon — comparing it to the SVG's intrinsic 150×150 was
    // this check misreading a right answer as a wrong one.
    else if (declared === "any") console.log(`  ✓ ${icon.src}  scalable (sizes:any), intrinsic ${real}  ${kb(statSync(path).size)}`);
    else if (declared !== real) say(`${icon.src} declares ${declared} but is ${real}`);
    else console.log(`  ✓ ${icon.src}  ${real}  ${icon.purpose ?? "any"}  ${kb(statSync(path).size)}`);
  }
  await browser.close();
}

// ---- 4. the same bytes twice -----------------------------------------------
console.log("\n── the same file under two names ──");
const byHash = new Map();
for (const f of assets) {
  const h = createHash("sha256").update(readFileSync(f)).digest("hex");
  if (!byHash.has(h)) byHash.set(h, []);
  byHash.get(h).push(f);
}
const dupes = [...byHash.values()].filter((g) => g.length > 1);
if (!dupes.length) console.log("  None — every shipped asset is distinct.");
else for (const g of dupes) say(`identical: ${g.map(rel).join("  ==  ")}  (${kb(statSync(g[0]).size)} each)`);

// ---- what the weight is actually made of -----------------------------------
console.log("\n── where the weight goes ──");
const byExt = new Map();
for (const f of files) {
  const e = extname(f).toLowerCase() || "(none)";
  byExt.set(e, (byExt.get(e) ?? { n: 0, b: 0 }) && {
    n: (byExt.get(e)?.n ?? 0) + 1,
    b: (byExt.get(e)?.b ?? 0) + statSync(f).size,
  });
}
for (const [e, { n, b }] of [...byExt].sort((a, b2) => b2[1].b - a[1].b).slice(0, 8)) {
  console.log(`  ${e.padEnd(14)} ${String(n).padStart(3)} files  ${kb(b).padStart(7)}`);
}

console.log(
  problems
    ? `\n${problems} problem(s) with the shipped assets.`
    : "\nEvery shipped asset is referenced, present, correctly declared and unique."
);
process.exit(problems ? 1 : 0);
