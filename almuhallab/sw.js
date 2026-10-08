/* النوخذة service worker — precache the app shell, serve cache-first, refresh in background. */
"use strict";

var CACHE = "nokhatha-v53";   /* v53: the masthead drawn for the screen, bigger at the top; the footer mark striped by density */
/* The site root is not listed: "./" and "index.html" are the same 155 KB
   page, and every install fetched it twice. A request for the root is
   looked up as index.html below. logo.svg is not listed either: no page,
   manifest or structured data loads it, so every install fetched 13 KB for
   nothing. */
var ASSETS = [
  "index.html",
  "404.html",
  "nokhatha.html",
  "nokha1.html",
  "nizam.html",
  "safi.html",
  "xbrl.html",
  "delivery.html",
  /* the clean-URL stubs, at the address they are fetched by: without them a
     first offline visit to /nizam/#/safi fell back to the company page */
  "nokhatha/",
  "nizam/",
  "admin/",
  "safi/",
  "xbrl/",
  "delivery/",
  "manifest.webmanifest",
  "icon.svg",
  "favicon.svg",
  "fonts/cairo-400.woff2",
  "fonts/cairo-500.woff2",
  "fonts/cairo-700.woff2",
  "fonts/cairo-800.woff2",
  "fonts/cairo-latin.woff2",
  "icon-192.png",
  "icon-512.png",
  "icon-maskable-512.png",
  "apple-touch-icon.png",
  "nokhatha-touch-icon.png",
  "fonts/chakrapetch-600.woff2",
  "fonts/chakrapetch-700.woff2",
  "fonts/jetbrainsmono-latin.woff2",
];
/* Precached on its own, so a refusal cannot void the install: the live host
   puts admin.html behind Basic Auth (.htaccess), it answers 401 to every
   visitor who has not signed in, and addAll rejects the whole batch on one
   response that is not ok. The worker never installed and nothing worked
   offline, on the host only: every file is 200 on a test server. */
var OPTIONAL = ["admin.html"];

function fresh(u) {
  /* cache: "reload" goes past the browser's HTTP cache: images and fonts
     are served with a week's max-age, so a plain addAll stored a returning
     visitor's OLD favicon.svg under the new cache name */
  return new Request(u, { cache: "reload" });
}

/* Everything this worker stores, by full address. The origin is shared:
   public_html also serves salon-queue/, mcp-admin/ and landing folders, so a
   file that is not ours is passed through and never stored or served stale. */
var SCOPE = self.registration.scope;
var OWNED = ASSETS.concat(OPTIONAL).map(function (u) { return new URL(u, SCOPE).href; });
var HOME = new URL("index.html", SCOPE).href;

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(CACHE).then(function (cache) {
      return cache.addAll(ASSETS.map(fresh)).then(function () {
        return Promise.all(OPTIONAL.map(function (u) {
          return cache.add(fresh(u)).catch(function () {});
        }));
      });
    }).then(function () {
      return self.skipWaiting();
    })
  );
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      /* Cache Storage belongs to the origin, not to this worker's scope: only
         this app's own earlier versions are deleted, never another app's */
      return Promise.all(
        keys.filter(function (k) { return /^nokha\w*-v\d+$/.test(k) && k !== CACHE; })
          .map(function (k) { return caches.delete(k); })
      );
    }).then(function () {
      return self.clients.claim();
    })
  );
});

self.addEventListener("fetch", function (event) {
  var req = event.request;
  if (req.method !== "GET") return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  /* One entry per file, at its address without the query: lookups ignore the
     query, so each ?fbclid= or ?igsh= visit stored a full copy of the page
     that was never served. The site root is index.html, not a second copy. */
  var key = url.origin + url.pathname;
  if (key === SCOPE) key = HOME;
  var owned = OWNED.indexOf(key) >= 0;

  // Stale-while-revalidate: serve the cache immediately, refresh it in the
  // background. The refresh is held open with waitUntil, or the browser may
  // stop the worker before the new copy is stored.
  var saved = null;
  var network = fetch(req).then(function (res) {
    if (res && res.ok && owned) {
      var copy = res.clone();
      saved = caches.open(CACHE).then(function (cache) { return cache.put(key, copy); });
    }
    return res;
  });
  event.waitUntil(network.then(function () { return saved; }, function () {}));

  event.respondWith(
    caches.match(owned ? key : req, { ignoreSearch: true }).then(function (cached) {
      return cached || network.catch(function () {
        // Offline and uncached: fall back to the app shell for page navigations.
        // A product address falls back to its own stub (which keeps the
        // fragment's tab), never to the company brochure.
        if (req.mode === "navigate") {
          var m = /\/(nokhatha|nizam|admin|safi|xbrl|delivery)\/?$/.exec(url.pathname);
          return (m ? caches.match(m[1] + "/") : Promise.resolve(null)).then(function (hit) {
            return hit || caches.match("index.html");
          });
        }
        return cached;
      });
    })
  );
});
