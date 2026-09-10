# wain — working notes

Kuwaiti Arabic place-discovery site. Next.js 15 App Router, React 19,
TypeScript, Tailwind. `output: 'export'` — a static export uploaded to
Hostinger shared hosting. 52 places in `src/lib/places.ts`.

Everything below is a thing that has already gone wrong at least once.

## Git

- Work on **`claude/wainkw-design-issues-2bggdi`**. Never push another branch
  without being asked.
- Do not open a pull request unless explicitly asked.
- Never put a model name or identifier in a commit message, PR, code comment,
  or anything else that lands in the repository.

## There is no server

`output: 'export'` is not a detail, it is the shape of the whole project:

- `generateStaticParams` fixes which pages exist **at build time**. A place
  added later has no page until the next deploy.
- `generateMetadata` runs at build. A renamed place shows the new name in the
  page and the old one in the tab and in a WhatsApp preview.
- `NEXT_PUBLIC_*` are baked into the bundle. Nothing can supply them later.
- `trailingSlash: true`, so every route is a directory with an `index.html`.
  Test servers must map `/search` → `/search/index.html` or they throw EISDIR.

## The catalogue must not reach a client bundle

`src/lib/places.ts` holds all 52 records. A client component that imports
*anything* from it pulls the whole catalogue into that page's JavaScript.

**`src/lib/place-kit.ts` exists solely to prevent this.** Small helpers —
`getCategory`, `acceptsOrders`, `takesQueue`, `toArabicDigits`,
`toArabicNumber` — live there, and nothing in it may import the catalogue.
Client components import from `place-kit`, never from `places`. The `Place`
*type* is free: `import type` is erased at compile time.

`npm run audit:js` enforces it. Two regressions got through review and were
caught only by that audit — including one where a *re-export* in `orders.ts`
gave it a value dependency on the catalogue and put all 52 records back on
`/privacy` and `/about`.

## The back end is not configured

`supabaseEnabled` is `NEXT_PUBLIC_SUPABASE_URL.length > 0 &&
NEXT_PUBLIC_SUPABASE_ANON_KEY.length > 0`. Both are unset, in the repo and in
the live build. So ordering, the queue, business registration and the
live-edit machinery are **inert**, and `/admin` says so.

Also: `acceptsOrders(place)` needs `place.acceptsOrders && menuAr.length > 0`;
`takesQueue(place)` needs `place.takesQueue && place.salonKind`. **0 of 52
places satisfy either.** Order and queue panels return `null` everywhere
today — check before describing them as visible.

Turning it on: run `supabase/schema.sql`, set the two variables, rebuild.

## Deploying (see `docs/hosting.md` for the measured detail)

- **This environment cannot upload.** `srv2231-files.hstgr.io` is refused at
  CONNECT with a 403 by the sandbox's egress gateway. Report it; never try to
  route around it, and never disable TLS or unset `HTTPS_PROXY`. The `hosa`
  connector's **read** tools work and are the way to verify a deploy.
- **But the server can pull.** `npm run deploy:plan` prints the cron commands
  and the proofs; `npm run deploy:verify -- --observed <hosa readings>.json`
  checks them. The route is `wget` from a **commit-pinned**
  `raw.githubusercontent.com` URL, then `unzip -o -q -d <docroot>` — Extract's
  merge, so the PHP app survives. Delete the jobs and the zip afterwards. Two
  traps the planner asserts: `createAccountCronJobV1` gets a **403 from
  Cloudflare** if the command contains `{ … } > log 2>&1` or `$?` — one program
  and its arguments only — and it can return a uid for a job it never stored,
  so confirm with `listAccountCronJobsV1`. Check the downloaded size before
  extracting; a partial archive over a live docroot is the failure worth
  waiting a firing window to avoid. **The hosa file listing lags two to three
  minutes** behind the disk: after wget had saved the whole zip the listing
  still showed no `w.zip`, which reads as a failed fetch. `getCronJobOutputV1`
  is the faster truth — wget's own `saved [N/N]` line.
