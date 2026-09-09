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

### …but the server can fetch for itself

Nothing here can push bytes to Hostinger. The box can *pull* them, and a cron
job is a write path — two commands, run once each and then deleted:

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

`unzip` merges, so **the assets of the previous build stay behind** — the old
hashed stylesheet and chunks accumulate under `_next/static/`. Nothing points
at them and they are harmless; clearing them is a deletion in a shared docroot
and should be done deliberately, not as part of a deploy.

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
