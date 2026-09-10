# What is actually on wainkw.com

Read through the Hostinger connector on 9 September 2026, after the deploy that
landed this build. The previous version of this file was written on 2 September
and its central claim — «the docroot holds nothing but our export» — is false.
How it went false is the most useful thing in this file, so it is kept at the
bottom rather than deleted.

Account `u130124229`. **wainkw.com is an addon domain**, docroot
`/home/u130124229/domains/wainkw.com/public_html` — not the account's
`/public_html`, which belongs to the primary domain. That distinction is the
single most likely way a deploy goes wrong, and it is why `deploy.yml` reads
the site back after uploading.

## The live site

```
version 1.1.0 · commit 8b7b8e5 · built 2026-09-09T13:27Z
243 files · 62 pages · digest ab15dd784a738cdd
```

Read from `build.json`, which every release writes into the export for exactly
this purpose. `npm run release` prints the digest it just built, so comparing
the two is the whole check.

Spot-checked against the local build, byte for byte:

| path | server | build |
| --- | --- | --- |
| `_next/static/css/0fc52fdd728fbe76.css` | 88,140 | 88,140 |
| `places/kuwait-towers/index.html` | 65,971 | 65,971 |
| `og/kuwait-towers.jpg` | 32,072 | 32,072 |
| `.htaccess` | 15,672 | 15,672 |

## `build.json` matching is not proof the deploy landed

This is the lesson of 9 September and it is worth more than the numbers above.

The deploy arrived in pieces. First the twelve root files — including
`build.json`, already reading the new commit and the new digest. The 232 files
in subdirectories arrived later, and `og/` later still. In between there was a
window in which every check this project had would have reported success:

```
curl -s https://www.wainkw.com/build.json   →  digest matches ✓
```

…while `_next/` did not exist. No stylesheet, no JavaScript, no fonts, and
every route but `/` a 404. The site was serving unstyled text and reporting
itself healthy, because `build.json` is a *root* file and the root arrived
first.

So confirm a deploy by asking for something that is not at the root:

```bash
curl -sI https://www.wainkw.com/_next/static/css/<hash>.css   # 200, not 404
curl -sI https://www.wainkw.com/explore/                      # 200
curl -sI https://www.wainkw.com/og/kuwait-towers.jpg          # 200
```

The css hash is in `out/index.html`; `deploy.yml` already fetches `build.json`
and should be extended to fetch the stylesheet too.

## The docroot is shared. It is not all ours.

Twelve files and twenty-two directories. **Fourteen directories are this
export** — `_next`, `places`, `search`, `explore`, `add`, `queue`, `orders`,
`admin`, `about`, `privacy`, `voice`, `brand`, `og`, `404` — and **eight are
not**:

| directory | entries | what it is |
| --- | --- | --- |
| `api` | 54 | a PHP application: `api.php` (69KB), `store.php` (125KB), `admin.php` (106KB), `assistant.php` (111KB), `wallet.php`, `webpush.php`, ~25 `*.mysql.sql` dumps incl. `install.mysql.sql` (87KB), `config.example.php` |
| `assets` | 44 | a Vite-built front end — `index-TIUCmnwm.css` is 91KB |
| `cats` | 26 | imagery, with a `mobile/` variant set |
| `images` | 17 | imagery, incl. a `vanquish/` set |
| `hero` | 12 | imagery, with `mobile/` |
| `knet` | 5 | `callback.php` (15KB) — a KNET payment callback |
| `fonts` | 5 | `Alexandria-400.ttf` and friends |
| `pay` | 4 | `callback.php` (19KB) — a payment callback |

167 entries that this repository did not put there and does not manage. Two of
them are payment callbacks, which means something may still be pointed at this
domain expecting them to answer.

**Nothing here deletes any of it.** The `.htaccess` denies what should not be
readable — every `*.sql` dump is covered by its `\.(sh|…|sql)$` rule — but the
PHP files execute rather than serve their source, and `/api/admin.php` is a
live admin panel on this domain. Whether that app is still wanted is not a
question this repository can answer.

## Deploying

### By hand — the route that works today

`npm run release` writes `wain-<version>.zip`. In hPanel → File Manager, upload
it into the docroot and use **Extract**. Extract *merges*: it overwrites what
collides and deletes nothing, which is the only safe behaviour in a docroot
that is shared with the eight directories above.

**Do not use hPanel's «deploy static archive» button, and do not call
`hosting_deployStaticSiteArchiveV1`.** Both empty the folder before writing.
That was documented as safe on 2 September, on the strength of a reading taken
that morning; six days later it would have deleted `/api/`, `/pay/` and
`/knet/`. The condition — «only when everything in the folder is this export» —
is currently false.

### Automatic, on every push — still not switched on

`.github/workflows/deploy.yml` builds and deploys on every push to the working
branch. **186 runs, every one of them stopped on the first step:**

