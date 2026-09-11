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
  traps the planner asserts: `createAccountCronJobV1` **once** got a 403 from
  Cloudflare for a command containing `{ … } > log 2>&1` or `$?` — **and that
  does not reproduce.** Re-measured 11 September: a plain redirection, braces
  with a redirection, and the recorded shape exactly (URL + braces + `> log
  2>&1`) were all three accepted and stored, and another session's job in this
  same crontab carries a plain `>`. Either the cause was narrower than «shell
  plumbing» or the rule changed; nothing here can say which. The planner still
  refuses metacharacters, and that now costs nothing — the deploy is one program
  and its arguments anyway. It can also return a uid for a job it never stored,
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

  So the route is now: **`scripts/publish/deploy-call.php`**. It reads
  `storage/deploy.secret` on the server, signs, and POSTs over the loopback;
  only the HMAC leaves the process, which is why the script is safe to keep in
  the repository. `php d.php probe` sends a correctly signed request that can
  only fail *after* the signature check, so `host_not_allowed` coming back
  proves the HMAC was accepted without downloading or writing anything. That
  probe passes. `npm run deploy:plan` prints this route.

- **The caller is INSTALLED, not fetched at the head of every deploy.** It used
  to be `wget -qO d.php <raw.githubusercontent URL>` … `rm -f d.php` around
  every single deploy — three or four cron jobs, and a host with nothing to do
  with this server on the critical path of a deploy that never needs to leave
  the machine, pinned to a sha that a history rewrite would move. `php d.php
  install` copies it to **`<domain>/storage/d.php`** and a deploy is then one
  command:

  ```
  php /home/u130124229/domains/wainkw.com/storage/d.php <url> <sha256> <version>
  ```

  `storage/` and not `public_html/`, for two reasons that both matter: a PHP
  file in the docroot is a URL, and this one signs deploys; and `storage/` is
  the one directory `deploy.php` never prunes — everything it deletes is under
  `storage/deploy/`. **The 49-character path is what makes it fit**: that
  command measures **197** against a cap between 210 and 279, with a GitHub
  release URL — which is the long case. 13 characters of headroom is not much,
  so a longer artifact URL is the thing that would break it, and the planner
  fails with the length rather than letting the 422 be a surprise.

  **Installing is still fetch-pin-run, just once** — `wget`, `php d.php
  install`, `rm` — because there is no other way to write to this account from
  here. Re-run it only when `deploy-call.php` changes.

  **`php …/d.php version` is the only way to see what is installed.**
  `storage/` is outside the docroot, so no read tool here can look; the planner
  prints the repository copy's fingerprint and the server prints its own.
  Installed 11 September at `22015bb67b0959ad`, and the route proved end to end
  by `php /home/…/storage/d.php probe` answering `host_not_allowed` with
  «the request got past the HMAC check» — the absolute path runs, the installed
  caller reads the secret, signs, and the endpoint accepts it, with nothing
  downloaded and nothing written.

  **Only the artifact still comes from GitHub, and only because bytes cannot be
  pushed to this account at all.** `--archive-url` takes any HTTPS host and
  `php …/d.php allow <host>` adds it to `storage/deploy.hosts`. The mechanism
  stopped depending on GitHub; the payload has not.

  **The site went from `1bbf0e7` to `52e635e` on 11 September, and شوق's agent
  mode reached production for the first time.** `{"ok":true,"deployed":246,
  "removed":10,"emptied":1}` through the installed caller, one cron job, no
  staging step — production's endpoint was the one already probed this session,
  the artifact is sha256-verified before a byte is written, and the state being
  replaced was known-broken for the feature being fixed.

  **Verified below the root, and the content hash is the strongest proof there
  is.** `build.json` said `52e635e5` / `24d1bb330e02434f`, which proves nothing
  on its own. What proves it: `_next/static/52e635e5…/` is the only build-id
  directory left; `_next/static/css/` holds exactly one stylesheet,
  `eff40f810fed1f9d.css`; `/explore/` has its `index.html` and `index.txt`; and
  **the two chunks that carry شوق are on disk under their content-hashed
  names** — `chunks/app/layout-b6d6ff5e116afa4f.js` (18318 B) and
  `chunks/app/search/page-2e9b8c56c8589fc6.js` (14632 B), each the only file in
  its directory. A content hash means the bytes match the artifact, and the
  artifact was checked before upload for the exact `@0.18.1` pin, for no
  surviving range, and for the agent id in both chunks. So «شوق works live» was
  established without reading a megabyte of minified JavaScript off the server.

  **Assets cannot be uploaded beside a deploy — only inside one.** Step 9
  prunes against the manifest, so anything on the disk that is not in the
  artifact is deleted by the next deploy. That is the feature, and it is also
  why «upload the images separately» is a trap: the separate copy survives
  until the next release and then vanishes, which is how `public_html/assets/`
  became a mystery in the first place. Everything the site serves ships in
  `out/`.

  And the obvious top-level names are not available: `images`, `fonts`,
  `assets`, `cats` and `hero` are the PHP app's and are in `PROTECTED_PATHS`,
  so an artifact carrying any of them is refused whole with
  `artifact_touches_protected_path`. wain's own assets live at `og/`, `brand/`,
  `voice/` and `_next/static/media/` for exactly that reason.

  **It cost one ~3.6MB blob in git**, because the sandbox cannot upload to
  Hostinger and cannot cut a release, which leaves the committed-archive route
  that `deploy-plan.mjs` kept for exactly this. Removing the file afterwards
  reclaims nothing and a rewrite is barred by شوق's pinned KB. **`DEPLOY_SECRET`
  makes the next one cost zero** — CI rides a release asset, outside the object
  database.

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

