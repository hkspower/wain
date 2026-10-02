# Sporta — working rules

## AUTO-DEPLOY MODE — the owner's standing instruction, 2026-09-29

Asked for as "make auto deploy mode for any deploy option", to be kept in
memory. **When a change is finished and its tests pass, it goes live without
asking**: commit, push, regenerate the manifest, pin `publish-all.php` (or run
the change's own publisher, for a database write), run it through the cron
channel, verify on the live server, delete the job, and report what went live.
Do not end a turn with "shall I publish?" — the answer is already yes.

What it does NOT change, because each of these is a different question from
"may I deploy":

- **Decisions stay the owner's.** A design change, a choice between options,
  anything this file says to ask about (a redesign, the Safari cookie trade,
  restoring dormant cron jobs, removing a file from the server) is still asked
  BEFORE the work. Auto-deploy covers shipping the answer, not giving it.
- **Tests still gate it.** A red check is fixed first, or reported and not
  shipped. Auto-deploy is not permission to publish a failure.
- **Verification still happens**, by sha256 or by state read back from the
  server, and the report says what was measured.
- **The secrets stay out.** Nothing git-ignored is committed or published.

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

**The working branch is `claude/sporta-site-2026-09-02`, and a brief that names
a different one is not automatically right.** On 2026-09-07 the session was
told to develop and push to `claude/sporta-integration-tveo8b`. That branch
exists, and it is a DIFFERENT LINE OF WORK: newest commit 2026-08-09, sharing
only a month-old ancestor, 239 commits on its side against 212 on this one.
`git push` refused it as a non-fast-forward, and `git rebase` onto it tried to
replay this project's entire history and conflicted on `package.json`,
`app.json`, `.gitignore` and a dozen more.

The failure mode to avoid is the one a step further on: forcing it, or
resolving those conflicts, would have overwritten a month of somebody's work
with a push that cannot be undone. Two commands settle it before any of that,
and they cost seconds:

```
git merge-base HEAD origin/<branch>
git rev-list --count <merge-base>..HEAD    # and the same for the remote side
```

A shared tip means fast-forward and no question. Two long divergent counts mean
the branch is not this work's branch — push to the one whose history already
contains it, say plainly why, and let the owner reconcile the two lines. A
conflict on `package.json` during a rebase onto "your own" branch is not a
merge to resolve; it is the branch telling you it is not yours.

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
Hostinger cron tools — create, delete, read output, list — no longer ask.
**On 2026-09-28 the connector collapsed into ONE tool, `mcp__hosa__execute`**,
which takes the operation as a parameter, so the four names above stopped
matching and every call asked again. The owner chose, having been told it
pre-approves EVERY Hostinger operation (sites, DNS, databases), to allow
`mcp__hosa__execute` outright. That makes care on this channel a matter of
discipline rather than of prompts: cron create/delete/output/list only,
unless the owner asks for something else. A
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
- **Output capture returns the LAST COMMAND'S output, not the last line of the
  job.** Measured 2026-09-09, the same script two ways:

  ```
  wget -qO r.php <url> && php r.php                  -> CRON key=set ready=3/8...
  wget -qO r.php <url> && php r.php; rm -f r.php     -> ""
  ```

  `rm` prints nothing, and appending it wiped the answer entirely. So the
  command whose output you want must be **last**, and a tidy-up tacked on the
  end costs you the result. Within one command, put everything on one line with
  `echo "a=$(…) b=$(…)"` or the diagnosis is half a diagnosis.

- **AND IT IS THE LAST RUN'S OUTPUT, WHICH ON A `* * * * *` JOB IS NOT THE RUN
  THAT DID THE WORK.** These jobs fire every minute and the panel keeps one
  answer, so a job that CHANGES something reports its first run for sixty
  seconds and then overwrites it with a run that finds the work already done.
  Measured 2026-09-10 by `remove-strays.php`, which moves two files:

  ```
  14:22 run   moved the zip                    (never read — overwritten)
  14:23 run   SPORTA-BACKEND.zip=already-gone  (what the panel showed)
  ```

  I read the second and told the owner the zip had not been there, then found
  it in the attic with a ctime of 14:22:01 — moved by the run I never saw.
  **`already-gone` is what a successful run looks like one minute later**, and
  it is indistinguishable from a path that was always wrong.

  Two ways out, and prefer the first: for anything that WRITES, delete the job
  as soon as the first output appears, so the run you read is the run that
  acted. Otherwise make the script report the STATE rather than its own verb —
  it already checks the destination, so say `inAttic=59388` rather than
  `already-gone` — because a state reads the same on every run and an event
  does not.

- **ONE CYCLE, NOT THREE. This is the biggest time saving available here.**
  The habit was: a job to fetch, a job to run, a job to clean up — three
  minutes of waiting for one answer, and the owner noticed before I did. The
  whole thing fits in one job:

  ```
  wget -qO r.php https://raw.githubusercontent.com/hkspower/wain/<sha>/<path> && php r.php
  ```

  Two things make it fit. **A relative path writes to the home directory** —
  the same fact that makes `cd` dangerous makes `r.php` short and correct here,
  and all three references agree because they are all relative. And there is no
  cleanup job: the next fetch overwrites the same `r.php`, so one scratch file
  is reused for ever. About 130 characters, well inside every limit.

  The one rule that comes with it: **nothing after `php r.php`**, per the entry
  above.
- **The domain resolves again as of 2026-09-09, and the shop is reachable.**
  Measured from the server by `scripts/live/domain-check.sh`, against the
  registry itself:

  ```
  2026-09-05  tldNS=5 via=pch.nic.kw. google=NXDOMAIN cloudflare=NXDOMAIN registryStatus=NXDOMAIN registryNSrecords=0 soa=none
  2026-09-09  tldNS=5 via=c.nic.kw.   google=NOERROR  cloudflare=NOERROR  registryStatus=NOERROR  registryNSrecords=2 soa=ns1.dns-parking.com.
  ```

  A delegation exists again where there was none, so the registration was
  restored at the registrar — the one place this repository said it would have
  to be. Confirmed end to end rather than from DNS alone, over the PUBLIC name
  from the server: `home=38561 api=21773`, the second being the same healthy
  products response recorded elsewhere in this file. The Hostinger zone was
  intact throughout and needed no change: `@` and `www` ALIAS/CNAME to
  `*.cdn.hstgr.net`, `static` present, MX/SPF/DKIM/DMARC all in place.

  **`sporta.com.kw` is NOT in the Hostinger account** — `domains_getDomainListV1`
  lists seven domains and this is not one of them. The registration is with a
  Kuwaiti registrar and nothing in the Hostinger panel can renew it. That is
  why the panel looked healthy for the whole outage, and it is worth knowing
  before the next renewal comes round.

  **Do not measure this from the container.** Local `gethostbyname` answered
  with addresses while the proxy refused the actual connection and reported
  `ip=127.0.0.1` — the resolver here is the agent proxy, and it will
  confidently answer for a name it then declines to reach. Ask the server.

  The history below is kept because the lesson outlived the fault.

  **It used to say "the server cannot resolve its own domain"**, and treating
  that as a local oddity is how it went unexamined for weeks. Measured on
  2026-09-05, from the server, against Google's public DNS:

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

  **Only the registrar could fix it**, and that is what happened — nothing in
  this repository, in Hostinger's DNS panel, or on the server would have
  brought the name back, and nothing there was ever the fault.

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
  cycle instead of forty, and it is `scripts/publish/publish-cats.php`.
- **A publisher's `$COMMIT` pins the ARTIFACTS, not the publisher. Fetch the
  SCRIPT from HEAD.** Measured 2026-09-10: `publish-pending.php` was fetched at
  `ec28737`, the value written inside it, and reported `alreadyOk=8` with no
  `swVersion` field at all. Both were correct — at that commit the file list was
  eight long and the service-worker entry and its check had not been added yet.
  Re-fetched from HEAD the same run reports `alreadyOk=9 swVersion=v10-refresh1`.

  So the older script silently did LESS than the current one, and said so only
  in a count nobody would question. Nothing was wrong on the server either time;
  the run simply did not cover the ninth file. **A publisher that grows a file
  list is a publisher whose old copies under-publish in silence** — the failure
  is a smaller number, not an error. Fetch the script from the newest commit and
  let its own `$COMMIT` decide where the CONTENT comes from; the two are
  different questions and only one of them is written in the file.

- **Verify by sha256 against the repo**, not by size, and read it back from the
  ABSOLUTE path — the rule further up this section applies here too. Check it
  AFTER the copy, not after the download: an empty fetch and a failed copy look
  identical from the staging file.
- **The repository is PUBLIC.** That is what makes this work: the server
  fetches without a credential, so no token is ever written into a cron command
  where it would sit in the panel in plain text. It is also the reason the
  git-ignore list at the top of this file is not paperwork. Anything committed
  is world-readable, and a script fetched this way is fetched over a path
  anyone can see — so it must stay READ-ONLY, as `scripts/live/live-scan.php` says
  of itself in its own header.

A PHP installer the owner uploads is still the right shape when the owner
wants to run it themselves, or when the repository cannot carry the file.

**Where these live, since 2026-09-07.** `scripts/` had grown to 97 files in one
flat directory, where nothing in a name said whether running it would overwrite
the shop. Split so the path answers that:

- `scripts/publish/` — the ten that WRITE to sporta.com.kw.
- `scripts/live/` — the seven that only READ it, plus `domain-check.sh`.
- `scripts/` — the 62 `.mjs` rigs stay put; `package.json` addresses them by
  path and moving them buys nothing.

Each directory has a README carrying the rules above, so they are read next to
the scripts they govern rather than only here.

## The scheduled jobs, and which of them can do anything

Measured 2026-09-09 by reading every job's last output through the panel, and
independently by `scripts/live/live-cron-check.php`, which reports the same
thing from the config keys and never prints a value.

**Four of the eight were erroring on EVERY run, and had been for as long as
they existed** — waiting on credentials that are not in `api/config.php`:

| job | needs | was | then | now (2026-09-10) |
|---|---|---|---|---|
| cron-push | `vapid_public`, `vapid_private` | **every minute** | `5 * * * *` | `0 4 1 1 *` |
| cron-assistant | `n8n_webhook`, `n8n_secret` | `*/5` | `20 * * * *` | `10 4 1 1 *` |
| cron-whatsapp | `whatsapp_token`, `whatsapp_phone_number_id` | `*/2` | `35 * * * *` | `20 4 1 1 *` |
| cron-fulfilment | `warehouse_email` | `*/10` | `50 * * * *` | `30 4 1 1 *` |

That was ~2,400 PHP processes a day on shared hosting producing the same error,
and none of it visible: a job's output is readable only one at a time through
the panel, and nothing reads it. **Loud and unheard** — the same shape as the
seven jobs that died on DNS for months while the panel looked healthy.

The others keep their schedules: `cron-stock` hourly, `cron-customer-mail`
`*/10`, `cron-invoice` `*/15`, `cron-voice` monthly.

### Dormant rather than deleted, and `-nv` rather than `-q` — 2026-09-10

The owner approved both, in as many words, having been shown the trade in each.

**The four that cannot work are now ANNUAL, not gone.** `0 4 1 1 *` and three
staggered minutes after it. Deleting them would have been the obvious reading of
"disable", and it is the wrong one **because the command is the thing that
cannot be recreated**: every one carries the cron key, this repository is public,
and the key is written down nowhere. A dormant job keeps its command in the
panel where the owner can see and re-time it; a deleted job takes the key with
it. **Preserve the command, change the clock.**

The cost is the trap this section already names, made worse: the moment the
credentials go in, these will look broken for up to a year rather than an hour.
`cron-push` still wants `* * * * *` and the rest want the middle column back.

**Create BEFORE delete, and list after.** The API has no update, so a schedule
change is a delete plus a create, and a create has been seen to return an empty
success while the job simply vanished. Creating first means a silent failure
leaves the OLD job standing and nothing is lost. The one exception was
`cron-customer-mail`, done delete-first on purpose: it sends real email, and two
of it existing for even a moment could double-send to a customer. That is the
trade — a recoverable loss against an unrecoverable send.

**Every wget job now uses `-nv -O-` in place of `-qO-`.** `-q` is what hid the
DNS failure that killed seven jobs for months; the panel looked healthy because
wget's error had been thrown away. `-nv` keeps errors and drops the progress
noise. `-nvO-` is NOT safe as one token — it is two flags, `-nv -O-`.

**And it exposed a warning that has been on every run all along**, proved on a
throwaway job against `?r=slides` before any real job was touched:

```
The certificate's owner does not match hostname ‘127.0.0.1’
{"slides":[],…}
2026-09-10 21:17:01 URL:https://127.0.0.1/api/api.php?r=slides [633/633] -> "-" [1]
```

That line is EXPECTED and permanent: the loopback form connects by address while
the certificate is for the public name, which is the whole point of
`--no-check-certificate`. It cannot be silenced without silencing real errors
too. So **a captured output that begins with that one line is a healthy run**,
and the thing to read is whether anything ELSE appears. Using the public name
instead would remove it and reintroduce the DNS dependency that caused the
original outage — not worth it.

The three-line shape above is also what a working run now looks like: warning,
body, then a summary line naming the URL, the byte count and the exit. A missing
summary line means the fetch never completed.

**`cron-voice` is a FIFTH job that cannot work** — it wants `tts_key` and
`tts_voice_id` — and I first reported it among the working ones because its
last output was empty. It runs monthly, so it wastes twelve runs a year rather
than thousands, which is why it is left alone. Note that its guard sits BEFORE
the prune branch, so `?do=prune` does nothing either: the job cannot even tidy
its cache until the voice is configured.

**AN EMPTY CRON OUTPUT MEANS AT LEAST THREE DIFFERENT THINGS**, and only the
source says which:

- **Healthy, by design.** `cron-invoice` prints nothing on success and explains
  why in its own comment — *"a cron job that prints on every run is a cron job
  that emails on every run... A quiet cron is a working cron, and the day it
  speaks is the day to read it."*
- **Has not run inside the panel's retention.** `cron-voice` is monthly.
- **Ran and died before printing.** Not seen here, and indistinguishable from
  the other two without reading the code.

Reading empty as "fine" is what put voice in the working column. `ready=3/8` is
the number to trust, not the silence.

**It was wrong a THIRD time, and its own new drift alarm found that one.**
`cron-assistant` guards on `n8n_secret` as well as `n8n_webhook` — both
`store_out(…, 503)` early exits, twenty lines apart, the second because
*"signing with an empty key is a signature that proves nothing"* — and only the
webhook was listed. A shop with the URL filled in and the secret not would have
read as **READY** while the job 503'd every run. Same bug as the two below,
third key, found on the alarm's first run rather than by a person.

The alarm is not a re-derivation and must not become one: two of the nine do not
use the plain `($cfg['k'] ?? '') === ''` form — `cron-whatsapp` assigns then
tests, `cron-voice` defers to `assistant_speech_available()` — so an extractor
matching only that form turns every job it cannot parse into a job that needs
nothing. It reports `newGuard` (a plain guard the list omits) and `stale` (a
listed key the job no longer contains), and checks the indirect ones where they
actually live: the job must still CALL the helper and the helper must still TEST
each key. `guardsSeen` is printed BEFORE both, because a check that finds
nothing passes every comparison under it.

Mutation-tested seven ways, and the seventh found a real hole: the extractor
anchored at `if (` with `[^)]*`, which cannot cross a closing bracket, so on a
compound guard it read the first key and stopped — a job adding a SECOND key to
an existing guard would have passed. Reading every key on the line took
`guardsSeen` from 4 to 5 on the unmutated shop, `vapid_private` becoming visible
for the first time.

**The checker was wrong twice before that, and a full check found it.** It had been built
by grepping each file for `$cfg['...']`, which finds every key a file MENTIONS
rather than the ones it GUARDS on: `voice` listed the optional `tts_model` and
omitted `tts_key` entirely (so a shop with a voice id and no API key would have
read as READY), and `customer-mail` listed `mail_reply_to`, which nothing
checks. **A key read with `?? default` is not a key the job needs.** Each entry
now cites the line of the guard it came from.

**The staggering is deliberate.** Hourly jobs all at `0 * * * *` fire together;
:05, :20, :35 and :50 spread them, and the two that already existed keep their
own minutes.

**RESTORING THEM IS THE OWNER'S CALL AND MUST BE ASKED FOR.** The moment a
credential is added, that job is running at an hour's latency and will look
broken. The owner has said `cron-push` should go back to **every minute**
(`* * * * *`) as soon as the VAPID keys are in. The others' original schedules
are in the table above.

**The commands are NOT written here, and must not be.** Every one carries the
cron key as a query parameter, and this repository is public — checked, it has
never been committed and `git log -S` finds it nowhere in history. To change a
schedule, list the jobs, keep the command exactly as it is, and recreate with a
new time.

**The API has no update, only create and delete — and the create can fail
silently.** Changing `cron-fulfilment` returned `{"uid":"","time":"","command":""}`,
an empty success, and the job was simply gone: deleted, not recreated. A list
afterwards is the only thing that caught it. **Always list after a change**, and
never treat a create response as proof the job exists.

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

## sporta-ui.css is BUILT — edit sporta-site/css/, 2026-09-28

Asked for as "make css full separate files". The 3,647-line stylesheet is now
34 per-feature files in `sporta-site/css/` (outside the docroot), joined in
filename order by `npm run build:css` into the same `assets/sporta-ui.css`.
The site still loads ONE file: sixty references name it, and every extra
`<link>` is a request on every page view. `npm test` runs `test:css-build`,
which fails when the built file and its sources disagree. Order is cascade
order; a rule that overrides another goes in a higher-numbered file.

**Since 2026-10-01 the build strips comments, and `sporta-dark.css` is built
too**, from `sporta-site/css/sporta-dark.css`. Edit the SOURCE: the file in
`assets/` is output, and an edit there is overwritten by the next build and
fails `test:css-build` until then. The comments stay in the sources, which is
where they are read.

**The split found a live trap.** `make-brand-tokens.mjs` rewrote everything
between its `>>>`/`<<<` markers, and 186 hand-written lines — the category
tile rules — had been pasted inside them. `--check` was failing, and running
the script as its own header instructs would have deleted the tiles' layout
from the site. The generated block is `21-brand-tokens.generated.css` now,
a file of its own, and the tile rules are `22-category-tiles.css`.

### A fix whose comment said "mobile too" reached desktop only — 2026-09-28

The product photo was set to 4:5 on 2026-09-23 in `31-`, whose comment says
"same on mobile and desktop". A three-class `!important` rule in `05-` kept it
LANDSCAPE (1.25:1) below 1024px, so phones cropped every portrait photo to 64%
of its height for five days. The owner then chose 4:5 on phones too; it is set
in `05-` now, where it wins. **The more specific selector wins even when it
comes EARLIER** — file order decides only ties. `test:product-photo-shape`
uploads a real 4:5 photo and measures the box at five widths; restoring the old
rule fails it on every phone and tablet width and passes desktop, exactly as
the bug did.

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

### The bump was missed AGAIN, by me, on 2026-09-10 — so it is a test now

The owner reported *"I change something and the shop still shows the old
version"*, and **every layer measured innocent**, which is what made it hard:

```
origin      Cache-Control: no-cache, must-revalidate   (/ and the API)
CDN edge    x-hcdn-cache-status: BYPASS                (Server: hcdn)
sw.js       un-hashed files fall to rule 3, network-first
database    variants 162 -> 166 — the owner's edits WERE saving
```

**All three cache readings are measurements of the CURRENT worker.** The stale
copy is in none of them. It is in a cache belonging to a worker that no longer
exists anywhere except in a visitor's browser — running the OLD rules, where
everything under `/assets/` was cache-first and never re-asked.

That day's publisher argued, in its own header, *"no service-worker bump,
checked rather than assumed: both files have fixed names and fall through to
rule 3, network-first"*. Every clause true, of a browser already running this
worker. `sw.js` said so one paragraph above the constant — *"the bump is what
actually frees them"* — and I read that as being about the day it was written
rather than about every day after. **A rule that lives only in a comment gets
read as history.**

`npm run test:sw-version` is that rule as a check: it finds the commit that last
touched the `VERSION` line and fails if any of the seven fixed-name assets
changed after it, in a later commit or in the working tree right now. No stored
state — git already knows. Mutation-tested both ways: editing `sporta-ui.css`
without a bump (caught, naming the file), and one of the seven going missing
(caught, so the rig cannot quietly stop watching one).

**Proved against the real sequence rather than asserted.** Serving the OLD
`sw.js` first gives a browser `sporta-shell-v9-theme1` and
`sporta-assets-v9-theme1`, with a deliberately stale `sporta-ui.css` planted in
the second; swapping in the new `sw.js` and reloading leaves only the `v10`
caches. Every old one dropped.

**Two earlier attempts at that proof reported nothing rather than failing**, and
both are the house speciality:

- The first planted the old cache while `v10` was ALREADY active, so no
  activation followed and there was nothing to delete. It reported the old cache
  surviving — true, and about the test rather than the code.
- The second ran against **`127.0.0.1`**, where the bundle's own guard —
  `location.protocol === 'https:' || location.hostname === 'localhost'` — means
  the worker never registers at all. `reg: false`, and every conclusion drawn
  from it worthless. **The sandbox is `localhost` for service-worker work and
  `127.0.0.1` for everything else**, and the two are not interchangeable.

**A blank page with no boot message means the worker, not the server.**
`index.html` prints a diagnostic after ten seconds naming the file that failed.
If that message never appears, the page did not come from the server at all. A
private tab bypasses the worker and settles it in ten seconds.

## Both modes again — the toggle is back, 2026-09-10

**Reversed by the owner the day after it was made.** One mode was asked for on
2026-09-09 and the shopper's toggle was asked back on 2026-09-10, out of four
measured options: an owner-only choice in /backends, the toggle back, both, or
flipping the single mode to white. They chose the toggle.

**It cost one `git revert` of `9d3e087` and two conflicts**, and that is the
entire argument for the paragraph the old section ended with. The light rules
were deliberately left in `sporta-dark.css` and `Colors.light` rather than
deleted, on the grounds that *"they cost nothing while nothing matches, and
they are what a revert needs. Deleting them turns a two-line change back into
an afternoon."* A day later the revert was needed and it was a two-line change.
**Delete the branch you are not taking and you have decided for everyone who
comes after.**

The revert auto-merged `index.html` and `sporta-dark.css` cleanly even though
both had been rewritten since — the hero floor and the `--sp-ember` tokens
survived untouched — and conflicted only in `CLAUDE.md` and `package.json`,
which are the two files where a conflict is a prompt to think rather than a
merge to resolve.

**What was measured before offering it**, because "the files are still there"
is not "it still works": the light theme was forced in a browser and the shop
rendered correctly — body luminance 32 → 234, titles and prices dark on light
and readable. One reading nearly went in the report as a fault: text measured
`rgb(255,255,255)` on the light shop, which looks like white-on-white until you
notice the element sampled was inside a product card, and the cards are dark in
both modes. **A fixture chosen by `find` is a fixture chosen at random** — the
same lesson as the sign-in that picked `rig@local`. The dark rectangles on the
light shop are the missing-photo placeholders (`photos=0/46`), not a theme
fault.

`npm run test:both-modes` replaces `test:one-mode` and asserts the opposite:
the toggle is visible, pressing it changes `data-theme` AND a real computed
colour, the choice survives a reload, and neither mode is pinned. The four
theme rigs that `_theme-seed.mjs` had taught to refuse `THEME=light` accept it
again, which is the half a straight revert gets right and a hand-written undo
would have missed.

The section below is kept as it was written, because the reasoning in it is
still the reasoning — it is simply no longer in force.

### The original: one mode, dark only (2026-09-09, superseded)

Asked for on 2026-09-09: one mode, not a dark/light pair. Dark, because that is
what the shop already defaulted to, what `theme-color` (`#0d0e10`) says, and
what the hero art and the header were tuned against.

Three things hold it, and **the bundle is why none of them alone would**. Its
`ThemeProvider` initialises from `localStorage.sporta_theme || 'dark'` and
writes `data-theme` in an effect AFTER hydration — so pinning the attribute in
`index.html` would be undone one frame later for anyone who had ever chosen
light.

- `index.html` **writes** `sporta_theme = 'dark'` before any module loads, then
  sets the attribute. The write is the part that matters.
- `sporta-dark.css` hides the header's toggle. It has no id and no class of its
  own — `tap flex items-center …` is shared with the cart and wishlist buttons
  — so it is matched by `aria-label`, and all four strings are listed
  (`Light mode`, `Dark mode`, `الوضع الفاتح`, `الوضع الليلي`) because the button
  shows the mode it would switch TO, in whichever language is loaded.
- The app: `src/hooks/use-color-scheme.ts` and its `.web.ts` twin return
  `'dark'`, and `app.json` carries `userInterfaceStyle: "dark"` for the native
  chrome the hook cannot reach. `app-tabs.tsx` was the one screen importing
  `useColorScheme` from `react-native` directly, so it would have gone on
  drawing a light tab bar under a dark app.

**The light rules are deliberately left in place** — the whole
`:root:not([data-theme='dark'])` half of `sporta-dark.css`, and `Colors.light`.
They cost nothing while nothing matches, and they are what a revert needs.
Deleting them turns a two-line change back into an afternoon.

`npm run test:one-mode` holds it, in a browser and after hydration, because a
static read of `index.html` proves only what the FIRST frame looks like. It
checks the returning visitor who had chosen light, not just a fresh browser —
that visitor is the one person who would otherwise still see the old shop, and
nobody would notice. Mutation-tested both ways: un-hide the toggle, and let a
saved choice win again.

**Four rigs took `THEME=light` and would now have lied.** `border`, `dark`,
`glare` and `site-contrast` seeded the key, reloaded, and would have measured
the DARK shop while printing "the light theme" over every line — every number
right, every heading wrong. `scripts/_theme-seed.mjs` makes them refuse the
second theme outright, and `assertTheme()` asks the live page what settled
rather than trusting what was seeded, so they also complain in the other
direction if the pin is ever removed.

## The shop narrows nothing — no filters, 2026-09-09

Asked for in as many words. There were **more of them than the word suggests**,
and they were in two different places:

* **The app** (`(tabs)/shop.tsx`): a category pill row, and a `?category=`
  route parameter the home screen's four tiles used to open the shop already
  narrowed. Both gone. **The parameter could not stay** — with no pill row
  there is nothing on screen saying the grid is narrowed and no control to undo
  it, so the tiles now open the whole shop.
* **The website** (`Shop-BYKJiDn8.js`): category pills, a SIZE row and a FIT
  row. I first reported the site as having no filters at all, from the
  translation strings — `gridHeading: 'All products'`, `loadMore` — and that
  was wrong: the filtering is in the chunk, not in the copy. **Reading the
  labels is not reading the code.**

**Sort stays, on both.** Sorting narrows nothing — every product is still on
the page in a different order, and the control that changed it is still there
to change it back. So does the header's `?q=` search; hiding the shop's
response to it would leave a search box that appears to do nothing.

The site half is CSS, because the bundle has no source here — and that is
enough rather than cosmetic: every filter's state starts OFF in the bundle
(`useState('all')`, `null`, `null`) and nothing but those controls ever sets
it. Remove the controls and the filter can never turn on.

**The selectors are structural** (`.mb-8:has(> button[aria-pressed])`,
`.mb-8:has(.filter-scroller)`) because the rows have no id and no class of
their own, and a utility-class selector that matches one row too many takes a
control off a page nobody is looking at. `npm run test:no-filters` is therefore
half about the OTHER pages.

**Two rigs were wrong before the code was**, both in the direction of
comfortable silence:

- The new rig counted every `button[aria-pressed]` and reported 12 visible on a
  shop whose filters were correctly hidden — they were the **wishlist hearts**
  on the product cards. It now counts the ROWS.
- Its product-page check asked whether the two selectors *written in the CSS*
  reach that page, so a mutation to a WIDER selector hid the product page's
  wishlist heart and the rig passed anyway. The invariant is now stated without
  naming a selector: on a product page nothing toggleable may be hidden, by any
  rule, from anywhere. **A guard that names the thing it expects to go wrong
  only catches that thing.**

`smoke.mjs` tested the filter it now had to lose. Its RTL first-chip check
moved to the sort row — same helper, same failure — rather than being deleted
with the row it happened to be written against, and its "the category filter
narrows the grid" assertion was **inverted**: it now presses every control on
the screen and requires that none of them makes the count fall. A rig that
merely stopped clicking would have gone green whether or not the filter
returned.

## The brand colour lived in THREE places, and the editor wrote none that mattered

Found by scanning the theme on 2026-09-09, after building a theme editor that
appeared to work.

- **`--brand`** is on `:root` and is read by **one rule in the whole stylesheet**
  — the skip link. Tailwind v4 compiled the colour to LITERAL HEX in every
  utility class: `.bg-brand{background-color:#e0561c}`, 51 occurrences across
  the three values. So the editor's brand control moved the skip link.
- **`--primary`**, in HSL CHANNELS (`18 78% 49%`, no `hsl()`), is what
  `.btn-primary` uses. Nobody had written it, so the shop's main call to action
  stayed orange under any theme.
- **`--sp-ember-fill` in `sporta-dark.css`**, and this one **wins over both**:
  `[data-theme=dark] .btn-primary{background-color:var(--sp-ember-fill)
  !important}`. Setting `--brand` AND `--primary` to blue still left every
  primary button orange, and nothing in the built stylesheet explained why.

**Checking that a token EXISTS is not checking that anything READS it.** That
is the same mistake as a route name that exists in the app and in no server,
and I made it twice in one file: `--accent` is declared on `:root` and read
NOWHERE (`.text-accent` resolves to `--accent-text`), so the editor had a
second control that did nothing. It is gone from the editor, from `admin.php`
and from `admin.ts`.

`scripts/make-brand-tokens.mjs` reads the built stylesheet and regenerates a
block in `sporta-ui.css` re-stating all 48 rules in terms of the token, literal
first and `color-mix()` second. `--check` fails at commit time when the two
drift. `theme.js` derives `--brand-dark` and `--brand-bright` from the one
colour the owner picks, by the deltas **measured** between the shipped three —
fed the shop's own orange it returns the shop's own other two, which the rig
asserts against the design's literals rather than against its own formula.

**Emitting invalid CSS reports nothing at all.** The generated block opened
`/* … */` and then continued with ` * prose` lines, which are not a comment
after the first `*/` — the parser discarded everything to the next one,
`:root` included. No error, anywhere; only a variable coming back empty from
`getComputedStyle` showed it, and only because a rig asked.

**The hero and tile gradients keep their dark stops.** Only the brand-coloured
glow in each is tokenised. Turning `#35200e` into a token needs a designer to
say what a blue shop's warm-brown shadow should be, and that is a redesign.

## Four declared font faces did not exist, and every rig said the fonts were fine

`assets/index-*.css` declares EIGHT `@font-face` rules for IBM Plex Sans
Arabic — 400, 600, 700, each split Arabic/Latin. Only the two 600 files were
ever shipped; the other four 404'd.

**Nothing was visibly broken, and that is the trap.** A browser fetches a face
only when text actually uses that family at that weight, and none does at 400
or 700 — so `font-audit.mjs` passed truthfully, saying *"every font the shop
asks for actually answers"*. It was asking about the faces the pages REQUEST,
not the ones the stylesheet DECLARES. The first `font-weight: 400` on a Plex
element would have fallen to Arial mid-paragraph.

Built rather than deleted, because the declarations live in a CONTENT-HASHED
file that `sw.js` caches cache-first for ever — editing one in place pins every
returning visitor. `scripts/build-plex-subsets.py` READS the unicode-ranges out
of the stylesheet's own rules rather than repeating them, so the subsets cover
exactly what the browser was told they cover.

The audit now asks both questions, and the "every shipped file is used" check
became "fetched OR declared" — the old wording would have pushed towards
deleting the files again and restoring the silent fallback.

## An inline script is allowed by a HASH, and editing it silently disables it

`index.html` carries five inline scripts and `.htaccess` names each one by
sha256. The boot script — the one that decides the language before the first
paint, pins the theme and caches the hero height — is one of them.

**The one-mode change edited that script and did not update the hash.** So from
that publish until 2026-09-09 the live server REFUSED TO RUN IT. Measured from
the server:

```
hashesAllowed=5 inlineScripts=5 allowed=4 BLOCKED=1
```

Nothing reports this. The browser writes one console line nobody reads, and the
symptoms — a page that flips from English to Arabic, a theme that does not
stick, the hero jumping — look like anything but a security header. It was
found by `npm run test:csp` going red on an unrelated commit, not by looking.

**`scripts/live/live-csp-check.php` asks the server the question directly**, and
that is the only way to ask it: reading `.htaccess` tells you what the
repository thinks, and the live copy is not always the repository's. It compares
the policy the server SENDS against the page the server SENDS.

So: **`test:csp` before publishing anything that touches `index.html`**, and
treat a changed inline script as a two-file change.

## The website's panel and the app's panel are two different programs

`/backends` on sporta.com.kw is a prebuilt bundle with no source here. The
Expo app has its own `/backends` screens. **A screen added to one does not
exist in the other** — the KNET editor, the footer editor, the theme editor and
the brand-logo uploader all began app-only, and "it is in /backends" was true
of a panel the owner does not open in a browser.

The way into the website's panel is the overlay pattern the storefront already
uses (`contact.js`, `footer.js`, `theme.js`): add a card, touch nothing that
exists, and do nothing outside the screen it belongs to.
`assets/brand-logos.js` is the first one that WRITES — and it needs no
credential of its own, because it runs on the shop's origin inside the panel
and the session cookie is already there. The request shape was read out of the
bundle rather than guessed: `/api/admin.php?r=`, `X-Sporta-Admin: 1`,
`credentials: include`.

**`brand_save` is one route for create AND rename**, so anything writing a logo
must resend `name_en`, `name_ar`, `slug` and `sort`. An overlay that sent only
the logo would blank the brand's name while appearing to upload a picture, and
nothing on screen would show it. Both rigs assert the name survives, and the
mutation that sends a wrong one fails them.

## A workaround can be right and its side effects unmeasured

The category tiles asked for `/cats/<crop>/<id>.jpg` and the files on disk were
`art-<id>.jpg`. Four 404s on the home page, found by `site-scan.sh`, fixed with
an internal rewrite. Correct, and it cost two things nobody looked for.

**The tile component renders TWO `<picture>` blocks.** The first asks for the
plain name and carries one jpeg. Only when that ERRORS does it fall to the
second — and the second is the good one: webp sources, and the `-rtl` suffix
that selects the Arabic composition. Bridging the first name onto a real file
meant the second never rendered. Measured in a browser, both languages,
2026-09-09:

```
desktop  285 kB of jpeg  ->  203 kB of webp     82 kB a load
phone    212 kB          ->  145 kB
Arabic   art-men.jpg     ->  art-men-rtl.webp
```

**Three rigs had been taught the wrong thing by the workaround.** `site-scan.sh`
asserted the plain name was 200 (the bridge made it so), `site-scan.mjs`
asserted nothing 404s (likewise), and `image-audit.mjs` asserted the bridge
resolved. All three now expect exactly four plain-name 404s and still fail on
any other — **a rig that encodes a workaround's world stops being able to see
past it.**

**The app had the same bug the other way up.** `categoryArt()` asked for
`art-<id>.jpg` whatever the language, and `RemoteArt` paints the remote layer ON
TOP of the bundled one — so an Arabic phone with a network had the English frame
covering the Arabic frame the app ships. It takes a direction now and asks
`category-art.ts` which ids have one, rather than carrying a second list.

**Change `.htaccess` and `dev-router.php` together.** The sandbox is `php -S`,
which never reads `.htaccess`; a measurement taken with only one of the two
changed measures nothing. The first attempt at this measured exactly that.

**Removing the RULE did not remove the FAULT, because a FILE was doing it too.**
Measured 2026-09-10 by `scripts/live/live-tile-names.php`, cache-busted, all
eight plain names across both crops:

```
desktop/accessories=404  desktop/men=404  desktop/women=404  desktop/outlet=200/img/59388
mobile/accessories=404   mobile/men=404   mobile/women=404   mobile/outlet=404
STILL-BRIDGED=desktop/outlet
```

`cats/desktop/outlet.jpg` is on the server and in no commit — found by
`live-file-check.php`'s untracked walk, not by anything looking for it. 59,388
bytes, the same size as `art-outlet.jpg` beside it, so it is a copy of the
artwork saved under the bridging name. The rewrite is gone; this one tile is
bridged by a duplicate instead, and every desktop visitor gets the 59 kB jpeg
rather than the 45 kB webp. No language fault here — outlet has no `-rtl`
composition — but the mechanism is the one that would cost it if it did.

**Three rigs assert exactly four plain-name 404s and all three run against the
sandbox**, so none of them can see this: a stray file on the live server is
invisible to every check that measures a checkout. The question `differ=0` never
asks is not only "what did we never send?" but "what is there that we never
sent?"

The script derives the ids from the artwork on disk, and the first version did
not — it listed four by hand, and two were invented: `kids`, which is not a
category, and a `phone` crop really called `mobile`. Both answered exactly as a
correct server would, a 404 and an absent directory, so they read as two extra
passing checks while `accessories` was never asked about at all. **A fixture
typed from memory is a fixture chosen at random**, which this file already
records of a sign-in that picked `rig@local` and a light-theme reading taken
from a product card.

### Removing it did not stick, and that is the real finding

The owner approved removing it on 2026-09-10. It was moved into
`/home/u130124229/removed-2026-09-10` rather than unlinked, and verified from
both ends — gone from the docroot, landed in the attic at the same size, all
four plain tile names 404 in the same run. **Both times it came back.**

```
moved 14:23:01  ->  back 14:24:01     then untouched
moved 14:39:01  ->  back 14:40:01     then untouched for eight minutes
```

Byte-identical to `art-outlet.jpg` beside it (sha256 `8c0675b4f9ed`), at the
cron tick, and then left alone. **A writer that only acts when the file is
MISSING does nothing on a normal day**, which is why nothing has ever reported
it. `SPORTA-BACKEND.zip`, moved in the same run, has NOT come back — so this is
not a backup restoring the docroot wholesale, it is something specific to the
category art.

**`SPORTA-BACKEND.zip` DID go, and I said it had not.** It is in the attic at
445,316 bytes with a ctime of 14:22:01 — moved by the run whose output the next
minute's run overwrote, per the cron entry above. 445 KB of source is out of
the web root and recoverable by one rename; nothing has put it back.

**The attic is `/home/u130124229/removed-2026-09-10`**, outside `public_html`,
so nothing serves it. That is the shape to keep: **a removal from a live server
should be a rename, not an `rm`.** It cost nothing here and it is what made the
zip recoverable when I had wrongly written it off, and what made "did it come
back, or did it never go?" answerable at all — the attic copy's timestamps are
half of the evidence above.

**`api/deploy.php` was accused of it BY ME, and it is innocent.**
`live-who-writes-tiles.php` reported it as the single candidate out of 39
scripts, and I passed that to the owner. The needle list contained `copy(` and
so did the write list, and a file had to match BOTH — so the conjunction was a
tautology satisfied by any file containing `copy(`. `deploy.php` does not
contain the string `cats` anywhere.

Read since, through the Hostinger file API rather than over a public URL: it is
a signed-POST deploy endpoint, and a careful one — HMAC-SHA256 against a secret
outside `public_html`, an artifact host allow-list, sha256 verified before
anything is written, staged in `storage/` and never unpacked into the live
root, `.php` inside an artifact REFUSED, `api`/`knet`/`pay`/`.htaccess`/
`config.php` protected by name, manifest-based pruning, three releases kept for
rollback. It is the thing that replaced `wget zip && unzip -o`, which is very
likely what `SPORTA-BACKEND.zip` was for. **And it cannot fire on a timer at
all** — it only acts on a signed POST, so it was never a candidate for a
per-minute restore, which one look at it would have said before the grep did.

**An extractor's two halves must not share a term**, or the AND between them
stops meaning anything. Same family as the route extractor whose character
class silently dropped a name.

**Corrected, the answer is that NOTHING on the account writes it.** 5,040 files
across the docroot AND the home directory — the first version scanned only the
docroot, which cannot contain the answer if the writer lives where cron's
relative paths land. Two hits, both spurious: the scanner's own `r.php` matching
its own text, and an unrelated `wainkw.com` bundle containing `exec`.

**And the restore is real, with the confound removed.** The earlier runs deleted
the removal job about thirty seconds before the file returned, and the delete is
asynchronous — so "my own job re-ran" was live. Repeated 2026-09-10 with a
ONE-SHOT job at a named minute, deleted immediately, nothing of mine scheduled
for the next eleven:

```
15:04:02  moved to the attic, all four plain names 404 in the same run
15:05:02  back on disk, byte-identical
15:05 -> 15:18  untouched, while a per-minute job of mine ran throughout
```

So: something on this server heals that one file within a minute of its going
missing, does nothing while it is present, and is not a script this account
owns. It is not `deploy.php`, not a backup (the zip moved in the same run has
never returned), and not any of the nine listed jobs by their commands. **It is
the owner's panel to answer** — a Git auto-deployment, a host-level repair, or
a job under another user. Do not remove anything else on a guess: three
removals have now been undone, and the thing that undoes them has not been
seen.

**And it revealed a NINTH cron job**, which every earlier reading of this file
missed because the list was eight long every time it was looked at:
`* * * * *`, an `rm -f` of two Next.js CSS files under `domains/wainkw.com`.
A different site, and nothing to do with this one — but "none of the jobs runs
every minute" was a sentence written from a list, and the list had changed.
**Re-list before reasoning from a list.**

**Then it vanished again, within half an hour, and nothing here deleted it.**
Present at 14:51, gone at 15:19, back to the same eight. So the cron list on
this account is not stable either, and a job seen once may not be there when
the next reading looks — which is the same property as a file that heals
itself, on a different surface. Both say the same thing: **this account has a
manager that is not us.** Record the reading with its timestamp; do not treat
either list as a standing fact.

**Seen a second time within the hour, and it is a different job again.** At
15:31 the list was nine long once more: `* * * * *`, `rm -f p.php d.php` — two
relative paths, so the HOME directory, which is where this channel's own
scratch file lands. Something is sweeping scratch files every minute. It only
removes, so it is not what restores the tile, but it is the same shape:
appearing and disappearing between readings, and touching exactly the working
area this channel uses. **Do not delete these; they are not ours.** And do not
be surprised when a scratch file vanishes mid-diagnosis — that is now a known
property of the account rather than a mystery to chase.

**What this costs the rules above.** Every publisher in `scripts/publish/`
verifies its work in the same breath as doing it, and each was right to. None
of them can see a file that returns a minute later. `differ=0` and a green
publish are both measurements of one instant, and this docroot has a writer
that acts on a delay.

**And a check run in the same breath as the write can measure the state before
it.** The publisher reported `plainName=STILL-BRIDGED` seconds after writing the
new `.htaccess`; a probe a minute later found the rule gone and the URL 404 by
all three routes — plain, cache-busted and `no-cache`. The bytes had been
verified by sha256 at write time, so the disagreement was LiteSpeed still
holding the old parse, not a failed publish. `scripts/live/live-tile-probe.php`
is what tells those apart, and the general rule is: **if a publisher's own check
contradicts its own verified write, re-ask before believing either.**

## A throttled probe cannot prove a gate holds

`live-admin-gate.php` asks the live server whether anything behind
`store_require_admin()` answers 200 without a session. Its first run fired 75
requests in a tight loop, the shop's own rate limiter answered them, and it
reported `answering200=0`.

**That reads as "every route is protected" and would have read exactly the same
on a server whose gate was wide open** — every request was refused before it
reached the gate at all. The same failure this file already records for the
assistant checker, walked into again by the person who wrote that entry.

Fixed by CLASSIFYING each refusal rather than counting the absence of 200s:
401/403 is the gate, 400/404/405 is the route declining the shape of the
request, and 429/503 is the throttle — which is not an answer, and makes the
run say **INCONCLUSIVE**. Requests are paced so it usually does not arise.

The same run reported `withoutHeader=500` and that was the throttle too. The
check was also aimed at the wrong route: `me` sits ABOVE the gate and never
required `X-Sporta-Admin` — the sandbox answers 200 with `null` and always
has. Confirmed on the live server by `live-me-probe.php`:
`withHeader=200/4/null withoutHeader=200/4/null`, PHP 8.5.4, identical to the
sandbox.

The honest reading, once paced: `guarded=74 answering200=0 gated=74
declined=0 throttled=0 withoutHeader=401-refused`. Every one of the 74 routes
behind the gate answered 401, which is the gate holding — and now it is
distinguishable from the limiter holding.

## The shop's numbers are the owner's — nine rules, 2026-09-10

Asked for as "make full dynamic all". Delivery, a new free-delivery threshold,
the returns window, the cash-on-delivery limit, the review reward, the discount
cap, the governorates served, and which sizes and fits are offered were all PHP
constants, so changing one meant a code edit and a publish.

They are a `rules` settings row now, and **the constant is the DEFAULT while the
row is the OVERRIDE, one direction only.** That keeps one home per number:
change the constant and every shop that never opens the panel follows. It also
fails towards the shipped value — a missing, unreadable or half-written row
leaves the shop behaving exactly as before, never with a delivery fee of zero or
an empty list of governorates, which are the two ways this could quietly cost
money. `store_rules()` reads it, `store_rule()` reads one, and an EMPTY list is
read as absence rather than as "this shop delivers nowhere".

**The defaults live in a FUNCTION, not in `STORE_SETTING_DEFAULTS`**, because
several of the constants behind them are declared LATER in `store.php` than that
array is, and a top-level `const` is executed in order — referencing one from
above it is an undefined-constant fatal on the first request.

### Sizes and fits are a SUBSET, and the schema is why

This was going to be a free list until `order_items` was read:

```sql
constraint items_size_ck check (size is null or size in ('S','M',…,'ONE')),
constraint items_fit_ck  check (fit  is null or fit  in ('normal',…,'tank'))
```

**A size invented in the panel would pass PHP and then be refused by MySQL at
insert** — a checkout that dies on its last step, and a `variant_save` that
500s. So the owner picks WHICH known sizes this shop offers and in what order (a
shop that does not stock 5XL can drop it), and adding a genuinely new one is a
schema migration rather than a setting. `test:rules` asserts `STORE_SIZES` and
`STORE_FITS` still equal those CHECK lists, **parsed out of both files rather
than restated**, so the two homes cannot drift — and it fails loudly when a
parse finds nothing, because two empty lists compare equal.

**The orphan guard** refuses to drop a size that has `product_variants` rows,
and names them with counts. Dropping one tidies nothing: the rows keep their
stock and stop being orderable, so the garment goes on showing a size nobody can
buy and nothing reports it. "You cannot remove XL" is not actionable; "XL has 42
stock rows" is.

### Delivery is ONE function, because there are two call sites

`?r=discount` quotes the checkout and `?r=order` charges it. api.php already
warned that leaving the fee out of the quote *"would put a total on screen that
is 1.000 KWD lower than the one the bank asks for"* — **a free-delivery
threshold applied in one of the two is that same bug with a friendlier face**,
so `store_delivery_fils()` decides for both and the rig places a REAL ORDER and
compares it with the quote at both sides of the threshold. The threshold is
measured on goods AFTER the discount, which cannot be gamed by stacking one to
cross the line.

### Six of the nine are public; three are not

`cod_open_max`, `discount_max_pct` and `review_reward_pct` are withheld from
`?r=slides`. Each tells anyone probing the shop exactly where its edge is, and
none changes what a page shows. The panel needs all nine, so it reads
`admin.php?r=rules` — the same argument as the Tranportal ID above. **And that
is a READ, not a save with an empty body:** reading by writing would mean
opening the settings screen rewrites the row, so a panel opened and closed would
look in any audit like a deliberate change.

### Both panels, this time

`assets/rules.js` for the website's `/backends` and `src/app/backends/rules.tsx`
for the app's. **The KNET editor, the footer editor, the theme editor and the
brand-logo uploader all began app-only** and this file records how long that
went unnoticed; having just built the website card, the same mistake was
available in the other direction. Every picker is built from the server's
`allowed`, never from a list in the client — a list typed into two clients is a
third and fourth home for it.

**The panel rig caught a bug whose own comment denied it.** `rules.js` claimed
that on a refusal "the form keeps what the owner typed" — and `render()` rebuilt
every field from state, so the box just unticked re-ticked itself and the edit
vanished under the message explaining why it was refused. **A comment asserting
a behaviour is not that behaviour**, which is the same lesson as the `cod`
branch that documented the rule it did not apply.

### The service-worker guard was watching 7 of 15

Found on the way past, because `rules.js` is a new fixed-name asset.
`sw-version-test` had copied its list of seven out of `sw.js`'s own comment, and
`assets/` had grown to FIFTEEN un-hashed files — `theme.js`, `custom-css.js`,
`brand-logos.js`, `footer.js`, `admin-upload.js`, `product-photos.js`,
`brand-badge.js` and now `rules.js` were all cache-pinnable and none was
watched, while the rig reported "all ok". It DERIVES the list from the directory
now, so anything added tomorrow is watched the day it lands, and it asserts the
derivation found something — an empty list is watched perfectly and reports
nothing.

It also distinguishes MODIFIED from ADDED: a new file strands nobody, because no
browser holds a stale copy of a file that did not exist, so adding one no longer
demands a version bump it does not need.

**A guard that names the thing it expects to go wrong only catches that thing** —
already in this file, and it had been true of the guard written to enforce it.

## `no-cache` with no validator is a slower `no-store` — 2026-09-10

Asked to improve caching and cookies for Chrome and Safari. The cookies were
already right; the caching had one hole, and it was on the busiest page.

Measured on the live server by `scripts/live/live-revalidate-check.php`, which
asks what the policy COSTS rather than what it IS — the existing
`live-cache-check.php` reports the `Cache-Control` and stops there:

```
shell   200/42810  cc=no-cache,must-revalidate  v=NONE     inm=no-etag  ims=no-lm
worker  200/18880  cc=no-cache,must-revalidate  v=etag+lm  inm=304/0
fixed   200/92856  cc=no-cache,must-revalidate  v=etag+lm  inm=304/0
hashed  200/91444  cc=public,max-age=31536000,immutable    inm=304/0
api     200/21773  cc=no-cache,must-revalidate  v=etag     inm=304/0
image   200/45008  cc=public,max-age=86400,swr             inm=304/0
```

**`no-cache` does not mean "do not cache". It means "ask before reusing."** The
asking is only cheap if the response carries a validator and the server answers
a conditional request with an empty 304. Every file on the shop could do that
except the one page every visit starts at — so Chrome and Safari BOTH re-sent
42,810 bytes on every navigation, with no way to avoid it.

**Because `/` is not a static file.** `.htaccess` rewrites it — and every SPA
route — to `seo.php`, and PHP sends no ETag or Last-Modified of its own. The
static files beside it get theirs from the web server, which is exactly why the
fault was invisible: every neighbour of the broken thing was correct.

`seo.php` now hashes its own output into an ETag. **A hash is honest here
because the page is a pure function of the URL**: the language comes from
`?lang=en` and not from `Accept-Language`, nothing reads a cookie, and there is
no clock, nonce or random value in it. If that ever changes, a `Vary` must be
added in the same commit or a shared cache will hand an Arabic page to an
English shopper.

**The dangerous half is the opposite one.** An ETag that never moves pins every
visitor to a page that no longer exists, silently and for ever — the
service-worker failure this file already records, one layer down. So
`test:seo-cache` edits a product name in the database and requires that the
tag MOVES and that the OLD tag now answers 200. Mutation-tested three ways: the
ETag removed (the state before today), a CONSTANT ETag (caught by three
separate checks), and the tag compared as a whole header rather than per tag —
which is how a 304 silently never fires, and is why `store_out_cacheable()`
carries the same loop.

### The loopback is not the shopper's path, and nothing here had ever checked it

Every cache measurement this project has made — `live-cache-check`,
`live-revalidate-check`, and every publisher's own verification — uses the
loopback form, `https://127.0.0.1/` with a `Host:` header. **That reaches
LiteSpeed directly and BYPASSES the CDN.** It is the right tool for "did the
bytes land" and the wrong one for "what does a shopper get", because a
shopper's request traverses `hcdn` first and a CDN is a shared cache: it may
strip a header, decline to forward a conditional request, or answer from its
own copy.

So the ETag could have been perfect at the origin and worth nothing in Kuwait,
and **every check this repository owns would have reported success.**
`scripts/live/live-edge-check.php` asks both paths and puts them side by side.
Measured 2026-09-10:

```
/      origin=200/42810  edge=200/42810  cdn=BYPASS  origin304=304  edge304=304
       originTag=8c38fcd253f9…   edgeTag=W/8c38fcd253f9…
       enc=gzip  encTag=same  varyGzip=Accept-Encoding  varyPlain=-
```

**The CDN weakens the tag to `W/"…"`, and that is the whole reason the
defensive loop matters.** `seo_send()` strips a `W/` prefix and compares each
tag in a list, copied from `store_out_cacheable()` — which calls getting it
wrong "a slower no-store with extra steps". Had it compared the raw header, the
ORIGIN would have answered 304 on every check while the EDGE answered 200 for
every real shopper, for ever. The care was load-bearing on the live path and
invisible on the tested one.

**And `tagsMatch=DIFFER` is not by itself a finding.** The first version of the
checker printed only that, on bodies of identical length — which has two very
different explanations, a transformed tag or different bytes, and no way to tell
them apart. Printing both tags settled it in one run. A comparison that reports
only "not equal" hands you a question you then have to guess at.

The gzip half came out clean: `varyGzip=Accept-Encoding`, so one strong tag
covering both encodings is safe here — a shared cache keys on the encoding and
cannot hand a gzipped copy to a client that never asked. `varyPlain=-` is
correct; an unencoded response has nothing to vary on. **That was worth asking
rather than assuming**, because the hazard belonged to the new ETag rather than
predating it.

### The sandbox had never once run seo.php

`php -S` reads no `.htaccess`, so `/` was served straight from disk locally.
**Not one rig had ever exercised the SEO shim** — not its canonical, not its
hreflang, not its Open Graph tags, not its fail-safe branch. All of it measured
"fine" by never running. `scripts/dev-router.php` now mirrors those rewrites,
with the same real-file-wins guard, per the standing rule that the two are
changed together.

**The rig found a real bug in its own first version**, and it is the familiar
shape: it edited `name_en` and asked the DEFAULT product page, which is ARABIC
and renders `name_ar`. The tag correctly did not move, and the rig reported a
staleness bug in code that was right. **A fixture that does not have the
property under test does not test it, and the failure it produces is
indistinguishable from the real fault.** It now drives each language against
the column that language prints, which also proves the two are independently
keyed.

### What was already right, and stays

- **The storefront sets no cookies at all** — `setck=0` on every public route,
  re-asserted by the rig. The admin session cookie is `__Host-` prefixed,
  Secure, HttpOnly and `SameSite=Strict`, set where the cookie is made rather
  than by a `Header edit` LiteSpeed ignores.
- **Nothing sends `no-store` on a NAVIGATION**, which matters more than it
  looks: it disables the back/forward cache in both browsers and turns the back
  button from instant into a full reload. It is one word, easily added in a
  hurry to "stop caching", and the rig now guards it.

### The Safari difference that is NOT fixed, and is the owner's call

Safari evicts all script-writable storage after **seven days** without a visit —
`localStorage`, IndexedDB, and the service worker's caches and registration.
The shopper's language and theme live in `localStorage`, so a Safari user who
visits less often than weekly gets the default back every time and the worker
re-installs from scratch. Chrome does not do this.

The fix would be a server-set cookie, and that would end the zero-cookie
property recorded above, which was deliberate. **Do not make that trade without
asking** — it is a privacy posture, not an implementation detail.

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

Measured on the server by `scripts/live/live-scan.php`. The 2026-09-04 reading
is kept beside the current one because the gap between them is the owner
working, not the code changing:

```
2026-09-04  db=46p / 0o / 42v                  qa=MISSING
2026-09-09  db=46p / 0o / 162v  nosize=4       qa=yes      | no problems
```

**Both gaps below are now closed by the owner, and neither by anything here.**
`assistant_qa` exists, so the سبورتا AI can answer a taught question. Variant
rows went 42 → 162, so the catalogue is buyable.

**The last four are done too, on 2026-09-09.** `cagliari-calcio-backpack`,
`cagliari-calcio-backpack-navy`, `denver-nuggets-cap-navy` and
`gymshark-phone-strap` had NO variant rows, and I twice called that
"unbuyable", which understated it: `store_stock_claim()` skips a slug with no
rows by design, so they were stock-UNTRACKED and nothing would have stopped an
order for a hundred. Each now has a `ONE` row at stock 0 — the owner chose 0
over a guess — so the shop shows a size, reads out of stock, and enforces the
count from here on. The real number goes in /backends.

Three things about that worth keeping:

* **`ONE` is in `STORE_SIZES` already**, and it is three characters because
  `size` is `varchar(4)`: "One Size" does not fit. The schema chose the token.
* **The SKU must be derived by `variant_save`'s own formula**
  (`strtoupper(substr($slug, 0, 26) . '-' . $size)`), or /backends later writes
  a SECOND row for the same garment and size. The longest lands at exactly 30
  characters, which is the column width.
* **Two of my hypotheses were wrong and cost nothing only because I checked.**
  `admin.php` and `api.php` do exclude `ONE` from their size lists — but those
  are a size CHART and "what size do you usually wear", where it correctly has
  no place, not stale copies of the stock list. And `variant_save` accepts
  `ONE` fine, so the panel could always have done this; nobody had.

The paragraphs below are the original finding, kept for the lesson in them.

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

#### It was fixed in ONE copy of four, and a third instance escaped both passes

Audited on 2026-09-10, every `on duplicate key update` in all 33 tracked `.sql`
files. The 2026-09-04 fix had landed in `database-sql/` and nowhere else:

| file | still overwriting |
|---|---|
| `api/seed.mysql.sql` | `price`, `name_en`, `name_ar`, `desc_*`, `category`, `active` |
| `api/install.mysql.sql` | the same, plus brand `name_en`/`name_ar` |
| `api/brands.mysql.sql` | brand `name_en`/`name_ar` |

And **`sporta-mac-check.sh` step 3 was telling the owner to import
`api/install.mysql.sql`** — the buggy one — while the corrected bundle sat in
`database-sql/`. The fix and the instructions had drifted apart.

**The third instance is the one worth remembering.** The `product_variants`
clause wrote `cost_aed`, which `variant_save` edits from /backends and which
`1-schema` itself calls *"the one commercially sensitive number in the schema"*
— the wholesale cost. It survived the 2026-09-04 pass and a later review
because the comment beside it says *"stock deliberately NOT updated"*, which is
TRUE: stock really is excluded. `cost_aed` sat one line away inside the same
statement. **A correct comment about the neighbouring column is how a bug
passes two readings.** Re-importing reset the owner's margins to seed
placeholders.

All corrected to the no-op idiom. Proved against MariaDB rather than by
reading — import, make the edits an owner makes in the panel, import the SAME
file again, require every edit to survive — and mutation-tested by restoring
each original clause: 99.500 reverts to 3.000, `cost_aed` 1234.00 reverts to
75.00.

**Three headers were lying**, and each lie is the kind that stops the next
person looking:

- Two seeds said *"GENERATED by scripts/generate-mysql-seed.mjs. Do not
  hand-edit."* **That script does not exist** — nothing in the repository or
  `package.json` references it. The only instruction the file gave could not be
  followed, which is the "generated file with no generator" trap already
  recorded above, hiding in a header rather than a filename.
- `api/seed.mysql.sql` promised *"prices and names update in place"* — the bug,
  written down as a feature, directly above the clause that did it.
- `api/install.mysql.sql` says `make-install-sql.mjs` builds it *"from the four
  part files"*; that generator now writes TEN parts to
  `database-sql/IMPORT-THIS-ONE.sql`, so `npm run make:install` never touched
  this file and editing a part changed nothing here.

`npm run test:sql-safety` holds it, in two halves because either alone is
foolable. **Statically**, no `.sql` may name an editable column in an
on-duplicate clause — with the editable set READ FROM `admin.php`'s save routes
rather than listed, so a column added to `product_save` next year is covered
the day it lands, and so the list cannot go stale in the other direction.
**Behaviourally**, each importable bundle must survive the edit-and-reimport
round trip. Mutation-tested three ways, and the third — a part file no bundle
test imports — is caught by the static half alone, which is the argument for
having both.

**The rule this adds: when a fix lands, grep for the clause, not the file.**
The 2026-09-04 entry says "both seeds now use the no-op idiom" and it was true
of both seeds it looked at. Nobody asked how many seeds there were.

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

**Done on 2026-09-09, and there were FIVE of those lines, not two.** The other
three were in `pay/.htaccess` and `knet/.htaccess` — the payment endpoints,
forcing Secure, HttpOnly and SameSite=Lax — and they had never run either, so
every payment response leaked three `edit:` headers containing its own source.
The storefront's two were the ones that had been noticed; the payment ones were
found by the guard, not by looking.

All five removed. Nothing was lost, because nothing they protected exists:
`store_session_start()` in `api/store.php` is the ONLY place this project
starts a session — admin.php, orders-print.php and store.php itself all route
through it, checked — and it already sets secure, httponly and samesite=Strict
on the cookie params, with a `__Host-` name over HTTPS. `pay/` and `knet/`
contain no `session_start`, no `setcookie` and no `Set-Cookie` at all.

`scripts/cookie-flags-test.mjs` (`npm run test:cookie-flags`) holds it: no
`.htaccess` may carry a `Header edit` DIRECTIVE (matching the words would fail
on the comment explaining the removal, so the guard would have been deleted);
no file may start a session outside `store_session_start()`; and a real sign-in
against the sandbox must come back HttpOnly and SameSite=Strict. Mutation-tested
three ways — a restored directive, a weakened samesite, a bare `session_start()`
in a new file — each caught.

Two things it cost to get right, both worth keeping. The guard's first version
flagged a line of PROSE about `session_start()` inside a `//` comment; the
tempting fix is to loosen the check, which is to break it — strip the comment
instead. And its sign-in used `order by id limit 1`, which picked `rig@local`
rather than the account `sandbox.sh` seeds, so three cookie assertions failed
for a reason that had nothing to do with cookies. **A fixture chosen by
position is a fixture chosen at random.** Name it.

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

**The certificate now exists — measured 2026-09-09**, once the registration
came back and the host could be validated:

```
wget -qO- https://static.sporta.com.kw/assets/sporta-ui.css | wc -c   → 73866
```

Verification ON, no `--no-check-certificate`, and 73,866 bytes is the current
file byte for byte. So the blocker is gone and the move is now merely a
decision.

**It is still not obviously worth making**, for the reason below that has not
changed: the storefront sets zero cookies, so the saving is nil. Ask before
moving the references; do not treat an unblocked task as an approved one.

And the thing worth remembering before finishing it: **the storefront sets ZERO
cookies for a shopper** — measured, `Set-Cookie` count 0 on the home page — so
the byte saving from a cookie-free host is nil. It is worth having as somewhere
to point a CDN, and it is not worth breaking anything for.

## A file that is only missing can still break a feature completely

`live-file-check.php` on 2026-09-09: `same=163/173 differ=0 missing=10`. Every
file present was correct, which is why this had never been noticed — the
publishers all report on what they wrote, and nothing reports on what was never
sent at all. Two of the ten mattered:

- **`fonts/Alexandria-400.ttf`.** `api/invoice-pdf.php` looks for it in three
  places and, finding none, `return null`s. **No PDF invoice was generated for
  any order, ever**, and nothing said so: the caller gets null and the shop
  carries on. A missing font reads like a cosmetic problem. This one was the
  invoice system.
- **`images/` did not exist at all.** `store_brand_logo_file()` serves a brand
  logo from `images/<slug>/logo.png|webp|jpg` — no tool, no rebuild, drop a
  file in a folder. The folders were not there, so there was nowhere to drop
  one. That is half of why `brandLogos=0/8`: the owner has been asked for logos
  with no place to put them.

Both are now live, verified `same=173/173 differ=0 missing=0`.

**The manifest in that checker WAS hardcoded, so it went stale, and a stale
manifest reports the repository's staleness as the server's.** It was eight
hashes behind and missing two files that were live — a run would have called
two live files "missing" and eight correct ones "differ".

**The instruction here used to be "regenerate it from `git ls-files` before
believing a run", and that was not enough: it went stale again within the
hour.** On 2026-09-10, minutes after publishing eight files, the manifest was
behind by exactly those eight — so the next run would have reported the server
as wrong about the very files that had just been made right. **A checker that
reports the repository's staleness as the server's does not merely mislead; it
points at work that is already done**, and the obvious response to its report is
to republish files that are already correct.

So it is generated now: `npm run make:file-manifest` writes it, and
`npm run test:file-manifest` FAILS on drift and names what drifted. A rule that
needs remembering every time is a rule that will one day not be — the same
argument as `make-brand-tokens.mjs --check`, which is why that one exists too.

`$MUSTNOT` is read OUT of the PHP by the generator rather than repeated in it.
Those six files must not be on the server, so they must not be in `$WANT`
either — an entry in both would report `missing` for ever, which is how a real
signal gets trained into noise. One home, and the two cannot disagree.

The generator carries two guards for failures this file already records: it
refuses to write a manifest from a suspiciously short file list, because an
empty manifest reports `same=0/0` and reads like a clean run; and it checks its
own replacement afterwards, because a replacement that matches nothing is a
no-op that looks like success.

**Measured with a fresh manifest on 2026-09-10: `FILES same=182/182 differ=0
missing=0 mustNotBeHere=0`** — the live docroot matches the repository exactly,
every tracked file, and none of the six that must not be there is present. With
the STALE manifest the same server would have reported `differ=8`.

**The general rule:** `differ=0` is not "the server is up to date". Ask for
`missing` too, and treat a file the repository tracks but the server lacks as a
possible dead feature rather than as tidiness. The question "what did we never
send?" has a different answer from "what did we send wrong?", and only the
second one is what a publisher can tell you.

The mkdir that fixed the second case is also the smaller lesson: the first
attempt created `images/<slug>` but not `images/`, because `images/` exists in
the repository and that made it feel like a given. Nine files failed
identically. `ls -d` over cron answered it in one cycle; the shape of a failure
list is a hypothesis, not a diagnosis.

## The Tranportal ID has two homes, and the one you would not guess wins

`knet/config.php` holds it, and so does the `knet` row of the `settings` table
that /backends writes. `knet_apply_saved_id()` lets the **database win**,
silently, falling back to the file on any failure — no database, no table, bad
JSON, a value failing `[A-Za-z0-9]{3,32}`, a placeholder. That direction is
right: none of those may become "this shop cannot take money".

**The trap it created, and I created it.** KNET.md says the commonest go-live
failure is the wrong Tranportal ID and tells you to fix it in `knet/config.php`.
If anything is saved in /backends that edit does nothing, the retry fails
identically, and the ID gets ruled out as the cause. I built the editor and
never touched the setup document.

Arranged on 2026-09-09: KNET.md has a **"Where each setting lives"** table —
all six settings, which are file-only, which has two homes, which wins — and
`/knet/selftest.php` now names the SOURCE of the ID in force, saying outright
when config.php is being ignored. Only the ID has a second home; the password
and resource key are never read from the database.

**The setup instructions were largely fiction.** Of the six files README-FIRST
tells the owner to delete before going live, **five no longer exist** — only
`selftest.php` does, and that is the one that genuinely must go. Worse, step 3
sent the owner to `api/setup-admin.php` to create their admin account, and that
file is gone with **nothing replacing it**: `admin.php` has no create route, it
only answers `no_admin_account` (409). There is no web page that makes the first
account. That blocked the KNET setup, because /backends is now where the ID
lives. README-FIRST now carries the real method — a `password_hash()` minted by
a one-line throwaway PHP file, then an insert in phpMyAdmin, which is exactly
what `sandbox.sh` does.

**A list that is mostly wrong trains the reader to skim it**, and the one true
item on it was the dangerous one. When a file is deleted, grep for its name.

**`knet/selftest.php` was deleted from the live server on 2026-09-09**, on the
owner's instruction, and the shop was unaffected (`home=38561` before and
after). Verified by absolute path rather than by the URL going quiet — an empty
fetch and a failed fetch look identical:

