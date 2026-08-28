# What is actually on wainkw.com

Read through the Hostinger connector on 26 August 2026.
Account `u130124229`, docroot `/home/u130124229/domains/wainkw.com/public_html`.

## The live site is broken

`index.html` (190KB) is a Next.js export. It references **14 `/_next/static/…`
assets** — one stylesheet, eight JavaScript chunks, four fonts.

**There is no `_next` directory on the server.** The docroot has exactly six:
`lib`, `n8n-sync`, `testt`, `ppgg`, `404`, `wain-cache`.

So the page is served with no CSS, no JavaScript and no fonts. There are also no
`places/`, `search/`, `explore/` or `add/` directories, so every route except
`/` is a 404 — including both links the page itself carries.

It is an old export: no call button, no «رسّلها للربع», no queue.

Someone uploaded an `index.html` without the `_next/` folder beside it —
`upload-ftp.sh` and `claude-upload-test.txt` in the same directory suggest a
partial FTP push.

This was not visible from anywhere else. The repository is healthy, CI has
simply never deployed (all 81 runs fail on missing FTP secrets), and the
sandbox's network policy blocks wainkw.com, so no check here can see it.

## What else is in the web root

153 files, mostly from the previous site — a single-file HTML app with a PHP
back end:

- `api.php`, `wain-inst.php`, `wain-restore.php`, `wain-fix.php`, `v.php`
- `wain.db` — a live 94KB SQLite database
- `admin.html` (reachable at `/admin` via a rewrite), `admin.token`
- ~28 `index.bak-*.html`, roughly 11MB, at guessable names
- `files.wain.zip` (4.9MB) and `wain-hosting.zip` (887KB)
- ~50 `*-out.txt` scratch files, including `sec-out.txt` and `keys-out.txt`

**Whether that PHP app is still in use is unknown and matters**, because two of
the obvious next steps destroy it.

## Do not use "deploy static archive"

`hosting_deployStaticSiteArchiveV1`, and the hPanel button behind it, says:

> WARNING: this overwrites the website's existing contents and cannot be undone

That includes `wain.db`. Until someone confirms the old app is finished, deploy
by **extracting `wain-deploy.zip` over the docroot** — which overwrites what
collides and deletes nothing — rather than by the archive deploy.

## The .htaccess trap

The live `.htaccess` denies `wain.db`. This repository ships its own
`public/.htaccess`, and it did not.

Uploading the build as it stood would have replaced the file that protects the
database with one that does not, and put a 94KB SQLite database on the public
web. The export's `.htaccess` now carries those rules forward, plus denies for
`admin.token`, the `.bak`/`.zip` archives and the `*-out.txt` files.

Those rules **deny access; they delete nothing.** Removing the files is a
separate decision for whoever knows if the old app still runs.

## api.php: the API is open to the internet

Reading `api.php` inverted the priority here. It is a key-value store over
`wain.db`, and **five of its actions take no authentication at all**:

| action | what it does | gated? |
| --- | --- | --- |
| `get?k=` | read any value | **no** |
| `set {k,v}` | write any key | **no** |
| `del?k=` | delete any key | **no** |
| `list?p=` | enumerate up to 1000 keys by prefix | **no** |
| `event` | append to a log that records visitor IPs | **no** |
| `stats`, `bulk`, `search`, `export`, `import`, `purge` | | token |

It also sends `Access-Control-Allow-Origin: *`, so any website can drive it from
a visitor's browser. The only limit is 400 requests per minute per IP.

The prefixes named in `stats` say what is in there: `orders:`, `rsvp:`, `inv:`,
`queue:`, `menu:`, `ask:`, `vm:`, `vmi:`, `bizidx`, `salonidx`, `events:`.

So `list?p=orders:` returns order keys and `get?k=…` returns each one. Anyone.
No token. Writes and deletes the same way. `events:log` stores an `ip` for every
event, so there is visitor IP logging in there readable by the same route.

