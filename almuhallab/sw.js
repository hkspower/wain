/* Nokha1 service worker — precache the app shell, serve cache-first, refresh in background. */
"use strict";

var CACHE = "nokha1-v6";
var ASSETS = [
  "./",
  "index.html",
  "nokha1.html",
  "nizam.html",
  "safi.html",
  "xbrl.html",
  "delivery.html",
  "editor.html",
  "admin.html",
  "manifest.webmanifest",
  "icon.svg",
  "fonts/plex-arabic-400.woff2",
  "fonts/plex-arabic-600.woff2",
  "fonts/plex-arabic-700.woff2"
];

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(CACHE).then(function (cache) {
      return cache.addAll(ASSETS);
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
        if (req.mode === "navigate") return caches.match("index.html");
        return cached;
      });
      return cached || refresh;
    })
  );
});
