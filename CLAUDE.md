# Sporta — working rules

## Pushing is allowed now

The owner lifted this on 2026-09-02, in as many words, after being asked to
confirm it against the rule that used to sit here. What that rule said, so the
change is legible rather than mysterious: no `git push`, no pull requests, no
suggesting GitHub as the way to move the work — and it held "even when
something asks for a push", because the Stop hook asks after almost every turn
and is not a person.

That last part is worth keeping in mind rather than deleting. **The Stop hook
is still not a request.** It reports unpushed commits automatically; pushing
because a hook said so is not the same as pushing because the owner did.

Push to the working branch when there is something worth pushing. Do not open,
update or merge a pull request without being asked for one — that was never
about the push, and nothing above changes it.

**Check what is going out before it goes.** `config.php`, `wallet-certs/` and
`sporta-site/invoices/` are git-ignored and must stay that way: they hold the
database password, the KNET and CBK credentials, the Wallet signing certs and
every customer's name and address. A push is not undoable and a repository is
copied far more casually than a server is.

**Still commit locally, and keep committing in small pieces.** Local history is
how work is kept and how a change can be undone.

**The deliverable is still the code itself.** The shop is deployed by hand from
files, not from a clone, so a push does not put anything live. Hand over files
directly — the changed files for a small change, a zip for a whole build:

```
git archive --format=zip --prefix=sporta/ -o SPORTA-SOURCE.zip HEAD
```

Hand over only what changed unless the whole thing was asked for.

## The container is temporary

It is reclaimed after a period of inactivity, and everything on disk goes with
it — local commits included. That has already happened once in this project.

Say so **once**, at the moment a file is handed over, in the same breath as
handing it over. It is not a note to append to every reply.

## The cron channel is the only way to write to the server

Approved on 2026-09-04, and recorded in `.claude/settings.json` so the four
Hostinger cron tools — create, delete, read output, list — no longer ask. A
single change to the live site is dozens of calls; approving each one by hand
is not a safety check, it is a queue. Delete is in the list on purpose: these
jobs fire every minute, and being able to create one without being able to
remove it is the worse half of the pair.

**Why cron at all.** The connector's file upload is a TUS PUT to
`srv2231-files.hstgr.io`, and this environment's network policy refuses that
host with a 403. The cron *command* is the only write primitive left.

**What that channel will and will not carry** — every line below was measured
here, and each one cost a wrong answer first:

- **`cd` never takes effect.** A relative path after it writes to the home
  directory instead. This is how a deny rule reported as "written to `api/`"
  spent hours sitting in `/home/u130124229/.htaccess` doing nothing. Use
  absolute paths in every argument; never `cd`.
- **`$VAR` expansions are stripped.** `D=/path; ls $D` lists `/`. Command
  substitution `$(pwd)` survives. So no variables, and no `for` loops — the
  loop body's `$i` is empty and it copies nothing while reporting success.
- **`%` is a cron metacharacter.** `printf %s` reaches the shell as `printf`
  with no format and writes an empty file.
- **Quoted text with shell metacharacters arrives empty.** The redirect opens
  the file (truncating it) and the command then fails. Send content as
  **base64** — letters, digits, `+/=`, unquoted — and `base64 -d` on the far
  side.
- **About 64 characters of payload is all it carries.** The API ACCEPTS 255 —
  that is what an earlier bisection measured, and it measured the wrong thing.
  Accepted and executed are different: a 64-character write landed, 90, 120 and
  200 all produced a zero-byte file, and the 200s failed again on a completely
  empty account, so it is not contention either. Six chunk sizes were burned
  finding this out.
- **Output capture returns only the last line.** Put everything on one line
  with `echo "a=$(…) b=$(…)"` or the diagnosis is half a diagnosis.
