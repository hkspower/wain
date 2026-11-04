<!-- Two lanes keep this file: the REPO scan (scripts/unknown-files-scan.mjs) and the LIVE server scan (below).
     Add your section; never replace the other lane's. -->
# Unknown files

"Which files does nothing in this project explain?" has two halves, two tools, one rule: **a check never
deletes**. A file is KNOWN because a line of evidence says so, UNKNOWN because none does, SUSPICIOUS when it is
unknown (or known-but-wrong) *and* carries a risk signal. Deleting, moving or rewriting history are owner
decisions, taken afterwards, with the exact commands in front of the owner.

| Half | Tool | Reads | Section |
|---|---|---|---|
| the repository, its history and the packages built from it | `scripts/unknown-files-scan.mjs`, rules in `ops/known-files.json` | the checkout | the repo lane's section of this file |
| **the live server** | `scripts/live-files-scan.mjs`, run as the one-shot job `ops/live-files-scan.compose.json` | `/docker/sporta`, read-only | **below** |

---

# The live server

## What it checks

The whole `/docker/sporta` tree, not only the web root: the web root file by file, everything else by name, size,
mode and owner. For every file it prints a verdict and the evidence:

| Area | What is walked | How it is judged |
|---|---|---|
| `site/` (the web root) | every file and directory | **file by file**: hash, type by magic bytes, signatures, reachability, executability |
| `private/` | configs, secrets, logs, `bin/`, `backups/` (encrypted dumps), `voice/` | **names, sizes, modes, owners** against the documented layout |
| `private/media/` | the product-photo mount (public by design) | each file is an image (magic bytes), no PHP inside, the folder has an `.htaccess` that refuses PHP |
| `backups/`, `releases/` | deploy pre-images and records, hand backups | one row per entry by name; a line of its own for anything sensitive or odd (a world-readable dump, a copy of a config) |
| loose files and old copies at `/docker/sporta` | `Dockerfile`, override files, `site-prev-*`, `rollback/`, `staging/` | one row per entry; copies are summarised (files, bytes, PHP count), never listed file by file |

**KNOWN** means a rule explains it, and the rule is printed (`rule=`):

| Rule | Evidence | Strength |
|---|---|---|
| `repo:head`, `repo:oldN` | the file's bytes are exactly a version of that path committed in the repo (git blob id; the manifest carries **every** version in the history reachable from the chosen commit; `oldN` = N versions behind the newest) | strongest |
| `repo-normalized` | the root `.htaccess`, once the build-filled CSP script hashes are folded back to the placeholder | strong |
| `referenced-by-live-index` | reached from the live `index.html`, `.htaccess`, `robots.txt`, sitemaps, manifest or `sw.js` by the same walk `old-files-inventory.mjs` makes (the live storefront is a foreign build, so "expected" there means referenced) | weak: it says "the page uses it", not "its bytes are right" |
| `live-entry`, `live-config-js`, `service-worker`, `static-root-text`, `acme-challenge`, `owner-photo`, `font-file`, `priv-*`, `media-*`, `bk-*`, `rel-deploy`, `top-*`, `copy-*` | a documented live-only file (`LIVE_RULES` in `make-expected-manifest.mjs`; each rule names the document that says so) | rule-shaped: size, type and mode are checked, content is not hashed |

Signature scanning runs on everything that is not an exact repo match, so a known-by-rule file that carries a
webshell shape is flipped to SUSPICIOUS.

**SUSPICIOUS** is unknown (or known-but-wrong) plus any one of: it can run in a web-reachable directory;
a webshell / obfuscation / skimmer / secret signature; an `.htaccess` handler override; PHP inside a non-PHP file;
a SQL dump or archive in the web root (even where a rule refuses it today: the rule is one config line);
a credential-shaped name; a symlink leaving the root; setuid; a world-writable directory; version-control
metadata; a setup tool the owner was told to delete; a shipped PHP file whose bytes are no committed version;
newer than the last deploy and executable; a FIFO, socket or device node.

Per finding it prints: path, size, mtime, mode, owner uid, type (by first bytes), sha256 prefix (files under
1 MB that may be read), **`rch=`** reachable by URL (Y/N), **`ex=`** executes (`php`, `php-alt` for `.phtml/.phar/.php5`,
`script`, `(denied)` when a rule refuses it), **`age=`** relative to the last deploy (`+2h` = two hours after), the
rule, the flags and the signature hits (`name@line`, a secret as a mask of at most 4 characters).

