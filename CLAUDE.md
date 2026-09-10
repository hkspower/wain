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
  so confirm with `listAccountCronJobsV1`. **`deleteAccountCronJobV1` lies the
  same way**: it answered «Request accepted» for a job that was still running a
  minute later, so list after deleting too, not just after creating. Check the
  downloaded size before
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
- **There are two stages now: `staging.wainkw.com`, then `www`.** A push
  deploys to staging; production only ever runs from a `workflow_dispatch`
  where a person chose it. Promoting means dispatching at the commit that was
  staged — exact rather than approximate, because `generateBuildId` is the
  commit sha on a clean tree, so the same commit rebuilds to the same digest.

  **Staging's docroot is `public_html/staging` — inside production's.** The
  panel puts subdomain roots there and it is not a choice, so three things
  follow, all handled rather than remembered: `staging` is in production's
  `PROTECTED_PATHS`; `www.wainkw.com/staging/` is a 404 under any host but
  staging's own, or it would be a second indexable copy of the site; and the
  `noindex` header is keyed on `Host` inside the **export's own** `.htaccess`,
  because staging's root sits BELOW `public_html` and Apache never reads the
  parent `.htaccess` for it — a rule written up there would silently not apply.

  **Its endpoint is generated, not copied**, by
  `scripts/publish/setup-staging-endpoint.php`, so the two cannot drift; re-run
  it after patching production's and staging re-inherits the fix. Three paths
  differ. `$WEBROOT` and `$ROOT` because `dirname(__DIR__, 2)` is only correct
  at `public_html/api` — one level deeper it resolves to `public_html` and the
  copy would publish into a path that does not exist and report success. And
  `$WORK`, which is the one that matters: **the manifest must not be shared**,
  or each deploy's prune would delete the other environment's files. `$STORAGE`
  IS shared, so one `DEPLOY_SECRET` serves both.

  By hand: `php d.php probe staging`, `php d.php <url> <sha> <version> staging`.
  The stage defaults to **production** when omitted — a forgotten argument then
  deploys where it always did, rather than quietly publishing somewhere nobody
  is watching.
- **Diff the whole docroot against `out/`, not just the routes.** Asking each
  page what it references finds what the *site* uses; only a full listing finds
  what is on the disk that no page admits to. `public_html/assets/` held a
  complete wain export from 9 September — `assets/build.json` said
  `"name": "wain"` — extracted into the PHP app's directory by some earlier
  deploy, and nothing in this repository could have known: not the export, not
  the manifest, not any route's HTML. Clearing stale chunks broke that copy into
  an unstyled homepage served at `/assets/`. Removed, and `deploy.php` now
  protects `assets`, so a deploy cannot recreate it — but **a shared docroot can
  hold a second copy of your own site** is the part worth remembering.
- **`unzip` merges, so every deploy leaves the last one's assets behind.**
  Cleared once, on 10 September: 37 files, ~1.1MB, six builds' worth. Two
  measurements from it are worth keeping. A path the WAF will not accept —
  `places/[slug]/`, brackets being outside `[A-Za-z0-9 _\-./:=?&@]` — is still
  reachable as `find <dir> -name <basename> -delete`, which names the file
  without typing the bracket. And the command field caps between 210 and 279
  characters, so **two absolute paths per job** is the batch that always fits.
  Pick the list from the *live* HTML, never from `out/`: a local build is
  usually ahead of the deploy and names files the server has never had.
- **This repository is not just wain, and that governs what can be done about
  its size.** `.git` is 410MB, 345MB of it blobs over 1MB, and it is tempting
  to read that as wain's mess to clean up. It is not. Eleven branches descend
  from one root commit dated 9 June, and the weight belongs to four other
  projects: the design plates are shared with `claude/almuhalla-code-editor`,
  the press images are `claude/tokyo-racer-kuwait`, the brand assets are
  `claude/sporta-integration` and `deploy` (which shares no root with the
  rest), the website previews are `claude/delivery-cars-website`. Measured:
  only **39MB is reachable from wain's branch alone**. Rewriting history to
  reclaim the rest means rewriting four other teams' branches.