- **hPanel File Manager → Extract.** It merges. The docroot is *shared* — it
  holds eight directories of an older PHP app (`/api/`, `/pay/`, `/knet/`,
  `/assets/` …) that this repo did not put there.
- **Never** use hPanel's «deploy static archive» button or
  `hosting_deployStaticSiteArchiveV1`. Both empty the folder first.
- **A matching `build.json` digest does not mean the deploy landed.**
  `build.json` is a root file; on 9 September the root arrived first and all
  232 files in subdirectories arrived later, so the digest read correct while
  the site had no CSS and every route but `/` was a 404. Always also check
  something that is not at the root — the hashed stylesheet, `/explore/`,
  `/og/<slug>.jpg`. **And sizes cannot tell two builds apart**: a build id is
  40 hex characters whichever commit it is, so the root files of two different
  builds are byte-identical. `_next/static/<commit>/` is the one proof whose
  name carries the commit — `deploy:verify` requires it for that reason.
- FTP secrets (`FTP_SERVER`, `FTP_USERNAME`, `FTP_PASSWORD`) would make
  `deploy.yml` work; 186 runs have failed for want of them. They get added in
  GitHub's settings UI — **never pasted into a chat or a commit**.

## شوق, the ElevenLabs agent

Agent `agent_1701m1gcrccrethae9y3nyv1e116`. 20 attached tests; run them after
any prompt change, `repeat_count: 2` — at temperature 0 a failure that shows
once shows twice, and a judge that passes once and fails once is a judge
problem. There is no update-test tool: to sharpen a judge, delete the test
and recreate it, then re-attach the new id.

**A rule she keeps breaking is usually placed wrong, not worded wrong.** The
season override («outdoors in summer → after sunset») sat in the calendar
section and lost every time to the KB's own «أحسن وقت» line, because she
reads that line at the moment she writes step ٣. Restating it *inside* step
٣, with the forbidden words named and one worked example, fixed it on the
first try. Gemini-flash at temperature 0 obeys word-bans and examples far
better than principles.

**The launcher is `ShouqCallButton`, inside the /search query box; the call
component lives in the root layout.** Both are deliberate. Every call already
ended on /search, so the button belongs there — and it replaced the box's own
dictation mic, because a mic and a call button side by side are one offer
drawn twice. The call cannot move with it: `open_place` is a route change and
the `<elevenlabs-convai>` element is created inside `WainAiCall`, so a call the
search page owned would be killed by its own tool.

They are therefore in different trees and talk over **`lib/wain-ai-bus.ts`** —
one window event to request a call, one to carry the phase back so the button
can render the pulse and `aria-expanded` honestly. Do the gesture work
(`haptic`, `primeAudio`) in the button, synchronously: iOS will not unlock
audio outside a gesture and the call mounts an event later.

**Her tools read `usePlaces()`, not `@/lib/places`.** They used to build an
index from the build-time snapshot while every listing rendered live rows, so
after an admin edit she could not find a new place, still found an unpublished
one, and refused to `open_place` a slug already visible in the results.

**Anything that pushes `/search?q=…` from /search is a same-route push**, so
nothing remounts. `SearchClient` therefore adopts `?q=` and the `wain:asked`
handover on every params change, not once at mount. The ⌘K palette hits this
too — it is in the navbar, so it is reachable from /search.

**The live prompt is not generated from `docs/wain-ai-agent.md`.** It is a
hand-adapted copy. Editing the brief and re-extracting produces garbage. To
change it: read the live prompt with `agents_get`, edit *that* text, send it,
and mirror the change into `scripts/wain-ai-brief.mjs` by hand.

This used to say «copy the previous `scratchpad/live-prompt-vN.txt`». That
directory is not in the repository, so those files exist only inside whichever
container wrote them and are gone by the next session — following the
instruction literally means starting from nothing and rewriting the prompt
from the brief, which is the one thing the paragraph above forbids. The agent
itself is the copy that always exists, and `agents_get` returns it in full.