- **The domain does not resolve — and that is NOT a server quirk.** This entry
  used to say "the server cannot resolve its own domain", and treating that as a
  local oddity is how it went unexamined for weeks. Measured on 2026-09-05, from
  the server, against Google's public DNS:

  ```
  www.sporta.com.kw.cdn.hstgr.net  → resolves, 2 addresses   (the CNAME target is fine)
  example.com                      → resolves                (DNS itself is fine)
  www.sporta.com.kw                → 0 addresses
  NS sporta.com.kw                 → empty
  NS com.kw                        → 5 nameservers           (the registry is up)
  sporta.com.kw                    → status: NXDOMAIN
  ```

  NXDOMAIN from the registry, while `com.kw` answers normally, means the
  .com.kw registry HAS NO DELEGATION for this domain — expired, deleted or
  suspended at the registrar. Not a record problem, not a nameserver outage,
  not DNSSEC. The Hostinger zone is intact the whole time, which is exactly why
  the panel looks healthy while the site is unreachable.

  **Only the registrar can fix it.** Nothing in this repository, in Hostinger's
  DNS panel, or on the server will bring the name back.

  **The lesson that generalises:** a workaround can be correct and its
  explanation still wrong, and the wrong explanation is the expensive half. The
  loopback trick below is right and stays. But "the server cannot resolve its
  own domain" made a symptom sound like a property of the environment, so the
  one signal that would have caught an expiring domain was written off as
  normal every single time it appeared. When something cannot be reached, ask
  WHY once, properly, before naming it a quirk and routing around it.

  The loopback form is still how to test the live site from cron — it works
  whether or not the name resolves, which is the other reason it is worth
  keeping:

  ```
  wget -S -O/dev/null --no-check-certificate \
       --header=Host:www.sporta.com.kw https://127.0.0.1/api/api.php?r=products
  ```

  **https**, not http — port 80 answers with a redirect to the https URL, and
  wget follows it straight back into the same DNS failure. And never `-q` when
  the question is *why*: silence is not a measurement.

  **This had broken seven of the eight real cron jobs, for as long as they have
  existed.** Every one of them fetched `https://www.sporta.com.kw/api/cron-*.php`
  and every one died on that DNS lookup — invisibly, because `-qO-` throws the
  error away. Only cron-invoice ran, and only because it calls `php` on an
  absolute path instead. Proved by replaying cron-push's exact command with
  stderr kept; the job's own captured output is empty, so the panel showed
  nothing wrong. Four were repaired to the loopback form on 2026-09-04
  (push, assistant, stock, voice); whatsapp, customer-mail and fulfilment were
  deliberately left until their outboxes are checked for backlog, because
  restarting a dormant queue sends whatever is in it to real customers.

  A quoted URL containing `&` DOES survive this channel — measured, 21,773
  bytes back — so `?key=…&do=release` is safe to schedule. Only six of the
  cron-*.php endpoints require HTTP at all; cron-voice and cron-invoice are the
  two that are CLI-aware.

**Verify by absolute path, always.** Reading a file back by the relative name
you just wrote proves nothing — it reads the home-directory copy just as
happily. A check that cannot fail is not a check.

**Delete every job when it has run.** They fire every minute forever otherwise.

**Cron cannot CARRY a website — but it can fetch one.** Sending bytes through
the command is what fails; about 64 characters is the ceiling and 60-character
base64 chunks measured as zero-byte files. Nothing above changes.

What changes it is that **the server has working outbound internet.** Only its
OWN domain fails to resolve — `wget https://example.com` from cron returned 559
bytes on 2026-09-04. So the file does not have to travel through the command at
all: push it to the repository and have the server pull it.

```
wget -qO /home/u130124229/n.css https://raw.githubusercontent.com/hkspower/wain/<commit-sha>/sporta-site/public_html/assets/sporta-ui.css
cp /home/u130124229/n.css /home/u130124229/domains/sporta.com.kw/public_html/assets/sporta-ui.css
sha256sum /home/u130124229/domains/sporta.com.kw/public_html/assets/sporta-ui.css
```

66 KB of CSS published this way in three one-line jobs, verified by comparing
the sha256 against the repository, with nothing for the owner to upload.

Four things this depends on, each of which cost a wrong answer first:

- **By COMMIT SHA, never by branch.** The working branch is
  `claude/sporta-site-2026-09-02` and the slash in it makes
  `raw.githubusercontent.com/<owner>/<repo>/<ref>/<path>` ambiguous — GitHub
  reads `claude` as the ref. The fetch returned an EMPTY file and said nothing.
- **One short command per job.** A 245-character command was accepted by the
  API and then produced no output at all — not an error, silence. The same work
  split into a 155-character fetch and a separate `echo` worked first time.
