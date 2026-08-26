# Assets

`npm run audit:assets` — needs `npm run build` first. Part of `npm run scan`.

It reads `out/`, not `public/`, because `out/` is what gets uploaded: it holds
things `public/` never had (the built CSS, the fonts, the service worker) and it
is the only honest measure of what a visitor pays for.

## What it asks

**Is anything referenced that is not there?** A 404 nobody sees. The share cards
proved these can hide indefinitely — the thing asking for them was a crawler,
not the page, so opening every route found nothing wrong.

**Is anything there that nothing references?** Dead weight is uploaded on every
deploy, stored in every host backup, and served for ever, and nobody notices
because the site works perfectly without it.

**Do the icons declare the size they actually are?** A manifest promising
512×512 and shipping 480×480 gets the icon silently rejected by some installers.
The dimensions are read out of the pixels, not the filename — `app-icon-512.png`
is a name, not evidence.

**Is the same file shipped twice under two names?** By content hash.

## What it found

Three files in `public/` that were never assets at all — build sources and
internal documentation, sitting in the one directory whose entire purpose is to
be served to the public:

| File | | Where it went |
| --- | --- | --- |
| `brand/wain-logo.svg` | 2KB | `brand-source/` |
| `og/README.md` | 906B | `docs/og-cards.md` |
| `brand/kuwait-mix.png` | 193KB | stayed — see below |

`wain-logo.svg` is the master the `WainLogo` component mirrors; the component
**is** the rendered logo and nothing ever fetched the file. That is the
definition of a design source, and `brand-source/README.md` already said design
sources live outside `public/` — it just listed this one as an exception to its
own rule.

`og/README.md` documented how the cards are generated. Useful, but it was being
published at `wainkw.com/og/README.md`.

`kuwait-mix.png` **stayed on purpose.** `brand-source/README.md` says it is kept
at a stable public URL so it can be shared directly, and that is a decision, not
an oversight — so it is named in the audit's allowlist with that reason rather
than reversed quietly or left as a permanent red mark. It is worth revisiting:
193KB on every upload and every backup for a URL no page links to. That is the
owner's call, not the audit's.

## What it did not find

Nothing missing (all 54 rooted asset paths resolve), no duplicates, and all four
icons declare what they are.

## Where the weight goes

8.5MB in `out/`, of which assets are only 1.7MB:

| | | |
| --- | --- | --- |
| `.html` | 47 | 3.7MB |
| `.txt` | 46 | 1.8MB |
| `.jpg` | 37 | 1.3MB |
| `.js` | 39 | 1.3MB |
| `.png` | 5 | 235KB |
| `.woff2` | 12 | 156KB |
| `.css` | 1 | 81KB |

The `.txt` files are Next's RSC payloads — one per route, shipped alongside the
HTML. Together HTML and payloads are 5.5MB of the 8.5, which is the cost of a
static export that pre-renders every place page twice over. No visitor downloads
more than their own route's share of it.

## Checker bugs worth remembering

Three of the first run's findings were faults in the audit, not the site:

- Absolute URLs on the site's own domain arrive from the regex as
  `//www.wainkw.com/og/x.jpg` — the `https:` cannot be in the character class.
  That starts with a slash and looks exactly like a rooted path, so all 25 share
  cards were reported missing while every one was present.
- `data:image/svg` is not a MIME type any browser accepts, so Chromium refused
  wain's own icon and it was reported as undecodable. It is `image/svg+xml`.
- `sizes: "any"` is the *correct* declaration for a scalable icon, not a claim
  about pixels. Comparing it to the SVG's intrinsic 150×150 read a right answer
  as a wrong one.

The orphan detector is proved by planting a file nothing points at and watching
the run fail.
