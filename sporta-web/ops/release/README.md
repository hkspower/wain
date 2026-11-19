# The release gate (local; there is no CI)

One command runs what used to be done by hand for two days: lanes of `npm run test:*` suites against the sandbox rig,
a comparison with the known failures, flake reruns, and then the deploy readiness. It lives in `scripts/release-gate.mjs`
(pure rules in `scripts/lib/release-gate-core.mjs`, proved by `npm run test:release-gate`).

**It is not CI, and it never deploys.** CLAUDE.md (owner, saved for all time): nothing deploys from CI, there is no
`.github/` and none is to be created. The gate only RUNS TESTS and PRINTS the commands a person starts after saying
"deploy". It never starts `scripts/vps-deploy.mjs` (the gate's own suite asserts it, and asserts that the repo has no CI
config and no deploying git hook).

```
npm run gate                       the full gate: every measured suite, the rig made sure of first
npm run gate:quick                 the static and fast suites only (a few minutes, no rig)
npm run gate:check                 deploy readiness only (read-only)
node scripts/release-gate.mjs --only a,b          exactly those suites (names without "test:"; lane:<name> expands a lane)
node scripts/release-gate.mjs --changed           only suites whose trigger globs match the files changed since the baseline ref
node scripts/release-gate.mjs --list              the registry, what the options would run, and what is NOT in the gate
```

Options: `--quick`, `--only`, `--changed[=<ref>]`, `--since <ref>`, `--jobs N` (default 2; only parallel-safe suites, a
rig suite is ALWAYS alone), `--rerun-flakes N` (default 2 for browser suites, 1 for the others), `--include-unmeasured`,
`--json <file>`, `--no-sandbox`, `--list`, `--deploy-check`, `--help`. Output of each suite: `.gate/<UTC stamp>/<suite>.log`
(git-ignored), and `<suite>.rerunN.log` for reruns.

Exit code: `0` GATE GREEN (no REGRESSION), `1` at least one REGRESSION, `2` the gate itself could not run (bad option, the
rig would not come up: the sandbox script's own `!!` line is quoted), `3` `--deploy-check` alone and the tree is NOT ready.

## What a run does

1. Makes sure the rig is up when a selected suite needs it (database answers, the php test servers answer on the ports in
   `gate.config.json` -> `rig`); otherwise runs `npm run sandbox` (not with `--no-sandbox`: then rig suites are SKIPPED).
2. Runs each suite as `npm run test:<name>` with its own timeout (the process group is killed), clears the rig's
   `rate_limit` table before every rig suite, never two rig suites at once, parallel-safe suites in a pool of `--jobs`.
   Order: the pool first, then the serial lane, then the reruns, each alone.
3. Parses each result (exit code, the summary line, the `ok` / `FAIL` lines) and gives it a verdict:

| verdict | meaning |
|---|---|
| PASS | exit 0, no FAIL, ok count at least `minOk` |
| KNOWN | fails exactly as `known-failures.json` records (exit, text, at most that many failures, every failing line is a recorded check) |
| FLAKE | failed (a REGRESSION), then passed (or fell back to its recorded KNOWN failure) on the rerun |
| FIXED | a recorded known failure now passes: delete it from `known-failures.json` in the same commit |
| REGRESSION | a new failure, more failures than recorded, another failing check, an exit code with no FAIL line and no recorded reason, a timeout, or an ok count below `minOk` (checks disappeared) |
| SKIPPED | its environment is absent (the rig with `--no-sandbox`, or a file the registry `requires`); the reason is printed |

4. Prints one markdown table and a verdict line: `GATE GREEN: no regression` or `GATE RED: N regressions`, each
   regression with its FAIL lines quoted verbatim. Writes the JSON (`--json`).
5. After a GREEN run (or alone with `--deploy-check`) prints the deploy readiness, see below.

## The data files (this directory)

| file | what | who edits it |
|---|---|---|
| `gate.config.json` | the registry: every real `test:*` suite (needs, parallelSafe, timeoutSec, minOk, parse, quick, triggers), the lanes, the rig, and `not_in_gate` with the reason for each script that is not a gate suite (private databases, FTPS, live site, WIP) | whoever adds a `test:*` script |
| `known-failures.json` | suites that fail IDENTICALLY at the baseline and are not caused by recent work, with reason, since, evidence and `expect` | see the rule below |
| `live-baseline.json` | what is LIVE on the VPS, per area and per add-on file (commit, deploy name, date) | **the person who deploys, after every deploy** |

**The rule for `known-failures.json`:** it may only ever hide the failure it records. A known failure matches when the
exit code is the recorded one, the recorded text (a crash) is in the output, the failure count is at most the recorded
count AND every failing line contains one of the recorded names. A new, different or more numerous failure is a
REGRESSION. When a known failure is fixed the gate prints FIXED: remove its entry **in the same commit** as the fix. When
the owner accepts a NEW failure, add its entry in the commit that records the acceptance (with the evidence line).

A known failure also has to have RUN: an exit code with no FAIL line is a crash and is only KNOWN when the entry records its text
(`expect.contains`), and `expect.minOk` (the ok count of the baseline run) is the least number of passing checks a known-failing
suite may print: a suite that dies early after one FAIL line is a REGRESSION, not "fewer failures than recorded".

**READY needs a full gate.** Deploy readiness is READY only when (1) `npm run gate` ran EVERYTHING the registry measures (no
`--only`, `--quick` or `--changed`, nothing SKIPPED) and was green for exactly this HEAD (`.gate/last-full.json`, written by a
full green run; `--deploy-check` reads it), (2) the tree is clean, (3) HEAD is pushed, (4) HEAD's message is not a "do not
deploy" one, (5) every live-baseline commit exists in this clone and its diff could be read (a shallow clone is NOT READY, never
"nothing to deploy"). A partial run prints `PARTIAL: not a release gate`. The plan and apply commands are printed only when nothing
blocks. An empty selection prints `NOTHING WAS RUN` (exit 2, or 0 for `--changed`). Ctrl-C or kill stops every suite it started
(exit 130 / 143). `--changed` also selects the suites whose script IMPORTS a changed helper (`scripts/lib/release-gate-deps.mjs`).
The newest 10 run folders under `.gate/` are kept. The rig's database client must be the local socket (`MYSQL_HOST` set = exit 2).