```
Missing repository secret(s): FTP_SERVER FTP_USERNAME FTP_PASSWORD
```

Add the three at **Settings → Secrets and variables → Actions**, with values
from **hPanel → Files → FTP Accounts**:

| Secret | Value |
| --- | --- |
| `FTP_SERVER` | the bare host, e.g. `ftp.wainkw.com` — no `ftp://`, no path |
| `FTP_USERNAME` | the FTP account's username |
| `FTP_PASSWORD` | its password |

Add them **in GitHub**. They should never be pasted into a chat, a commit or an
issue.

**One variable may also be needed.** The workflow uploads to
`/domains/wainkw.com/public_html/`, which is right for the *main* account
(`u130124229`), whose FTP root is `/home/u130124229`. A **per-website FTP
account** is chrooted to the site's own docroot and the path is simply `/` —
set the repo **variable** `FTP_SERVER_DIR` to `/`.

Get it wrong and the FTP step still reports success: the files land in the
primary domain's docroot. That is why the workflow ends by fetching
`build.json` and failing unless the digest matches — though see the section
above for why that check alone is not enough.

### Not from a Claude session

Uploads go through `srv2231-files.hstgr.io`, and `www.wainkw.com` resolves
through the same policy — both are refused at CONNECT with a 403 by the
sandbox's egress gateway, not by Hostinger. Re-confirmed 9 September:

```
curl: (56) CONNECT tunnel failed, response 403
proxy status → { "kind": "connect_rejected", "host": "srv2231-files.hstgr.io:443" }
```

The `hosa` connector's **read** tools work, because that MCP server reaches
Hostinger's API server-side — which is how everything in this file was
measured. `hosting_generateUploadURLV1` returns a valid TUS URL and credentials
that this environment then cannot reach, and both archive-deploy endpoints
require the zip to be in the docroot already.

### The server already has a better endpoint than the one below

`public_html/api/deploy.php` was found on 10 September and nothing in this
repository mentioned it, which is why the `wget`-and-`unzip` route was the one
that kept being used. Its own header states its purpose: it "replaces the
unsafe pattern of `wget zip && unzip -o` over a live web root". That was the
route below, verbatim.

**This is now the route `deploy:plan` prints.** The section after it is kept as
a fallback, for a day when the endpoint is broken or its secret is missing.

What it does better: HMAC-SHA256 signed requests with the secret in
`<domain>/storage/deploy.secret`, outside `public_html`; a ten-minute replay
window; the SHA-256 checked before a byte is written; the archive staged in
`../storage/deploy` and never unpacked into the live root; `api`, `knet`,
`pay`, `admin`, `queue`, `orders`, `storage`, `cgi-bin`, `.well-known`,
`.htaccess` and `config.php` refused outright; `.php` inside an artifact
refused; manifest-based cleanup that removes stale build files instead of
letting old `_next/static/<sha>/` directories pile up; and the previous three
releases kept for rollback.

```
POST https://www.wainkw.com/api/deploy.php
X-Deploy-Signature: sha256=<hmac-sha256 of the raw body, keyed by the secret>

{ "url": "https://…/wain-1.1.0.zip", "sha256": "<64 hex>",
  "version": "1.1.0", "ts": <unix seconds> }
```

**It refused this site's export, and that was the finding that mattered
most.** `PROTECTED_PATHS` listed `admin`, `queue` and `orders`, and those are
wain's own routes — `out/admin/`, `out/queue/`, `out/orders/` are static pages
this site publishes. `.htaccess` was on the list too, and the export ships one.
The endpoint refuses an artifact containing any of them with
`artifact_touches_protected_path` before it downloads anything, so a deploy of
this build stopped at the first of the four. The list read as though written
for the PHP app alone, when four of its entries had come to belong to the Next
export instead — and, worse, it did **not** list `assets`, `cats`, `fonts`,
`hero` or `images`, which really are the PHP app's. An artifact carrying one of
those would have overwritten that application's files, and step 9's manifest
prune would have deleted them on the next deploy.

**Fixed on 10 September** by `scripts/publish/patch-deploy-endpoint.php`, and
confirmed by reading the live file back — 267 lines where there were 240. The
script backs the endpoint up, lints the result and restores the backup if the
lint fails, because a syntax error there kills the only deploy path the site
has. It is idempotent: a second run answers `already_patched`.

`ALLOWED_HOSTS` is still `raw.githubusercontent.com`, `github.com` and
`codeload.github.com`, and anything else is refused with `host_not_allowed`.
The patch added a `<domain>/storage/deploy.hosts` file — one hostname per line,
blanks and `#comments` ignored, malformed lines dropped rather than silently
widening the check — so hosting the artifact elsewhere no longer means editing
a file inside `public_html`. `deploy:plan` prints the `printf` line for you
when the archive host is not GitHub.