```
knet=callback.php,config.example.php,config.php,knet.php,pay.php
```

It had been sitting on a shop with `knetEnv=production`, where it disables
itself — so it was inert, not leaking. Inert is not the same as gone.

**The delete list is now a CHECK, not prose.** `live-file-check.php` carries a
`$MUSTNOT` list of all six names and reports `mustNotBeHere=`, so any of them
reappearing on the server is measured rather than remembered. Tested both ways:
against the repository, where `selftest.php` exists, it reports
`mustNotBeHere=1:knet/selftest.php`; with the file moved aside — the live
server's real state — `mustNotBeHere=0`. `selftest.php` is also out of the
`$WANT` manifest, or every future run would report it missing for ever, which
is how a real signal gets trained into noise.

### Two ways a fixture can be worthless, both found here in one hour

The precedence test in `knet-test.mjs` went green twice while proving nothing.

1. **An empty fixture.** It ran after the rig had emptied the legacy block, so
   "the database wins" compared `999777` to `''` and "control returns to the
   file" compared `''` to `''`. Both pass whether the code works or not.
2. **A fixture measured through the code under test.** Fixed the first, then
   mutation-tested: forcing `knet_config()` to answer `STUCK` whenever no row
   exists was reported as *"clearing it hands control back to config.php
   (STUCK)"* — green. The expected value came from `knet_config()`, so the
   mutation corrupted the fixture and the assertion in the same stroke.