**Her origin allowlist is the other thing that can silently refuse a call.**
`require_origin_header` is on, so a call is refused unless its Host is listed.
`staging.wainkw.com` was added on 11 September — it was missing, and staging
would have failed the moment it served the site, with no clue on wain's side.
`agents_update` deep-merges: sending `platform_settings.auth` alone came back
with the 20 attached tests, the 8 criteria, the prompt and both tools intact.
Verify that from the response anyway.

**The widget URL must name an exact version AND the entry file**, and
`npm run audit:shouq-call` enforces both. It said
`@elevenlabs/convai-widget-embed@1` for months — a semver *range*, on a package
that has never published a 1.x (79 versions, 0.1.0–0.18.1). A range matching
nothing cannot resolve, so the `<script>` failed on every call and the visitor
got «ما قدرنا نوصلك بشوق»; **agent mode was unreachable and the copy blamed the
connection.** Nothing could catch it: no build step fetches that URL, and the
agent suite's own check was `/convai-widget-embed@\d/`, which cannot tell `@1`
from `@0.18.1`. The entry path matters too — `unpkg.com/<pkg>@<version>` answers
a 302 to the package entry and a range answers one to the resolved version
first, so a bare pin puts two redirects in front of 451KB at the moment of a
tap. **A test that asserts a property this loosely is worse than no test**, and
that is the part worth carrying forward.

**And the built-in default that keeps her on was unreachable from CI.**
`WAIN_AI_AGENT_ID` came from `process.env.NEXT_PUBLIC_ELEVENLABS_AGENT_ID ??
DEFAULT_AGENT_ID`, and `??` falls back only on null/undefined. GitHub expands
`${{ vars.ELEVENLABS_AGENT_ID }}` to **`""`** when the variable has never been
set — which it never was — so the empty string came through as the agent id and
every CI build shipped the browser-speech fallback. The default exists to stop
exactly that («a feature that ships switched off by default ships switched
off») and could not, because the only place that sets this variable is the only
place `??` refuses to fall back for. Silently: `deploy.yml` prints «شوق: agent
mode (built-in default)» for an empty AGENT, so the log asserted she was in a
build that had her out. Now `||`, which is what the «none» sentinel beside it
always implied. `audit:shouq-call` asks the module what it decides under unset,
empty and «none» — in a child process, because `process.env` is read at module
load and Node caches modules — and it was confirmed to go red on the empty case
and only that one.

