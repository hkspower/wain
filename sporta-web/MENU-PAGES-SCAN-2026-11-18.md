# Main-menu pages scan, 2026-11-18 (CSS and JavaScript)

Owner: "scan all main menu pages css and js". Read-only. Nothing in the repo was changed by the scan, the live site and the VPS were not touched, and the
running test sandbox was not used. The scan ran its own Playwright (one Chromium at a time) against its own ephemeral ports.

**Update after the scan (added when saving this report):** the scan pinned the add-ons at commit `438ffb30`. Those blocks the scan labels "not live"
(PRICES-1118, the Add-to-bag link, LIVE STOCK-1118, and the matching `sporta-shadows.css`, `sporta-product-fix.css`, `sporta-ui-colours.css` lines) went live at
17:41 Kuwait / 16:41 UTC the same day in `deploy-20261118T164133Z-3aa05cc`. Nothing below was fixed by that deploy. Findings are NOT fixed; the owner decides.
Evidence (scripts, raw runs, PNGs): `/tmp/claude-0/-home-user-wain/a128f64c-8c94-5bf5-b35a-38b83867e084/scratchpad/menu-scan/` (a scratch folder, not kept in the repo).

**What was scanned.** The real compiled storefront (the 2026-11-03 capture, `scan-words/live`) served by `scripts/lib/add-to-cart-ux-live.mjs` with the repo's
add-on files on top, as the live `index.html` links them (14 stylesheets, 9 scripts). `sporta-admin-brands.js` is served as the 973-byte loader that `postbuild`
ships. The add-on files are a pinned `git archive` of commit `438ffb30` (hashes in `snap/ADDON-HASHES.txt`). Against what was live before today's last deploy
(`21516fa6` for the ten files released earlier) the snapshot differs in `sporta-features.js` (+271 lines), `sporta-shadows.css` (+60), `sporta-product-fix.css`
(+32) and `sporta-ui-colours.css` (+7/-3).

Earlier reports are not repeated (CARDS-SCAN, ICONS-SCAN, BACKENDS-SCAN, the CLAUDE.md "Deployed" notes, `PERFORMANCE.md` "Lighter admin CSS"); where this scan
confirms one of their open items it says so.

## Summary

**30 findings: 10 Medium, 12 Low, 8 Info, 0 High.** 84 page loads (64 on the menu) on the real compiled storefront with the repo's add-ons. No menu page overflowed
sideways, threw a JS error, lost the sticky header or trapped focus.

- Each page downloads 406,916 B of add-on CSS and 344,060 B of add-on JS (95 kB brotli each). 43% of the CSS is comments; the repo's own slim tool would save
  59.8 kB brotli.
- 54% of add-on rule bytes match on none of the 21 pages, including the 89 kB admin stylesheet.
- 145 of 201 `!important` declarations decide nothing, and `sporta-cat-tiles.css` loses to two later files.
- The five page links are not in a navigation landmark.
- Escape on the Sporta AI panel drops focus to `<body>`.
- The header overlaps at the owner's own 120% text size on 320 and 360 px phones.
- Footer anchors land 14 px under the header on phones.
- Add-ons cost about +100 to +120 ms main-thread time and 12 extra layouts per page.

## 1. The menu and the pages it reaches

The storefront has **no hamburger and no mobile menu**. The header is three rows on every page: the announcement bar (`p.topbar`), the brand row
(`nav.navbar-main`: Sporta AI launcher and clock, the logo, language toggle and bag) and the tab row (`.navbar-secondary`, five links). The footer holds the rest.
There is no category drop-down and no `/brands` page (it answers "Page not found"). "Brands" is seven chips on the home page linking to `/shop?brand=<slug>`.

| where | item | target | scanned as |
|---|---|---|---|
| header tab | Home / الرئيسية (and the logo) | `/` | home |
| header tab | Shop / المتجر | `/shop` | shop, `/shop?category=men`, `/shop?sale=1`, `/shop?brand=ahed` |
| header tab | About / من نحن | `/about` | about |
| header tab | Contact / اتصل بنا | `/contact` | contact |
| header tab | Account / حسابي | `/account` | account (signed out) |
| header tool | language toggle | button | clicked by keyboard on 8 page/width cells |
| header tool | bag | button, opens the bag drawer | drawer opened on home; `/cart` |
| header tool | Sporta AI | button, opens a panel | panel opened on home |
| footer | About us, Why Sporta? | `/about`, `/about#why` | about |
| footer | Terms, Shipping | `/terms`, `/terms#delivery` | terms |
| footer | Privacy, Returns, Track order, Support | `/privacy`, `/returns`, `/track`, `/support` | one page each |
| footer | Contact us, Account | `/contact`, `/account` | contact, account |
| footer | WhatsApp, phone, Instagram, TikTok | external | not followed |
| home | category tiles | `/shop?category=men`, `women`, `accessories`, `/shop?sale=1` | shop variants |

16 menu pages or states (home, shop, shop category, shop sale, shop brand, about, contact, account, returns, track, support, terms, privacy, cart, home with the
bag drawer open, home with the Sporta AI panel open) and 5 off-menu pages that load the same files, for comparison (a product, a product on sale, checkout,
wishlist, a 404). Each at 390 and 1280 px, Arabic and English, in a fresh browser context: 84 instrumented loads (64 menu). Variants: add-on scripts blanked and
every add-on blanked (40 loads each), dark theme (44 loads), 2 x 72 uninstrumented loads for cost, plus keyboard, language, drawer, scroll and text-size probes.

## 2. Result in numbers

- **30 findings: 10 Medium, 12 Low, 8 Info.** No High: no menu page overflowed sideways (0 px on 84 loads), threw a JS error (0), lost the sticky header or trapped
  focus. Every header control is at least 44 x 44 px.
- Every page downloads 14 add-on stylesheets (406,916 B; 112,102 gzip; 94,465 brotli) and 9 add-on scripts (344,060 B; 114,552 gzip; 95,031 brotli). That is 69% of
  the page's CSS bytes (78% of its brotli) and 46% of its JS bytes. 43% of the add-on CSS is comments.
- Of 1,104 add-on rules (227,939 B of rule text): **387 (38%) match something on a menu page, 122 (8%) only on product, checkout, wishlist or 404, 595 (54%,
  123,246 B) on none of the 21 pages.** 372 of those 595 (87,140 B) are the admin stylesheet.
- Add-on JS: 34 MutationObservers, 63 event listeners, 11 timeouts, 0 intervals, about 80 animation-frame callbacks per load; 0 console errors from JS; 3 extra
  requests per page.
- The add-ons together cost, unthrottled on a busy machine, about **+100 to +120 ms of main-thread time per page load** (456 / 418 ms against 359 / 296 ms without),
  **layouts 9.4 to 22 per load**, style recalculation 34 to 120 ms.
- Add-on layout shift is small (mean 0.005 on the 10 main pages) except `/account` on a phone (0.053 to 0.061, `birthday.js`). The add-on CSS itself removes 0.45 to
  0.50 on `/account` (0.037 to 0.005 mean across the 10 pages).

## 3. Findings

Severity is what a shopper or the owner would meet. "Fixable" says whether the smallest fix can live in an add-on CSS or JS file.