The expected value must come from somewhere the mutation cannot reach — here,
reading `config.php` directly. **Mutating in one direction is not enough
either:** the first mutation (override removed) was caught immediately, and it
was the second, in the fallback direction, that exposed both holes.

## "do you have sports bras" was read as an order number

In a sportswear shop. `assistant_find_track()` welded any run beginning "sp"
onto the words after it, so SPORTS BRAS became SPORTSBRAS, matched
`SP[A-Z0-9]{6,28}`, and the shopper was answered *"Send me your order number"*.
Measured on 2026-09-09, every one of these was an order lookup: sports bras,
sports bra, sportswear, special offers, spring collection, sponsorship — and
**"can I speak to someone"**, which meant the one message that must reach a
human never did.

**The first fix was wrong, and the existing suite caught it.** It required a
DIGIT, reasoning from `newTrackId()` in checkout.tsx: `'SP'` plus two uint32s in
base36 `padStart(7,'0')`, so a seven-character part starts with `1` and anything
shorter is padded — a digit is guaranteed. The arithmetic is correct and the
conclusion was not: that is only the APP's generator. `api.php` accepts
`/^[A-Za-z0-9]{6,30}$/` from the client, the website's own bundle has no source
in this repo, and the rig's fixture was `SPMTTZNEXARIG`. **Proving a property of
one producer is not proving it of the format.**

The shape of the string no longer decides anything. The candidate is LOOKED UP:
an order that exists is an order number, and SPORTSWEAR is not in the orders
table. A digit survives only as a second chance, so a mistyped number still gets
"order not found" instead of a page of jackets.