**`minOk`** is the ok count seen on 2026-11-19 (or CLAUDE.md's figure). When a suite legitimately loses checks, lower it in
the same commit and say why; when it gains many, raise it (a drop is then caught). `0` = the suite prints no count (or is
a known failure). **`measured: false`** suites (57 old ones) have no baseline yet: they are skipped by default and run with
`--only <name>` or `--include-unmeasured`; after the first green run the gate says `unmeasured: record minOk N`: put N in
the registry, set `parallelSafe`/`timeoutSec` from the measured seconds, and delete `measured`.

**`triggers`** (for `--changed`) are globs relative to `sporta-web/`; `@name` expands a group of the registry. Every
suite's own script, and the `globalTriggers` (shared libraries, fixtures, `package.json`, the registry itself, SQL and the
sandbox script for the rig suites), also count. `--changed` errs on running MORE: an untracked or uncommitted file counts.

**`live-baseline.json`** is DATA THE PERSON UPDATES after each deploy (`ref`, per-file `ref`, deploy name and date, in the
commit that records the deploy, together with the "Deployed ..." paragraph of CLAUDE.md). The gate reads `ref` for
`--changed` (the oldest live commit, so it errs on running more) and the per-area / per-file refs for the readiness diff.
The 2026-11-19 reading, stated: `dropin/php-store` is `eb97a4bd` except `admin.php` (`269a3737`); the add-ons are the
commits of the "Deployed 2026-11-19 09:21" (`88bccf54`: features.js, images.css, product-fix.css, shadows.css),
"05:33" (`bfa628e1`: ui-colours.css, home-trim.css), "2026-11-18 16:41" (`3aa05cc2`: the admin loader), "14:57"
(`21516fa6`: brand-theme, bag-touch, checkout-a11y.css, cart-drawer, grid), `eb97a4bd` (sporta-catalogue.js) and
`269a3737` (sporta-admin-brands.full.js); `sporta-checkout-a11y.js`, `sporta-footer-call.js`, `sporta-gov-autopick.js`
carry the commit of their own deploy; every add-on not listed falls back to the 2026-11-18 13:05 full release
(`e7db9143`) and may be a stale reading: the plan's "live bytes" line is the real check, not this file. `knet/` and `pay/`
were last copied from `e7db9143`.

## Deploy readiness (printed, never executed)

Printed at the end of a green run, or alone with `npm run gate:check`:

- the working tree is clean; the branch is pushed and `HEAD` equals `origin/<branch>` (as of the last fetch: no network);
- `HEAD`'s commit message does not say "NOT READY" or "do not deploy" (CLAUDE.md: such a commit is never shipped);
- what the release contains: `git diff` from the live baseline refs, mapped to the `--only` scopes of `vps-deploy.mjs`:
  `dropin/php-store` -> `api`, `dropin/php-knet` -> `knet`, `dropin/php-cbk` -> `pay`, `public/.htaccess` -> `.htaccess`,
  an add-on of `public/` -> its file name (the admin add-on as the pair `sporta-admin-brands.js,sporta-admin-brands.full.js`);
  `index.html`, the hashed assets, `sw.js`, sitemaps, `robots.txt`, `llms.txt`, manifests, `src/` and tooling never ship;
- what needs the owner's attention: a backend change (independent review SHIP + the live schema diff), the money path, a
  new or changed migration file (a deploy copies no SQL), a cron file (live within 15 minutes), a `.htaccess` that must ship
  with its PHP, the admin loader pair and the shrink guard that does not cover JS, config keys read by added PHP lines;
- the commands, built from what `scripts/vps-deploy.mjs` really accepts (it checks the flags in the script; if one is
  gone it prints the script's own usage line and no command): the read-only
  `node scripts/vps-deploy.mjs compose --ref <HEAD> --only <scopes>` (plan), the apply template with the SHA twice
  (`--apply --ref <sha> --confirm <sha> --only <scopes>`, `--allow-shrink` only when a shrink is intended), the reminder to
  read the plan's "live bytes -> release bytes" line, that success is the job log saying `DEPLOY_OK`, and to update
  `live-baseline.json` afterwards.

Deploying stays the owner's explicit "deploy", started by a person through the Hostinger connector, plan first.