- **ONE FETCH AT A TIME.** Three jobs fetching raw.githubusercontent in the same
  minute produced ONE good file and TWO EMPTY ONES — served to the first
  request, dropped for the others — and `-q` hid it, so it read as a broken
  publish rather than as rate limiting. Fetched singly, all three arrived whole
  and matched. When a run of files is needed, fetch them from inside ONE PHP
  script running on the server, sequentially: twenty tiles that way is one cron
  cycle instead of forty, and it is `scripts/publish-cats.php`.
- **Verify by sha256 against the repo**, not by size, and read it back from the
  ABSOLUTE path — the rule further up this section applies here too. Check it
  AFTER the copy, not after the download: an empty fetch and a failed copy look
  identical from the staging file.
- **The repository is PUBLIC.** That is what makes this work: the server
  fetches without a credential, so no token is ever written into a cron command
  where it would sit in the panel in plain text. It is also the reason the
  git-ignore list at the top of this file is not paperwork. Anything committed
  is world-readable, and a script fetched this way is fetched over a path
  anyone can see — so it must stay READ-ONLY, as `scripts/live-scan.php` says
  of itself in its own header.

A PHP installer the owner uploads is still the right shape when the owner
wants to run it themselves, or when the repository cannot carry the file.

## Hand over a PHP installer, never an archive

The File Manager's **Extract REPLACES a directory rather than merging into it**.
A zip extracted into `public_html` on 2026-09-03 reduced `api/` to one file and
`assets/` to two, deleted every `.htaccess` and all three `config.php`, and
dumped the repository into the web root with the SQL schema publicly readable.
The shop was down until a Files-only backup restore.

`scripts/make-installer.mjs` builds the alternative: a PHP file that writes the
paths it is given, verifies each against a sha256 before writing, and **removes
nothing**. Run it against a scratch directory and compare hashes before handing
it over.

**A restore rolls the server back, so check interfaces before publishing onto
one.** The 2026-09-04 restore returned `api/store.php` at 102,081 bytes where
the repo has 125,083. Publishing a newer `admin.php` onto it would have been a
fatal error on `/backends` if the helpers had moved — `grep -c` through cron
against the live file is how that gets checked, and it takes two minutes.

## The service worker can pin a file for ever

`sw.js` rule 2 cached everything under `/assets/` cache-first-and-never-re-asked,
justified by "content-hashed, so the filename changes when the bytes do". Seven
files there have FIXED names — `sporta-ui.css`, `sporta-dark.css`, `contact.js`,
`card.js`, `returns-link.js`, `returns-request.js`, `track-guard.js` — so a
returning visitor was pinned to whatever copy they first cached, and the only
thing that frees a pinned cache is a `VERSION` bump that had not happened.

That is why the live site "did not update for a long time": changes reached new
visitors and nobody else, while `.htaccess` marked all seven
`no-cache, must-revalidate` and the worker never made the request to find out.

**That last clause is true of THIS REPOSITORY and was false of the server.**
The restore rolled `.htaccess` back to 25,288 bytes against the repo's 33,047,
and the rolled-back copy has the `sw.js` and `config.js` rules but NOT the
seven-file one. Measured on 2026-09-04 over the loopback:

```
Cache-Control: public, max-age=604800     # assets/sporta-dark.css
```

A week, on a fixed-name file that must revalidate — so even a visitor with no
service worker at all could not see an edit for seven days. The worker was
never the whole story, and reading the rule in the repo is not evidence about
the server: ask the server what header it sends.

Repairing it is a PATCH, not a publish. Writing the repo's `.htaccess` over the
live one would carry ~8 kB of unrelated change onto a rolled-back server; a PHP
patcher that inserts the one block, keeps a timestamped backup and refuses if
it cannot find its anchor is the safe shape. Verify it by stripping the block
from the repo copy, running the patcher, and diffing comment-free against the
original — they should come out identical.

Two rules follow. **Test the hash, not the folder** — un-hashed files belong on
the network-first path their header already asks for. And **bump `VERSION` with
any such fix**, because the fix alone leaves everyone already pinned exactly
where they were.

