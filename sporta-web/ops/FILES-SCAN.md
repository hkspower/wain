<!-- Two lanes keep this file: the REPO scan (scripts/unknown-files-scan.mjs) and the LIVE server scan (below).
     Add your section; never replace the other lane's. -->
# Unknown files

"Which files does nothing in this project explain?" has two halves, two tools, one rule: **a check never
deletes**. A file is KNOWN because a line of evidence says so, UNKNOWN because none does, SUSPICIOUS when it is
unknown (or known-but-wrong) *and* carries a risk signal. Deleting, moving or rewriting history are owner
decisions, taken afterwards, with the exact commands in front of the owner.

| Half | Tool | Reads | Section |
|---|---|---|---|
| the repository, its history and the packages built from it | `scripts/unknown-files-scan.mjs`, rules in `ops/known-files.json` | the checkout | **[the repository section](#the-repository-its-history-and-the-packages-built-from-it)**, first below |
| **the live server** | `scripts/live-files-scan.mjs`, run as the one-shot job `ops/live-files-scan.compose.json` | `/docker/sporta`, read-only | **below** |

---

# The repository, its history and the packages built from it

Tool: `scripts/unknown-files-scan.mjs` (`npm run audit:unknown-files`). Rules: `ops/known-files.json`. Proof: `npm run test:unknown-files -- --section repo`.
Read-only: it deletes nothing, moves nothing and rewrites no history. It writes only the `--json` / `--md` files it is told to, and, for `--package-build`, a scratch stage directory it is given (never the repo's `dist/` or `SPORTA-GO-LIVE.zip`).

```sh
cd sporta-web
npm run audit:unknown-files                      # the working tree: tracked, untracked, ignored
node scripts/unknown-files-scan.mjs --history     # + the whole git history (about 4 minutes on a quiet machine, 1.2 GiB pack)
node scripts/unknown-files-scan.mjs --package-build /tmp/stage   # + stage the web package in an EMPTY scratch dir, classify it, run file-audit.mjs on it
node scripts/unknown-files-scan.mjs --json out.json --md out.md  # machine- and human-readable results (deterministic: same tree, same bytes)
npm run test:unknown-files -- --section repo     # the proof (planted files, scratch history, fake package, real tree, mutations)
```

Exit code: `1` if there is an UNKNOWN file, a SUSPICIOUS file, a HIGH finding, or any other blocking finding the manifest has not tolerated; `0` otherwise; `2` for a usage error. Nothing is hidden by the manifest: a tolerated (`status: tolerated`) or documented-open (`status: open`) finding is still printed and counted.

## How a file becomes KNOWN, UNKNOWN or SUSPICIOUS

1. **KNOWN by rule.** `ops/known-files.json` holds ordered rules, first match wins: `glob -> purpose -> owner -> ships to web? -> refs required?`. Rules are narrow where files ship (`public/` is an explicit list of the 14 CSS and 9 JS add-ons the live `index.html` links, plus icons, fonts, hero and category art) and broad where the project owns the area (`src/`, `scripts/`, `ops/`). A rule also fixes the allowed file types: a `.exe` or `.phtml` in `scripts/` matches nothing.
2. **KNOWN by reference.** A file with no rule is still explained if another **code or config** file names it (package.json script, import, HTML/CSS reference, shell line). A file named only in documentation is reported as `named only in docs`. Scanner sources, audit suites and dated reports do not count as references (`refsource: false`): they name bad file names on purpose, and the first version of this tool explained a planted `shell.php` by the scanners that search for it.
3. **UNKNOWN** is neither. **Orphan** is the weaker case: a rule says what the file is (a script in `scripts/`) but nothing in the repo names it.
4. **SUSPICIOUS** is decided by content and path detectors, which run on every file whether a rule explains it or not: eval/assert/create_function/`preg_replace /e`, decode chains, process execution and request-fed include/write in PHP; `eval(atob())` and friends in web-served JS; long hex strings and `chr()` chains; high-entropy blobs; very long lines; PHP code inside images, fonts and archives; image/font names whose bytes are something else; PHP in `public/`, `cats/`, `images/`, `uploads/`; double extensions; key, env, `.htpasswd` files; private-key blocks and provider-format secrets; unquoted `KEY=value` lines; SQL dumps; archives (opened and listed); ELF/PE/Mach-O/SQLite/pyc binaries; hidden files; executable bits; symlinks; world-writable or setuid files; case and Unicode-normalisation collisions; names that are not valid UTF-8; files tracked although `.gitignore` forbids them.
5. **Reviewed hits** that are legitimate are in the manifest's `content_allow` with a reason and a maximum count (40 hits today: the scanners' own signature lists, one-line fixtures, one closure call in `admin.php`, the `stty` calls of the CLI password prompt, backup-tooling names). One more hit than the list allows is a finding again.

A secret is never printed: file, line, type and at most the first four characters plus its length. A private-key block prints only that one exists. Judging real against placeholder uses the documented placeholders, wording (`YOUR_`, `changeme`, `example`), entropy, the file's zone (tests, rigs and fixtures are `test`, not `real`) and shape (paths, regular expressions, CSS custom properties, email addresses and prose are not secrets).

## Result on `6f093332` (working tree)

| | |
|---|---|
| files scanned | 841 (tracked 836, untracked 2, ignored 3 files plus 2 folders counted once: `node_modules/`, `dist/`) |
| KNOWN by a manifest rule | 843 of 843 entries, 45 rules |
| KNOWN only by a reference | 0 |
| UNKNOWN | 0 at the end of the run |
| SUSPICIOUS files | 1: `brand/hero/__pycache__/grade.cpython-311.pyc` |
| findings | 0 high, 7 medium, 35 low; 40 reviewed hits tolerated |
| exit code | 1: the tracked `.pyc` is a documented-open item (REPO-SCAN secrets-5), so the run stays red until the owner removes it from git |

Files by area (rule family): SCRIPTS 288 (8.2 MiB), SRC 94 (0.8 MiB), PUBLIC 93 (2.5 MiB), BRAND 89 (10.6 MiB), DROPIN 77 (1.3 MiB), OPS 65 (0.9 MiB), LIVE 38 (0.1 MiB), WEB 35 (0.8 MiB), HTML5 23 (0.5 MiB), ROOT 21 (0.9 MiB), APP 14 (0.0 MiB), IGN 5 (0.0 MiB), ADDONS 1 (0.0 MiB).

**What was unknown while the scan ran.** Two files that no rule explained appeared during the work, both left by other sessions' running workflows, not committed: `sporta-web/out-run2.log` (output of the database column audit) and `sporta-web/package.json.tmp.106.c82b1108eb65` (an atomic-write temporary of `package.json`, gone seconds later). That is the tool doing its job; delete the log. The real-tree check of the suite fails for an unexplained TRACKED file and only prints a note for an untracked one, so a running session's scratch cannot turn the suite red.

### Findings in the working tree (everything above `low`, and the low ones that need a decision)

| id | sev | kind | where | evidence | who probably | action | conf |
|---|---|---|---|---|---|---|---|
| F-001 | medium | binary-or-archive | `SPORTA-BACKEND.zip` | zip archive, 699 kB | 8283d90d 2026-08-08 Claude: A small bundle for uploading just the backend panel | investigate; git rm --cached if it is a build output | high |
| F-002 | medium | stale-copy | `SPORTA-BACKEND.zip` | .gitignore forbids this path but it is tracked (the rule is not being applied) | 8283d90d 2026-08-08 Claude: A small bundle for uploading just the backend panel | git rm --cached in a normal commit | high |
| F-003 | medium | binary-or-archive | `brand/hero/__pycache__/grade.cpython-311.pyc` | Python bytecode, 2 kB | 90361d67 2026-08-03 Claude: Grade the hero: it was murky rather than dark, and t | investigate | high |
| F-004 | medium | other | `package:file-audit` | file-audit.mjs exits 1 on the staged package (3 high, 0 medium, 19 low), so make-package.mjs would refuse to write the zip and publish-ftps.mjs would refuse to upload: referenced file missing: /pages/Privacy.jsx referenced by: api/assistant.php referenced file | 9733d7f2 2026-07-25 Claude: Configure the site at runtime, and make the package  | remove the source-path strings from the shipped files named, or teach file-audit.mjs to ignore comments | high |
| F-005 | medium | stale-copy | `sporta-live/` | 20 add-on copies differ from sporta-web/public (1 identical, 14 have no twin); e.g. sporta-live/admin/sporta-admin-brands.js (4276 B) vs sporta-web/public/sporta-admin-brands.js (229026 B) | 05fbdd9b 2026-11-01 Claude: Record the live add-on manifest and block publish un | git rm the diverged copies in a normal commit, keep the unique sources, fix MANIFEST.md | high |
| F-006 | medium | other | `sporta-web/data/ahed.json` | supplier name, per-SKU wholesale costs and invoice totals in a public repository (with 13 supplier screenshots in brand/ahed-supplier/ and the seed's cost_aed): REPO-SCAN hygiene-1 | e13afffe 2026-07-30 Claude: AHED brand product detail, and the stock behind it | owner decides whether this data may stay public; history keeps it either way | high |
| F-007 | medium | secret | `test credentials in 9 file(s)` | 15 literal(s); the files also name an @sporta.com.kw address (REPO-SCAN secrets-7: confirm the live password for that address is different): sporta-web/scripts/abandoned-orders-test.mjs x1, sporta-web/scripts/knet-identifiers-test.mjs x1, sporta-web/scripts/li | f02f3fe6 2026-11-04 Claude: Abandoned orders list, backend (step 1): abandoned.p | keep; none may equal a live credential | medium |
| F-024 | low | other | `sporta-web/scripts/lib/sitemap.mjs` | a source/text file with raw NUL byte(s) (first at offset 1973): git treats it as binary and most scanners stop reading at it | f29c7bbd 2026-07-25 Claude: seo: sitemap index with honest, content-derived last | investigate | high |

Also reported, low: 27 scripts that a rule explains but nothing names (`server-perf.sh`, `sporta-mac-setup.sh`, `_r2quick.mjs`, `admin-alignment-scan.mjs`, `admin-mobile-scan.mjs`, `admin-safe-area-scan.mjs`, `cdn-browser-check.mjs`, `css-scan.mjs`, ... full list in the JSON; `_r2quick.mjs` is the scratch-looking one), 5 families of byte-identical copies (logos in `brand/`, `sporta-html5/`, `public/`; `sporta-live/` twins; the hand-over patches that repeat `ops/db/*.patch`), one tracked `.pyc`, and one source file with a raw NUL byte (`scripts/lib/sitemap.mjs` offset 1973: git treats it as binary and a scanner may stop reading there).

**Test credentials.** 26 literals in 16 files are judged `test`: `9` of those files also name an `@sporta.com.kw` address (REPO-SCAN secrets-7). The tool cannot know whether the live password for that address differs; that is a check for the owner, and the finding stays at medium until it is done.

## The side trees (what each is, who names it, how stale)

| tree | what | files | named by | against `sporta-web/public` | ships |
|---|---|---|---|---|---|
| `sporta-html5/` | no-build HTML5 fallback of the store (generated by build-html5.mjs) | 23 (0.5 MiB) | 6 code files, 2 docs | 3 identical, 7 differ | no: make-package.mjs and vps-deploy.mjs both leave it out |
| `sporta-app/` | Flutter app skeleton (cannot build: no assets, no platform folders) | 14 (0.0 MiB) | 1 code files, 1 docs | 0 identical, 0 differ | no |
| `sporta-live/` | copies of the live add-ons and server-only files, described by its MANIFEST.md | 38 (0.1 MiB) | 6 code files, 2 docs | 1 identical, 20 differ | no: nothing builds or deploys from it |
| `brand/` | brand masters and the generators that make shipped art | 89 (10.6 MiB) | 35 code files, 3 docs | 0 identical, 5 differ | no, by design (kept out of public/) |

`sporta-live/` is the stale one: MANIFEST.md still calls it the repo copy of the live add-ons, but 1 files equal `sporta-web/public/`, 20 differ (some by a factor of forty: `sporta-admin-brands.js` 4,276 B against 162,729 B), and 14 have no twin (htaccess redirects, php ini, re-encode script, tests, two SQL files: keep). Restoring from it would downgrade live add-ons. `sporta-html5/` and `sporta-app/` are dead weight that nothing ships; `brand/` is the masters folder and is correctly outside `public/`.

### SPORTA-BACKEND.zip

Tracked although `.gitignore` forbids it (REPO-SCAN secrets-2, still true). `116` members dated 2026-08-08 to 2026-08-09 (add-ons from August, API from before the VPS backend). No `config.php`, `.env`, key or credential-shaped member name, no secret or eval hit inside any text member. Against the tree: 9 members identical, 14 differ (e.g. `api/store.php` 59,942 B against 172,184 B), 91 have no counterpart (hashed `assets/`). It is stale, not dangerous: its README invites an upload over the live API. Fix: `git rm --cached SPORTA-BACKEND.zip` in a normal commit (the working copy stays; `npm run package:backend` regenerates it).

## The packages

`--package-build` runs `vite build --outDir <scratch>` (the vite config writes nowhere else), then the same copy steps `make-package.mjs`, `bundle-php.mjs` and `sw-precache.mjs` perform, repeats the one edit `csp-hashes.mjs` makes, and removes the forbidden files. The repo's `dist/` and `SPORTA-GO-LIVE.zip` are not touched. Staged tree at `6f093332`: **213 files, 4.6 MiB**.

- every file is explained: 213 known, **0 unknown**. By source: PKG-BACKEND-SOURCE 73, PKG-PUBLIC-SOURCE 93, PKG-README 2, PKG-SQL-NUMBERED 5, PKG-VITE-ASSETS 39, PKG-VITE-ENTRY 1. Backend files are matched to `dropin/php-store -> api`, `php-knet -> knet`, `php-cbk -> pay`; `config.php` is never mapped (bundle-php's skip list), so a staged `config.php` would be UNKNOWN and a credential finding.
- no webshell shape, no secret, no PHP in an image folder, no credential file in the package. The five setup tools are in it by design (`go-live.html`, `knet/selftest.php`, `knet/setup-config.php`, `api/setup-admin.php`, `api/preflight.php`); `file-audit.mjs` has no rule for them (REPO-SCAN hygiene-19) and the README-FIRST tells the owner to delete them. `vps-deploy.mjs` holds them back.
- every staged file that has a source in `public/` or `dropin/` is byte-identical to it, except the three the build rewrites on purpose (`index.html`, `sw.js`, `.htaccess`). The run also listed {len(P['differs'])} extra difference(s) ({', '.join('`'+x.split(' differs')[0].replace('public_html/','')+'`' for x in P['differs'])}): another session was editing that file while the build ran (the working tree is shared), which is a race with a running workflow, not a finding. Two earlier runs named other files for the same reason.
- **`file-audit.mjs` exits 1 on this package: 3 high, 0 medium, 19 low** (the same call `make-package.mjs` makes before it writes the zip, and `publish-ftps.mjs` before it uploads). The three HIGH are "referenced file missing" for source-path strings in comments of shipped files: `api/assistant.php:1088` (`src/pages/Privacy.jsx`), `public/birthday.js:235` (`src/lib/cart.jsx`), `public/sporta-admin-brands.js:1761` (`src/i18n/translations.js`). The audit reads `/pages/Privacy.jsx` out of `src/pages/Privacy.jsx`. Until the comments are reworded (or the audit learns to ignore a `src/` prefix) `npm run package` and `npm run publish` refuse; the VPS deploy path does not use this audit. The 19 low items are the 14 add-on CSS and 6 add-on JS files that this repo's `index.html` does not link (the live `index.html` does).

## The git history

3577 commits, 20821 blobs: 2.30 GiB raw, 1.26 GiB packed (`git count-objects -vH`: 1.24 GiB). HEAD is 835 files, 26.5 MiB. The scan read all 16390 text blobs once each (582.7 MiB, images, fonts, models and lock files skipped), the names of everything ever added, all 61 zips (opened, members listed and scanned) and every `.sql`.

### Secrets

No private-key block, AWS, GCP, Azure, GitHub, Stripe, Slack, Anthropic, OpenAI or ElevenLabs key, and no `config.php`, `.env`, key, certificate or database file was ever committed. Of the 3094 credential-shaped hits, 2650 are placeholders, 397 are test fixtures and **6 distinct values** needed a decision (below). Only two are secrets of this shop's world, and neither is in HEAD.

| value (masked) | type | first commit | where | verdict | action |
|---|---|---|---|---|---|
| `the-…(35)` (secret) | S-NAMED | `d63bd503` 2026-08-29 | `design/voice-agent/n8n-lead-webhook.sdk.js` | probable real: the shared secret of an n8n lead webhook in the deleted `design/voice-agent/` project, public since 2026-08-29 | **rotate** `x-lead-secret` on that n8n workflow if it still exists (cannot be tested from here); a history rewrite does not revoke it |
| `eyJh…(59)` (value) | S-JWT | `fb32fbe3` 2026-09-28 | `tests/run-net.mjs` | Supabase **anon** key (payload `role: anon`): public by design; the project is gone with Supabase | none; do not mistake it for a service key |
| `eyJh…(58)` (value) | S-JWT | `fb32fbe3` 2026-09-28 | `tests/run-journey.mjs` | Supabase **anon** key (payload `role: anon`): public by design; the project is gone with Supabase | none; do not mistake it for a service key |
| `a-lo…(46)` (TOKEN) | S-NAMED | `fb32fbe3` 2026-09-28 | `tests/api.test.mjs` | test fixture token (hyphenated words) in a deleted test | none |
| `ad…(9)` (password) | S-NAMED | `416b8c91` 2026-08-09 | `agent-system/server/seed.js` | demo seed passwords of `agent-system/`, another project | none for Sporta; weak by nature |
| `ag…(9)` (password) | S-NAMED | `416b8c91` 2026-08-09 | `agent-system/server/seed.js` | demo seed passwords of `agent-system/`, another project | none for Sporta; weak by nature |

**Correction (independent verification, 2026-11-04): the `the-…(35)` row is a false alarm.** The 35 characters are the self-describing placeholder `the-value-of-` followed by the n8n variable name `ALMUHALLAB_LEAD_SECRET` (checked by hash, value not printed); it sits in the trigger's pinned *sample output* (`output: [{ headers: { 'x-lead-secret': … }, body: { name: 'عميل تجريبي' … } }]`), and the gate itself reads `$vars.ALMUHALLAB_LEAD_SECRET`, as the commit message says. Nothing is to be rotated on its account, and the history holds **no** plausible live secret: a second, independent search (`git log --all -G` over eleven provider formats and `-----BEGIN`, 3583 commits) found no private key and no token, only code that builds PEMs, test fixtures and the scanner's own patterns. The scanner now classes such a literal as a placeholder (rule `J-VARNAME`).

Separately, `N8N-SECURITY.md` (HEAD) publishes four old n8n gate strings; they are prose, not assignments, so no pattern fires on them. REPO-SCAN secrets-1 covers them and the same advice applies: rotate, because redacting a doc does not remove them from history.

### Sensitive names ever added

`config.php`, `.env*`, `.htpasswd`, `.npmrc`, key, certificate, keystore and database file names: **none** ever added. Archives: 9 adds, listed below; `.sql`: 130 (44 still in HEAD; none is a data dump: one `-- phpMyAdmin` comment line in a deleted accounting schema was a false positive and the header pattern is now strict).

| archive (times added) | first | size | in HEAD |
|---|---|---|---|
| `SPORTA-HERO-PHOTOS.zip` (added 1x) | `f1bd800b` 2026-07-31 | 1.8 MiB | no |
| `SPORTA-BACKEND.zip` (added 1x) | `8283d90d` 2026-08-08 | 0.3 MiB | yes |
| `sporta-site/SPORTA-FULL-UPDATE.zip` (added 1x) | `94b6d8d6` 2026-09-02 | 2.7 MiB | no |
| `sporta-site/SPORTA-BACKEND.zip` (added 1x) | `d325e128` 2026-09-02 | 0.0 MiB | no |
| `sporta-site/SPORTA-ASSISTANT.zip` (added 1x) | `06629c7a` 2026-09-02 | 0.0 MiB | no |
| `scripts/fixtures/deploy-demo.zip` (added 1x) | `f5181362` 2026-09-11 | 0.0 MiB | no |
| `wain-1.1.0.zip` (added 8x) | `40378308` 2026-09-28 | 3.6 MiB | no |
| `wain-stg.zip` (added 1x) | `9f7ff4ec` 2026-10-02 | 4.4 MiB | no |
| `design/out/monogram-large.zip` (added 1x) | `cd9cffd4` 2026-10-07 | 1.1 MiB | no |

Of the 61 zip blobs opened, none holds a credential-shaped member name and none a secret in its text members. `wain-1.1.0.zip` alone is 48 versions and 194.9 MiB of release archives of another project.

### Why the pack is 1.24 GiB for a 27 MiB tree

20004 of 20821 blobs (1.25 GiB of 1.26 GiB packed) are not in HEAD. They are other projects that lived in this repository and were deleted: press renders, shots and logos, design screenshots and sample PDFs, 3D models, release zips. Every clone of a public repository downloads all of it.

| top-level path (no blob of it in HEAD) | blobs | raw | packed |
|---|---|---|---|
| `press/` | 1204 | 881.8 MiB | 762.9 MiB |
| `design/` | 2436 | 413.3 MiB | 246.9 MiB |
| `wain-1.1.0.zip` | 48 | 194.9 MiB | 57.3 MiB |
| `public/` | 314 | 98.5 MiB | 47.1 MiB |
| `sound-export/` | 76 | 22.4 MiB | 15.2 MiB |
| `docs/` | 247 | 16.5 MiB | 11.8 MiB |
| `unreal/` | 313 | 39.0 MiB | 7.6 MiB |
| `scripts/` | 2340 | 37.0 MiB | 7.0 MiB |
| `wain-stg.zip` | 2 | 8.7 MiB | 5.3 MiB |
| `assets/` | 53 | 4.4 MiB | 4.0 MiB |
| `src/` | 2523 | 148.2 MiB | 3.1 MiB |
| `flutter_app/` | 944 | 26.6 MiB | 1.8 MiB |
| `SPORTA-HERO-PHOTOS.zip` | 1 | 1.8 MiB | 1.8 MiB |
| `og/` | 52 | 1.7 MiB | 1.7 MiB |

Not proposed for removal, although no blob of them is in HEAD, because their files moved into `sporta-web/` (the shop's own earlier layout, history worth keeping): `public/` (47.1 MiB, 5% moved), `scripts/` (7.0 MiB, 2% moved).

Removing exactly those would take about 1151.1 MiB out of 1294.5 MiB packed; what stays is the history of the shop itself.

By type (packed): .png 861.3 MiB, .jpg 105.9 MiB, .glb 97.0 MiB, .zip 69.1 MiB, .pdf 51.5 MiB, .webp 32.6 MiB. Repeated binaries (path, versions, raw): `wain-1.1.0.zip` x48 194.9 MiB; `design/almuhallab-website-sample.pdf` x22 87.7 MiB; `design/nokha1-website-sample.pdf` x15 61.6 MiB; `unreal/Showcase/black-demon.glb` x4 36.0 MiB; `website/preview/mawsool-website-preview.pdf` x12 30.3 MiB.

The 40 largest blobs ever committed are in the JSON (`history.top_blobs`) with path and first commit; the biggest is `unreal/Showcase/black-demon.glb` (11.5 MiB); 21 of the 40 are `.glb` models, the rest film, PNG renders and release zips. 0 of the 40 are in HEAD.

**Correction (independent verification, 2026-11-04): these paths are not dead.** `git cat-file -e <branch>:<path>` shows `design/` (with `docs/` on nine of them, and the two wain zips on two) as the CURRENT content of 11 remote branches and `press/`, `unreal/`, `sound-export/`, `public/models` as the current content of `claude/tokyo-racer-kuwait-g8wgdu` and `claude/unity-render-glbs` (tips dated 2026-11-02/03, e.g. `claude/wainkw-design-issues-2bggdi` and `claude/tokyo-racer-kuwait-g8wgdu`). They are "not in HEAD" only because HEAD is the shop's branch. The shop's own branch (`claude/sporta-integration-tveo8b`, 640 commits) reaches 3512 blobs, 118 MiB raw, 67 MiB packed: **the 1.24 GiB belongs to the other branches.** The command below, run on a mirror, deletes those paths from the tip of every one of those branches. Do not run it; the sizes above are a reason to clone with `--single-branch` or to move those projects to their own repository first (Owner decisions 6).

### Cleanup proposal (NOT run; the owner's call)

```sh
git clone --mirror <repo-url> sporta-purge.git && cd sporta-purge.git        # a fresh mirror; never run filter-repo in the working clone
git filter-repo --analyze                                                  # writes .git/filter-repo/analysis/*.txt: check the sizes against this report
git filter-repo --path "press" --path "design" --path "wain-1.1.0.zip" --path "sound-export" --path "docs" --path "unreal" --path "wain-stg.zip" --path "public/models" --invert-paths    # drops paths that have no blob in HEAD and no file that moved into sporta-web/
git count-objects -vH && git gc --prune=now --aggressive                    # measure the new pack
git push --force --mirror <repo-url>                                        # only after the owner has read the blast radius below
```

Blast radius:
- Every commit from the oldest touched one onwards gets a new SHA, on every branch and tag (the 20+ claude/* branches included).
- CLAUDE.md, GO-LIVE.md and the deploy logs cite SHAs (baseline 1eb487aa, deploy-...-8bf6001): they stop resolving. vps-deploy.mjs "refuses older-code-over-newer" and fetches by SHA, so its baseline must be re-recorded.
- Every existing clone and fork keeps the old objects, GitHub keeps refs/pull/* and cached views until support runs a GC, and anyone who cloned already has the data. A rewrite shrinks FUTURE clones; it does not un-publish.
- It revokes nothing. A secret found in history stays valid until it is rotated at its provider; rotate first, rewrite second (or never).
- Cheaper alternatives that rewrite nothing: clone with `git clone --depth 1` (or `--filter=blob:none`) for work, and keep the history as the archive it is.

## Owner decisions, in order

1. ~~**Rotate** the `x-lead-secret` of the n8n lead webhook~~ (false alarm, see the correction under Secrets); **check in n8n** that the actions of `N8N-SECURITY.md` §"Do this first" (2026-08-06) were done: the four file/shell/SQL workflows archived, the FTP password rotated, the connectivity check deactivated; their gates are the words "change me" and the document itself says to treat them as public; confirm the live admin password differs from the one the suites use with `cs@sporta.com.kw`.
2. `git rm --cached SPORTA-BACKEND.zip brand/hero/__pycache__/grade.cpython-311.pyc` and add `__pycache__/` to `.gitignore` (normal commit; nothing else changes). Fix the fused `.gitignore` line `SPORTA-BACKEND-UPLOAD/ to recover a` at the same time.
3. Reword the three comments so `file-audit.mjs` passes again (`api/assistant.php:1088`, `public/birthday.js:235`, `public/sporta-admin-brands.js:1761`); the two JS files are live add-ons, so they ship with their next deploy, not on their own.
4. `sporta-live/`: `git rm` the 20 diverged add-on copies and the identical PHP duplicates, keep the 14 unique sources, make MANIFEST.md name `sporta-web/public/`.
5. Supplier cost data (`data/ahed.json`, `brand/ahed-supplier/`, the seed's `cost_aed`): decide whether it may stay public. History keeps it either way.
6. Whether to purge the history at all (above). **Corrected:** not with the command as written; it removes live content from 13 other remote branches. Cheapest: `git clone --single-branch --branch claude/sporta-integration-tveo8b <url>` (67 MiB packed) and `--depth 1` for CI-like work. If the repository must shrink, first copy those branches to their own repository, then delete them here.
7. Delete `sporta-web/out-run2.log`; look at the 27 orphan scripts (`_r2quick.mjs` first).

## Verifier's addendum (2026-11-04): what the first detector set let through, and what was added

An independent verifier planted 71 variants on paths a manifest rule already explains (so only content and name checks could catch them). The first set reported **24 of 71**; the set below reports **67 of 71**. The four that still slip: a Node script that posts `process.env` to a foreign host (scripts/ is not a shipped zone, so foreign hosts are not judged there), a pasted prose password, a passphrase of plain words (judged a placeholder by design), and one malformed provider token. Real-tree effect of all the additions: one new hit, `src/lib/bidi.js` (the bidi helper writes the control characters it strips as literals), allow-listed with its reason.

| detector | what it adds |
|---|---|
| `D-HT-HANDLER`, `D-HT-REDIRECT` | `.htaccess` and `*.ini` were never read: `AddType/AddHandler/SetHandler` for PHP, `auto_prepend_file`, redirects/proxies to a host that is not ours |
| `D-PHP-STREAM-INC`, `D-PHP-CALLBACK-REQ`, `D-PHP-EXTRACT-REQ`, `D-PHP-DROPPER`, `D-PHP-VARFUNC` (wider) | `include 'data:…'`/`php://input`, `array_map/usort/call_user_func/preg_replace_callback` fed by the request, `extract($_POST)`, request-reading PHP that writes a `.php`, `($_GET[a])($_GET[b])`, `$f(file_get_contents('php://input'))`, `$f(getallheaders()[…])` |
| `D-JS-DYNEXEC`, `D-JS-FOREIGN`, `D-BIDI-IN-SOURCE` | `setTimeout(atob(…))`, constructor chains, `import('data:…')`, computed `window['ev'+'al']`; script injected from, or beacon/fetch/Image to, a host not in `shipped_js_hosts`; U+202A–202E and zero-width characters in shipped source |
| `D-CONFIG-EXEC` | `package.json` install-time scripts (run by the `npm ci` that `vps-deploy.mjs` does) and URL dependencies, `.claude/settings.json` hooks, MCP servers not in `mcp_servers_ok`, `vercel.json` rewrites to foreign hosts, a VS Code task that runs on folder open |
| `D-SHELL-PIPE` (wider) | also `.mjs/.js/.cjs/.py` (the Claude settings allow `node scripts/*` unprompted), `sh -c "$(curl …)"`, `bash <(curl …)`, `exec(urllib…read())` |
| `D-NAME-ODD` (wider) | any non-ASCII character in a path (Cyrillic lookalikes, right-to-left override, zero-width space, decomposed accents); the repository has none |
| `D-POLYGLOT` (wider) | `<?=` followed by a backtick; a PHP tag in the last MiB of a file larger than the 6 MB the scan reads in full |
| `S-NPM`, `S-SENDGRID`, `S-TELEGRAM`, `S-DOSHOP` | four more token formats |
| judging | `J-VARNAME` (a literal that embeds a configuration-variable name is a placeholder); `J-TESTZONE` (a mixed-case alphanumeric literal of 20+ characters with entropy ≥ 4.0 in `scripts/` or `ops/` is "probable", not a waved-through "test credential") |

Proof: `node scripts/unknown-files-test.mjs --section verify` (57 checks: every added shape, three negative controls of ordinary code, no secret value in the output, and a mutation per detector and per judging rule).

## What only the live server (or another system) can show

The live half below is `scripts/live-files-scan.mjs` as the one-shot job `ops/live-files-scan.compose.json`; the connector was signed out for this scan, so none of these were measured:
- what is really in `/docker/sporta/site` and its neighbours: the backups folder inside the web root, config backup copies, a 0644 SQL dump, anything the old shared host or the foreign storefront build left (LIVE-SECURITY-SCAN-2026-11-03 lists the ones seen on 2026-11-03);
- whether the live `api/`, `knet/`, `pay/` bytes still equal the baseline commit named in CLAUDE.md;
- whether the n8n workflow that takes `x-lead-secret` still exists and what its secret is now; whether the old shared-hosting FTP password was rotated; whether the live admin password differs from the suites' (all need n8n / hPanel / the live admin);
- the GitHub side: forks, `refs/pull/*`, cached views, who cloned the 1.24 GiB history.

## Limits

- Patterns find shapes, not intent: a secret that matches no pattern and sits in prose or an image is not found; an image is only checked for decoy bytes and embedded PHP, not read.
- A reference is loose (a bare base name counts), the direction that errs towards KNOWN. The detectors, not the references, are the defence against a planted file.
- History: text blobs over 3 MB and the skipped types (images, models, audio, PDFs, lock files, maps) are not read for secrets; zips are opened up to 45 MB with members up to 8 MB. Unreachable objects of this checkout (the difference between the commit count above and `git rev-list --all`) are counted but are not part of what a clone downloads.
- The vite build is the checkout's own, so the staged bundle is only as current as the working tree; another session editing a file during the build shows up as a difference.
- Not checked here: the live server (the other half of this file), the GitHub-side copies (forks, `refs/pull/*`, caches), and whether any rotated-or-not secret is still valid.

## Proof

`npm run test:unknown-files -- --section repo`: **102 checks, 0 FAIL** (about six minutes on a loaded four-CPU machine; needs `git`, `tar`, `zip` and `php`). It builds a scratch git copy of the tree (`git archive HEAD`, so other sessions' uncommitted edits cannot move it) and checks:

- 57 planted files each give the finding they should (webshell-like PHP in `public/`, `eval(gzinflate(base64_decode()))`, `eval(atob())`, `.env`, a private-key file with a FAKE random key, `*.bak`, PHP in `cats/` and `images/`, `photo.jpg.php`, a JPEG carrying `<?php`, an executable bit, `Logo.png` beside `logo.png`, an unexplained binary and an ELF, a symlink, a hidden file, a SQL dump, a zip holding `config.php`, a non-UTF-8 name, secrets in source, an orphan script, a NUL byte, `curl | sh`, a `.png` that is PHP text ...), and nothing else is newly flagged;
- no planted secret value reaches the JSON or the Markdown; the scan changes nothing in the tree it scans (HEAD, refs, status, object count); two runs are byte-identical; exit 0 for a fully explained tree, 1 for one stray file, 2 for a missing manifest;
- history on a scratch repository: a committed-then-deleted `config.php` is found with its first commit and "not in HEAD", the largest blob is ranked first, a zip holding `api/config.php` is opened, a dump is named, the cleanup is proposed and not run;
- a fake staged package: unknown PHP, a forbidden `config.php`, an eval, real files matched to their source, `file-audit.mjs` refusing it;
- the real tree: every entry classified exactly once, no unexplained TRACKED file, no unexplained high finding, every blocking finding documented in `ops/known-files.json`, every non-optional rule still matches a file;
- **mutations**: 40 detectors are blinded in three groups with `UFS_BLIND`, and exactly the 53 checks that depend on them fail; an emptied manifest leaves 171 files UNKNOWN; five history gates are blinded one by one.

## Maintaining the manifest

Add a rule when a new kind of file belongs (glob, purpose, owner, `web`, `refs`). Do not widen a rule to silence a finding: a reviewed content hit goes in `content_allow` with a reason and a count, a decision the owner has made goes in `acknowledged` (`tolerated` stops it blocking, `open` keeps it blocking but documented). `optional: true` marks rules that may legitimately match nothing; the suite fails on any other rule that matches no file. `UFS_BLIND=<detector ids>` switches detectors off; only the suite uses it.

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