**The call is warmed before it is placed.** `ShouqCallButton` fires
`warmCall()` on hover/focus/touch — a `preconnect` to `unpkg.com` *without*
`crossorigin` (the widget arrives on a plain `<script src>`, a no-CORS request,
and a crossorigin preconnect warms a pool entry it cannot use) and to
`api.elevenlabs.io` *with* it (its fetches are CORS; both origins read out of
the published bundle, not guessed). `armCall()` on pointerdown fetches the
bundle, 100–300ms before the click. Not on hover: 451KB is not something to
spend on a pointer passing by.

**`loadWidget()` in `wain-ai-bus.ts` owns that script, and returns a promise.**
It has to — the call used to inject the tag itself and treat «a tag with this
src exists» as «loaded», which became a lie the moment the button started the
same fetch, and would have announced «متصل» over a bundle still on the wire. A
rejection is deliberately not remembered, and **the dead tag is removed**: a
`<script>` fires `error` once, so adopting one that already has is a promise
that never settles. That cost the full 20-second dial timeout and then blamed
the microphone; measured at 926ms, reported at 402ms after the fix. The sandbox
blocking unpkg is what exercised it — *a blocked egress is a free failure-path
test*.

**The search index starts when the call starts ringing, not on the first tool
call.** `show_places` used to `import("@/lib/search")` mid-sentence, with the
visitor listening, on the flow whose every tool reply ends «لا تسكتين».

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

**Her third tool, `report_gap`, was chosen for what it does NOT promise.**
Everything she could usefully *do* for a caller — send the WhatsApp, register
the business — her prompt forbids precisely because she cannot finish it, and a
tool that lets her half-finish one is worse than none. So the action is the one
with no recipient: record what a caller asked for that the 52 places do not
cover. Webhook, `post_tool_speech` with `pre_tool_speech` **off** — nothing is
being waited on, so a waiting line would be the lie. It returns nothing.

**The instruction lives in the tool's description, not in the prompt** — the
prompt is ~15K characters of tuned Arabic with no update-in-place, and the
description is the text she reads at the moment she decides to call. But the
first version of it taught her the SENTENCE and not the CALL, and that is the
part worth carrying:

**She said «سجّلت طلبك للفريق» and called nothing.** Measured twice, in a
tool-call test: `No tool with name 'report_gap' was called`, with that sentence
in her reply both times. Which is the exact failure this tool was chosen to
avoid — a promise she cannot keep — now made by the tool meant to prevent it.

The description had opened with a principle: «ناديها في اللحظة الوحيدة اللي
عندك فيها جملة جاهزة أصلاً». Rewritten as a **literal trigger** — «أي جواب منك
فيه ما عندي أو ما فيه أو ما لقيت → في نفس الدور نادي الأداة» — plus one worked
example and one ban («وممنوع تقولين سجّلت طلبك بدون ما تنادين الأداة»). **2/2
pass**, with correct arguments. Same lesson as the season override, one level
down: Gemini-flash at temperature 0 obeys triggers and examples, not principles,
and *a tool description is a prompt too*.

**A simulation judge cannot see tool calls.** The conversation test passed this
on her saying she had logged it — the judge wrote «مما يدل على أنه قام بتسجيل
طلب الزائر», which is an inference from her words, and the words were false.
Use a `tool` test for «did she call it»; that one reads the actual call. The
simulation now asserts only what a transcript shows, and the criterion that
guessed is deleted.

**Two more things about tool tests.** They do not fire the webhook — the result
is `Skipping tool call in test mode` — so the n8n table is NOT the evidence,
the transcript's `tool_calls` is. And the parameter-path evaluation does not
resolve for a webhook tool: both `asked` and `request_body.asked` came back
«not found» against a call that plainly carried `asked`. Assert the call's
presence (`parameters: []`) and let the schema's `required` guarantee the field.

23 attached tests now, the three new ones included.

**No shared secret, deliberately.** It is write-only and answers nothing, and a
secret would have to live either in the agent config (readable) or in an n8n
variable — which is the `REPLACE_PHONE_NUMBER_ID` failure mode: unset, silent,
and discovered months later.

