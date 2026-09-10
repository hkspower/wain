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

| job | needs | was | now |
|---|---|---|---|
| cron-push | `vapid_public`, `vapid_private` | **every minute** | `5 * * * *` |
| cron-assistant | `n8n_webhook` | `*/5` | `20 * * * *` |
| cron-whatsapp | `whatsapp_token`, `whatsapp_phone_number_id` | `*/2` | `35 * * * *` |
| cron-fulfilment | `warehouse_email` | `*/10` | `50 * * * *` |

That was ~2,400 PHP processes a day on shared hosting producing the same error,
and none of it visible: a job's output is readable only one at a time through
the panel, and nothing reads it. **Loud and unheard** — the same shape as the
seven jobs that died on DNS for months while the panel looked healthy.

The others are untouched: `cron-stock` hourly, `cron-customer-mail` `*/10`,
`cron-invoice` `*/15`, `cron-voice` monthly.

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

**The checker was wrong twice, and a full check found it.** It had been built
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

## One mode. The light theme still exists in the files and is unreachable

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

**And a check run in the same breath as the write can measure the state before
it.** The publisher reported `plainName=STILL-BRIDGED` seconds after writing the
new `.htaccess`; a probe a minute later found the rule gone and the URL 404 by
all three routes — plain, cache-busted and `no-cache`. The bytes had been
verified by sha256 at write time, so the disagreement was LiteSpeed still
holding the old parse, not a failed publish. `scripts/live/live-tile-probe.php`
is what tells those apart, and the general rule is: **if a publisher's own check
contradicts its own verified write, re-ask before believing either.**

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

**The manifest in that checker is hardcoded, so it goes stale, and a stale
manifest reports the repository's staleness as the server's.** It was eight
hashes behind and missing two files that were live — a run would have called
two live files "missing" and eight correct ones "differ". Regenerate it from
`git ls-files` before believing a run, and diff the file's own manifest against
the fresh one afterwards.

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

## The live shop has no product photographs

`photos=0/46active`, `brandLogos=0/8`, measured 2026-09-05. Every product card
on the real site is blank. Photographs and brand logos are data: URIs in MySQL,
uploaded through /backends — the owner's images, not something to invent here,
and not something any script in this repository can supply. It is a bigger
visible problem than anything in the CSS.
