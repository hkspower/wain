# SEO live page check, 2026-11-19

Owner: "make seo data fetching". Built as a card on **/backends -> SEO**, under the Site icon card: press **Check live pages** and the browser fetches the shop's own public
files and pages the way a search engine does, then lists what each one tells it. Read-only, no key, no server route, no migration: the admin page is on the shop's own origin, so
it needs no API release (it ships as the add-on `sporta-admin-brands.js` / `.full.js`).

## What it reads and checks

| Reads | Checks |
|---|---|
| `/robots.txt` | present; names the sitemap; keeps `/backends` out; does not block the whole site |
| `/sitemap.xml` and the sitemaps it lists | valid XML; how many addresses; every child answers; no date in the future; no address twice; unreadable = the main pages are checked instead |
| every address the sitemaps list (up to 240, both languages) | status (and a redirect); title and description (present, length); canonical (present, https, the page itself); noindex in the tag or the `X-Robots-Tag` header; language versions `ar` / `en` / `x-default`; social tags `og:title` / `og:description` / `og:image`; JSON-LD (each block valid JSON); the page's language attribute against its address; titles and descriptions two pages of one language share |

Results are worst first (error, warning, fine); "Only pages with problems" cuts the list; each row opens to the values that were read; **Copy report** puts the findings on the clipboard.
It sends no cookie (it sees the page as a crawler does), four requests at a time, 15 seconds each; **Stop** and leaving the screen cancel what is in flight.

## First read of the live site (read-only probe `scripts/live-seo-check-probe.mjs`, run from the VPS, 2026-11-19 10:04 UTC)

The probe injected only this block into a page of the real origin and pressed the button. **84 pages and 4 files in about 2 seconds, GET requests only, no page error.**

- `robots.txt`, `sitemap.xml`, `sitemap-pages.xml`, `sitemap-products.xml`: all fine.
- **0 errors, 65 warnings, 19 fine.** Every one of the 65 warnings is the same: the **product pages' description is too short** (17 to 35 characters; search results show about 155).
  That is the data the earlier scan named (`SCAN-1110`: the products' own `desc_en` / `desc_ar` are one short sentence). It is fixed in the Catalogue (write a real description of
  one or two sentences per product), not in code; the card will show the warnings go as the descriptions are written.
- Nothing else was flagged: every page has a title, a canonical that is the page itself over https, the three language versions, the social tags and valid structured data.

## Proof

`npm run test:admin-seo-check` (75 checks, a real browser against a fake shop: placement, no request until the button is pressed, no admin route, no cookie, four at a time; every problem a
page or a file can have; a real HTTP server for the redirect; Stop and leaving; Arabic; light and dark at 4.5:1; phone layout; four mutants, each of which makes its check fail).
`test:admin-js-audit` (eight 500 ms entry checks now) and `test:js-guard` cover the block's timers and its guard.

## Not done

It reads what a crawler is served, not what Google has indexed: Search Console numbers (clicks, impressions, queries) and PageSpeed scores need a Google key or sign-in from the owner
and a server route, so they are a separate step if wanted. Product pages are checked at the sitemap's addresses only (14 products with no photo are hidden from the sitemap by the auto-hide rule).
