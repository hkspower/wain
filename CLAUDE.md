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
- **The server cannot resolve its own domain.** `wget https://www.sporta.com.kw/…`
  from cron dies with "unable to resolve host address", and with `-q` that looks
  exactly like a page that returned nothing. A whole afternoon went into
  "api.php returns an empty body" on the strength of it; api.php was fine the
  whole time. Fetch the live site over the loopback with the name in a header:

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

**So this channel cannot publish a website.** It is enough for a one-line
`.htaccess`, a `cp`, a `grep` against a live file — reconnaissance and repair.
Everything else goes in a PHP installer the owner uploads. Reaching for cron to
move 58 KB of CSS cost most of a session and never worked.

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