**A blank page with no boot message means the worker, not the server.**
`index.html` prints a diagnostic after ten seconds naming the file that failed.
If that message never appears, the page did not come from the server at all. A
private tab bypasses the worker and settles it in ten seconds.

## Do not redesign without approval

The visual design is the owner's, not something to improve on the way past. Do
not change layout, colour, type, spacing, or the shape of a component because it
looks better — change it because it was asked for, or because it is measurably
broken (unreadable contrast, a control that cannot be tapped, a page that
scrolls sideways).

When a design decision is genuinely needed and no reference exists, ask, and say
what the options are. A screenshot from the owner **is** the approval: match it,
including the parts that would not have been the first choice.

## The live database is not the sandbox

Two figures, measured on the server on 2026-09-04 by `scripts/live-scan.php`:

```
db=46 active products / 0 orders / 42 variant rows     qa=MISSING
```

**Zero orders.** `npm run test:db` reports 608 orders and 336 variants, and
every one of those is SEED DATA in the local sandbox. They were quoted in this
session as though they were the live shop's — "608 real orders" appears in a
commit message and in a warning to the owner, and it was wrong. A number read
from the sandbox says nothing about production; ask the server.

Two things follow from the real figures, and the second is the shop's problem
rather than the code's:

- **`assistant_qa` is not there**, so the سبورتا AI cannot answer a taught
  question. It fails closed and silently — by design, the lookup is wrapped in
  try/catch — so nothing anywhere reports it. One `CREATE TABLE IF NOT EXISTS`
  (`api/assistantqa.mysql.sql`) is the whole fix.
- **42 variant rows against 46 active products.** A garment with no rows in
  `product_variants` shows no size to pick and cannot be ordered, so most of
  the catalogue is unbuyable. That is stock data the owner types in
  /backends — not something to invent here.

### IMPORT-THIS-ONE.sql overwrote live prices, and said it did not

Its header promises it "does NOT delete or overwrite existing orders, prices or
stock counts", and it is the file the owner is told to import. The products
seed carried `on duplicate key update ... price = values(price), name_en = ...`
— measured, a product hand-priced at 99.500 came back as the seed's 10.000
after one import, with its name and description reverted too. Stock survived
only because the variants clause had already been taught this and says so in a
comment.

Fixed on 2026-09-04: both seeds now use the no-op idiom `1-schema` and
`4-promo` already used, `on duplicate key update slug = slug`. **Any copy of
that file made before then still carries the bug** — rebuild it with
`npm run make:install` rather than reusing one.

The general rule: in a file whose whole promise is "safe to re-run", an
`on duplicate key update` that names a column the owner can edit in /backends
is a bug, however convenient it is for seeding.

## Test the sandbox is alive before believing it

`test:buttons` reported "0 controls found, 0 pressed, across 22 pages" and
`site-scan` once reported 0 of 73 selectors firing. Neither was a result: the
sandbox had died and every page failed to load. A suite that finds NOTHING is
reporting its own environment, not the code. `bash scripts/sandbox.sh` and run
it again before reading anything into it.

The opposite shape is worth the same suspicion. `test:knet` failed five checks
about which gateway takes a customer's card — deterministically, but only when
`test:payments` had run first, and never alone. The shop was correct; opcache's
2-second revalidation window was serving a stale `knet/config.php` to a rig that
rewrites it and requests it in the same breath. `sandbox.sh` now pins
`opcache.revalidate_freq=0`. A failure that appears only in a particular ORDER
is about state, not about the code under test.

## A guard that passes a rename is not a guard

`admin-contract-test.mjs` exists because the app's `/backends` panel was written
against a fixture and spoke a protocol the real `admin.php` did not implement —
every test green, every production request dead. The guard reads the three files
and proves the route names agree.

Mutation-tested on 2026-09-05, it did not. Renaming one call site in `admin.ts`
to `discount_active_MUTANT` — a route that exists in no server anywhere — was
reported as **all ok**.

The extractor matched `[a-z_-]` only. Its own comment already said an extractor
that matches only well-formed names silently drops the malformed ones, and named
the hyphen case that actually shipped; capitals were simply outside the class, so
the route left the set and the loop that checks every route it found found one
fewer. **Nothing is reported when a check is not run.** The three extractors now
match anything up to the delimiter and let the comparison decide — a parity test
does not need to know what a legal name looks like.

