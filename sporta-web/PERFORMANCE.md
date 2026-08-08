# Performance — Sporta web

This describes **the live site**. `sporta-web` is what runs at
www.sporta.com.kw; there is no other project to apply these to. (An earlier
version of this file read as though this app were a demo and the real shop
lived somewhere else. It did not, and saying so sent people to the wrong
codebase.)

Numbers below are measured, not estimated. Re-measure rather than trust them if
the catalogue or the dependencies have moved.

## What the build does

### 1. Route-level code splitting (`src/App.jsx`)
Twelve routes are `React.lazy()` imports behind `<Suspense>` — Shop, product,
cart, checkout, payment result, about, contact, wishlist, track, invoice, 404
and the entire admin. A first-time visitor to the home page never downloads
checkout or admin code.

The admin is the one that matters: `AdminApp` is **101.8 kB raw / 21.9 kB
brotli** of screens no shopper ever opens. It is also excluded from route
prefetching on purpose (`src/lib/prefetchRoute.js`).

### 2. Vendor chunk isolation (`vite.config.js`)
React, React-DOM and React-Router go into a stable `react-vendor` chunk, so a
content deploy does not make returning visitors re-download the framework.

### 3. Modern build target
`target: 'es2022'` — no legacy transpilation for browsers that the payment
gateways already require anyway.

### 4. Compression + cache tiers (`public/.htaccess`)
Brotli and gzip on every text type including `application/json`; a year of
`immutable` on content-hashed assets; `no-cache` on the HTML so a deploy is
visible immediately; security headers. `npm run audit:storage` asserts the tiers
against a real Apache.

## Measured build output

| | raw | brotli |
|---|---|---|
| `react-vendor.js` | 208.3 kB | 62.3 kB |
| `index.js` (entry) | 129.9 kB | 37.7 kB |
| `AdminApp.js` (never on the shopper path) | 101.8 kB | 21.9 kB |
| `Checkout.js` | 21.8 kB | 6.1 kB |
| CSS | — | 13.6 kB |
| **all JS, 23 files** | **539.6 kB** | **157.2 kB** |

**First paint needs ~114 kB brotli**: entry + react-vendor + runtime + CSS.
Warm build takes ~1.2 s.

## The scaling limit, when it comes

Measured against a synthetic 3,726-product / 22,122-variant catalogue: query
time is not the problem (28 ms and 46 ms), the payload is. At ~4,000 distinct
products `?r=products` is roughly **150 kB brotli per request**, and
`api/.htaccess` sets `Cache-Control: no-store` across the whole directory — so
the catalogue is re-fetched on every page load and the browser is forbidden from
reusing it.

`no-store` is right for `status`, `invoice` and `order`. It is inherited by
`products`, `slides`, `brands` and `stock`, which are byte-identical for every
visitor. Splitting that is the highest-value change left, and it is not a
one-liner: `Header set` in `.htaccess` overrides whatever PHP sends.

Two things that look like fixes and are not, both measured:
- **An index on `products(active)`** — the optimiser ignores it (~85% of rows
  are active, so a scan wins). Timings were identical with and without.
- **Batching the per-line lookup in `store_price_lines`** — it costs 0.37 ms per
  cart line against a hard cap of 50, and it sits in the server-side price
  authority, which is the worst place in the shop to add complexity.

## Further wins (when there is real content)
- Real product photography in WebP/AVIF with width/height set.
- `loading="lazy"` on offscreen images.

---

## Core Web Vitals, measured on a phone

`npm run test:perf` ends with a section that emulates a mid-range Android on a
Kuwaiti mobile connection — 4× CPU throttle, 1.6 Mbps, 150 ms RTT — because a
fast desktop is the wrong instrument for the metrics Google ranks on. Two real
defects were found that way and both are now guarded:

| | before | after |
|---|---|---|
| First Contentful Paint | 3376 ms | ~430 ms |
| Cumulative Layout Shift | 0.0424 | 0.0001 |
| Largest Contentful Paint | 3452 ms | ~2000 ms |

**FCP.** The site is a single-page app: nothing appeared until 340 kB of
JavaScript had been fetched, parsed and executed, and the 77 kB stylesheet
blocked even a static shell from painting. `index.html` now carries a shell —
the header bar, the real logo, and a hero box at its real height — styled by a
handful of rules inlined in the `<head>`, and a Vite plugin turns the stylesheet
into a `preload` that promotes itself on arrival. There is no flash of unstyled
content to trade against: nothing but the shell renders before the app's
JavaScript, and the CSS is a quarter of its size.

**CLS.** The hero's height is an owner setting delivered by `/api?r=slides`,
which lands after the paint. Applying it on arrival grew the hero and pushed the
page down — one 0.042 jump at 3.3 s, the largest single shift on the site. The
boot script now reads the last known size from `localStorage` and writes
`--hero-h` before anything renders; a change takes effect on the next load.

**LCP** is bounded by when React mounts, so it is printed rather than enforced —
a timing assertion that flakes is one people learn to skip. Moving it further
would mean server-side rendering, which is a different architecture, not a
tuning change.