**The knowledge base is a URL pinned to a commit**, not an upload:
`raw.githubusercontent.com/hkspower/wain/<sha>/docs/wain-ai-kb.md`, currently
`ab034b0`. ElevenLabs fetches it once, at the moment it is attached — its
`last_updated` never moves on its own — so a KB edit needs a new commit *and*
re-pointing the document. `npm run ai:brief` regenerates that file from
`places.ts`; if the regenerated file is byte-identical to the committed one,
the live KB is current and there is nothing to send.

`agents_update` must be sent with the top-level `prompt` **alone** — if both
`prompt` and `body` are sent, `body` wins silently.

A prohibition cannot be optional. Moving «ما تسجّلين له بنفسك» into the
say-only-if-asked section made her start offering to register businesses
herself — a promise she cannot keep.

## Checks

`npm run scan` is lint plus ~20 audits. Browser suites: `test:hangout`
(hangout, hangout-page, map-pin, search-button, search-keys, shouq-search,
search-plan, swipe), `test:journey`, `test:register`, `test:shouq`,
`test:orders`, `test:net`.

Browser suites serve `out/` and most of them do **not** build it.
`tests/stale-build.mjs` compares `out/index.html` against the newest file in
`src/` and `public/` and refuses to run against a stale build — a green suite
testing code that no longer exists is worse than a red one.

`npm run audit:htaccess` applies every deny rule in `public/.htaccess` to
every file in `out/`. A rule may only deny what the site does not ship: an
early draft denied `index.txt` and would have broken client-side navigation on
every route to tidy one stale file.

`npm run test:db` needs the PostgreSQL binaries on PATH and they are not on it
by default here — only `psql` is. It looks like a broken suite and is not:
`PATH="/usr/lib/postgresql/16/bin:$PATH" npm run test:db` passes 27
assertions. `test:api` needs PHP, which is installed, and passes 40.

**`postcss` is pinned by an `overrides` entry, and that is load-bearing.**
Next 15 depends on 8.4.31; four advisories, one of them high, need 8.5.23 or
later. `npm audit fix` offers only Next 16, a major upgrade of the framework
this whole static export is built on, to correct a transitive dependency.
Tailwind already resolves 8.5.28 in the same build, so the override makes both
copies agree on the patched one instead. Audit goes from two vulnerabilities to
zero. Remove the override and they come back.

**Known failing, pre-existing, verified against an untouched baseline:** the
swipe suite's 4px scroll-snap assertion. Re-verified by stashing the working
tree, rebuilding and running the suite on a clean checkout: same assertion,
same 124px, same 17-passed-1-failed. It is the only red left, and `npm run
scan` now exits 0 all the way through `audit:photos`.

This used to also list «`audit:mobile`'s 4px overflow from the `sr-only` skip
link», and that description was wrong in a way worth remembering. The audit
names every element sitting past the viewport edge, and the skip link — an
absolutely-positioned 1px box pinned to the inline start of an already
too-wide document — sorted to the top of that list. It was a passenger. Hiding
it changed the width not at all; hiding `<main>` fixed it. The cause was a
scroll rail on the home page bleeding `-mx-4` into a `px-3` gutter, so the page
was 4px wider than the screen — and 6px once the gutter went to `px-2.5`, which
is what made it visible. **A full-bleed rail's negative margin must equal the
page gutter**, or every route slides sideways. The first row of an overflow
report is the symptom, not the cause.

## It is already one page

Worth knowing before anyone proposes making it one: `output: 'export'` does
not mean full page loads. The export ships an HTML file per route **and** an
RSC payload per route — those are the 62 `.txt` files, and the reason
`audit:htaccess` may not deny `index.txt` — so the router swaps views
client-side and the document never reloads. Measured with a marker on
`window`: it survives explore → a place, home → explore and explore → about,
with zero document loads. The 52 static HTML files are what make links,
WhatsApp previews and indexing work; deleting them to «become an SPA» would
trade all of that for something the site already had.