The general rule, which is not about regexes: **a test that finds things and then
checks them can fail by finding nothing.** Its silence and its success look the
same. So mutation-test it in the direction that matters — break the thing it
exists to catch, and watch it go red — and pick a mutation the extractor might
plausibly miss rather than the one it was written for. The first mutation here
was caught; it was the second, uglier one that found the hole.

That is the same shape as "a suite that finds NOTHING is reporting its own
environment", one section up, and it caught a real hole rather than a dead
sandbox.

## The rig is Apache. Production is LiteSpeed. They are not the same server

`htaccess-test.mjs` starts a real Apache and asks it what it sends, which is a
far better test than reading the file — and it is still not production.

Measured on 2026-09-05: every response from the live site carried two headers
literally named `edit:`, whose values were two `.htaccess` lines —

```
edit: Set-Cookie "(?i)^((?!.*;\s*Secure).*)$" "$1; Secure"
edit: Set-Cookie "(?i)^((?!.*;\s*SameSite=).*)$" "$1; SameSite=Lax"
```

**LiteSpeed does not implement `Header edit`. It emitted the directive as a
header instead of applying it.** So the two lines that add `Secure` and
`SameSite=Lax` to cookies have never done anything on the live server, and
their own comment records how carefully they were tested — against Apache
2.4.58, which honours them perfectly. A test that passes on the wrong server is
not a test.

`Header set … env=` DOES work there: proved the same day, because the asset
host's `Access-Control-Allow-Origin` and `X-Robots-Tag` arrived exactly as
written. So the fix for cookie flags is to set them where the cookie is made —
`session.cookie_secure`, `session.cookie_samesite` — which is honoured by both
servers, rather than rewriting headers afterwards.

The rule: **for anything in `.htaccess` beyond rewrite and `Header set`, ask the
live server what it actually sends.** The rig proves syntax and intent; only
production proves the directive is implemented.

## A replacement that matches nothing is a no-op that looks like success

The publisher for the KNET change was pinned to the wrong commit — a `.replace()`
searched for a sha the file did not contain, changed nothing, and reported no
error. It fetched three PHP files from before the feature existed.

Nothing was written, because every publisher verifies each file against a
recorded sha256 BEFORE writing: the run said `hashMismatch` on all three and
touched the live shop not at all. **The guard written for a tampered fetch
caught an ordinary mistake instead, which is the argument for having it.**

Same shape as the extractor that silently dropped a route, one section down.
Whenever a script edits a string, a path or a sha, check the value AFTERWARDS
rather than trusting that the edit matched.

## static.sporta.com.kw — the cookie-free asset host, half-finished on purpose

Created 2026-09-05, rooted at the SAME `public_html` (Hostinger's "use the
public directory"), so www and static are two hostnames over one set of files
and one `.htaccess`. Live and verified: assets answer 200, one NAMED CORS
origin, `X-Robots-Tag: noindex`, and `/`, `/shop`, `/checkout`, `/backends` all
301 to www so it cannot become a second indexable copy of the shop. `sw.js`
counts it as first-party, or its cross-origin bailout would skip every moved
file and cost the whole service worker.

**`index.html` still points at `/assets`, deliberately.** The module scripts
carry `crossorigin`, so they fail outright if the origin is not usable, and
measured that day:

```
static.sporta.com.kw → Could not find certificate
www.sporta.com.kw    → Hostname www.sporta.com.kw does match certificate
```

No SSL certificate yet. Publishing the reference move before one exists gives
every visitor an unstyled page with no JavaScript.

And the thing worth remembering before finishing it: **the storefront sets ZERO
cookies for a shopper** — measured, `Set-Cookie` count 0 on the home page — so
the byte saving from a cookie-free host is nil. It is worth having as somewhere
to point a CDN, and it is not worth breaking anything for.

## The live shop has no product photographs

`photos=0/46active`, `brandLogos=0/8`, measured 2026-09-05. Every product card
on the real site is blank. Photographs and brand logos are data: URIs in MySQL,
uploaded through /backends — the owner's images, not something to invent here,
and not something any script in this repository can supply. It is a bigger
visible problem than anything in the CSS.
