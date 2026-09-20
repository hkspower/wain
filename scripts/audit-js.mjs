#!/usr/bin/env node
/**
 * What JavaScript actually reaches a phone.   npm run audit:js
 *
 * `npm run lint` checks the source. This checks the build — a different
 * question, and the one a visitor on a Kuwaiti mobile connection pays for.
 * Weight is measured gzipped, per route, from the chunks each page's HTML
 * really references, because the number on disk and the number over the wire
 * are not close: the polyfill chunk alone is 110KB on disk and 0 bytes to any
 * browser made this decade.
 *
 * The checks are ordered by how quietly each one fails.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "out");
const CHUNKS = join(OUT, "_next/static/chunks");

if (!existsSync(OUT)) {
  console.log("audit-js: no out/ — run `npm run build` first");
  process.exit(0);
}

const errors = [];
const warnings = [];
const err = (m) => errors.push(m);
const warn = (m) => warnings.push(m);
const kb = (n) => `${(n / 1024).toFixed(1)}K`;

/** Every page in the export, and the chunks its HTML asks for. */
function pages(dir = OUT, acc = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) pages(p, acc);
    else if (e.name === "index.html") acc.push(p);
  }
  return acc;
}
const gzCache = new Map();
const gzOf = (rel) => {
  if (!gzCache.has(rel)) {
    const p = join(OUT, rel);
    gzCache.set(rel, existsSync(p) ? gzipSync(readFileSync(p), { level: 9 }).length : 0);
  }
  return gzCache.get(rel);
};

const routes = pages().map((p) => {
  const html = readFileSync(p, "utf8");
  const chunks = [...new Set(html.match(/_next\/static\/chunks\/[^"']+?\.js/g) ?? [])];
  // A nomodule script is never fetched by a browser that supports modules,
  // which is every browser this site targets. Counting it would overstate the
  // payload by ~38K and hide real regressions underneath it.
  const modern = chunks.filter((c) => {
    const tag = html.match(new RegExp(`<script[^>]*${basename(c).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[^>]*>`, "i"));
    return !(tag && /nomodule/i.test(tag[0]));
  });
  return {
    route: p.slice(OUT.length, -"index.html".length) || "/",
    chunks: modern,
    gz: modern.reduce((a, c) => a + gzOf(c), 0),
  };
});

/* ── 1. Source maps must not ship ─────────────────────────────────────────
   A map hands over the original TypeScript, comments and all. */
const maps = [];
(function findMaps(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) findMaps(p);
    else if (e.name.endsWith(".map")) maps.push(p.slice(OUT.length + 1));
  }
})(OUT);
if (maps.length) err(`${maps.length} source map(s) shipped: ${maps.slice(0, 3).join(", ")}`);

const withRef = readdirSync(CHUNKS)
  .filter((f) => f.endsWith(".js"))
  .filter((f) => /sourceMappingURL/.test(readFileSync(join(CHUNKS, f), "utf8")));
if (withRef.length) err(`${withRef.length} chunk(s) carry a sourceMappingURL`);

/* ── 2. Nothing unreachable should be deployed ────────────────────────── */
const all = readdirSync(CHUNKS).filter((f) => f.endsWith(".js"));
const corpus = [];
(function read(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) read(p);
    else if (/\.(html|js|txt|json)$/.test(e.name)) corpus.push([p, readFileSync(p, "utf8")]);
  }
})(OUT);
for (const f of all) {
  const id = f.split(/[.-]/)[0];
  const referenced = corpus.some(
    ([p, t]) => p !== join(CHUNKS, f) && (t.includes(f) || new RegExp(`\\b${id}\\b`).test(t))
  );
  if (!referenced) warn(`${f} (${kb(statSync(join(CHUNKS, f)).size)}) is referenced by nothing`);
}

/* ── 3. Per-route weight, against a budget ────────────────────────────────
   The budget is a ratchet, not a target: it sits just above where the site
   is today so that a regression is loud and a reduction is free. */