What was missing was only that a route change looked like a page swap:

- **`RouteTransitions.tsx`** runs forward navigations inside
  `document.startViewTransition`, so screens crossfade. Clicks are intercepted
  in the capture phase because the transition has to CAUSE the DOM change and
  there is no router event to hang that on. It does not touch back/forward,
  modified clicks, external links or `open_place`, and it does not attach at
  all without the API or under reduced motion.
- **`ScrollMemory.tsx`** puts you back where you were on a list.

**The scroll bug is worth reading before touching either file.** Leaving
/explore at 1800px and pressing back landed at 643px every time. The browser
applies its restore in the same frame the list returns, while the document is
still part-built, and clamps against a height that is not there yet — 643 is
exactly `1487 - 844`. The same clamp fires on the way OUT, which is what makes
this a two-part trap: a recorder that watches scroll events faithfully records
the clamped value over the real one. Two versions died there, one writing
`window.scrollY` in an effect cleanup (which runs after the router has already
scrolled the new screen to the top, so it recorded 0) and one recording from a
scroll listener (which recorded 643). Recording now freezes the moment a
navigation starts and thaws when the next screen arrives.

Ruled out by measurement before any of it was written, each of which looked
obviously guilty: the View Transition wrapper, `content-visibility` on the
cards, and the stale `contain-intrinsic-size`.

**Nothing in the root layout may call `useSearchParams`.** It suspends its
caller during static rendering, so in the layout it would wrap the whole app
shell in exactly the collapse-for-a-frame described above.

## The scale is compact on purpose

Asked for «ultra compact», measured, and kept the three floors that were
explicitly ruled load-bearing: **text never below 11px, tap targets never below
44px, text fields never below 16px.** All three are enforced by `audit:mobile`
and the first by `audit:type`, so they are not a promise, they are a check.

Density therefore comes from space and layout, never from shrinking the things
themselves:

- **Gutter 10px phone / 16px desktop, rhythm 8px / 12px.** One value each,
  every route, which is what `audit:padding` asserts. The nineteen page shells
  and the navbar were rewritten together — the navbar shares the gutter, so
  changing one without the other misaligns the header from the page under it.
- **Leading came down across the ladder**, most at the display end and least at
  12px and 14px, which carry a thousand nodes between them. The ladder itself
  is unchanged: still looser as the type gets smaller.
- **Only the display sizes shrank** (24/30/36/48/60 → 22/26/30/38/46). The body
  end did not. `audit:type` refuses steps closer than 1.5px apart, so dropping
  `text-base` to 17 to save a pixel would have collided with `text-lg` and
  bought nothing.
- **/explore and «أماكن مشابهة» are two cards to a phone row.** The card's tint
  band went 96px → 56px; it is a category cue, not a picture. The category chip
  inside the card is hidden below `sm` because the row had no width for it, and
  nothing is lost — the tint band and its mark ARE the category.

**Change the card and you must re-measure `contain-intrinsic-size`.** It is the
height `.card-defer` claims for cards below the fold, and it went stale the
moment the grid changed shape: still saying 272px when cards had become
136–174px, so /explore claimed 6815px of document and settled at 5601px as the
rest rendered. A 1214px lie is the page shrinking under a reader's thumb, and
it is the one number that property exists to get right.

Measured on a 390px phone: /explore 14591px → 5224px, a place page 2893px →
2183px. Desktop /explore 4923px → 2210px.

**When a tap target is too small, the type is usually not the reason.**
«استكشف» in the breadcrumb failed at 42px wide because it is four letters and
the link is only as wide as its word. Its height was never in question. The
saving there was the margin.

## Style

No redesigns beyond what is asked for. Fix the current theme. Comments in this codebase explain *why*
and record the bug that made the rule necessary — match that, and do not add
decorative commentary.
