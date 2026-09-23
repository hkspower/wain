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
- **hPanel File Manager → Extract.** It merges. The docroot used to be
  *shared*: eight directories that this repo did not put there.

  **It is not shared any more, and «an older PHP app» was the wrong name for
  what was in it — it was sporta, entire.** This file called it that for
  weeks, and a vague name is why nobody looked: «an old app» sounds like
  something that was always going to be there. Proved by hash rather than by
  guess, 17 September — `api/site-manifest.txt` on `wainkw.com` and on
  `sporta.com.kw` were **byte-identical**, 14,568 bytes, 162 lines, every
  SHA-256 matching. The same install, in two docroots.

  It was inert, and the way it was inert is the useful part: `config.php` and
  the per-directory `.htaccess` did NOT come with the copy. sporta's own
  `pay/` has six files, wain's had four — the two missing were exactly those.
  So no database, no KNET keys. **But no per-directory `.htaccess` either**,
  and wain's root one denies six named old wain helpers and explicitly not
  `api.php`, so nothing covered the copy. A loopback GET (below) found
  `/knet/selftest.php` answering **200 with a rendered page**: «Sporta KNET —
  deployment self-test», PHP 8.5.4, extensions, `AES trandata: round-trip
  OK`, `config.php : MISSING`. `pay/pay.php` gave a clean 503 and
  `api/store.php` an empty 200. So the damage was disclosure, not payments —
  and **«it has no config so it must fatal» was wrong**: it rendered a tidy
  diagnostic instead.

  Moved to `<domain>/storage/sporta-old/`, not deleted — reversible, instant
  (same filesystem), and `storage/` is the one directory `deploy.php` never
  prunes. Seven whole directories went (`pay`, `knet`, `assets`, `cats`,
  `fonts`, `hero`, `images`); the docroot went from 35 entries to 28, all of
  them wain's.

  **`api/` could not go with them, and that is the trap to remember.** It is
  the one shared directory: sporta's 49 files AND wain's own `tts.php` and
  `deploy.php` live in it. `rm -rf api` would have taken out the deploy
  endpoint and the صوت وين bridge — the whole write path to this account. It
  was moved whole and the two files moved back, verified at 19,821 and 10,985
  bytes, then verified *functionally*: both answer `method_not_allowed` with
  a 405, and `/knet/selftest.php` now answers 404 with wain's own «وين رايح؟»
  page.

  Checked before any of it: `hosting_listWebsitesV1` shows `sporta.com.kw`
  and `static.sporta.com.kw` both rooted at `domains/sporta.com.kw/public_html`,
  and nothing but `wainkw.com` and `staging` at wain's — so removing the copy
  could not take sporta down. **That last clause is out of date: there is a
  third, `hub.wainkw.com`**, an addon domain created 16 September with its own
  docroot at `domains/hub.wainkw.com/public_html` and its **own DNS zone**,
  which is why it does not appear among wainkw.com's records. It resolves
  publicly and carries its own MX and SPF. Nothing wain deploys touches it;
  the point is not to read "wain's account has two vhosts" as still true. And `grep` found **0** references to any of the
  seven paths in `src/` and `public/`; wain's own assets are `og/`, `brand/`,
  `voice/` and `_next/static/media/`.
- **`PROTECTED_PATHS` still lists all eight, and that is now backwards.** It
  was right when the copy was there — it stopped a wain deploy clobbering the
  shop. With the copy gone it is the thing that would stop a deploy cleaning
  up if one ever came back. Leave it until someone re-reads `deploy.php`; just
  do not read it as evidence that those directories belong to wain's docroot.
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

  And the obvious top-level names are still not available: `images`, `fonts`,
  `assets`, `cats` and `hero` are in `PROTECTED_PATHS`, so an artifact carrying
  any of them is refused whole with `artifact_touches_protected_path`. wain's
  own assets live at `og/`, `brand/`, `voice/` and `_next/static/media/` for
  exactly that reason, and they should stay there — the directories are gone
  from the disk now (see *hPanel File Manager → Extract* above), but the
  endpoint's refusal is unchanged, so claiming one of those names still fails
  the deploy rather than working.

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
- **`storage/` was audited on 19 September, and `deploy.secret` was
  world-readable.** `-rw-r--r--`, in a `drwxr-xr-x` directory, on shared
  hosting — while `deploy.hosts`, `d.php` and `elevenlabs.key` beside it were
  all `0600`. That file is the HMAC key that authorises a publish to
  `www.wainkw.com`. **`deploy.php`'s own header says `deploy.secret <- shared
  secret, 0600`**, so this was drift from what the code documents, not a
  design choice, and nothing anywhere checked it: `storage/` is outside the
  docroot, so no audit in `npm run scan` can see it and none ever will.

  Now `0600`, and **the fix is durable** — `deploy.php` was read end to end
  (293 lines) to be sure: it only ever `is_readable`\/`file_get_contents` the
  secret and never creates or chmods it, so nothing regenerates it at 0644.
  Tightening it was safe for a reason worth keeping, because the obvious
  worry is that the web server is a different user and 0600 would lock the
  endpoint out of its own key: **the `artifact-*.zip` files in
  `storage/deploy/` were written by `deploy.php` and are owned by
  `u130124229`**, which is how you prove web PHP runs as the account user
  without installing a probe.

  Reading storage at all is a cron job — `ls -la <abs path>`, one program and
  its arguments, delete after one firing, the same shape as every other write
  path here. The `hosa` file tools are jailed to the docroot and answer 422
  for a `..` path.

- **Two more things that listing showed.** `storage/deploy/` held three
  artifacts at ~3.5MB each, which is `KEEP_RELEASES = 3` working — except
  **two of the three were the same release**, because a per-minute deploy job
  fires twice and step 10 keeps the newest three *files*, not three distinct
  versions. So a double-fire silently costs a rollback slot; delete the job
  after its first firing for that reason too, not only to stop the repeat.
  And `public_html/api/` is down to `deploy.php` and `tts.php` — the sporta
  removal of 17 September held, verified rather than assumed.

- **The crontab is shared, and a job you did not create is probably not a
  problem.** This account carries **ten vhosts** — `hosting_listWebsitesV1`,
  21 September, where this file used to say seven sites — and other sessions
  use the same fetch-pin-run write path. The ones that are not wain's or
  sporta's: `almuhallab-code.com` and `discs.`, `mawsoool.com` and
  `nr.mawsoool.com` (16 August and 19 September, both newer than the «seven»),
  and a Horizons builder site, `rare-dvd-collector-store-118349.hostingersite.com`.
  Two turned up on 10 September — `remove-strays.php`
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

## The 20 September deploy, and three things it broke on the way

`861dd9f` is live: `{"ok":true,"version":"1.1.0","deployed":249,"removed":7,
"emptied":1}` at 11:15:02Z, through the installed caller, one cron job,
deleted after its first firing and confirmed gone by a listing.

**Verified below the root and then publicly.** The six proofs are byte-exact
against the archive: `_next/static/5a5e28d9…/`, `css/fdfbc4c1471b0eab.css`
(88,103) and Leaflet's `css/1de76be520b4de19.css` (11,181), `chunks/app/
search/page-88ebec6f153b81a5.js` (24,346), `explore/index.html` (18,049), a
place page (61,769), 52 og images, and both live-map chunks —
`d0deef33.cac6acee3fffe7af.js` (148,503) and `815.4b41beeac1eec500.js`
(2,259). Then `hosting_clearWebsiteCacheV1`, then a cron `wget` of
`https://www.wainkw.com/build.json` — **from the server out through the
edge** — returning the new build. That last step is the one the loopback
cannot make.

**`DEPLOY_SECRET` is still unset, and the evidence is 328 runs long.** Every
`deploy.yml` run fails in about ten seconds at step 5, «Check the deploy
secret is configured», with all fourteen steps after it skipped. So CI has
never deployed anything and the cron route remains the only one. Setting that
one secret is what makes the next deploy cost nothing; until then each one
adds another ~3.6MB blob, because no session can upload to Hostinger and the
GitHub MCP surface has no release-asset tool — checked, not assumed.

**Three pieces of tooling refused this build before it could ship, all for
the same blind spot**, which is now four counting `gen-sw` and `audit:js` from
the live-map commit: something reached only by a runtime `import()` is
invisible to anything written before it existed.

- **«expected exactly one stylesheet under _next/static, found 2».** The
  second is Leaflet's, in its own chunk, referenced by no page's HTML. The
  planner now counts only stylesheets a page actually asks for, and says how
  many were on demand when the count is wrong.

- **The plan described `out/`; the server fetches the ARCHIVE.** This is the
  one worth reading twice, because nothing complained. An ordinary deploy
  builds, commits the zip, and then has `out/` rebuilt at the new head while
  the zip on disk is still the committed bytes. Both trees clean, both commits
  in history, and the existing two-commits check passes **because the only
  file between them is the archive** — which is exactly the case it was
  written to allow. Every proof was then wrong by one commit: out/ said
  `529fd14`, the archive and therefore the live site said `5a5e28d`, and
  `_next/static/<sha>/` is named for whichever commit built it. The six proofs
  had to be checked by hand.

  Fixed in three passes, and the middle one is the lesson: taking the build id
  from the archive while still asking whether the proofs existed in `out/`
  made the planner refuse a deploy that was fine — **a half-fix that fails on
  the normal path is worse than the bug.** Now the commit, the digest and the
  proof existence check all read the archive (`unzip -Z1`, `unzip -p
  build.json`), `out/` is kept only to notice the divergence, and the
  divergence is a note rather than a refusal because it is the normal case.

  The distinction to hold on to: everything before the proofs is a question
  about the BUILD, and `out/` is where to ask it. A proof is a claim
  `deploy:verify` will make of the live server, so it must name something the
  ARTIFACT carries.

**And the zip is not byte-reproducible**, so `npm run release` after
committing it re-dirties the tree and the planner stops. `git checkout --
wain-<version>.zip` is the move — never rebuild the archive to satisfy a
dirty-tree complaint, or the sha256 in the command stops matching the bytes
at the pinned URL.

**The live build id trails HEAD on purpose, and that is not a failed deploy.**
The site is stamped `5a5e28d9…` — `build.json`, `_next/static/<sha>/` and
`sw.js` all name the commit that built the archive. HEAD has moved past it
since, and will keep moving, on commits that change the planner, this file and
nothing that ships.

**So do not read a mismatch as staleness. Ask git instead:**

```
git diff --name-only <live build id>..HEAD -- src public
```

Empty means the live export IS the current code and a deploy would move only
the stamp — `build.json`, the build-id directory's name and the service
worker's version hash — for no visitor-visible change and one more permanent
~3.6MB blob. That was the reading on 20 September after the deploy: two files
changed, `CLAUDE.md` and `scripts/deploy-plan.mjs`, zero under `src/` or
`public/`, and a second deploy was declined for exactly that reason.

The blob is the whole argument. It cannot be rewritten away — شوق's knowledge
base is pinned to a commit on this branch — so «deploy to tidy the stamp» is a
permanent cost for a cosmetic gain. Spend it when something ships.

**One cron reading that is not a warning.** Four jobs from another session —
`live-schema-completeness.php`, `live-permissions-check.php`, a `brand-strip`
fetch and a `fileperms` probe, all sporta's — were in the crontab at the
start and gone by the end, deleted by whoever created them. Left alone
throughout, exactly as the section above says to.

## The security pass — 20 September

Source review plus the live filesystem and config, read through the `hosa`
connector and one cron job. **Not** a pentest: nothing was fuzzed, nothing was
exploited, and this sandbox cannot reach the site at all. Read what follows as
«what the code and the disk say», which is a different claim from «what an
attacker could do».

**Nothing critical is live. The one thing that could cost real money is inert,
and the reason it is inert is an empty file.**

### `/api/tts.php` is unauthenticated, and its ceiling is about $136 a day

It has to be — a static export has nowhere to hold a key, so a visitor's
browser calls it directly. What bounds the spend is arithmetic, not auth:

```
DAILY_MISSES 1500  ×  MAX_CHARS 500  =  750,000 characters/day
750,000 × $0.000181  ≈  $136/day  ≈  $4,000/month
```

The rate is the measured one — 13,247 characters ≈ $2.40, from the voice
section above. **Today the exposure is exactly $0**, because
`elevenlabs.key` is 0 bytes; the ceiling becomes real the moment somebody
pastes a key. **Lower `DAILY_MISSES` before that happens**, not after.

Two things that do NOT bound it, and should not be mistaken for controls:

- **The origin check is `if ($origin !== '')`** — a request with no `Origin`
  header skips it entirely. That is deliberate and written up at the line
  (some same-origin POSTs omit it, and the header proves nothing anyway), but
  it means the allowlist stops nobody who is trying.
- **`RATE_PER_MIN` is per IP.** It shapes ordinary traffic and falls to
  rotating addresses.

**And the guard fails OPEN.** `$count()` returns `0` when `fopen` fails —
«a guard that cannot open its file must not deny service». So if
`storage/tts/` ever becomes unwritable, disk-full or otherwise, the per-IP
limit *and* the daily budget both stop tripping silently and the ceiling
disappears. That is the one weak point in the counter: the counter itself is
sound, holding `flock(LOCK_EX)` across the whole read-modify-write, so its own
«not atomic across concurrent requests» comment is more modest than the code
deserves.

### `storage/` is world-readable, and the files inside it are not

Measured:

```
drwxr-xr-x  storage/            ← 0755, traversable by every account on the box
-rw-------  deploy.secret (64)  ✓
-rw-------  deploy.hosts, d.php ✓
-rw-------  elevenlabs.key (0)  ✓
drwxr-x---  deploy/, deploy-staging/  ✓
drwxr-xr-x  sporta-old/         ← 0755 AND readable
```

The 19 September fix to `deploy.secret` held. What it did not cover is the
directory around it: on shared hosting every other account can list what is
there, and can read `sporta-old/` outright. `chmod 700 storage` and
`chmod -R go-rwx sporta-old` close it, and both are safe for the reason that
made the 0600 safe — **web PHP runs as `u130124229`**, proved by the ownership
of the `artifact-*.zip` files `deploy.php` itself wrote.

