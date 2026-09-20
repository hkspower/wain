#!/usr/bin/env node
/**
 * Generates out/sw.js — the service worker that makes وين behave like an
 * installed app rather than a page that needs a connection.
 *
 * The precache list is built from the actual build output, so it always
 * matches the content-hashed filenames Next just emitted. The list is hashed
 * into CACHE_VERSION, so a build that changes nothing produces a byte-identical
 * worker (no pointless update churn) while any real change rotates the cache.
 *
 * Runs after `next build`; see package.json.
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync, writeFileSync, existsSync } from "node:fs";
import { join, relative } from "node:path";

const OUT = "out";
if (!existsSync(OUT)) {
  console.error("gen-sw: out/ not found — run the build first.");
  process.exit(1);
}

const files = [];
(function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full);
    else files.push("/" + relative(OUT, full).split("\\").join("/"));
  }
})(OUT);

/**
 * Which place pages are worth paying for up front.
 *
 * Precaching every place page made the install cost grow with the catalogue:
 * at seventeen places it was already most of the payload, and each new place
 * charged every visitor for a page almost none of them would open. That is
 * the wrong thing to scale — the site is meant to grow.
 *
 * The featured places are the ones the home page puts in front of a first-time
 * visitor, so they are the pages most likely to be opened, and they stay a
 * fixed handful however large the catalogue gets. Everything else is cached
 * the moment it is actually visited: the navigation handler below is
 * network-first and writes each successful response into the same cache, so a
 * place a visitor has opened is available offline afterwards regardless.
 */
const featured = new Set(
  [...readFileSync("src/lib/places.ts", "utf8").matchAll(/slug: "([a-z0-9-]+)"[\s\S]*?(?=\n {2}\{|\n\];)/g)]
    .filter((m) => m[0].includes("featured: true"))
    .map((m) => m[1])
);
if (featured.size === 0) {
  console.error("gen-sw: found no featured places — refusing to ship a shell with no place pages.");
  process.exit(1);
}

/**
 * Every hashed script and stylesheet that some page's HTML actually asks for.
 *
 * Anything under `_next/static/` that is NOT in here is reached by a runtime
 * `import()` and by nothing else — today that is Leaflet and its stylesheet,
 * ~45K gzipped, fetched only when a visitor taps «حرّك الخريطة».
 *
 * Precaching those undid the whole point. `audit:js` reads page HTML, so a
 * chunk no page references is invisible to it, and it was invisible here too:
 * the filter below said `startsWith("/_next/static/")` and swept up everything
 * in the build. The result was 45K downloaded by every visitor at install
 * time, for a map most of them never move — the cost carefully kept off the
 * route, put back by the offline layer, with only «80 files precached» in the
 * build log to show for it.
 *
 * Excluding them cannot break an offline page: by construction no precached
 * HTML references them. And it costs nothing online — `_next/static/` is
 * cache-first with a runtime put below, so whoever does tap pays once.
 * Offline the import fails and the map says so, which is honest either way:
 * there are no tiles offline to draw.
 *
 * Fonts and images under `_next/static/media/` are referenced from CSS rather
 * than HTML, so the rule is scoped to `.js` and `.css` and leaves them alone.
 */