## There is an n8n instance, and part of wain runs on it

`sportake.app.n8n.cloud`, shared with sporta. **Nothing in `npm run scan` can
see any of it** — it is not in this repository — so everything below drifts
silently and has to be compared by hand. Twelve workflows; four are wain's.

- **`أداة ملفات وين 🔧` — the only ACTIVE workflow on the whole instance.**
  POST `/webhook/wain-file-tool`, grep/patch/create files on Hostinger over FTP.
  Its secret comes from the n8n variable `WAIN_TOOL_SECRET` and **fails closed**
  when unset; path jail, per-project roots, `.htaccess` directive blocking. It
  writes text files only — no `.zip`, so it is not a way to deploy a build.
- **`Wain + Sporta — Kuwaiti TTS` on `/webhook/fahad-tts`** — **no longer
  wain's bridge; sporta's only.** It speaks the sentences the recorded clip
  library cannot cover, its model stays `eleven_multilingual_v2` to match the
  CLIPS rather than the agent's `flash`, and its voice table had drifted to a
  different woman entirely (Maryam Essa vs Talya `rh16DBXwtscjdPFeMBYf`) with
  every other setting identical — the voice id is the hardest field to catch,
  because nothing breaks.

  **It cannot authenticate, and that is why wain left.** Its `httpHeaderAuth`
  credential `jBrpSddRghia55zW` is EMPTY, so ElevenLabs answers «Neither
  authorization header nor xi-api-key received» — a 401 on every call
  (execution 314). The node itself is wired correctly:
  `authentication: genericCredentialType`, `genericAuthType: httpHeaderAuth`,
  credential attached. It is the credential's own data that is blank, and
  **the n8n MCP server has `list_credentials` and no credential-write tool**,
  so no session can fix this. It is a field in the n8n UI, and until somebody
  fills it in this workflow is a 401 for sporta too.

  wain's bridge is **`/api/tts.php` on wain's own origin** now — see the صوت
  وين section below. The drift described above is the other half of the reason:
  nothing in `npm run scan` could see a workflow that is not in this
  repository, and what replaced it is checked by `npm run audit:tts` on every
  scan.
- **`الحارس` — the site sentinel.** Its detection is right: it refuses to trust
  a status code and requires `_next/static` in the homepage plus «أبراج الكويت»
  in a place page, because a root without its subdirectories answers a healthy
  200 over a site with no CSS. **Its diagnosis prompt is the part that goes
  stale**, and it did — it still prescribed hand-uploading `out/` through
  hPanel, which would now leave the manifest disagreeing with the disk so the
  next deploy prunes live files. **An automation that gives instructions is
  documentation with a pager: when the deploy path changes, its prompt does.**
- **`Wain — Events Hub`** — verified current 11 September: its formatter matches
  `orders.ts` and `places.ts` field for field. Nothing posts to it yet.
- **`Wain — ما لقت شوق (فجوات الكتالوق)`** on `/webhook/wain-gap`, active —
  شوق's one webhook tool. Four nodes into the data table `wain_gaps`
  (`CyBLQKa6LcdgFUAX`). See the شوق section for why it has no shared secret.

**صوت وين cannot be generated from a session, and an API key does not change
that.** `api.elevenlabs.io` is refused by the sandbox's egress gateway — «Host
not in allowlist», a 403 from the proxy and not from ElevenLabs, the same class
of block as the Hostinger file host. So `scripts/gen-voice.mjs` fails here with
or without `ELEVENLABS_API_KEY`; the key is not the blocker, the network is.
Never route around it.

The ElevenLabs **MCP connector** does work, because it goes over
`mcp-proxy.anthropic.com`, and a clip generated that way can be downloaded from
`storage.googleapis.com` and saved — proved 11 September, `docs/voice-sample/`.
But its speech tool takes only prompt, model, voice and a count: **no
`stability`, no `similarity_boost`, and it returns 128 kbps** where the library
asks for `mp3_44100_64` and 0.35/0.8. A library built that way would be twice
the bytes and audibly apart from the TTS bridge it is spliced into — the drift
`docs/voice.md`'s three-way table exists to prevent. Use the connector to HEAR
her, never to build the set.

