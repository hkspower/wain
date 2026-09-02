# What is actually on wainkw.com

Read through the Hostinger connector on 2 September 2026. The previous version
of this file described the site as it stood on 26 August, and almost none of it
is true any more — so it has been replaced rather than annotated. What it said,
and why the change matters, is at the bottom.

Account `u130124229`. **wainkw.com is an addon domain**, docroot
`/home/u130124229/domains/wainkw.com/public_html` — not the account's
`/public_html`, which belongs to the primary domain. That distinction is the
single most likely way a deploy goes wrong, and it is why `deploy.yml` reads
the site back after uploading.

## The live site

```
version 1.1.0 · commit d818bc2 · built 2026-08-28T11:26Z
192 files · 46 pages · digest 72648c7bdcc58e61
```

Read from `https://www.wainkw.com/build.json`, which every release writes into
the export for exactly this purpose: one request, no credentials, from
anywhere. `npm run release` prints the digest it just built, so comparing the
two is the whole check.

The docroot holds **twelve files and fourteen directories, all of them ours** —
`_next`, `places`, `search`, `explore`, `add`, `queue`, `orders`, `admin`,
`about`, `privacy`, `voice`, `brand`, `og`, `404`, plus `index.html`,
`.htaccess`, `sw.js`, `sitemap.xml`, `robots.txt`, `manifest.webmanifest`,
`build.json` and the icons. Nothing else.

## What that means: three warnings have expired

The old file led with an open API, an exposed SQLite database and a broken
export. All three are gone, and it is worth being explicit about which, because
each was a reason not to do something.

- **`api.php` is gone.** It was a key-value store over `wain.db` with five
  unauthenticated actions — `get`, `set`, `del`, `list`, `event` — and
  `Access-Control-Allow-Origin: *`, so any site could drive it from a visitor's
  browser. It is no longer in the docroot.
- **`wain.db` is gone**, along with `wain.db-wal`, `admin.token`, the ~28
  `index.bak-*.html`, `files.wain.zip`, `wain-hosting.zip` and the ~50
  `*-out.txt` scratch files including `keys-out.txt` and `sec-out.txt`.
- **The export is whole.** For months `index.html` referenced fourteen
  `/_next/` assets that were not on the server — no CSS, no JavaScript, no
  fonts, and every route but `/` a 404. `_next/` is there now and so is every
  route.

**Consequence for deploying:** the old advice was «never use hPanel's *deploy
static archive* button, it empties the folder and `wain.db` is still in there».
There is nothing left in there to lose — the folder contains only a build we
can reproduce from git. The button is no longer dangerous. It is still not the
recommended path, for the ordinary reason that a wipe-and-replace has a window
where the site is empty, and an FTP sync does not.

Whoever cleaned this up did the work the old file called «the safe order». It
is done.

## Deploying

### Automatic, on every push — the intended route

`.github/workflows/deploy.yml` builds and deploys on every push to the working
branch. It has never completed, because it stops on its first step:

```
Missing repository secret(s): FTP_SERVER FTP_USERNAME FTP_PASSWORD
```

130 runs, all of them that. Add the three at **Settings → Secrets and variables
→ Actions**, from **hPanel → Files → FTP Accounts**:

| Secret | Value |
| --- | --- |
| `FTP_SERVER` | the bare host, e.g. `ftp.wainkw.com` — no `ftp://`, no path |
| `FTP_USERNAME` | the FTP account's username |
| `FTP_PASSWORD` | its password |

Then the next push deploys, and the run's last step says whether it landed.

**One variable may also be needed.** The workflow uploads to
`/domains/wainkw.com/public_html/`, which is right for the *main* account
(`u130124229`), whose FTP root is `/home/u130124229`. If instead you create a
**per-website FTP account** in hPanel, it is chrooted to the site's own docroot
and the path is simply `/` — set the repo **variable** `FTP_SERVER_DIR` to `/`.

Get it wrong and the FTP step still reports success: the files land in the
primary domain's docroot. That is why the workflow ends by fetching
`build.json` from the live site and failing unless the digest matches the build
it just made. A green tick now means the site actually changed.

### By hand

`npm run release` writes `wain-<version>.zip`. In hPanel → File Manager, upload
it into the docroot and **Extract**. Extracting overwrites what collides and
deletes nothing.

Confirm either way:

```bash
curl -s https://www.wainkw.com/build.json
```

### Not from a Claude session

Uploads go through `srv2231-files.hstgr.io`, and `wainkw.com` itself resolves
through the same policy — both are refused at CONNECT with a 403 from the
sandbox's egress gateway, not from Hostinger. The `hosa` connector's read tools
work because the MCP server reaches Hostinger's API server-side, which is how
everything above was measured; `hosting_generateUploadURLV1` returns a valid
TUS URL and credentials that this environment then cannot reach.
`hosting_deployStaticSiteArchiveV1` needs the archive already sitting in the
docroot, so it does not route around that either.

## The one thing still missing: the back end

The live build carries no Supabase configuration, and a static export bakes
those values in at build time — nothing can supply them afterwards. Every page
renders from the catalogue in `places.ts`, but **ordering, the queue and the
submission form are inert**, and `/admin` says so.

`deploy.yml` already passes them through, so this is two settings, not a code
change:

- variable `SUPABASE_URL`
- secret `SUPABASE_ANON_KEY` — the anon key is public by design, RLS decides
  what it can do; it lives in `secrets` only so it is masked in logs. **Never**
  put the `service_role` key there.

The build logs a warning naming this whenever it ships without them.

## The `.htaccess`

The export ships `public/.htaccess`, and the live copy is 12,395 bytes of it.
It carries deny rules for the old app's files — `wain.db`, `admin.token`, the
`.bak`/`.zip` archives, the `*-out.txt` files. Those files no longer exist, so
the rules protect nothing today. They are kept because they cost nothing and
because a restore from an old backup would otherwise republish them.