**This is the thing to deal with first**, and it is independent of the token.

## admin.token — I got this wrong first time

I called it "a 60-byte credential" and said to treat it as compromised. That
overstated the mechanism. The code does:

```php
file_put_contents($tokFile, password_hash($given, PASSWORD_DEFAULT), LOCK_EX);
…
password_verify($given, (string)file_get_contents($tokFile))
```

60 bytes is exactly the length of a bcrypt hash. **The exposed file is a hash of
the token, not the token.** Anyone who downloaded it got something they have to
crack offline, not something they can use.

It is still worth rotating — the file's own comment likens the token to a panel
PIN, and a short PIN under bcrypt is crackable — but it is second, not first.

Rotation is easy, because the token bootstraps itself:

```php
if (!file_exists($tokFile)) { file_put_contents($tokFile, password_hash($given, …)); }
```

Delete `admin.token`, then call `stats` once with a new long random token; that
call sets it. Note the corollary: **the `.htaccess` deny does not protect admin
actions** — PHP reads the file from disk, not over HTTP — and anyone who can get
the file deleted can claim admin on the next call.

## Deploying from a Claude session

Not possible from the sandboxed environment. Uploads go through
`srv2231-files.hstgr.io`, which the network policy rejects at CONNECT — the
same reason wainkw.com itself cannot be fetched to check. The connector's read
tools work because the MCP server reaches Hostinger's API server-side.

Two routes that do work:

1. **Set the three FTP secrets** — `FTP_SERVER`, `FTP_USERNAME`,
   `FTP_PASSWORD`, from hPanel → Files → FTP Accounts — and `deploy.yml` ships
   on every push. It has never once run past its first step.
2. **Upload `wain-deploy.zip` by hand** in hPanel → File Manager and extract it
   into `public_html`. Extract; do not use the archive-deploy button.

---

# Removing the old app — the safe order

Only if it is finished. The steps are ordered so that nothing is destroyed
before it is provably safe to destroy, and so any step can be undone until the
last one.

## What is known

The live `/` **is** the Next export, and it contains **zero** references to
`api.php`, `wain.db` or `admin.token`. So the public front door is already off
the old API — visitors do not touch it.

`admin.html` (55KB, reachable at `/admin` through an .htaccess rewrite) **has
now been read**, through the `hosa` connector, and it settles the question:

**The old app is live.** `admin.html` references `api.php` six times. It pings
`api.php?a=ping` on load and, when that answers, swaps its whole storage
backend from `localStorage` to the API — `get`, `set`, `del` and `list`. It
contains no reference to Supabase at all. Deleting `api.php` or `wain.db` would
take the business's order screen with it.

It would not even look broken. The adapter's `catch` falls back to
`localStorage`, and the wrapper returns `[]` / `false` on every error, so the
panel would keep rendering and silently show nothing. See `server/README.md`
for the full table — the same finding also means the hardened `api.php` v3
cannot be uploaded as it stands.

`wain-app-latest.html` and `qareeb.html` — the old single-file app — almost
certainly call it too, but nothing serves them at a route any more.

## 1. Back up, before touching anything

**Download three files, not one.** `api.php` opens the database with
`PRAGMA journal_mode=WAL`, so recent writes live in a side file until SQLite
checkpoints them. Copying `wain.db` alone can silently lose the newest orders —
exactly the ones most worth keeping.

From hPanel → File Manager, download all three if they exist:

```
wain.db
wain.db-wal      ← recent writes live here
wain.db-shm
```

Keep them together; SQLite reassembles them.

**A second copy, if you still have the admin token**, as JSON — useful because
it is readable without SQLite:

```bash
curl -s -H 'X-Wain-Admin: YOUR-TOKEN' \
     'https://www.wainkw.com/api.php?a=export' -o wain-backup.json
```

`export` has always been admin-only, so this needs the *plaintext* token. Only
its bcrypt hash is on the server, so if nobody has the plaintext any more, this
route is closed — the file download above is not, which is why it comes first.