### Accepted rather than missed

**`script-src 'unsafe-inline'`** is forced by `output: 'export'`: there is no
server to mint a per-request nonce and Next needs inline hydration scripts.
What makes it tolerable was measured rather than assumed — **0** uses of
`dangerouslySetInnerHTML`, no `eval`, no `new Function`, no `innerHTML` in
anything shipped, and no user-generated HTML anywhere on the site.

**Seven dependency vulnerabilities, one critical, all dev-only.** `npm audit
--omit=dev` is 0 — nothing reaches `out/`. See the Capacitor note in *Checks*
for why there is no update to take.

**HSTS carries no `includeSubDomains` and no `preload`**, deliberately (see
`.htaccess`), which does mean `staging.` and `hub.` are not covered by it.

**The n8n file tool is armed but unloaded.** `/webhook/wain-file-tool` can FTP
into wain's, sporta's AND almuhallab's docroots; it fails closed today because
`WAIN_TOOL_SECRET` is unset. Its secret comparison does not early-return, so
it is effectively constant-time. The exposure is not the code, it is that one
webhook holds write access to three projects — if it is never going to be
used, delete the workflow rather than leave it armed.

### Clean, and worth not re-checking from scratch

No secrets committed — the only matches are deliberately fake test fixtures.
The docroot is 27 entries, all wain's plus `staging`, and `api/` holds exactly
`tts.php` and `deploy.php`: the 17 September sporta removal has held, and
there are no stray archives. Every `target="_blank"` carries `noopener`, and
every external origin the bundle references is in the CSP under the directive
it needs. Headers: `nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy:
strict-origin-when-cross-origin`, `Permissions-Policy: camera=(),
geolocation=(self), microphone=(self)`, HSTS one year. `/admin` renders
`NotConfigured` with Supabase off and robots disallows it, `/orders/` and
`/queue/`. `media-endpoint.php`'s key-gated read uses `hash_equals`, fails
closed on an empty key, and its `draftId` regex, whitelisted kind and
whitelisted extension leave no path out of the pending directory.

## The hosting settings — read 21 September

Read-only, through the `hosa` connector: PHP, SSL, redirects, subdomains, git
auto-deployment, databases. Nothing was changed. It is the panel's half of the
security pass above, which covered the source and the disk and never asked the
control panel what it was configured to do.

**PHP is 8.5.4 — the newest supported — and staging is byte-identical to
production, option for option.** That is worth having measured rather than
assumed, because the whole staging argument is that it rehearses the deploy;
two hosts on different php.ini would make it a rehearsal of something else.

**Hardened past the defaults, and somebody did that deliberately:**
`expose_php` **Off** (default On), `session.cookie_secure`,
`session.cookie_httponly` and `session.use_strict_mode` all **On** (all
default Off), `log_errors` **On**, `display_errors` Off, `date.timezone`
**Asia/Kuwait**. `disable_functions` carries `system, exec, shell_exec,
passthru, proc_open`. `zip`, `curl`, `gd` and `fileinfo` are all present,
which is exactly what `deploy.php`, `tts.php` and `media.php` need.

**Clean and worth not re-deriving:** SSL active and lifetime with the HTTPS
redirect ON, valid to 26 Nov 2026; **git auto-deployment not configured**,
which is correct because deploys go through the signed endpoint and a second
write path into the docroot is the thing this whole file exists to prevent; no
panel redirects, so the apex→www 301 in the export's own `.htaccess` is the
only one; `staging` the only subdomain, rooted where the panel puts it; and
**no database remote-connection rules at all**, so no `%` wildcard host.

**One correction to the record: the panel calls the certificate provider
`hssl`, and the wire says Let's Encrypt.** Both are true — Hostinger
provisions LE under its own label — and the discrepancy is precisely why the
CAA record was written from an `openssl s_client` reading rather than from
this screen. A CAA naming the wrong CA does not fail loudly; it fails in ~90
days when renewal is refused. **Do not re-derive the issuer from the panel.**

**There is a MySQL database on `wainkw.com` and nothing in this repository
uses it.** `u130124229_ask`, user `u130124229_hex`, created 10 May, 2MB, full
privileges — Create, Drop, Alter, Execute. wain's back end is Supabase and it
is unset; `grep` over `scripts/`, `src/` and `supabase/` finds **zero** uses
of `mysqli` or `PDO`. So it is a leftover holding live credentials on wain's
domain. Not reachable remotely (no remote-connection rules), which is what
keeps it a tidiness question rather than a security one — but it is an
unowned credential, and «an old database» is the same vague name that let
sporta's copy sit in this docroot for weeks.

**`allow_url_fopen` is On**, which is the PHP default rather than a choice,
and Hostinger's own panel text calls it «a great security risk». Every
endpoint here uses curl, so turning it off is probably free — but that is a
change to a live host, it is not what a scan is for, and nothing has measured
what else on this account reads a URL with `fopen`. Named, not touched.

One reading NOT to over-interpret: the `brotli` PHP extension shows as
disabled. Brotli is done by the web server and the edge, not by PHP —
`Content-Encoding: br` was measured on both HTML and CSS the same day.

## DNS, TLS and mail — checked 20 September

**There is a CDN in front of this site and nothing here knew it.** `@` is an
ALIAS and `www` a CNAME, both to `*.cdn.hstgr.net`, and every hostname answers
with two anycast addresses. That matters for the section above: **the loopback
check verifies the ORIGIN, not what a visitor gets.** `wget … https://127.0.0.1`
with the right `Host` never leaves the machine, which is the whole point of it
and also its limit. The origin's own headers argue the edge cannot serve stale
HTML — `max-age=0, must-revalidate` on every page, and the assets are
content-hashed and `immutable`, so a stale one has no name to be served under —
but Hostinger's server-side page cache is a panel setting that can ignore them.
`hosting_clearWebsiteCacheV1` is the purge, and it also purges the CDN. Run it
after a deploy, or accept that "verified live" stops at the origin.

**The certificate is Let's Encrypt, and that was read rather than assumed.**
`openssl s_client` over the loopback, as a cron job — one program and its
arguments, stdin is EOF under cron so it exits on its own: `CN=wainkw.com`
issued by `C=US, O=Let's Encrypt, CN=YE2`, chaining to ISRG Root X2 → X1, EC
P-256, TLS 1.3, `Verify return code: 0`, valid to 26 Nov 2026. SAN covers
`wainkw.com` and `www.wainkw.com`; staging and hub hold their own.

That fact is what made a **CAA** record safe to write instead of a guess, and
the guess is the danger: CAA names the only CAs allowed to issue, so naming the
wrong one does not fail loudly — it fails in ~90 days when the auto-renewal is
refused. Now at the apex, TTL 3600:

```
0 issue     "letsencrypt.org"
0 issuewild "letsencrypt.org"
0 iodef     "mailto:cs@sporta.com.kw"
```

`issuewild` names the same CA rather than `";"`, so a wildcard Hostinger might
issue later still works. **If Hostinger ever changes certificate provider this
record breaks renewal** — that is the whole cost of having it, and the fix is
to delete the two `issue` lines or add the new CA. Re-read the issuer the same
way before assuming which.

**DMARC went from `p=none` to `p=quarantine`**, matching `sporta.com.kw`, which
has run that policy on the same mail path (Hostinger MX, same SPF include, same
`cs@sporta.com.kw` reporting address) for long enough to be evidence rather
than hope. `pct=100`, `ruf` added beside `rua`. The external-reporting
authorisation this needs already exists and was checked rather than assumed —
`wainkw.com._report._dmarc.sporta.com.kw TXT "v=DMARC1"`, which is what
RFC 7489 requires for reports to reach a different domain. Revert by setting
`p=none`; nothing else has to move.

**Verified from the authoritative servers, not from the panel.** Node's
resolver pointed at `ns1/ns2.dns-parking.com` returns the CAA triple and the
new DMARC string, with ALIAS, MX, SPF, the Google verification TXT, three DKIM
CNAMEs, `www` and `staging` all untouched — `overwrite: true` matches on name
AND type, so it replaced only the two records sent. The control that makes the
CAA reading mean anything: `sporta.com.kw` has no CAA and answers `ENODATA`
from the same query.

**The apex is a 301 to `www` now, and «the canonical tag covers it» was the
wrong answer.** `wainkw.com` and `www.wainkw.com` both land in this document
root, so every page answered at two addresses. The whole source names one —
`metadataBase`, `robots.ts`'s host, `sitemap.ts`'s BASE, `wain-hub.ts`'s
`WAIN_ORIGIN` — and the canonical tag did declare which, but **a declaration
is not a redirect**: a link shared as `wainkw.com/places/…` kept the visitor on
the apex for the whole visit, with every absolute url the page produced
pointing somewhere they were not.

It is in the export's own `.htaccess`, Host-keyed, and **mod_rewrite, which
that file otherwise refuses** — its header warns against a catch-all rewrite to
index.html masking real 404s, and this is neither catch-all nor a rewrite: one
host, a redirect, so a missing page is still missing at the far end. Two
conditions carry the whole risk. `^wainkw\.com$` is the bare apex, because this
file ships INSIDE the export and therefore lands in staging's docroot too — a
loose host pattern would bounce `staging.wainkw.com` onto production and the
stage would silently stop existing. And `/api/` is exempt, because `deploy.php`
and `tts.php` are POSTed to and a 301 answers a POST by dropping its body;
both callers send `Host: www.wainkw.com` today, which is exactly why it is
worth excluding — the day one does not, the failure is a deploy that reports
success having written nothing.

Verified over the loopback by asking the same host three ways, which is the
only way to see a Host-keyed rule at all — and then **publicly**, from the
server out through the edge: `https://wainkw.com/explore/` answers
`301 → https://www.wainkw.com/explore/` with `server: hcdn`.

**HTTP/3 is already on, and nothing in this repository controls it.** Every
edge response carries `alt-svc: h3=":443"; ma=86400`, so a browser's first
visit goes over HTTP/2 and everything after it over QUIC for a day. The origin
advertises it too (`h3` and `h3-29`, `ma=2592000`), so both hops offer it.
What could NOT be done from here is completing a QUIC handshake to prove it
end to end: the server's curl answers `option --http3: the installed libcurl
version doesn't support this`, and this sandbox cannot reach the site at all.
So the honest claim is «advertised by the edge with a day-long lifetime», not
«measured a QUIC connection».

**That probe has a trap worth keeping**: curl parses every option before it
makes any request, so one unsupported flag anywhere in a `--next` chain kills
the whole command and returns *no output at all* — not the other requests'
headers with one error beside them. A three-request probe came back as one
line of usage text. Keep an unsupported flag in a job of its own.

**And the edge does not cache the HTML**, which settles the worry recorded in
the deploy section with a measurement instead of an argument:
`x-hcdn-cache-status: DYNAMIC` on `/` and on staging's `/`, `MISS` on the
apex 301. So the `max-age=0, must-revalidate` the origin sends is being
honoured and a deploy cannot be hidden behind a stale edge copy. Purging after
a deploy is still right — it costs nothing and the setting is a panel toggle
nobody here would see change.

One reading NOT to over-interpret: `x-hcdn-request-id` ends `fra-edge5`, so
that request was served from Frankfurt. It was made *by the server*, which
lives in the same datacentre; it says nothing about which PoP answers a phone
in Kuwait.

`hub.wainkw.com` is deliberately left alone: no DMARC, no CAA, not wain's.

## شوق, the ElevenLabs agent

Agent `agent_1701m1gcrccrethae9y3nyv1e116`. 25 attached tests; run them after
any prompt change, `repeat_count: 2`. There is no update-test tool: to sharpen
a judge, delete the test and recreate it, then re-attach the new id. **47/50**
at `agtvrsn_0901m2wvwm14edcvaq2n1cmxwk68`, from 43/50.

**«At temperature 0 a failure that shows once shows twice» is WRONG, and
believing it has been costing readings.** Re-run on 20 September against the
same version, nothing changed in between: 47/50 again — and **a different
three**. Yesterday `ذكاء ١` failed 2/2 and the two-word-readback shape test
1/2; today the shape test passes 2/2, `ذكاء ١` is 1/2, and `ذكاء ٣` and
«مو فجوة» are 1/2 each. Same score, moved underneath it.

The reason is that temperature 0 fixes HER, not the test: **the simulated
caller is an LLM too**, so each run hands her a different conversation, and a
1/2 is an ordinary outcome rather than evidence of a broken judge. Read a
score as a score. What still means something is a **2/2**, and the trend
across runs at one version.

**One durable defect, and it is the only one worth acting on.** `ذكاء ١` —
area + kids + heat — she answers «الجو حار» with **شاطئ المارينا**: 2/2 on
19 September, 1/2 on the 20th. It is not the indoor/outdoor-side family
recorded below, because a beach has no indoor side for her to describe
instead; the rule that should fire is the constraint check plus the summer
override, and it loses. Not fixed here — a prompt edit is a prompt-and-test
cycle, and with the suite moving underneath it the fix could not be cleanly
proved in the same sitting.

**Nobody has ever called her.** `agents_list_conversations` returns **zero**
for the agent and zero for the whole workspace, with `retention_days: -1`, so
that is «no calls», not «calls expired». Everything this section claims about
her live behaviour therefore rests on the test suite and on what is on disk —
the 11 September «agent mode reached production» was proved by content-hashed
chunks being served, which is a different claim from anyone having used it.

Checked at the same time and unchanged: three tools attached, the `report_gap`
webhook pointing at the n8n path that is live and healthy, voice
`rh16DBXwtscjdPFeMBYf` on `eleven_flash_v2_5`, the origin allowlist carrying
all five hostnames, and `npm run audit:shouq-call` green including its live
registry lookup. One loose end with no owner: a second knowledge-base document
(`ANkRiRs8Xxy5poyujeTJ`, «المطاعم والكافيهات العصرية الحديثة», 3.5KB) sits in
the workspace with **no dependent agents** — attaching it would change her
answers, so it is left alone and named here instead of being quietly adopted.

