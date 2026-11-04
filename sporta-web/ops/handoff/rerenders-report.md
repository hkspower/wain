# R1: React re-renders (read-only check), 2026-11-04

**Owner request:** "check re renders". Scope: the live compiled storefront (on the local mirror), this repo's storefront (`src/`), this repo's admin (`src/admin`). Nothing in the repo was changed; every fix is a patch file proven on a scratch copy.

## 0. Verdict

* **Re-render waste is real, concentrated in about ten places, and cheap in milliseconds today but linear in data.** In a scripted 16-step purchase (load shop, scroll, heart, filter, show more, open product, size / qty / add, open bag, qty, checkout, three fields of 20 keystrokes) the repo build renders **3,635-4,034 component fibers; 35-49% of them disappear with patches 01-06 (3,794 -> 2,485 at ar/390, 3,782 -> 2,169 at en/1280)** and 30-35% of the DOM mutation records go with them. One heart tap on a 36-card shop grid is **296-366 fibers on the repo build and 295-323 on the live bundle**, 29 after the patch, and **968 with 108 cards on screen**. Single actions cost 1-4 ms of render phase on this machine (median of 15), so no shopper sees jank from it on today's 46-product catalogue; the point is the slope.
* **Idle is quiet where it can be checked.** Repo build: **0 commits in 10 s** on all four pages. Live bundle: **10-11 commits per 10 s, all one fiber: the header clock re-renders once a second on every page** (the add-on's CSS animation paints over what it writes). Needs a storefront rebuild; no add-on fix that is not a hack.
* **No React-versus-add-on fight.** Across 16 idle windows and ~45 interactions per combination, the live add-ons wrote to the DOM only on load, route change and language toggle (finite bursts of 2-50 calls), never at idle, never while typing, tapping or filtering. Maximum commit rate at idle: 1 per second, all React's own clock.
* **Re-rendering is also causing three behaviour bugs**, not just waste: (1) **on the live bundle and the repo, the bag drawer moves focus to its Close button on every quantity change** (the dialog effect depends on a fresh `onClose`; a keyboard user pressing Enter twice on "+" closes the bag instead of adding two); (2) the repo's product page **resets the photo gallery to photo 1 whenever a size, fit or quantity is picked** and rewrites ~20 `<head>` tags on each click (the live product page does neither); (3) the repo's single `Suspense` above the page **hides the header and footer behind the skeleton on the first visit to each un-prefetched route**.
* **Admin:** typing in the Orders search re-renders 100 rows twice per key (**8,866 fibers per 20 keys -> 60**); on Inventory one stock save re-renders every row 7 times (**56,093 -> 46 fibers at 4,000 variants**) and the 15 s poll re-renders everything with identical data (**8,014 -> 14**); the Catalogue tab renders every product unpaged (about 30 s of render phase at 4,000 products on this machine).
* **8 patches, none applied** (`rcw/R1-rerenders/patches/`): they apply cleanly in sequence to the snapshot and individually to the working tree at HEAD `e255012e`; counter self-test PASS; 19 of 19 behaviour assertions pass on both builds; `test:perf` deterministic budgets unchanged; bundle cost +1.1 kB raw / +0.35 kB gzip on the main chunk.
* **Only live can confirm:** real-photo `onLoad` state, real network ordering, the live admin (compiled, behind sign-in), and phone-class timings (this machine ran at load average 45-55 on 4 CPUs).


## 1. What was measured, and how

**Three surfaces.**

| | what | how it was run |
|---|---|---|
| (a) live storefront | the captured live compiled bundle (`index-BtzlNXGI.js` + `react-vendor`, React 19.2.8, minified) with the 9 live add-ons, on the local mirror (`scan-words/live`, API answered from the captured JSON) | own static server, own Chromium |
| (b) repo storefront | `sporta-web/src` built with the repo's own Vite config **in production mode, not minified** (component names survive), `react-dom/client` aliased to `react-dom/profiling` so the root fiber carries `actualDuration`. Snapshot of `src/` taken 2026-11-04 04:4x UTC | scratch `outDir`, own static server, API answered from the captured live JSON |
| (c) repo admin | `src/admin` (same build) against a mock of `/api/admin.php` (100 orders, 120 variants, 46 products, 47 profiles; made-up names) | own server; no MariaDB or PHP was needed, so none was started |

**Counting.** A fake React DevTools hook (`scripts/hook.js`, installed with `addInitScript` before the bundle) receives every commit. It walks the committed tree the way DevTools does (it descends only where `fiber.child !== alternate.child`) and counts every function / class / forwardRef / simple-memo fiber that carries React's own `PerformedWork` flag. Each one is classified by why it rendered:

* **state**: a `useState/useReducer/useSyncExternalStore` hook holds a new value
* **context**: a context it reads has a new value
* **props**: a prop differs (`Object.is`) and it is not just a fresh closure or object
* **avoidable** = *wasted* (props shallow-equal; `React.memo` alone would have skipped it) + *fresh identity* (only functions with identical source or deep-equal objects changed; `useCallback/useMemo` + memo fixes it)
* **jsx** = rendered only because the parent rebuilt `children`/JSX elements (memo cannot help; moving state down can)

Also per window: DOM mutation records (`MutationObserver`), who wrote the DOM (a stack-attributed wrapper on `setAttribute/appendChild/...`: `react-vendor`, `index`, or a named add-on), main-thread `TaskDuration/ScriptDuration` (CDP `Performance.getMetrics`) and, on the repo build only, the render-phase `actualDuration`.

**Mangled names.** The live bundle is minified, so its components are labelled `name#hash[distinctive string literals]` and identified by reading the pretty-printed bundle (`apicheck/A1-client-calls/pretty`). Identified: `ke` = header clock, `en` = ProductCard, `Ce` = size/fit chip, `de` = area combobox, `M` = Checkout, `F` = Field, `ge` = Coupon, `i` = CheckoutSteps, `zt` = Navbar, `Bt` = promo bar, `u` = AI panel, `f` = Mic, `z` = the svg icon wrapper, `?#9kf67` = react-router `Link`. The repo build keeps real names.

**Matrix.** Repo build: before and after, all four language/width combinations. Live bundle: ar/390, en/390 and ar/1280 were re-run with the quiet-wait below; en/1280 is the first pass (same scripts, without the quiet-wait, so its async tails are slightly noisier; all raw first-pass files are in `data/pass1/`). **"load" rows depend on how much of the page's async tail (stock table, promo bar, slides) had landed inside a 3 s window on a loaded machine** (e.g. live product load is 220 fibers in one run and 360 in another): read them as ranges, and read the interaction rows as the result.

**Before every interaction** the page is allowed to go quiet (no commit for 700 ms) so an interaction is not charged for the previous one's async tail. Each window then ends 400-1200 ms after the action so the follow-up fetch/commit is counted. Languages: Arabic (default, RTL) and English (`?lang=en`); widths 390x844 and 1280x900; Playwright Chromium 1243, one browser and one page at a time.

**Caveats that matter when reading the milliseconds.** The machine was running at load average 45-55 on 4 CPUs while this ran (other lanes), so absolute times are inflated several-fold and noisy; **counts are the result, milliseconds are indicative only** (`prof` is render-phase time of the whole window). Prod React does not double-render, so numbers are what a visitor's browser does. `StrictMode` doubles render calls in development only.


## 2. Tables

### A. Live compiled bundle (mirror), BEFORE

Cell = commits / rendered function-component fibers / avoidable by React.memo or stable props (wasted + fresh-identity) / wasted only because the parent rebuilt `children` (JSX). Idle and interaction windows include the async tail of the action (400-1200 ms). The live header clock re-renders once a second; its renders and commits are subtracted here (`clock` column in the JSON) so an interaction is not charged for them.

| interaction | ar 390 | en 390 | ar 1280 | en 1280 |
|---|---|---|---|---|
| load home | 1 / 173 / 2 / 4 | 0 / 321 / 69 / 64 | 0 / 353 / 79 / 78 | 5 / 385 / 80 / 82 |
| idle 10s home | 0 / 0 / 0 / 0 | 0 / 0 / 0 / 0 | 0 / 0 / 0 / 0 | 0 / 0 / 0 / 0 |
| load shop | 2 / 310 / 56 / 74 | 4 / 443 / 101 / 142 | 2 / 163 / 0 / 0 | 4 / 479 / 112 / 162 |
| idle 10s shop | 0 / 0 / 0 / 0 | 0 / 0 / 0 / 0 | 0 / 0 / 0 / 0 | 0 / 0 / 0 / 0 |
| load product | 2 / 220 / 32 / 28 | 2 / 220 / 32 / 28 | 2 / 11 / 0 / 0 | 3 / 360 / 110 / 79 |
| idle 10s product | 0 / 0 / 0 / 0 | 0 / 0 / 0 / 0 | 0 / 133 / 76 / 47 | 0 / 0 / 0 / 0 |
| load checkout | 3 / 96 / 0 / 0 | 3 / 191 / 50 / 40 | 5 / 175 / 45 / 29 | 4 / 250 / 81 / 65 |
| idle 10s checkout | 0 / 0 / 0 / 0 | 0 / 0 / 0 / 0 | 0 / 0 / 0 / 0 | 0 / 0 / 0 / 0 |
| header: scroll down 900px (hide) | 0 / 42 / 28 / 14 | 2 / 56 / 32 / 22 | 1 / 211 / 64 / 62 | - |
| header: scroll up 300px (reveal) | 0 / 42 / 28 / 14 | 0 / 42 / 28 / 14 | 0 / 42 / 28 / 14 | - |
| header: scroll down 300px (hide again) | 0 / 42 / 28 / 14 | 0 / 42 / 28 / 14 | 0 / 42 / 28 / 14 | - |
| shop: heart tap with 46 cards (median of 15) | 0 / 321 / 118 / 197 | - | - | - |
| pdp: one size click (median of 15) | 0 / 65 / 177 / 122 | 0 / 69 / 67 / 43 | 2 / 71 / 39 / 29 | - |
| checkout: one keystroke (median of 20) | 1 / 17 / 5 / 11 | 1 / 17 / 5 / 11 | 1 / 17 / 5 / 11 | - |
| checkout: 20 keystrokes name | 18 / 340 / 100 / 220 | 19 / 340 / 100 / 220 | 20 / 340 / 100 / 220 | 20 / 340 / 100 / 220 |
| checkout: 20 keystrokes phone | 18 / 340 / 100 / 220 | 18 / 340 / 100 / 220 | 19 / 340 / 100 / 220 | 20 / 340 / 100 / 220 |
| checkout: 20 keystrokes note | 18 / 340 / 100 / 220 | 20 / 340 / 100 / 220 | 20 / 340 / 100 / 220 | 19 / 340 / 100 / 220 |
| checkout: governorate select | 1 / 17 / 4 / 11 | 1 / 17 / 4 / 11 | 1 / 17 / 4 / 11 | 1 / 17 / 4 / 11 |
| checkout: 6 keystrokes area | 6 / 102 / 24 / 66 | 6 / 102 / 24 / 66 | 6 / 102 / 24 / 66 | 6 / 102 / 24 / 66 |
| checkout: toggle remember | 2 / 60 / 33 / 25 | 2 / 60 / 33 / 25 | 2 / 18 / 5 / 11 | 2 / 18 / 5 / 11 |
| pdp: toggle size M,L,M | 6 / 395 / 221 / 152 | 6 / 466 / 253 / 180 | 6 / 562 / 225 / 166 | 6 / 213 / 115 / 87 |
| pdp: qty +1 | 3 / 239 / 153 / 85 | 2 / 155 / 97 / 57 | 1 / 113 / 69 / 43 | 1 / 113 / 69 / 43 |
| pdp: add to bag | 1 / 288 / 176 / 99 | 2 / 204 / 120 / 71 | 1 / 120 / 64 / 43 | 1 / 120 / 64 / 43 |
| pdp: wishlist heart | 0 / 120 / 67 / 45 | 1 / 120 / 67 / 45 | 1 / 120 / 67 / 45 | 1 / 120 / 67 / 45 |
| bag: open drawer | 0 / 42 / 27 / 14 | 0 / 42 / 27 / 14 | 0 / 42 / 27 / 14 | 0 / 42 / 27 / 14 |
| bag: qty +1 in drawer | 0 / 71 / 35 / 30 | 0 / 71 / 35 / 30 | 0 / 71 / 35 / 30 | 0 / 71 / 35 / 30 |
| bag: qty +1 again | 0 / 71 / 35 / 30 | 0 / 71 / 35 / 30 | 0 / 71 / 35 / 30 | 0 / 71 / 35 / 30 |
| bag: close drawer (Escape) | 0 / 42 / 27 / 14 | 0 / 42 / 27 / 14 | 0 / 42 / 27 / 14 | 0 / 42 / 27 / 14 |
| shop: hover 6 cards | 1 / 56 / 32 / 22 | 1 / 56 / 32 / 22 | 3 / 351 / 104 / 142 | 4 / 351 / 104 / 142 |
| shop: scroll 3 screens | 3 / 562 / 148 / 224 | 3 / 562 / 148 / 224 | 7 / 407 / 116 / 184 | 6 / 730 / 224 / 328 |
| shop: wishlist heart on a card | 1 / 295 / 99 / 157 | 1 / 295 / 99 / 157 | 1 / 323 / 91 / 183 | 1 / 323 / 91 / 183 |
| shop: wishlist heart again | 1 / 253 / 71 / 143 | 1 / 253 / 71 / 143 | 1 / 323 / 91 / 183 | 1 / 323 / 91 / 183 |
| shop: filter Men | 0 / 84 / 55 / 28 | 0 / 84 / 56 / 28 | 1 / 201 / 62 / 72 | 2 / 201 / 62 / 72 |
| shop: filter All | 0 / 42 / 27 / 14 | 2 / 99 / 32 / 56 | 0 / 0 / 0 / 0 | 3 / 193 / 26 / 46 |
| shop: sort price asc | 4 / 218 / 44 / 84 | 4 / 218 / 44 / 84 | 4 / 197 / 38 / 72 | 6 / 288 / 64 / 124 |
| shop: load more (12) | 3 / 393 / 116 / 166 | 1 / 267 / 64 / 104 | 4 / 379 / 112 / 158 | 6 / 358 / 106 / 146 |
| shop: filter Women after load more | 0 / 42 / 27 / 14 | 1 / 292 / 89 / 86 | 1 / 292 / 90 / 86 | - |
| shop: sort high->low after load more | 2 / 219 / 65 / 96 | 5 / 176 / 41 / 72 | 2 / 134 / 29 / 48 | - |
| route: shop -> product (card click) | 1 / 116 / 0 / 0 | 0 / 0 / 0 / 0 | 1 / 116 / 0 / 0 | 5 / 293 / 98 / 75 |
| route: back to shop | 4 / 200 / 24 / 48 | 4 / 200 / 24 / 48 | 4 / 200 / 24 / 48 | 7 / 411 / 100 / 158 |
| route: nav link home | 0 / 0 / 0 / 0 | 0 / 0 / 0 / 0 | 3 / 271 / 40 / 58 | 3 / 338 / 71 / 93 |
| route: nav link shop | 1 / 112 / 44 / 46 | 5 / 240 / 27 / 52 | 5 / 289 / 49 / 98 | 6 / 350 / 66 / 132 |
| resize viewport | 4 / 218 / 62 / 124 | 2 / 14 / 4 / 8 | 1 / 21 / 6 / 12 | 0 / 0 / 0 / 0 |
| language toggle | 1 / 153 / 42 / 64 | 1 / 153 / 42 / 64 | 0 / 153 / 42 / 64 | 1 / 153 / 42 / 64 |
| language toggle back | 0 / 153 / 42 / 64 | 0 / 153 / 42 / 64 | 0 / 153 / 42 / 64 | 0 / 153 / 42 / 64 |
| ai: open panel | 3 / 5 / 1 / 1 | 2 / 5 / 1 / 1 | 3 / 5 / 1 / 1 | 2 / 5 / 1 / 1 |
| ai: 20 keystrokes | 21 / 42 / 21 / 0 | 21 / 42 / 21 / 0 | 21 / 42 / 21 / 0 | 20 / 42 / 21 / 0 |
| ai: close panel | 1 / 3 / 1 / 1 | 1 / 3 / 1 / 1 | 1 / 3 / 1 / 1 | 1 / 3 / 1 / 1 |
| shop: heart tap with 36 cards (median of 15) | - | 0 / 252 / 99 / 157 | 1 / 253 / 71 / 143 | - |

### B. Repo build, BEFORE

Cell = commits / rendered function-component fibers / avoidable by React.memo or stable props (wasted + fresh-identity) / wasted only because the parent rebuilt `children` (JSX). Idle and interaction windows include the async tail of the action (400-1200 ms).

| interaction | ar 390 | en 390 | ar 1280 | en 1280 |
|---|---|---|---|---|
| load home | 4 / 288 / 50 / 54 | 5 / 288 / 50 / 54 | 5 / 322 / 72 / 66 | 4 / 288 / 50 / 54 |
| idle 10s home | 0 / 0 / 0 / 0 | 0 / 0 / 0 / 0 | 0 / 0 / 0 / 0 | 0 / 0 / 0 / 0 |
| load shop | 5 / 372 / 73 / 112 | 6 / 372 / 73 / 112 | 4 / 288 / 49 / 64 | 4 / 288 / 49 / 64 |
| idle 10s shop | 0 / 0 / 0 / 0 | 0 / 0 / 0 / 0 | 0 / 0 / 0 / 0 | 0 / 0 / 0 / 0 |
| load product | 5 / 378 / 129 / 93 | 6 / 378 / 129 / 93 | 4 / 205 / 37 / 26 | 5 / 313 / 91 / 67 |
| idle 10s product | 0 / 0 / 0 / 0 | 0 / 0 / 0 / 0 | 0 / 0 / 0 / 0 | 0 / 0 / 0 / 0 |
| load checkout | 3 / 136 / 25 / 16 | 3 / 136 / 25 / 16 | 4 / 136 / 25 / 16 | 4 / 136 / 25 / 16 |
| idle 10s checkout | 0 / 0 / 0 / 0 | 0 / 0 / 0 / 0 | 0 / 0 / 0 / 0 | 0 / 0 / 0 / 0 |
| idle 10s home (hero autoplay every 2.5s) | 6 / 76 / 26 / 28 | 6 / 76 / 26 / 28 | 6 / 76 / 26 / 28 | 6 / 76 / 26 / 28 |
| checkout: 20 keystrokes name | 20 / 360 / 120 / 220 | 21 / 360 / 120 / 220 | 21 / 360 / 120 / 220 | 21 / 360 / 120 / 220 |
| checkout: 20 keystrokes phone | 20 / 360 / 120 / 220 | 20 / 360 / 120 / 220 | 20 / 360 / 120 / 220 | 20 / 360 / 120 / 220 |
| checkout: 20 keystrokes note | 20 / 360 / 100 / 220 | 20 / 360 / 100 / 220 | 20 / 360 / 100 / 220 | 20 / 360 / 100 / 220 |
| checkout: governorate select | 1 / 18 / 5 / 11 | 1 / 18 / 5 / 11 | 1 / 18 / 5 / 11 | 1 / 18 / 5 / 11 |
| checkout: 6 keystrokes area | 6 / 108 / 30 / 66 | 6 / 108 / 30 / 66 | 6 / 108 / 30 / 66 | 6 / 108 / 30 / 66 |
| checkout: toggle remember | 3 / 62 / 32 / 27 | 3 / 62 / 32 / 27 | 2 / 19 / 6 / 11 | 2 / 19 / 6 / 11 |
| pdp: toggle size M,L,M | 6 / 238 / 132 / 94 | 6 / 238 / 132 / 94 | 5 / 195 / 106 / 78 | 5 / 195 / 106 / 78 |
| pdp: qty +1 | 4 / 151 / 90 / 58 | 6 / 194 / 116 / 74 | 1 / 65 / 38 / 26 | 1 / 65 / 38 / 26 |
| pdp: add to bag | 2 / 115 / 59 / 42 | 4 / 158 / 85 / 58 | 2 / 115 / 59 / 42 | 2 / 115 / 59 / 42 |
| pdp: wishlist heart | 2 / 164 / 90 / 62 | 2 / 164 / 90 / 62 | 1 / 115 / 61 / 43 | 1 / 115 / 61 / 43 |
| bag: open drawer | 1 / 43 / 25 / 16 | 1 / 43 / 25 / 16 | 1 / 43 / 25 / 16 | 1 / 43 / 25 / 16 |
| bag: qty +1 in drawer | 1 / 72 / 33 / 32 | 1 / 72 / 33 / 32 | 1 / 72 / 33 / 32 | 1 / 72 / 33 / 32 |
| bag: qty +1 again | 1 / 72 / 33 / 32 | 1 / 72 / 33 / 32 | 1 / 72 / 33 / 32 | 1 / 72 / 33 / 32 |
| bag: close drawer (Escape) | 1 / 43 / 25 / 16 | 1 / 43 / 25 / 16 | 1 / 43 / 25 / 16 | 1 / 43 / 25 / 16 |
| shop: hover 6 cards | 3 / 43 / 26 / 16 | 2 / 43 / 26 / 16 | 4 / 424 / 135 / 176 | 3 / 296 / 86 / 112 |
| shop: scroll 3 screens | 4 / 590 / 156 / 240 | 4 / 590 / 156 / 240 | 3 / 660 / 204 / 288 | 4 / 730 / 224 / 328 |
| shop: wishlist heart on a card | 2 / 339 / 122 / 174 | 2 / 339 / 122 / 174 | 2 / 366 / 116 / 198 | 2 / 366 / 116 / 198 |
| shop: wishlist heart again | 1 / 296 / 96 / 158 | 1 / 296 / 96 / 158 | 1 / 366 / 116 / 198 | 1 / 366 / 116 / 198 |
| shop: filter Men | 3 / 213 / 66 / 80 | 3 / 213 / 66 / 80 | 2 / 170 / 72 / 96 | 2 / 170 / 72 / 96 |
| shop: filter All | 2 / 162 / 25 / 48 | 2 / 162 / 25 / 48 | 2 / 162 / 25 / 48 | 2 / 162 / 25 / 48 |
| shop: sort price asc | 2 / 155 / 26 / 48 | 2 / 155 / 26 / 48 | 2 / 155 / 26 / 48 | 2 / 155 / 26 / 48 |
| shop: load more (12) | 3 / 296 / 86 / 112 | 3 / 296 / 86 / 112 | 3 / 296 / 86 / 112 | 3 / 296 / 86 / 112 |
| shop: filter Women after load more | 3 / 262 / 98 / 112 | 3 / 262 / 98 / 112 | 3 / 262 / 98 / 112 | 3 / 262 / 98 / 112 |
| shop: sort high->low after load more | 2 / 134 / 29 / 48 | 2 / 134 / 29 / 48 | 2 / 134 / 29 / 48 | 2 / 134 / 29 / 48 |
| route: shop -> product (card click) | 2 / 106 / 0 / 0 | 4 / 260 / 80 / 66 | 2 / 106 / 0 / 0 | 4 / 183 / 38 / 33 |
| route: back to shop | 3 / 282 / 48 / 96 | 3 / 282 / 48 / 96 | 3 / 282 / 48 / 96 | 3 / 282 / 48 / 96 |
| route: nav link home | 6 / 261 / 55 / 66 | 5 / 261 / 55 / 66 | 6 / 389 / 104 / 130 | 5 / 261 / 55 / 66 |
| route: nav link shop | 3 / 282 / 48 / 96 | 3 / 282 / 48 / 96 | 3 / 282 / 48 / 96 | 3 / 282 / 48 / 96 |
| resize viewport | 0 / 0 / 0 / 0 | 0 / 0 / 0 / 0 | 0 / 0 / 0 / 0 | 0 / 0 / 0 / 0 |
| language toggle | 2 / 150 / 41 / 60 | 2 / 150 / 41 / 60 | 2 / 150 / 41 / 60 | 2 / 150 / 41 / 60 |
| language toggle back | 1 / 150 / 41 / 60 | 1 / 150 / 41 / 60 | 1 / 150 / 41 / 60 | 1 / 150 / 41 / 60 |
| ai: open panel | 2 / 3 / 0 / 0 | 2 / 3 / 0 / 0 | 2 / 3 / 0 / 0 | 2 / 3 / 0 / 0 |
| ai: 20 keystrokes | 21 / 42 / 21 / 0 | 21 / 42 / 21 / 0 | 21 / 42 / 21 / 0 | 21 / 42 / 21 / 0 |
| ai: close panel | 1 / 1 / 0 / 0 | 1 / 1 / 0 / 0 | 1 / 1 / 0 / 0 | 1 / 1 / 0 / 0 |
| search: open overlay | 1 / 51 / 25 / 16 | 1 / 51 / 25 / 16 | 1 / 51 / 25 / 16 | 1 / 51 / 25 / 16 |
| search: 6 keystrokes | 7 / 104 / 12 / 45 | 7 / 104 / 12 / 45 | 6 / 104 / 12 / 45 | 7 / 104 / 12 / 45 |
| theme toggle | 1 / 44 / 25 / 15 | 1 / 44 / 25 / 15 | 1 / 44 / 25 / 15 | 1 / 44 / 25 / 15 |

### C. Repo build, AFTER patches 01-06

Cell = commits / rendered function-component fibers / avoidable by React.memo or stable props (wasted + fresh-identity) / wasted only because the parent rebuilt `children` (JSX). Idle and interaction windows include the async tail of the action (400-1200 ms).

| interaction | ar 390 | en 390 | ar 1280 | en 1280 |
|---|---|---|---|---|
| load home | 5 / 273 / 41 / 48 | 5 / 301 / 49 / 64 | 4 / 268 / 38 / 46 | 7 / 301 / 49 / 64 |
| idle 10s home | 0 / 0 / 0 / 0 | 0 / 0 / 0 / 0 | 0 / 0 / 0 / 0 | 0 / 0 / 0 / 0 |
| load shop | 4 / 268 / 37 / 56 | 5 / 268 / 37 / 56 | 2 / 9 / 0 / 0 | 3 / 268 / 37 / 56 |
| idle 10s shop | 0 / 0 / 0 / 0 | 0 / 0 / 0 / 0 | 0 / 0 / 0 / 0 | 0 / 0 / 0 / 0 |
| load product | 4 / 239 / 41 / 43 | 6 / 259 / 50 / 53 | 1 / 9 / 0 / 0 | 4 / 239 / 41 / 43 |
| idle 10s product | 0 / 0 / 0 / 0 | 0 / 0 / 0 / 0 | 0 / 0 / 0 / 0 | 0 / 0 / 0 / 0 |
| load checkout | 4 / 116 / 13 / 8 | 4 / 116 / 13 / 8 | 3 / 93 / 0 / 0 | 3 / 116 / 13 / 8 |
| idle 10s checkout | 0 / 0 / 0 / 0 | 0 / 0 / 0 / 0 | 0 / 0 / 0 / 0 | 0 / 0 / 0 / 0 |
| idle 10s home (hero autoplay every 2.5s) | 6 / 60 / 18 / 20 | 6 / 60 / 18 / 20 | 6 / 60 / 18 / 20 | 6 / 60 / 18 / 20 |
| checkout: 20 keystrokes name | 21 / 260 / 40 / 200 | 21 / 260 / 40 / 200 | 21 / 260 / 40 / 200 | 21 / 260 / 40 / 200 |
| checkout: 20 keystrokes phone | 20 / 260 / 40 / 200 | 20 / 260 / 40 / 200 | 20 / 260 / 40 / 200 | 20 / 260 / 40 / 200 |
| checkout: 20 keystrokes note | 20 / 280 / 40 / 200 | 20 / 280 / 40 / 200 | 20 / 280 / 40 / 200 | 20 / 280 / 40 / 200 |
| checkout: governorate select | 1 / 13 / 1 / 10 | 1 / 13 / 1 / 10 | 1 / 13 / 1 / 10 | 1 / 13 / 1 / 10 |
| checkout: 6 keystrokes area | 6 / 78 / 6 / 60 | 6 / 78 / 6 / 60 | 6 / 78 / 6 / 60 | 6 / 78 / 6 / 60 |
| checkout: toggle remember | 2 / 36 / 15 / 18 | 3 / 36 / 15 / 18 | 2 / 14 / 2 / 10 | 2 / 14 / 2 / 10 |
| pdp: toggle size M,L,M | 4 / 90 / 40 / 38 | 4 / 90 / 40 / 38 | 3 / 68 / 27 / 30 | 3 / 68 / 27 / 30 |
| pdp: qty +1 | 6 / 86 / 48 / 34 | 6 / 86 / 48 / 34 | 1 / 20 / 9 / 10 | 1 / 20 / 9 / 10 |
| pdp: add to bag | 6 / 92 / 49 / 32 | 4 / 70 / 36 / 24 | 1 / 48 / 23 / 16 | 1 / 48 / 23 / 16 |
| pdp: wishlist heart | 2 / 42 / 20 / 16 | 2 / 64 / 33 / 24 | 1 / 42 / 20 / 16 | 1 / 42 / 20 / 16 |
| bag: open drawer | 1 / 41 / 23 / 16 | 1 / 41 / 23 / 16 | 1 / 41 / 23 / 16 | 1 / 41 / 23 / 16 |
| bag: qty +1 in drawer | 1 / 42 / 23 / 16 | 1 / 42 / 23 / 16 | 1 / 42 / 23 / 16 | 1 / 42 / 23 / 16 |
| bag: qty +1 again | 1 / 42 / 23 / 16 | 1 / 42 / 23 / 16 | 1 / 42 / 23 / 16 | 1 / 42 / 23 / 16 |
| bag: close drawer (Escape) | 1 / 41 / 23 / 16 | 1 / 41 / 23 / 16 | 1 / 41 / 23 / 16 | 1 / 41 / 23 / 16 |
| shop: hover 6 cards | 3 / 22 / 13 / 8 | 3 / 22 / 13 / 8 | 3 / 191 / 37 / 56 | 3 / 191 / 37 / 56 |
| shop: scroll 3 screens | 4 / 338 / 48 / 96 | 4 / 338 / 48 / 96 | 4 / 310 / 44 / 88 | 4 / 310 / 44 / 88 |
| shop: wishlist heart on a card | 2 / 51 / 26 / 18 | 2 / 51 / 26 / 18 | 2 / 29 / 13 / 10 | 2 / 29 / 13 / 10 |
| shop: wishlist heart again | 1 / 29 / 13 / 10 | 1 / 29 / 13 / 10 | 1 / 29 / 13 / 10 | 1 / 29 / 13 / 10 |
| shop: filter Men | 3 / 135 / 29 / 40 | 2 / 135 / 29 / 40 | 1 / 1 / 0 / 0 | 1 / 1 / 0 / 0 |
| shop: filter All | 2 / 155 / 22 / 44 | 2 / 155 / 22 / 44 | 2 / 155 / 22 / 44 | 2 / 155 / 22 / 44 |
| shop: sort price asc | 2 / 141 / 20 / 40 | 2 / 141 / 20 / 40 | 2 / 141 / 20 / 40 | 2 / 141 / 20 / 40 |
| shop: load more (12) | 3 / 191 / 37 / 56 | 3 / 191 / 37 / 56 | 3 / 191 / 37 / 56 | 3 / 191 / 37 / 56 |
| shop: filter Women after load more | 2 / 23 / 13 / 8 | 2 / 23 / 13 / 8 | 2 / 23 / 13 / 8 | 2 / 23 / 13 / 8 |
| shop: sort high->low after load more | 2 / 99 / 14 / 28 | 2 / 99 / 14 / 28 | 2 / 99 / 14 / 28 | 2 / 99 / 14 / 28 |
| route: shop -> product (card click) | 4 / 194 / 30 / 50 | 4 / 194 / 30 / 50 | 3 / 163 / 18 / 33 | 4 / 194 / 30 / 50 |
| route: back to shop | 3 / 282 / 48 / 96 | 3 / 282 / 48 / 96 | 2 / 197 / 24 / 48 | 2 / 197 / 24 / 48 |
| route: nav link home | 5 / 232 / 36 / 56 | 6 / 232 / 36 / 56 | 4 / 216 / 28 / 48 | 5 / 232 / 36 / 56 |
| route: nav link shop | 3 / 282 / 48 / 96 | 3 / 282 / 48 / 96 | 3 / 282 / 48 / 96 | 3 / 282 / 48 / 96 |
| resize viewport | 0 / 0 / 0 / 0 | 0 / 0 / 0 / 0 | 0 / 0 / 0 / 0 | 0 / 0 / 0 / 0 |
| language toggle | 2 / 150 / 41 / 60 | 2 / 150 / 41 / 60 | 2 / 150 / 41 / 60 | 2 / 150 / 41 / 60 |
| language toggle back | 1 / 150 / 41 / 60 | 1 / 150 / 41 / 60 | 1 / 150 / 41 / 60 | 1 / 150 / 41 / 60 |
| ai: open panel | 3 / 3 / 0 / 0 | 2 / 3 / 0 / 0 | 2 / 3 / 0 / 0 | 2 / 3 / 0 / 0 |
| ai: 20 keystrokes | 21 / 42 / 21 / 0 | 21 / 42 / 21 / 0 | 21 / 42 / 21 / 0 | 21 / 42 / 21 / 0 |
| ai: close panel | 1 / 1 / 0 / 0 | 1 / 1 / 0 / 0 | 1 / 1 / 0 / 0 | 1 / 1 / 0 / 0 |
| search: open overlay | 1 / 31 / 13 / 8 | 1 / 31 / 13 / 8 | 1 / 31 / 13 / 8 | 1 / 31 / 13 / 8 |
| search: 6 keystrokes | 7 / 104 / 12 / 45 | 7 / 104 / 12 / 45 | 7 / 104 / 12 / 45 | 7 / 104 / 12 / 45 |
| theme toggle | 1 / 23 / 12 / 7 | 1 / 23 / 12 / 7 | 1 / 23 / 12 / 7 | 1 / 23 / 12 / 7 |
| header: scroll down 900px (hide) | - | - | 2 / 107 / 13 / 8 | - |
| header: scroll up 300px (reveal) | - | - | 1 / 22 / 13 / 8 | - |
| header: scroll down 300px (hide again) | - | - | 1 / 22 / 13 / 8 | - |
| shop: heart tap with 36 cards (median of 15) | - | - | 1 / 29 / 13 / 10 | - |
| pdp: one size click (median of 15) | - | - | 1 / 23 / 9 / 10 | - |
| checkout: one keystroke (median of 20) | - | - | 1 / 13 / 2 / 10 | - |

### D. Repo storefront: before → after (commits, rendered fibers)

| interaction | ar 390 | en 390 | ar 1280 | en 1280 |
|---|---|---|---|---|
| load home | 4→5 c, 288→273 r (−5%) | 5→5 c, 288→301 r (+5%) | 5→4 c, 322→268 r (−17%) | 4→7 c, 288→301 r (+5%) |
| idle 10s home | 0→0 c, 0→0 r (−0%) | 0→0 c, 0→0 r (−0%) | 0→0 c, 0→0 r (−0%) | 0→0 c, 0→0 r (−0%) |
| load shop | 5→4 c, 372→268 r (−28%) | 6→5 c, 372→268 r (−28%) | 4→2 c, 288→9 r (−97%) | 4→3 c, 288→268 r (−7%) |
| idle 10s shop | 0→0 c, 0→0 r (−0%) | 0→0 c, 0→0 r (−0%) | 0→0 c, 0→0 r (−0%) | 0→0 c, 0→0 r (−0%) |
| load product | 5→4 c, 378→239 r (−37%) | 6→6 c, 378→259 r (−31%) | 4→1 c, 205→9 r (−96%) | 5→4 c, 313→239 r (−24%) |
| idle 10s product | 0→0 c, 0→0 r (−0%) | 0→0 c, 0→0 r (−0%) | 0→0 c, 0→0 r (−0%) | 0→0 c, 0→0 r (−0%) |
| load checkout | 3→4 c, 136→116 r (−15%) | 3→4 c, 136→116 r (−15%) | 4→3 c, 136→93 r (−32%) | 4→3 c, 136→116 r (−15%) |
| idle 10s checkout | 0→0 c, 0→0 r (−0%) | 0→0 c, 0→0 r (−0%) | 0→0 c, 0→0 r (−0%) | 0→0 c, 0→0 r (−0%) |
| idle 10s home (hero autoplay every 2.5s) | 6→6 c, 76→60 r (−21%) | 6→6 c, 76→60 r (−21%) | 6→6 c, 76→60 r (−21%) | 6→6 c, 76→60 r (−21%) |
| checkout: 20 keystrokes name | 20→21 c, 360→260 r (−28%) | 21→21 c, 360→260 r (−28%) | 21→21 c, 360→260 r (−28%) | 21→21 c, 360→260 r (−28%) |
| checkout: 20 keystrokes phone | 20→20 c, 360→260 r (−28%) | 20→20 c, 360→260 r (−28%) | 20→20 c, 360→260 r (−28%) | 20→20 c, 360→260 r (−28%) |
| checkout: 20 keystrokes note | 20→20 c, 360→280 r (−22%) | 20→20 c, 360→280 r (−22%) | 20→20 c, 360→280 r (−22%) | 20→20 c, 360→280 r (−22%) |
| checkout: governorate select | 1→1 c, 18→13 r (−28%) | 1→1 c, 18→13 r (−28%) | 1→1 c, 18→13 r (−28%) | 1→1 c, 18→13 r (−28%) |
| checkout: 6 keystrokes area | 6→6 c, 108→78 r (−28%) | 6→6 c, 108→78 r (−28%) | 6→6 c, 108→78 r (−28%) | 6→6 c, 108→78 r (−28%) |
| checkout: toggle remember | 3→2 c, 62→36 r (−42%) | 3→3 c, 62→36 r (−42%) | 2→2 c, 19→14 r (−26%) | 2→2 c, 19→14 r (−26%) |
| pdp: toggle size M,L,M | 6→4 c, 238→90 r (−62%) | 6→4 c, 238→90 r (−62%) | 5→3 c, 195→68 r (−65%) | 5→3 c, 195→68 r (−65%) |
| pdp: qty +1 | 4→6 c, 151→86 r (−43%) | 6→6 c, 194→86 r (−56%) | 1→1 c, 65→20 r (−69%) | 1→1 c, 65→20 r (−69%) |
| pdp: add to bag | 2→6 c, 115→92 r (−20%) | 4→4 c, 158→70 r (−56%) | 2→1 c, 115→48 r (−58%) | 2→1 c, 115→48 r (−58%) |
| pdp: wishlist heart | 2→2 c, 164→42 r (−74%) | 2→2 c, 164→64 r (−61%) | 1→1 c, 115→42 r (−63%) | 1→1 c, 115→42 r (−63%) |
| bag: open drawer | 1→1 c, 43→41 r (−5%) | 1→1 c, 43→41 r (−5%) | 1→1 c, 43→41 r (−5%) | 1→1 c, 43→41 r (−5%) |
| bag: qty +1 in drawer | 1→1 c, 72→42 r (−42%) | 1→1 c, 72→42 r (−42%) | 1→1 c, 72→42 r (−42%) | 1→1 c, 72→42 r (−42%) |
| bag: qty +1 again | 1→1 c, 72→42 r (−42%) | 1→1 c, 72→42 r (−42%) | 1→1 c, 72→42 r (−42%) | 1→1 c, 72→42 r (−42%) |
| bag: close drawer (Escape) | 1→1 c, 43→41 r (−5%) | 1→1 c, 43→41 r (−5%) | 1→1 c, 43→41 r (−5%) | 1→1 c, 43→41 r (−5%) |
| shop: hover 6 cards | 3→3 c, 43→22 r (−49%) | 2→3 c, 43→22 r (−49%) | 4→3 c, 424→191 r (−55%) | 3→3 c, 296→191 r (−35%) |
| shop: scroll 3 screens | 4→4 c, 590→338 r (−43%) | 4→4 c, 590→338 r (−43%) | 3→4 c, 660→310 r (−53%) | 4→4 c, 730→310 r (−58%) |
| shop: wishlist heart on a card | 2→2 c, 339→51 r (−85%) | 2→2 c, 339→51 r (−85%) | 2→2 c, 366→29 r (−92%) | 2→2 c, 366→29 r (−92%) |
| shop: wishlist heart again | 1→1 c, 296→29 r (−90%) | 1→1 c, 296→29 r (−90%) | 1→1 c, 366→29 r (−92%) | 1→1 c, 366→29 r (−92%) |
| shop: filter Men | 3→3 c, 213→135 r (−37%) | 3→2 c, 213→135 r (−37%) | 2→1 c, 170→1 r (−99%) | 2→1 c, 170→1 r (−99%) |
| shop: filter All | 2→2 c, 162→155 r (−4%) | 2→2 c, 162→155 r (−4%) | 2→2 c, 162→155 r (−4%) | 2→2 c, 162→155 r (−4%) |
| shop: sort price asc | 2→2 c, 155→141 r (−9%) | 2→2 c, 155→141 r (−9%) | 2→2 c, 155→141 r (−9%) | 2→2 c, 155→141 r (−9%) |
| shop: load more (12) | 3→3 c, 296→191 r (−35%) | 3→3 c, 296→191 r (−35%) | 3→3 c, 296→191 r (−35%) | 3→3 c, 296→191 r (−35%) |
| shop: filter Women after load more | 3→2 c, 262→23 r (−91%) | 3→2 c, 262→23 r (−91%) | 3→2 c, 262→23 r (−91%) | 3→2 c, 262→23 r (−91%) |
| shop: sort high->low after load more | 2→2 c, 134→99 r (−26%) | 2→2 c, 134→99 r (−26%) | 2→2 c, 134→99 r (−26%) | 2→2 c, 134→99 r (−26%) |
| route: shop -> product (card click) | 2→4 c, 106→194 r (+83%) | 4→4 c, 260→194 r (−25%) | 2→3 c, 106→163 r (+54%) | 4→4 c, 183→194 r (+6%) |
| route: back to shop | 3→3 c, 282→282 r (−0%) | 3→3 c, 282→282 r (−0%) | 3→2 c, 282→197 r (−30%) | 3→2 c, 282→197 r (−30%) |
| route: nav link home | 6→5 c, 261→232 r (−11%) | 5→6 c, 261→232 r (−11%) | 6→4 c, 389→216 r (−44%) | 5→5 c, 261→232 r (−11%) |
| route: nav link shop | 3→3 c, 282→282 r (−0%) | 3→3 c, 282→282 r (−0%) | 3→3 c, 282→282 r (−0%) | 3→3 c, 282→282 r (−0%) |
| resize viewport | 0→0 c, 0→0 r (−0%) | 0→0 c, 0→0 r (−0%) | 0→0 c, 0→0 r (−0%) | 0→0 c, 0→0 r (−0%) |
| language toggle | 2→2 c, 150→150 r (−0%) | 2→2 c, 150→150 r (−0%) | 2→2 c, 150→150 r (−0%) | 2→2 c, 150→150 r (−0%) |
| language toggle back | 1→1 c, 150→150 r (−0%) | 1→1 c, 150→150 r (−0%) | 1→1 c, 150→150 r (−0%) | 1→1 c, 150→150 r (−0%) |
| ai: open panel | 2→3 c, 3→3 r (−0%) | 2→2 c, 3→3 r (−0%) | 2→2 c, 3→3 r (−0%) | 2→2 c, 3→3 r (−0%) |
| ai: 20 keystrokes | 21→21 c, 42→42 r (−0%) | 21→21 c, 42→42 r (−0%) | 21→21 c, 42→42 r (−0%) | 21→21 c, 42→42 r (−0%) |
| ai: close panel | 1→1 c, 1→1 r (−0%) | 1→1 c, 1→1 r (−0%) | 1→1 c, 1→1 r (−0%) | 1→1 c, 1→1 r (−0%) |
| search: open overlay | 1→1 c, 51→31 r (−39%) | 1→1 c, 51→31 r (−39%) | 1→1 c, 51→31 r (−39%) | 1→1 c, 51→31 r (−39%) |
| search: 6 keystrokes | 7→7 c, 104→104 r (−0%) | 7→7 c, 104→104 r (−0%) | 6→7 c, 104→104 r (−0%) | 7→7 c, 104→104 r (−0%) |
| theme toggle | 1→1 c, 44→23 r (−48%) | 1→1 c, 44→23 r (−48%) | 1→1 c, 44→23 r (−48%) | 1→1 c, 44→23 r (−48%) |
| header: scroll down 900px (hide) | - | - | - | - |
| header: scroll up 300px (reveal) | - | - | - | - |
| header: scroll down 300px (hide again) | - | - | - | - |
| shop: heart tap with 36 cards (median of 15) | - | - | - | - |
| pdp: one size click (median of 15) | - | - | - | - |
| checkout: one keystroke (median of 20) | - | - | - | - |

### E. Repo admin, BEFORE (mock admin.php, 100 orders, 120 variants)

| interaction | 1280 | 390 |
|---|---|---|
| admin load overview | 5 / 64 / 0 / 0 | 4 / 64 / 0 / 0 |
| tab -> Orders | 3 / 446 / 20 / 20 | 3 / 446 / 20 / 20 |
| tab -> Catalogue | 5 / 44 / 18 / 18 | 5 / 44 / 18 / 18 |
| tab -> Brands | 3 / 47 / 18 / 18 | 3 / 47 / 18 / 18 |
| tab -> Slides | 3 / 42 / 18 / 18 | 3 / 42 / 18 / 18 |
| tab -> Promotions | 4 / 41 / 18 / 18 | 3 / 40 / 18 / 18 |
| tab -> Discounts | 3 / 42 / 18 / 18 | 3 / 42 / 18 / 18 |
| tab -> Inventory | 2 / 291 / 18 / 18 | 2 / 291 / 18 / 18 |
| tab -> Settings | 1 / 37 / 18 / 18 | 1 / 37 / 18 / 18 |
| tab -> Overview | 2 / 51 / 18 / 18 | 2 / 51 / 18 / 18 |
| orders: 20 keystrokes search (no fetch yet) | 22 / 8866 / 8822 / 22 | 25 / 10075 / 10025 / 25 |
| orders: debounced reload after typing | 0 / 0 / 0 / 0 | 0 / 0 / 0 / 0 |
| orders: filter paid | 3 / 1009 / 1003 / 3 | 3 / 1009 / 1003 / 3 |
| orders: open a row | 2 / 223 / 209 / 2 | 0 / 0 / 0 / 0 |
| inventory: toggle problems-only | 2 / 29 / 27 / 1 | 2 / 29 / 27 / 1 |
| inventory: idle 17s (15s poll) | 1 / 29 / 27 / 1 | 1 / 29 / 27 / 1 |
| admin idle 10s Overview | 0 / 0 / 0 / 0 | 0 / 0 / 0 / 0 |
| admin idle 10s Orders | 0 / 0 / 0 / 0 | 0 / 0 / 0 / 0 |

### F. Repo admin, AFTER patch 07

| interaction | 1280 | 390 |
|---|---|---|
| admin load overview | 4 / 64 / 0 / 0 | 4 / 64 / 0 / 0 |
| tab -> Orders | 3 / 446 / 20 / 20 | 3 / 246 / 20 / 20 |
| tab -> Catalogue | 5 / 44 / 18 / 18 | 5 / 44 / 18 / 18 |
| tab -> Brands | 3 / 47 / 18 / 18 | 3 / 47 / 18 / 18 |
| tab -> Slides | 3 / 42 / 18 / 18 | 3 / 42 / 18 / 18 |
| tab -> Promotions | 4 / 41 / 18 / 18 | 4 / 41 / 18 / 18 |
| tab -> Discounts | 3 / 42 / 18 / 18 | 3 / 42 / 18 / 18 |
| tab -> Inventory | 2 / 291 / 18 / 18 | 2 / 284 / 18 / 18 |
| tab -> Settings | 1 / 37 / 18 / 18 | 1 / 37 / 18 / 18 |
| tab -> Overview | 2 / 51 / 18 / 18 | 2 / 51 / 18 / 18 |
| orders: 20 keystrokes search (no fetch yet) | 20 / 60 / 20 / 20 | 20 / 60 / 20 / 20 |
| orders: debounced reload after typing | 0 / 0 / 0 / 0 | 0 / 0 / 0 / 0 |
| orders: filter paid | 3 / 209 / 203 / 3 | 3 / 109 / 103 / 3 |
| orders: open a row | 2 / 23 / 9 / 2 | 0 / 0 / 0 / 0 |
| inventory: toggle problems-only | 2 / 29 / 27 / 1 | 2 / 22 / 20 / 1 |
| inventory: idle 17s (15s poll) | 1 / 13 / 11 / 1 | 1 / 6 / 4 / 1 |
| admin idle 10s Overview | 0 / 0 / 0 / 0 | 0 / 0 / 0 / 0 |
| admin idle 10s Orders | 0 / 0 / 0 / 0 | 0 / 0 / 0 / 0 |

### Admin: before → after

| interaction | 1280 | 390 |
|---|---|---|
| admin load overview | 5→4 c, 64→64 r (−0%) | 4→4 c, 64→64 r (−0%) |
| tab -> Orders | 3→3 c, 446→446 r (−0%) | 3→3 c, 446→246 r (−45%) |
| tab -> Catalogue | 5→5 c, 44→44 r (−0%) | 5→5 c, 44→44 r (−0%) |
| tab -> Brands | 3→3 c, 47→47 r (−0%) | 3→3 c, 47→47 r (−0%) |
| tab -> Slides | 3→3 c, 42→42 r (−0%) | 3→3 c, 42→42 r (−0%) |
| tab -> Promotions | 4→4 c, 41→41 r (−0%) | 3→4 c, 40→41 r (+2%) |
| tab -> Discounts | 3→3 c, 42→42 r (−0%) | 3→3 c, 42→42 r (−0%) |
| tab -> Inventory | 2→2 c, 291→291 r (−0%) | 2→2 c, 291→284 r (−2%) |
| tab -> Settings | 1→1 c, 37→37 r (−0%) | 1→1 c, 37→37 r (−0%) |
| tab -> Overview | 2→2 c, 51→51 r (−0%) | 2→2 c, 51→51 r (−0%) |
| orders: 20 keystrokes search (no fetch yet) | 22→20 c, 8866→60 r (−99%) | 25→20 c, 10075→60 r (−99%) |
| orders: debounced reload after typing | 0→0 c, 0→0 r (−0%) | 0→0 c, 0→0 r (−0%) |
| orders: filter paid | 3→3 c, 1009→209 r (−79%) | 3→3 c, 1009→109 r (−89%) |
| orders: open a row | 2→2 c, 223→23 r (−90%) | 0→0 c, 0→0 r (−0%) |
| inventory: toggle problems-only | 2→2 c, 29→29 r (−0%) | 2→2 c, 29→22 r (−24%) |
| inventory: idle 17s (15s poll) | 1→1 c, 29→13 r (−55%) | 1→1 c, 29→6 r (−79%) |
| admin idle 10s Overview | 0→0 c, 0→0 r (−0%) | 0→0 c, 0→0 r (−0%) |
| admin idle 10s Orders | 0→0 c, 0→0 r (−0%) | 0→0 c, 0→0 r (−0%) |

### G. Shop with a 4,000-product catalogue (en, 1280): rendered fibers / DOM mutation records

The API was made to return 4,000 products (the 46 captured ones cloned with distinct slugs). The grid is paged by 12 and never windowed; "108 cards" = 8 more "show more" taps first.

| interaction | live bundle | repo BEFORE | repo AFTER |
|---|---|---|---|
| shop: wishlist heart on a card | 339 / 7 | 380 / 7 | 29 / 5 |
| shop: scroll 3 screens | 752 / 106 | 758 / 52 | 254 / 50 |
| shop: load more (12) | 382 / 56 | 633 / 77 | 191 / 38 |
| shop: 108 cards shown, heart on one card | 927 / 7 | 968 / 7 | 29 / 5 |
| shop: 108 cards shown, filter Men | 1046 / 141 | 1010 / 127 | 1 / 126 |
| shop: filter Women after load more | 1 / 2 | 169 / 53 | 169 / 53 |
| shop: sort high->low after load more | 219 / 64 | 169 / 37 | 169 / 37 |
| shop: quick-add accessory card | 353 / 40 | 353 / 52 | 246 / 45 |
| route: back to shop | 215 / 64 | 197 / 69 | 197 / 69 |

### H. Single actions, median of 15-20 repetitions (repo, en 1280) and header flips (repo, ar 390)

| action | BEFORE fibers / DOM records / render-phase ms | AFTER |
|---|---|---|
| shop: heart tap with 36 cards | 296 / 7 / 3.7 | 29 / 5 / 0.7 |
| pdp: one size click | 65 / 46 / 1.1 | 23 / 4 / 1 |
| checkout: one keystroke | 18 / 34 / 0.8 | 13 / 23 / 0.9 |
| header: scroll down 900px (hide) | 43 / 3 / 1.1 | 22 / 1 / 0.5 |
| header: scroll up 300px (reveal) | 43 / 3 / 1.4 | 22 / 1 / 0.4 |
| header: scroll down 300px (hide again) | 43 / 3 / 1.1 | 22 / 1 / 1 |

### Live bundle: minified component names that appear in the tables

| label | component (from the pretty-printed bundle) |
|---|---|
| `ke#17a3r` | header clock (`setInterval 1000`) |
| `en#1svoy` | ProductCard (with a pointer-enter hover flag) |
| `?#9kf67` | react-router `Link` (forwardRef) |
| `?#1dv1m` | react-router `NavLink` |
| `z#z8z2y` | the svg icon wrapper (`Et` = plus, `dt` = heart, `Tt` = close, `B` = bag) |
| `Ce#5ww84` | size / fit chip |
| `M#1185v`, `F#1oky7`, `ge#omk5h`, `i#19oc9`, `de#acdpv` | Checkout page, Field, Coupon, CheckoutSteps, AreaSelect |
| `zt#e84yi`, `Bt#3w4r0`, `Lt#1ruf1`, `Nt#5ikrs` | Navbar, promo bar, assistant launcher, cart drawer backdrop |
| `u#97klr`, `f#1o8nr` | AI panel, Mic |

## 3. Idle, timers, and React-versus-add-on fights

**Who ticks.** 10 s of idle on each of `/`, `/shop`, a product page and `/checkout`, 4 languages/widths, both surfaces:

| surface | commits per 10 s | rendered fibers per commit | DOM mutation records per 10 s | who |
|---|---|---|---|---|
| live compiled bundle | 10-11 (every page, every language, every width) | 1 | 20-24 | the **header clock** component (`ke`, minified): `setInterval(tick, 1000)` -> `setState(Oe())`, and `Oe()` builds a new `Intl.DateTimeFormat` every tick. It writes the three hand `transform` attributes (2 attribute records per tick). |
| repo build | **0** on all four pages | - | 0 | nothing. The hero autoplay is the only timer; with the repo's default config (autoplay on) a tick is 1 commit / 10-16 fibers (measured with the interval shortened to 2.5 s: 6 commits and 76 fibers in 10 s, 60 after memoising `Slide`). The live shop has `hero.autoplay = false`, so its hero never ticks. |

`sporta-clock.css` says in its own header that "a CSS transform on an SVG element takes precedence over its transform attribute", so with the add-on active the compiled clock's once-a-second `transform` writes are painted over by the add-on's CSS animation. The only thing the tick still changes visibly is the `HH:MM` text once a minute. Cost per tick is tiny (1 fiber), but it is a permanent 1 Hz wake-up, a `DateTimeFormat` allocation and 2 DOM writes per second on every page of the live site, forever. It lives in the compiled bundle, so: **needs-storefront-rebuild** (tick once a minute, or only when the minute changes; a CSS-only animation needs no state at all). An add-on cannot stop it without monkey-patching `setInterval` before the bundle loads, which is fragile and not recommended.

**React versus add-ons (live bundle, mirror).** The storefront add-ons the live `index.html` loads (`boot.js`, `config.js`, `birthday.js`, `sporta-features.js`, `sporta-footer-call.js`, `sporta-gov-autopick.js`, `sporta-clock.js`, `sporta-checkout-a11y.js`; only five of them ever wrote to the DOM in these runs) were watched with a stack-attributed wrapper on every DOM mutator plus a `MutationObserver`:

* **At idle: 0 add-on DOM calls in every one of the 16 idle windows.** Zero add-on-driven commits. The 2 mutations/s are all React's (the clock).
* **While typing, hovering, tapping a heart, changing quantity, opening the bag, filtering, sorting, scrolling: 0 add-on DOM calls.** (`checkout: 20 keystrokes` = 500 mutation records, every one from `react-vendor`; the add-on `sporta-checkout-a11y.js` wrote 7 times at page load and never again.)
* **Add-ons act only on load, route change and language toggle, and each burst is finite:** load home 8-34 `sporta-features.js` calls (the band after the hero), load checkout 7 `sporta-checkout-a11y.js` calls, language toggle 9 `sporta-footer-call.js` calls (it removes and re-inserts its own node), route to home 20-50 `sporta-features.js` calls. Each settles within one frame (the observers coalesce with `requestAnimationFrame` and every mount is idempotent: it checks for its own node first).
* No attribute oscillates between two values: the highest per-window `flips` count (a value returning to the one before it) on any element/attribute is 3, and those are React's own `<head>` meta writes on mount, not an add-on.

**Result: no fight, no loop above 5 per second (measured maximum 1 commit/s, all React's own clock).** The design that makes this safe: every add-on adds its own node (never edits one React renders), writes attributes React never sets, and never reacts to its own writes.

**One cost of the add-ons worth knowing.** Five add-ons each hold a `MutationObserver` on `document.body` with `{childList, subtree}`; every React commit that adds or removes a node queues five callbacks and five `requestAnimationFrame`s. At today's page sizes this is not visible (nothing in the tables above shows it), and it grows with DOM size, not with traffic.

## 4. Findings

Severity: **high** = visible jank/slowness, data leak or can take the shop down; **medium** = measurable waste that grows with data or traffic, or a behaviour bug caused by re-rendering; **low** = hygiene. Surface: **L** = live compiled bundle (fix = `needs-storefront-rebuild`), **R** = repo `src/` (fix = `src-patch`, proven below, not applied).

### R1-01 (medium, L + R) One tap on a heart, or any bag change, re-renders every product card on the page

* Evidence. `shop: wishlist heart on a card` with 36 cards on screen: **live 295-323 rendered fibers, repo 339-366**, in 1-2 commits, for ONE `aria-pressed` flip; the 36 `ProductCard`s are all "context" renders (36 `ctx`), and each drags 2 `Link`s and 3 svg icons with it (the "jsx" column). `bag: qty +1 in drawer`: 72 fibers (4 cards behind it re-render too). The same happens for the wishlist count in the header. Tapping the heart on the product page (`pdp: wishlist heart`) is 115-164 fibers. With a 4,000-product catalogue and 8 "show more" taps (**108 cards** on screen) the same single tap is **968 fibers on the repo build (live: 927)**, because the cost is linear in the cards shown and the shop has no windowing; patched: **29 fibers, flat**.
* Cause. `cart.jsx:65` and `wishlist.jsx:61` hand out ONE object holding the list and the actions, re-created every provider render; `add/setQty/remove/clear/toggle/has` are new functions each time (`cart.jsx:35-59`, `wishlist.jsx:55-57`); `ProductCard` (`ProductCard.jsx:16-20`) reads both whole contexts and is not memoised. The live bundle's `ProductCard` (`en`) is the same code (identical providers, `ctx2: 36`).
* Fix (repo, **patch 01**). Actions in their own stable context (`useCartActions`); the wishlist as a small external store with a per-slug subscription (`useIsSaved(slug)`, `useSyncExternalStore`) so only the tapped card re-renders; `ProductCard` wrapped in `React.memo`. Measured on the patched build: **339 -> 51 and 296 -> 29 fibers** per tap (-85% / -90%); header count and the saved flag still update (behaviour check below). Live bundle: needs-storefront-rebuild.

### R1-02 (medium, L + R) The bag drawer steals focus and un-locks the page every time the bag changes (keyboard / screen-reader users)

* Evidence (probe `probe-focus.mjs`, bag open, focus on the first line's "+", press Enter twice): **live and repo-before: the first Enter lands focus on the drawer's Close button; the second Enter presses Close, the drawer closes, `body.style.overflow` is released and focus goes back to the Bag button** (quantity ends 3, not 4). Patched: both Enters hit "+" (quantity 4), focus stays, page stays locked. Live bundle shows the same sequence.
* Cause. `useDialog.js:103` lists `onClose` in its effect dependencies; `Navbar.jsx:159-160` passes a fresh `() => setCartOpen(false)` on every render, and a cart change re-renders the header (it shows the count). So the effect's cleanup (restore focus to the opener, `scrollTo`, unlock) and setup (move focus to the first control, lock) run on every quantity change **while the dialog is open**. The live bundle's `Ae` (same hook) has `[e,t,n,r]`.
* Same root cause, render side: `CartDrawer`, `SearchOverlay` and `PromoBar` re-render on every `Navbar` render (scroll flip, cart count, wishlist count): `bag: open drawer` = 43 fibers, 25 avoidable.
* Fix (repo, **patch 02**). `onClose` read through a ref in `useDialog`; `useCallback` for the two closers; `memo` on `CartDrawer`, `SearchOverlay`, `PromoBar`. Patched: `bag: qty +1` 72 -> 42 fibers, `search: open` 51 -> 31, `theme toggle` 44 -> 23. Live bundle: needs-storefront-rebuild (same two-line change in `Ae`).

### R1-03 (medium, R only) Product page: every size / fit / quantity click rebuilds the product, rewrites ~20 `<head>` tags, and resets the photo gallery to photo 1

* Evidence. `pdp: toggle size M,L,M` on the repo build: 238 fibers (132 avoidable), **139 DOM mutation records** (84 `meta`, 33 `link`, 6 `<head>` child changes, per 3 clicks); patched: 90 fibers, **11 records**. The live bundle does the same click in 255 fibers but only 15 mutation records: the live product page does NOT have the head rewrite. Gallery probe (`probe-gallery.mjs`, a product with 4 photos, tap photo 3, then pick size M): **repo-before resets to "Image 1 of 4"**; patched stays on photo 3; live stays on photo 3 (so this one is a regression only the repo source has, relevant the day this storefront goes live again).
* Cause. `ProductDetail.jsx:79` builds `product` with an object literal each render and `:86` calls `ahedDetail(slug)` (a new object per call); `carried/sizes/notCarried` (`:116-147`) and `jsonLd` (`:217`) depend on them, so they recompute; `usePageMeta` (`seo.js:65-139`) depends on `jsonLd` so its effect re-runs: `setTag` re-sets ~20 attributes (a `setAttribute` with the same value still produces a mutation record) and re-creates the JSON-LD `<script>`. `productImages(product)` (`:301`) is a new array each time, and `ProductGallery.jsx:42` resets index and zoom whenever `images` changes. 13+ `Chip`s get a fresh `onClick` each render (39 chip renders per 3 clicks).
* Fix (repo, **patch 04**). `useMemo` for `product`, `ahed`, `images`; `memo` on `ProductGallery`, `Chip` (takes `value` + stable `onPick`), `AhedSpec`, `BrandPlate`; cart/wishlist hooks from patch 01. Result above. Also visible: `pdp: qty +1` 151 -> 86 fibers (ar390), 65 -> 20 (en1280); `pdp: wishlist heart` 164 -> 42.

### R1-04 (medium, R) Shop: extra commit on every filter/sort after "show more"; the whole catalogue is serialised into `<head>`; filter/sort run on every render

* Evidence. `Shop` renders twice for one filter click once more than one page is showing (`shop: filter Women after load more`: 3 commits, **262 fibers**; patched 2 commits, **23 fibers**). At scale it is worse: with a 4,000-product catalogue and 108 cards shown, clicking "Men" first renders the new list with the OLD page count (up to 108 cards) and only then shrinks to 12: **1,010 fibers, 432 avoidable**; patched: **1 fiber**. Whole-catalogue JSON-LD: 18 kB / 0.4 ms to build at 46 products, **199 kB / 5.5 ms at 500, 1.6 MB / ~80 ms (31 ms build + 48 ms stringify) at 4,000** (`scripts/bench-shop.mjs`, loaded machine), re-done on every language change and when the live catalogue replaces the bundled one. The per-render filter+sort: 0.007 ms at 46, 0.5-5.5 ms at 4,000.
* Cause. `Shop.jsx:80` `useEffect(() => setShown(PAGE), [cat, sort, q])` commits the new list with the old page count first; `Shop.jsx:44-55` recomputes filter/search/sort on every render; `Shop.jsx:25-35` + `seo.js:231` list EVERY product in the ItemList.
* Fix (repo, **patch 03**): derive the page count during render (key = cat|sort|q), `useMemo` for filter and sort. **Not patched, recommended:** cap the JSON-LD ItemList at the first 24-50 products (it is a hint to crawlers, not a sitemap; the real one is `sitemap-products.xml`).

### R1-05 (low, L + R) Checkout: every keystroke re-renders the page

* Evidence. 20 keystrokes: **20 commits, 340 (live) / 360 (repo) fibers = 17-18 per key** of a ~90-fiber page (the `Field` wrapper alone is 10 per key), and **25 (live) to 34 (repo) DOM mutation records per key** (live 502-514 per 20 keys, repo 680): React rewrites the `name` attribute of every one of the ten controlled inputs on every update. Render-phase time is ~1-2 ms per key (repo `prof` 13-41 ms per 20 keys), so this is waste, not jank, at today's size.
* Cause. `Checkout.jsx:91` keeps all 13 fields in the page root; `CheckoutSteps` (x2), `PaymentMethods`, `Coupon`, `LocationNote` (fresh `update` closure, `:419`), `AreaSelect` (fresh `onPick`) re-render with it. Live `M/F/ge/i/de` are the same components.
* Fix (repo, **patch 05**, patch file only because `Checkout.jsx` is being edited by another lane): `memo` on `CheckoutSteps`, `PaymentMethods`, `Coupon`, `LocationNote` + a stable `updateNote`: **360 -> 260 fibers per 20 keys (-28%), 680 -> 460 DOM records (-32%, 34 -> 23 per key)**. The remaining 13 per key are the `Field` wrappers and `AreaSelect`; removing them means splitting the form into memoised field components, which touches the validation closure (`set` reads `form`/`submitted`) and was not attempted in a file under edit.

### R1-06 (low, L) The live header clock re-renders once a second on every page, for ever

Evidence and cause in section 3. 10-11 commits per 10 s, 1 fiber each, 2 DOM writes per second, a new `Intl.DateTimeFormat` per tick; the add-on's CSS animation overrides the transform it writes. Fix: needs-storefront-rebuild (tick on the minute, or drop the state). No add-on-side fix that is not a hack.

### R1-07 (low, R) Hero autoplay re-renders every slide on every tick

3 drawn/photo slides re-render on each tick although only two change `active` (default config: 1 commit and ~12 fibers per 6.5 s; measured with a 2.5 s interval: 76 fibers / 10 s, 60 after `memo(Slide)`; patch 06). The live shop has `autoplay:false`, so nothing ticks there.

### R1-08 (low, R, installed PWA only) Pull-to-refresh re-registers four window listeners on every drag frame

`PullToRefresh.jsx:97` depends on `pull` and `busy`, so each `touchmove` that changes `pull` tears down and re-adds `touchstart/move/end/cancel`. Patch 06 keeps both in refs (listeners registered once). Probe result in section 6.

### R1-09, R1-10, R1-15 (medium, R admin) See section 5b.

### R1-11 (low, L + R) AI panel

20 keystrokes: 21 commits, 42-43 fibers (2 per key: the panel and `Mic`, which gets fresh `onHeard/onDenied` closures, "ident" 21). Grows with the message log (the log and every `OrderCard`/`ProductRow` re-render per key); at today's 1-message size it is nothing. Not patched.

### R1-12 (low, hygiene) `Slide` calls `useState` after a conditional early return

`HeroSlider.jsx:307-322`: `if (item.kind === 'photo') return <PhotoSlide/>` precedes the hooks. Safe only because photo and drawn slides never share a key. Move the early return into a wrapper component.

### R1-13 (low, R) Gallery lens re-renders the gallery on every mouse move

30 mouse moves over the photo = 30 commits / 90 fibers (repo) and 33 commits / 270 fibers (live: 9 per move, the icons and buttons re-render too). `setLens` per `mousemove` is not throttled. Move the lens position to a CSS variable written from the handler (no state) or `requestAnimationFrame`-throttle it. Not patched.

### R1-14 (low) Suspense above the whole page

See section 6 (probe): the first visit to an un-prefetched lazy route swaps the whole page, header and footer included, for the skeleton while the chunk loads. Patch 08 moves a second boundary inside `<main>`.

## 5. Static review of `src/` (what was looked for, and what was found)

Line numbers are in the snapshot the measurements ran on; the patches `git apply --check` clean on the working tree at HEAD `b9e9f7fa`.

| pattern | result |
|---|---|
| Context provider `value={{ ... }}` created inline | 4 providers do it (`cart.jsx:65`, `wishlist.jsx:61`, `theme.jsx:23`, `LanguageContext.jsx:42`). Language and theme are harmless: the provider only re-renders on its own state and `main.jsx` hands it a stable `children`. **Cart and wishlist are the problem**: their value is one object holding the list AND the actions, and `add/setQty/remove/clear/toggle/has` are re-created each render (`cart.jsx:35-59`, `wishlist.jsx:55-57`), so any consumer re-renders on every change and nothing can be memoised on them. Finding R1-01. |
| fresh object / array / function literals handed to `React.memo` children | The repo has **no `React.memo` anywhere** (`grep` is empty), so nothing is defeated; the issue is the reverse: nothing is protected. Inline closures that would defeat memo once added: `Navbar.jsx:159-160` (`onClose={() => ...}` to the overlays), `ProductDetail.jsx` size/fit chip `onClick`, `Checkout.jsx:419` (`update`), `AreaSelect onPick`, `AssistantPanel` `Mic onHeard/onDenied`. R1-02, R1-03, R1-05. |
| index keys on dynamic lists | `key={i}` in 7 places (`LegalPage:35,39`, `AssistantPanel:113`, `HeroSlider:462,466`, `App:37`, `Home:135`, `Checkout:476`). All are static or append-only lists (legal text parts, SVG path parts, skeleton placeholders, 2 service tiles, the chat log, the applied-discount list), so no state is attached to the wrong row. **Pass.** |
| state kept too high | `Checkout.jsx:91` keeps the whole form (13 fields) in the page root: every keystroke re-renders the page (R1-05). `AssistantPanel:29` keeps `draft` next to the message log (2 fibers per key today, grows with the log, R1-11). `Navbar` holds search/cart/scroll state next to the two overlays (R1-02). Language/cart/wishlist at App level do **not** re-render the page by themselves: only consumers re-render. |
| derived state computed in effects (extra commit) | `Shop.jsx:80` `useEffect(() => setShown(PAGE), [cat, sort, q])` commits the new list with the OLD page count, then renders again (measured: `Shop` renders 2x for one filter click after "show more"). `ProductDetail` `useEffect(() => setFit(...))`, `ProductGallery.jsx:42` `useEffect(() => { setI(0); setZoom(false) }, [images])` (see below). R1-04, R1-03. |
| effects with unstable deps / render loops | **`useDialog.js:103` depends on `onClose`**, which callers pass as a fresh arrow every render (R1-02). **`ProductGallery.jsx:42` depends on `images`**, which `ProductDetail.jsx:301` rebuilds with `productImages(product)` on every render, so every size/qty click resets the gallery to photo 1 (R1-03). `PullToRefresh.jsx:97` re-registers four window listeners on every drag frame (R1-08). No effect loops: idle windows on the repo build are 0 commits / 10 s on all four pages. |
| `useMemo` that cannot hit | `ProductDetail.jsx:79` rebuilds `product` and `:86` calls `ahedDetail(slug)` (returns a new object each call) every render; `carried`, `sizes`, `notCarried`, `jsonLd` (`:124`, `:206`) all depend on them, so they recompute every render and `usePageMeta` (`seo.js:65-139`) rewrites ~20 `<head>` tags and re-creates the JSON-LD `<script>` each time (R1-03). |
| `setState` in scroll / resize / pointermove handlers | `Navbar.jsx:49-57` `setHidden` on scroll: React bails out when the value is unchanged; measured 3 screens of scrolling = 4 commits, none from the scroll handler itself. **Pass.** `PullToRefresh` `setPull` per `touchmove` (installed PWA only, R1-08). `ProductGallery.jsx:152-159` `setDrag`/`setLens` on every pointer/mouse move over the photo (re-renders the whole gallery per event; see R1-03 probe). No `resize` listeners in React code (the viewport resize measured 0 commits on the repo build). |
| heavy computation in render | `Shop.jsx:44-55` filter + substring search + copy + sort on every render: 0.007 ms at 46 products, 0.5-5.5 ms at 4,000 per render (`scripts/bench-shop.mjs`); `itemListJsonLd(catalogue)` at `Shop.jsx:25-35` builds and `usePageMeta` serialises the WHOLE catalogue into a `<script>`: 18 kB / 0.4 ms at 46, **1.6 MB / ~80 ms at 4,000** (R1-04). `CartDrawer` calls `loadDelivery()` (JSON.parse of localStorage) in render. `Inventory` (admin) recomputes cost/margin for every row on each poll (R1-09). |
| long lists without windowing | Shop is paged (12) but never windowed: 108 cards after 8 "show more" (measured below). Admin `Inventory` renders every variant TWICE (desktop table + phone list, CSS hides one) with a live `StockCell` input in each; `Orders` renders 100 rows twice; `Products` (Catalogue tab) renders every product (R1-09, R1-10). |
| Suspense / lazy boundaries that remount | One `Suspense` wraps the whole router (`App.jsx:61`), above `PublicSite`. See the probe in section 3: on the first visit to an un-prefetched lazy route the header and footer are hidden by React while the chunk loads and the `<Loading>` skeleton shows in their place. |
| timers that `setState` | `HeroSlider.jsx:163` interval (autoplay, default 6.5 s); `ProductCard.jsx:69` 1.2 s "added" tick; `Inventory` 15 s poll. The repo has no 1 Hz timer. (The live compiled bundle does: the header clock, R1-06.) |
| conditional hooks | `HeroSlider.jsx:307-322` `Slide` returns `<PhotoSlide/>` BEFORE its `useState/useEffect` calls. It works only because a photo slide and a drawn slide never share a React key; one refactor away from "rendered more hooks than during the previous render" (R1-12, hygiene). |

## 5b. Repo admin (`src/admin`), measured against a mock of `admin.php`

Tables E and F in section 2 are the full lists. What they say:

* **Tab switches** are cheap and clean: 37-51 fibers for the small screens (Brands, Slides, Promotions, Discounts, Settings, Overview), no timers, no leaks; `Dashboard` re-renders its two nav sets (sidebar + phone tab bar) on a tab click, 18 avoidable fibers, not worth a patch. Idle on Overview and Orders: 0 commits in 10 s.
* **R1-10 (medium) Orders: typing in the Track-ID box re-renders all 100 rows twice.** 20 keystrokes = **8,866 fibers (443 per key) at 1280 and 10,075 at 390, render-phase 1,111 ms** (loaded machine; 55 ms per key). Cause: `Orders.jsx` keeps `search` in the screen root and the 100 rows are inline JSX in `orders.map` (`Badge` x2 + `SourceCell` per row in the table, `Badge` per row in the phone list, both always rendered); `OrderDrawer` also gets a fresh `onClose` each render. Patch 07 (`OrderRow` / `OrderCard` memoised, only the visible layout rendered, stable `closeDrawer`): **8,866 -> 60 fibers (-99%), render-phase 1,111 -> 7 ms**; "filter paid" 1,009 -> 209 (109 at 390); "open a row" 223 -> 23. The DOM under the Orders tab shrinks from 2,975 to 1,875 fibers at 1280 (1,514 at 390).
* **R1-09 (medium) Inventory: cost grows with the number of sizes, and every state change re-renders every row.** Both layouts are always rendered, each row has a live `StockCell` input in each, and `save`/`onSave` are new functions each render. Measured with the mock's variant count raised (1280 px):

| variants | open the tab (fibers / render-phase) | save ONE stock count (fibers / DOM records) | the 15 s poll with identical data (fibers / DOM records) |
|---|---|---|---|
| 120 (the mock's size; the captured live stock table has 167 rows) | 291 fibers | ~490 (linear from the 500-row run) | ~245 (linear) |
| 500, before | 1,051 / 6.1 s | **2,028 / 4,016** (4 commits) | **1,014 / 2,004** |
| 500, after | 1,051 / 4.8 s | **32 / 18** | **14 / 4** |
| 4,000, before | 8,051 / 57 s | **56,093 / 112,037** (8 commits, 204 s of main thread) | **8,014 / 16,004** |
| 4,000, after | 8,051 / 33 s | **46 / 22** | **14 / 4** |

  (render-phase seconds are inflated by the machine load; the fiber and DOM-record counts are exact.) A single "save stock" produces 3-4 commits (`setBusy`, `setMsg`, `setBusy(null)`, `setState`) and each one re-renders every row; the 15 s poll replaces `state.rows` with an identical copy and re-renders everything too, forever while the tab is open. Patch 07: `Row`/`Card`/`StockCell` memoised with one stable `save(sku, value)`, the silent poll keeps the previous state when nothing changed, and only the visible layout is rendered (the Inventory tab's fiber tree 4,073 -> 2,142 at 1280). **Not fixed by the patch, and the next wall at 4,000 variants: the table itself is not paged or windowed** (opening the tab is 8,051 fibers either way).
* **R1-15 (medium, not patched) Catalogue tab (`Products.jsx`) renders every product with no paging.** Opening it with 500 products takes 3.4-5.2 s of render phase and with **4,000 products 28.6-30.4 s** on this machine (about 16,000 fibers, 4 per row), in both before and after builds because nothing there was changed. `Profiles.jsx` already pages by 20; the same pattern (or a 50-row window) is the fix.
* Not measured: the Profiles tab (not wired into the snapshot's nav), the order drawer's customer-edit form, the Slides uploader.

## 6. Patches (written and proven on a scratch copy; NOT applied to the repo)

All patches are in `rcw/R1-rerenders/patches/`, unified diffs relative to the repo root (`sporta-web/src/...`), generated from `tree-before` (the snapshot) and `tree-after` (patched). Apply in numeric order (04 uses hooks from 01). The eight applied in sequence to the snapshot reproduce `tree-after` byte for byte, and each one passes `git apply --check` against the working tree at HEAD `b9e9f7fa` (the last check; HEAD moved from `bd1071a3` to `e255012e` to `b9e9f7fa` while this ran) (other lanes were editing `Checkout.jsx` and `src/admin/*` at the time; those two patches are patch files only, as instructed).

| patch | files | + / - lines | fixes |
|---|---|---|---|
| `01-contexts-and-cards` | `lib/cart.jsx`, `lib/wishlist.jsx`, `components/ProductCard.jsx` | 132 / 55 | R1-01 |
| `02-header-and-dialog` | `lib/useDialog.js`, `Navbar.jsx`, `CartDrawer.jsx`, `SearchOverlay.jsx` | 30 / 11 | R1-02 |
| `03-shop` | `pages/Shop.jsx` | 33 / 13 | R1-04 |
| `04-product-page` | `pages/ProductDetail.jsx`, `ProductGallery.jsx`, `OptionBox.jsx`, `AhedSpec.jsx`, `BrandPlate.jsx` | 57 / 32 | R1-03 |
| `05-checkout` | `pages/Checkout.jsx`, `CheckoutSteps.jsx`, `PaymentMethods.jsx` | 15 / 8 | R1-05 |
| `06-hero-and-pull-to-refresh` | `HeroSlider.jsx`, `PullToRefresh.jsx` | 21 / 10 | R1-07, R1-08 |
| `07-admin-orders-inventory` | `admin/Orders.jsx`, `admin/Inventory.jsx`, new `admin/useDesktop.js` | 159 / 96 | R1-09, R1-10 |
| `08-suspense-inside-main` | `App.jsx` | 6 / 0 | R1-14 |

The "after" matrix (tables C, D, F, G, H) was built from patches 01-07; patch 08 only touches the router shell and was probed separately on a build containing 01-08 (suspense probe).

**Proof, in four parts.**

1. **The counter itself is right** (`scripts/selftest.mjs`, a 6-component known-answer app built with the same toolchain): one click on the parent must render App (state), Plain (wasted), MemoFresh (fresh closure defeats memo), Kids (parent JSX), Reader (context), Own (wasted) and skip the memoised child; a click on the child's own button must render only it. Result: **SELFTEST PASS**, every count and every reason class matches.
2. **Same interactions, before vs after** (same scripts, same machine, same quiet-wait): section 2 tables B, C, D. A scripted purchase of 16 interactions (load shop, scroll 3 screens, heart, filter, load more, open product, size / qty / add, open bag, qty, checkout load, 3 x 20 keystrokes) renders **3,794 -> 2,485 fibers at ar/390 (-35%), 4,034 -> 2,463 (-39%) en/390, 3,635 -> 1,856 (-49%) ar/1280, 3,782 -> 2,169 (-43%) en/1280**, and writes **30-35% fewer DOM mutation records**. Single actions, median of 15: heart tap with 36 cards 296 -> 29 fibers (render-phase 3.7 -> 0.7 ms, script 63 -> 12 ms); one size click 65 -> 23 fibers, 46 -> 4 DOM records; one checkout keystroke 18 -> 13 fibers, 34 -> 23 DOM records. Header hide/reveal on scroll 43 -> 22 fibers per flip. 4,000-product catalogue, 108 cards: heart tap 968 -> 29, filter 1,010 -> 1.
3. **Behaviour is unchanged where it matters** (`scripts/probe-func.mjs`, same 19 assertions on both builds): heart toggles, neighbours untouched, header count, localStorage, survives reload, second tab sync; show-more adds a page; a filter change restarts from one page; price sort ascending; size / fit chips; add stores slug/size/fit/qty; badge follows; drawer +/-, Escape (inert again), remove. Result: **19 passed, 0 failed on the unpatched build and 19 passed, 0 failed on the patched one** (`logs/probe-func-*.log`).
4. **Regression guards.** `test:perf` (the repo's `perf-budget-test.mjs`, pointed at a scratch production build of each tree served by our own server, not the shared preview): all deterministic budgets (request counts, font files, unused-JS share, CLS, FCP) pass on both builds with the same figures, e.g. `/checkout [en]` requests 17 / unused JS 53% (204 kB -> 202 kB); the only failures on either build are the frame-time assertions ("no frame over 50 ms": 6 on the unpatched build, 8 on the patched one, 1-7 frames of ~100, i.e. noise at load average 50) plus FCP 1812 ms vs a 1800 ms limit on the UNPATCHED build. Bundle cost of patches 01-06: main chunk +1.1 kB raw / +0.35 kB gzip, ProductDetail +0.17 kB / +0.09 kB, Shop +0.12 kB / +0.07 kB, Checkout +0.08 kB / +0.04 kB.

**Probes that back individual findings** (raw output in the appendix): focus (R1-02) before: Enter on "+" moves focus to Close, the second Enter closes the bag; after: focus stays, quantity 4. Gallery (R1-03): before resets to photo 1 on a size pick, after keeps photo 3. Suspense (R1-14): before the header is not displayed in 10/26 and 13/55 samples during the first visit to a lazy route; with patch 08 0/67 and 0/49. Pull-to-refresh (R1-08): one 25-step drag = **92 `addEventListener` + 92 `removeEventListener`** calls on `touchstart/move/end/cancel` and 91 fibers before; **0 / 0** and 33 fibers after.

## 7. Appendix: raw probe output

**focus, repo BEFORE** (`logs/probe-focus-repo-before.log`)

```
drawer open         {"active":"BUTTON Close tap flex items-center justify-","overflow":"hidden","scrollY":0}
focus on +          {"active":"BUTTON Increase quantity px-3 py-1 text-base font-bold ","overflow":"hidden","scrollY":0}
after Enter on +    {"active":"BUTTON Close tap flex items-center justify-","overflow":"hidden","scrollY":0}
after Enter again   {"active":"BUTTON Bag tap relative flex items-center","overflow":"","scrollY":0}
quantities now      ["3","1"] (2 -> 4 means both Enters hit the same + button)
```

**focus, repo AFTER** (`logs/probe-focus-repo-after.log`)

```
drawer open         {"active":"BUTTON Close tap flex items-center justify-","overflow":"hidden","scrollY":0}
focus on +          {"active":"BUTTON Increase quantity px-3 py-1 text-base font-bold ","overflow":"hidden","scrollY":0}
after Enter on +    {"active":"BUTTON Increase quantity px-3 py-1 text-base font-bold ","overflow":"hidden","scrollY":0}
after Enter again   {"active":"BUTTON Increase quantity px-3 py-1 text-base font-bold ","overflow":"hidden","scrollY":0}
quantities now      ["4","1"] (2 -> 4 means both Enters hit the same + button)
```

**focus, LIVE bundle** (`logs/probe-focus-live.log`)

```
drawer open         {"active":"BUTTON Close tap flex items-center justify-","overflow":"hidden","scrollY":0}
focus on +          {"active":"BUTTON Increase quantity px-3 py-1 text-base font-bold ","overflow":"hidden","scrollY":0}
after Enter on +    {"active":"BUTTON Close tap flex items-center justify-","overflow":"hidden","scrollY":0}
after Enter again   {"active":"BUTTON Bag navbar-cart tap relative flex ","overflow":"","scrollY":0}
quantities now      ["4","3","1"] (2 -> 4 means both Enters hit the same + button)
```

**gallery, repo BEFORE** (`logs/probe-gallery-repo-before.log`)

```
dots found: 8
before choosing: Image 1 of 4,Image 1 of 4,Image 2 of 4,Image 3 of 4,Image 4 of 4
after tapping photo 3: Image 3 of 4,Image 1 of 4,Image 2 of 4,Image 3 of 4,Image 4 of 4
after picking size M: Image 1 of 4,Image 1 of 4,Image 2 of 4,Image 3 of 4,Image 4 of 4    <- if this says photo 1 the page re-render reset the gallery
after picking size L: Image 1 of 4,Image 1 of 4,Image 2 of 4,Image 3 of 4,Image 4 of 4
repo/before: 30 mousemoves -> commits=30 rendered=90 (state 30) prof=29ms
   Arrow#q3jxp x60
   Frame#1tf2o x30
```

**gallery, repo AFTER** (`logs/probe-gallery-repo-after.log`)

```
dots found: 8
before choosing: Image 1 of 4,Image 1 of 4,Image 2 of 4,Image 3 of 4,Image 4 of 4
after tapping photo 3: Image 3 of 4,Image 1 of 4,Image 2 of 4,Image 3 of 4,Image 4 of 4
after picking size M: Image 3 of 4,Image 1 of 4,Image 2 of 4,Image 3 of 4,Image 4 of 4    <- if this says photo 1 the page re-render reset the gallery
after picking size L: Image 3 of 4,Image 1 of 4,Image 2 of 4,Image 3 of 4,Image 4 of 4
repo/after: 30 mousemoves -> commits=30 rendered=90 (state 30) prof=15.9ms
   Arrow#q3jxp x60
   Frame#1tf2o x30
```

**gallery, LIVE bundle** (`logs/probe-gallery-live.log`)

```
dots found: 6
before choosing: Image 1 of 3,Image 1 of 3,Image 2 of 3,Image 3 of 3
after tapping photo 3: Image 3 of 3,Image 1 of 3,Image 2 of 3,Image 3 of 3
after picking size M: Image 3 of 3,Image 1 of 3,Image 2 of 3,Image 3 of 3    <- if this says photo 1 the page re-render reset the gallery
after picking size L: Image 3 of 3,Image 1 of 3,Image 2 of 3,Image 3 of 3
live/before: 30 mousemoves -> commits=33 rendered=270 (state 38) prof=0ms
   z#z8z2y[,...i})=>(0,E.jsx)(|,{xmlns:|,width:t,height:t,viewBox:] x87
   R#2rxt4[button|aria-label|start] x58
   L#5ph0u[mouse|,{className:|,children:[(0,j.jsxs)(] x29
   ft#eykjc[circle|}),(0,E.jsx)(|,{d:] x29
   Ot#1sgrt[path|M15 5 8 12 15 19] x29
```

**suspense, repo BEFORE** (`logs/probe-suspense-before.log`)

```
first visit to lazy /about (chunk not prefetched): {"ev":["skeleton added"],"headerSame":true,"headerHiddenSamples":"10/26","footerSame":true,"comp":{"Loading#1suqm":{"renders":1,"mount":1},"ScrollManager#bf6z0":{"renders":1,"mount":0}},"commits":3,"rendered":29}
first visit to lazy /contact: {"ev":["skeleton added"],"headerSame":true,"headerHiddenSamples":"13/55","footerSame":true,"comp":{"Loading#1suqm":{"renders":1,"mount":1},"ScrollManager#bf6z0":{"renders":1,"mount":0}},"commits":3,"rendered":37}
second visit to /about (cached chunk): {"ev":[],"headerSame":true,"headerHiddenSamples":"0/84","footerSame":true,"comp":{"ScrollManager#bf6z0":{"renders":1,"mount":0}},"commits":2,"rendered":29}
```

**suspense, patch 08** (`logs/probe-suspense-after8.log`)

```
first visit to lazy /about (chunk not prefetched): {"ev":["skeleton added"],"headerSame":true,"headerHiddenSamples":"0/67","footerSame":true,"comp":{"ScrollManager#bf6z0":{"renders":1,"mount":0},"Loading#1suqm":{"renders":1,"mount":1}},"commits":4,"rendered":30}
first visit to lazy /contact: {"ev":["skeleton added"],"headerSame":true,"headerHiddenSamples":"0/49","footerSame":true,"comp":{"ScrollManager#bf6z0":{"renders":1,"mount":0},"Loading#1suqm":{"renders":1,"mount":1}},"commits":2,"rendered":36}
second visit to /about (cached chunk): {"ev":[],"headerSame":true,"headerHiddenSamples":"0/83","footerSame":true,"comp":{"ScrollManager#bf6z0":{"renders":1,"mount":0}},"commits":2,"rendered":29}
```

**pull-to-refresh, BEFORE** (`logs/probe-ptr-before.log`)

```
before {"commits":24,"rendered":91,"comp":{"HeroSlider#wi1fp":2,"Slide#12sit":14,"PhotoSlide#1nx6l":14,"LinkWithRef#15cvz":10,"IconArrowRight#13vob":14,"Svg#l7954":14,"PullToRefresh#1pkqy":23},"listen":{"add":92,"remove":92}}
```

**pull-to-refresh, AFTER** (`logs/probe-ptr-after.log`)

```
after {"commits":24,"rendered":33,"comp":{"HeroSlider#wi1fp":2,"IconArrowRight#13vob":4,"Svg#l7954":4,"PullToRefresh#j9inj":23},"listen":{"add":0,"remove":0}}
```

**counter self-test** (`logs/selftest.log`)

```
click #bump -> {"App":1,"Plain":1,"MemoFresh":1,"Kids":1,"Reader":1,"Own":1} {"state":1,"context":1,"props":0,"wasted":2,"wastedIdent":1,"wastedJsx":1} PASS
click #own  -> {"Own":1} {"state":1,"context":0,"props":0,"wasted":0,"wastedIdent":0,"wastedJsx":0} PASS
SELFTEST PASS (counts and reason classes match the known answer)
```

**behaviour parity, BEFORE** (`logs/probe-func-before.log`)

```
PASS  wishlist: tapped heart becomes pressed
PASS  wishlist: its neighbour is untouched
PASS  wishlist: header count shows 1
PASS  wishlist: saved to localStorage
PASS  wishlist: survives a reload
PASS  wishlist: second tap removes it
PASS  wishlist: a heart tapped in another tab appears here
PASS  shop: show-more adds a page (>= 24 cards)
PASS  shop: a filter change starts again from one page (<= 12 cards)  cards=12
PASS  shop: sort price low->high is ascending  3,3,3,3,3,4
PASS  pdp: size M pressed
PASS  pdp: size L replaces M
PASS  pdp: fit chip pressed
PASS  cart: add stores slug/size/fit/qty=2  [["flash-shorts-red","L","slim",2]]
PASS  cart: header badge shows 2
PASS  drawer: + raises the line to 3 and the badge follows
PASS  drawer: - lowers it to 2
PASS  drawer: Escape closes it (inert again)
PASS  drawer: remove empties the bag

before: 19 passed, 0 failed
```

**behaviour parity, AFTER**

```
PASS  wishlist: tapped heart becomes pressed
PASS  wishlist: its neighbour is untouched
PASS  wishlist: header count shows 1
PASS  wishlist: saved to localStorage
PASS  wishlist: survives a reload
PASS  wishlist: second tap removes it
PASS  wishlist: a heart tapped in another tab appears here
PASS  shop: show-more adds a page (>= 24 cards)
PASS  shop: a filter change starts again from one page (<= 12 cards)  cards=12
PASS  shop: sort price low->high is ascending  3,3,3,3,3,4
PASS  pdp: size M pressed
PASS  pdp: size L replaces M
PASS  pdp: fit chip pressed
PASS  cart: add stores slug/size/fit/qty=2  [["flash-shorts-red","L","slim",2]]
PASS  cart: header badge shows 2
PASS  drawer: + raises the line to 3 and the badge follows
PASS  drawer: - lowers it to 2
PASS  drawer: Escape closes it (inert again)
PASS  drawer: remove empties the bag

after: 19 passed, 0 failed
```

## 8. What was not checked, and what only the live site can confirm

* **The live site and database were unreachable** (Hostinger connector signed out). The "live" numbers are the captured live bundle and add-ons on a local mirror, with `/api` answered from the JSON captured on 2026-11-03. Real product photographs are `null` on live, so image decode, lazy-load and `onLoad` state changes of real photos are not in the numbers; a product with photographs has more state changes per card (`onLoad`, hover second image) than measured here. Real latency (the stock table, promo bar and slides arriving at different times) changes how many commits a load is split into, not how many fibers the interactions render.
* **The live /backends admin** is a compiled build behind sign-in; only the repo's admin was measured, against a mock of `admin.php`. The repo snapshot's admin has no Profiles tab in its nav (the screen exists but was not wired when the snapshot was taken), so Profiles was not measured.
* **Absolute milliseconds.** The machine was at load average 45-55 on 4 CPUs; `prof`/`task` are inflated and noisy. No CPU-throttled phone run was done here (the repo's own `test:perf` throttles 4x but its frame-time assertions failed on BOTH builds under this load, so it is not a signal; its deterministic budgets pass on both, see section 6).
* **Development / StrictMode behaviour** (double render, double effects) was not measured: it exists only in `vite dev`.
* **Checkout in quick mode** (saved details, lazy `QuickCheckout` card), the payment hand-off, the order-placed and payment-result pages, the AI panel with a long conversation, order lookup/returns/review forms, the gallery lightbox, and the repo `Cart`/`Wishlist` pages were not driven (they have form state at page level like Checkout and no timers; static review only).
* **Memory.** No heap profile; listener and timer counts were checked statically and by the idle windows only.
* **The React Compiler** (babel-plugin-react-compiler) would remove most of the memoisation in patches 01-05 automatically but is not in `package.json`; adopting it was not evaluated.


## 9. Files

`rcw/R1-rerenders/`: `rerenders.md` (this), `rerenders.json`, `tables.md`, `digest.json`, `patches/01..08*.patch`, `scripts/` (hook.js = the counter, run.mjs / run-admin.mjs = interaction scripts, probe-*.mjs, selftest.mjs, bench-shop.mjs, report.mjs), `data/` (every raw per-interaction result, per-component counts included), `logs/`, `tree-before/` and `tree-after/` (the snapshot and the patched copy), `out/` (scratch builds).
