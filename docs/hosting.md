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

## Rotate `admin.token`

60 bytes, in the web root, beside the admin panel it belongs to. The live
`.htaccess` protected `wain.db` and nothing else, and `Options -Indexes` stops
directory *listing* but not a request for a known filename.

Treat it as compromised: rotate it, then move it out of the docroot. The new
`.htaccess` denies it, but that is a patch over a credential that has been
reachable, not a substitute for rotating it.

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