## 2. Confirm nothing still calls it

- `admin.html` — search for `api.php`
- Any n8n workflow (there is an `n8n-sync/` directory in the docroot)
- Anything in `lib/`, `ppgg/`, `testt/`, `wain-cache/`

## 3. Delete in this order

Reversible until the last line:

```
*-out.txt                 ~50 scratch files
index.bak-*.html          ~28 backups, ~11MB
index.broken-*.html, *.bak-*.css, *.bak-*.js
files.wain.zip, wain-hosting.zip
wain-local-test.html, extracted_*.html, extracted_*
wain-app-latest.html, qareeb.html, wain-admin-latest.html
admin.html, admin-manifest.webmanifest, admin.token
api.php, wain-inst.php, wain-restore.php, wain-fix.php,
  wain-ver.php, wain-search-cache.php, v.php
wain.db                   ← last, and only with the backup in hand
```

Leave `lib/`, `n8n-sync/`, `wain-cache/`, `ppgg/` and `testt/` until someone
has looked inside them.

## 4. Afterwards

The `.htaccess` deny rules for `wain.db`, `admin.token`, the archives and the
`*-out.txt` files become dead weight rather than protection. Harmless, and
worth keeping until the deletion is confirmed — they cost nothing and they are
the safety net if a file is missed.

## If it is not finished

Upload `server/api.php` instead and keep the app running with the holes shut.
The two paths are exclusive; do not do half of each.

---

# Releases

```
npm run release
```

Builds the export, stamps it, checks it, and archives it as
`wain-<version>.zip` with a `.sha256` beside it.

## build.json — the thing that was missing

For months nobody could answer the simplest question about wainkw.com: **what
is actually up there?** The live `index.html` referenced fourteen `/_next/`
assets and the `_next` directory did not exist, and there was no way to see
that from the repository or from the server — the file was just an old copy of
something.

Every release now writes `build.json` into the export, at a fixed URL:

```json
{
  "name": "wain",
  "version": "1.1.0",
  "commit": "…",
  "branch": "…",
  "dirty": false,
  "builtAt": "…",
  "files": 192,
  "pages": 46,
  "bytes": 9050977,
  "digest": "…"
}
```

Once a release is deployed, one request answers it, from anywhere, with no
credentials:

```bash
curl -s https://www.wainkw.com/build.json
```

`digest` is a SHA-256 over every path and every byte in the export **except
`build.json` itself**, so it says *the thing on the server is the thing I
built* rather than *the version string in it claims to be*.

That exclusion is what makes the number mean anything, and it was missing at
first. `build.json` carries `builtAt` and is written into the export, so on any
run where `out/` already held one, the digest hashed a timestamp: the first
release printed `72648c7b` and a re-run over the identical tree printed
`f94ea0a8`, with nothing changed but the clock. A fingerprint that never
repeats cannot verify anything. Three consecutive runs now print the same
digest. `dirty` records whether the working tree had uncommitted
changes — a release built dirty is not reproducible from its commit, and the
script says so rather than pretending otherwise.

## What it refuses to do

The archive is not written unless the export contains all eight of:

`_next/` · `index.html` · `.htaccess` · `404.html` · `sw.js` ·
`manifest.webmanifest` · `robots.txt` · `sitemap.xml`

`_next/` is first because its absence is exactly what broke the live site, and
that failure is invisible — the page loads, unstyled, with every link a 404.

It then unzips its own archive to confirm `.htaccess` is really inside. A zip
built from the wrong directory drops dotfiles silently, and that particular
dotfile is what keeps `wain.db` off the public web.

## Deploying a release

hPanel → Files → File Manager → `public_html` → Upload the zip → right-click →
**Extract** → delete the zip.

Extract, never the "deploy static archive" button: that empties the folder
first, and `wain.db` is still live in there. Then check it landed:

```bash
curl -s https://www.wainkw.com/build.json
```