### A fixture that only sometimes has the property only sometimes tests it

The rig's track id is `Date.now().toString(36)`, so whether it contains a digit
depends on the millisecond. The digit mutation was caught in the morning
(`SPMTTZNEXARIG`) and passed in the afternoon (`SPMTTZRY12RIG`). The rig now
mints a SECOND order whose id is forced letter-only, and asserts it is
letter-only before using it. Mutation-tested three ways — restore the welding,
demand a digit, drop the mistype fallback — each caught by the check written
for it, and the third only after it was added on purpose.

### Ask it what a customer would ask

Six more routing faults came out of one twenty-four-question probe, and none of
them was a "sorry, I did not follow" — they were all CONFIDENT WRONG ANSWERS,
which is why nothing had ever reported them:

| asked | went to | should be |
|---|---|---|
| my package never came | search — *"couldn't find anything by that name"* | order_status |
| what time do you close today | search | hours (the intent existed; only "open" was listed) |
| can I pay cash when it arrives | delivery | payment |
| is there a discount code | payment | recommend |
| ممكن اغير المقاس بعد الطلب | sizes | returns — exchanges are free for 14 days |
| ابي هديه لصديقي | search | recommend |
| 20 shirts for my team | search | contact, so a person sees it |

`is there a discount code` is the one to remember: `code` contains `cod`, and
the branch twenty lines above the payment list says in as many words *"never
bare 'cod' (that would eat 'discount code')"*. It was written there and the
payment list carried it anyway. **A rule recorded in a comment is not a rule
applied in the code.**

`scripts/live/live-assistant-check.php` asks the LIVE shop all nine, any time,
and writes nothing. A throttled or dead endpoint counts as WRONG there, because
the endpoint is rationed per IP and a check that reads its own throttling as
success is this project's favourite way to be lied to.

## A failing check is a claim, not a finding

`storage-scan.mjs` failed for weeks on this, in these words: *"sporta.delivery
is written to localStorage, which never expires, and the checkout offers no
control — while the privacy page tells the customer it is kept only if they
tick a box."* Every clause of that is checkable and I checked none of them
before building the tick box it asked for.

**The checkout already had one.** Rendered by the bundle, labelled *احفظ هذه
البيانات على هذا الجهاز*, ticked by default, and wired: the bundle carries
`localStorage.setItem(_t, t ? '1' : '0')` and persists the choice at submit,
which is coherent because the address is only saved at submit anyway.

The scan visited `/checkout` **with an empty cart**, where the page renders no
form, no inputs and therefore no checkbox — so its `offers` was false whatever
the shop did. It was never reporting a missing control. It was reporting an
empty bag, and from outside the two are identical.

What I shipped as a result: an overlay adding a SECOND, duplicate checkbox
beside the real one. It was tested, it passed its own rig, and every assertion
in that rig was true. It was also entirely unnecessary, and it has been
deleted. The fix that remains is the one-line-of-reasoning one — the scan now
fills the bag through the shop's own UI before judging the checkout, and says
so when the walk does not take, so "no control" can never again mean "no page".

**The rule.** A check that has been red for a while is a hypothesis about the
code, and the first move is to reproduce its claim BY HAND. That costs one
browser and five minutes. Believing it cost a feature, and the mutation test
that would have caught it — removing my script and watching the scan go red —
is the thing I ran last instead of first: it stayed green, which was the
evidence that my script had never been what made it pass.

This is the same family as "a suite that finds NOTHING is reporting its own
environment", one section up, and the inverse of it: that one is a check that
passes for the wrong reason, this is a check that FAILS for the wrong reason,
and the second is more expensive because it looks like work to do.

### An attribute is advice to the browser. The fault is what the visitor gets

`image-render-audit.mjs` was written to ask what a picture does ON the page, and
its first version failed two things, confidently, and both were false:

- **"No `width`/`height` on the hero and the four tiles"**, on the grounds that
  an unsized box jumps when the bytes arrive. The home page's CLS is **0.0002**
  and no image is in it: every one of those images is `position:absolute` inside
  a sized frame, so it is out of flow and cannot move anything, attributes or
  no attributes.
- **"`loading=lazy` on two tiles in the first screenful"**, on the grounds that
  the visitor waits for them. Measured at 390px with nothing scrolled, all four
  tiles are requested at **+202ms** alongside everything else — Chrome fetches
  an in-viewport lazy image at layout, so the attribute cost nothing.

Both read an ATTRIBUTE as though it were the FAULT. The attribute is advice; the
fault is the visitor's experience, and only the second one is worth failing a
build over. So each check now measures the visitor's side — a real shove, a real
unfetched image — and the shop passes, because the shop was never wrong.

**Getting there took three wrong instruments, and only mutation testing found
any of them.** Worth keeping, because each looked right:

1. **Reading the shift's `sources` for an `<img>`.** A layout-shift entry blames
   the elements that were DISPLACED — everything BELOW the image — and the image
   that grew is frequently not in that list at all. Wrong list.
2. **Watching for the growth on localhost.** The bytes arrive inside the first
   animation frame, so a ResizeObserver never sees two different heights. The
   fault only exists on a slow connection, so the rig now holds every image back
   700ms and reproduces the shopper's one. **A fault you cannot make happen is a
   fault you cannot measure.**
3. **`observe(document.documentElement)` from an init script.** Measured:
   `documentElement` is **null** that early, so `observe` threw
   `parameter 1 is not of type 'Node'`, killed the rest of the function, and the
   ResizeObserver was attached to NOTHING. The rig then reported
   `ok  no in-flow image grows` against a page visibly shoving itself about —
   twice — because **zero observations and no faults produce identical output.**

That third one is this repository's oldest lesson wearing a new hat, next to the
route extractor that dropped a capital letter and the suite that found 0
controls. The fix generalises: **a watcher must assert that it watched.** The rig
now carries `the size watcher actually observed images on every page` — `65
observations` on a good run — and it is checked BEFORE the result it guards.
Mutation-tested in three directions: an unsized in-flow image (caught, 0px→79px),
the same image absolutely positioned (correctly passes — out of flow is not a
fault), and the watcher itself disabled (caught by the observation count, not
read as green).

Reported rather than failed, for the owner: `/shop` measures **CLS 0.15 at
1280px**, and it is not an image. The blame is an `::after` growing 0→194px,
with the cards themselves not moving. At 390px it is 0.0009.

**AND THE EXPLANATION ATTACHED TO IT WAS WRONG — corrected 2026-09-10.** It said
the cause was "the product grid arriving after its fetch" and that the fix was
to reserve the grid's height. Both are false, and I nearly spent an afternoon on
the second before checking the first:

- **The grid does not arrive late.** Measured from `domcontentloaded`: the
  section is 1388px tall in the first snapshot, with all twelve cards in it.
  Aborting `?r=products` outright changes nothing — the page renders populated
  regardless.
- **The `::after` is `position: absolute`** on the product-card link, an empty
  decorative overlay. The shift entry shows it going `y0,h0 -> y706,h194` while
  every OTHER source in the same entry has IDENTICAL rects — `706,194 ->
  706,194`. They are listed as displaced and did not move a pixel.
- **Nothing on the page moves at all.** The honest check is not the metric but
  the visitor: sampling the real y of the heading, the first card, the fifth
  card and the footer every 100ms from first paint gives `216 216`, `229 229`,
  `706 706`, `1847 1847`. Not one of them shifts.

So the 0.15 is a METRIC ARTEFACT: an out-of-flow pseudo-element gaining size
scores as instability and cannot displace anything. This file already carries
the rule twice — *"out of flow is not a fault"*, and *"an attribute is advice to
the browser; the fault is what the visitor gets"* — and the note above was
written in defiance of both, by reading the `sources` list as though it named
the culprit. **A layout-shift entry names what was DISPLACED, and when nothing
moved it names them anyway.**

Nothing to fix. If it is ever worth silencing the number for a Lighthouse
report, that is cosmetics on a metric, not a repair to the shop — and it belongs
in the bundle, which has no source here.

### A headless browser has a MOUSE, so every `pointer: coarse` rule is inert

Asked on 2026-09-10 to check every box, icon and text and fix anything very
large. Nothing was large — text tops out at 46px, icons run 12–22px with one
56px empty-cart illustration, cards are exactly 4:5, and no page scrolls
sideways in either language. What the scan DID report was eleven controls under
the 44px tap target: the bag at 22px, close at 22px, the language toggle at
28px, the hero's arrows and pause at 32px and its five dots at 24px.

**All eleven were already fixed, and the fix was already correct.** There is a
`carousel targets` block in `sporta-ui.css` that grows the arrows and the pause
button to 44x44 with a transparent overlay, and the site's own `.tap` helper
does the same for the header controls. Both live inside
`@media (pointer: coarse)` — which is right, because a mouse is precise and a
thumb is not. Playwright's default context reports a FINE pointer, so the media
query correctly did not match and the rig measured the un-widened boxes.

`hasTouch: true, isMobile: true` is what makes it match. With it, the under-44
list drops from 15 to the dots (24x44) and some product-title links inside
cards that are themselves 175x219 and clickable in full.

**I had already re-derived, from scratch, the exact reasoning that block
records** — that the dots sit on a 26px pitch, so a 44-wide hit area would
overlap its neighbour and a tap near the edge would select the WRONG slide,
which is worse than a small target because it does the wrong thing rather than
nothing. The block says so in its own words, and adds the part I had not got
to: at 24x24 the dots already meet WCAG 2.5.8 (AA), and it is 2.5.5 (AAA) and
Apple's 44 they miss, and closing that needs the dots spaced further apart,
which is a change to the hero's design and the owner's to make.

So this is the duplicate-checkbox mistake with a different mask: **an
environment default made a working feature look absent.** The scan was not
measuring the shop, it was measuring a browser that has no fingers. Before
reporting a control as too small — or a media query's effect as missing —
emulate the condition the rule is written for, and check whether the fix is
already there. `grep -n 'pointer: coarse'` would have answered it in one
command, and I ran the browser first.

The general form, which this file keeps rediscovering: **a rule that is
CONDITIONAL is invisible until you reproduce its condition**, and a rig that
does not reproduce it reports the condition's absence as the code's.

## The hero shows the whole banner now — and a dead declaration sent me wrong

Asked for on 2026-09-17 as "make hero slider images full size". The box was
taller than the artwork at most widths, so `cover` cropped the sides: **75% of
the banner visible at 768, 83% on a phone, 94% at 1280.** The owner chose the
whole picture at every width out of three measured options, knowing the phone
cost (186px of a cropped banner becomes 155px of a whole one). The box is now
`100vw / 2.52` and nothing else — the 1.90 ratio, the 60svh cap and the
min-height floor are all gone, and `max-height: none` was needed because the
BUNDLE ships its own `md:max-h-[80svh]` that a bare deletion would have left to
crop the other way.

**It made the picture sharper, which was not the reason for it and is worth
keeping because it is counter-intuitive.** `cover` over a box TALLER than the
artwork magnifies the image to cover the height and throws the magnification
away off the sides; a box at the artwork's ratio scales it once, to fit. Source
pixels per CSS pixel, same run: 768 `1.43 -> 1.89`, 1280 `1.07 -> 1.14`, phone
`2.33 -> 2.80`.

### `--hero-h` had TWO `:root` declarations 1200 lines apart

The one at the top of `sporta-ui.css` was DEAD — same selector, same
specificity, later wins — and had drifted to `2.10 + 128px` against the live
`2.10 + 104px`. **I read the dead one, measured the phone, and reported a 24px
shell-versus-mount gap that was not happening**, in the file that documents that
exact failure at length. The duplicate is gone; there is one home now.

The general form, and this file keeps meeting it on new surfaces: **before
believing a declaration, ask whether anything later overrides it.** `grep -n`
for the property answers it and `getComputedStyle` answers it better. A value
read out of a file is a hypothesis about what the browser is using.

### The resolution ceiling is the artwork, and no rule here can move it

The five frames exist only at **1600px wide**. At 1600 the box is 1760 CSS px,
at 1920 it is 2112, at 2560 it is 2816 — so the banner is upscaled **before a
retina screen doubles anything** (0.91, 0.76, 0.57 source px per CSS px).
`make-hero-sizes.mjs` says in its own header that the desktop master is the only
copy of this artwork and refuses to upscale, and that is the right refusal:
shipping a 3200px file made from a 1600px one would make every rig report the
upscale gone while the shopper sees the identical softness, at four times the
bytes. **A measurement that improves because you enlarged the input is not an
improvement.**

`test:hero-size` therefore PRINTS source px per CSS px and asserts it only on
the phone, where the right file already exists. The desktop number is reported,
not failed, because no change in this repository can clear it — the owner is
supplying 3200x1270 masters for `hero/desktop/`.

Its third check changed with the design: "the 60svh cap still binds at
1280x900" became **"the box ratio equals the artwork's at every viewport"**,
which is stronger than the pair it replaces — a crop in EITHER direction fails
it, and it is measured against the image's own `naturalWidth/naturalHeight`, so
a wider banner keeps testing the truth. Mutation-tested both ways: the 1.90
ratio back (75% visible) and the cap back (73-85% of the height), each caught by
name.

**A latent one, not touched:** `build:hero` rebuilds the app's bundled banners
from `hero/mobile/`, which `make-hero-sizes.mjs` has since reduced to 1200px.
`assets/hero/*.jpg` are 1600px because they were built before that. Running
`build:hero` today would quietly DOWNGRADE the app's art, and nothing would say
so.

### An empty cron output, and the work had been done

The publisher printed nothing across three ticks. Every instinct said it had
failed; `sha256sum` over the four files by absolute path said all four were
byte-identical to the repository. **The write had landed on the first run and
the channel simply lost the echo** — the entry above about the last run's output
wearing a new hat, with the added trap that this time the silence looked like a
failed publish rather than a successful one.

What settled it in one cycle was asking for **state, not the verb**: two
`sha256sum`s with absolute paths, no quotes, no `$`, no `%`. That is the shape
to reach for when a publisher goes quiet, and it is cheaper than re-running it.
`sw.js` being LAST in the write loop is what made the inference safe before the
check even ran — the loop breaks on any failure, so the last file matching means
every earlier one did.

**Echo as you measure, not at the end.** A script that builds one line and
prints it last reports NOTHING when its run is cut short, and a script that
prints per step reports what it got. `live-asset-freshness.php` went silent
twice with a single trailing `echo` and answered on the next try with a flush
per line and fewer requests. The cause was never proved — the same wget-and-php
shape works for other scripts — so treat it as a property of the channel and
write for it rather than trusting a single trailing echo.

### "Refresh the CSS" — asked on 2026-09-17, and there was nothing to refresh

The honest answer was a measurement, not an action. `live-asset-freshness.php`,
origin against the shopper's path through hcdn:

```
/assets/sporta-ui.css  origin=200/110276/a6d967a1a3f5  edge=200/110276/a6d967a1a3f5  same=yes  cdn=BYPASS  cc=no-cache,must-revalidate
/sw.js                 origin=200/18887/6e8a6e66dd54   edge=200/18887/6e8a6e66dd54   same=yes  cdn=BYPASS  cc=no-cache,must-revalidate
```

Both match the repository, the edge matches the origin, and the CDN is not
caching either of them. **There was no stale copy anywhere the shop controls**,
so clearing the Hostinger cache would have been a no-op dressed as a fix — and
would have "worked", in the sense that the next look would have shown a correct
file, which is how a non-fix earns credit for someone else's cache expiring.

The only place a stale stylesheet can still live is a visitor's own browser
under an OLD service worker, which no server-side purge can reach and only a
`VERSION` bump frees. **A private tab settles it in ten seconds**, because it
bypasses the worker — that is the thing to ask for before touching anything.

## A cap is not a ratio, and on a wide screen it cropped the banner the other way

The hero's height had moved eight times and nothing had ever measured it.
Every line of the two hundred in `sporta-ui.css` reasons about a box TALLER
than the artwork's 2.52:1 — it crops the SIDES, the crop is pinned at 15%, and
the banner's typography lives in the left half and survives.

**`min(100vw/1.90, 60svh)` stops being a ratio the moment the cap binds.** On a
wide window the box came out WIDER than 2.52, so `cover` cropped the HEIGHT
instead — and `object-position` is `15% center`, so it took equal bites off the
top and the bottom. Measured 2026-09-10:

```
1280x900    box 2.37:1   100%   (cap not binding — the window it was tuned on)
1920x1080   box 2.96:1    85%   7.5% off the top and the bottom
1600x900    box 2.96:1    85%   every 16:9 screen, which is most of them
1440x700    box 3.43:1    74%   "STRENGTH · MUSCLE · POWER" clipped off the bottom
```

**16:9 is the commonest desktop shape there is, so this was the NORMAL case,
not an edge one** — and it had been invisible because the whole discussion in
that file, including the part that chose 60svh, was about the other axis. A
constraint added for one reason silently inverted a property three sections of
comments depend on. When a cap is added over a ratio, ask what happens at the
end of the range where the cap wins, not just at the one that prompted it.

The owner chose the full-bleed banner out of three rendered options — bars at
the sides, a taller hero, or leaving the crop. So a FLOOR went under the cap:

```
height = max(100vw / 2.52, min(100vw / 1.90, 60svh))
```

The cap survives everywhere it is not itself the cause; it only loses on a
window wide enough that honouring it would cut the artwork. 1280x900 is still
540px and still 60%. 1920x1080 goes 648 → 762 (60% → 71%) and 1440x700 goes
420 → 571 (60% → 82%), which is taller than the 70svh rejected earlier and is
the trade that was picked with those numbers in front of the owner.

**2.52 is the artwork's own ratio, so the floor is the shape of the picture
rather than a number to taste.** A wider banner is the one change that would
dissolve the trade entirely, and it is the owner's to supply.

### The shell and the hero had disagreed by up to 152px, in two files

`index.html` paints a `.boot-hero` before React exists and `sporta-ui.css`
sizes the real one. The file says at length that moving one without the other
makes the page jump at mount — *the single failure the boot script exists to
prevent* — and the two had carried different formulas for as long as
`sporta-ui.css` has been published:

```
768x1024   305 vs 404     1280x900   508 vs 540
1920x1080  762 vs 648     2560x1440  1016 vs 864     390x844  283 vs 290
```

The stylesheet overrides `--hero-h-md` with `!important`, which beats a normal
inline property — so the boot script's value stopped deciding anything the
moment the stylesheet loaded, and what it still decided was the FIRST frame.
Both files now carry the same formula, on both axes.

**CLS cannot see this and never reported it.** The shell is REMOVED wholesale
and the app painted in its place, so nothing "moves" by the metric's
definition — `index.html` says so in its own comment. It is only ever visible
to a person. A rule that two files must agree needs a test, not a comment in
each of them.

`npm run test:hero-size` measures eight real viewports and asserts three things:
the box is never wider than the banner (against the image's OWN
`naturalWidth/naturalHeight`, so a new banner keeps testing the truth rather
than a number copied out of a comment), the shell matches the mounted hero, and
the cap still binds at 1280x900 — because a floor that quietly swallowed the cap
would hand back the tall hero the owner cut twice. Mutation-tested three ways:
the floor removed (reproduces the original 85%/73% crop exactly), the shell left
behind, and the cap removed — each caught by the check written for it.

**Editing the boot script means editing the CSP hash**, per the section above,
and `test:csp` caught it both times. One hash in, one stale hash out.

## A collector you cannot trust to expire late cannot be trusted not to expire early

Asked on 2026-09-10 to make signing in to /backends easier. **My first
measurement was wrong and I nearly built on it:** I read PHP's
`session.gc_maxlifetime` (1440s), found nothing overriding it, and reported "24
minutes idle". The real timeout is `STORE_ADMIN_IDLE_SECONDS` — the app runs
its own two clocks, idle and absolute, and `store_session_admin()` says so in a
comment I had not read yet. **Reading the platform default is not reading the
program.**

But there was a real fault underneath, and it is the interesting half.
`store_session_admin()` does its own timing, and its reasoning is right:

> *"Expiry is ours rather than PHP's garbage collector's, because that
> collector is shared hosting's to configure: its lifetime is whatever the host
> set, it only runs probabilistically."*

That argument stops one line short. A collector you cannot trust to expire a
session LATE is the same collector you cannot trust not to expire one EARLY.
Nothing set `gc_maxlifetime`, so PHP's 1440-second default stood: **the session
FILE was deletable after 24 minutes idle**, and the 8-hour window above it was
a ceiling nobody could reach. The panel signed you out mid-afternoon for a
reason nothing in the file mentioned — and every existing auth test passed
throughout, because they all sign in and act within seconds.

Fixed by setting `gc_maxlifetime` to the idle constant, and **raising it cannot
lengthen a session**, which is exactly what makes it safe: `store_session_admin()`
is still the only thing that decides, and it still ends the session at idle or
absolute. All it buys is that the file survives long enough for that decision
to be the one taken. Idle went 8h → 12h at the owner's request; the absolute
7-day clock and the session cookie (`lifetime => 0`, so browser close still
signs out) are the owner's explicit choice and unchanged.

**The one case it does not cover** is a `save_path` shared with other accounts,
where somebody else's collector reaps our files on their lifetime. Hostinger
gives each account its own path, so the setting governs — but if sign-ins start
expiring early again, measure that rather than re-reading this line.

`npm run test:session-life` holds it. The assertion that matters is not the new
number but the second one: a longer collector window is precisely the change
that buys convenience with security, so the rig drives a REAL session past the
idle limit — by ageing `seen_at` in the session store, so the server's own clock
decides rather than a constant being compared with itself — and requires `me` to
come back null and a data route to 401. It also asserts a fresh session stays
alive first, or that check would pass on a server that refuses everybody.
Mutation-tested three ways: the collector back at 1440 (caught), the expiry no
longer enforced (caught — `me` answered with the account and `stats` returned
200), and the cookie made persistent against the owner's choice (caught).

**The login form was already right** and needed nothing: a real `<form>`,
`autocomplete="username"` and `autocomplete="current-password"`, a submit
button. Password managers could always fill it. The friction was never the
form, and the first thing to check when someone says a login is tedious is how
long the last one lasted.

## Card payment is pointed at the REAL bank with placeholder credentials

Measured 2026-09-09 by `scripts/live/live-pay-check.php`:

```
PAY client_id=PLACEHOLDER client_secret=PLACEHOLDER encrp_key=PLACEHOLDER
    env=production gateway=pg.cbk.com payType=shopper-chooses returnUrl=ok
```

Somebody copied `pay/config.example.php` to `pay/config.php`, set `env` to
production and the return URL correctly, and never filled the three
credentials. So the shop is aimed at CBK's LIVE gateway — `pg.cbk.com`, not
`pgtest` — while carrying `YOUR_CLIENT_ID`. **Both KNET and T-Pay would fail at
the Authenticate call**, and they fail for a shopper who has already chosen a
payment method and typed their address.

Nobody has met it because the shop has taken no orders. That is luck, not
safety.

**"Present" is not "configured", and this is why the check reports PLACEHOLDER
as its own state.** Every value here is non-empty, so any check asking merely
whether a key is set would call this ready. `config.example.php` ships
`YOUR_*` and the sandbox ships `SANDBOX_NOT_A_REAL_*`; both are present and
both mean the shop cannot take money.

### T-Pay and KNET are ONE integration, not two

Worth knowing before anyone goes looking for a T-Pay SDK. `pay/cbk.php`
implements CBK's hosted gateway from the Integration & Reference Manual v2.93,
and the two payment methods are the same credentials, the same
`/ePay/api/cbk/online/pg/merchant/Authenticate` call, the same
`/ePay/pg/epay?_v=<token>` checkout and the same verify — with
`tij_MerchPayType` choosing the face: `''` shopper chooses, `'1'` KNET,
`'2'` T-Pay QR. `store.php` routes `tpay` to `?paytype=2` and
`payments-test.mjs` pins it.

