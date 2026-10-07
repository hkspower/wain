/* النوخذة service worker — precache the app shell, serve cache-first, refresh in background. */
"use strict";

var CACHE = "nokhatha-v46";   /* v46: النوخذة layout pass: one column, task-first dashboard, even forms */
var ASSETS = [
  "./",
  "index.html",
  "404.html",
  "nokhatha.html",
  "nokha1.html",
  "nizam.html",
  "safi.html",
  "xbrl.html",
  "delivery.html",
  "admin.html",
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
  "logo.svg",
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

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(CACHE).then(function (cache) {
      /* cache: "reload" goes past the browser's HTTP cache: images and fonts
         are served with a week's max-age, so a plain addAll stored a returning
         visitor's OLD favicon.svg and logo.svg under the new cache name */
      return cache.addAll(ASSETS.map(function (u) { return new Request(u, { cache: "reload" }); }));
    }).then(function () {
      return self.skipWaiting();
    })
  );
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(
        keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); })
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

  event.respondWith(
    caches.match(req, { ignoreSearch: true }).then(function (cached) {
      // Stale-while-revalidate: serve the cache immediately, refresh it in the background.
      var refresh = fetch(req).then(function (res) {
        if (res && res.ok) {
          var copy = res.clone();
          caches.open(CACHE).then(function (cache) { cache.put(req, copy); });
        }
        return res;
      }).catch(function () {
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
      return cached || refresh;
    })
  );
});
