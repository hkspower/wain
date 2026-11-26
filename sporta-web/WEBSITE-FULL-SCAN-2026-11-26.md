# Whole website scan, 2026-11-26

Read-only scan of the LIVE shop at https://www.sporta.com.kw (the scripts GET pages and read them; nothing was ordered,
submitted or signed in). Run from the working machine on 2026-11-26. Raw outputs are in
`/tmp/claude-0/checkin-2026-11-25/` (`site-scan.txt`, `sitemap.txt`, `robots.txt`, `js.txt`, `images.txt`, `perf.txt`).

## Scope and what was NOT covered

- Covered: live site scan (84 sitemap URLs, 45 internal links, 28 page loads at 390 and 1280 px, Arabic and English),
  sitemap check, robots check, JavaScript runtime check, live image scan (home page), performance probe (phone profile
  and desktop, 3 runs on phone).
- Not covered in this pass: the admin (`/backends`, covered by the 2026-11-25 admin scan), the full product catalogue
  (only 4 product pages), other browsers (Chromium only), a real phone, and a repo-wide lint or test sweep.
- Environment caveat: this machine's test sandbox routes outside requests through a proxy that refuses some hosts. Typekit
  font requests therefore fail in these runs. That is a property of the scan machine, not of the shop, and is not counted.

## Headline

- No JavaScript errors on the shop's own code (0 uncaught errors across 28 page loads).
- Every sitemap URL answers 200; robots.txt and llms.txt are healthy and do not block Googlebot.
- The phone shop page (`/shop`) has a layout shift of about 0.66 in both languages (poor; the desktop shop is 0.45).
- Phone LCP is 4-6 s on most pages under the throttled profile (poor; the threshold is 2.5 s). Desktop LCP is 2.5-3.2 s.
- Several API routes return 404 in the browser (see the findings below). Whether each is a missing route or a request the page
  makes after it has already moved on should be checked before anything is changed.

## Findings

### High

1. **Shop page layout shift on phones (CLS 0.66) and on desktop (0.45).** Both languages. The product grid moves as the page
   fills in. Cause not traced in this pass. Measure which element moves before fixing (the desktop CLS also appears on the
   category-filtered pages: 0.4-0.6 at 1280 px).
2. **Phone LCP and blocking time.** LCP 4-6 s on home, shop, product, about and contact on phones; main-thread blocking
   (TBT) 0.4-1.1 s. The heaviest scripts are `sporta-features.js` (95 KB, 1.4-3.1 s on the throttled profile) and the React
   vendor bundle (69 KB). The LCP element on the account page is a paragraph, not an image.
3. **404 responses from the API during page loads.** `api.php?r=content`, `r=text_style`, and `customer.php?r=me` answer 404 in
   some loads (4 each). `r=text_style` is in the "built, not deployed" list (2026-11-18 release notes); a 404 there is expected
   until that release. The other two need a check against the live API.

### Medium

4. **Missing product photos on the shop.** 14 active products have no photo file (known; the auto-hide rule keeps them out of
   the shop once the auto-hide release is live, which it is). The scan still shows grey placeholder plates on the category
   and shop pages where the product list is shown.
5. **Repeated 404 for product image variants.** `/images/products/responsive/variants.txt` answers 404 on every page load (known
   since 2026-11-10; the small-copy list is not generated yet).
6. **Sitemap differences.** The repo's `sitemap-products.xml` has 92 URLs and the live one has 66; the repo includes 28 product
   pages that are not on the live site yet (the next backend release), and the live file lists `/catalogue` twice (with and
   without `?lang=en`). The lastmod of all 66 live product entries is the same date (2026-11-22).
7. **Utility pages in the sitemap.** `/track` and `/support` are listed in the sitemap. They are useful pages, but they are
   not content pages; listing them is a choice to confirm.
8. **Hostname spellings.** `http://www.sporta.com.kw/sitemap.xml` redirects (308) to the canonical https address (correct). The
   bare host `sporta.com.kw` and the server IP answer as expected (redirect or refusal). No action.

### Low

9. **Sitemap XML declaration** on `/sitemap-pages.xml` is served as `application/xml` without a charset (the XML says UTF-8).
   Harmless; the file is served by the static build.
10. **Preload not used.** A hero image (`strength-rtl.webp`) is preloaded but not used within a few seconds of load (a warning
    from the browser; the hero is the LCP element on the home page, so the preload is probably intended for the mobile path).
11. **Pages without a canonical link or indexing rules.** `/cart`, `/checkout`, `/account`, `/wishlist` are `noindex, follow` by
    design; they have no canonical. Expected. `/no-such-page` answers 404 with `noindex`. Expected.
12. **Oversized brand-logo request.** The Vanquish brand logo is 1400x342 PNG (48 KB) shown in a 65x40 box on the home page
    (known; the owner's brand upload, HB-05).

## Passed

- Sitemap: 84 of 84 URLs answer 200 on the live site.
- Internal links: 45 checked, 0 broken.
- robots.txt: 200; the sitemap is listed; no sitemap URL is blocked for Googlebot; llms.txt is 200 and lists 49 URLs.
- Redirects: http and bare-host variants go to `https://www.sporta.com.kw` in one hop.
- Security headers on `/`: HSTS, CSP (with the expected script hashes), `nosniff`, no `X-Powered-By`.
- No uncaught JavaScript errors (0) across 28 page loads on the shop's own code.
- Images on the home page: 17 requests, 601 KB, no failed image loads; the brand logos and the category tiles are sized to their
  boxes (the only oversize is item 12).

## Proposed next steps (none applied)

1. Trace the shop CLS (item 1): record the layout-shift sources on `/shop` at 390 px and fix the element that moves.
2. Reduce the phone script weight (item 2): split `sporta-features.js` by page, or defer the blocks that only run on the
   product or account pages.
3. Check the three API 404s (item 3) against the live route list before deciding.
4. Confirm with the owner: whether `/track` and `/support` stay in the sitemap (item 7), and the `lastmod` for products (item 6).
5. Re-run the product-page and account checks after the next add-on release.

## How to re-run

- Site scan: `BASE=https://www.sporta.com.kw node scripts/live-site-scan.mjs`
- Sitemap: `node scripts/sitemap-check.mjs`; robots: `node scripts/robots-check.mjs`
- JavaScript runtime: `node scripts/js-scan.mjs`
- Images (home page): `node scripts/live-images-scan.mjs`
- Performance (phone and desktop): `node scripts/live-perf-probe.mjs`

## Follow-up (same day): what was checked after the scan

- **Item 1, shop layout shift.** Measured again on the live shop at 390 px: one shift of 0.65 at about 5.2 s, when the
  product grid fills in. The grid is at the same position before and after; the cards in the first positions are swapped
  for other products, and cards of different heights change the rows below them. The cause is the order of the product list
  after load, not a block above the grid collapsing. Fixing it needs one owner decision: a stable order for the first
  products on `/shop` (for example the same sort the server returns), or a fixed card height. Not changed.
- **Item 3, API 404s.** `api.php?r=content`, `api.php?r=text_style` and `customer.php?r=me` answer 200 when requested
  directly now. The 404s in the scan came from requests made while the page was closing. Not a live fault; no change.
- **Items 2, 4-12.** Not changed in this pass: they need owner decisions or data (product photos, sitemap and utility
  pages, brand logo upload, the foreign build's static files) or a larger change (splitting the 95 KB storefront script
  for phone speed).