So there is nothing to BUILD for T-Pay. What is missing is commercial: the
merchant agreement and the three credentials.

**The one thing not verified against a primary source** is that `2` is T-Pay.
The `tij_*` names are corroborated by independent third-party CBK integrations,
and CBK's own material confirms the gateway serves both KNET and T-Pay QR — but
no public source states the numeric mapping, `www.cbk.com` is blocked by this
environment's egress proxy, and the manual is not in this repository. It is
asserted in a comment and pinned by a test, which is not the same as confirmed.
Ask the bank.

**Now confirmed, 2026-09-18.** The owner supplied the manual directly, plus
KNET's own K-064 manual alongside it, rather than it needing to be fetched
from a blocked host. Page 9, "Payment Mode Reference": `1` = KNET, `2` = CBK
T-Pay QR, both KWD-only, in so many words. The code had it right.

**Both manuals were briefly committed to `sporta-site/reference/` and then
REMOVED the same day — do not re-add them.** The K-064 manual's own second
page requires an NDA before it is shared with a third party, and its cover
forbids reproduction without KNET's permission; the CBK manual carries the
same "all rights reserved" framing. This repository is public. They now live
only in the owner's own storage.

**Left open by this**: the manual in hand is v3.02 and every comment in this
codebase citing a version says v2.93; nobody has gone through the newer manual
parameter by parameter against `pay/cbk.php` yet, only spot-checked the field
names already in use. See `KNET.md`'s own note at its top for the fuller
account.

**A second artifact arrived the same day and was NOT committed at all.** The
owner also supplied `API-Libraries.rar` — KNET's official `iPayPipe` Java/.NET
library (Java `.jar` plus IKVM-bridged `.dll`s), the thing K-064 §3.2.1 calls
the "library based" plug-in. Same restriction, same reasoning: KNET's own
copyright notice, this repository public. It was decompiled read-only, in a
scratch directory outside the checkout, to answer one question — see below.
Nothing from it was ever written into this repository.

**What decompiling it found, and why it matters.** `knet/knet.php` encrypts
`trandata` with a FIXED constant IV, `'PGKEYENCDECIVSPC'`, commented "16
bytes, fixed by KNET." The official library's `AESAlgorithm.encryptAES`
does not do that: it builds the IV from `new IvParameterSpec(key.getBytes())`
— the SAME Terminal Resource Key used as the AES key, not a separate fixed
string — and `iPayPipe`'s own trandata-building method confirms `key` is set
straight from the resource file's `resourceKey` value with nothing else
mixed in. Checked in both directions: the decrypt path
(`parseEncryptedRequest` → `AESAlgorithm.decryptAES`) uses the identical
key-as-IV derivation. Nowhere in the decompiled library, and nowhere in the
K-064 manual's text, does the string `PGKEYENCDECIVSPC` or any other
FIXED IV appear.

**This was found, not fixed.** `knet.php`'s legacy Tranportal path is the
project's own documented fallback — never the primary route, kept tested
rather than deleted — and nobody has ever run a real transaction through it
to notice. Reading a decompiled library correctly is not the same as having
tested against the live gateway with real test credentials, which this
environment cannot reach. Rewriting the crypto on the strength of a
decompilation alone, with no way to confirm the fix against
`kpaytest.com.kw`, would be trading one unverified claim for another. The
owner needs to know this before the Tranportal path is ever relied on: if the
comment's fixed IV is wrong, every `trandata` blob this code has ever built
would fail to decrypt at KNET's end, silently, exactly the way a wrong
Tranportal ID already does per the section above.

## A hero slide is a ROW, not a file — and raw.githubusercontent will not take a short SHA

Published the all-black banner as the shop's hero on 2026-09-11. Three things
came out of it, and two of them contradict something that had been assumed.

**`/hero/*.webp` is not the hero.** Those five files are painted by
`index.html`'s boot shell before React exists; the React hero reads
`?r=slides`, and a photo slide lives in `hero_slides.image` as a data: URI
served through `?r=slide_image`. api.php says so in its own words — *"this is
what makes storing images in the database cost the same as storing them as
files, and it is why nothing on this server needs write access to the web
root."* So publishing a hero is a DATABASE write, `scripts/publish/publish-hero-slide.php`,
and the artwork belongs OUTSIDE `public_html` (`assets/hero/`) or it becomes a
tracked docroot file the server must also hold for nothing.

**With no rows the bundle falls back to five DRAWN slides**, so adding the
first photo is not "another slide in the carousel" — it is the moment the front
page stops showing drawn art. One active row means one slide, and the arrows
and dots hide themselves at `b > 1`.

**Every text column is left null**, because the headline is burnt into the
artwork. Filling `title_ar` would draw the shop's overlay on top of type that
is already there, in another font at another size.

### The abbreviated SHA answers 404, silently

`raw.githubusercontent.com/<owner>/<repo>/21e4687/<path>` returned **404 three
times running** while the same artwork at the full forty characters returned
200. Other publishers here carry short shas and happened to work, which is
worse than failing outright: **an unresolvable ref is an EMPTY FETCH**, and this
file already records a publish lost to exactly that — a branch name with a
slash in it, read as a ref, returning nothing and saying nothing. It was caught
here only because the publisher checks the HTTP code before the hash.

So: **pin the full sha, and check the code, not just the bytes.**

### The phone hero HALVES when the slide is a photograph

Measured in a browser at 390x844, the same page with the row on and off:

```
photo slide   390x155     desktop 1280x540
drawn slides  390x290     desktop 1280x540
```

Desktop is identical; the phone loses half its hero. The cause is that the
hero's min-height is `md:min-h-[…]` — it applies only from 768px — so below
that the image's own 2.52:1 ratio sizes the box. Setting `image_w`/`image_h`
to null changes nothing; it is the rendered aspect, not the attributes.

**And it cannot be fixed by cropping.** A phone box at the drawn slides' 1.34:1
with `cover` would show about half the banner's width, cutting either the
headline or a model. A wide banner is wide. The real answer is a phone
composition of its own, and the schema holds ONE image per slide — so it is a
design decision for the owner, not a number to tune.

**Undoing the publish is one statement**, which is what made it reasonable to
ship and then report: `update hero_slides set active = 0 where id = 1`.

## "Not fetched" is not "not needed" — the category image audit, 2026-09-11

Asked to check every category image and remove any that were not needed. **None
were**, and getting to that answer took being wrong twice in the same hour, both
times in the direction of deleting something real.

The inventory is 7 names × jpg+webp × desktop+mobile in `cats/`, plus 5 × webp ×
2 crops in `hero/`. A browser was asked what it actually fetches, in both
languages and both crops:

- **Only `.webp` is ever requested. Not one of the 14 jpgs.** Which reads as
  fourteen dead files — until the `<picture>` markup is dumped, and every tile
  carries `source[image/jpeg]` with `img.src` pointing at the mobile jpg. They
  are the no-webp fallback. **Declared and never fetched is the normal state of
  a fallback**, which is exactly the entry above about four font faces, reached
  from the opposite side.
- **Four of the five hero files looked dead too**, and that was worse reasoning:
  they are named in the bundle only as slide IDS, so a grep for a path finds
  nothing. But the bundle composes the path — `zn='/hero'`, `Bn='.webp'` — and
  the other four are simply the carousel slides that had not come round inside a
  1.5-second wait. Advancing the carousel by hand fetched all ten.

So the rule, which this file keeps re-learning on new surfaces: **a fetch log is
a record of what one visit needed, not of what the shop needs.** Ask the markup
what is DECLARED and the code what it can COMPOSE before calling a file unused.

**The one genuinely unneeded image is not in the repository.** It is
`cats/desktop/outlet.jpg` on the live server — the stray bridging duplicate,
still there, still byte-identical to `art-outlet.jpg`. Three removals have been
undone by something that is not this account, so it stays until the owner finds
the writer.

**And one real waste, which is a fetch rather than a file.** An Arabic visitor
downloads BOTH women's compositions — the bundle renders `art-women.webp` and
`tile-art.js` then swaps to `art-women-rtl.webp`. ~25 kB desktop, ~18 kB mobile,
on the shop's default language. `tile-art.js` acknowledges the cost in its own
header; removing it needs the bundle, which has no source here.

## An extension the owner is likely to use, that the shop could not see

`images/<slug>/logo.*` is the owner's ONLY upload route that needs no panel, and
it matched exactly three names — `logo.png`, `logo.webp`, `logo.jpg` — with
`is_file()`. **Linux is case-sensitive**, so `logo.PNG` and `logo.JPG` were
invisible, and so was **`logo.jpeg`**, which is the commoner spelling and what
most export dialogues produce. The folder is right, the picture is in it, and
the shop serves a placeholder for ever. `brandLogos=0/8` is consistent with
exactly this, though it does not prove it.

**The second half is that finding the file is not enough.** The route sends
`X-Content-Type-Options: nosniff`, so a `Content-Type` that does not match the
bytes is not a detail — the browser REFUSES to draw the image. The type came
from a map keyed on the extension ending `?? 'image/png'`, which means:

- any extension added to one list and forgotten in the other is served as a PNG
  and cannot render — **mutation-tested, and `logo.jpeg` comes back as
  `image/png`**;
- an owner who exports a PNG and saves it as `logo.jpg` hits the same wall from
  the other side.

Both are fixed by reading the file's own first bytes, which is the check
`store_data_image()` already makes of an uploaded data: URI — so the two ways
into this shop now agree about what an image is.

**And the fallback in the fix was the bug wearing a hat.** The first
`store_brand_logo_mime()` ended `?? STORE_BRAND_LOGO_TYPES[extension]`,
reasoning that a file too short to identify should still be served under its
name. Its own rig caught it on the first run: a PHP source file called
`logo.png` was served as `image/png`. **"Too short to identify" and "not an
image" are the same thing to any browser that has to draw it.** There is no
fallback now; null means do not serve, and the route falls through.

## One policy, two definitions, and they disagreed about ten real garments

Asked to review the delivery and returns policy on 2026-09-11.

**`?r=products` labelled products from the `products.no_exchange` COLUMN, while
`store_return_lookup()` and the size adviser both decided with
`category === 'women'`.** Each half was self-consistent, nothing compared them,
and on the live catalogue they disagreed:

```
accessories  no_exchange=0   n=4
men          no_exchange=0   n=12
outerwear    no_exchange=0   n=1
outerwear    no_exchange=1   n=10   <- column says no, category says yes
women        no_exchange=1   n=19
```

So the shop TOLD the shopper ten jackets could not be exchanged and then
accepted the exchange. The owner chose the category as the rule, and it is the
right half: it is what is ENFORCED, what all three customer-facing strings say,
and **the only one of the two anyone can influence — `admin.php` contains no
`no_exchange` at all**, so the column cannot be edited in /backends. A flag
nothing can set and nothing enforces is not a policy; it is seed data being
shown to customers.

`npm run test:no-exchange` is a **parity** test, not a behaviour test. It does
not assert that women's clothing is the rule — that is the owner's and it may
change — it asserts the listing and the returns path give the SAME answer for
every product, which is the property that broke. It refuses to pass on a
one-sided catalogue, because a shop with no women's wear agrees with every rule
ever written.

### The storefront reads none of the nine rules

The "make full dynamic" work moved nine numbers into a settings row and
published six of them on `?r=slides`. **The storefront bundle does not read them.**
Zero occurrences of `rules`, `return_days`, `delivery_fee_fils`,
`free_delivery_fils` or `governorates` — only `assets/rules.js`, which is the
panel card. Measured by setting `return_days` to 3:

```
store_return_window  delivered 5 days ago -> open=false  days_left=0
/returns  (ar)       "استبدال مجاني خلال ١٤ يومًا من الاستلام"
/returns  (en)       "Free exchange within 14 days of delivery"
```

The code enforces the owner's number and the page goes on promising fourteen.

**Exactly two of the nine are stated in fixed copy** — the returns window and
the six governorate names. No fee and no free-delivery threshold appear
anywhere, so the other seven are safe, and that was worth measuring rather than
assuming: it decides how much of this matters.

**Dropping a governorate is the worse of the two.** `api.php` validates it and
fails `invalid_governorate` at `?r=order`, while the checkout still lists all
six — so the customer fills in the whole form, chooses a payment method, and is
refused at the last step. That is the same shape the rules section already
worried about for SIZES, and it is real here.

The owner chose a warning over locking the fields, so both panels now say so on
those two fields, where the owner is standing when it matters. **A warning in
the panel is not a fix** — the fix is a bundle that reads the rules, and there
is no source for it here.

**Fixed from outside the bundle, 2026-09-28** ("make backend full dynamic"):
`assets/rules-live.js` rewrites the returns-window and delivery-fee copy from
`?r=slides` (Arabic count agreement included — "٣ أيام", not "٣ يومًا") and
hides+disables switched-off governorates in the checkout `<select>`, resetting
an area auto-fill that lands on one through React's own change event. It is a
no-op at the shipped defaults. `test:rules-live` covers it, mutation-tested
three ways. **Still fixed copy:** "24 hours" delivery time (not a rule), and
the Expo app's own strings. The bundle prints prices with a NO-BREAK space
(U+00A0) — a rig matching a literal space fails on a correct page.

## api/deploy.php — the HMAC secret was world-readable, 2026-09-11

The endpoint that can write into the live web root, audited after "fix api
deploy". It is now TRACKED (`sporta-site/public_html/api/deploy.php`), which it
had never been: it was on the server and in no commit, so nobody could review,
diff or restore the one piece of PHP on this shop that deploys files.

**Committed verbatim FIRST, and the base was proved rather than assumed.** The
transcription's sha256 was compared against the server's own —
`368355e52ec4fe2c…` both sides, 240 lines and 8,347 bytes either way — before a
line was changed. A diff is only readable against a base that is genuinely the
base, and on a file like this that is not a nicety.

### The finding that mattered was a file mode

```
secret=yes/64b/0644/readable      <- deploy.php's own header says 0600
manifest=none  artifacts=0        <- it has NEVER successfully deployed
log=3  all FAIL bad_signature
GET=405/method_not_allowed
```

`storage/deploy.secret` is the 64-byte HMAC key authorising deploys, and it was
**0644 on shared hosting**, where "world" is other accounts on the same machine.
Anyone holding it can put files on the shop.

Set to 0600. That is safe without asking because chmod only REMOVES access, and
only from everyone except the account PHP runs as — there is no configuration in
which 0644 works and 0600 does not.

**ROTATION IS A SEPARATE QUESTION AND IS THE OWNER'S.** Tightening the mode does
not un-expose a key that was readable for an unknown time; only a new secret
does, and the owner has to carry it to whatever signs the requests.

**The `GET=405` is not evidence the deploy works.** It only proves PHP executed
the file — the endpoint answers 405 identically whether the secret is present,
missing or wrong. `manifest=none artifacts=0` is the number that says it has
never once run to completion, and reading the 405 as health is this project's
favourite mistake in a new costume.

**And it exonerates deploy.php of the outlet tile, harder than before.** All
three log lines are `FAIL bad_signature` and nothing was ever written. Two are
from the same Hostinger IPv6 one minute apart — the cadence of a per-minute job
failing — and one from a Google Cloud address.

### Three defects, and only one of them was reachable

- **The size cap did not bind on a chunked response.** PHP hands the progress
  callback `(handle, downloadTotal, downloaded, …)` and it read only the second
  — the total the server DECLARES. `codeload.github.com` is allow-listed and
  answers archives chunked, declaring none, so the 200 MB limit never fired
  while the body streamed to disk.
- **The protected-path check on zip entries was inert for every archive it is
  for.** `isProtected()` tests the FIRST path segment, and every entry in a
  GitHub archive is nested under `wain-<sha>/` — so the first segment is the
  wrapper and never `api`. Not exploitable, because the publish loop re-checks
  after collapsing the wrapper and that is what has actually been refusing
  protected paths. **A dead layer that reads as a live one is worth less than
  nothing**, and a 422 naming the entry before extraction beats silently
  skipping the file afterwards.
- `str_replace($stage, '', $path)` removes the staging path from anywhere
  rather than the front.

### The mutation test found a hole in the rig, which is the point of running it

`test:deploy-endpoint` runs the real endpoint over a real PHP server for the
guard chain, and EXTRACTS `isProtectedEntry` from the file under test rather
than copying it — a copy goes on passing after the original breaks.

Then reverting the CALL SITE to the old `isProtected($n)` **passed all thirteen
checks**, because a rig that exercises a function never notices which function
the program calls. A correct helper nobody calls is precisely the inert layer
the fix removed, restored. A fourteenth check reads the staging loop; all four
mutations now fail, each naming its own cause.

**What the rig cannot drive is named in its header rather than skipped
quietly.** The download, checksum and extraction need an artifact on one of
three GitHub hosts, so they cannot be driven from a local fixture without
weakening the allow-list — which would be changing production to suit a test.
The size cap is guarded structurally, and that is weaker than a measurement.

**The publisher refuses an unexpected base.** If the live file is neither the
base the change was built on nor the result, it stops with
`REFUSED-UNEXPECTED-BASE` rather than discarding somebody else's edit, and it
keeps the old copy in `storage/` as the rollback.

### The endpoint was never the problem. Nothing could talk to it

`scripts/deploy-sign.mjs` is the half that did not exist, and its absence is the
whole reason for `manifest=none artifacts=0` and three log lines of
`FAIL bad_signature`. Four things make a signature verify, each easy to get
wrong and each producing the same opaque error:

1. **The HMAC is over the EXACT REQUEST BODY BYTES.** Serialise once, sign that
   string, send that string. Re-serialising between the two — a different key
   order, a space after a colon — changes the hash and nothing says so.
2. The header is `X-Deploy-Signature`, value prefixed `sha256=`.
3. The secret is `trim()`ed on the server, so a trailing newline is fine
   *because both sides trim*.
4. `ts` is SECONDS. Milliseconds land ~55,000 years out and are refused as
   `stale_request`, which at least names itself.

Mutation-tested by breaking 1, 2 and 4 in the client: the first two produce
`bad_signature` — **exactly the error in all three live log lines** — and the
third `stale_request`. So the shop's dead endpoint is fully consistent with a
client making one of these, rather than with anything wrong on the server.

**The secret is never accepted on the command line**, where it would sit in
shell history and the process list for every user on the machine. A file or the
environment.

### `test:deploy-e2e` — and why `test:deploy-endpoint` could not do it

The guard-chain rig says in its own header that every one of its checks is
satisfied by an endpoint that refuses everything: the download, checksum,
extraction, wrapper collapse, copy and manifest were all untested. They need a
real artifact on one of three GitHub hosts.

So the e2e rig commits one — `scripts/fixtures/deploy-demo.zip`, 502 bytes —
and lets `raw.githubusercontent.com` serve it. **The alternative was widening
the endpoint's allow-list to suit a test, which is changing production to suit a
test.** It needed a narrow `!scripts/fixtures/deploy-demo.zip` past the blanket
`*.zip` ignore, pinned by PATH so nothing else slips through; the blanket rule
was widened once already for being spelled too narrowly.

**The fixture is WRAPPED on purpose** (`sporta-deploy-demo/…`), because that is
the shape GitHub produces and the shape the wrapper collapse and the
protected-path fix are both about. A flat one exercises neither.

**The client is run as a PROGRAM, not reproduced.** Everything else in that rig
signs inline, which tests a copy and would go on passing after the client broke.
The manifest's `version` is then checked to be the client's own, which proves
the body it built is the body the server parsed rather than merely that
something validly signed arrived.

**Its last check failed first for the wrong reason**, which is the house
speciality and worth keeping: it listed protected directories that EXIST, and
`api/` exists because the rig puts `deploy.php` in it. The invariant is not
"api/ is absent" — it cannot be — but that no protected directory GAINED
anything and that `deploy.php` is still byte-for-byte itself.

Measured: `deployed=2 removed=0`, both files on disk, the wrapper collapsed, the
manifest carrying collapsed paths, a wrong sha refused `422 checksum_mismatch`,
and the repository's OWN 6.3 MB zip refused `422 executable_in_artifact`.

**Nothing has been deployed to the live shop.** The endpoint works and is
unused; using it writes files into the docroot and is the owner's call.

### "No .php in an artifact" did not mean what it says — the real hole

Found by RE-READING the finished file rather than trusting the round that had
just been tested, and it is the most serious thing this endpoint had. The `.php`
regex was the only execution guard of its kind, so every one of these was
accepted and written — measured against the real functions, not reasoned about:

```
assets/.user.ini   assets/.htaccess   assets/x.php5   assets/x.pht   WRITTEN
```

- **`.user.ini` is PHP's own per-directory config** under CGI/FastCGI, and
  `auto_prepend_file` in it runs an arbitrary file on every request to that
  directory. That is code execution **with no `.php` entry anywhere in the
  archive** — the guarantee in the header defeated completely, by a file the
  guard never looked at.
- **`.htaccess` can map any extension to the PHP handler**, so a deployed `.txt`
  becomes code. `PROTECTED_PATHS` DOES list `.htaccess` — but `isProtected()`
  tests the FIRST path segment, so it guarded the web root's own and nothing one
  directory deeper. **A name in a protection list is not protected; the function
  that reads the list decides.**
- `.php5` and `.pht` are commonly mapped to PHP by shared hosts.

Post-authentication, so not a remote hole — and that is not much comfort,
because **the entire point of refusing `.php` is to bound what a MISTAKEN or
TAMPERED artifact can do**, and one that can write `.user.ini` is unbounded.

`isDangerous()` matches on the BASENAME so it holds at any depth, and is called
by BOTH the entry check and the copy loop — those see different strings, a zip
name and a collapsed relative path, and this file has already had one guard go
inert by being wired to only one of two.

### A silent @copy failure was data loss, not a smaller number

`@copy` failing skipped the file, left `$copied` lower, and still answered
`ok: true`. Disk full or one bad permission is enough. **And the prune two
blocks later turns that into deletion**: it removes everything in the OLD
manifest missing from the NEW one, which is exactly the file that failed to
copy. The replacement does not arrive AND the original is removed.

A failure now stops before the prune, does not rewrite the manifest — the old
one still describes what is really on disk — and names what did not land.

Both mutation-tested, three ways, each caught naming its own cause; and the e2e
deploy still succeeds, which is what says the new guard is not over-broad.

**The lesson, and it is why the file was re-read at all:** a round of fixes that
passes its own tests is evidence about the things it changed, and nothing else.
The three defects found first were real; the fourth was worth more than all of
them, and nothing in that round would ever have surfaced it.

## Google sign-in on /backends — a second door, 2026-09-11

Asked for as "make backend login by google auth". Live and **inert**: an empty
client id fails closed, draws no button and loads nothing third-party.

**The ID-token flow, not the authorisation code.** The code flow needs a client
SECRET on the server and a registered redirect URI; this needs neither, because
the only thing that travels is a JWT Google signed and the server verifies
against Google's published keys. One fewer secret on shared hosting is worth
more than anything the code flow adds — the shop wants to know who is at the
keyboard, not to call Google's APIs later.

**It does not replace the password form.** Google sign-in fails for reasons this
shop cannot see or fix — an outage, a blocked script, a corporate policy, the
wrong account signed in — and a panel whose only door depends on somebody
else's service is a panel that can be locked.

**It never creates an account.** `admin_users` stays the only answer to who may
run this shop, and "not an admin" is the SAME 401 as "bad token": telling them
apart makes the route an oracle for which addresses run the shop, answerable by
anyone with any Google account.

**AND IT DOES NOT SKIP THE SECOND FACTOR.** An account with TOTP or email OTP
is asked for it here exactly as the password path asks, through the same pending
marker. Signing in with Google proves an EMAIL; an admin who enrolled an
authenticator did so to require something beyond an email, and letting Google
past it would silently weaken every account that had taken the trouble.
`store_admin_grant()` stays the one place the shop is handed over.

### Node mints, PHP verifies