Also: world-writable files and directories, setuid/setgid, dotfiles and macOS leftovers, archives, SQL dumps,
editor and backup copies, files newer than the newest `deploy-<stamp>-<sha7>` name, unexpected owner uids
(`site/` expects 0 and 501, `private/` 0 and 33; override with `--uids`), directories that would list their
files, symlinks, and a count of how many committed versions behind each live add-on is (`REPO_VERSIONS`).

## What it never does

* **Writes, deletes, moves, chmods.** `scanLive` contains no write call (a test asserts it); the mount is `:ro`; the
  only file it writes is its own details file, in the job's tmpfs, mode 0600.
* **Opens a credential.** Names that look like config/credentials/keys/`.env`/compose files are never opened,
  anywhere. Under `private/`, `backups/`, `releases/` and the loose files, a file is opened only if it is under
  64 kB and its name does not look like a config, credential, dump, log, archive or encrypted file. `private/media/`
  is the one exception: the first 4 KiB of each photo (type, PHP-in-image check). Every open uses `O_NOFOLLOW`,
  `O_NONBLOCK` and an `fstat` that must say "regular file" (a symlink swapped in late or a FIFO cannot hang or
  redirect it). The test records every open and compares it with an independently written rule.
* **Prints content.** A signature hit prints its name and line number; a secret prints a mask of at most 4
  characters (`AKIA****`); a private-key block prints `PEM-block`. Paths are treated as data: control characters
  become `?`, odd paths are JSON-quoted, and lines are cut, so a file named like a log line cannot forge one.
* **Touches the network.** The job runs with `network_mode: none`.

## Reachable and executes are a model, not a probe

`rch=` / `ex=` come from the `.htaccess` files found in the tree: `FilesMatch`/`Files` with `Require all denied`,
unconditional `RewriteRule … - [F]`, `RedirectMatch 404`, `Options -Indexes`, with the inheritance rules measured
in CLAUDE.md (a `FilesMatch` is inherited, a `RewriteRule` is not). Not modelled: the container's own Apache
config, Traefik, the photo mounts that hide `site/cats`, `site/hero`, `site/images/products`, and rewrites like
the root `index.php -> /` 301. So `rch=Y` is an upper bound ("no `.htaccess` refuses it"); `rch=N` means a rule
refuses it, which is itself one config line. Confirm any SUSPICIOUS `rch=Y` with a live GET (`vps-deploy.mjs compose
--scan`, `live-scan.mjs`) before acting. `age=` uses the file's mtime, which an attacker can set.

## Procedure