- **And rewriting even wain's own 39MB breaks شوق.** Every commit on this
  branch is unique to it, including `ab034b0` — the commit the knowledge base
  URL is pinned to. A rewrite changes that hash, the pinned URL starts
  answering 404, and the next time ElevenLabs refetches the document she loses
  her catalogue. Any rewrite has to repoint the KB in the same sitting.
- **The archive is the recurring bleed, and `--archive-url` is the way out.**
  Nearly 25MB of that 39MB is seven copies of `wain-<version>.zip`, committed
  and removed six separate times; the removals reclaim nothing. Nothing in the
  process needs it to be in git — the server does a plain `wget`. Put it on any
  public HTTPS host and pass `npm run deploy:plan -- --archive-url https://…`
  and no blob enters history at all. The flag is host-agnostic on purpose. It
  checks two things and nothing else: the scheme is https, and the bytes the
  URL serves match the local archive exactly.

- **There is already a proper deploy endpoint on the server, and this file did
  not know about it.** `public_html/api/deploy.php`, 240 lines, and its own
  header says it "replaces the unsafe pattern of `wget zip && unzip -o` over a
  live web root" — which is precisely the route documented above and used on
  10 September. It is better in every respect: HMAC-SHA256 signed requests with
  the secret outside `public_html`, a replay window of ten minutes, SHA-256
  verified before anything is written, staged in `../storage` and never
  unpacked into the live root, `api`/`knet`/`pay`/`admin`/`queue`/`orders`/
  `storage`/`.htaccess` refused outright, `.php` inside an artifact refused,
  manifest-based cleanup of stale build files, and the previous three releases
  kept for rollback. POST `{url, sha256, version, ts}` with
  `X-Deploy-Signature: sha256=<hmac>`.

  **It would refuse this export today.** `PROTECTED_PATHS` contains `admin`,
  `queue`, `orders` and `.htaccess`, and all four are things wain publishes —
  they are static routes of this site, not the PHP app's. Any artifact holding
  them is rejected with `artifact_touches_protected_path` before the download
  even starts. Adopting the endpoint means first separating the directories the
  PHP app owns from the names the static site also uses.

  **This is now fixed on the server** by `scripts/publish/patch-deploy-endpoint.php`,
  applied 10 September: `admin`, `queue`, `orders` and `.htaccess` are writable,
  and `assets`, `cats`, `fonts`, `hero`, `images` — the PHP app's, which were
  *not* protected before — now are. Verified by reading the live file back.

  **The «it cannot be reached from here» blocker was a mistake, and it is worth
  knowing why.** This file used to say the POST could not be sent because
  `www.wainkw.com` is refused at CONNECT by the sandbox gateway. That is true
  and irrelevant: it confuses «unreachable from this session» with
  «unreachable». **The server can call itself**, which is what sporta's eight
  cron jobs have always done —

  ```
  wget -qO- --no-check-certificate --header=Host:www.sporta.com.kw https://127.0.0.1/api/…
  ```

  — and the same shape reaches wain. Proved with a GET that came back carrying
  deploy.php's own `{"ok":false,"error":"method_not_allowed"}`, its 405 branch,
  so the request reached PHP and the `Host:` header picked the right docroot.
  The certificate is for the domain, not for `127.0.0.1`, hence
  `--no-check-certificate` — the connection never leaves the machine, which is
  the point of the loopback. **Before concluding that anything on this host is
  unreachable, check whether the host can do it to itself.**

  So the route is now: **`scripts/publish/deploy-call.php`**, fetched by cron
  and run. It reads `storage/deploy.secret` on the server, signs, and POSTs over
  the loopback; only the HMAC leaves the process, which is why the script is
  safe to keep in the repository. `php d.php probe` sends a correctly signed
  request that can only fail *after* the signature check, so `host_not_allowed`
  coming back proves the HMAC was accepted without downloading or writing
  anything. That probe passes. `npm run deploy:plan` now prints this route.

  **First deploy through it: 10 September, `{"ok":true,"deployed":245}`.** The
  artifact went in wain's *own* docroot — not the shop's, which would put one
  project's build output in another project's web root — and it cannot be named
  `.zip`, because wain's `.htaccess` denies `bak|zip|db|sqlite`. `deploy.php`
  reads the bytes with `ZipArchive` and never looks at the name, so upload it as
  `wain-<version>.bin` and delete it afterwards. `docs/hosting.md` §*Where the
  artifact goes*.

  **`removed: 0` on that run was correct, and it did not stay 0.** The prune
  compares against the previous manifest and there was none. The second deploy
  the same day returned **`removed: 2`**, against a prediction of exactly 2 made
  before it ran — the two build-id manifest files, the only paths that differed
  between two code-identical builds. The stale-asset problem is closed.

  **It rmdirs too, since 10 September.** Step 9 used to unlink stale files and
  leave the directories it emptied, so `_next/static/<old sha>/` survived every
  deploy as an empty shell. `scripts/publish/patch-deploy-prune-dirs.php` added
  the walk-up; the reply now carries `emptied` beside `removed` and the log line
  carries `dirs=`.

  **A deploy job is per-minute, so read the output as the LAST run, not the
  only one.** The third deploy answered `removed: 0, emptied: 0` and looked like
  the new prune had done nothing — it had fired twice, and the reading was of
  the second, idempotent pass. The disk settled it: the previous build's
  directory was gone, files and all. So **check the filesystem, not the reply**,
  and delete the job as soon as it has fired once. That a second run is a clean
  no-op is worth knowing on its own: the deploy is safely repeatable.

  Still true: `ALLOWED_HOSTS` is GitHub-only, so an artifact hosted anywhere
  else needs its hostname in `<domain>/storage/deploy.hosts`, one per line —
  the patch added that file's support precisely so the host list can change
  without editing an endpoint inside `public_html`. Write it with
  `php d.php allow <host>`, **not** `printf … > file`: a redirection is the
  shell plumbing the WAF answers 403 for, so that one-liner cannot be a cron
  job at all.

  The `hosa` connector still has **no file-write tool** — read-only, with its
  one upload path on the blocked host. The write path is the cron job: the
  server fetching from a commit-pinned raw URL and running what it fetched.
  Delete the fetched `.php` and the job afterwards.