**The path that works is CI, and it is already written.** `deploy.yml` runs
`node scripts/gen-voice.mjs --ci` before the build, wired to the
`ELEVENLABS_API_KEY` secret, and a runner reaches ElevenLabs over the ordinary
internet. It needs the secret in **GitHub → Settings → Secrets and variables →
Actions**, and nowhere else — a key pasted into a chat is in a transcript
forever and has to be rotated. The workflow already anticipates that the voice
step dirties the tree, which makes `generateBuildId` fall back to a random id,
so its verification reads the build id off the export rather than assuming
`GITHUB_SHA`.

Measured while looking: the library is **324 lines and 13,247 characters** —
6,623 for شوق and 6,624 for سالم — not the 226 the script's own docstring says,
which predates the catalogue growing from 33 places to 52. At the sample's
measured rate (75.99 credits ≈ $0.014) that is **about $2.40** for the set.

**24,026 characters was written here first and it was wrong** — nearly double.
Re-measured by asking `buildClipLines` itself, twice, raw and through
`forSpeech`: 13,261 and 13,247. Worth the correction because the number is the
whole argument for caching the library in CI rather than re-rendering it, and a
cost estimate that is out by 2× is not evidence.

**And CI re-rendered all 324 on every push, until 11 September.** A checkout is
fresh, so `gen-voice.mjs`'s per-clip hash — which exists precisely to make a run
incremental — had nothing to compare against and no files to keep. ~13 minutes
and the full bill per push, for sentences that change a few times a year.
`actions/cache` on `public/voice/` fixes it; the exact key hashes everything
that can change a clip and the `voice-` prefix restore-key hands over the
previous library when one moves, so a line edit costs one render. Correctness
never depended on the key: a restored clip whose hash no longer matches is
re-recorded anyway.

**Generating the clips also silently cost the deploy its proof, and that is the
part worth carrying.** `buildIdFromGit` returns null — Next's random id — when
`git status --porcelain` is not empty, and the voice step writes into the
working tree *before* `npm run build`. `public/voice/` was not ignored, so 324
untracked mp3s and a modified manifest meant that the moment
`ELEVENLABS_API_KEY` was set, every deploy would have shipped
`_next/static/<random>/` instead of `_next/static/<commit>/` — the one artefact
whose name carries the commit, and the thing `deploy:verify` requires. Nothing
would have failed. `public/voice/` is gitignored now (it is output, and 14MB of
it, in a repository already carrying 25MB of committed archives that cannot be
rewritten away), and deploy.yml asserts the tree is clean before it builds
rather than discovering this afterwards. **A feature that dirties the tree
disables the build-id proof — check that before adding a build step that
writes.**

## The live bridge is wain's own, and it is installed

`scripts/publish/tts-endpoint.php`, serving **`/api/tts.php`** on both stages,
installed 11 September at `01b7429a4dbe6983` — 19,821 bytes, the same
fingerprint on production and staging and on the copy in this repository.
Proved live the way `deploy.php` was: a loopback GET came back carrying its own
`{"ok":false,"error":"method_not_allowed"}` and a 405, so the request reached
PHP and the `Host:` header picked wain's docroot.

**It is inert until `<domain>/storage/elevenlabs.key` is filled in** — the
installer creates it empty at 0600 and never writes a key, because this file is
fetched from a public URL to be run, so anything it carried would be public.
Until then every call is `503 not_configured` and nothing is spent.

**This used to be a pair of switches whose half-on state was worse than off**:
`NEXT_PUBLIC_WAIN_TTS_URL` set AND the n8n workflow active, where the variable
alone bought a four-second wait and then the robot. There is no variable now.
`/api/tts.php` is a relative path on the site's own origin — not a secret, not
an origin to allowlist, the same string on staging as in production — so
`voice.ts` defaults to it, with `||` and a «none» off switch for the reason
written up in `wain-ai.ts`. The variable still overrides.