1. **Build the job** (on a machine with the repo and its history; the job is a file, nothing runs):
   ```
   cd sporta-web
   node scripts/make-expected-manifest.mjs              # same as: npm run make:live-files-job
   node scripts/make-expected-manifest.mjs --check      # exit 0 and "ok" when the job matches the script
   ```
   It records the commit it was built from (default `HEAD`; `--sha <rev>` for another). The manifest holds every
   version of every shipped file in the history reachable from that commit, so **use a commit that contains what
   was deployed** (today's `HEAD` does; an older commit makes newer live files UNKNOWN). Regenerate whenever
   `live-files-scan.mjs` or `LIVE_RULES` changes: `npm run test:unknown-files` fails on a stale job. The job is about
   48 kB (the earlier proven jobs are ~52 kB). If the Hostinger API refuses the size, push the commit and use
   `--fetch <pushed sha>`, which prints a variant that downloads only the script from `raw.githubusercontent.com`
   and keeps the 17 kB manifest embedded (it drops `network_mode: none`, which it needs).
2. **Start it** through the Hostinger API connector (VM `2058651`): create a Docker Compose project named
   `sporta-files-scan` from the contents of `ops/live-files-scan.compose.json`. The API refuses a compose file
   containing `curl`, `wget`, `require(` or a dollar sign: this one holds none (base64 text, checked by the test).
   As with the other scratch jobs the first create often leaves the project "not found": create again with the same
   name. The container prints once and exits.
3. **Read the log** (the connector's project-logs call, capped at 300 entries; the job prints at most ~230 lines).
   The last line is `FILES_SCAN_DONE`. `FILES_SCAN_FAIL …` means `/sporta/site/index.html` was not found (the mount is
   wrong) or the manifest did not load.
4. **Page the rest** if the log ends with `F ... N more finding line(s) not printed`. The job is stateless, so a
   second run with a page variable re-scans and prints that page (same order, 200 findings per page):
   ```
   node scripts/make-expected-manifest.mjs --stdout --env SCAN_PAGE=1 > page1.compose.json
   node scripts/make-expected-manifest.mjs --stdout --env SCAN_PAGE=2 --env SCAN_VERDICT=SUSPICIOUS > page2.compose.json
   ```
   Knobs: `SCAN_PAGE`, `SCAN_PAGE_SIZE`, `SCAN_VERDICT` (`SUSPICIOUS,UNKNOWN`), `SCAN_AREA` (`site`, `private`, `media`,
   `backups`, `releases`, `top`, `copy`), `SCAN_UIDS` (`site=0,501;private=0,33`). The job also writes every finding as
   one JSON line to `/out/details.ndjson` on the container's own tmpfs (mode 0600, gone with the container);
   `node live-files-scan.mjs --read details.ndjson --page 2` pages such a file, for a host where a volume survives.
5. **Delete the scratch project** (`vps_docker_delete`) the moment the log is read, and confirm it is gone.
6. **Triage** with the table below. Record owner decisions in `LIVE_RULES` (a file the owner says belongs) or in
   a clean-up job (a file the owner says goes), then regenerate and re-run to prove the finding is gone.

Run it **before** a backend deploy (so a deploy is not built on a surprise), **after** any incident, and once a
month; each run is read-only and takes seconds.

## Expected-good output

A tree where everything is explained prints this (the counts are from the test's fake docroot built from the
repo at one commit; yours differ, the shape does not):

```
FILES_SCAN root=/sporta walked=276 unreadable=0 manifest=08e79b7a paths=199 versions=810
BUILD index.html FOREIGN sha=acadd7ab0dc2 size=19094 mtime=2026-11-02T10:48Z
DEPLOY last=deploy-20261103T104853Z-8bf6001 (2026-11-03T10:48Z, from backups/) newest_site_file=2026-11-02T10:48Z
COUNTS judged=243 KNOWN=243 (flagged 0) UNKNOWN=0 SUSPICIOUS=0 · findings high=0 medium=0 low=0
KINDS none
MODEL executable+unknown in web-reachable dirs=0 · dirs listing OPEN=0 (listing refused by -Indexes: 13) · reference walk reached 113 site files
AREA site files=211 dirs=13 … KNOWN=211 UNKNOWN=0 SUSPICIOUS=0   (and private, media, backups, releases, top, copy)
REPO_VERSIONS 136 files are exactly the repo's current version; 21 are an OLDER committed version (most behind: …)
RULES repo:head=136 referenced-by-live-index=50 repo:old=…  media-image=4 … 
-- findings: 0 (0 high/medium/suspicious, 0 low in 0 groups) --
FILES_SCAN_DONE
```

`BUILD … FOREIGN` is expected until this repo's storefront is live again. `REPO_VERSIONS` is information: the live
add-ons are deployed one at a time, so some are older than the repo.

**The first real run will not be clean, and that is the scan working.** From the existing scans, expect:
`site/backups/` (a hand backup folder inside the web root, `scratch-or-backup-dir-in-web-root`), `.htaccess.bak-*`
files (denied by rule, `editor-copy`), old hashed chunks in `assets/` (`unreferenced-chunk`, grouped on one line),
`credential-copy` and `world-readable` on `backups/claude-20261031T1325Z/` and `…T1515Z/` and the `manual-…rate-limit-secret`
folder (LIVE-SECURITY-SCAN config-3 and config-4), `private/` names no document lists (`not-explained`), and loose files in
`/docker/sporta` the VPS scan listed as clutter. Anything else UNKNOWN is the answer to the owner's question.

## What to do with each verdict (the scanner never does it)

| Verdict | Meaning | Do |
|---|---|---|
| **KNOWN, no flags** | explained, nothing wrong | nothing |
| **KNOWN with flags** | explained but wrongly set up: `world-readable` / `mode-wider-than-documented` / `credential-copy` / `uid-unexpected` / `vcs-metadata` in an old copy | fix the mode or owner, or retire the copy (`chmod 700 /docker/sporta/backups`; owner-approved deletion of a credential copy after the change it preceded is accepted). Re-run. |
| **UNKNOWN, low** | clutter: old chunks, editor copies, dotfiles, stray names | batch them by group line. Old chunks: the `old-files-inventory.mjs` CLEAN-UP (move to `/docker/sporta/backups/old-assets-<stamp>/`). Otherwise either the owner says "ours" (add a `LIVE_RULES` entry with the document that says so) or it goes to the quarantine job. |
| **UNKNOWN, medium** | a stale credential copy, an open directory listing, a photo folder without a PHP refusal, a world-readable dump | fix the cause (add `Options -Indexes`, add the folder `.htaccess`, `chmod`), then quarantine or retire the file. |
| **SUSPICIOUS** | could run, leak, or was left by someone | **do not delete.** Keep the evidence: path, sha256, mtime, the log line. 1) live GET it (`rch=Y`?). 2) read it on the host, not through the web. 3) if it is not ours, ask the owner to approve the quarantine move below; rotate any credential the file could have reached (`/api`'s `cron_key`, `rate_limit_secret`, DB password, gateway credentials) and read the access logs for its URL first. 4) find how it got there (`age=`, `uid=`, the deploy log) before cleaning, or it comes back. |

### The follow-up job that MOVES, never deletes (not built; owner-approved, single purpose)

A separate one-shot job, started only after the owner reads the list and names the exact paths:

* mounts `/docker/sporta` read-write and nothing else; takes the paths as a list in an environment variable;
* refuses a path that is not under `/sporta/site/`, `/sporta/backups/` or `/sporta/staging/`, that is a config, a
  `private/` file, a directory, or that does not appear in a fresh scan as UNKNOWN/SUSPICIOUS;
* `mv`s each file into `/sporta/quarantine/<UTC stamp>/<same relative path>` (same filesystem, so a rename, no copy),
  mode 0700 on the folder, records `path sha256 size mtime mode uid` in `quarantine/<stamp>/MANIFEST.txt`, then
  re-runs the web probes (`/`, `/shop`, `/api/api.php?r=products`) and prints `QUARANTINE_OK`;
* undo is `mv` back from the manifest. **Blast radius:** a moved file is a 404 at its URL from that second; if the
  scan was wrong about a file the site loads, that page breaks until it is moved back. That is why the probes run, why
  the list is explicit, and why it moves rather than deletes. Deleting the quarantine folder is a later, separate
  owner decision.

## Maintenance

* `LIVE_RULES` (in `scripts/make-expected-manifest.mjs`) is the allow-list with reasons. Add a line when the owner
  decides something, **never to make a run green**. Each rule names its document; the test checks that it does.
* The manifest's three restated facts (dropin -> `api`/`knet`/`pay`, the skip list, the setup tools and held-back photo
  folders) are compared with `bundle-php.mjs` and `vps-deploy.mjs` by the test, so they cannot drift quietly.