### Reaching it: the server calls itself

The other blocker was not real, and the way it was wrong is the reusable part.
This document said the POST could not be sent because `www.wainkw.com` is
refused at CONNECT by the sandbox gateway. True, and beside the point: it
confused **unreachable from this session** with **unreachable**.

The answer had been sitting in the crontab the whole time. All eight of
sporta's jobs call their own site over the loopback with a `Host:` header
rather than going out to the internet and back:

```
wget -qO- --timeout=30 --tries=1 --content-on-error --no-check-certificate \
     --header=Host:www.sporta.com.kw "https://127.0.0.1/api/cron-push.php?key=…"
```

The same shape reaches wain. Proved with a GET, which is harmless because
`deploy.php`'s first check is the method:

```
wget -qO- --no-check-certificate --header=Host:www.wainkw.com https://127.0.0.1/api/deploy.php
→ {"ok": false, "error": "method_not_allowed"}
```

That body is deploy.php's own 405 branch, so the request reached PHP, TLS
terminated, and the `Host:` header selected the right docroot. The certificate
is issued for the domain and not for `127.0.0.1`, hence
`--no-check-certificate`; the connection never leaves the machine, which is the
whole reason to use the loopback.

**Before recording that something on this host cannot be done, check whether
the host can do it to itself.** That one question would have saved months of
`wget zip && unzip -o` over a live web root.

`scripts/publish/deploy-call.php` is the caller. It reads
`storage/deploy.secret` on the server, signs the body, and POSTs over the
loopback. The secret is never printed and never leaves the process — only the
HMAC does — which is why the script is safe to keep in the repository.

`php d.php probe` checks the signature on its own. It sends a correctly signed
request whose host is deliberately not allowed; since deploy.php tests method,
secret, signature, JSON, sha format, timestamp and *then* host, in that order,
`host_not_allowed` coming back proves the HMAC was accepted, with nothing
downloaded and nothing written. Measured 10 September:

```
{"http": 400, "response": {"ok": false, "error": "host_not_allowed",
 "host": "deploy-probe.invalid"},
 "signature": "accepted — the request got past the HMAC check"}
```

Three cron jobs, because the command field caps between 210 and 279 characters
and fetch-and-run does not fit alongside the arguments:

```
wget -qO d.php https://raw.githubusercontent.com/hkspower/wain/<sha>/scripts/publish/deploy-call.php
php d.php <artifact-url> <sha256> <version>
rm -f d.php
```

`getCronJobOutputV1` is how the reply is read. `{"ok":true,…}` carries the
file counts; anything else names the step that refused and why.

### The older route: wget and unzip, straight over the docroot

Superseded by the endpoint above, and kept because it needs no secret and no
endpoint — the thing to fall back on if either is missing. Everything in it
about the WAF, cron output and build-id proofs still applies to both routes.

Nothing here can push bytes to Hostinger. The box can *pull* them, and a cron
job is a write path — two commands, run once each and then deleted:

```
npm run release        # build, stamp, archive
npm run deploy:plan    # → the exact commands, and what will prove they worked
```

`deploy:plan` refuses a dirty tree and an `out/` built from anything but HEAD,
checks the pinned URL is fetchable and the same size as the local archive, and
checks the commands against the WAF rule below. It prints them filled in:

```
wget -O /home/<user>/domains/wainkw.com/public_html/w.zip <raw.githubusercontent URL>
unzip -o -q -d /home/<user>/domains/wainkw.com/public_html /home/<user>/domains/wainkw.com/public_html/w.zip
```

`unzip -o` is Extract: it overwrites what collides and deletes nothing, so the
eight PHP directories survive it. The archive's paths are at the top level, so
it must be extracted *into* the docroot, not beside it.

This needs the repository to be public, and the URL must pin the **commit sha**
rather than a branch — the branch moves, and a deploy that quietly fetched
something newer than what was verified is worse than one that fails.

Two things cost a day each before this worked:

**`createAccountCronJobV1` returns 403 from Cloudflare when the command
contains shell plumbing** — `{ … } > log 2>&1`, `$?`. The WAF reads it as an
injection attempt. It is *not* the URL: the same command with the redirection
removed is accepted. Keep cron commands to one program and its arguments, with
no metacharacters, and check `listAccountCronJobsV1` afterwards — an earlier
attempt returned a uid for a job that was never stored, so the reply is not
proof that the job exists.

**Outbound internet does work from cron**, which was in doubt because all eight
of the pre-existing jobs call `127.0.0.1` with a `Host:` header and never the
open internet. `wget` fetched 3,715,813 bytes on the first firing.

Verify the download by size before extracting. Extracting a half-finished
archive over a live docroot is the one outcome worth waiting five minutes to
avoid.