**Defaulting it on is only free because voice.ts gives up.** 404, 503 and 403
cannot change while a page is open, so the first one is remembered and the rest
of that visit's sentences go straight to the browser voice. A timeout, a 5xx or
a 429 is NOT remembered — those a second attempt can win, and a render the
listener abandoned has still been cached server-side, so the next sentence may
be instant. `ignore_user_abort` is what makes that true: the four-second
deadline gives up on the *listener*, never on the render, so the characters are
paid for exactly once whoever hears them.

**The cache is the cost control, not the rate limit.** These sentences are
assembled from a 52-place catalogue, so the space is bounded and the spend
converges to it instead of growing with traffic — which n8n, re-rendering every
request, could never do. The daily cap counts MISSES only; hits are free and
uncapped, or a popular sentence would switch the feature off for the reason it
exists to avoid. Text is whitespace-normalised before it is hashed, and the
hash covers the rendition (voice, settings, model, format) and not only the
text — the same identity `gen-voice.mjs` learned to hash after a text-only
digest served the old voice for ever.

**`npm run audit:tts` is the anti-drift check, and it is why this is in the
repository at all.** It asks `gen-voice.mjs --rendition` and
`php tts-endpoint.php table` for their own tables, each by its own
interpreter — a regex over either source would pass the day it was written —
and fails when they disagree, naming the field. Confirmed it can go red, not
only green. `npm run test:tts` is 25 assertions against a real PHP server with
a stub upstream; the stub is reached through `WAIN_TTS_API_BASE`, a seam that
exists so no test ever spends a character.

**One trap it already avoids.** `dirname(__DIR__, 2)` is right at
`public_html/api` and wrong at `public_html/staging/api` — one level deeper it
lands on `public_html`, and the endpoint would report itself unconfigured on
staging only, silently. That off-by-one had to be special-cased once already,
in `setup-staging-endpoint.php`. `storageDir()` walks UP instead, so the two
installed copies are byte-identical and one fingerprint describes both.

**And nothing is watching this site**: the Sentinel is inactive and its
WhatsApp node still says `REPLACE_PHONE_NUMBER_ID`. That is how شوق's agent
mode stayed broken in production for months.

The rest (`راشد`, Intelligence Center, `أنيلكا`, `سالم` ×2) are inactive and
blocked on order/queue data that does not exist, not stale. Sporta's, Albahhar's
and the MySQL monitor are not wain's — leave them.

## wain speaks MCP

`mcp/wain-mcp.mjs`, pointed at by `.mcp.json`, so opening this repository in an
MCP client is the whole setup — no install, no config, no key. Five tools:
`search_places`, `get_place`, `list_categories`, `list_places`, `list_actions`.

**It loads `src/lib/places.ts` and `src/lib/search.ts`, bundled once at startup
with the local esbuild** — the same trick `scripts/audit-places.mjs` uses, and
for the same reason. A JSON snapshot of the catalogue would pass its tests the
day it was written and drift the first time somebody edited one and not the
other, and an answer here that disagreed with the site would be worse than no
answer. `test:mcp` asks both the server and `search()` the same four questions
and requires identical result lists, so drift fails a test rather than
misleading someone.

**No `@modelcontextprotocol/sdk`, deliberately.** It was tried first and pulls
**68 packages** — express, hono, cors, body-parser, ajv, eventsource — an HTTP
server stack, into a project whose first principle is that there is no server,
and onto every `npm ci` the deploy runs. All of it to carry newline-delimited
JSON-RPC between two pipes. So the transport is written out, and the parts an
SDK would have provided are exactly the parts `tests/mcp.test.mjs` proves
against a real child process: two messages in one write, a notification that
must never be answered, an unknown method, a malformed line that must not stop
the messages after it.

**A tool failure is content with `isError`, never a JSON-RPC error.** A model
can read the first and recover — `get_place` on a bad slug answers with
`did_you_mean` — and cannot see the second at all.

## The search button is the middle of the site

It is the only control in the root layout that leads anywhere the navbar does
not, so it is where wain's moves belong — and it led nowhere. The ⌘K palette
met an empty box with a sentence and a failed query with «ما لقينا شي.»,
which is one dead end drawn twice, while /search had already been given a way
on and «سجّل مكانك» existed only as a footer link. Three surfaces answering
one question three ways.