The rig generates an RSA key, publishes a JWKS and signs tokens with Node; the
real `store_google_verify()` is then asked about them. **PHP verifying its own
signature would pass even if the hand-rolled JWK-to-PEM conversion were wrong in
a way both sides shared** — and it is hand-rolled, because PHP has no JWK
reader. The one subtlety is the leading zero: an ASN.1 INTEGER is signed, so a
modulus with its top bit set must be prefixed `0x00` or it decodes negative and
a perfectly good key fails.

Ten refusals are asserted, including **a valid signature by the WRONG key under
a kid we DO publish** — the attack the kid lookup exists to stop, and the one a
rig that only tries unknown kids misses. Mutation-tested four ways: `aud`
dropped, the signature result ignored, `email_verified` trusted, the second
factor skipped. Each caught.

`$jwks` is a FUNCTION ARGUMENT rather than a setting, precisely so nothing
reachable from a request can substitute a key set. Production passes null.

### The CSP scoping took two silent failures to get right

The button is a third-party script that draws a third-party iframe and calls
home, so `script-src`, `frame-src` AND `connect-src` all need
`accounts.google.com` — and naming a host in script-src lets it run code on this
origin, which the storefront must not pay for. So it is scoped to `/backends`.

Both first attempts failed, and **a real Apache said so before it shipped**:

- `SetEnvIf Request_URI "^/backends"` — /backends is rewritten to the SPA shell,
  and the internal redirect re-evaluates the config with the NEW uri.
- the same test moved into mod_rewrite, but sitting beside the policies — the
  SPA rule had already fired with `[L]` and never reached it.

Either way the panel got the strict policy and the button was blocked three
times over, **with nothing on screen but an absent button**. The flag is raised
at the TOP of the file now, before anything rewrites, and Apache re-exposes it
across the internal redirect under a `REDIRECT_` prefix — so both names are
honoured, because which one arrives depends on how many rewrites happened.

`htaccess-test` asserts both halves, because each fails in its own direction:
the panel has the host, the storefront does NOT, a nested panel path does, and a
product URL merely containing "backends" does not.

**And LiteSpeed agreed, which Apache could not prove.** Measured on the live
server in the same run as the publish: `cspPanel=3/3 cspShopClean=yes`.

### The setup card is part of the feature

The client id lives in a settings row no screen in either panel could write, so
switching this on would otherwise have meant phpMyAdmin. **A feature whose
configuration is unreachable is not finished.** It is in the same overlay
because it belongs to the same feature and shares its one cache rule, and it is
drawn only when `me` says somebody is signed in, so it cannot appear on the
login screen it configures.

Reading the id is public — the login screen needs it to draw a button, and a
client id is compiled into every page that uses Google sign-in anywhere. WRITING
it goes through the gate: anyone who could set it could point the shop's sign-in
at their own Google project.

**The app's panel was deliberately NOT done**, and the owner chose that: it
needs its own iOS and Android OAuth clients and a native library. The server
half already supports it, so adding it later needs no backend change. Naming it
is the point — this repository has recorded app-only drift four times and this
is the same omission in the other direction.

### The cron list was ELEVEN on 2026-09-11

A new one, not ours: `* * * * *`, `php /home/u130124229/domains/wainkw.com/storage/t.php install`.
A different site, every minute, and "install" is not a verb a healthy per-minute
job usually has. Recorded with its timestamp per the standing rule; not deleted,
because it is not ours. That makes four distinct foreign jobs seen appearing and
disappearing on this account — **re-list before reasoning from a list.**

## The live shop has no product photographs

`photos=0/46active`, `brandLogos=0/8`, measured 2026-09-05. Every product card
on the real site is blank. Photographs and brand logos are data: URIs in MySQL,
uploaded through /backends — the owner's images, not something to invent here,
and not something any script in this repository can supply. It is a bigger
visible problem than anything in the CSS.

## A route that gates itself moved the gate — full backend scan, 2026-09-16

Asked for a full scan of the backend: every auth, deploy, payment, panel and
API suite locally, plus `live-scan`, `live-admin-gate`, `live-deploy-check` and
`live-login-check` on the server. The live shop measured clean throughout. The
defects were all in the CHECKERS, and one of them was raising a false alarm on
production.

**`google_save` gates itself inline**, because reading the Google client id is
public and writing it is not, so the two routes sit side by side and only one
goes through the gate. Both gate checkers found "the gate" with
`indexOf`/`strpos` of `store_require_admin(` — which matched that INDENTED call
sixty lines above the real one, and swept `logout` and `me` (public by design,
and saying so in their own comments) into the guarded set.

Locally that was three failures against correct code. On the live server:

```
GATE ... answering200=OPEN:me
```

which reads as the admin gate being gone on the shop that takes money, and was
nothing of the kind. **A false alarm is worse than a missed one: it is the alarm
the owner is asked to act on.** Both now anchor on the TOP-LEVEL (column-0) call
and read each route's own block, so a self-gating route is CHECKED as guarded
rather than mislabelled as public, and is reported as `selfGated=`. Corrected,
live: `routes=84 public=8 guarded=76 answering200=0 gated=76 throttled=0
withoutHeader=401-refused`.

### `json_decode` cannot tell `null` from unreadable, and a 503 is not always the limiter

`live-login-check` reported `me=200/not-json` and `VERDICT=INCONCLUSIVE-throttled`
on runs where every check had passed.

- **`me` answers 200 with literally `null`** to a signed-out browser — its whole
  job. `json_decode()` returns null for the body `null` AND for a body it could
  not read, so the one route that exists to say "nobody is signed in" read as a
  broken response on every run. `json_last_error()` separates them.
- **`google_login` answers 503 `google_not_configured`** until a client id is
  pasted in, which is this shop deliberately. Counting every 503 as the limiter
  made the verdict INCONCLUSIVE on EVERY run — and **a verdict that is always
  inconclusive is a verdict nobody reads**, so it would have hidden a real
  throttled run the day one happened. Only an UNNAMED 429/503 counts now: the
  limiter refuses without naming an application error; a feature refusing itself
  says which feature.

### Four more failures were a bundle pointed at production

`first-admin`, `returns` and `invoice` were driving a `dist/` built WITHOUT
`EXPO_PUBLIC_API_BASE`, so it carried `https://www.sporta.com.kw/api`. The rigs
emptied the SANDBOX's tables and then drove a page that asked PRODUCTION about
them. "The screen does not say the shop has no administrator" was perfectly
true, and about a bundle aimed somewhere else. `first-admin` now records which
origin the page actually asks and fails on it BEFORE reading anything off the
screen — a rig that cannot say which server it measured has not measured one.

It also **proves its own restore**: it is the only rig that empties an auth
table, and a restore that silently does not happen fails `admin-permissions`,
`cookie-flags` and `admin-live` with messages about sign-in that have nothing to
do with what broke. That had already happened, and cost twenty minutes.

And db-audit's *"1 order is paid with no paid_at"* was `returns-test`'s own
leftover row: every real path — both bank callbacks and both admin routes — sets
`paid_at` with the status. **A failing audit is a claim about the code until you
find out whose row it is.**

### The cron list was ELEVEN on 2026-09-16

Three foreign jobs, none ours, none deleted: two writing to `mawsoool.com`
(one of them a `* * * * *` deploy of a DIFFERENT project — `tools/deploy-hostinger.sh`
off branch `claude/delivery-cars-website-llck2j`, which touches only that
docroot and is therefore NOT the thing restoring `cats/desktop/outlet.jpg`), and
a new `php -r scandir` of `wainkw.com/storage`. Recorded with its timestamp per
the standing rule. **Re-list before reasoning from a list.**

## The second hardcoded manifest, and a publish on its word — 2026-09-16

Asked to fix broken images and scan the text style. Every local image rig was
green; `live-image-check` reported `differ=5` on `hero/mobile/*.webp`.

**I published five files that needed no publishing.** The publisher's own
reading said so in the same breath and I read it as confirmation:
`alreadyOk=5 stillDesktop=0 served=5/5 mobileBytes=174124` — the phone frames
were ALREADY the 1200px art, already 119,874 bytes lighter than the desktop
masters. The checker's five expected hashes match neither the current mobile
files nor the desktop ones. They are an older generation still.

**This is the recorded failure verbatim, on a second file.** The entry above
says a checker that reports the repository's staleness as the server's *"points
at work that is already done"*, and it was written about `live-file-check.php`
on 2026-09-10 and fixed by GENERATING its manifest. `live-image-check.php`
carried the identical hardcoded list and the identical instruction in its own
header — *"regenerate it from public_html with find | sort | xargs sha256sum"* —
which is a step a person has to remember every time, for ever. Eleven days, and
nobody asked how many hardcoded manifests there were. **"When a fix lands, grep
for the clause, not the file"** was already written down, about a different
clause.

`make:file-manifest` writes both now, one generator over a list of targets, and
`test:file-manifest` fails on drift in either. **Six images were missing from
the list entirely** (51 → 57) and had never been checked on either side — a
hand-written list cannot ask "what did we never send?". Live, with the generated
manifest: `IMG same=57/57 differ=0 missing=0`.

### Eighteen publishers pinned a ref that fetches nothing

Found on the way, and real even though it caused none of the above.
`publish-hero-mobile.php` carried `$COMMIT = 'def64d5'`, and
raw.githubusercontent.com **404s on an abbreviated sha** — already in this file
since 2026-09-11, together with the observation that *"other publishers here
carry short shas and happened to work, which is worse than failing outright."*
Eighteen still did. All expanded to forty characters; `npm run test:publish-pin`
requires forty hex characters AND that the sha resolves to a commit here,
because a full-length string that is not a commit fetches exactly as much as a
short one does.

### The text scan, and two ways it was wrong first

`npm run test:text-style` walks eleven pages in both languages and asks what no
other rig does: is this text the size, the weight and the FACE it was meant to
be, and is any of it cut off? 1,374 runs measured, nothing clipped, nothing
under 11px, nothing falling back.

```
sizes     14.7×592  16.8×196  15.5×138  13.7×74  12.6×74  16×64  21×44 …
weights   400×532  700×438  600×266  800×60  500×40  900×8
families  Alexandria×1212   IBM Plex Sans Arabic×132
```

The inventory is **printed and never failed** — a rig that failed on eleven
type sizes would be deciding the shop's typography on its own.

- It first reported **twelve clipped headings, every one `in 1x1`**: the
  screen-reader-only pattern, correct markup doing exactly what it is for. It
  found the shape it was written to find and the shape was not the fault.
- **`document.fonts.check()` passed a rule naming a face that does not exist.**
  It answers about `@font-face` rules the document has LOADED; for a family it
  has never heard of it returns true, because SOMETHING will render the text —
  which is the fallback, and the fallback is the whole fault. The browser is
  made to draw it now: the declared family measured against two sentinels with
  different metrics, and equal to both means it added nothing.

## The certificate is not the fault — measured 2026-09-19

Asked to "fix ssl", and the owner said what they were seeing was **a browser
warning**. Hostinger reported both certificates active, lifetime, HTTPS
redirect on, no last_error — and a panel saying that is not a browser saying
it, so it was worth asking properly.

**Nothing in this repository could ask.** Every live script measures over the
loopback, `https://127.0.0.1` with a `Host:` header and
`--no-check-certificate` — it connects by ADDRESS, so the name can never match
and the flag is exactly the thing under test. `scripts/live/live-cert-check.php`
asks over the PUBLIC name, which is possible again since the delegation came
back, and it reports the three things that fail independently:

```
www.sporta.com.kw     cn=sporta.com.kw  Let's Encrypt  2026-08-27..2026-11-25
                      names=sporta.com.kw www.sporta.com.kw   coversThisName=YES
sporta.com.kw         same certificate                        coversThisName=YES
static.sporta.com.kw  cn=static…        Let's Encrypt  2026-09-08..2026-12-07
                      names=static.sporta.com.kw              coversThisName=YES

verifying client      www=ok  apex=ok  static=ok
settings rows with http://   0 of 7
```

**So the hypothesis was wrong, and it was the likeliest one.** The shop's
canonical host is `www`, and a certificate issued for the apex alone would have
covered the apex and not the subdomain while the panel reported `active` and
told the truth. It covers both. A verifying client — verification ON, no
`--no-check-certificate` — is served all three without complaint. And the other
way a padlock breaks with a perfect certificate, one `http://` inside
owner-entered content that no file scan can see, is not there either: every one
of the seven settings rows is clean.

**What that leaves is the question I have to ask rather than answer**: the exact
wording, and the exact address in the bar. "Not secure" on a typed `http://`
before the redirect lands, a warning from a page opened by IP or by the
`*.hstgr.net` preview name, or an expired-clock warning on the visitor's own
device are all browser warnings on a shop whose TLS is correct — and they have
different answers. A screenshot settles it.

### Two ways the channel cost an hour, both already written down

**An overrunning job reports NOTHING.** Six TLS handshakes at a twelve-second
timeout is seventy-two seconds in the worst case, longer than a `* * * * *`
cycle, and the panel captures a job's output when the process EXITS — so three
ticks reported three empty outputs and the next minute overwrote an answer that
had never been given. Per-line echoing does not help: there is no finished
process to read. Six seconds fixed it on the first run. **An empty cron output
means at least three things** is in this file already; this is a fourth.

**A one-shot at a named minute is a bet on the server's clock.** The documented
remedy for a per-minute job overwriting its own answer is to schedule one at a
named minute — and the minute is the SERVER's, not this container's. `13 9 19 9 *`
went by in silence, and since the probe only READS, going back to `* * * * *`
and deleting it on the first output was both correct and cheaper. **Reserve the
one-shot for jobs that WRITE**, where re-running is the thing that costs.

And the run that finally answered died on its last line with
`Undefined constant "DB_HOST"`: `api/config.php` RETURNS AN ARRAY and defines no
constants at all. The cert half was already on screen, which is the whole
argument for echoing as you measure rather than building one line at the end.

## Google indexing — everything the server owes is already right, 2026-09-19

Asked to "connect to google index". It has two halves and only one of them is
here: verifying the property in Search Console and submitting the sitemap need
the owner's Google account, and nothing in this repository can or should hold
that. The half that comes FIRST is whether Google could index the shop at all
if the property were verified this minute, and that is measurable.

`scripts/live/live-index-check.php` asks the live server **as Googlebot, over
the public name**, so the request traverses hcdn the way a crawler's does:

```
home/shop/product  200  X-Robots-Tag=(none)  metaRobots=index, follow, …  indexable
assetHost          X-Robots-Tag=noindex
robots.txt         200/3830  googlebotGroup=named  disallowRoot=no  sitemap=…/sitemap.xml
sitemap.xml        200  locs=2
sitemap-pages      200  locs=16   lastmod 2026-08-20
sitemap-products   200  locs=94   lastmod 2026-09-18   == generator byte for byte
title / canonical / hreflang      present, 3 hreflang links
origin=200/50005  edge=200/50005  cdn=BYPASS  same=yes
googleSiteVerification=NONE
```

**The check worth having was the noindex one, and it was one nobody had ever
run.** `.htaccess` carries `Header set X-Robots-Tag "noindex"
env=SPORTA_ASSET_HOST`, and the entry above proving `Header set … env=` works on
LiteSpeed proves only the POSITIVE half — that `static` gets the header. If
LiteSpeed had evaluated that `env=` wrongly, every page of the shop would carry
`noindex`, Google would crawl the whole site and index none of it, silently and
for ever, and **the panel, the sitemaps and robots.txt would all have looked
perfect throughout**. Both halves are one line now: noindex on static, absent on
www. It holds.

**The products sitemap is generated, and proved so rather than assumed.**
`sitemap-products.xml` in the docroot is a July snapshot; `.htaccess` rewrites
the name to `api/sitemap-products.php`, which reads the catalogue. The two are
asked separately and came back at the identical 46,511 bytes with a lastmod of
2026-09-18, so the rewrite is live and a crawler gets today's catalogue. Reading
the rewrite rule would not have told you that.

**What is missing is one token.** Search Console will verify by HTML file, meta
tag or DNS TXT, and all three need a value only the owner's account produces.
The HTML-file route needs no code: the probe confirms an unknown root `.html`
answers **404**, so the SPA rewrite does not swallow it and a real file wins —
paste the token and it publishes through the ordinary cron channel.
`sporta.com.kw` is not in the Hostinger domain list, and `DNS_getDNSRecordsV1`
404s for it, so the DNS route is the owner's panel rather than this API.

### It blamed the CDN for its own failed fetch

The first run printed `origin=0/0 … same=NO <-- the CDN is serving something
else`. The origin fetch had simply not happened — `file_get_contents` over
`https://127.0.0.1` needs `allow_self_signed` and an explicit `peer_name` as
well as `verify_peer` off — and comparing a zero-length body against a real one
produced a confident claim about the CDN out of nothing.

**A failed fetch and a differing body are different findings, and only one of
them is about the CDN.** The line says which now. This file already records
that a false alarm is worse than a missed one, because it is the alarm the owner
is asked to act on — and the same rig had, one section up, been written with
exactly that in mind.

## One save button for Settings — and the rig's two halves shared a term, 2026-09-19

Asked for as "make save button at backends". The screen was named by the owner
rather than guessed at, because there are a dozen and most already have one;
this file records what guessing cost last time.

**Measured in a browser before anything was built.** Settings is **5,753px
tall** — six and a half screenfuls at 900px — and carries **eight** save
buttons, one at the foot of each card:

```
Payment setup     h2  442     Save                   944
Contact details   h2 1250     Save contact details  1619
Site wording      h3 2305     Save wording          2491
Buttons and bars  h3 2628     Save colours          3509   <- 881px apart
More emails       h3 3646     Save emails           3888
Shop rules        h3 4013     Save rules            4649
Policy pages      h2 5189     Save policy pages     5611
```

"Buttons and bars" is the one that settles it: the control that commits a
colour is a whole screenful below the colour, with four other save buttons in
between that are not the one you want. Not a matter of taste — a control you
cannot see from the thing it acts on.

**IT SAVES ONLY THE CARDS SOMETHING WAS TYPED INTO**, and that constraint came
out of this file rather than from taste. The rules card reads through
`admin.php?r=rules` instead of saving an empty body, because *"a panel opened
and closed would look in any audit like a deliberate change"*. A bar that
pressed all eight would do precisely that, eight settings rows at a time, and
`activity-log.js` would record every one as an edit nobody made.

**It presses each card's OWN button** — no save code, no request, no route.
Every card keeps its validation, its refusals, its busy state and its note. Two
ways to write a settings row is two ways for them to disagree, and this project
has already shipped a second checkbox beside a working one and had to delete it.

**Cards are found by their buttons, not by a marker.** Only two of the seven set
a `data-sporta-*` attribute — checked, not assumed — so keying off one would
have covered two cards and silently ignored five. A card is the smallest
ancestor of a save button containing no other save button, which is a property
of the page rather than a list this file has to be told.

### The mutation passed, and the reason is already in this file

`test:save-bar` went green, and then the mutation that makes the bar press ALL
eight buttons **also went green** — while the bar itself printed "Saved 8
cards". The stray-write check watched for POSTs to routes named `rules`,
`theme`, `site_text`, `legal`, `knet`.

**Six of the seven cards POST to the same route.** They all call
`settings_save`, and which row they write is a `name` in the BODY. So the check
was looking for route names that never appear as routes: both halves shared a
term, the AND between them meant nothing, and it could not have failed. Exactly
the `live-who-writes-tiles.php` tautology — *"an extractor's two halves must not
share a term"* — on a new surface, written by someone who had just re-read that
entry.

Fixed by reading the row name out of the body, and stated as **"nothing but
`contact` was written"** rather than as a list of rows that must not be: a
forbidden-list goes stale the day a card is added to Settings and would then
report a real regression as a pass. Corrected, the same mutation fails loudly
and names the damage — `STRAY WRITES: contact_emails, knet, site_text, theme`,
and `5 POST(s)` where one was intended.

The other two mutations — discovery finding nothing, and the bar outliving its
screen — were caught first time. **The rig asks the PAGE how many save buttons
there are, with its own query, rather than asking the bar what it found**, so a
bar that discovered nothing cannot also certify that there was nothing to find.

**`test:panel-cards` fails at 1130 words against a 600 cap, and this did not
move it** — measured both ways, identical with and without the bar, which sits
outside `.admin-content`. That failure is the owner's to decide about and is
older than this work.

## The returns page spoke one language and promised a number it did not own — 2026-09-19

Asked to "improve return responce". Three faults, measured on the page rather
than reasoned about, and the owner chose all three.

**ENGLISH DID NOT EXIST.** `/returns/request` was `lang="ar" dir="rtl"` with not
one English string — and it posted `lang: 'ar'` whatever the shopper was
reading. So an English customer met an Arabic-only form AND was filed on the
return row as an Arabic speaker, **which is the language the shop then answers
them in**. The second half is the one that would have gone unnoticed: a page can
be translated and still file every request wrong.

The language is chosen by **the shop's own rule, copied from `index.html`'s boot
script rather than invented** — the saved choice first, `?lang=` second, Arabic
if neither, and never written back. A page that picks its language by a
different rule is a page the shop's own toggle cannot reach. The Arabic stays as
the copy WRITTEN in the HTML, so a visitor with no JavaScript still gets a real
page rather than a skeleton; the script swaps it by `data-i18n`.

**IT PROMISED FOURTEEN DAYS, AND THE SERVER NEVER DID.** `return_days` has been
the owner's to edit since the rules row was built and
`store_return_lookup()` computes the window from `store_rule($db, 'return_days')`.
Only the page carried fixed copy — *"the fourteen days are over"* — which is
this file's own entry about the returns window being one of exactly two rules
still stated in fixed copy, found on a third surface.

**The length is DERIVED from the window the server already sends**: `deadline`
minus `from` is that number, whatever it has been set to. No extra request, and
it cannot drift from the rule being enforced. With either timestamp missing the
sentence carries **no** number rather than a guessed one — a sentence without a
number is honest and one with the wrong number is the fault.

The no-exchange message no longer names women's clothing either. The page is
told WHICH lines are barred and was never told why; this file says in as many
words that the category rule is the owner's and may change.

**THE CONFIRMATION SAID TOO LITTLE.** It now lists the items actually asked for
with the size change, and names the number the shop will ring — the customer's
own, so a mistyped digit is caught while they are still on the page. Nothing was
added about timing, refunds or carriers: this page does not know those and an
invented timeframe is a promise the shop has to keep.

### Two mutations found holes in the rig, not in the code

Six mutations. Four were caught first time; these two were not, and both are
this file's recurring shape.

- **Restoring `lang: 'ar'` passed**, because the rig was reading the SCREEN. A
  page that renders in English and files the request as Arabic looks perfect
  from the browser. The check is now on the **stored** `lang` column.
- **Hardcoding fourteen in the CLOSED-window sentence passed cleanly**, because
  every check ran with the window OPEN and only ever drove the "n days left"
  branch. **The copy being fixed was in the branch nobody drove.** The rig now
  pushes the same order past its deadline and reads the other sentence.

And the wording guard had the failure it was written to prevent. Slicing the
dictionaries out of the source with `indexOf` of an end marker gives `-1` when
the marker moves, so `slice(from, -1)` returns nearly the whole file: the length
test passed, the regexes then scanned the COMMENTS — which discuss "fourteen"
and "women's" at length — and it failed for a reason with nothing to do with the
copy. **Both ends are asserted by name now**, and mutation-testing the rig
against a missing anchor is what produced that message.

**`test:sw-version` caught the bump, which is the whole reason it exists.**
`returns-request.js` is a fixed-name asset; without `VERSION` going to
`v47-returns-both-languages` every returning visitor would have kept the
Arabic-only copy for ever, and the fix would have reached new visitors alone.

**Left alone, and worth knowing:** the page's `SIZES` list is still hardcoded.
Its own comment is right that the server refuses anything outside `STORE_SIZES`,
so the worst a stale entry does is offer a size that is then refused by name —
but if the owner drops a size in /backends, this page still offers it. Closing
that needs a `?r=slides` fetch the page does not otherwise make.