* The reference walk is a port of `old-files-inventory.mjs` (a script with no exports); the test runs both on one
  docroot and fails if they reach different files.
* The signature list (`SIGNATURES` in `live-files-scan.mjs`) is the shared set of webshell, obfuscation, skimmer
  and secret shapes; if the repo-side tool exports the same list, import it and delete the copy.

## Limits (what this does not see)

Anything outside `/docker/sporta` (`/docker/apache`, `/docker/traefik`, n8n and database volumes, the host's cron, `/etc`);
file CONTENT under `private/`, `backups/` and the old copies (names only, by design); a rootkit or a changed
container image; a webshell whose bytes equal a committed file (impossible by construction) or that hides inside a
file a *rule* explains (a rule-known file is checked by size, type and signatures, not by hash); mtime tricks;
the database. `private/` names the documented layout only: a new secret file the docs do not list is UNKNOWN
until a rule names it.

## Proof

`npm run test:unknown-files -- --section live` (about a minute on a loaded machine; needs git and the history):
a fake docroot built from the repo at a commit (`git archive`, so uncommitted edits cannot move it) plus a foreign
storefront (the real captured live build when its folder exists); a clean run with zero findings; **39 planted
cases** (38 unknowns and misconfigurations, and one genuine owner photo that must stay KNOWN: a shell in `images/`, a photo folder with no PHP refusal, a PHP file in the photo mount, a world-writable
directory, a SQL dump and a zip in the web root, a foreign `index.php`, a PHP file newer than the last deploy, a
symlink leaving the root, an old chunk, `.git/`, a setuid binary, a foreign owner, a polyglot photo, a modified shipped
PHP file, leftover setup tools, a handler-override `.htaccess`, an open directory listing, a world-readable dump,
a stale config copy, a credential copy in a backup, a FIFO, a log-forging file name …), each found with its verdict,
flags and facts, and nothing else flagged; the privacy checks (what is opened, what is printed); the 300-entry log
budget, paging and the details file under a flood; the compose job (read-only mount, no network, decodes to the exact
script and manifest, and its own command line run end to end); and **33 mutants** — a detector blinded in a copy of the
scanner — each of which makes the matching check fail.