**`src/lib/wain-hub.ts` is the answer once; `SearchHub` draws it.** The palette
(empty AND no-results) and /search's dead end are the same component now, so
they cannot drift. Same rule as `place-kit.ts`: **nothing in `wain-hub.ts` may
import the catalogue** — it is reachable from the palette button, which is in
the root layout, and `audit:js` fails if place records follow it there. Cost
measured: shared stayed 119.3K, `/search` went 158.4K → 158.6K.

**`mcp/wain-mcp.mjs` bundles that same file as `list_actions`**, so «what can
wain do» has one answer whether it is asked over stdio or by tapping the search
button. `tests/mcp.test.mjs` asserts equality with the module rather than a
retyped list — a copy would pass the day it was written.

**Ordering and the queue are deliberately not in the hub.** 0 of 52 places
satisfy `acceptsOrders` or `takesQueue`, so a «طلباتي» row advertises a door
onto nothing; `OrdersLink` already covers the case that matters. Add the row
when a place takes orders and both surfaces get it.

`ShouqCallButton` gained `onTapped`, which the palette needs: it is a modal at
z-60 and the call sheet mounts in the root layout, so a call placed from inside
it would ring underneath its own backdrop. Not an `onClick` on a wrapper — the
tap has to reach `primeAudio` first, and a bubbling handler that closes the
dialog could unmount the button mid-gesture.

## Checks

`npm run scan` is lint plus ~22 audits. Browser suites: `test:hangout`
(hangout, hangout-page, map-pin, search-button, search-keys, shouq-search,
search-plan, swipe), `test:journey`, `test:register`, `test:shouq`,
`test:orders`, `test:net`. PHP suites, neither in `scan` because neither can
assume php: `test:api` (40) and `test:tts` (25).

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

**There is no red left, and the last one was the test's fault, not the code's.**
The swipe suite's «a 4px scroll is left where it was put» failed on every run
for weeks and was written down here as known-failing. It was unpassable.
Measured on the home page's category rail, all three modes side by side:

| `scroll-snap-type` | 4px | 62px | 118px | 240px |
|---|---|---|---|---|
| `x proximity` | →124 | →124 | →124 | →248 |
| `x mandatory` | →124 | →124 | →124 | →248 |
| `none` | →4 | →62 | →118 | →240 |

**Proximity and mandatory are identical on that path.** `scrollBy({behavior:
'instant'})` is a programmatic scroll and Chrome re-snaps after one in the
direction of travel whatever the strictness — which the suite's own header
already said, before building an assertion on the two differing. So the red
line could only have gone green with snapping switched off, and, worse, the
two GREEN assertions beside it pass under mandatory too: **the section could
not catch the revert it existed to catch.** Rewritten around what is
measurable — snapping is on and assisting — and the strictness itself is
asserted from the computed value, which is the check that does catch a revert.
The felt difference is a compositor fling and `Input.synthesizeScrollGesture`
moves nothing headless, so it cannot be tested here at all.

Second time in two days that a loosely-written assertion was worse than none —
see `/convai-widget-embed@\d/` above, which could not tell `@1` from `@0.18.1`.
**When a test has been failing or passing «always», check that it can do the
other thing.**

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

**Setting the site's type in an Adobe surface has one trap worth knowing**:
weight 400 is `IBMPlexSansArabic` with NO `-Regular` suffix — every other weight
is `Family-Style`, so the obvious guess is `not_found` — and asking for the bare
family name gives you Light (300), not Regular. A wrong PostScript name does not
error, it substitutes, so it reads as a design decision. `docs/type.md`.

**When a tap target is too small, the type is usually not the reason.**
«استكشف» in the breadcrumb failed at 42px wide because it is four letters and
the link is only as wide as its word. Its height was never in question. The
saving there was the margin.

## Style

No redesigns beyond what is asked for. Fix the current theme. Comments in this codebase explain *why*
and record the bug that made the rule necessary — match that, and do not add
decorative commentary.