const BUDGET_KB = 175;
routes.sort((a, b) => b.gz - a.gz);
for (const r of routes) {
  if (r.gz / 1024 > BUDGET_KB) err(`${r.route} ships ${kb(r.gz)} of JS, over the ${BUDGET_KB}K budget`);
}

/* ── 4. What every page pays regardless ───────────────────────────────────
   The shared floor is the number that matters most: it is paid by the
   privacy page and the About page, which have nothing to run. */
const shared = routes
  .map((r) => new Set(r.chunks))
  .reduce((a, b) => new Set([...a].filter((x) => b.has(x))));
const sharedGz = [...shared].reduce((a, c) => a + gzOf(c), 0);

/* ── 5. Does a page with no places ship the place catalogue? ──────────────
   This is the check that found something, and the first diagnosis was wrong.
   It blamed WainAi, which is a static import in the root layout — but WainAi
   imports no places at all. The real path was four edges long and ran through
   a module nobody would look at:

     layout → Footer/AppTabBar → OrdersLink → orders/queue → supabase → places

   (The footer has since been removed; OrdersLink now hangs off the Navbar,
   and the same edge would put the catalogue on every page from there.)

   `supabase.ts` imported two clamp helpers from the catalogue's module, and
   that one edge put all 36 records on all 46 pages. Splitting the vocabulary
   into `place-kit.ts` and repointing the four consumers took the shared floor
   from 130.9K to 122.5K gzipped.

   Guessing which import is responsible is exactly the mistake this check
   exists to prevent — measure, then trace the graph. */
const STATIC_ROUTES = ["/privacy/", "/about/"];
const placeNames = [...readFileSync(join(ROOT, "src/lib/places.ts"), "utf8")
  .matchAll(/nameAr:\s*"([^"]+)"/g)].map((m) => m[1]);
for (const route of STATIC_ROUTES) {
  const r = routes.find((x) => x.route === route);
  if (!r) continue;
  const text = r.chunks
    .map((c) => (existsSync(join(OUT, c)) ? readFileSync(join(OUT, c), "utf8") : ""))
    .join("");
  const found = placeNames.filter((n) => text.includes(n));
  if (found.length > placeNames.length / 2)
    warn(
      `${route} carries ${found.length}/${placeNames.length} place records — it has no map and no list. ` +
        `Trace the VALUE-import graph out of app/layout.tsx: a type-only import is erased, a value ` +
        `import is not, and the edge that does it is usually several modules deep.`
    );
}

/* ── 6. Our own console statements ────────────────────────────────────────
   The linter bans console in src/**, so anything here came from a dependency
   — but a stray one of ours would be worth knowing about. */
const ourStrings = ["wain:", "شوق", "الطلعة"];
let ourConsole = 0;
for (const f of all) {
  const t = readFileSync(join(CHUNKS, f), "utf8");
  for (const m of t.matchAll(/console\.(log|debug)\(/g)) {
    const around = t.slice(Math.max(0, m.index - 300), m.index + 300);
    if (ourStrings.some((s) => around.includes(s))) ourConsole++;
  }
}
if (ourConsole) warn(`${ourConsole} console.log/debug call(s) sit next to our own strings`);

/* ── 7. Weight nothing asks for up front, and nothing here could see ──────
   Everything above measures a route by the chunks its HTML references. A
   chunk reached only by a runtime `import()` appears in no HTML, so it is
   invisible to every check above it — and the biggest thing in this build is
   exactly that: Leaflet, behind «حرّك الخريطة», deliberately kept off a
   /search route with about 15K of room under the budget.

   Invisible is fine as long as it stays on demand, and it did not. The
   service worker's precache was «everything under _next/static/», so the
   45K carefully kept off the route was downloaded by every visitor at
   install time anyway, with «80 files precached» in the build log as the
   only trace. The weight was not on the route and was not in this audit and
   was still being paid.

   So both halves are asserted: what the on-demand set weighs, and that the
   offline layer is not quietly handing it out. */
const staticFiles = [];
(function walkStatic(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walkStatic(p);
    else staticFiles.push(p.slice(OUT.length));
  }
})(join(OUT, "_next/static"));