**A rule she keeps breaking is usually placed wrong, not worded wrong.** The
season override («outdoors in summer → after sunset») sat in the calendar
section and lost every time to the KB's own «أحسن وقت» line, because she
reads that line at the moment she writes step ٣. Restating it *inside* step
٣, with the forbidden words named and one worked example, fixed it on the
first try. Gemini-flash at temperature 0 obeys word-bans and examples far
better than principles.

**The same lesson cost two more tests before it was believed, and the second
time it was PLACEMENT alone.** «Do not send someone who cannot walk to a
place the KB calls a full day» was already written, correctly and with the
Avenues named — as step ٥ of a five-step selection ladder. She was choosing at
step ٢ on «مكيّف» and never reaching it, and recommended the Avenues for an
elderly mother 2/2. Nothing about the wording changed; it became step ٢, above
the general constraint check, with the trigger words spelled out («كبيرة
بالسن»، «ما تقدر تمشي»، «تعبان») and the counter-argument named outright —
«كونه مكيّف ما يشفع له: المكيّف يحل مشكلة الحر، مو مشكلة المشي». **2/2 pass.**
So: when a rule is right and still loses, look at what she has already decided
by the time she reads it.

**A word-ban only bans the words it names.** The summer rule listed «العصر»,
«العصر المتأخر» and «الصبح»; she answered «بعد العصر» and the ban did not fire
— the near-miss the list had not spelled out. Now it names «بعد العصر» and «من
العصر» too and adds the general form, and two more holes beside it: a best-time
line that is a RANGE («من العصر لين بعد المغرب», which is the Gulf Road cafés'
line exactly) gets its start trimmed rather than recited whole, and **what makes
an answer outdoor is the request, not only the place's own line** — she had
picked an indoor mall whose KB line says nothing about «برا», so a rule scoped
to «برا/مكشوف» let «بعد العصر» through for someone who had asked to sit by the
sea.

**And the last one was not the place, it was the sentence about it.** For «أنا
بالسالمية مع العيال والجو حار» she picks مارينا مول — which the judge's own
criteria list as acceptable — and then sells it with «تقدرون تتمشون على البحر».
The choice honoured the heat and the description undid it. The rule added is
general: a place with an indoor and an outdoor side gets described on the side
that satisfies the constraint, and the other side is not mentioned. 0/2 → 1/2;
the run that still fails says «من الداخل» and the judge reads the word «البحر»
anyway, so what is left there is arguably the judge's.

**One judge was demonstrably wrong and was replaced rather than worked around.**
Two runs of the seaside test produced a **byte-identical** reply; one passed and
one failed, the failure claiming «كافيهات شارع الخليج» was «a general category».
It is a knowledge-base entry, and the criterion's own text listed it by name as
a valid answer — the judge contradicted its own instructions, and the plural
form is what misled it. Recreated (there is no update-test tool) with that
condition rewritten to judge «is a KB entry named?» rather than «does the name
sound singular?», naming the entry as passing and giving the bare-description
failure it is meant to catch. `test_7901m2wvg8r5e2qaeff8rqre773g` replaces
`test_5601m2tsdm5sew79hyw1rkvfvzek`, which is deleted. **The tell that it was
the judge and not her: identical input, identical output, different verdict.**

**Three of fifty runs in one batch failed for a reason that was not the agent
at all** — «the user input being an incomplete placeholder», «the transcript
did not contain an agent response». A test that had just passed in the full
suite failed 2/2 minutes later with that shape. The harness drops the user turn
sometimes; read the rationale before believing a regression, and re-run.

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

**Re-pointing it CANNOT be finished from an MCP session — `agents_create_kb_url`
times out at 60s and creates nothing.** Tried five times on 20 September to
move the document off `ab034b0`; every call returned «timed out after 60s», and
`agents_list_knowledge_base` after each — including 75 seconds after one, in
case it landed late — showed the same five documents. So it is a consistent
failure, not a flake, and it is at least *safe*: nothing half-created, no stray
document, no duplicate from retrying.

**And it is that call, not the connector** — worth separating, because «the
MCP is down» and «one tool is slow» lead somewhere different. Measured on the
fourth attempt: the create timed out, and an `agents_list_knowledge_base`
issued straight afterwards answered immediately. Reads are healthy; the write
that has to fetch and process 73KB is the one that does not fit in 60s.

**A 60s timeout does NOT mean the work did not happen — that has to be checked
per tool, and the two differ.** `agents_run_tests` times out the same way and
**the run starts anyway**: the suite was already listed in
`agents_list_test_runs` with 50 runs in flight, and it finished normally. So on
a timeout, list before retrying — retrying `run_tests` would have queued a
second suite, where retrying `create_kb_url` costs nothing. This is the
`createAccountCronJobV1` lesson on a different connector: **the reply is not
the state.**

`agents_create_kb_text` would sidestep the fetch, and is deliberately not used:
it trades a commit-pinned, regenerable document for a blob nothing can diff, to
win two hamzas. The mechanism is worth more than the characters.

Everything else was verified and is ready for whoever finishes it in the
dashboard:

- the live document is genuinely stale, and it says so itself — its own
  extracted text still reads «إذا **انت** بوسط المدينة» and «طول السنة —
  **انت** بالسيارة», the two hamzas;
- `last_updated_at_unix_secs` equals `created_at_unix_secs`, which is the
  «fetched once, at attach» behaviour in the data rather than in prose;
- the replacement URL is good: `raw.githubusercontent.com/hkspower/wain/
  c837554…/docs/wain-ai-kb.md` answers **200, 73,002 bytes, byte-identical**
  to the committed file and carrying «أنت بالسيارة»;
- the raw file is the same length at `ab034b0` and at HEAD (73,002), so the
  live document's `size_bytes: 72317` is ElevenLabs' *extracted* size — which
  makes it a usable equality check on the new document, not a discrepancy.

The pattern to follow is the one already in the workspace: v3 pinned to
`1ab701a`, v4 to `ab034b0`, each a new url document rather than an edit of the
old. **This is the second شوق operation that needs the dashboard** — the first
being a prompt rollback, since there is no restore-version call either.

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

25 attached tests now.

**No shared secret, deliberately.** It is write-only and answers nothing, and a
secret would have to live either in the agent config (readable) or in an n8n
variable — which is the `REPLACE_PHONE_NUMBER_ID` failure mode: unset, silent,
and discovered months later.

## What the call TELLS the caller — three defects, 23 September

Measured on a built agent-mode export at 390px, not read off the source.
Two of the three were the interface asserting things it had no way to know,
and the third was it staying silent about the one thing it did know.

**The status line announced the stopwatch.** `متصل · ٠٠:٠٧` sat inside
`aria-live="polite"`, so the region changed every second and a screen reader
re-read the whole line every second, over whatever شوق was saying — **six
distinct values in five seconds**, measured. The one region meant to report
the call was narrating a clock instead. The phase word is announced now and
the duration is a sibling outside the region: still on screen, still in the
accessibility tree, never spoken. `ended` keeps its duration inside the
announcement, because there it fires once and how long the call lasted is the
news rather than a tick.

**Two live regions said the same thing at the same moment.** The headline
under the face carried `aria-live` too and read «يرن…» exactly when the header
did, so one event was announced twice; the rest of the time it held the
caller's own words read back at them, which is not news to the person who just
said them. The header is the only announcer now.

**Her mouth moved for the entire call.** `talking` was `live || answering`,
and `live` is the state where she is LISTENING — in agent mode it is the whole
call, from the widget mounting to the hang-up. Measured: **2 of 2 faces
carried `shouq--talking`** over a widget that had not said a word. The file's
own comment already made the right argument for excluding `ringing` — «a face
mouthing words at a phone that is still ringing is the interface telling a
small lie» — and then told a much larger one.

**Nothing here can know better, and that was checked rather than assumed.**
The published `@elevenlabs/convai-widget-embed@0.18.1` bundle keeps
`isSpeaking` and `mode` inside its own Preact state and dispatches exactly one
custom event, `elevenlabs-convai:call` — `npm pack`'d and read, the same move
`SALEM_VOICE_ID` made for the voice-swap question. So there is no signal to
animate from, and **an animation that is always on carries no information
while looking exactly like one that does.** The rule is now `answering` only,
which exists in local mode alone and genuinely means «she is producing
speech»; agent mode gets the widget's own volume-reactive orb, which is driven
by audio it can actually hear. Confirmed on the wire: 0 of 2 during a live
agent call, 3 of 3 the moment a local answer starts.

**A TEST WAS HOLDING THE BUG IN PLACE.** `shouq-flow`'s «once she is
connected, every face starts speaking» asserted `talking === n` at `live`, so
the defect was not merely unnoticed — it was pinned. Rewritten to assert the
opposite at `live` and the original claim at `answering`, which is where it
was always true.

**And she changes the screen without saying so.** `show_places` navigates and
`open_place` opens a profile; the sheet is 22rem over a 24.4rem viewport, so
the page she is driving is mostly BEHIND it. The only account of either was
شوق saying it out loud — nothing for a caller with the volume down, or who
cannot hear her. This is the one thing the call can report honestly, because
it is *our* code doing it and the handler has the count and the name in hand:
a line in the sheet, its own live region, «دوّرت لك «قهوة» — ٤ أماكن».
`countAr` and not a hand-written «٤ مكان» — see `place-kit`, where that exact
agreement rule has been got wrong by hand three separate times.

**Proving the new assertions could fail cost two lessons, both already in this
file.** The first sabotage used `if (false)`, which fails `no-constant-condition`
— `next build` stopped, `out/` kept the GOOD build, and all four assertions
passed against it. *When proving a test can fail, check the build succeeded
first*, recorded here after the `LiveTray` confirmation and hit again. Then the
first real red threw an uncaught `waitForFunction` timeout and took the process
down, cancelling every section after it — the coverage-hole shape corrected in
`shouq-flow` and in `live-map.test.mjs` this same day, now caught a third time
**while checking a test could go red**. Both guarded. An `ok(…, true)` written
beside them was deleted for passing under a build with the feature removed.