## Two features, and the decision that shaped each — 2026-09-19

Asked for together, with "ask before any" said twice, so all four questions
were put before a line was written. The answers: a full live health check;
propose-not-write for the product AI; all three sources allowed; and customer
accounts rather than a customer register or customs paperwork.

### "Look it up" — api/research.php, assets/product-research.js

**It never writes.** No route in research.php touches a row; the owner applies
a proposal through the panel's ordinary `product_save`. That was chosen over
automatic filling, and it is why every field arrives with its sources beside it.

**Three fields, and only when empty**: `desc_en`, `desc_ar`, `category`. Never
price, sale price, stock, size, SKU, `cost_aed`, slug, `active` or an image —
each is a fact about THIS shop's trade that no web page knows, and the model is
not told they exist. The rig asserts their absence **by name**, because a list
of what a feature does never notices something being added to it.

**CATEGORY CARRIES A POLICY**, which is the trap in this feature.
`store_return_lookup()` decides whether a garment may be exchanged from
`category === 'women'` — so a category accepted without thought changes what the
shop promises about that product. It is offered, flagged in the response, and
restricted to the categories the shop ALREADY USES, read from the database.

**A searched claim with no citation is dropped**, and the Arabic description is
a TRANSLATION when the English exists — the shop already owns the fact, so
nothing is searched and no source is needed. The search is the model's own
server-side tool, so there is no scraper here, no HTML parsing, and citations
come back with the answer.

**Apply re-reads the row and resends it whole**, because `product_save` is a
full upsert. Mutation-tested, and the mutation reproduces the recorded
`brand_save` trap exactly: sending only the accepted field turned `desc_en`
into NULL while the field that was asked for arrived perfectly. It also refuses
if the field stopped being empty while the proposal was on screen.

### Customer accounts — api/customer.php, api/customers.mysql.sql

**THE COOKIE APPEARS ONLY ON SIGN-IN.** The zero-cookie storefront was
deliberate and a session ends it by definition, so the promise is narrowed
rather than abandoned. `customer_me` answers "nobody" **without starting a
session** — a route that starts one to say that hands a cookie to every visitor
who loads a page, which is how the property would go by accident rather than by
decision. Mutation-tested: removing that guard fails the rig on the first check.

**ORDERS ARE LINKED BY `customer_id`, NEVER BY PHONE NUMBER**, and this is the
security decision. Linking by phone is tempting — `orders.customer_phone`
exists and `store_return_lookup()` already gates on it — and it is an account
takeover: registration verifies no phone, so anyone who knows a customer's
mobile could read their name, address and every order. **The returns route is
safe because it demands the order REFERENCE with the phone**, and the pair is
something only the customer has. One of the two is not a credential.

The cost is that an account starts empty, and it is said on the route rather
than left as a blank page. The rig plants an order carrying the new account's
OWN phone and requires that it is not visible — which reads like a bug until
you know why, so it says why.

**SAMESITE=LAX, NOT STRICT, AND THE BANK IS THE REASON.** KNET and CBK take the
customer to pg.cbk.com and redirect them back — a cross-site navigation, on
which a Strict cookie is not sent. A shopper would return from paying and find
themselves signed out, at the one moment in the whole shop where that looks
like the money went somewhere. The admin cookie stays Strict; they are separate
cookies and neither can end the other.

`store_session_start()` took a `$kind` rather than gaining a sibling, because
`cookie-flags-test` refuses a `session_start()` anywhere else — the guard doing
exactly its job.

### The rate limiter refused the rig, and made a mutation run say nothing

`customer_register` is rationed at ten in ten minutes, correctly — it writes a
row and runs a password hash. The rig registers on every run, so by the third
mutation every check after the first reported `too_many_attempts`, and the
SameSite mutation came out **inconclusive** rather than caught. `returns-test`
has cleared its own counters for this exact reason since it was written, and it
is in this file; it was walked into anyway. `delete from rate_limit` at the top,
and the mutation then failed by name.

### And db-audit caught a leftover of mine

`1 orders are paid with no paid_at` — this file already says a failing audit is
a claim about the code until you find out whose row it is, and the row was
`SPRTESTMW6LHM`, "Returns Rig EN": the fixture from that morning's returns work,
surviving an aborted mutation run. `cleanup()` at the TOP of a rig sweeps on the
NEXT run, which is not the same as leaving nothing behind. It deletes its own
order in a `finally` now.

### What is NOT built, and is the owner's call

**The shopper-facing screens.** The server half is complete and tested; there is
no sign-in link, no register form and no "my orders" page on the storefront,
because the bundle has no source here and every one of those is a change to the
owner's design — where the link sits in the header, what the account page looks
like. That is the overlay pattern's usual answer and it needs a decision first.

**Email verification**, and **claiming older orders**, which needs the phone
proved and so needs an SMS provider.

## Everything published — 2026-09-19

The owner said "public now, auto approve this session". Twenty-nine files, one
migration, two verifications, nothing left behind.

**THE MIGRATION HAD TO GO FIRST, AND THAT ORDERING WAS THE WHOLE RISK.** The new
checkout writes `orders.customer_id`. Publishing `api/api.php` against a table
without that column is not a degraded feature — it is EVERY CHECKOUT FAILING on
a shop that takes money. The column is nullable and the old code never reads it,
so running the migration first is invisible until the code arrives, and running
it second is an outage. `scripts/publish/migrate-customers.php` reports STATE
rather than its own verb, so the answer reads the same on every tick:

```
STATE customers=yes orders.customer_id=yes accounts=0
READY — api/api.php may be published now.
```

**ONE PUBLISHER, GENERATED FROM THE MANIFEST.** `scripts/publish/publish-all.php`
carries all 220 paths and hashes, generated from `live-file-check.php`, which is
itself generated from git. So it cannot disagree with the checker that grades it
and cannot go stale by hand — the failure that had a hardcoded manifest report
the repository's staleness as the server's, twice. It skips a matching file
WITHOUT a request, which is what makes the whole manifest affordable: 220
entries, 29 fetches.

`.htaccess` and `index.html` are moved to the FRONT of the list rather than left
in alphabetical order, because the CSP names each inline script by sha256 and a
run that dies halfway should have closed that window rather than opened it.

```
PUBLISH wrote=29 alreadyOk=191 hashMismatch=0
SERVED  home=53304 api=23002 me=17
FILES   same=220/220 differ=0 missing=0 mustNotBeHere=0
SCAN    pages=9/9 api=3/3 sec=4/4 cache=7/7 files=8/8 | no problems
```

`me=17` is `{"customer":null}` — the new customer route answering on the live
shop, which is a better proof than any file hash that the publish took.

**AN OVERRUNNING PUBLISH REPORTS NOTHING, AND IDEMPOTENCE IS WHY THAT WAS FINE.**
29 fetches took longer than a `* * * * *` cycle, so the first two ticks captured
no output — the same trap as the cert probe that morning. But each file is
written as it arrives and a matching file is skipped, so the run CONVERGES:
by the third tick there was nothing left to fetch, the run finished in seconds,
and the panel captured the summary. **Design a publisher so that the run you can
read is the run after the work**, rather than hoping to read the one that did it.

### An empty fetch and an empty file are the same bytes

The first run reported `failed=2`, both `.gitkeep` markers. The guard refusing an
empty body is right about an unresolvable ref — which returns nothing and says
nothing, and has cost this project a publish before — and wrong about a file that
is legitimately zero bytes. From the body alone they are identical.

**The manifest can tell them apart when the body cannot**: a file whose EXPECTED
hash is the hash of the empty string is supposed to be empty. Fixed, and the
next run gave a different and honest failure — `(no dir)`, because
`images/brands/` and `images/heros/` do not exist on the server and the
publisher deliberately creates no directory.

**Which turned out to be the real answer: those two files should never have been
in the manifest.** `.gitkeep` exists only so git will carry an empty directory;
nothing on the server reads one — checked, no PHP or JS in this repository
mentions either path. Left in, they would have reported `missing=2` on every run
for ever, **which is how a real signal gets trained into noise** — the same rule
that keeps `selftest.php` out of `$WANT`. Excluded at the generator, so the
manifest and every publisher built from it agree.

### Still untracked on the server, and still not ours

`cats/desktop/outlet.jpg` — the stray bridging duplicate, three removals undone
by something that is not this account — and **`default.php`, which is new since
the last reading and in no commit.** Not touched, on the standing rule that
nothing gets removed on a guess here.

## Scanning a product page found the English pages served right-to-left — 2026-09-19

Asked to "scan product page". The page itself is in good order; the two findings
were elsewhere, and one of them was on every English page of the shop.

**What the page does right**, measured at 390 and 1280 in both languages: no
broken images, nothing over 400, no console errors, no sideways scroll, correct
canonical and hreflang per language, JSON-LD carrying price, availability, a
14-day return policy and shipping, breadcrumbs, and a description. Tap targets
pass under `pointer: coarse`; the only sub-44 items on a phone are text links
inside cards that are themselves fully tappable.

**A sold-out size is handled properly, and I read it wrong twice before
believing it.** First I checked `textDecorationLine` on the BUTTON and got
`none`, and reported no visual treatment — the strike-through is on an inner
`<span class="line-through">`. Then I checked `opacity` and got 1 — the dimming
is done with colour, not opacity. Measured properly: `disabled`, strike-through,
label contrast 6.55:1 (in-stock 11.19), `cursor: not-allowed`, `title="Sold
out"`. **A computed style read on the wrong element reports absence**, which is
this file's oldest lesson on a new surface, twice in five minutes. The one real
gap is that `title` is hover-only, so a phone gets no words — strike-through is
a strong enough convention that this is worth knowing rather than fixing.

**`photos=5/47` on the live shop, up from 0/46.** The owner has started
uploading. And `og:image` on a product WITH a photo correctly points at
`?r=product_image`, not the shop-wide fallback — so that half needs nothing; the
42 without photos still fall back to `og-image.png`.

### The finding: `lang="en" dir="rtl"`

```
en  200/53085  lang=en dir=rtl
```

`index.html` ships `<html lang="ar" dir="rtl">` — correct, Arabic is the
default — and `seo.php` rewrote only `lang`. So every English page the shim
serves went out as an English document declared right-to-left.

**TWO READERS SEE IT AND ONE NEVER STOPS.** `index.html`'s boot script sets
`el.dir` before any module loads, so a real browser corrects it a moment after
parse. **Googlebot crawling without rendering keeps the RTL** — on the shop this
file had recorded as cleanly indexable that same morning. And a visitor arriving
at `?lang=en` from a search result gets one frame of right-to-left English.

**`test:langs` already checked `dir`, and had been green throughout**, because
it reads `document.documentElement` in a browser — after the correction. It was
measuring the fix and could never see the fault. It now also reads the `<html>`
tag out of the bytes the server sent, which is a different question and the only
one Googlebot answers. Mutation-tested: restoring the lang-only rewrite fails the
served check by name while every browser check stays green.

**The rule: when a script repairs something at boot, a browser cannot tell you
whether the server sent it right.** Fetch the bytes.

### And the publisher under-published in silence

`seo.php` was fixed, committed, `publish-all.php` re-pinned to that commit — and
the run said `wrote=0 alreadyOk=220` while the server went on serving the broken
file. Nothing failed. Nothing warned.

**Changing `$COMMIT` re-points where the CONTENT comes from and leaves the
embedded HASHES at whatever they were when the publisher was generated.** A file
edited since matches its stale hash and is skipped WITHOUT a request. That is
this file's *"a publisher that grows a file list under-publishes in silence"*
with the hashes gone stale instead of the list — **the failure is a larger
`alreadyOk`, not an error**, which is exactly the number nobody questions.

One home now: the publisher FETCHES the manifest from its own `$COMMIT` and
parses `$WANT` out of it, so setting `$COMMIT` moves the content and the hashes
together because they are the same thing. A manifest that will not fetch, or
parses to fewer than fifty entries, publishes nothing and says so — an empty
list would otherwise publish nothing while reporting a clean run. Re-run:
`manifest 220 files @ d70cb9f7 / wrote seo.php / wrote=1 alreadyOk=219 failed=0`.

## The panel and the home page, 2026-09-28/29 — what was learned

**The publish loop, as it now runs** (see AUTO-DEPLOY MODE at the top):
commit → `npm run make:file-manifest` → pin `publish-all.php`'s `$COMMIT` to
that commit → push → one cron job `wget … publish-all.php && php c.php` →
read the output → delete the job. A database change (hero slides, settings) has
its own publisher in `scripts/publish/` that reports STATE (`activeCleanSlides=4/4`),
so the run you read one minute late still says the true thing. `publish-all`
reports `alreadyOk=N` on that later run; that is success, not a no-op.

**A cron command is capped at 255 characters by the API** (a 422, not silence).
Two `wget … && php …` pairs in one job do not fit; run them as two jobs, one
after the other.

**`/backends` never goes through `seo.php`.** `.htaccess` rewrites it straight to
`index.html`. Anything that must differ on the panel's page (its own
`admin.webmanifest`, the iOS app title) is set by `assets/panel-ux.js` at load.
A `seo.php` branch for `/backends` is dead code, which is how the first attempt
failed.

**`assets/panel-ux.js` holds the panel's usability layer** — Inventory grouped per
product, the jump-to bar, 44px touch targets, the phone Add photos button, save
toasts (one `fetch` wrapper over admin.php WRITES), screen transitions, and
pull-to-refresh (the panel keeps no screen in the URL; a reload lands on
Overview, so the pull remembers the screen in sessionStorage and reopens it).
`panel-save-bar.js` now runs on every signed-in screen, but not inside pop-up
editors, which keep their own Save in view.

**Two phone bugs that no rig saw, both found by measuring:**
- The phone tab bar sat on top of pop-up editors' Save buttons (same z-index,
  later in the page): a tap on Save product opened the Catalogue tab. While a
  pop-up is open the bar is hidden.
- `panel-tabbar-autocenter.js` used `scrollIntoView({block:'nearest'})` and it
  scrolled the whole PAGE on a phone (Settings opened 6,182px down). It sets the
  strip's own `scrollLeft` now. And the panel's CSS makes scrolling smooth, so a
  scroll-to-top must pass `behavior: 'instant'` or it is interrupted part-way.

**The Slides screen's Size (Short / Tall / Full height) had been ignored since
2026-09-18.** It drives `<html data-hero-size>` now (`css/38-hero-size.css`, the
boot script, and `rules-live.js` from `?r=slides`). Tall is the old height, so
nothing moved for a shop that never touches it. Editing the boot script meant a
new CSP hash — `test:csp` caught it, as it always does.

**The live hero has FIVE slides, not the sandbox's three** (`live-hero-slides-check.php`):
CrossFit (id 8) and Features (id 9) exist only live. Ask the server before
reasoning from the sandbox's rows. The cleaned art for ids 5, 6, 7 and 9 is in
`sporta-site/assets/hero/*-clean*.webp`; the originals are kept for an undo.

**Category tiles are generated** by `scripts/make-white-tiles.py` from the cut-outs
in `scripts/fixtures/tile-subjects/`. `/cats/` images are cached for a day plus
30 days stale-while-revalidate, so a changed picture needs a new URL: raise
`ART_VERSION` in `assets/tile-art.js` and the matching `?v=` in `category.php`.
Re-running the generator re-rolls the grain on every tile; restore the files you
did not mean to change before committing (`git checkout --` them).

**Rigs that silently stopped measuring, fixed on the way:** the tile rigs never
scrolled, so full-width tiles below the fold were counted as missing; and the
brand-image rig left a 1px logo on the sandbox's `ahed` brand after an aborted
run, which made `test:brand-logo-file` fail on every case with the same 69 bytes.
A test run that dies half-way can leave its fixture behind — check the database
before blaming the code.

**`test:panel-cards` still fails** (Settings carries 2,058 words against a 600
cap). It predates this work and trimming the cards' prose is the owner's call.

## `order: 3.5` is not an order — the buy row sat above the product name, 2026-09-29

Asked for as "fix product page mobile alignment, centering, spacing and padding".
The biggest fault was not a spacing value. `product-mobile-layout.js` (2026-09-20)
put the phone product page's blocks in the owner's specified order with flex
`order`, and gave the qty / Add / Buy row `'3.5'`. **CSS `order` is an
`<integer>`**; an invalid inline style is dropped silently, the row fell back to
`0`, and it painted FIRST — above the product name, with the wishlist heart
wedged against it — on every phone, in both languages, for nine days. Every rig
was green because none of them asked where the row *painted*: the script's own
comment even explains the fractional number as a feature.

Steps of ten now (10 title, 20 price, 30 size, 40 buy row, 50 delivery, 60
description, 70 size guide). `test:product-phone` measures the boxes, not the
style that asked for them: painted order, 16–40px between blocks, name and price
on the page centre, name padded clear of the heart, the Fit card's label
balanced, the breadcrumb band not a banner. Mutation-tested both ways (the `3.5`
back; the spacing sheet removed).

Other measured spacing faults, all in `css/40-product-mobile-spacing.css`: 48px
above the breadcrumb and 24px below; a two-line name running under the heart
(padding equal to the button on BOTH sides keeps it centred); the Size card's 40px
reserved stock-note line reading as 48px of bottom padding; the Fit card keeping
the header's 12px margin for a body that is `hidden md:block`; the description
12px under the list while everything else is 24–32px.

**The general rule:** a value handed to CSS from a script can be rejected without
a sound. Assert on the *computed* result (`getComputedStyle(el).order`, or better
the painted position), never on what was written.

A note on process, since it cost a minute: a screenshot script run from the repo
root writes into the repo root. The first "after" images were the OLD ones for
that reason, and stray `pv-*.png` files sat untracked in the checkout. Run rigs
from the scratchpad, or give them absolute output paths.

## The home tiles are editable from /backends — category_art, 2026-09-29

Asked for as "make category images editor at backend"; the owner chose the four
home tiles (all sizes and both languages), stored in the database, on the panel's
own **Home slides** screen. I first offered "Settings" and "the Slides screen" as
if they were one place: the panel HAS a Slides screen (h1 "Home slides"), and the
older hero card mounts on Settings under a heading that reads "Settings". Look at
the panel's actual screens before naming where a card goes.

**How it works.** The tiles stay files in `/cats/` at the URLs the bundle asks
for. `.htaccess` sends exactly `cats/(desktop|mobile)/art-(men|women|accessories|outlet)(-rtl)?.(webp|jpg)`
to `api.php?r=cat_art`, which serves the row in `category_art` when there is one
and the shipped file when there is not — or when the table, the row or the
database is missing. Deleting the rows is the whole "reset". `no-cache` + ETag, so
a replaced tile shows on the next load (the service worker's stale-while-revalidate
makes it the next-but-one for a returning visitor) and an unchanged one is a 304.
The rule names the four tiles and nothing else, so the stray
`cats/desktop/outlet.jpg` and every other `/cats/` path stay plain files; the
Apache rig asserts both halves. `scripts/dev-router.php` mirrors it.

**The picture work is in the browser** (`assets/category-art.js`): cover-crop to
1216x706 and 900x570, the Arabic frame is the English one mirrored (the art carries
no text), each encoded as webp and jpeg, eight pictures in one request. **The server
measures every one again** (`store_cat_art_decode`): type, magic bytes, cap, and
EXACT dimensions — a wrongly shaped tile would be cropped by the page in a way the
owner never saw. One transaction; a refusal changes nothing.

**Tests.** `test:category-art` proves it in a real browser and reads the served
PIXELS: a picture red on the left and blue on the right comes back red-left/blue-right
in English and blue-left/red-right in Arabic, so the mirror is measured. Its
row-serving check saves the MEN tile's bytes as WOMEN and requires those bytes at the
women URL — "the response is 200" would have passed on the shipped file.

**A fourth, found by thinking rather than by any rig, and the worst:** the first preview used `URL.createObjectURL(file)`, and the live Content-Security-Policy reads `img-src 'self' data: https://static…` with NO `blob:` — so on the real server every chosen file would have been reported "not a picture", while the sandbox (`php -S`, no CSP header at all) showed it working. It reads the file as a `data:` URL now, and the rig fulfils the panel's document with the policy **read out of `.htaccess`** (minus `upgrade-insecure-requests`, which would turn http://127.0.0.1 into https), so the blob mutation now fails it. **A sandbox that sends no security headers cannot tell you a browser feature works in production.**

**Three things it caught in itself.** The card first rendered in ARABIC inside the
English panel, because it read `document.documentElement.lang`, which is `ar` on
every page (the storefront default). It also widened the whole screen: a canvas's
intrinsic size (1216px) is its flex item's max-content, so `width: min(100%, …)` on
it resolved as `auto` for wrapping — fixed pixel widths and `max-width: 100%`. And
the rig's "removes itself on another screen" failed until it waited for the Orders
heading: clicking straight through a screen that has not mounted yet proves nothing.

**Live**: run `scripts/publish/migrate-category-art.php` after publishing (order is not
critical: without the table the tiles are the shipped files and the card says so).

**The backend scan that came with it** (2026-09-29): 35 backend suites green locally;
live `live-scan` "no problems", `live-admin-gate` 95 guarded routes / 0 answering 200,
`live-deploy-check` secret 0600 and no new attempts, `live-login-check` normal. One
red check that predates this work: `hero-slides-panel-test` — "formula matches the REAL
rendered hero" fails at 1280 and 390 (real 84.7 vs 100, 33.3 vs 46.6): the panel's crop
preview formula is stale against the hero-size changes. The owner's call whether the
preview should follow.

## The phone hero is 40svh, and the product photo opens on a real picture — 2026-09-29

**Phone hero 55svh → 40svh** ("reduce hero slides layout size to be fitted with mobile";
the owner chose about 40% of the screen). Short is 32svh now, Tall 40svh, Full and every
desktop height unchanged. It is written in FIVE places that must agree — `02-hero.css`
(the override and the two fallbacks), `34-hero-band.css`, `38-hero-size.css`, the boot
script in `index.html` and `rules-live.js` — and the boot script is one of the five
CSP-hashed inline scripts, so the hash in `.htaccess` (three copies) moved with it.
**Base64 hashes end in `=`: appending another one to a value that already ends in `=`
gave `==`, a hash that matches nothing, and `test:csp` said so.** On a 390x844 phone the
hero plus "Shop by category" plus the first tile now fit on one screen; the crop keeps
the head (focal_y 15) and trims the legs.

**The hero-slides panel's crop preview had been wrong for five days**, and its failing rig
was the clue: it subtracted a 132px / 112px caption band from the hero's height, but the
photo box has been the hero's WHOLE height since the band was folded in (real 84.7% at
1280x800 = exactly 75svh). Corrected in `hero-slides.js` and its rig — which now passes.
A red rig you did not cause is still a claim about somebody's code.