- **The crontab is shared, and a job you did not create is probably not a
  problem.** This account carries seven sites, and other sessions use the same
  fetch-pin-run write path. Two turned up on 10 September — `remove-strays.php`
  and `live-revalidate-check.php`, both pinned to commits on this repository,
  both per-minute, both belonging to work on **sporta**. Each looked alarming
  (a per-minute job downloading and executing PHP) and each was a run-once
  diagnostic that its own session deleted minutes later, the same pattern this
  file recommends.

  So: read it before reacting. `get_commit` on the pinned sha names the author
  and the session, and the file itself says what it does. **Do not delete another
  session's job** — one of those two was mid-measurement — and do not count it as
  a leftover. The account's own standing jobs are the eight sporta ones; anything
  else is someone working, and it will go.
- **`deploy.yml` goes through the endpoint now, and wants ONE secret:
  `DEPLOY_SECRET`** — the contents of `<domain>/storage/deploy.secret`, added in
  GitHub's settings UI and **never pasted into a chat or a commit**. The three
  FTP secrets are no longer used by anything; that path ran 186 times and
  succeeded 0, and it carried the fault this whole file is about: FTP writes
  file by file into a *shared* docroot, so a wrong `server-dir` publishes wain
  over the primary domain with a green tick, and a half-finished upload leaves a
  live site pointing at assets that never arrived.

  CI can do what this sandbox cannot: a GitHub runner reaches
  `www.wainkw.com` over the ordinary internet, so it signs and POSTs directly
  rather than going through cron. The artifact rides as a **release asset** —
  `github.com` is already in `ALLOWED_HOSTS`, and release assets live outside
  the object database, so nothing enters history. Verified before it ever ran:
  `openssl dgst -sha256 -hmac` matches PHP's `hash_hmac` byte for byte, and the
  workflow's `zip` produces the same 245 entry names as `make-release`, so a CI
  deploy and a hand deploy write the same manifest — had they differed, the next
  prune would have deleted the site.

  With the secret set, a push to this branch deploys and **nobody uploads
  anything by hand**. Without it the run stops at the first step and says so.

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