**A caller can switch her voice to سالم's mid-call — same brain, different
speaker.** `WainAiCall`'s «بصوت سالم» button, live only while `phase ===
"live"`. Deliberately not a second agent: the tools, the prompt, her name in
the call sheet all stay شوق's, because building a whole second agent (its own
prompt, tests, tool set) for one voice option would be the disproportionate
answer to a small ask, and a caller who taps it wants to hear a different
speaker say the same things she would have, not talk to someone else.

**There is no live voice hot-swap, and that shaped the whole implementation.**
Checked before writing any of it, because assuming otherwise would have meant
building a button that lies: `api.elevenlabs.io` and `elevenlabs.io` are both
blocked from this repository's own egress (same class of block as the voice
pipeline), so the published `@elevenlabs/convai-widget-embed` bundle —
`npm pack`'d and read directly — was the only source available. It does expose
`override-voice-id` as a widget attribute, reaching `overrides.tts.voiceId`
internally, but only as one field of the object passed to whatever starts a
session; nothing in the bundle reacts to that attribute changing on an
already-connected element. So «switch» means dropping the mounted
`<elevenlabs-convai>` and mounting a fresh one with the attribute set — a
few-hundred-millisecond reconnect, not a mid-sentence swap. `SALEM_VOICE_ID`
in `wain-ai.ts` carries the finding in full.

**The voice id is `Ywuz3KyW2N5pqKNpwcCL` (Eid) — the same one
`scripts/gen-voice.mjs` and `scripts/publish/tts-endpoint.php` already use for
سالم**, on purpose: it is the fourth place this voice has to match the other
three (the clips, the live TTS bridge, now a live agent call), the same
identity `docs/voice.md`'s three-way table exists to hold the first two to.

**Every fresh call resets to شوق's own voice.** `WainAiCall` never unmounts —
see `Props.startSignal` — so `persona` state would otherwise survive from one
call to the next; `startCall()` clears it and the mounted widget explicitly,
so redialling after a switch never silently starts on سالم.

## There is an n8n instance, and part of wain runs on it

`sportake.app.n8n.cloud`, shared with sporta. **Nothing in `npm run scan` can
see any of it** — it is not in this repository — so everything below drifts
silently and has to be compared by hand. **Sixteen workflows, three active**;
five are wain's. Both numbers have been wrong here before — «twelve» and «the
only ACTIVE workflow» — so read them as of 20 September and re-list rather
than trust them. The third active one is `Discs — barcode lookup`, which is
almuhallab's; the instance is shared, the same way the crontab is.

- **`أداة ملفات وين 🔧` — active, and INERT.** POST `/webhook/wain-file-tool`,
  grep/patch/create files on Hostinger over FTP. Its secret comes from the n8n
  variable `WAIN_TOOL_SECRET` and **fails closed** when unset; path jail,
  per-project roots, `.htaccess` directive blocking. It writes text files only
  — no `.zip`, so it is not a way to deploy a build.

  **`WAIN_TOOL_SECRET` is unset, measured 20 September**, so every request is
  refused with `server not configured` before it reaches the path jail. Proved
  by running the webhook with a deliberately wrong secret and reading the
  execution back: the throw is at line 17, the fail-closed branch, not at the
  comparison two lines later. Its zero executions agree. So the fail-closed
  design is working and nothing described above is actually reachable — a
  variable nobody filled in is the whole of it, and setting it is a UI action
  no session can do (`list_credentials` has no write twin, and variables have
  no tool at all).

  **The probe is worth keeping as a shape.** Both branches throw, so the
  status alone cannot tell «unset» from «wrong secret» — the message can, and
  `get_workflow_execution` only returns it with `includeData: true`. An
  execution that merely says `status: error` has told you nothing.
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
- **`الحارس` — the site sentinel. Its content check was reading the wrong
  field, and it would have called a healthy site down on every single run.**
  `fullResponse: true` on an HTTP Request node returns `{ data, headers,
  statusCode, statusMessage }` — the page is under `data`. `judge()` read
  `res.body`, which is `undefined`, so `String(undefined || '')` was the empty
  string and no needle could ever be found. The status-code branches were fine,
  because `res.statusCode` is right; only the half the whole design exists for
  was broken.

  So the failure is the inverse of the one it was built to catch. This file
  praised it for refusing to trust a status code — which it does — without
  anyone ever running it: a healthy `/` and a healthy place page both came back
  «ترد ٢٠٠ بس ناقصها …», two false `down` alarms in one pass. **A monitor
  nobody has watched fire is a monitor with no evidence behind it**, and this
  one had been written up as correct twice.

  Fixed to `res.data ?? res.body ?? ''` — both fields, so a future node change
  cannot break it the same silent way — plus an explicit empty-body branch that
  says «راجع قراءة الاستجابة، مو الموقع» rather than disguising a read bug as
  missing content. **Proved in both directions, which is the point**: against
  the live site all three checks read «سليم» with no alert, and against
  `/places/this-place-does-not-exist/` exactly one `down` event appeared, http
  404, with the other two still green. The temporary URL was put back.

  **Its diagnosis prompt, by contrast, is current** — it already carries the
  signed-endpoint deploy path and «ولا ترشّح أبداً رفع مجلد out/ باليد من
  hPanel». This file said it was stale; it was read end to end and it is not.
  The warning behind that line still holds — **an automation that gives
  instructions is documentation with a pager** — it just is not owed here.

  **Two things still stop it, and neither is fixable from a session.** Its
  `Claude — التشخيص` node had no credential attached at all; the account's
  `Anthropic account` credential is attached now and a model is pinned
  explicitly rather than left to the node's typeVersion-1.3 default. But the
  credential's own data is **empty** — the node dies on `TypeError: Invalid
  URL`, which is `new URL('')` on a blank base URL, the same shape as the TTS
  workflow's blank `httpHeaderAuth` above. And `واتساب — إنذار فوري` still
  carries `REPLACE_PHONE_NUMBER_ID` and `REPLACE_YOUR_NUMBER_…`; `phoneNumberId`
  is a plain string field on the node, not a list loaded from the credential,
  so there is nothing here to read it from — it comes from the Meta WhatsApp
  Business account. Until both are filled in the Sentinel cannot be activated
  usefully, and **that is why nothing is watching this site.**
- **`Wain — Events Hub`** — verified current 11 September: its formatter matches
  `orders.ts` and `places.ts` field for field. Nothing posts to it yet, and its
  WhatsApp node carries the same unfillable `REPLACE_PHONE_NUMBER_ID` — one
  number from Meta unblocks both it and the Sentinel.
- **`Wain — ما لقت شوق (فجوات الكتالوق)`** on `/webhook/wain-gap`, active —
  شوق's one webhook tool. Four nodes into the data table `wain_gaps`
  (`CyBLQKa6LcdgFUAX`). See the شوق section for why it has no shared secret.
  **The only wain automation that is actually working**: 26 executions, the
  ten most recent all `success`, re-checked 20 September.

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

Second sample, 17 September: `helloLine("شوق")` — the first sentence she ever
says, at the moment a call connects — rendered the same way and saved as
`docs/voice-sample/shouq-talya-hello.mp3`. Same voice id, same model, same two
caveats as the first sample (128 kbps, default stability/similarity_boost),
written up in its own `.txt` rather than repeated.

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

**It is still inert, measured 20 September, and `version` said otherwise.**
`ls -la` on storage: `-rw------- 1 u130124229 … 0 Sep 11 14:55 elevenlabs.key`
— **0 bytes**. So every runtime sentence on the live site takes the browser
voice, and has since the bridge was installed. What made that worth finding
twice over is that `php api/tts.php version` answered `"key": "present"` for
it: the report was `is_file($keyFile) ? 'present' : 'ABSENT'`, and `is_file`
is true for the empty file the installer creates ON PURPOSE. The runtime was
right the whole time — `$key = trim(…); if ($key === '') $fail(503,
'not_configured')` — so **the diagnostic disagreed with the code it was
diagnosing**, which is the worst direction: nothing fails, and the only thing
anyone would check says the feature is on.

Both endpoints share a `keyState()` now — `ABSENT` / `EMPTY` / `present`,
using the runtime's own `trim()` — and `media-endpoint.php` had the identical
bug in its `adminKey` line and in its installer's report. Four assertions in
`test:tts` cover all four states; confirmed red by putting `is_file` back with
the file green. **The test had to be given its own `$HOME`**, which is a
finding in itself: CLI `version` reports the key at the INSTALLER's target
(`$HOME/domains/wainkw.com/storage`), not at the tree the file was run from,
so pointed at the suite's own `storage/` every state read `ABSENT` and looked
like the fix had failed.

**And one cron lesson paid for that discovery.** The first probe chained
`php …/tts.php version && php …/d.php probe`, and the output came back
carrying ONLY the second command's JSON — the `version` output vanished
entirely, which reads exactly like «that command printed nothing». Run alone
it printed fine. Same shape as the curl `--next` trap above: **one thing per
cron job**, or a silent half-result is indistinguishable from a broken one.

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

## The endpoints keep a log now

Both bridges answered every request in silence. صوت وين was installed on
11 September and inert until at least the 20th — nobody had pasted the key —
and the way that was finally found was `ls -la` on a directory outside the
docroot, nine days later. A 503 per sentence had been served the whole time
and **nothing anywhere recorded that it had happened once.** That is the gap.

`/api/tts.php` and `/api/media.php` now write one line per request into
`<domain>/storage/logs/`:

```
2026-09-20T09:14:19Z tts miss id=3f2a91c0b4d7 chars=86 persona=shouq bytes=4096 ms=812 ip=1a2b3c4d
2026-09-20T09:15:01Z tts 503 why=not_configured ms=1 ip=1a2b3c4d
2026-09-20T09:20:00Z media ok draft=8f21a0c3 kind=logo index=0 bytes=48211 type=png total=132884 ms=42 ip=1a2b3c4d
```

**What is deliberately NOT in it is the design.** Not the sentence — `chars`
and the rendition id are enough to find the cached bytes and to total the
bill, and the text is the visitor's. Not the filename a browser sent — it is
attacker-controlled and `getimagesize()` has already decided what the bytes
actually are. Not the IP — it is the first 8 hex of the same hash the rate
limiter already computes, which ties one visitor's lines to each other and to
nothing else. **A log that would embarrass someone is a log that gets deleted
instead of read.**

**Bounded, not chronological.** One file plus one rotation at 256K, so an
app's log can never exceed 512K however long it runs. `storage/` is the one
directory `deploy.php` never prunes, which makes «grows for ever» an outcome
rather than a worry. Every line carries its own date, so a month is a `grep`
and not a filename. Rotation happens BEFORE the write, so the cap is a cap
rather than something the last line may exceed by its own length.

**Reading it is a cron job, the same as everything else on this account.**
`storage/` is outside the docroot, so no URL and no `hosa` file tool reaches
it: `php …/api/tts.php log 40` and `php …/api/media.php log 40` are the route,
and `version` now reports the log's size and whether it has rotated. «0 lines»
on a bridge that is supposed to be serving is itself the finding — it is
exactly what nine days of silent 503s looked like.

**`npm run audit:logs` is the anti-drift half, and it is not the whole check.**
The two endpoints carry their own copies of the logging code, deliberately —
each has to stay copy-installable from a raw URL with no include path between
them, the same reason the rate counter is already duplicated. The audit asks
each one for its own `logformat` **by PHP** and fails when they disagree, which
is `audit:tts`'s argument about the voice tables applied to the thing that
records what the voices cost. Confirmed red by drifting `LOG_MAX_BYTES` in one
of them. But a declaration is not enforcement: `test:tts` (42) and
`test:media` (45) drive real requests through a real PHP server and read the
file back to prove the sentence, the filename and the address are not in it.

**The privacy page had to be corrected before any of this could ship, and two
of its claims were already false.** «ما فيه سيرفر يشغّل كود» was true of the
pages and never of the account — `/api/` has held wain's own PHP since the
voice bridge was installed. And صوت وين's «بالحالتين ما يطلع أي شي من جهازك»
described the site as it was before the bridge existed; it is true today only
because the key file is empty, and **«true because the feature is switched
off» is not something a privacy page should rest on without saying so.** Both
are rewritten, the headline no longer claims «ما يجمع عنك أي بيانات» flatly,
and the hosting section — which framed logs as the host's and «خارج عن
تحكّمنا» — now names ours and what is kept out of them. Same lesson the page
already carries about the database: overstating is the same defect as denying.

**The live copy does not log yet.** `tts.php` on the server is the build from
11 September (`01b7429a4dbe6983`); logging arrives when somebody re-runs the
fetch-pin-run install. `media.php` is still not installed at all — see the
section below, which is unchanged by this.

## Business registration's photo upload is wain's own now, too

`src/lib/media.ts`'s `uploadPending()` used to go straight into Supabase
Storage. Supabase is unconfigured — see "The back end is not configured" — so
every upload failed at `loadSupabase()` before a byte left the browser, the
same shape صوت وين's runtime sentences were in before `/api/tts.php`. This is
that move again, for the same first reason (same origin, nothing to allowlist):
`scripts/publish/media-endpoint.php`, to be served as **`/api/media.php`**,
`php media.php install` / `version` / `limits` / `prune`.

**It is NOT installed, and this file used to say "installed the same way".**
Checked on the server, 19 September: `public_html/api/` holds `deploy.php` and
`tts.php` and nothing else, and `storage/media-admin.key` — which the
installer creates, the way it creates `elevenlabs.key` — does not exist.
`elevenlabs.key` does, so that is a real contrast and not a listing that
missed things. So `uploadPending()` POSTs to a path that **404s in
production**; what was verified in the media section below was verified
against a local PHP server, which is a different claim. No visitor harm today
— `submitBusiness()` fails on unconfigured Supabase either way, so a
registration was never going to complete — but do not read the rest of this
section as a description of the live site. Installing it is still the
deliberate open question it always was: standing up a new anonymous public
write endpoint is a decision, not a chore.

**This does NOT make business registration work.** `submitBusiness()` in
`lib/submissions.ts` still inserts into a Supabase table that does not exist
here, so a photo can now upload successfully and the submission that was
supposed to reference it still fails right after, with «التسجيل مو متاح
حالياً». Verified rather than assumed, with a real browser against a real PHP
server: the upload request comes back `{"ok":true,"path":"<uuid>/logo-0.png"}`
and the bytes land under `storage/business-pending/`, and the page then shows
exactly the Supabase-disabled message — not an upload-failure message,
because the upload did not fail. `prune` exists because of that gap, not
despite it: a photo that uploads and is never turned into a submission is an
orphan, and nothing deletes it automatically. It is a CLI mode, meant to be
cron'd occasionally by hand, the same fetch-pin-run shape every write path on
this account already uses — not installed as a cron job from here, because
standing up a new public write endpoint on the live site is the kind of
change to confirm before it goes live, not something to do in the same sitting
as writing it.

**The one thing that makes an anonymous, unauthenticated upload endpoint
safe enough to ship**: nothing about what is written to disk is trusted from
the client. `getimagesize()` on the bytes decides whether something is a real
image and which one — never the browser's `Content-Type`, never the
filename's extension. A PNG uploaded as `shirt.jpg` is stored as `.png`;
proved in `test:media`, not assumed. Storage sits at
`storage/business-pending/`, a sibling of `public_html` the same way
`storage/tts` is — the same privacy property Supabase's private bucket had,
for the same reason: an unreviewed photo of someone's shop is not public
because its path is hard to guess. Two independent caps back that up —
`RATE_PER_MIN` per visitor, `MAX_TOTAL_BYTES` for the account's disk filling
up from many visitors doing it slowly and legitimately, which a per-IP limit
alone never catches — and both are proved tripping for real in `test:media`,
not merely present in the source.

**A real ceiling turned up while testing this that would have bitten in
production too.** This sandbox's default php.ini caps `post_max_size` at 8M
and `upload_max_filesize` at 2M, both under `MAX_BYTES` (12M) — and when a
POST body exceeds `post_max_size`, PHP empties `$_POST` and `$_FILES`
*entirely*, with no per-field error. Read naively that looks like `bad_draft_id`,
because draftId is checked first and is now `''`, which is a confusing failure
for a problem that has nothing to do with the draft id. Caught explicitly now
— `empty($_POST) && empty($_FILES) && Content-Length > 0` is the classic tell
— and reported as `file_too_large`, which is what actually happened. `php
media.php version` reports both ini values for exactly that reason, and
`test:media`'s own server is started with them raised, or the app-level
`MAX_BYTES` check could never be reached at all in a test run either.

**That was written as a blocker — «this must be checked on the live host before
the bridge is installed» — and it is now checked and CLEAR.** `getPHPDetailsV1`
for `wainkw.com`, 21 September: `post_max_size` and `upload_max_filesize` are
both **256M**, against `MAX_BYTES` of 12M, with `memory_limit` 512M and
`max_execution_time` 300s. Staging reports the same values. So the ceiling is
this sandbox's, not the server's, and the app-level check is reachable in
production. It stays in the code because it is right for any host, and the
sandbox is still a host where it fires. **Installing the bridge remains the
open question it always was** — standing up a new anonymous public write
endpoint is a decision — but the php.ini half of it is no longer a reason to
wait.

`npm run audit:media` is the anti-drift check `audit:tts` already is for the
voice bridge: `MAX_BYTES`, `MAX_PHOTOS` and the accepted MIME types are read
from `src/lib/media.ts` and from `media-endpoint.php limits`, each by its own
interpreter, and it fails when they disagree — confirmed it can go red, not
only green, the same way every anti-drift check in this file has been.

**What is deliberately NOT done yet**: `signedPendingUrl`, `publishMedia` and
`discardPending` in `media.ts` are untouched, still Supabase-only, and still
unreachable — `MediaReview.tsx` needs the submissions table regardless of
which server holds the bytes, so wiring an admin review flow onto the new
bridge now would be building review with nothing to review. The bridge does
carry a minimal `?action=view` GET, key-gated by `storage/media-admin.key`
(created empty by the installer, same as `elevenlabs.key`), so a pending photo
is not a total black hole in the meantime — `storage/` is outside the docroot,
so no read tool here can look at it any other way, the same statement already
true of `storage/d.php`.

## There is an iOS app now, and it wraps the same export

`capacitor.config.ts` + `.github/workflows/ios.yml`. Capacitor, not a rewrite:
the app is the same `out/` this site already builds, opened in a native
WKWebView shell, because a static export with no server behind it is exactly
what Capacitor is for — there is no API to reimplement natively and no second
copy of 52 places to keep in sync.

**No CocoaPods.** Capacitor 8 scaffolds through Swift Package Manager —
`npx cap add ios` wrote a `Package.swift` and never asked for `pod install`,
confirmed by running it once in this sandbox, which has neither CocoaPods nor
Xcode. That is also as far as anything here could be verified: the workflow's
`xcodebuild` and signing steps are written from Apple's and Capacitor's own
documented flags, not from a passing run, because nothing reachable from this
session can execute them even once. Say so plainly if one fails — that is new
information, the way `docs/hosting.md`'s corrections have been all along, not
a regression in something proven.

**`ios/` is not committed**, for the same reason `public/voice/` is not:
generated output tracked in git drifts from the thing that generates it, and
nobody working on this repo without Xcode would notice. The workflow runs
`npx cap add ios` fresh every time, after the web build, because `cap add`
copies `out/`'s current contents into the native project as its last step —
build first, scaffold second, or the app ships whatever `out/` last happened
to hold.

**The bundle has no origin, and one relative path depended on having one.**
`voice.ts` defaults صوت وين's bridge to `/api/tts.php`, correct on the web
because the page and the bridge share an origin — a bundled app has none, so
that fetch would 404 against the WebView's own local scheme and silently take
the browser-speech fallback `voice.ts` already has for an unconfigured
bridge. Not a crash, just always the lesser voice in an app built to carry
the better one. `ios.yml` sets `NEXT_PUBLIC_WAIN_TTS_URL` to the absolute
`https://www.wainkw.com/api/tts.php` for this build only — the same override
`voice.ts` already reads first, the one a staging build would use to point
elsewhere. Checked for other relative absolute-path fetches before deciding
this was the only one: the widget script and the ElevenLabs API origin are
already absolute URLs, Supabase's URL is already absolute, and everything
else the site fetches — the RSC payloads for client-side navigation, the
cached voice manifest, every route's HTML — ships inside `out/` itself and
resolves fine against the bundle's own local scheme.