const referenced = new Set();
for (const f of files) {
  if (!f.endsWith(".html")) continue;
  const html = readFileSync(join(OUT, f), "utf8");
  for (const m of html.matchAll(/\/?_next\/static\/[^"'()\\\s]+?\.(?:js|css)/g)) {
    // Two spellings have to be normalised or real chunks look unreferenced,
    // and the failure is silent — a dropped file is simply absent from an
    // offline cache nobody tests offline. The leading slash is optional in
    // the markup. And the route chunk for the fifty-two place pages is URL
    // encoded on the page (`app/places/%5Bslug%5D/page-….js`) while the file
    // on disk keeps its brackets, so an undecoded compare drops the one
    // chunk every place page needs — caught only because the count fell by
    // more than the files this rule was written to exclude.
    const path = decodeURIComponent(m[0].startsWith("/") ? m[0] : `/${m[0]}`);
    referenced.add(path);
  }
}

// Precache the shell: every non-place route's HTML plus the hashed JS/CSS/
// fonts they need. Skip things that are large, rarely needed offline, or would
// go stale badly (share image, brand source art, voice clips — those stream on
// demand and fall back to the browser voice).
const PRECACHE = files.filter((f) => {
  if (f === "/sw.js" || f.endsWith(".htaccess")) return false;
  if (f.startsWith("/brand/") || f.startsWith("/voice/")) return false;
  if (f === "/og.jpg") return false;
  if (f.startsWith("/og/")) return false;
  if (f.endsWith(".txt") || f.endsWith(".xml")) return false;
  if (/^\/_next\/static\/.+\.(js|css)$/.test(f) && !referenced.has(f)) return false;

  const place = f.match(/^\/places\/([a-z0-9-]+)\/index\.html$/);
  if (place) return featured.has(place[1]);

  return (
    f.endsWith(".html") ||
    f.startsWith("/_next/static/") ||
    f === "/manifest.webmanifest" ||
    f === "/icon.svg" ||
    f === "/apple-icon.png"
  );
});

const version = createHash("sha256").update(PRECACHE.join("\n")).digest("hex").slice(0, 12);

const sw = `/* Generated by scripts/gen-sw.mjs — do not edit by hand. */
const VERSION = ${JSON.stringify(version)};
const CACHE = "wain-" + VERSION;
const PRECACHE = ${JSON.stringify(PRECACHE, null, 0)};
const OFFLINE_SHELL = "/index.html";

/**
 * A static export stores pages as .../index.html, but a navigation asks for
 * the directory URL — "/explore/", never "/explore/index.html". Those are
 * different cache keys, so offline lookups miss unless the path is mapped
 * back to the file that was precached.
 */
function htmlKey(pathname) {
  if (pathname.endsWith(".html")) return pathname;
  return pathname.endsWith("/") ? pathname + "index.html" : pathname + "/index.html";
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      // Add individually: one missing file must not fail the whole install.
      await Promise.all(
        PRECACHE.map((url) =>
          cache.add(new Request(url, { cache: "reload" })).catch(() => {})
        )
      );
      await self.skipWaiting();
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
      await self.clients.claim();
    })()
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  // Leave other origins alone: map tiles and the ElevenLabs widget must not be
  // cached or rewritten by us.
  if (url.origin !== self.location.origin) return;

  // Navigations: network first so a deploy is picked up, cache as the safety
  // net, and the home shell as the last resort so the app always opens.
  if (req.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(req);
          const cache = await caches.open(CACHE);
          cache.put(req, fresh.clone()).catch(() => {});
          return fresh;
        } catch {
          return (
            (await caches.match(req)) ||
            (await caches.match(htmlKey(url.pathname))) ||
            (await caches.match(OFFLINE_SHELL)) ||
            Response.error()
          );
        }
      })()
    );
    return;
  }

  // Content-hashed build output can never change under a given name.
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(
      (async () => {
        const hit = await caches.match(req);
        if (hit) return hit;
        const fresh = await fetch(req);
        const cache = await caches.open(CACHE);
        cache.put(req, fresh.clone()).catch(() => {});
        return fresh;
      })()
    );
    return;
  }

  // Everything else same-origin: serve cache immediately, refresh behind it.
  event.respondWith(
    (async () => {
      // A directory URL fetched as a subresource (router prefetch, a manual
      // fetch of "/explore/") needs the same index.html mapping navigations
      // get — without it these miss the precache and fail offline.
      const hit =
        (await caches.match(req)) ||
        (url.pathname.endsWith("/") ? await caches.match(htmlKey(url.pathname)) : null);
      const network = fetch(req)
        .then((res) => {
          if (res && res.ok) {
            caches.open(CACHE).then((c) => c.put(req, res.clone()).catch(() => {}));
          }
          return res;
        })
        .catch(() => null);
      return hit || (await network) || Response.error();
    })()
  );
});
`;

writeFileSync(join(OUT, "sw.js"), sw);
console.log(`gen-sw: ${PRECACHE.length} files precached, version ${version} ✓`);