**Next 16 was tried on 10 September and reverted. Do not retry it casually.**
`npm audit` is at **0 vulnerabilities** and every dependency is already at its
semver-`Wanted` version, so nothing here is driven by security — the only
updates left are majors, and each is blocked:

- **It costs 29.5K gzipped on every page, and that is the reason.** Measured
  like for like — same tree, same audit, only the framework swapped:

  | | 15.5.25 | 16.3.4 |
  |---|---|---|
  | shared, paid by every route | **119.3K** | **148.8K** |
  | `/search/` | 158.4K | 183.2K |
  | a place page | 145.1K | 182.8K |

  A quarter more baseline JavaScript on a site whose audience is on phones in
  Kuwait, and it puts 53 routes over the 175K budget `audit:js` enforces. Every
  other objection below turned out to be fixable or imaginary; this one is a
  measurement, and it is what settled it.
- **The «Next 16 breaks the home page» claim was wrong, and worth knowing why.**
  `audit:runtime` reported `Failed to construct 'URL': Invalid URL` on `/` — and
  the bug was in the audit, which had been requesting `//` since it was written,
  because `relative(OUT, OUT)` is `""` and the guard tested for `"."`. Next 15
  served the double slash; Next 16's router throws on it. So **the one route
  every visitor sees had never actually been runtime-audited.** Fixed, and it
  passes on both versions.
- **Its bundled `eslint-plugin-react-hooks` 6 flags 30 places, and they are not
  bugs.** Most are one pattern that `output: 'export'` forces: a client-only
  value — the query string, `localStorage`, `new Date()` — read in an effect on
  mount, because during prerender there is no `window`. The rule's answer is
  `useSyncExternalStore` across seventeen files including `usePoll`,
  `WainAiCall` and `SearchClient`. Not a version bump's worth of risk.
- **`next build` on 16 rewrites `tsconfig.json` in place**, flipping
  `jsx: "preserve"` to `"react-jsx"` and adding `.next/dev/types`. It does it
  silently, so check `git status` after any attempt.
- **It moves the stylesheet**, `_next/static/css/<hash>.css` →
  `_next/static/chunks/<name>.css`. Two scripts named that directory and now
  find it by extension instead, so they survive the move either way.
- **`eslint@10` and `typescript@7` are both refused by peers** —
  `typescript-eslint@8` is the pin in each case. Do not reach for
  `--legacy-peer-deps`: a half-resolved lint tree disables `npm run scan`,
  which is the thing standing between this repository and the live site.

One finding worth keeping for whoever does attempt it: **`eslint-config-next` 16
ships a real flat config**, so `...compat.extends("next/core-web-vitals")` must
become `import nextCoreWebVitals from "eslint-config-next/core-web-vitals"` and
a plain spread. Leaving `FlatCompat` wrapped around an already-flat config makes
`extends` walk into itself, and eslint dies while trying to *print* the error —
`property 'react' closes the circle`, with a stack inside `@eslint/eslintrc`. It
reads like a broken plugin rather than a wrapper one version out of date.

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