**`AppShell.tsx` had two ways to detect "this is the installed app" and both
miss a Capacitor shell.** `display-mode: standalone` and iOS's
`navigator.standalone` both describe a PWA opened from a home-screen
bookmark; a WKWebView a native app opens is neither of those, so without a
third signal the app would render with the desktop nav still showing and no
tab bar — a browser tab in a frame, exactly what wrapping it was supposed to
avoid. Capacitor's native runtime injects `window.Capacitor` into every page
it loads with no import needed on the web side, so its presence is that third
signal, checked alongside the other two.

**Icons come from `public/brand/app-icon-512.png` at build time**, not from a
second copy committed under `assets/` — `ios.yml` copies it there itself
before calling `@capacitor/assets`, so the one source stays the one source.
It is 512×512; Capacitor upscales it for the sizes that want more, which is
fine for the Simulator build and not what a real App Store icon should ship
with — replace it with a proper 1024×1024, alpha-free source before
`build-signed` is used for an actual submission.

**Two CI jobs, gated differently, because they prove different things.**
`build-simulator` always runs on dispatch — an iOS Simulator build needs no
signing identity at all, Xcode signs it with a null identity by default, so
this needs no Apple secrets and can boot a Simulator, install the built app
and screenshot it launching. `build-signed` only runs when every secret below
is set, and stops at producing a distributable `.ipa` as a workflow artifact —
it does not submit to App Store Connect, because that needs its own API key
and nothing here could exercise it even once to get it right.

Four repository items unlock `build-signed`, the same pattern `DEPLOY_SECRET`
already uses — add them at Settings → Secrets and variables → Actions:

- `APPLE_TEAM_ID` — a **variable**, not a secret; it is not sensitive on its
  own, the same reasoning `ELEVENLABS_AGENT_ID` already uses.
- `APPLE_CERTIFICATE_P12_BASE64` — a distribution certificate and its private
  key, exported as a `.p12` and base64-encoded: `base64 -i cert.p12 | pbcopy`.
- `APPLE_CERTIFICATE_PASSWORD` — the password that `.p12` was exported with.
- `APPLE_PROVISIONING_PROFILE_BASE64` — a provisioning profile matching
  `com.wainkw.app` and that certificate, base64-encoded the same way.

Manual signing throughout, not automatic — `-allowProvisioningUpdates` would
need an App Store Connect API key too, which this does not have, so the
profile's UUID is read out of the decoded profile itself
(`security cms -D` + `PlistBuddy`) rather than assumed, and passed to
`xcodebuild` explicitly. The temporary keychain it all runs in is deleted at
the end of the job unconditionally (`if: always()`), so a failed export never
leaves a signing identity on a runner GitHub will hand to someone else's job
next.

`export_method` is a `workflow_dispatch` choice — `development`, `ad-hoc` or
`app-store` — defaulting to `ad-hoc`, which is the one that proves signing
actually works (install on a real device) without first setting up an App
Store Connect API key that `app-store`'s eventual upload would also need.

`capacitor.config.ts`'s `appId`, `com.wainkw.app`, is a placeholder and
load-bearing the moment `build-signed` first succeeds against a real Apple
account: App Store Connect fixes the bundle id to whatever the first
TestFlight build declares. Change it before that upload, never after.

**Every build before 17 September was KILLED by iOS on the first tap of its
headline feature, and nothing here could have said so.** Capacitor's template
ships no usage strings at all, and a process that reaches
`navigator.geolocation.getCurrentPosition` without
`NSLocationWhenInUseUsageDescription` is *terminated* — not a denied
permission, a crash log reading «attempted to access privacy-sensitive data
without a usage description». wain reaches it from three places, one being
«استخدم موقعي» on the home page's dial. The Simulator job screenshots the
launch screen and passes, which is precisely why this survived: **the check
that existed proved the app starts, and nobody had asked it to prove the app
works.** شوق's microphone is the same shape.

`scripts/patch-ios-project.mjs` (`npm run ios:patch`, wired into both CI jobs
straight after `npx cap add ios`) writes the three usage strings in Arabic —
Apple rejects a reason that only restates the permission — plus
`ITSAppUsesNonExemptEncryption=false` so App Store Connect stops gating every
build behind a manual questionnaire, `CFBundleDevelopmentRegion=ar` (the
template says `en` on an app that is entirely Arabic and `dir="rtl"`), and
`arm64` in place of the template's **`armv7`**, a 32-bit capability no
current device satisfies. It also installs `ios-config/PrivacyInfo.xcprivacy`,
required since May 2024 — and *copying it in is not enough*: Xcode ships what
the target lists, so four `project.pbxproj` entries go in too, mirroring how
the template already carries `config.xml`.

**It is pure Node on purpose.** The obvious tool is `PlistBuddy`, which is
macOS-only, and every line would then have been untestable from here —
verified for the first time by a store upload. `npm run test:ios` scaffolds a
real project with `npx cap add ios` **on Linux**, patches it, and reads the
result back with a plist parser rather than a regex over the text that wrote
it. 24 assertions, including that a second run is a clean no-op. It is not in
`scan` (slow, needs the network); `npm run audit:ios` is, and its one check
worth having walks `src/` for privacy-sensitive browser APIs and demands a
matching key — so the day a camera lands in the admin screens, CI fails
instead of a reviewer.

`npm run icon:app` renders `app-icon-1024.png` from the mark itself. The
workflow fed Capacitor the 512 and let it upscale, which is how a soft icon
reaches a store listing without anyone choosing to ship one. Alpha is asserted
at generation: an icon carrying transparency is refused at **upload**, after
archiving and signing have already succeeded. The composition deliberately
matches the 512 so the store icon and the PWA icon are one picture — which
also means it inherits that icon's generous 40% coverage, sparse by Apple's
conventions and the one thing here worth changing deliberately rather than by
accident (`COVERAGE` in the script).

**What none of this fixes is Guideline 4.2, and that is the real risk.** wain
is a static export in a WKWebView. Apple rejects "a repackaged website" more
often than any other single reason for wrappers like this, and no plist key
answers it. What argues against rejection: the bundle works fully offline (all
52 places, every route, the fonts and drawings ship inside it), it uses
geolocation and the microphone natively, and it is not a browser pointed at a
URL — there is no `server.url`. What argues for it: the app and
`www.wainkw.com` are the same thing, and a reviewer who loads both will see
that. Decide that argument before paying for a developer account, not after.
Nothing in this repository can test it.

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

**«مناطق الكويت» was built and then rolled back, and this section described
it as live for days afterwards.** `f72759e`, «Roll the site back to
`c3a5e25`», deleted `src/lib/areas.ts`, `src/app/areas/page.tsx`,
`scripts/audit-areas.mjs`, `tests/areas.test.mjs` and
`src/components/SearchButton.tsx` — and its own message says so: «/areas is
gone; the hub offers «تصفّح كل الأماكن» again». **It did not touch
CLAUDE.md**, so this file went on describing a route, a module, an audit and
a suite that no longer exist, and `npm run content` is what finally caught it
by listing the routes that do.

The lesson is the one this file keeps relearning from the other direction: a
rollback is a change, and prose is not rolled back by `git revert`. **When a
commit deletes files, grep this file for their names in the same sitting.**

So, as of 21 September: the hub offers **«تصفّح كل الأماكن»**, there is no
`/areas`, no `areas.ts`, no `audit:areas` and no `areas.test.mjs`. What
survives the rollback and is still true:

- **The 21 areas are real**, and the catalogue is now the only place they
  exist — `npm run content` derives them from `areaAr` and prints the count
  per area. مدينة الكويت holds 18 and السالمية 9; the other nineteen have
  three or fewer, which is most of why «browse by area» was thin.