const referencedByHtml = new Set();
for (const [p, t] of corpus) {
  if (!p.endsWith(".html")) continue;
  // Same two normalisations gen-sw.mjs needs, and for the same reason: the
  // leading slash is optional in the markup, and the place pages' shared
  // route chunk is URL encoded there (`%5Bslug%5D`) while the file on disk
  // keeps its brackets. Skip either and a chunk 52 pages use reads as dead.
  for (const m of t.matchAll(/\/?_next\/static\/[^"'()\\\s]+?\.(?:js|css)/g)) {
    referencedByHtml.add(decodeURIComponent(m[0].startsWith("/") ? m[0] : `/${m[0]}`));
  }
}

const onDemand = staticFiles.filter((f) => /\.(js|css)$/.test(f) && !referencedByHtml.has(f));
const onDemandGz = onDemand.reduce((a, f) => a + gzOf(f.slice(1)), 0);

/* A ratchet like the route budget: just above where the build sits, so an
   accidental eager import is loud and a reduction is free. */
const ON_DEMAND_BUDGET_KB = 260;
if (onDemandGz / 1024 > ON_DEMAND_BUDGET_KB)
  err(`${kb(onDemandGz)} is loaded on demand, over the ${ON_DEMAND_BUDGET_KB}K ceiling`);

/* The map specifically, because it is the part a visitor waits for after a
   tap. Found by content rather than by filename: the chunk name is a content
   hash and changes on every edit to it. */
const MAP_BUDGET_KB = 60;
const mapChunks = onDemand.filter((f) => {
  const p = join(OUT, f.slice(1));
  return existsSync(p) && /leaflet/i.test(readFileSync(p, "utf8").slice(0, 4000));
});
const mapGz = mapChunks.reduce((a, f) => a + gzOf(f.slice(1)), 0);
if (mapChunks.length && mapGz / 1024 > MAP_BUDGET_KB)
  err(`the live map costs ${kb(mapGz)} on tap, over the ${MAP_BUDGET_KB}K ceiling`);

/* The regression this section exists for. A file in both sets is on demand
   in name only. */
if (existsSync(join(OUT, "sw.js"))) {
  const sw = readFileSync(join(OUT, "sw.js"), "utf8");
  const precached = onDemand.filter((f) => sw.includes(`"${f}"`));
  if (precached.length)
    err(
      `${precached.length} on-demand file(s) are in the service worker precache, so every visitor ` +
        `downloads them anyway: ${precached.slice(0, 3).join(", ")}`
    );
}

/* ── report ───────────────────────────────────────────────────────────── */
// `all` is the top level of chunks/ only; the app/ subtree is route chunks,
// which are referenced by their own page by construction.
console.log(`audit-js: ${routes.length} routes, ${all.length} shared chunks\n`);
console.log(`  every page pays ${kb(sharedGz)} gzipped in ${shared.size} shared chunks`);
console.log(`  lightest ${routes.at(-1).route} ${kb(routes.at(-1).gz)}   heaviest ${routes[0].route} ${kb(routes[0].gz)}   budget ${BUDGET_KB}K\n`);
const show = routes.filter((r) => !r.route.startsWith("/places/") || r.route === "/places/kuwait-towers/");
for (const r of show.slice(0, 12)) console.log(`  ${kb(r.gz).padStart(7)}  ${r.route}`);
console.log(
  `\n  on demand, in no page's HTML: ${kb(onDemandGz)} in ${onDemand.length} files` +
    (mapChunks.length ? `  — the live map is ${kb(mapGz)} of it` : "") +
    `\n  none of it precached, so it is paid only by whoever asks for it`
);
if (!maps.length && !withRef.length) console.log(`\n  ✓ no source maps, no sourceMappingURL`);

if (warnings.length) { console.log(""); for (const w of warnings) console.log(`  ⚠ ${w}`); }
if (errors.length) { console.log(""); for (const e of errors) console.log(`  ✗ ${e}`); }
console.log(
  `\n${errors.length} error${errors.length === 1 ? "" : "s"}, ` +
    `${warnings.length} warning${warnings.length === 1 ? "" : "s"}`
);
process.exit(errors.length ? 1 : 0);