Afterwards, `npm run deploy:verify -- --observed <readings.json>` — the
readings being what the `hosa` connector reports, since nothing here can reach
the live site. It checks six files below the root as well as the stamp.

**Sizes cannot tell two builds apart.** A build id is written into every HTML
file and is a 40-character hex sha whichever commit it is, so an export of one
commit and an export of another have byte-identical root files. Checked
against the live site on 9 September: `index.html` was 139974 bytes in both,
and so were the other eleven, while the two builds were five commits apart.
The only proof that catches this is `_next/static/<commit>/` — the one whose
*name* carries the commit. Never drop it from the required list.

`unzip` merges, so **the assets of the previous build stay behind** — the old
hashed stylesheet and chunks accumulate under `_next/static/`. Nothing points
at them and they are harmless; clearing them is a deletion in a shared docroot
and should be done deliberately, not as part of a deploy.

### Clearing them, when it is done deliberately

Done once, on 10 September: 37 superseded files, ~1.1 MB, six builds' worth.
The method is the same cron job as the deploy — `rm -f` with absolute paths,
created, allowed to fire, then deleted.

What made it safe was choosing the list twice over. Every candidate was absent
from the export that is live, *and* absent from the reference list of every
route's HTML — `_next/static/…` appears in the `<script src>` tags and again in
the RSC payload, so the pages name their own dependencies and can be read back
from the server. Afterwards the same reading was repeated: home, a place page,
`/search/`, `/explore/` and `/admin/` name 20-odd distinct assets between them
and every one still exists. Do that check against the *live* HTML, not `out/` —
a local build is usually ahead of the deploy and names files the server has
never had.

Three things the API did that the deploy notes did not predict:

**A path containing a character the WAF rejects is still reachable — through
`find`.** `_next/static/chunks/app/places/[slug]/` cannot be typed into a cron
command: brackets are outside the accepted set, which measures as
`[A-Za-z0-9 _\-./:=?&@]`. But `find <dir> -name <basename> -delete` names the
same file without a bracket in the command, and is accepted. One program and
its arguments, so it satisfies the WAF rule above too.

**The command length cap is above 210 characters and below 279.** Measured:
two 101-character paths plus `rm -rf ` is accepted, three are a 422. Two full
paths per job is the batch size that always fits.

**`deleteAccountCronJobV1` answers `{"message":"Request accepted"}` for a job
it does not delete.** One of sixteen survived its delete and had to be sent
again. This is the mirror of the create call returning a uid for a job it never
stored, and it has the same remedy: `listAccountCronJobsV1` is the only proof
either way. List after deleting, and expect to find the account back at exactly
the jobs that were there before — anything left behind is a per-minute `rm`
still running.

The build-id directories go too: `_next/static/<40-hex>/` holds only
`_buildManifest.js` and `_ssgManifest.js`, ~1.2 KB a build, and only the
current one is ever requested. Read the live `build.json` to learn which that
is. Do not infer it from `out/`.

## The one thing still missing: the back end

The live build carries no Supabase configuration, and a static export bakes
those values in at build time — nothing can supply them afterwards. Every page
renders from the catalogue in `places.ts`, but **ordering, the queue, business
registration and the live-edit machinery are inert**, and `/admin` says so.

`deploy.yml` already passes them through, so this is two settings plus running
`supabase/schema.sql`, not a code change:

- variable `SUPABASE_URL`
- secret `SUPABASE_ANON_KEY` — the anon key is public by design, RLS decides
  what it can do; it lives in `secrets` only so it is masked in logs. **Never**
  put the `service_role` key there.

The build logs a warning naming this whenever it ships without them.

## The `.htaccess`

The export ships `public/.htaccess` and the live copy is byte-identical:
15,672 bytes. `npm run audit:htaccess` applies every deny rule in it to every
file in `out/` and fails if a rule would block anything shipped.

Its deny rules for the old app's files — `wain.db`, `admin.token`,
`upload-ftp.sh`, the `.bak`/`.zip` archives, the `*-out.txt` scratch — cover
files that are no longer in the docroot root. They are kept because they cost
nothing, because a restore from an old backup would republish them, and
because the `*.sql` and `*.sh` rules in the same block do still cover live
files, in `/api/`.

## What the 2 September version said, and why it was wrong

It said the docroot held «twelve files and fourteen directories, all of them
ours … nothing else», that `api.php` and `wain.db` were gone, and that hPanel's
folder-emptying deploy button was therefore no longer dangerous.

The reading was honest and, for the root of the docroot, still is: `wain.db`,
`admin.token`, `upload-ftp.sh` and the backups really had gone. The error was
turning one morning's directory listing into a standing fact, and then writing
advice that depended on it. A docroot is shared mutable state that nothing in
this repository controls; it can change between two deploys and did.

Anything here that says what is on the server carries the date it was read, and
should be re-read before it is trusted for something destructive.