**The product photo's tap opened a grey square.** The bundle's lightbox starts its photograph
list with its own placeholder (the first `<img>` in the slider is the 0px-wide grey
gradient), opens at index 0, and says "Image 1 of 3" for a product with two photos.
`assets/product-zoom.js` takes the tap first (capture phase on `document` runs before
React's root) and opens its own viewer on the photograph that is showing: pinch, double-tap,
drag (clamped), swipe (direction follows `dir`), wheel, arrows, Escape, focus return, scroll
lock. **The gallery itself is `role="button"`, so a guard written as
`target.closest('button, a, [role=button]')` matched the gallery and the viewer never
opened** — only an interactive element INSIDE it is left alone. `test:product-zoom` drives
it in a real browser (touch, Arabic, desktop wheel) with synthetic pointer events and reads
the browser's own transform; mutation-tested (interception removed; RTL swipe ignored).
One of its own checks was a tautology (`... || true`) until a second look; the pan-clamp check
read a transform mid-animation (25 instead of 325) until it waited for the settle.

**Sharper uploads.** Product photographs are shrunk to 2000px (was 1400) with 'high'
resampling and a first quality of 0.86, under the SAME 1.1 MB ceiling; brand logos keep 1400
and 0.82 because their server-side cap is 160 kB. `shrink(file, opts)` takes the profile,
`product-photos.js` passes it. **Not done, and a decision:** serving phones a smaller copy.
`?r=product_image&w=` exists, but resizing per first request on shared hosting costs CPU on
every new visitor (the CDN is bypassed), and the alternative is a second stored copy per photo.
Phones download the full photograph, which is now larger.

**Desktop product page, found on the way:** the wishlist heart is pinned to the title row's end
corner, so a long name ran under it at 1280px; and the Size card's reserved stock-note line read
as 48px of missing padding. Both fixed at every width in `40-product-mobile-spacing.css`.

## The Payments screen, and an overlay that found the wrong form — 2026-09-30

Asked for as "make payment setup at backend"; the owner chose methods on/off, a
connection test, its own screen and COD limits. **`payments-screen.js` adds a
Payments button to the sidebar and phone tab bar and draws its own screen inside
`.admin-content`**, hiding the bundle's children while open (CSS class on the host)
and giving the screen back on any other nav click. The credentials card
(`payment.js`) now mounts under the Payments heading, not Settings. The switches are
the existing `payment_methods` rule; `cod_max_fils` (0 = none) is new, enforced in
`?r=order` and refused as `cod_over_limit`; `payment_check` (`&live=1` logs in to CBK
and reaches the KNET host, never charges, never returns a credential).

- **Switching a method off only worked on the server** — the bundle's checkout kept
  offering it and refused at the last step. `rules-live.js` hides the label and picks
  the first available radio through its own click. T-Pay is never turned ON there:
  the bundle shows it only when `config.js` says `tpayEnabled`.
- **A COD fee was asked for and NOT built.** `?r=discount` quotes without a payment
  method, so the bundle would show a total lower than the one charged — the drift
  api.php already warns about. It needs the checkout to send the method.
- **The forgot-password form appeared inside the payment card**: `password-reset.js`
  found "the login form" by any `input[type=password]`, and the credentials card has
  five. The rig that caught it counted password boxes in the card (7, expected 5).
  Both login overlays now draw only when there is no `.admin-content`.

## The product card is the owner's screenshot, 2026-09-30

A table first ("use this as product grid style"), then a **screenshot** ("use this
style"). The screenshot wins where they differ, and it was SAMPLED, not eyeballed
(`PIL` on the pixels): card `#0e1116` with a faint 1px edge, a **1.09:1** photo (not
4:5 — 453x416 in the picture), an orange pill top-LEFT and an outline heart top-RIGHT
in BOTH languages (physical corners), the orange + at the caption's bottom-right
(off the photo), caption brand / name / "● colour" / price + struck old price, all
**left-aligned, Arabic included**. That retired the centred name and price chosen
hours earlier (43-). Kept from the table: type sizes (14px name, 16px bold price) and
the caption ≤ 85px — the screenshot is of unknown zoom, so its proportions are
followed and its absolute sizes are not.

- `direction: ltr` on the caption fixes the layout; `unicode-bidi: plaintext` on each
  text keeps Arabic reading right-to-left and "د.ك 8.000" currency-first.
- **The photo link is `position: static`** so the heart, badge and + resolve against the
  card. Writing `inset-inline-end:auto` AND `right:4px` together in LTR cancelled the
  right (logical and physical are the same property): don't declare both.
- The sale chip is bottom-anchored in the bundle; setting only `top` stretched it into
  a full-height orange bar. A sale + bestseller card stacks the two pills.
- The colour line needs `colour` on `?r=products` (new, from `product_attrs`, key +
  names + swatch only, absent when the table or row is). `brand-badge.js` draws it.
- White text on the picture's orange (#f56315) is 3.1:1; the badge uses #cf4a0b (4.5:1).
- Names are one line with an ellipsis, as in the picture; the colour line now says what
  the cut-off "— Navy" used to. Not taken: the picture's filter pills (removed on the
  owner's instruction) and its header.
- `test:brand-badge` had a stale assertion (a brand with no logo now shows its NAME); it
  counts logos now.

## One shop, one look — the theme scan and the owner's choices, 2026-10-01

Asked for as "make full scan for all theme then give full suggest to improve
it". The scan covered 17 pages, phone and desktop, in both languages. The owner
took all four groups it proposed, and chose each design question from options
rendered side by side.

**Bugs** (`8faa614`, live): the + covered the start of every Arabic card name;
the home tiles had no focus ring; three standalone pages had stale copies of
the colour ramp and light scrollbars; the /backends brand colour missed 13
things; the side-page headings were painted over the theme. **Speed**
(`a341c3f`, live): CSS without comments (`sporta-ui.css` went from 83 KB to
12 KB gzipped). Four "woff2" fonts that were really TrueType are now real
WOFF2 (`test:font-format`). The Adobe kit loads only when its font is chosen.
**Retracted:** a "14px inputs zoom on iOS" finding. The bundle forces 16px
under `pointer: coarse`, and the reading came from a browser without touch
emulation.

**The design choices, and where each one lives:**

- **ONE CARD — the /shop card on every grid.** `home-products.js` and
  `category.php` draw the bundle's own /shop markup, so `44-product-grid-spec.css`
  styles all of them. Prices go through `Intl` `en-KW`/`ar-KW`, which gives
  exactly the bundle's two strings. **`card-heart.js` makes their heart real**:
  it writes `localStorage.sporta_wishlist` and dispatches the `StorageEvent`
  the bundle's WishlistProvider listens for, so there is one wishlist, not two.
- **CATEGORY PAGES — the shop's header and footer, banner 45svh.** `category.php`
  now LINKS the bundle CSS, `sporta-dark.css` and `sporta-ui.css` instead of
  carrying a palette copy. `test:palette-copies` checks the link is there and
  that no copy remains. The header's empty hairline `<div>` is load-bearing:
  without it the bar was 1px shorter than the shop's.
- **TITLES — one style.** `58-page-titles.css`: Alexandria 700, 26px on phones
  and 30px from 768px, white, with a 56x4 `--brand` bar (centred on the product
  page and on centred pages). The category title is dark on its white banner.
- **CLEAN-UPS.** One outline button (`59-outline-buttons.css`). Fewer greys:
  the accent is `--sp-text`, the secondary greys are `--sp-silver`, and the
  dark inks are one `#171a1e`. The browser bar (`theme-color`) is `#2d3034`,
  the header's colour, on `index.html`, `category.php` and the manifest.
- **NOT chosen: bigger tile labels.** Leave them.

`npm run test:theme-unity` holds all four. It measures each grid against
**/shop's own card**, not against numbers typed into the rig, so a later change
to the /shop card is followed rather than fought. Mutation-tested five ways.

**What the work found in itself:**

- **The + beside the price sat over the size chooser in Arabic.** The chooser
  opens over the card, its first size lands under the + (z-index 21), and the
  tap went to the +. While the chooser is open the + steps aside
  (`visibility: hidden`); the chooser has its own close button.
  `quick-add-grids` caught it, in Arabic only.
- **`quick-add-size.js` counted the heart as an add button** in Arabic, because
  the heart's label also begins "أضف". It ignores `[aria-pressed]` now.
- **`tile-art.js` versioned the four placeholder names that are MEANT to 404.**
  When the browser had already asked for one, it asked again, which gave 8 404s
  a load instead of 4. How often that happened depended on script order, and
  adding `card-heart.js` before it made it likelier. Only `art-` files get the
  `?v=` now. **A flaky count is a race until shown otherwise.**
- **Six rigs encoded the old design and were updated, not deleted.**
  `side-pages` (25px → 26/30, and the /shop and product titles now DO wear the
  bar — that check is inverted), `photo-shape` (the category card's selector),
  `css-audit` (`main h1` is a recorded owner override), `category-pages`,
  `quick-add-grids` and `palette-copies`. **`photo-shape` printed the kinds it
  FOUND under "every kind was found"**, so the one missing kind was hidden in
  a list of six that were there. It names what is missing now.

## The hero's "half view" was its first frame — 2026-10-01

Asked for as "fix main hero slide layout, sometimes half view". The live shop
(`scripts/live/live-hero-state.php`) is Size **Full**, autoplay off, 7 slides,
two of them (ids 2 and 3) with no phone picture. Three faults, each measured:

- **A first visit painted the wrong Size.** The boot script read the Size an
  EARLIER visit had cached and fell back to Tall: an 84px strip on a phone,
  144px on a desktop, growing to 469px / 442px only when `?r=slides`
  answered. On a slow connection the strip was the hero for as long as the
  request took, which is "sometimes". `seo.php` now writes the shop's Size onto
  the home page's `<html data-hero-size>` (one settings read, on `/` only,
  whitelisted, any failure leaves the page as it was) and the boot script reads
  it first. **Its CSP hash moved with it, all three copies.**
- **The drawn slides are not dead CSS.** The bundle draws its built-in slides
  (`.hero-strength`) on EVERY visit while `?r=slides` is in flight, then swaps
  in the photos. Their desktop height was a fixed 75svh, so every desktop visit
  went 442 → 600 → 442. They follow `--hero-h-md` now. Three comments in
  `02-hero.css` and `34-hero-band.css` called these rules a fallback that never
  renders while a photo row exists; that was true of the settled page only.
- **The phone picture was handed over whatever the Size.** Tall and Short are
  66-84px strips on a phone, where a 4:5 picture shows about a sixth of itself
  and the banner about half. `api.php` gives a phone the phone picture in Full
  only now, where it shows 75-100% of itself.

`npm run test:hero-first-frame` holds it: every Size, a phone (a REAL phone
User-Agent) and a desktop, first and return visit, one height from the first
frame to three seconds in. Mutation-tested both ways, and each mutation
reproduced the original numbers exactly.

**The measuring trap, and it cost a wrong first diagnosis.** A mobile-SIZED
Playwright context keeps the DESKTOP User-Agent, and the server picks the phone
picture by User-Agent, so every "phone" measurement got the wide banner and
showed a third of it. `hero-preload.js` said in a comment that the carousel
never uses the phone picture, which had been stale since 2026-09-29 and is
corrected. Use a device descriptor (`devices['Pixel 7']`) for anything the
server decides per device.

**Not fixable in code:** slides 2 and 3 have no phone picture, so on a phone
in Full they show the middle third of the banner at the owner's focal point.
A phone picture uploaded in /backends → Slides is the fix.

## The product card's caption is white with orange text — 2026-10-01

Asked for as "use white background with orange font, make more spacing". The
caption under the photograph is a white panel; everything else from the
2026-09-30 picture stands. Every grid shares it (one card).

- **The orange is the one that reads on white.** The brand's `#e0561c` is
  3.7:1 on white and the button orange 3.1:1, both under AA for 11-16px text.
  The name and price wear `--sp-ink-on-light` (`#c2410c`, 5.2:1, derived from
  the owner's brand colour by `theme.js`); brand, colour and the struck old
  price a deeper mix of it (7.4:1).
- **More room:** 12px inside the caption on a phone and 14-16px from 768px (it
  was 8-10px), 5-6px between lines, and 12/16px between cards on a phone,
  16/22px from 768px (it was 10px).
- A brand LOGO keeps a small dark plate, because logos are supplied to read on
  the dark theme and a white one would vanish on a white caption.

**Changing the background made two old rules lose, and only a colour read
showed it.** The name's rule (0,1,3) lost to `sporta-dark.css`'s
`[data-theme='dark'] .text-slate-900` (0,2,0), and the old price lost to
`.text-slate-400 … !important`, which left it silver on white at 1.9:1. Both
had been losing all along; they went unseen because the winner asked for the
same colour. **When a background changes, read back every colour on it.**

**And it surfaced a bug from 2026-09-30:** the rule that drops "Bestseller"
below "Sale" was (0,3,5) against the pill rule's (0,4,5), both `!important`,
so the two pills sat on top of each other. No bestseller had ever been on
sale, so nobody saw it. It names the pill as fully as the rule it moves now.

## The home page's middle, 2026-10-01 — headings, square phone tiles, a product banner

Asked for in one message: "less upper and under space" on the two home
headings, every category picture "single full row, square shape … bigger for
mobile", and a bar editor at /backends "upper the categories, product image
design" — for which the owner chose ONE PRODUCT BANNER out of three rendered
options.

**Headings.** "Shop by category" and "Best sellers" are 14/18px inside the white
bar on a phone (20/24px from 768px) with the orange rule 6/8px from the bottom,
and the category section ends 20px (32px) below its last tile.

**Phone tiles are square and one per row** (`36-category-white.css`, below 768px
only; a computer keeps 2×2). The art is re-composed for the square by
`make-white-tiles.py` (`compose_accessories_square`, a sharper person cut-out),
`STORE_CAT_VARIANTS` and `category-art.js` agree on 1080×1080, and `ART_VERSION`
moved with it (`tile-art.js` and `category.php` together, as always). **The
models are as big as the cut-outs allow**: the subjects in
`scripts/fixtures/tile-subjects/` are ~650px tall, so a bigger figure on a
1080px tile is an upscale. Sharper still needs larger source photographs.

### The product banner — assets/home-banner.js, home-banner-editor.js

Above "Shop by category": a product's photograph on one side, a headline, the
price and a button on the other, white card, mirrored in Arabic. **One row in its
own table** (`api/homebanner.mysql.sql`), not a `settings` row, because
`store_settings()` reads every settings row on every request and an uploaded
picture is up to 900 kB.

- **It fails closed, everywhere.** No table, no row, switched off, or a product
  no longer on sale with no headline: `?r=home_banner` answers
  `{"banner": null}` and nothing is drawn. **It ships OFF** — the migration
  creates the table and writes no row; the owner switches it on in the panel.
- **The product decides the price.** The banner carries no price of its own; a
  sale put on the product shows (old price struck) with nothing re-saved.
- **An empty headline is the product's name**, one empty language borrows the
  other, an empty button is "Shop now" / "تسوّق الآن", an empty link is the
  product's page, and an uploaded picture wins over the product's photograph.
- **The link may only stay in the shop**: one leading slash, no `//host`, no
  scheme, no backslash, no space (`store_banner_href`).
- **The uploaded picture** is served like `?r=slide_image`: hashed URL, a year
  immutable while the banner is ON. While it is off only a signed-in admin gets
  it, `private, no-store` — and a browser with no admin cookie is answered 404
  WITHOUT starting a session, or asking for the picture would mint a cookie on a
  storefront that sets none (`customer_id()`'s rule, applied a second time).

**The editor** is a card on the panel's Home slides screen, directly above
Category pictures (the home page's own order). It sends EVERY field on every
save — `home_banner_save` writes the whole row, so leaving one out blanks it,
the `brand_save` trap. Its preview is **the storefront's own drawing**
(`window.sportaHomeBanner.preview`), in both languages, from a `data:` picture
(the CSP has no `blob:`). That export returns the section UNMARKED: the
storefront script removes anything carrying its mark off the home page, and the
panel is off the home page — a preview built with the mark would be deleted the
moment it appeared.

**The migration reads the published `api/homebanner.mysql.sql`** rather than
carrying a second copy of the statement, so run it AFTER `publish-all.php`. It
refuses a file that is not the expected `create table if not exists`.

`npm run test:home-banner` (82 checks) covers the gate, every refusal, the
fail-closed paths (the table is moved aside to prove "no table"), the sale, the
picture's caching and cookie, the storefront in both languages with contrast and
a 44px button, and the panel under the shipped CSP. Mutation-tested eight ways, each caught by
name: a link to `//host` let through, a switched-off banner still drawn, a
stranger minting a session on the off-picture path, the admin's private view
cached publicly, the headline set as markup, the banner drawn BELOW the
categories, the preview keeping the mark (the storefront script deleted it), and
the editor dropping an untouched field from its save.

**Not done, and worth knowing:** the Expo app has no banner and no editor; this
is the website only.

## Photo-style Accessories and Outlet tiles, and their motion — 2026-10-01

Asked for as "make Sporta Outlet and accessories category images with animation, realistic
items product, and shelves for Sporta Outlet". The owner chose generated photo-style images
and subtle motion.

- **The pictures** are cut-outs of two studio photographs generated with ByteDance Seedream 5
  Pro (≈$0.15 each, 2048x1152). **The generations are not in the repository**, only their
  cut-outs: `scripts/fixtures/tile-subjects/photo-*.png|jpg`, made by
  `scripts/cut-photo-subjects.py` (alpha from colour distance to the white ground, largest
  connected piece only, neutral-grey pixels dropped from the black items so the generator's
  floor shadow does not show). `make-white-tiles.py` composes them: `photo_items()` onto the
  orange band with a drawn contact shadow, `photo_shelves()` as the Outlet's slanted panel.
  The drawn flat items and `draw_shelves()` are left in the file for a revert.
- **Desktop Accessories now uses the three-row square layout** too: the photo items are too
  wide for the old two-row one. The generator **re-rolls the grain of Men and Women** when
  its random stream shifts (here, because the two-row call went away): restore them with
  `git checkout -- cats/*/art-men* cats/*/art-women*` before committing.
- **Motion** (`css/64-category-motion.css`, trigger in `tile-art.js`): when a tile is first
  45% on screen it gets `tile-in`; Accessories floats 6px, two slow cycles; the Outlet gets
  one light sweep (the tile's `::before`, below the copy, mirrored in Arabic). Nothing runs
  under `prefers-reduced-motion`, or before the tile is seen. The Accessories art is one
  picture, so the whole composition floats, not each item. Per-item motion needs layered art,
  and the tiles are owner-replaceable from /backends (`category_art`), so a layer set would
  disagree with a replaced picture.
- `ART_VERSION` is `20261002a` in `tile-art.js` and `category.php`.
- **Men and Women models replaced 2026-10-01** with sharp generated studio photos (~1070px tall cut-outs, was ~650 and muddy), cut by `scripts/cut-model-subjects.py` (small holes only filled, edge un-matted from white). The owner approved them.

## The page body is white, header and footer stay dark — 2026-10-01

Asked for as "make main website body background is white color"; the owner chose the page body only. `css/65-white-body.css` sets the body white and **redefines the dark theme's variables on `main`** (`--sp-black/tile/panel/raise/line/silver*/text/accent/ember`), so everything between header and footer flips with no per-element rules. Header, footer and hero keep the dark values.

- **Dark islands** restore the dark ramp inside `main`: `.action-bar`, `.bg-ink-silver` (the promo panel), the logo strip and the card photo box (a white heart on a light tile measured 1.11:1).
- **New tokens** so a flipped `main` still reads: `--sp-chip` (chip fill), `--sp-card-edge` (card border), `--sp-field-edge` (input edge, 3:1 on white).
- Titles needed extra `:not()`s to beat `58-page-titles.css` (0,3,2 `!important`).
- `css-audit` skips elements inside `main` unless in an island; `test:white-body` asserts the body's own values. There is no light mode (one mode, dark), so nothing tests one.

## Side-aligned section headings with "View all" — 2026-10-01

"Shop by category" and "Best sellers" on the home page sit at the start side with a short orange accent before them; a "View all / عرض الكل" link to /shop sits on the end side (owner's choice of four). `css/66-section-heads.css` + `assets/section-heads.js`. The link is appended to the SECTION, not the `<h2>`, so the heading's accessible name stays the heading; it is placed absolutely over a row whose height is fixed by `--sh-row` (padding + line-height). The bar under the titles is hidden there.

**Also new today:** the five hero photo slides carry neutral art (`assets/hero/*-neutral-*.webp`, `scripts/publish/publish-hero-neutral.php`): bright, no vignette, no tint, generated at 3840x1524. The old dark grade was IN the pixels; nothing in CSS paints over the photo. The centred art is still in the repository to undo. Slides 2 and 3 (`kind=drawn`, no phone picture) were not touched. And `test:side-pages` now expects DARK titles; it had been missed when the body went white.

## Full product names in the grids — 2026-10-02

Asked for as "make name of product name at grid full no hidden". The name in every grid card (one card, `44-product-grid-spec.css`) wrapped to as many lines as it needs instead of one line with an ellipsis; the bundle's `line-clamp-*` (display -webkit-box + overflow hidden) is undone there. `test:product-grid-spec`'s caption cap is now 85px **plus one line-height per extra line of a wrapped name**: the cap came from the 2026-09-30 spec of one-line names, and the owner's newer instruction wins.

## Product card edges are visible — 2026-10-02

After a full CSS scan reported only quiet decorative hairlines, the owner chose "card edges only": the product card's border on the white body is `--sp-card-edge: #8a9199` (3.2:1 on white) in `65-white-body.css`, every grid. Dividers elsewhere were deliberately left soft; `test:borders` and `test:site-contrast` still REPORT them (not failures).

## Men and Women tiles share one alignment — 2026-10-02

"make all models as same alignment" (the owner chose the category tiles). `compose_person()` in `make-white-tiles.py` centres each figure on ONE fixed line by its TORSO (alpha centroid of the top 45%, so a stride or an elbow cannot pull the body off the line), and lays the band, stripes and shadow out from a reference box of the same size for every model. Same head height, same floor, same band on both tiles. `ART_VERSION` is `20261002a`.

## Mobile and desktop CSS in their own files — 2026-10-02

Asked for as "make the mobile version have native setup css and desktop native separate"; the owner chose separate files. `npm run build:css` now writes THREE stylesheets from the same 66 sources: `sporta-ui.css` (shared), `sporta-mobile.css` (top-level `@media` blocks that can only match a phone, max-width ≤ 767.98px) and `sporta-desktop.css` (min-width ≥ 768px). `index.html` (and its `<noscript>`) and `category.php` link them in that order with `media="(max-width: 767.98px)"` / `media="(min-width: 768px)"`. The `@media` wrappers stay ON the moved rules, so each rule matches exactly where it did; the link's media only lets the browser skip the other device's file. Keep editing the SOURCES as before; the split is automatic.

**Moving a rule later can change the cascade, and the first two builds did.** A block a LATER shared rule overrides must stay shared, or it comes last and wins: the category tiles' gap went 8px → 28px and the Best sellers padding moved. **Every phone/desktop block now moves** (2026-10-02, "fix it"). Where a LATER shared rule overrode one (same property FAMILY — padding*, margin*, gap*, inset/top/left… — on a subject sharing any class/attribute token), the build COPIES just those declarations into the device file at the shared rule's own position, wrapped in the moved block's own media query, so the override still wins exactly where it did. 105 copies; gzipped, a device loads ~13.9 KB against 13.3 KB for the single file. The sources are unchanged — the overrides are layered owner edits (category tiles ×5, headings, best sellers, type scale). An intermediate build that KEPT the 32 overridden blocks shared moved only ~2 KB per device. Proved by a computed-style snapshot of EVERY element (`scripts/_style-snap.mjs`): 10 pages × phone/820/1280/1920 × both languages, **0 differences** against the single-file build, after the first two builds had shown 462. Re-run it before trusting any change to the split.

`.htaccess`'s fixed-name revalidate list gained the two files — and `section-heads.js`, which had been missing from it since 2026-10-01 (`test:htaccess` caught it).

## Phone and desktop theme — 2026-10-02

Asked for as a separate setup for desktop and mobile "for css and all theme"; the owner chose custom CSS + theme. The theme row keeps the all-devices values at the top and two optional overrides, `phone` and `desktop`, validated by the SAME rules (`invalid_theme_phone_<field>`). `theme.js` wraps each in `@media (max-width: 767.98px)` / `(min-width: 768px)` after the all-devices rules, custom CSS included (still skipped on /backends). Empty = same as all devices.

- **A save that omits `phone`/`desktop` keeps the stored ones.** That is what stops the older whole-row cards erasing an override; `theme-colors.js` deletes both keys before saving, so it cannot resend a stale copy read at load either.
- **`custom-css.js` was blanking the five bar colours and the page colour on every save**: its key list predated them. Fixed on the way.
- The card is `assets/device-theme.js`, under "Buttons and bars" on Settings, with Phone/Desktop tabs. `test:device-theme` saves through the panel and reads the header colour back at 390 and 1280.