| ID | Sev | Finding | Pages |
|---|---|---|---|
| M-01 | Medium | 13 add-on stylesheets ship 173,644 B of comments, render-blocking | all |
| M-02 | Medium | the admin stylesheet (89,112 B, 372 rules, none match) is downloaded by every shopper page | all |
| M-03 | Medium | route-only JS ships and observes on every page (checkout-only files 68.9 kB, 7 product/checkout/receipt blocks 65.4 kB); 31 storefront observers also run on `/backends` | all |
| M-04 | Medium | the home "features" band is built by JS, styled by 17 rules, then hidden by `home-trim.css` | all run it, home builds it |
| M-05 | Medium | 145 of 201 `!important` declarations never decide anything, 36 lose to another `!important`; `sporta-cat-tiles.css` is overridden by two later files; colour is set in 10 files | home, shop, about, contact, cart |
| M-06 | Medium | add-on cost: layouts x2.3, style recalculation x3.5, +64 listeners, +0.9 long task per load | all |
| M-07 | Medium | the five page links are not in a navigation landmark; the only `<nav>` has no name and holds the tools | all |
| M-08 | Medium | Sporta AI panel: Escape closes it and focus falls to `<body>`; no `aria-controls`; the visible label is Arabic on the English page | all |
| M-09 | Medium | header at 120% text (the owner's own maximum) overlaps on 320 and 360 px phones; stacks at 150% and 200% | all |
| M-10 | Medium | footer links to `#delivery` and `#why` land the heading 14 px under the sticky header on a phone | terms, about |
| L-01 | Low | `sporta-clock.js` forces a layout on every page: the largest single add-on time (median 130 ms profiled) | all |
| L-02 | Low | three blocks insert DOM one frame late: `/account` 0.053 to 0.061 (phone), `/track` and `/cart` 0.004 to 0.005 (desktop) | account, track, cart |
| L-03 | Low | three extra requests per page from `sporta-features.js` (`r=content`, `r=text_style`, `variants.txt`, the known 404) | all |
| L-04 | Low | five global patches (`fetch`, `setAttribute`, `focus`, `scrollIntoView`, `history`) run on every page, three also on `/backends` | all |
| L-05 | Low | `birthday.js`'s own CSS loses to the compiled form-field rule | account |
| L-06 | Low | two add-ons decide the announcement bar; the earlier one is dead and its comment stale | all |
| L-07 | Low | 37 dark-theme rules (5.8 kB) a shopper cannot reach | all |
| L-08 | Low | add-on JS is unminified (-19.5 kB brotli possible) | all |
| L-09 | Low | the bag button's name has no item count and no `aria-expanded` although it opens a modal | all |
| L-10 | Low | the language toggle leaves the old `?lang=` in the address bar | all |
| L-11 | Low | a comment in `sporta-shadows.css` says the phone header slides away on scroll; it stays pinned (126 px, 15% of the screen) | all |
| L-12 | Low | 168 rules (27.9 kB) never matched in any state the scan could reach; not proven dead | product, checkout, states |
| I-01 to I-08 | Info | see section 8 | |

### A. Weight

**M-01 Medium. Stylesheets ship with their comments** (all pages). Comment bytes: `sporta-shadows.css` 53.9 kB, `sporta-product-fix.css` 23.7,
`sporta-checkout-a11y.css` 21.5, `sporta-bag-touch.css` 13.5, `sporta-ui-colours.css` 13.5, `sporta-grid.css` 10.2, seven smaller. The 13 storefront files are
317,804 B now. The repo's lossless tool (`scripts/build-addon-css.mjs --stats --all`, guarded, proven by `addon-css-slim-test.mjs`) says they would be 145,236 B:
gzip 99,913 to 28,761, brotli 84,444 to 24,608. That is **59.8 kB per first visit** in a render-blocking position (about 0.3 s at the 1.6 Mbit/s earlier perf work
used; arithmetic, not measured). Today the tool is applied to `sporta-admin-knet.css` only. Smallest fix: `node scripts/build-addon-css.mjs <name> --apply` per file,
one at a time (the readable source moves to `addons-src/`, no link or deploy name changes). Fixable: yes (tooling). Brotli here is Node's default quality; the
server's `mod_brotli` sends about 10 to 15% more.

| file | now: bytes / gzip / brotli | after the slim tool |
|---|---|---|
| sporta-product-fix.css | 41,177 / 13,058 / 11,187 | 17,585 / 3,416 / 2,967 |
| sporta-brand-theme.css | 12,276 / 4,453 / 3,754 | 5,155 / 1,276 / 1,073 |
| sporta-home-trim.css | 8,267 / 3,358 / 2,727 | 2,877 / 853 / 722 |
| sporta-cart-drawer.css | 13,788 / 4,753 / 4,014 | 6,301 / 1,598 / 1,356 |
| sporta-grid.css | 13,625 / 5,528 / 4,587 | 3,502 / 1,131 / 957 |
| sporta-bag-touch.css | 19,870 / 7,356 / 6,191 | 6,484 / 1,931 / 1,626 |
| sporta-cat-tiles.css | 8,191 / 3,293 / 2,738 | 2,878 / 962 / 828 |
| sporta-returns-touch.css | 4,957 / 2,036 / 1,693 | 1,497 / 509 / 416 |
| sporta-clock.css | 2,461 / 1,077 / 918 | 1,062 / 452 / 414 |
| sporta-ui-colours.css | 22,380 / 7,638 / 6,466 | 8,973 / 1,908 / 1,626 |
| sporta-checkout-a11y.css | 35,052 / 11,551 / 9,944 | 13,655 / 3,107 / 2,690 |
| sporta-shadows.css | 124,526 / 31,562 / 26,659 | 70,733 / 10,309 / 8,819 |
| sporta-images.css | 11,234 / 4,250 / 3,566 | 4,534 / 1,309 / 1,114 |
| **13 storefront files** | **317,804 / 99,913 / 84,444** | **145,236 / 28,761 / 24,608** (saves 172,568 B, 71,152 gzip, 59,836 brotli) |

**M-02 Medium. The admin stylesheet is on every shopper page** (all pages). `sporta-admin-knet.css` is 89,112 B (12,189 gzip, 10,021 brotli), 372 rules, 315
`!important`. **None of its 372 rules match on any of the 21 pages, in four configurations or in the dark theme.** This is the known item in `PERFORMANCE.md`
("Lighter admin CSS"), already slimmed from 178 kB. What remains is that the live `index.html` links it by name, render-blocking. Not fixable in CSS: the link and
name are fixed, and the `split-admin-addon.mjs` loader trick would add the stylesheet after first paint on `/backends` (a flash of unstyled admin; the "Payments has
no dark mode" rules must be present at first paint). Options: accept 10 kB, or test the loader on `/backends` first.

**M-03 Medium. Code for one route ships to, and watches, every page.**
(a) `sporta-checkout-a11y.js` (37,918 B) and `sporta-gov-autopick.js` (30,939 B) only act on `/checkout`: 68,857 B raw, 20,489 B brotli, 6 observers, 19 listeners,
3 timeouts and 8 animation-frame callbacks on every menu page.
(b) Seven blocks of `sporta-features.js` find their target only on a product page, at checkout or on the payment-result page, or are hidden (M-04): sizes 3,530 B,
image viewer 17,948, shipping 5,175, payment receipt 20,735, gallery 4,255, live stock 4,089, features band 9,622. Together **65,354 B (29% of the file) and 8
observers**.
(c) On `/backends` the storefront scripts create **31 MutationObservers** (features 18, footer-call 5, checkout-a11y 5, gov-autopick 1, clock 1, birthday 1) and
patch `fetch` and `focus`. Only 5 of the 19 blocks of `sporta-features.js` test the path; none of `sporta-footer-call.js`, `sporta-gov-autopick.js`,
`sporta-clock.js`, `sporta-checkout-a11y.js` or `birthday.js` do (table in section 6).
Smallest fix: the `split-admin-addon.mjs` pattern for the two checkout-only files (names are fixed by the live `index.html`; the loader fetches the real file on
`/checkout`), and a `/backends` early return in the blocks that lack one. Fixable: yes (add-on JS and build tooling).

**L-08 Low. The scripts are not minified.** 343,087 B raw (114,025 gzip, 94,647 brotli); 30% of `sporta-features.js` is comments. A comment and whitespace minify
(Vite's own transform, globals not mangled) gives 274,663 B, 90,528 gzip, 75,125 brotli: **-19.5 kB brotli**. Same `postbuild` hook as the admin split. Fixable:
tooling.

What each page downloads (English, 390 px; CSS is identical on every page except `/account` and `/returns`, which add a lazy route sheet; the compiled CSS is
184,995 B / 32,798 gzip / 26,458 brotli):

| page | CSS files | CSS bytes (gzip / brotli) | add-on share | JS files | JS bytes (gzip / brotli) | add-on share |
|---|---:|---|---:|---:|---|---:|
| home, drawer or panel open | 17 | 591,911 (144,900 / 120,923) | 69% | 13 to 14 | 746,488 to 754,158 (242,083 / 204,109 to 244,957 / 206,660) | 46% |
| shop (and its variants) | 17 | 591,911 (144,900 / 120,923) | 69% | 14 | 751,367 (244,225 / 205,943) | 46% |
| about | 17 | 591,911 (144,900 / 120,923) | 69% | 14 | 752,643 (244,724 / 206,216) | 46% |
| contact | 17 | 591,911 (144,900 / 120,923) | 69% | 14 | 749,149 (243,269 / 205,052) | 46% |
| account | 18 | 595,369 (144,900 / 120,923) | 68% | 15 | 774,253 (250,131 / 210,940) | 44% |
| returns | 18 | 602,698 (144,900 / 120,923) | 68% | 14 | 768,374 (249,708 / 210,549) | 45% |
| track, support, terms, privacy, cart | 17 | 591,911 | 69% | 14 to 15 | 752,392 to 758,813 (244,391 to 247,505 / 206,135 to 208,379) | 45 to 46% |
| product / checkout (off-menu) | 17 | 591,911 | 69% | 14 / 17 | 772,339 / 785,105 (250,120 / 211,312; 253,797 / 214,451) | 45% / 44% |

The two lazy route sheets (`/account`, `/returns`) are appended after all 14 add-ons, so ties there go to the compiled rule (I-08). Two script-injected `<style>`
elements exist: `sporta-features-css` (2,288 B, home only, M-04) and `sporta-bday-css` (748 B, `/account`).

### B. CSS that never matches, and CSS that fights

**How coverage was measured.** Every selector of every add-on rule was tested against every element of each page after load and scroll (and in two extra runs with
the bag drawer and the Sporta AI panel open), with `:hover`, `:focus*` and `:active` stripped. The result is unioned with Chromium's rule-usage tracking, so rules
matched by transient elements count. Rules inside `@media` are counted by selector, not by viewport. The dark theme was run separately (`sporta_theme=dark`,
explicit).

| file (link order) | bytes | gzip | brotli | comments | rules | `!important` | match on a menu page | only off-menu | never |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| sporta-product-fix.css | 41,177 | 13,058 | 11,187 | 57% | 109 | 6 | 2 (274 B) | 52 (7,369 B) | 55 (9,821 B) |
| sporta-brand-theme.css | 12,276 | 4,453 | 3,754 | 59% | 40 | 15 | 13 (1,856 B) | 6 (595 B) | 21 (2,567 B) |
| sporta-home-trim.css | 8,267 | 3,358 | 2,727 | 66% | 16 | 3 | 16 (1,948 B) | 0 | 0 |
| sporta-cart-drawer.css | 13,788 | 4,753 | 4,014 | 55% | 43 | 0 | 42 (5,731 B) | 0 | 1 (313 B) |
| sporta-grid.css | 13,625 | 5,528 | 4,587 | 75% | 25 | 20 | 23 (3,083 B) | 0 | 2 (260 B) |
| sporta-bag-touch.css | 19,870 | 7,356 | 6,191 | 68% | 41 | 2 | 40 (5,716 B) | 0 | 1 (310 B) |
| sporta-cat-tiles.css | 8,191 | 3,293 | 2,738 | 66% | 22 | 18 | 22 (2,602 B) | 0 | 0 |
| sporta-admin-knet.css | 89,112 | 12,189 | 10,021 | 0% | 372 | 315 | 0 | 0 | 372 (87,140 B) |
| sporta-returns-touch.css | 4,957 | 2,036 | 1,693 | 72% | 12 | 10 | 12 (1,234 B) | 0 | 0 |
| sporta-clock.css | 2,461 | 1,077 | 918 | 61% | 7 | 0 | 7 (764 B) | 0 | 0 |
| sporta-ui-colours.css | 22,380 | 7,638 | 6,466 | 61% | 43 | 34 | 25 (5,825 B) | 3 (613 B) | 15 (2,276 B) |
| sporta-checkout-a11y.css | 35,052 | 11,551 | 9,944 | 61% | 91 | 12 | 14 (1,209 B) | 44 (6,833 B) | 33 (5,785 B) |
| sporta-shadows.css | 124,526 | 31,562 | 26,659 | 43% | 257 | 28 | 162 (55,565 B) | 16 (2,381 B) | 79 (11,231 B) |
| sporta-images.css | 11,234 | 4,250 | 3,566 | 60% | 26 | 28 | 9 (927 B) | 1 (168 B) | 16 (3,543 B) |
| **14 files** | **406,916** | **112,102** | **94,465** | 43% | 1,104 | 491 | 387 (86,734 B) | 122 (17,959 B) | 595 (123,246 B) |

Per page, 105 to 259 of the 1,104 rules match (44,664 to 66,318 B of rule text, 11.0% to 16.3% of the 406,916 B downloaded): home 229 rules / 61,369 B (15.1%), shop
154 / 52,622 (12.9%), about 120 / 47,392 (11.6%), contact 127 / 48,804 (12.0%), account 125 / 48,758 (12.0%), returns 123 / 47,585 (11.7%), track 111 / 46,094
(11.3%), support 112 / 45,879 (11.3%), terms and privacy 119 / 46,689 (11.5%), cart 176 / 55,643 (13.7%), home with the bag drawer 259 / 66,318 (16.3%), home with the
AI panel 237 / 63,081 (15.5%).

Rules that never match, by cause (excluding the admin file): 223 rules, 36,106 B.
- 168 rules (27,857 B) need a state the scan did not reach (open photo viewer, a product with several photos or on sale, an invalid field, a chosen or sold-out
  size). See L-12.
- 37 rules (5,786 B) need the dark theme; 10 of them match when it is forced.
- 12 rules (1,803 B, in `sporta-ui-colours.css`) name `.admin-*` classes.
- 6 are `print` or reduced-motion rules.

Sections with the most CSS that matches nothing on a menu page:

| file | section | rules | rule bytes | menu | only off-menu | never |
|---|---|---:|---:|---:|---:|---:|
| product-fix.css | UX: ADD TO BAG (lane U3, 2026-11-04) | 65 | 11,068 | 274 | 3,348 | 7,446 |
| checkout-a11y.css | UX: U1 CHECKOUT | 43 | 7,943 | 0 | 3,506 | 4,437 |
| shadows.css | VIEWER-1112: full-screen product photo viewer | 38 | 5,388 | 0 | 199 | 5,189 |
| images.css | GALLERY-1114: several photographs on the product page | 12 | 3,035 | 0 | 0 | 3,035 |
| shadows.css | MOBILE-1112B: the phone items MOBILE-1112 left | 34 | 5,286 | 2,621 | 555 | 2,110 |
| ui-colours.css | Words and colours, live scan 2026-11-03 | 27 | 4,279 | 1,993 | 257 | 2,029 |
| product-fix.css | SIZES: the buy box | 16 | 2,251 | 0 | 1,071 | 1,180 |
| brand-theme.css | (head) | 24 | 3,722 | 1,742 | 150 | 1,830 |
| product-fix.css | LAYOUT: what the first screen shows | 12 | 1,938 | 0 | 1,938 | 0 |
| shadows.css | SALE PRICE 1118 | 12 | 2,004 | 338 | 303 | 1,363 |
| checkout-a11y.css | ONEPAGE: one-screen checkout | 13 | 1,595 | 0 | 979 | 616 |
| shadows.css | ICON SET (the largest section: 39 rules, 35,306 B, 33,775 B alive on menu pages) | 39 | 35,306 | 33,775 | 662 | 869 |
| checkout-a11y.css | TRIM-1112: more address details link | 8 | 1,371 | 0 | 1,217 | 154 |

`sporta-product-fix.css` (109 rules) matches on a menu page with 2 rules (274 B); `sporta-checkout-a11y.css` (91 rules) with 14 (1,209 B). They are product and
checkout files that every page downloads because the live `index.html` has one global `<head>`. After M-01 their weight is small (17.6 kB and 13.7 kB raw). Cannot be
split by route in CSS.

**M-04 Medium. A home "features" band that is built and then hidden.** The compiled home page has its own features band (`.home-features-wrap`). `sporta-features.js`
block L19 (9,622 B) still builds a second one, `#sporta-features`, after the hero (a heading, 4 cards, 2 buttons, 5 inline SVGs). It injects a `<style>` for it
(2,288 B) and keeps two MutationObservers and a `popstate` listener running on every page. `sporta-home-trim.css` then hides it with
`.campaign-home:has(.home-features-wrap) > #sporta-features { display: none !important }`; the probe shows `.sf` at 0 x 0 px on the 1280 px home page. 17 more CSS rules
(13,640 B, including generic ICON SET rules) exist for it: `sporta-shadows.css` 15 (CENTER-1118 `.sf__head`, `.sf__cta`, `.sf__titles`; ICON SET `.sf .sf__btn > svg`,
`.sf .sf__icon > svg:has(...)`), `sporta-ui-colours.css` `#main .sf__btn`, and the hide rule. Smallest fix: delete the block, its CSS and the hide rule together.
`test:home-features` and `test:center-text` fixtures would need updating. Fixable: yes (add-on JS and CSS).

**M-05 Medium. `!important` that decides nothing, and files that override each other.** `!important` is written 491 times in the 14 files, 315 in the admin file. The
other 176 (201 longhand declarations once shorthands are expanded) were checked on every scanned page against every other matched declaration, including inline
`style=""` attributes:
- **20 changed the outcome.**
- **145 were never needed** (removing them changes nothing in any scanned state): `sporta-shadows.css` 40 of 41, `sporta-grid.css` 41 of 44, `sporta-cat-tiles.css` 24 of
  59, `sporta-ui-colours.css` 12 of 16, `sporta-images.css` 12 of 14, `sporta-checkout-a11y.css` 7 of 10.
- **36 lose to another `!important`** (dead).

Caveat: `:hover`, `:focus` and open dialogs were not in this check, and an `!important` also guards against a style a script may add later. The add-ons are unlayered
and the bundle's Tailwind is in `@layer`, so an unlayered add-on rule beats any layered one before specificity is compared. The cascade across 1,872 distinct
winner/loser/property pairs:

| who wins | decided by | pairs | element-property cases |
|---|---|---:|---:|
| add-on over compiled | layer (unlayered beats `@layer`, add-on also stronger) | 666 | 28,781 |
| add-on over compiled | specificity | 474 | 26,621 |
| add-on over compiled | `!important`, and also stronger | 332 | 18,636 |
| add-on over compiled | `!important` only (the compiled rule would have won) | 40 | 1,130 |
| add-on over compiled | **load order only** (equal specificity) | 85 | 408 |
| add-on over compiled | both `!important`, specificity | 3 | 10 |
| compiled over add-on | specificity / order | 61 / 1 | 550 / 84 |
| add-on over another add-on file | both `!important`, specificity | 55 | 1,264 |
| add-on over another add-on file | `!important` only | 11 | 1,138 |
| add-on over another add-on file | specificity / important+stronger / **order** | 33 / 17 / 1 | 1,106 / 406 / 18 |
| inside one file | order / specificity / both `!important` (order, specificity) | 33 / 32 / 12, 6 | 508 / 714 / 148, 9,188 |

Where it matters (cross-file, values differ):
1. **`sporta-cat-tiles.css` is overridden by two later files.** 10 rule pairs, 1,008 element-property cases (360 with a different value), on the home page and its
   drawer and panel runs. Its `!important` radii (`.campaign-category`, `__arrow`, `__badge`), the scrim gradient (`.cat-scrim`, 3 variants) and the colours of
   `__brief`, `__arrow`, `__kicker`, `__badge` all lose to `sporta-shadows.css` (TILES-1111 / SHAPE-1111, `:root .storefront-root .campaign-category`, specificity
   0,3,0 against 0,1,0) and `sporta-ui-colours.css` (MONO-1112). 34 of its 59 `!important` longhands are dead on every page. Smallest fix: delete those declarations
   (`test:cat-tiles-crop` and `test:shape-1111` prove it). Note CLAUDE.md: that file holds unreviewed WIP, do not deploy it without a review.
2. **Colour has ten owners.** `color` is declared in 92 rules across 10 files, `font-size` in 69 rules in 10 files, `text-align` in 22 rules in 5 files. Text-align is
   nearly clean: one cross-file pair, `sporta-shadows.css` against `sporta-home-trim.css` on the home feature subtitle, shadows wins by load order (18 cases). The
   contested property is colour: 31 cross-file pairs, 27 with different values. MONO-1112 (`sporta-ui-colours.css`, `color: ... !important` through a `:where()`
   selector) overrides `sporta-brand-theme.css` (COLOURS-1118 small orange text), `sporta-cart-drawer.css` (`.purchase-count`, drawer secondary text),
   `sporta-grid.css` (price colour) and `sporta-shadows.css` (`img.catalog-card-photo { color: transparent }`, 372 cases, the known failing `test:storefront-polish`
   item in CLAUDE.md). The owner's 2026-11-12 "black and white only" decision is winning over the 2026-11-18 palette on those elements, and the losing declarations are
   dead and confusing. Smallest fix: remove them, or move the exceptions into the winning file.
3. **Load order alone decides 85 add-on-over-compiled pairs** (13 distinct rules): `.legal-page__contents a { min-height }`, `.purchase-notice`,
   `.payment-method--selected`, `.catalog-product-page .campaign-brand-plate`, `.sf__card h3 { line-height }`. They hold because the add-on sheets are linked after the
   compiled sheet; the two route sheets appended later break the tie the other way on `/account` and `/returns` (1 pair, 84 cases, harmless today).

No rule is duplicated: an identical selector + media + property occurs 0 times across files and 10 times inside one file, all intentional fallback pairs. The
duplicated sections that do exist are M-04 and L-06.

### C. JavaScript

| script (link order) | bytes | gzip | brotli | observers | listeners | setTimeout | rAF | self CPU ms, median (max) |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| boot.js | 8,322 | 3,524 | 2,825 | 0 | 2 | 1 | 0 | 3.6 (57) |
| config.js | 1,253 | 626 | 470 | 0 | 0 | 0 | 0 | 0.6 (1) |
| birthday.js | 22,564 | 8,336 | 7,057 | 1 | 4 | 0 | 5 | 2.0 (25) |
| sporta-features.js | 222,966 | 70,423 | 57,922 | 21 | 34 | 7 | 54 | 19.6 (489) |
| sporta-admin-brands.js (the 973-byte loader that ships; the 1.2 MB source loads only on /backends) | 973 | 527 | 384 | 0 | 1 | 0 | 0 | 0.6 (7) |
| sporta-footer-call.js | 16,987 | 6,071 | 5,092 | 5 | 2 | 0 | 13 | 0.8 (11) |
| sporta-gov-autopick.js | 30,939 | 11,864 | 9,995 | 1 | 8 | 3 | 0 | 1.3 (9) |
| sporta-clock.js | 2,138 | 960 | 792 | 1 | 1 | 0 | 0 | 132.3 (398) |
| sporta-checkout-a11y.js | 37,918 | 12,221 | 10,494 | 5 | 11 | 0 | 8 | 2.0 (90) |
| **9 files** | **344,060** | **114,552** | **95,031** | **34** | **63** | **11** | **80** | |

Median per page load over the 64 menu runs. Self CPU is from the V8 sampling profiler with the scan's instrumentation active, so it is inflated by about 16 ms of
wrapper cost and the machine was busy (load 5 to 16 on 4 CPUs); read it as relative. It excludes parse and compile time. No add-on uses `setInterval`. For scale, the
compiled bundle: `react-vendor` 83 ms, `index` 36 ms, 304 listeners.

**What the add-ons cost, measured without instrumentation** (`Performance.getMetrics` plus a long-task observer; home, shop, about, contact at 390 px Arabic and
1280 px English; 3 loads per cell; two independent rounds, shown round 1 / round 2):

| measure (mean of 8 cells, each the median of 3 loads) | all add-ons | no add-on JS | no add-ons | add-on JS costs | add-on CSS costs |
|---|---:|---:|---:|---:|---:|
| main-thread task time, ms | 456 / 418 | 365 / 363 | 359 / 296 | +91 / +55 | +6 / +67 |
| script time, ms | 139 / 133 | 109 / 112 | 119 / 107 | +30 / +21 | -10 / +5 |
| style recalculation time, ms | 122 / 119 | 93 / 91 | 34 / 34 | +29 / +28 | +59 / +57 |
| layouts | 22.0 / 21.8 | 9.8 / 9.6 | 9.4 / 9.3 | +12.3 / +12.1 | +0.4 / +0.4 |
| style recalculations | 28.5 / 28.1 | 19.0 / 19.6 | 29.0 / 29.1 | +9.5 / +8.5 | -10.0 / -9.5 |
| JS event listeners | 531 / 531 | 467 / 467 | 461 / 466 | +64 / +64 | +6 / +1 |
| long tasks over 50 ms (round 2 only) | 1.0 | 0.6 | 0.1 | +0.4 | +0.5 |
| total blocking time, ms (round 2 only) | 37 | 9 | 3 | +29 | +6 |

**M-06 Medium. The extra work is layout and style, not script time.** All add-ons together: +97 / +122 ms of main-thread task time (27 to 34%); style recalculation 34
to 119 ms (+57 from the stylesheets, +28 from the scripts); layouts 9.4 to 21.8 per load. The scripts more than double the layouts (+12), although layout-reading
calls are rare (clock 1 per page; features 62 only on the English home page's brand strip; 6 on `/about`). The cause is writes: about 80 animation-frame callbacks
per load, each script batching its own DOM write into its own frame. FCP moved +11 to +27 ms and LCP +33 to +65 ms, inside the run-to-run spread. Smallest fix: no
single line. Removing M-03 and M-04 removes about 11 observers, and the observer plus `requestAnimationFrame` pattern is the cause of L-02. Indicative only:
unthrottled, busy machine.

**L-01 Low. `sporta-clock.js` forces a layout.** `sync()` removes `is-sweeping`, sets three custom properties, reads `clock.offsetWidth` and adds the class back, once,
when the clock first mounts. The profiler puts **130 ms median (up to 398 ms) of self time** on that one function on every page, about 80% of all add-on script time.
Changing it to "force the reflow only if the class was already on" took `sync` from 76 to 140 ms (6 runs) to 0 ms. It left the layout count and layout time where
they were (22 / 21 / 27 against 23 / 24 / 25): the layout still happens, it is just no longer billed inside a MutationObserver callback in the middle of React's
commit. So the real gain is small and the fix is one `if`. Fixable: yes (add-on JS, tested on a copy).

**L-02 Low. DOM inserted one frame after the app paints.** Layout shift (all add-ons / add-on scripts blanked / every add-on blanked), 10 main pages:

| page | ar 390 | en 390 | ar 1280 | en 1280 |
|---|---|---|---|---|
| home | 0.010 / 0.010 / 0.010 | 0.011 / 0.011 / 0.011 | 0.003 / 0.003 / 0.003 | 0.003 / 0.003 / 0.004 |
| shop | 0.001 / 0.001 / 0.004 | 0.000 / 0.000 / 0.001 | 0.000 / 0.000 / 0.005 | 0.000 / 0.000 / 0.000 |
| about | 0.003 / 0.002 / 0.001 | 0.001 / 0.001 / 0.001 | 0.008 / 0.004 / 0.001 | 0.001 / 0.000 / 0.000 |
| contact | 0.003 / 0.001 / 0.001 | 0.000 / 0.001 / 0.001 | 0.001 / 0.001 / 0.000 | 0.000 / 0.000 / 0.000 |
| account | **0.061 / 0.001 / 0.452** | **0.053 / 0.000 / 0.503** | 0.013 / 0.000 / 0.215 | 0.012 / 0.000 / 0.237 |
| returns | 0.001 / 0.001 / 0.001 | 0.001 / 0.001 / 0.001 | 0.000 / 0.000 / 0.000 | 0.000 / 0.001 / 0.000 |
| track | 0.003 / 0.001 / 0.001 | 0.003 / 0.001 / 0.001 | 0.004 / 0.000 / 0.000 | 0.005 / 0.000 / 0.000 |
| support | 0.001 / 0.001 / 0.001 | 0.001 / 0.002 / 0.001 | 0.000 / 0.000 / 0.000 | 0.001 / 0.001 / 0.000 |
| terms | 0.001 / 0.001 / 0.002 | 0.000 / 0.000 / 0.001 | 0.000 / 0.000 / 0.000 | 0.000 / 0.000 / 0.000 |
| cart | 0.002 / 0.002 / 0.001 | 0.002 / 0.001 / 0.001 | 0.003 / 0.000 / 0.000 | 0.004 / 0.000 / 0.000 |
| **mean of 40** | 0.005 / 0.001 / 0.037 | | | |

What the scripts still cause:
- **`/account`, 0.053 (en) and 0.061 (ar) on a phone, 0.012 to 0.013 on desktop.** `birthday.js` inserts the birthday field after the form is painted: the first field
  drops 129 to 135 px at 0.9 to 1.1 s and the terms line and button follow. This is the open item "the 0.06 left on /account" in CLAUDE.md, now measured; with the
  scripts blanked it is 0.000 to 0.001.
- **`/track` and `/cart` at 1280 px, 0.004 to 0.005.** `sporta-footer-call.js` inserts "Call us" next to the compiled club button after paint and the button jumps
  446 px (1085 to 639) at 739 to 914 ms.

Both blocks schedule the insert with a MutationObserver and `requestAnimationFrame`, as most blocks do. Tried on copies served from memory (nothing written): running
the insert directly inside the observer callback gives **`/account` 0.053 / 0.061 to 0.000 / 0.001 (3 runs each); `/track` and `/cart` 0.0035 to 0.0054 down to 0.0003
to 0.0015 (4 runs)**. Smallest fix: in `birthday.js` `schedule()` and in the two `schedule()` functions of `sporta-footer-call.js`, call the work directly instead of
through `requestAnimationFrame` (it is idempotent and already guarded by `queued`). Fixable: yes (add-on JS).

Other nodes that move: the announcement text and its dot (0.0007 per page, the saved message arriving; `sporta-images.css` FRAMES holds it to one line), and the home
brand strip (0.010 on a phone, 0.010 without add-ons too, so not an add-on). `/about` desktop Arabic was 0.218 on the live site (CLAUDE.md, "cause not traced"). The
scan could not reproduce it: 0.008 with the scripts, 0.004 without. The Adobe Fonts kits are blocked in the sandbox, which points at the font swap rather than an
add-on.

**L-03 Low. Three requests the add-ons add to every page** (full page minus the same page with the scripts blanked): `/api/api.php?r=content` (Site content block),
`?r=text_style` (Text style block), and `/images/products/responsive/variants.txt` (Image variants block, the known 404 "every storefront page logs one 404").
`/about` also requests `?r=brands` once. In the capture the first two answer 404 because it predates them; live they answer 200. No GET is repeated inside a page load
(only two font files on `/about`, compiled). JS console: 0 errors, 0 warnings from add-ons; every console message is a missing capture file (404) or one of the two
aborted font kits. Smallest fix: none needed for the first two; the third is the old `make-image-variants.mjs` item.

**L-04 Low. Global patches.** `sporta-features.js` replaces `window.fetch` (SHIPPING block, to add the governorate to quote requests),
`Element.prototype.setAttribute` (Image variants block, so `srcset` is set before `src`; guarded on `/backends`), and `HTMLElement.prototype.focus` and
`Element.prototype.scrollIntoView` (MOBILE-1112B, for the Sporta AI panel; no path guard). The 973-byte admin loader wraps `history.pushState` and `replaceState`. All
pass through and are wrapped in try/catch. The profiler shows 4.5 ms mean for `setAttribute` and 1 ms for `fetch` per page, and `focus` up to 309 ms in 8 of 64 runs
(it contains the native focus work and the layout it forces). They are the first place to look if a keyboard or image bug appears.

**L-05 Low. `birthday.js`'s own CSS loses.** On `/account` the injected `.sporta-bday select` rule (border, font, background, min-height) is beaten on specificity by
the compiled `.storefront-root :is(input[type="text"], ... select)` rule (456 cases). The selects take the compiled field look. If that is intended, the CSS is dead.
Fix: drop the losing properties or raise the selector.

**L-06 Low. Two add-ons decide the announcement bar.** `sporta-bag-touch.css` [menu-1] (2026-11-04) lets the bar wrap to two lines ("grows to 36 px for 2 lines").
`sporta-images.css` [frm-1] (2026-11-10) forces one line with an ellipsis, all `!important`, and wins (210 cases). The bar is 28 px at 390; the saved Arabic and
English messages fit at 390 (273 and 297 px, not clipped) and clip at 320 for English (297 of 275 px). The older block's two-line behaviour and its header comment are
stale. Fix: delete [menu-1]'s clamp, or say in its comment that [frm-1] wins.

### D. The menu itself

**M-07 Medium. The five page links are not in a navigation landmark.** The only `<nav>` on the page is `nav.navbar-main`, unnamed; it holds the logo link, the AI
button, the clock, the language button and the bag, not the tabs. The tabs are a `ul` in `div.navbar-secondary` outside any landmark, and the footer's two link lists
("Information", "Navigate") have no `<nav>` either. A screen-reader user listing landmarks finds one unnamed "navigation" with one link. Tried in memory:
`role="navigation"` plus `aria-label="Main"` on `.navbar-secondary` gives "Main: 5 links". Smallest fix: one block in a header or footer add-on (`sporta-footer-call.js`
style) that sets the two attributes, and `aria-label` on the footer's two groups. Fixable: JS only, not CSS.

**M-08 Medium. The Sporta AI panel does not hand focus back.** Open with Enter: focus moves into the input and `aria-expanded` becomes `true`. Press Escape straight
away: the panel closes, `aria-expanded` becomes `false`, and **`document.activeElement` is `<body>`** (390 and 1280). Clicking the launcher again keeps focus on it, so
only the keyboard path loses its place and the next Tab starts again at the skip link. The panel is `role="dialog" aria-modal="false"` (Tab leaves it, correct for
non-modal). The launcher has no `aria-controls`. Its visible label "سبورتا AI" is Arabic on the English page while its accessible name is "Open the Sporta assistant"
(WCAG 2.5.3 label in name; the label is hidden under 640 px). Smallest fix: on Escape, focus the launcher (add-on JS; the bag-accessibility block in
`sporta-footer-call.js` is the model), and `aria-controls` from the panel's id. The panel component is compiled, so it can only be patched from outside.

**M-09 Medium. The header does not survive larger text on small phones.** The owner's Text styles setting (`html[data-sporta-size="120"] { font-size: 120% }`,
`sporta-brand-theme.css` TEXTSTYLE-1118, live since 13:05 UTC today) scales the whole header, whose controls are rem-sized. Measured by setting the root font size
(English):

| viewport | text size | header height | tools / logo overlap | logo / actions overlap | five tabs |
|---|---|---:|---:|---:|---|
| 390 | 100% | 126 | 0 | 0 | fit (390 of 390) |
| 360 | 100% | 126 | 0 | 0 | fit |
| 360 | 120% | 151 | 5 px | 5 px | scroll sideways (367 of 360) |
| 320 | 120% | 151 | 25 px | 25 px | scroll sideways (367 of 320) |
| 390 | 150% | 188 | 35 px | 35 px | scroll sideways (459 of 390) |
| 390 | 200% | 250 | stacked | stacked | scroll sideways (612 of 390) |

At 200% on 320 px the clock, logo, language and bag draw over each other (`menu-narrow-en-320-200.png`) and the sticky header is 250 of 844 px (30%). Hiding the clock
(`.app-header .navbar-tools .clock { display: none }`) removes only the tools/logo overlap; the logo/actions overlap stays (5 px at 360, 25 px at 320) because the grid
centres the logo with equal side columns. Smallest fix needs a design call: below 400 px drop the centred-logo rule (`grid-template-columns: auto 1fr auto`) or cap
the header's own size. Fixable: yes (add-on CSS).

**M-10 Medium. Anchors land under the sticky header on a phone.** The footer links "Shipping" (`/terms#delivery`) and "Why Sporta?" (`/about#why`) scroll the section
heading to **112 px** from the top (the compiled `scroll-mt-28`), under a header that is **126 px** tall, so 14 px of the heading is hidden (measured by clicking the
footer links and by loading the URLs directly). `[sog-8]` in `sporta-shadows.css` adds `scroll-padding` from 1024 px up and leaves phones alone "because their
header slides away while scrolling down". It does not: scrolling 160 px at a time down to 1920 px and back on `/shop` at 390 and 1280, the header stayed at top 0
throughout (L-11). Tried in memory: `html { scroll-padding-top: 1rem }` on phones puts the headings at 128 px with 0 px hidden. On desktop the headings land at 286 px,
141 px below the 145 px header (`scroll-padding` 10rem plus `scroll-margin` 7rem add up); cosmetic. Smallest fix: `@media (max-width: 1023px) { html {
scroll-padding-top: 1rem } }` in `sporta-shadows.css`. Fixable: yes (add-on CSS). A direct load of `/terms#delivery` does scroll to the section, but only after the
lazy page renders, more than 2 s later on the scan machine.

**L-09 Low. The bag button.** Its accessible name is "Bag" / "الحقيبة" whatever it holds; the visible count badge ("1" in the test) is not part of the name, so the
item count is not announced. It opens a modal drawer but has no `aria-expanded` or `aria-haspopup`. The drawer itself is correct (section 4). Fix: put the count in
`aria-label` and set `aria-expanded` on open, in the bag-accessibility block. Fixable: add-on JS.

**L-10 Low. The language toggle leaves the old query string.** The switch is quick (125 to 351 ms), causes no layout shift, leaves the header unchanged, keeps focus on
the button, stores the choice, and updates canonical and `og:locale`. But the address bar keeps `?lang=en` after a switch to Arabic and `?lang=ar` after a switch to
English. A reload follows the stored choice, so the page is right; a copied link names the other language. This is the compiled app's routing; it cannot be fixed in
add-on CSS or JS without taking over its routing.

**L-11 Low. The header is always pinned.** At 390 px it is 126 px of an 844 px screen (15%) on every page except checkout, where the one-page checkout CSS makes it
static. Nothing slides away. The `[sog-8]` comment says otherwise (M-10); the comment is what to correct.

### E. Smaller items

**L-07 Low. Dark-theme rules a shopper cannot reach.** 37 rules (5,786 B): `sporta-product-fix.css` 17, `sporta-brand-theme.css` 6, `sporta-shadows.css` 10,
`sporta-checkout-a11y.css` 4. The storefront has no theme control (header, footer, account and bag were checked). Dark appears only if `localStorage.sporta_theme` is
`dark` and `sporta_theme_explicit` is `1`, for example for someone who chose it in `/backends`. With that forced, 10 of the 37 match. Keep or drop is the owner's call.

**L-12 Low. 168 rules (27,857 B) never matched in a state the scan could reach.** The viewer lightbox (`sporta-shadows.css` VIEWER-1112, 38 rules, 5,388 B), the buy
bar's disabled and selected states (`sporta-product-fix.css` ADD TO BAG, 25 rules), several photos (`GALLERY-1114`, 12 rules), sale prices (`SALE PRICE 1118`, 12
rules), invalid fields, the one-page checkout. They are state-dependent, not proven dead; one test per section would settle it.

## 4. Menu behaviour, as measured

Keyboard, from the top of the page, Arabic and English, 390 and 1280 px:
- **Tab order (home):** skip link, Sporta AI, logo, language, bag, the five tabs in reading order (Home first in both languages), then the page. Focus rings are 3 px
  solid, orange on the dark header and white on the orange buttons.
- **Targets:** every header control is at least 44 x 44 px (AI 44 x 44, logo 91 x 44, language 47 x 44, bag 44 x 44, tabs 72 x 44 at 390; 46 px rows at 1280). Every
  footer link is at least 44 x 44.
- **Active page:** Home, Shop (also on `/shop?category=`, `?sale=` and `?brand=`), About, Contact and Account carry `aria-current="page"`. Nothing is marked on
  returns, track, support, terms, privacy, cart, wishlist, product or checkout. The active tab keeps the same white text as the others (MONO-1112); the orange
  underline is the visual cue.
- **Bag drawer** (`<aside aria-modal="true" aria-label="Your bag">`): opens on Enter and moves focus to Close. 14 Tabs never left it (it cycles Decrease, Increase,
  Remove, Checkout, Back to shop, Close). Escape closes it and returns focus to the bag button. `body` gets `overflow: hidden` while it is open and a mouse wheel does
  not scroll the page. It is full width on a phone and 471 px wide at the end edge on 1280 px. Identical in Arabic.
- **Sporta AI panel:** `aria-expanded` follows, focus goes to the input, no scroll lock (non-modal). Escape: M-08.
- **Language toggle:** Enter switches `lang` and `dir`; header height unchanged; the top bar text switches; `localStorage.lang` is stored; focus stays (L-10).
- **RTL:** the five tabs mirror (Home at the right edge). The brand row does not: `nav.navbar-main` computes `direction: ltr` on the Arabic page, so the Sporta AI and
  clock stay left and the language and bag right in both languages, with the logo centred to the pixel (149 to 240 of 390). Tab order in Arabic therefore runs left to
  right through the brand row and right to left through the tabs (I-02).
- **Header height, every page:** 390 px: header 126 px, announcement bar 28 px, sideways overflow 0 px on 42 loads; 1280 px: header 145.046875 px, announcement bar
  33.7 px, overflow 0 px on 42 loads. The bar holds one line at both widths (text 273 and 297 px, not clipped at 390). Header position is `sticky`, top 0, on every
  page and width except checkout on a phone.
- **Sideways scroll:** none on 84 loads, and none at 320 and 360 px at 100% text. At 120% and above the tab row scrolls sideways inside itself by design (scrollbar
  hidden), and M-09 applies.
- **SPA navigation:** Enter on each tab navigates without a reload, updates the title and `h1`, and leaves focus on the link pressed (no focus move to the new page; the
  only announcements are the page's own `role="status"` regions such as "46 products", "Showing 12 of 46"). Pressing Home on Home does not scroll to the top.
- **Reduced motion:** with `prefers-reduced-motion: reduce` the clock does not sweep (the second hand is hidden); otherwise three animations run.

## 5. Checked and found fine

- No sideways scroll, 44 px targets, sticky header and one-line announcement bar on every page and width; header 126 px on a phone and 145.05 px on desktop on all 21
  pages.
- Admin code is not on shopper pages: `sporta-admin-brands.js` is the 973-byte loader (0.6 ms); `/backends` still loads the full file once (BACKENDS-SCAN). The
  `.full.js` 404 in the scan's probe is the snapshot not shipping it.
- No JS error and no unhandled rejection on any page, nor in the bag or assistant states. No `innerHTML`, `eval`, `document.write` or `console.*` in any storefront
  add-on script.
- No duplicated request inside a page load except two font files on `/about` (compiled); the add-ons add only the three requests in L-03.
- No identical rule appears twice across the 14 files. The cascade order is stable: compiled, 14 add-ons in link order, route CSS, script-injected `<style>`.
- 1,472 of 1,872 rule pairs are an add-on beating a bundle rule on layer, specificity or a redundant `!important`, as the add-on model intends.
- No add-on uses `setInterval`; no add-on removes a listener; each adds its listeners once per load (63).
- The bag drawer is a correct modal (trap, Escape, focus return, scroll lock) in both languages and widths, and the bag page labels each line's buttons
  (`sporta-footer-call.js` L174).
- Language toggle: updates `lang`, `dir`, canonical (`.../shop` against `.../shop?lang=en`) and `og:locale` with 0 layout shift.
- Skip link, focus rings, `aria-current` and 44 px targets exist in both languages (ICONS-SCAN and CARDS-SCAN did not cover them; they hold).
- Caching: the add-on files are `no-cache, must-revalidate` with the suffix-stripping rule, so a returning visitor pays 23 empty 304s, not 23 bodies (`.htaccess`,
  `htaccess-rules-test.mjs`).

## 6. JavaScript blocks, guards and runtime

Per block of every storefront add-on script: size, page scope (from its own header comment), whether a once-only guard (`window.__sporta...`, a hook flag or a DOM
marker) was found in its first 40 code lines, whether it tests `/backends`, and what it does on an average menu page. A "NO" is a static finding of the first 40
lines; a flag later in the block (`queued`, a DOM id) can still make a block idempotent, and several are.

| block | bytes | scope | once-only guard | `/backends` guard | observers | listeners | setTimeout |
|---|---:|---|---|---|---:|---:|---:|
| boot.js L4 first-paint setup (language, theme, hero size, text style) | 7,275 | all | yes | yes | 0 | 1.0 | 1.0 |
| boot.js L156 Adobe Fonts kits made non-blocking | 489 | all | NO | no | 0 | 1.0 | 0 |
| birthday.js L15 birthday picker (/account) | 11,356 | all | NO | no | 1 | 0.3 | 0 |
| birthday.js L264 RACES: bag between tabs, discount key, stale reload | 5,384 | all | NO | no | 0 | 2.0 | 0 |
| birthday.js L367 coupon Enter guard (/checkout) | 611 | checkout | NO | no | 0 | 1.0 | 0 |
| birthday.js L381 pageshow reload (/checkout) | 612 | checkout | NO | no | 0 | 1.0 | 0 |
| features.js L19 features band (home), hidden by home-trim.css | 9,622 | home | NO | no | 2 | 1.0 | 0 |
| features.js L232 product sizes from stock | 3,530 | product | DOM marker | no | 1 | 1.0 | 0 |
| features.js L339 brands (banner, plate, chips, /about names) | 36,493 | home, shop, about, product | yes | no | 4 | 2.1 | 0 |
| features.js L1126 image variants (hooks setAttribute) | 11,343 | all | hook flag | yes | 1 | 1.0 | 0 |
| features.js L1369 add to bag | 13,368 | product, cards | yes | no | 2 | 3.0 | 0 |
| features.js L1691 site content (r=content) | 30,213 | all | yes | no | 0.1 | 1.1 | 0 |
| features.js L2295 photo backdrop | 7,468 | product, cards | NO | yes | 0 | 3.0 | 0 |
| features.js L2459 image viewer | 17,948 | product | yes | yes | 1 | 12.0 | 0 |
| features.js L2777 product-name tooltip | 780 | cards | NO | no | 1 | 0 | 3.4 |
| features.js L2822 shipping (wraps window.fetch) | 5,175 | checkout | yes | no | 1 | 1.0 | 1.0 |
| features.js L2963 payment receipt | 20,735 | payment result | yes | no | 2 | 1.0 | 0 |
| features.js L3322 MOBILE-1112B (patches focus, scrollIntoView) | 1,738 | all | NO | no | 0 | 0 | 0 |
| features.js L3376 MOBILE-1112 | 1,912 | all | NO | no | 1 | 1.0 | 3.5 |
| features.js L3430 gallery-1114 | 4,255 | product | yes | yes | 1 | 3.0 | 0 |
| features.js L3518 JSON-LD fix | 1,712 | product | yes | no | 1 | 0 | 0 |
| features.js L3569 meta / heading fix | 3,309 | all | yes | no | 1 | 1.0 | 0 |
| features.js L3652 text style | 2,314 | all | yes | yes | 1 | 0 | 0 |
| features.js L3719 PRICES-1118 | 9,729 | cards, product, bag | yes | no | 1 | 0 | 0 |
| features.js L3884 LIVE STOCK-1118 | 4,089 | product | yes | no | 0 | 3.0 | 0 |
| footer-call.js L24 tap-to-call footer link | 3,157 | all | NO | no | 2 | 1.0 | 0 |
| footer-call.js L100 Support link in the footer | 1,833 | all | NO | no | 2 | 0 | 0 |
| footer-call.js L174 bag accessibility | 6,065 | all | yes | no | 1 | 1.0 | 0 |
| gov-autopick.js L11 governorate from area | 4,698 | checkout | DOM marker | no | 0 | 1.0 | 0 |
| gov-autopick.js L102 optional delivery location | 18,726 | checkout | yes | no | 1 | 3.0 | 3.5 |
| gov-autopick.js L489 area list on a touch screen | 1,550 | checkout | NO | no | 0 | 4.0 | 0 |
| clock.js L6 header clock hands | 1,778 | all | NO | no | 1 | 1.0 | 0 |
| checkout-a11y.js L21 aria-required on delivery fields | 1,684 | checkout | NO | no | 1 | 1.0 | 0 |
| checkout-a11y.js L95 U1 checkout UX | 7,085 | checkout | yes | no | 1 | 2.0 | 0 |
| checkout-a11y.js L290 ONEPAGE checkout | 11,968 | checkout | yes | no | 1 | 2.0 | 0 |
| checkout-a11y.js L557 step indicator not a Tab stop | 1,642 | checkout | yes | no | 1 | 3.0 | 0 |
| checkout-a11y.js L620 TRIM-1112 more-details link | 5,256 | checkout | yes | no | 1 | 3.0 | 0 |

Observer targets (home, Arabic, phone): 34 observers making 47 `observe()` calls (`sporta-gov-autopick.js` disconnects and re-attaches 5 times per load). 25 observers
watch the whole `document.body` subtree, 11 watch `<html>` attributes (`lang`, `dir`; 5 of them also the body), 3 watch `<head>`. A language switch therefore wakes at
least 11 callbacks. The callbacks are cheap: 114 calls per page for `sporta-features.js`, 4.0 ms in total (median); `sporta-clock.js` 5 calls and 130 ms because of L-01.

## 7. What could not be measured, and what cannot be fixed in add-on CSS or JS

- **Not measured:**
  - The Adobe Fonts kits (blocked), so the font swap and exact Arabic text widths.
  - The live API (`content`, `text_style`, `shipping`, `me`, `brand_logo` are 404 in the 2026-11-03 capture).
  - Products on sale (the capture has none; one extra run used a mock sale list).
  - Signed-in account, checkout submit and payment pages, `/exchange`, `/backends` beyond its sign-in page (BACKENDS-SCAN covers it).
  - Real phones and real networks, hover states.
- **Timing is indicative.** Runs were unthrottled on a machine with load 5 to 16 on 4 CPUs. The instrumented profile is relative only. The cost table is two rounds
  of medians of 3.
- **Two lazy route sheets** (`/account`, `/returns`) come from earlier CSSOM dumps in `scripts/fixtures`, not from this capture.
- **Cannot be fixed in add-on CSS or JS:**
  - M-02 (the admin stylesheet's link and name are in the live `index.html`).
  - M-07 is a JS fix only.
  - The compiled AI panel and bag components (M-08, L-09 can only be patched from outside).
  - L-10 (the app's routing).
  - Missing product photos and the hero's double download (CLAUDE.md image notes).
  - The compiled bundle's own 185 kB CSS (18 to 33% used per page) and about 400 kB JS.

## 8. Info

- **I-01** No `/brands` page and no category menu: "Brands" is seven home chips to `/shop?brand=<slug>`; categories are four home tiles.
- **I-02** The brand row is left-to-right on the Arabic page (tools left, bag right); the tabs mirror.
- **I-03** The active tab is marked by an underline and `aria-current`; its colour equals the others (MONO-1112).
- **I-04** Shop is not marked active on a product page; returns, track, support, terms, privacy and cart have no active tab (footer pages).
- **I-05** On a phone the checkout header is `position: static` by design.
- **I-06** The desktop header is 145.046875 px (a fractional height from text-line rounding), the same on every page.
- **I-07** No mobile menu exists to open or close; the five tabs fit one row at 320 to 390 px at 100% text in both languages.
- **I-08** The `/account` and `/returns` route stylesheets are appended after the add-ons, so equal-specificity ties go to the compiled rule there (1 pair, 84
  cases).

## 9. Screenshots and files

Screenshots, in `.../scratchpad/menu-scan/shots/` (390 px Arabic and 1280 px English, plus 390 px English home):
- Pages: `home-ar-390.png`, `home-en-390.png`, `home-en-1280.png`, `shop-ar-390.png`, `shop-en-1280.png`, `about-ar-390.png`, `about-en-1280.png`, `contact-ar-390.png`,
  `contact-en-1280.png`, `account-ar-390.png`, `account-en-1280.png`, `returns-ar-390.png`, `returns-en-1280.png`, `track-ar-390.png`, `track-en-1280.png`,
  `support-ar-390.png`, `support-en-1280.png`, `terms-ar-390.png`, `terms-en-1280.png`, `cart-ar-390.png`, `cart-en-1280.png`.
- Bag drawer: `home-bag-ar-390.png`, `home-bag-en-1280.png`; after Escape: `menu-bag-closed-{ar,en}-{390,1280}.png`.
- Sporta AI panel: `home-ai-ar-390.png`, `home-ai-en-1280.png`.
- Text size on a phone: `menu-narrow-{ar,en}-{320,390}-{100,200}.png`.

Raw data, same directory:
- `runs-full/` (84 loads, one JSON each: requests with initiators, console, CLS sources, observers, listeners, timers, CPU profile, rule usage, cascade rows),
  `runs-nojs/`, `runs-noaddons/`, `runs-dark/`.
- `coverage.json`, `fights.json`, `imp.json`, `perf-compare-1.json`, `perf-compare-2.json`, `a11y-1.json`, `a11y-2.json`, `toggle-probe.json`, `verify-probe.json`,
  `fix-tests.json`, `backends-probe.json`, `static-css.json`, `static-js.json`.

Scripts: `collect.cjs` (with `engine.js`, `init-instr.js`), `analyze-css.cjs`, `analyze-fights.cjs`, `analyze-js.cjs`, `analyze-req.cjs`, `menu-a11y.cjs`,
`menu-a11y2.cjs`, `perf-compare.cjs`, `fix-tests.cjs`, `fix-tests2.cjs`, `verify-probe.cjs`, `toggle-probe.cjs`, `static-css.cjs`, `static-js.cjs`, `tables.cjs`. They
import the repo's `serveLive` from the pinned snapshot (commit in `snap/PIN`); re-run with `node collect.cjs full`, then the `analyze-*` scripts.