- **The join was always a STRING** — an area name against `Place.areaAr` —
  and that is the shape of every drift in this file (the n8n voice table,
  `@convai-widget-embed@1`, `contain-intrinsic-size`, `PlaceArt`'s safe box):
  nothing breaks loudly. Anything rebuilding this needs that check back.
- **`?area=` would have to be an exact match on `areaAr`, not a search for
  the area's name.** The free-text box already matches `areaAr` among five
  other fields, so a name search looks identical — until «شرق» also returns
  «سوق شرق», which is in مدينة الكويت. A filter that silently includes one
  place from somewhere else is worse than no filter, because nothing on
  screen says it happened. That was proved once, by swapping the exact match
  for the name search with the build green: exactly the شرق assertion went
  red, and only it. Worth keeping because it is the non-obvious half.

**And the real-images answer is: there are none to be had from here, though
they exist.** Re-measured 20 September, written up in full in `photos.ts`.
Adobe Stock returns **45 assets** for `Kuwait`, about seven of them actually
Kuwaiti — the ids are recorded — but `asset_license_and_download_stock`
answers `not_possible`, «Get started with a free trial»: search works without
a plan, licensing does not, and the thumbnail is 240px. Searching for an AREA
is worse than empty: Kuwaiti neighbourhoods return **Vancouver, Leeds,
Kensington, Calgary, Chiswick, Tallinn, Ayia Napa and Dallas**, which is
`photos.ts`'s «several hundred lookalikes» warning in its purest form — a
plausible answer to the exact question, every one of them wrong. Dropbox
holds only wain's own exported `og/*.jpg`, which are drawings. So the chain
is wired — **photograph → the hero place's drawing → its category's** — and
every card is on the second or third rung today. The four city-skyline ids
are the shortlist the day there is a Stock plan.

**Ordering and the queue are deliberately not in the hub.** 0 of 52 places
satisfy `acceptsOrders` or `takesQueue`, so a «طلباتي» row advertises a door
onto nothing. Add the row when a place takes orders and both surfaces get it.
This used to add «`OrdersLink` already covers the case that matters», and that
is no longer true — see below.

`ShouqCallButton` gained `onTapped`, which the palette needed: it was a modal
at z-60 and the call sheet mounts in the root layout, so a call placed from
inside it would ring underneath its own backdrop. Not an `onClick` on a
wrapper — the tap has to reach `primeAudio` first, and a bubbling handler that
closes the dialog could unmount the button mid-gesture. The palette is gone
(below) and `SearchHub` still takes the prop; it costs nothing and the next
modal that draws a hub will need it.

**The navbar was removed on request, and it was carrying more than a top bar.**
`Navbar.tsx`, `SearchPalette.tsx` and `SearchPaletteDialog.tsx` are deleted —
after the layout stopped rendering the navbar they were a closed island that
nothing referenced. What went with them, and what each cost:

- **The ⌘K palette**, keystroke and all. The listener was registered in a
  `useEffect` inside `SearchPalette`, which only ever mounted in the navbar, so
  the shortcut stopped working the moment the bar did. `search-button.test.mjs`
  is deleted and `search-keys.test.mjs` lost its palette half; what it proves
  on /search is the half that always mattered.
- **Every link to /search.** This is the one that mattered and it shipped:
  after the removal each route's single `href="/search/"` was AppTabBar's tab,
  and the bar is `standalone:block` — in the DOM, painted by nothing in a
  browser. So search was unreachable from the web site, and with it شوق, whose
  only launcher is inside the /search query box. **A count is not
  reachability** — journey's «offers a way to search» passed throughout,
  because it counted the hidden tab. It asks for `:visible` now.

  **The first fix was one link on the home page, and «/explore has its own box
  and was fine» was wrong.** Re-measured on the shipped build, route by route:
  `/` had 1 visible link and **/explore, a place page and /about had 0 of 1**.
  /explore's box filters that list in place — it does not go to /search and it
  carries no call button — so the only route that was ever fixed was the one
  that was looked at. 52 place pages, which is where a link from WhatsApp
  lands, still had no search and no شوق. **Fixing the page you measured is not
  fixing the site**; the second measurement is the one that found this, and it
  only happened because somebody asked again.

  `SearchButton` was the answer: a 40px icon link on a bottom rail, standing
  down on `/` (the link under the dial is the same offer) and on /search, and
  `standalone:hidden` because the app has a tab. **`LiveTray` gave up its own
  fixed positioning to share that rail** — two separately-positioned floating
  controls measure 10px apart at 320px, inside the 24px clearance
  `audit:mobile` requires between targets, and one flex row cannot collide at
  all. Measured with an order live: 173px of clearance at 320px, 243px at
  390px. `tests/search-button.test.mjs` was confirmed to go red with the
  home-page stand-down removed **and the build green** first.

  **THE ROLLBACK DELETED IT AND THE BUG IS BACK. IT IS LIVE RIGHT NOW.**
  `f72759e` removed `src/components/SearchButton.tsx` along with the areas
  work, and nothing replaced it. `LiveTray` and `AppTabBar` survive and are
  still mounted; the rail's other occupant does not exist. Measured in a real
  browser at 390px against the shipped `out/`, 21 September:

  | route | `a[href="/search/"]` visible | in the DOM |
  |---|---|---|
  | `/` | **1** | 2 |
  | `/explore/` | **0** | 1 |
  | `/about/` | **0** | 1 |
  | `/privacy/` | **0** | 1 |
  | a place page ×52 | **0** | 1 |

  The one link in the DOM on those routes is `AppTabBar`'s tab, which is
  `hidden … standalone:block` — present and painted by nothing in a browser.
  So on the web, search and therefore شوق are reachable from the home page
  and nowhere else, including the 52 place pages a WhatsApp link lands on.

  **And the suite still passes, for the reason its own comment warns about.**
  `journey` asks for `:visible` rather than a bare count — the fix made after
  this shipped the first time — but it only ever asks it **on the home page**,
  which is the one route that still has a visible link. So the assertion is
  right and its coverage is wrong, which is the same defect in a different
  place: *fixing the page you measured is not fixing the site*, now joined by
  *asserting on the page you measured is not asserting on the site*. Whatever
  restores the link should also make that check walk more than one route.

  Not restored here: the rollback was somebody's deliberate act and its own
  message says «/areas is gone; the hub offers «تصفّح كل الأماكن» again», so
  putting one of its deletions back is a decision, not a cleanup.

  **That home-page link is «دوّر باسم المكان» now, and the «أو كلّم شوق» half
  was cut on request.** It is one tap on a page where nobody has searched
  anything yet, so «باسم» and «شوق» are not a choice the visitor is in a
  position to make — they only mean something in front of a box with results
  in it. Offered at stage 1 it is a decision with nothing yet to decide about,
  and it turns the shortest route to search into a fork. Nothing is lost:
  /search's own numbered line names all three ways once you are there. So if a
  future audit asks «does `/` offer شوق» and reads 0, that is the intent, not
  the reachability bug recorded above — **the check that matters on this page
  is one visible route to /search**, which is what the suite asserts.

  Removed with it, from the comment over that link: «/explore has its own box
  and is fine». That clause was the wrong belief this very section corrects
  four paragraphs up, still sitting in the source where the next reader would
  meet it first.
- **`OrdersLink` and `QueueLink`.** Both were navbar pills, and the removal
  left /orders and /queue address-bar-only on the web — the only links to
  either were `AppTabBar`'s, which is `standalone:block`. **Fixed by
  `LiveTray`**, exported from `OrdersLink.tsx` and mounted in the root layout.

  It is not the bar coming back, and the reason is the one that should decide
  any future «may I put this in the layout»: **it renders nothing at all**
  unless this device has a live order or today's ticket. A top bar is
  permanent; for every visitor without one of those there is no element. It is
  at the bottom rather than the top, and `standalone:hidden` because the
  installed app already grows a tab for each — two offers for one thing is the
  mistake `ShouqCallButton`'s own placement was chosen to avoid. Cost: fixed,
  so it can cover the last few pixels of a page while something is in progress.

  **It no longer owns its own position** — the rail in `layout.tsx` does, for
  the collision reason written up under *Every link to /search* above. The
  landmark is unchanged (`nav[aria-label="طلباتك الحالية"]`), which is what
  the suites select on, so the refactor cost those tests nothing. And the rail
  itself paints nothing: on a route with neither control it is an empty,
  `pointer-events-none` box.

  **Three assertions in those suites could not fail, and had been passing for
  it.** They read `header a[href*="/orders"]` to prove the link was absent —
  and there is no `<header>` on this site any more, so the selector returned 0
  whatever the code did. They ask about the tray now; the positive ones ask for
  `:visible`. Both new ones were confirmed red by unmounting `LiveTray` and
  re-running, and **the first attempt at that confirmation was itself wrong**:
  it came back green because commenting out the JSX left the import unused,
  `next build` failed on lint, and the suite ran against a stale `out/`. When
  proving a test can fail, check the build succeeded first.

**/search is three ways to the same answer, and only one of them was ever
named.** The query box is obvious; the map only appears once there are
results, and the call is a small icon inside the box, deliberately, per the
section above — so a first-time visitor could use the page for months without
noticing either exists. The `ol` above the query box labels all three once,
purely: it points at what is already there rather than giving any of the three
a second way to be triggered, which would be the same offer-drawn-twice
mistake the call button's own placement was designed to avoid. `toArabicDigits`
numbering, matching the result count and the rest of the site.

## The Arabic prose has been read, once, on purpose

`npm run audit:arabic` says so itself: it checks invisible characters, wrong-
direction punctuation, Western digits and MSA leaking into a Kuwaiti site —
and explicitly does NOT check spelling or grammar, because no tool can, for
Kuwaiti. That gap had never been closed by a person either, across 3163
Arabic runs in 81 files. It has now, for the two largest concentrations of
hand-written prose — every field on all 52 places in `places.ts`, and every
line in `voice-lines.ts` — plus `privacy/page.tsx` and the order/queue
tracker copy. Nothing wrong was found in any of it.

**What WAS wrong was in the audit's own "notes", which a person had never
read past.** Two were real register slips the audit already names correctly
— «مطلوب» in `/add`'s promise line, «غير صحيحة» in `PlaceForm.tsx` — fixed to
the imperative and to «مو مضبوطة», matching the audit's own suggested
correction and the rest of the site.

**Five more were not typos at all, and reading them is what proved it.** The
audit's "one word, one spelling" check folds a search-index normalisation
(hamza and ة stripped) over the whole site's prose, and five of its seven
flagged pairs turned out to be two DIFFERENT, correctly-spelled words that
happen to normalise the same way:

- **افتح / أفتح** — imperative "open!" (hamzat wasl, PlaceMap's «افتح في
  خرائط جوجل») vs first person "shall I open…?" (hamzat qat', شوق asking
  «أفتح لك صفحتها؟»). Different mood, both correct.
- **اطلع / أطلع** — same shape: imperative "go up" (كويت تاورز's description)
  vs first person "where should I go" (شوق's own line «وين أطلع اليوم؟»).
- **تكفي / تكفى** — not a mood difference this time but a different WORD
  entirely: «تكفي» is the verb "it suffices" (الجزيرة الخضراء "يكفي لنص
  يوم"), «تكفى» is Kuwaiti slang for "please", listed as exactly that in
  شوق's own youth-slang glossary.
- **خلّى / خلّي** — past tense "caused" vs feminine imperative "make/let",
  addressed to شوق in her own prompt.
- **فله / فلة** — not a mistake to fix at all: her glossary lists both
  spellings of the slang word on purpose, on the same line, so she
  recognises either one from a caller.

The audit's own comment already warned this would happen — «two real words
that fold together are worth reading past» — and it was right; the finding
here is that it was right five times out of seven, not that the check is
noisy.

**The other two were the same word, genuinely inconsistent, and are fixed:**
«انت» → «أنت» in two `places.ts` descriptions and once in
`patch-ios-project.mjs`'s iOS permission string — «أنت» was already the
majority spelling everywhere else (7 uses vs 2), and standard orthography
wants the hamza there regardless. One more turned up only after
`scripts/wain-ai-brief.mjs` — which *generates* `docs/wain-ai-agent.md` and
`docs/wain-ai-kb.md` from a template embedded in the script, not the other
way round — was itself part of the source needing the same fix; `npm run
ai:brief` regenerated both docs afterward, and `tests/shouq-brief.test.mjs`
confirmed the regenerated KB still matches the live data. The KB file changed
by three lines as a result, which means the committed `docs/wain-ai-kb.md` is
now ahead of whatever commit ElevenLabs has pinned — see "The knowledge base
is a URL pinned to a commit" above for what re-pointing it needs; two hamzas
did not seem worth an unscheduled prompt-and-test cycle on their own; folded
into the next KB change that does.

### Read a second time, 20 September — and the audit's blind spot is grammar

The section heading above says «once»; this is the second pass, and it found
the thing the first one could not, because **`audit:arabic` checks characters,
not agreement**. Its own closing line says so — «spelling and grammar are NOT
checked» — and the defect it cannot see had been on the most-read number on
the site since 6 August.

**/search counted in the singular.** `{toArabicDigits(hits.length)} نتيجة`,
hand-written, so three results read «٣ نتيجة» where Arabic takes the plural
for 3–10, one read «١ نتيجة» and two «٢ نتيجة». `countAr` and `RESULTS_COUNT`
have existed in `place-kit.ts` the whole time and **/explore's counter three
files away has always used them** — so the site disagreed with itself, in
Arabic, on the line a visitor reads after every single search. `countAr`'s own
comment already records the identical bug being written by hand twice in
durations («تقريباً ٥ دقيقة», «من ١ دقايق»); this is the third hand, and the
only one that was visitor-facing on a main route.

The `SearchMap` aria-label added this session had it too — «خريطة ٣ نتيجة» —
written by copying the line above it. **Copying a sentence copies its bug**,
and a screen reader is the one visitor who hears the whole phrase.

Both go through `countAr` now. The remaining hand-written counts were checked
rather than assumed: `PlaceForm`'s two are the constants 30 and 20, which take
the singular correctly and cannot vary; `{toArabicDigits(n)} على الخريطة` has
no counted noun to agree with.

**`supabase/schema.sql` is a third copy of the catalogue, and the first pass
did not know it.** «انت» → «أنت» was fixed in `places.ts` and in
`patch-ios-project.mjs`; the same two sentences — الصالحية's «إذا أنت بوسط
المدينة» and جسر الشيخ جابر's «طول السنة — أنت بالسيارة» — sat unfixed in the
seed, which is why the pair was still being reported. Checked against
`places.ts` afterwards, so the two files now say it identically. Worth
remembering generally: **a prose fix in `places.ts` has a second home.**

Two more, both from this session's own writing: `privacy/page.tsx` said «الهدف
وحيد», which reads «the goal is lonely» — «واحد» is the predicate — and listed
what a log line records as «(نجح، مرفوض، …)», a verb and a participle in one
list, now «(نجح، انرفض، طلع من الذاكرة)». And `gen-search-pdf.mjs`'s console
header was MSA («ما الذي يراه») in a repository whose Arabic is Kuwaiti
throughout; it was the audit's one register note and cost nothing to close.

**`أخذ` / `آخذ` joins the documented not-a-typo list** — past «وكم أخذ» in the
privacy copy against first-person «وين آخذ العيال» in شوق's brief, the same
shape as `افتح`/`أفتح` and `اطلع`/`أطلع` above. Six notes remain and all six
are now read and correct; a seventh appearing means something new, not this.

## Checks

`npm run scan` is lint plus 31 audits — counted from `package.json` on
21 September rather than estimated, because «~29» had been carried along
through two additions. Browser suites: `test:hangout` (hangout, hangout-page,
map-pin, live-map, search-keys, shouq-search, search-plan, swipe — **eight**,
not the ten this line used to list: `areas` and `search-button` went with the
rollback), `test:journey`, `test:register`, `test:shouq`, `test:orders`,
`test:net`. PHP suites, not in `scan` because it
cannot assume php: `test:api` (40), `test:tts` (**52**, up from 42 with the
cache-prune block) and `test:media` (45).
That sentence said «neither … because neither», and it was already wrong for
three audits before `audit:logs` joined them: `audit:tts`, `audit:media` and
`audit:logs` all shell out to php and all run in `scan`. What `scan` avoids is
standing up a php SERVER, not calling the binary.

**Two audits joined `scan` on 20–21 September, and one of them is a document.**

`npm run audit:theme` measures the theme's ordered scales. `audit:color`
covers the colours and `audit:type` the type that reaches the screen; nothing
measured `--radius-*` or `--shadow-*` at all, and both state RULES in their
own comments — «the relationship between sizes stays intact», «offsets grow
faster than blur with elevation», «every layer is tinted with ink», «three
layers once an object is properly raised». It reads `theme.css` and never
opens `out/`, so it needs no build. Two exceptions are named rather than
enforced, both because the data says so: `text-2xs` is off the leading curve
by the file's own statement (a badge is one line and has no gap to protect),
and the shadows' y/blur DIPS at `2xl` — 0.500 0.500 0.500 0.571 0.583 0.556 —
so the per-step reading of «offsets grow faster» is false while the
across-the-scale one is true and comfortable (offset ×40, blur ×36).
Asserting the per-step version would fail the shipped theme.

**Its call-site rule is split, and that split is the lesson.** A flat ban on
`rounded-[…]`/`shadow-[…]` fires on three deliberate details: a map pin's 8px
rotated nose at 2 and 3px, and the dial's warm gold glow. The corner scale
starts at 10px and models cards, so a corner INSIDE its range is rot and one
below it is a hairline; the elevation scale's premise is ink, so an
ink-tinted arbitrary shadow is a step written longhand and another hue is not
a step at all.

**And it caught its own unfailable assertion.** The first draft sorted radii
and shadows BY VALUE before testing ordering, so pointing `radius-3xl` at 8px
reordered the violation out of existence and «is it larger?» could never
fire. Source order is the claim. All eight rules and both classifiers were
then confirmed red.

`npm run content` writes **`docs/content.md`** — every route, category, area,
all 52 places by category, optional-field coverage, the hub actions and the
voice library — by bundling the real modules with esbuild, the same trick
`audit:places` and the MCP server use. `content:check` re-renders and diffs,
and runs last in `scan`. It exists because there was no answer to «what is on
wain» short of reading a 3,000-line catalogue, and the hand-written counts had
already drifted: `place-kit.ts` and `places.ts` both said 53 records against a
catalogue of 52. Both now name the thing instead of counting it — **a number
in a comment that has to track the data is a number that will be wrong.**
It is also what caught the areas rollback, by listing the routes that exist.

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

**The stylesheet is two files now: `theme.css` for `@theme` — every `--color-`,
`--text-`, `--shadow-` token — and `globals.css` for everything that paints
with them.** `globals.css` `@import`s it, right after `@import "tailwindcss"`,
so nothing about how a token resolves changed — Tailwind v4 hoists `@theme`
from any file reachable by `@import`. Proved rather than assumed: the built
stylesheet is byte-identical before and after the split, diffed against a
`git stash` build.

Split because four scripts opened `globals.css` for nothing but its ~90
tokens and had to skip past ~400 lines of component CSS — the شوق face, the
call sheet, `.card-defer`, every `@keyframes` — to reach them: `audit:color`,
`audit:figma`, `design:boards` now read `theme.css` alone. `audit:css` is the
one exception, and reads **both, concatenated** — it audits the tokens *and*
the rules that spend them, cross-file (a token declared in `theme.css` and
used only inside a `globals.css` rule is real, not dead), plus checks that
live only in `globals.css` — classes, `@keyframes`, the `standalone:` variant.
Confirmed both directions: a token used only via a cross-file `var()` is not
flagged dead; the same token with that use deleted is.
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

**That "0" is for production dependencies; it stopped being the whole story on
17 September, when the iOS wrapper's build toolchain landed.** `npm audit
--omit=dev` still reads 0 — nothing here ships in `out/` or reaches
`www.wainkw.com`. The full `npm audit`, devDependencies included, reads
**7** (3 moderate, 3 high, 1 critical), every one inside
`@capacitor/cli`/`@capacitor/assets` and their own transitive `sharp`, `tar`,
`uuid`, `xcode` — packages this repo does not import directly. Checked before
writing this down: `@capacitor/core`, `@capacitor/ios`, `@capacitor/cli` are
already at `8.5.2` and `@capacitor/assets` at `3.0.5`, each the latest
published version, so there is no update to take. `npm audit fix --force`'s
own suggestion is to install `@capacitor/cli@8.4.3` — older than what is
already installed — which is Capacitor's own advisory tooling proposing a
downgrade, not a fix; declined. `sharp` and `uuid` are both listed "no fix
available" upstream regardless. Revisit by re-running `npm audit` after a
future Capacitor release, not by forcing this one.

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

**THAT RED IS FIXED, AND EVERYTHING THIS PARAGRAPH USED TO SAY ABOUT IT WAS
WRONG.** It read: «neither the test's fault nor the code's — the sandbox's own
headless Chromium never fires `SpeechRecognition.onstart` … the container's
Chromium build having no Web Speech backend to talk to at all». Every clause
of that is false, and it survived because «the environment is broken» is the
one diagnosis nobody re-checks.

`shouq-flow` installs its own stub recogniser and `getRecognition()` picks
`w.SpeechRecognition ?? w.webkitSpeechRecognition` — the stub is assigned to
the unprefixed name, so **the stub is what runs and no backend is ever
involved**. Probed directly, same stub, same expression: `isStub: true`,
`started: true`, `onstartFired: true`.

**The real cause was `run-shouq.mjs` asking for local mode with `""`.**
`wain-ai.ts` resolves the id with `||` — correct and deliberate, because `??`
let an unset CI variable ship the fallback — so an empty string falls through
to `DEFAULT_AGENT_ID`. The «local mode» pass was building **agent mode with
the real production agent**, and `build()`'s own label printed «(local mode —
no agent)» over it. The panel then never reaches «متصل» because the widget
cannot load (unpkg is blocked here), which looks exactly like a microphone
fault. Same shape as the deploy.yml failure recorded above — *the log
asserted she was in a build that had her out* — in a second place, pointing
the other way. Fixed by passing the documented off switch, `"none"`.

**And the timeout was hiding far more than one assertion.** It is an uncaught
`TimeoutError`, so it took the process with it: the file holds 75 `ok()` calls
across 16 sections and **3 sections ran**. Hang-up and its duration, the
sheet's position in both display modes, the abort-report races, the dial
timeout, all five error-code messages, the face, and the on-demand chunk load
were unmeasured for as long as this was «one known red». With `"none"` the
file runs to the end: **84 assertions, 0 failed, all suites passed.**

The lesson worth keeping is not about Web Speech. **A red attributed to the
environment stops being investigated**, so it has to be the conclusion that
is hardest to reach, not the easiest — and an uncaught throw in a test file
is a silent coverage hole, not one failure.

**There is no OTHER red left, and the last one was the test's fault, not the
code's.** The swipe suite's «a 4px scroll is left where it was put» failed on
every run for weeks and was written down here as known-failing. It was
unpassable.
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

## The maps move now, but only if you ask

Every map was a fixed OpenStreetMap **embed** in a sandboxed iframe with our
own pins projected on top, and `SearchMap` said why it could not be panned:
«the embed would pan under the overlay and desync every pin». `LiveMap.tsx`
answers that rather than working around it — **Leaflet owns the view and the
pins are placed from it rather than from a bbox of their own**, so the overlay
has no opinion of its own left to be wrong. The pins stay exactly what they
were: React, with their callouts and their two-way highlight with the result
list. `spreadPins` is deliberately NOT applied on the live map — zooming is
what separates two places now, and nudging a pin off its coordinate on a map
you can zoom is a lie you can watch.

**«Re-projected on every frame of a drag» is how that used to read, and it was
the defect.** `latLngToContainerPoint` is cheap; what ran beside it was a React
render of every pin — a fresh `style` object each, and the halo, the callout
and the nose under each — sixty times a second. Measured on the built export at
390px with 30 results, which is what «الكويت» returns:

| | before | after |
|---|---|---|
| frame median, CPU ×6 | 33.3ms | **16.7ms** |
| p95 | 83.4ms | 33.4ms |
| worst | 149.9ms | 50.1ms |
| long tasks in a 1s drag | **3488ms** | 197ms |
| the same at ×4 | 1162ms | 69ms |

So the map moved smoothly — Leaflet pans its own panes on the compositor — and
the pins stuttered across it at half frame rate, which is the one thing the
component exists to make look like a single object.

**The fix is arithmetic, not a throttle.** A container point is a layer point
plus the map pane's own offset, and a PAN moves only the pane: every pin's
layer point is unchanged. So `project()` (re-project, React) runs on
`moveend zoomend viewreset resize`, and `move` runs `paint()` — one
`translate3d` on the overlay div, no React at all. It is not an approximation
of re-projecting, it is the same number reached by addition. The zoom guard is
the case a translate cannot answer: a pinch changes every layer point, so those
frames still take `project()`, which is what everything did until now.

**A seam was expected there and does NOT reproduce.** `paint()` is called from
a `useLayoutEffect` keyed on `pos` rather than the transform being zeroed
inside `project()`, on the theory that zeroing lands a frame before the new
`left`/`top` commit and flashes every pin back. Built both ways and watched
every animation frame across mouseup, on a settled release and on a fling,
throttled and not: **0.0px.** `project()` runs inside a DOM event and React
flushes that before the paint. The layout effect stays because it costs a line
and does not depend on a flush order nothing here controls — and there is no
assertion for it, because an assertion that cannot go red is worse than none.

**Two assertions in `live-map.test.mjs` name the mechanism, and the old ones
could not.** «dragging the map carried the pin with it» passed under both
implementations — it drags, waits half a second and asks where the pin ended
up. The new ones ask *how*: mid-drag the pin has moved on screen while its own
`left` is untouched (confirmed red by putting the per-frame `project()` back),
and once it settles the `left` is a real re-projection and the layer's
transform is back to the identity (confirmed red by dropping `moveend` from the
settle list, which turns the transform from a loan into a ledger).

**And the tap fetched two chunks in series, for nothing.** LiveMap reached
Leaflet through a second `await import("leaflet")` inside its effect, which
reads as consistent — the map is lazy, so Leaflet is lazy — and is not: the
module is ALREADY only reachable from a runtime `import()`, so the nested one
bought no laziness and cost a round trip. Traced on the built export: a 2.2K
chunk at 59ms, finished at 69ms, and only THEN the 41K one that is the actual
download. A static import makes webpack list it as a dependency and both start
at 61ms. On localhost the gap is 5ms; on a phone in Kuwait it is a whole RTT of
nothing in front of the thing the visitor tapped. **The lesson is general: a
dynamic import inside an already-dynamic module is a serial request, not a
saving.**

Cost: `/search` unchanged at 160.5K, on-demand 223.5K → 223.7K. The line that
names the live map reads 44.2K → 45.5K, and most of that is bookkeeping —
`audit:js` finds map chunks by looking for «leaflet» in a file's first 4000
characters, and the small chunk only declares it now that the import is static.

### And then the tap itself, which is mostly not the download

**Measure the tap from inside the page, or you measure Playwright.** A `t0`
set from the harness put 334ms in front of the first request; the same run
with `t0` set by a capture-phase `pointerdown` listener on the button put it
at **27ms**. The 307ms was actionability checks. Every number below starts at
an event the page itself saw.

With that clock, on localhost where the download is free, ×6 CPU:

```
 27ms  the chunk is requested
 44ms  all three files have arrived (145K raw, 2.6K, 10.9K of CSS)
360ms  .leaflet-container is in the DOM   ← 316ms of parse + L.map()
360ms  the first tile <img> is requested  ← Leaflet wastes nothing here
396ms  the first pin is positioned
```

So **the tap is not waiting for bytes, it is waiting for Leaflet to parse and
build its panes.** That matters because it decides the fix: a preload of the
FILE would buy the 17ms. `import()` resolves only once webpack has EVALUATED
the module, so priming the import moves the parse as well.

**`useLiveMap.warm()` does it on approach**, wired to `mouseEnter`, `focus`,
`touchStart` and `pointerDown` on both «حرّك الخريطة» buttons. Four events
because no one of them covers both visitors: a pointer arrives seconds early
on a desktop and never fires on a phone, where `touchstart` is the 100–300ms
a finger gives between landing and lifting. Measured from the CLICK, ×6:

| pointer arrives | map up | first pin |
|---|---|---|
| not at all (bare click) | 322–330ms | 393–431ms |
| 80ms early — a touch tap | **126–131ms** | 205–245ms |
| 150ms early | 127–154ms | 214–261ms |
| 400ms early | 135–141ms | 237–244ms |

×4: 203–246ms → **75–82ms**. It flattens after ~80ms because what is left is
`L.map()` and the first React render, and neither can start before there is
an element to build into. **There is no version of this that reaches zero.**

This is `ShouqCallButton`'s move, and the precedent settles a question it
would otherwise raise: her button already does `import("@/components/
WainAiCall")` on plain HOVER and withholds only the 451KB third-party bundle
until `pointerdown`. 45K of our own is the first kind, not the second.

**The tile host was connected to by nobody.** The static embed's host is
preconnected where it is drawn — `PlaceMapFrame` has the tag, /search's route
has its own copy — and `tile.openstreetmap.org` is a DIFFERENT origin that
nothing warmed, so its DNS, TCP and TLS all started at the moment Leaflet
asked for an image. `warmTiles()` in `map-tiles.ts` starts it on approach, to
overlap the 316ms of parsing. **No `crossorigin`**: tiles arrive on a plain
`<img>`, a no-CORS request, and a preconnect carrying it warms a pool entry
the image cannot use — the identical trap `warmCall` records for the widget's
`<script>`, now the second place on this site it could have been silent.
**Whether it saves a handshake is NOT measurable here** — that host is
refused by the sandbox gateway — so what is asserted is the tag, its href and
the absence of `crossorigin`, and nothing claims more.

Four assertions, all confirmed red (unwiring the handlers fails the first
two; adding `crossorigin` fails the fourth): the approach fetches Leaflet
before any click, the approach does NOT mount the map, the tile host is
preconnected without `crossorigin`, and the tap still works after all of it —
that last because an idempotent warm that left `loading` set would disable
the button it was meant to speed up.

**Proving it could fail is what found a fifth thing.** The first red took the
whole process down: `locator.first().evaluate()` THROWS when nothing matches,
so one failing assertion silently cancelled every section after it — the
exact shape of the shouq-flow coverage hole recorded above, met again while
checking a test could go red. It reads the links with `evaluateAll` and
filters in the page now, so a red is a red and the run continues.

**It is opt-in, and the number is the reason.** Leaflet measures **42.4K
gzipped plus 3.5K of CSS**, and `/search` sits at 160.5K against the 175K
`audit:js` budget. So `useLiveMap` reaches it through a runtime `import()`
from inside a callback and nothing fetches it until «حرّك الخريطة» is tapped.
The static frame is not a fallback on its way out: it is what a visitor gets
for nothing, what works with no JavaScript and no network, and what keeps tile
requests to a fraction of page views.

**The service worker gave it away for free, and that is the part to remember.**
`gen-sw.mjs` precached «everything under `_next/static/`», so the 45K kept off
the route was downloaded by every visitor at install time anyway — cost
removed from the place that measures it and put back in the place that does
not, with «80 files precached» in the build log as the only trace. It now
precaches only what some page's HTML references, and `audit:js` grew a section
that reports the on-demand set and **fails if any of it is in the precache**;
confirmed red by putting the old filter back.

**That rule dropped the precache by 223.5K gzipped, and only 45K of it was
the map.** The rest had been shipping to every visitor for months: **104K of
Pages Router shells** (`framework-*.js`, `main-*.js`, `pages/_app`,
`pages/_error`, `_buildManifest`, `_ssgManifest`) that an App Router export
never loads, and **72K of Supabase** — the client for the back end that is
unconfigured and inert. 80 files to 62. `audit:js` now warns that
`framework-*.js` is referenced by nothing, which it always was; it read as
referenced only because the service worker was listing it.

**One trap in writing that rule, and it cost the first attempt.** The place
pages' shared route chunk is spelled `app/places/%5Bslug%5D/page-….js` in the
HTML and `app/places/[slug]/page-….js` on disk, and the leading slash is
optional in the markup. Comparing raw strings dropped the one chunk all 52
place pages need — caught only because the count fell by more than the files
the rule was written to exclude. **Decode and normalise, and be suspicious of
a cleanup that removes more than you named.**

**Two maps, two hosts, two CSP directives.** `www.openstreetmap.org` is the
embed and belongs in `frame-src`; `tile.openstreetmap.org` is the live map,
whose tiles Leaflet fetches as ordinary images, so it belongs in **`img-src`**
and nowhere else. Get that wrong and the map mounts, pans, zooms and stays
blank, with only the console saying why — `audit:htaccess` catches it, and did.

**Using the tiles directly is a different relationship from embedding their
page**, and `map-tiles.ts` carries both obligations: attribution rendered on
the map itself (in Arabic — Leaflet's own control is an English corner box on
an RTL page, so it is switched off), and modest use, which the opt-in design
is most of. **If this site ever gets real traffic, move off those tiles**:
`NEXT_PUBLIC_WAIN_TILES` repoints the live map with no code change, «none»
removes it entirely, and the new host has to join `img-src` in the same
sitting.

**A flaky test turned out to be a real race.** `useHoverless` started `false`
and flipped in an effect, so for one render a phone was treated as a mouse and
a tap on a pin navigated instead of selecting — the very failure `MapPin`'s
`selectedOnPress` note describes fighting once already, arriving by another
road. It showed up as `map-pin` failing about one run in three once /search
grew a little heavier, against none before. Now answered in the initialiser
(`typeof window !== "undefined" && matchMedia(...)`), which is safe here
because no pin is ever server-rendered — they need a measured frame. **A race
a few kilobytes can open is a race a slow phone opens by itself**, so it is
fixed rather than waited out.

**What could NOT be verified here: a painted tile.** `tile.openstreetmap.org`,
`basemaps.cartocdn.com`, `tiles.openfreemap.org` and `unpkg.com` are all
refused by the sandbox gateway — only the npm registry answers, which is why
Leaflet could be installed and measured but never *seen*. Leaflet is bundled,
so `tests/live-map.test.mjs` does measure the real thing: the chunk is not
fetched until the tap, the iframe gives way to a `.leaflet-container`, every
pin comes across, dragging the map carries the pins and zooming re-projects
them. Confirmed red by syncing on `resize` alone. 18 assertions. What no
assertion claims is that the map looks right, because nothing here can load a
tile.

**And the drag assertion was wrong first in a way worth copying.** It used
fixed viewport coordinates, and /search puts the map well down the page — so
(600,450) was over the result list and the pin «did not move» because nothing
was dragged. It reads the map's own bounding box now. A gesture test that
misses its target fails identically to a broken feature.

## It is already one page

Worth knowing before anyone proposes making it one: `output: 'export'` does
not mean full page loads. The export ships an HTML file per route **and** an
RSC payload per route — those are the `index.txt` files, 61 of them since the
rollback took `/areas` out, and the reason
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
44px, text fields never below 16px.** All three were enforced by `audit:mobile`
and the first by `audit:type`, so they were not a promise, they were a check.

**Asked again, later, for more — and there was no headroom left without
breaking one of the three.** Page-shell gutter and card spacing were already
under 2% of a phone's height; the only lever still unused was a floor itself.
Asked which one, specifically, and told: the tap-target floor, traded down
from **44px (WCAG 2.5.5 AAA)** to **24px (WCAG 2.5.8 AA)** — a real published
level, not an invented number, with its own spacing exception (24px clearance
to the next target) rather than none. The other two floors were NOT
renegotiated: 11px text has no lower AA-equivalent to trade down to, and 16px
fields are a browser behaviour (iOS zooms into anything smaller), not a design
choice this site controls. `audit:mobile` enforces 24px/24px now, in
`MIN_TARGET_PX`/`MIN_TARGET_SPACING_PX`, and says which standard each number
is from.

Every real touch target that was sized to the old 44px floor came down to the
new one: `min-h-11`/`min-w-11` → `min-h-6`/`min-w-6` across ~30 files (buttons,
links, inputs — never a decorative `aria-hidden` icon badge, checked file by
file before the bulk edit). A few needed hand-sizing rather than the bare
floor, because they hold more than a text glyph: `ShouqCallButton`'s launcher
is `size-8` with a `size-4` icon, not `size-6`, or the icon would touch the
button's own edge — 32px keeps its ~45% share of the button (20/44 before,
16/32 now) and still clears 24px with margin. `SearchClient`'s clear-search
button sits `end-N` from that launcher; the offset was re-tuned and verified
by rendering, not computed — `end-11` measured flush against the smaller
button (0px gap), `end-13` measures a clean 8px.

**One hardcoded 44 survived the audit-script fix and only `test:hangout`
caught it.** `scripts/audit-mobile.mjs` reads the floor from
`MIN_TARGET_PX` and was updated everywhere it appears; a second, independent
assertion in `tests/search-button.test.mjs` — `box.width >= 44 && box.height
>= 44` on the navbar's own search button — was not part of that file and kept
the old number. The button had shrunk correctly (50×24), so the test failed
for being stale, not for a real regression: a `scan` clean of every audit
still shipped one browser suite red. Fixed to 24, with a comment pointing back
at `MIN_TARGET_PX` so the next floor change knows to look here too. Worth
keeping in mind generally: an audit script is not the only place a threshold
can be hardcoded — a test file measuring the same thing independently is
exactly the kind of drift `npm run scan` cannot see, because these browser
suites are not in it.

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

**And shrinking the place hero silently cropped every illustration on the site
— on desktop only, for weeks.** Same class as the stale
`contain-intrinsic-size` above, and the second time this pass has left a
measured constant behind. `PlaceArt`/`CategoryArt` are a 400×160 viewBox with
`preserveAspectRatio="slice"`, so **a W×H band shows 400·H/W units of the
drawing** — the band's ASPECT RATIO is the only input, and nothing inside the
drawings can widen that window. The hero went from 848×256 to a full-width
`h-28 sm:h-40`, i.e. 864×160 — 5.4:1, **74 of the 160 units**, where the
drawings need 103. `BASE`, the ground line sitting at y 134 *specifically* to
survive this crop, fell outside it, along with both `SEA` lines and the feet of
every building: buildings sliced through the middle, standing on nothing. The
comment in `PlaceArt.tsx` went on confidently describing a safe box that had
stopped existing.

Nothing could catch it. `audit:mobile` renders 390 and 320, where the ratio is
benign; `audit:padding` checks the gutter, not the band. **A defect that only
exists above 640px had no reader at all** — worth remembering as a gap in its
own right, not just this one bug.

Fixed on the band, not the drawings: `aspect-[18/5]` and `max-w-xl`, which
shows 111 units at every width. **A breakpointed height cannot do this** — the
first attempt kept `h-28 sm:h-40` under the new cap and left a hole between
596px and 639px where the band was already 576 wide but still 112 tall, 78
units, worse than the bug being fixed. One ratio has no cliffs to miss.
`npm run audit:hero` asserts it at ten widths including that pair, and was
confirmed to go red on the old markup (72–78 units) and green on the new.

Two side-findings from it. The hero is deliberately NOT `mx-auto`: centred, it
floated mid-column while the name and description below sit flush to the start
edge. And `audit:padding` had to be corrected rather than worked around — it
treated *any* capped box in `main` as a page shell, so a content box with no
padding of its own read as a second gutter of 0/0. It now takes the outermost
capped box only, and still fails on a real gutter drift.

**The ramps themselves were never measured, and two of them are not ramps.**
`audit:color` asked what colour reaches the screen and whether it can be read —
1360 text nodes, every one passing AA — and never asked whether a step differs
from the step beside it. It does now, in OKLCH lightness, which is
`audit:type`'s «no two steps closer than 1.5px» rule applied to colour. 46
adjacent pairs across 6 ramps; two are exceptions, named with their reasons:

- **`ink-500` → `ink-600` is 3.1 ΔL, and both are heavily used** — 114 and 77
  places, `text-sm` dominant on both sides. Two tokens doing one job at a
  distance no reader can see, so every choice between them is a guess. Kept
  rather than merged: merging is 191 edits and a redesign. Recorded so the next
  person knows there is nothing to choose.
- **`sand` is two ramps under one name.** 50–300 are near-neutral paper
  (C ≤ 0.009), 400–900 are gold (C 0.047–0.098), and the seam multiplies chroma
  9×. «One step darker than `sand-300`» silently hands you a gold. The site uses
  the halves for different things and never walks across the seam.

**Two thresholds in it were wrong first, both the same mistake.** A flat 4 ΔL
floor flagged sand, sea, sun and coral's 50→100 pairs — four «defects» that are
one structural fact about how a tint ramp starts, since a 50 step sits a whisker
off paper by design. And a chroma RATIO reported **×76902** against a pure-white
step, division by almost nothing. Now: the ΔL floor is waived above L 95, and a
family break is crossing neutral (C < 0.02) → chromatic (C > 0.05), which
catches sand's seam and nothing else. **A rule that fires on every ramp is
measuring the rule, not the palette.** Confirmed it still catches both real
shapes: a step nudged to 2.6 ΔL, and a step that goes lighter instead of darker.

**Setting the site's type in an Adobe surface has one trap worth knowing**:
weight 400 is `IBMPlexSansArabic` with NO `-Regular` suffix — every other weight
is `Family-Style`, so the obvious guess is `not_found` — and asking for the bare
family name gives you Light (300), not Regular. A wrong PostScript name does not
error, it substitutes, so it reads as a design decision. `docs/type.md`.

**When a tap target is too small, the type is usually not the reason.**
«استكشف» in the breadcrumb failed at 42px wide because it is four letters and
the link is only as wide as its word. Its height was never in question. The
saving there was the margin.

## شوق has a copy outside this repository now — `/Shoug.ai` in Dropbox

Asked for on 23 September: everything that is شوق, in one folder. **35 text
files** across `agent/ app/ server/ tests/ voice/ docs/`, plus a zip
(`Shoug.ai.zip`, 918 KB) that carries the complete 47-file set. It is an
archive, not a second source — nothing reads from it and nothing syncs it —
so the only thing worth remembering is what it costs to make another one.

**The Dropbox connector creates text files from inline content and has no
binary upload at all.** So none of the ten MP3s are in the folder: the three
hand-made samples and the seven test fixtures are in the zip only. Every
`.txt` beside them IS there, which is most of what matters — each records its
clip's voice id, model, bitrate and the two caveats, so the provenance
survives where the audio does not. (The 324-clip library is in neither,
because it still does not exist — see the voice sections above.)

**`\uXXXX` in file content is DECODED in transit, and that is the finding.**
`tests/shouq-search.test.mjs` came back 96 bytes short and
`tests/shouq-brief.test.mjs` 697. Not a transcription slip — the escapes in
those two files are literal source text (`'button[aria-label*="ا…"]'`),
and the upload path resolved every one of them to the actual Arabic
character. Proved by arithmetic rather than by eye: 175 escapes in the brief
test, 172 of them two-byte and 3 of them `—` at three bytes, which is
`172×4 + 3×3 = 697` exactly. Same JavaScript, same string values, shorter
file.

The probes that isolated it are worth keeping, because the obvious fix does
not work. A 217-byte file mixing Arabic, an em dash, an en dash and `چ` came
back **byte-exact**, so the transport is not lossy. `\s` survives (not a
valid JSON escape). `\\` survives as two backslashes. `\\u0627` survives as
`\\u0627` — **doubling does not protect it**, it just adds a backslash. Only
`\uXXXX` moves. There is no way to put that sequence in a Dropbox file from
here; the copy is equivalent code, not equivalent bytes, and it has to be
labelled as such rather than quietly shipped.

**One byte is still unexplained.** `app/voice-lines.ts` arrived at 11,487
against 11,488, twice, with the file deleted between attempts. Not NFC (the
source is already NFC), not `\uXXXX` (it has none), not trailing whitespace,
not a tab, not CRLF — all checked. A probe of its most suspicious 1,214-byte
region came back exact. The code is intact and the zip has the real file; it
is recorded here as unresolved rather than rounded off.

**The three generated files are deliberately NOT in the folder** —
`wain-ai-agent.md` (121,386), `wain-ai-kb.md` (73,002) and
`wain-ai-brief.mjs` (75,252). Inline-only upload means retyping 270KB of
dense Arabic by hand, and at that size a returned byte count stops being a
guarantee worth having: one wrong hamza in the knowledge base is a corrupted
copy of *what شوق knows*, sitting beside a correct one with nothing to diff
it against. `agent/README.md` is a pointer instead — byte-exact in the zip,
regenerable with `npm run ai:brief`, and `tests/shouq-brief.test.mjs` already
asserts the committed files match a fresh run. **A pointer to a regenerable
file beats a copy nobody can verify**, which is the same argument
`agents_create_kb_text` lost above.

## Permissions are an allowlist now, not a prompt per command

`.claude/settings.json`, committed, `defaultMode: acceptEdits`. File edits and
the routine commands this project actually runs — `scan`, every `audit:*` and
`test:*`, builds, `content`, `node scripts/*`, `php`, the read-only git
subcommands, the inspection shell — go through without asking. Everything else
still prompts, which is the default, so the list is what changed and not the
posture.

**The dangerous half is the point, and it is written as `ask` rather than
`deny` on purpose.** A hard deny on the deploy path would mean a session could
not publish even when somebody asked it to; what is wanted is a pause, not a
wall. So `git push`, `git reset --hard`, `rebase`, any history rewrite (which
شوق's pinned knowledge base makes expensive — see above), every `hosa` call and
the GitHub write tools all prompt. Five things are denied outright: `rm -rf /`,
`rm -rf ~`, a force push, and `hosting_deployStaticSiteArchiveV1` — the last
because this file has said «never use it, it empties the folder first» for
months and a rule nothing enforces is a rule waiting to be forgotten.

**`Bash(git *)` is NOT in the allow list, and the omission is deliberate.** A
prefix wildcard matches every subcommand after it, so one `git *` would have
quietly pre-approved `git push` alongside `git status`. The read-only
subcommands are listed one by one for that reason.

`.claude/settings.local.json` is gitignored: the committed file is the
project's allowlist and every session should get the same one, where a local
override widens it for one machine and nobody else can see that it did.

## Style

No redesigns beyond what is asked for. Fix the current theme. Comments in this codebase explain *why*
and record the bug that made the rule necessary — match that, and do not add
decorative commentary.
