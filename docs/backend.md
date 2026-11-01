# The back end — wain's own, on wainkw.com

Checked 4 October 2026. Everything before this date described Supabase, which
was never configured on any build; the history is in git and in CLAUDE.md.

**The site has one back end: `/api/wain.php`, a PHP file on the same host as
the pages.** It holds the places (so an admin can edit one live), the orders
the shop reads on its board, the queue tickets, and business submissions with
their photos. The source is `scripts/publish/wain-api.php`; the client that
talks to it is `src/lib/backend.ts`; the admin board is `/admin`.

## Why this and not Supabase

The site was written against Supabase and `NEXT_PUBLIC_SUPABASE_URL` /
`NEXT_PUBLIC_SUPABASE_ANON_KEY` were empty in the repository and in every live
build — four finished features sat inert behind a switch nobody could throw
without a third-party account. The owner chose their own server (4 October):
the Hostinger account already runs PHP 8.5 with PDO, SQLite and MySQL, and two
bridges before this one (`/api/tts.php`, `/api/media.php`) had proved the shape
— one file, fetched from a pinned URL and installed by a cron job, its state in
`<domain>/storage/` outside the document root.

What carried over unchanged: the column names, every CHECK rule (as PHP), the
semantics of the six RPCs (`order_status` and friends are actions now), and
the client's row types — `PlaceRow`, `rowToPlace`, `placeToRow` moved from
`supabase.ts` to `src/lib/place-rows.ts` without a line changing. `supabase/
schema.sql` stays in the repository as the unused Postgres alternative;
`audit:schema` holds it to naming every table the API writes.

## The switch

`NEXT_PUBLIC_WAIN_BACKEND`, read at BUILD time — a static export bakes it in,
nothing can supply it later:

| value | meaning |
| --- | --- |
| unset / empty | `/api/wain.php`, same origin — the default |
| `none` | off: ordering, the queue and registration are inert and say so; orders go by WhatsApp where a place has a number |
| a URL | an absolute endpoint, for a bundle with no origin (the apps use `https://www.wainkw.com/api/wain.php`) |

`||` rather than `??`, for the reason in `wain-ai.ts`: CI expands an unset
variable to the empty string.

`build.json` records it: `"backend": { "api": true, "url": "/api/wain.php" }`.

## What is on the server

```
public_html/api/wain.php             production, served at /api/wain.php
public_html/staging/api/wain.php     staging — the same bytes, its own database
public_html/data/places.json         the catalogue as rows, shipped by the export
public_html/images/business/<slug>/  approved photos (deploy.php never prunes images/)
storage/wain.sqlite                  production's database (0600)
storage/wain-staging.sqlite          staging's
storage/admin.secret                 the board's password — created EMPTY, owner fills it
storage/db.json                      optional: MySQL per stage, see below
storage/business-pending/            uploads awaiting review (media.php's)
storage/logs/wain.log                one line per request, 512K cap
```

**Engine.** SQLite by default — zero configuration, one file, the account's
PHP has the driver. MySQL when `storage/db.json` names a database for the
stage:

```json
{ "production": { "dsn": "mysql:host=127.0.0.1;dbname=u130124229_wain;charset=utf8mb4",
                  "user": "u130124229_wain", "pass": "…" } }
```

A stage without an entry stays on SQLite; two stages never share a database.
Every statement is written in the subset both engines run (VARCHAR keys, TEXT
for JSON, INTEGER booleans, ISO-8601 UTC strings, no upserts; locking is
`BEGIN IMMEDIATE` on SQLite and a `locks` row `FOR UPDATE` on MySQL), and
`php wain.php selftest` runs every statement on the configured engine. **That
is the only proof of MySQL this repository can have** — the sandbox has no
MySQL server; the API suite runs on SQLite.

## Installing it — the cron route

> **Dated note, 31 October 2026.** The paths below are the Hostinger shared
> account's, and `/home/u130124229/domains/wainkw.com/` was not on it that day:
> `www.wainkw.com` answered from a VPS, and its `/api/wain.php?a=ping` was
> reachable with the admin secret unset (CLAUDE.md, «The 31 October scan,
> continued»). Where the VPS keeps `storage/` is not recorded. Do not run this
> route as it stands.

The same fetch-pin-run every write path on this account uses (`docs/hosting.md`):

```
wget -qO /home/u130124229/w.php https://raw.githubusercontent.com/hkspower/wain/<sha>/scripts/publish/wain-api.php
php /home/u130124229/w.php install
rm -f /home/u130124229/w.php
```

`install` copies the file to both stages, creates `storage/admin.secret` empty
(0600), migrates each stage's database and seeds it from that stage's
`data/places.json` if the export has been deployed there. Then:

- `php …/api/wain.php version` — fingerprint, engine, whether the secret is
  set (by the runtime's own test, not `is_file`), log size.
- `php …/api/wain.php selftest` — every statement, on the real engine, in
  rows named `selftest-…` and deleted afterwards.
- `php …/api/wain.php seed` — after any deploy that adds a catalogue place;
  inserts missing slugs only, never overwrites a live edit.
- `php …/api/wain.php log 40` — the last forty lines.

One command per cron job, read at the first firing, delete, list.

## The admin secret

`storage/admin.secret` is created empty and never written by anything in the
repository. The owner pastes a long random secret in it with the hPanel File
Manager (outside `public_html`; the dated note above says why that path may no
longer exist), never into a chat or a commit. Until then every
admin action answers 503 `admin_unset` and `/admin` says which file to fill
rather than offering a password form that would refuse every password.

**A secret under 32 bytes answers 503 `admin_weak`**, before any guess is
compared or counted (14 October login scan, finding 2). `ping` reports
`admin: "weak"`, `version` reports `adminSecret: "weak"` and the file's mode
(`adminSecretMode`, octal), and the board says the file has to be replaced. The
count is bytes, because `strlen` counts bytes: 32 ASCII characters pass, but 16
Arabic letters (two bytes each) also pass although the owner's rule says 32
characters. Use ASCII. `version` never prints the secret or its length.

The signed media read (`?a=media_get`) is keyed on the same secret, so it gets
the same refusal: a four-character key was recovered offline from one signed URL
in 17 seconds, so that read answers `admin_weak` too.

The board sends it as `X-Wain-Admin`; it lives in the tab's sessionStorage, not
a cookie (no CSRF surface) and not the URL. A wrong token costs a quarter
second. `docs/admin-setup.md` has the owner's steps.

## The actions

Public: `ping places order_place order_status order_cancel queue_join
queue_status queue_leave queue_size submit vote_cast votes_get gap_report`.
Admin: `whoami places_all place_save place_delete place_publish place_location
orders_list order_set_status queue_list queue_set_status submissions_list
submission_reject submission_approve media_sign media_publish media_discard
gaps_list`.
`queue_join` with `source: walk_in` is admin too. `php wain.php actions`
prints the lists and `audit:schema` checks the client against them.

**Shortlist votes (7 October):** `vote_cast {poll, voter, place_slug, options}`
and `votes_get {poll, options}`, both public, both answering `{tally, total}`.
They use the `votes` table, keyed `(poll, voter)`, so a second vote from the same
device moves rather than adds.
- `poll` is the random `v=` a shortlist link carries (`newPollId()`), and nothing
  registers it in advance.
- `options` is the link's two or three slugs. A vote outside them is 422, and the
  tally counts only them.
- No name and no phone are stored. The voter is a random id the device keeps.
- Rows older than 30 days are deleted on the next vote, and a poll stops at 200
  voters.
- `supabase/schema.sql` carries a twin of the table (`audit:schema` requires
  one for every table the API has). No Postgres client uses it.

**Questions wain could not answer (14 October):** `gap_report {asked, area?,
offered?, source?}` is public and answers `{ok: true}` and nothing else. The
`gaps` table keeps what a visitor asked for that the catalogue does not hold.
- `asked` is 2–120 characters. A phone number (seven or more digits, either
  numeral set, with at most one space or dash between them) and an address are
  replaced with «[رقم]» and «[بريد]» before anything is stored. That is a
  pattern, not a guarantee: a number said in words is kept.
- `source` is `call`, `salem` or `search` and defaults to `call`. `area` and
  `offered` are optional text.
- The log line carries the first eight characters of the row id and the source.
  The question is never logged. `logline()` drops every non-ASCII byte, so the
  suite checks for an ASCII word, which an Arabic-only check could not fail on.
- Rows older than 30 days are deleted when the next gap arrives. Nothing deletes
  them on a timer, so a quiet site keeps its last month until someone asks.
- `gaps_list` (admin) returns the newest 200 rows and the total. Nothing on the
  site reads it yet.
- The agent's `report_gap` tool still posts to n8n. Repointing it is a live change
  the owner has not yet approved (CLAUDE.md, 14 October).
- `/privacy` does not describe this table yet. The sentence goes in with the
  repoint and the deploy, not before: the live site sends nothing to it today.

**Order emails (7 October):** the `shop_contacts` table maps a place to the
address a new order is emailed to. There is no action for it. It is set from the
CLI only: `php wain.php order-email <slug> <email|none>`. That keeps the address
out of `places.ts` and `data/places.json`, which are both public.
`order_place` sends one plain-text email through PHP's `mail()`, from
`orders@wainkw.com`, when the order is new and the place has an address. The
log carries `mail=none|sent|failed` and never the address. A failed send never
fails the order. The test suite points `WAIN_API_MAIL_DIR` at a directory, so
the mail is written there as JSON instead of sent.

`php wain.php sync-orders [file]` copies the five ordering fields from
`data/places.json` onto rows that already exist: menu, the on/off switch, the
note, the preparation time and the WhatsApp number. `seed` never overwrites, so
without it a menu added to `places.ts` after the first seed would never reach
the database.

Errors are `{ ok: false, error, status, field? }`: `invalid` 422 (with the
field), `duplicate` 409, `closed` 409, `rate_limited` 429, `admin_unset` 503,
`admin_weak` 503 (the secret is under 32 bytes).
A wrong token on `order_status`/`queue_status` answers `null`, the same as «no
such order» — the token is the whole authorisation, and the answer must not
say whether the id exists.

## Rates and sizes

Per address: 120 requests a minute, 20 public writes a minute (counted before
validation, so a refused body spends an attempt), 64K body. An authenticated
admin is exempt. The log keeps the action, the outcome, the first eight
characters of a row id, the hashed address — never a name, a phone, a note or
an email.

### Which address, behind a reverse proxy

«Address» is the connection's `REMOTE_ADDR` — and that is the proxy, if one sits
in front, so every visitor would share one bucket and a handful could lock
everyone else out of ordering. `wain.php`, `media.php` and `tts.php` therefore
share one helper (`clientIp()`, byte-identical in the three files, held so by
`npm run audit:client-ip`) that reads `X-Forwarded-For` **only from a proxy you
have named**, in `storage/trusted-proxies.txt`:

```
# one address or CIDR per line; # starts a comment
172.18.0.0/16        # the Docker network Traefik is on
```

- **No file, or an empty one: nothing is trusted**, and the visitor is
  `REMOTE_ADDR` exactly as before. This is the default and it is safe.
- From a listed peer, the visitor is the nearest hop **from the right** that is
  not itself listed. A proxy appends the address it saw, so everything to the
  left is the client's own claim and is never believed.
- A header that does not read as addresses, an unreadable list line, and `/0`
  are ignored, never guessed at.
- Name the proxy's network, not «everything private». A range-based first draft
  believed every private address, and an adversarial review showed why that is
  wrong: Docker shows an externally published port as its gateway address, and
  another container, a host process or an SSRF is private too — each could have
  chosen its own bucket, which made the limit easier to evade than the shared
  bucket it replaced.

What a listed peer must also be true of, because the code cannot check it:
the app's port is reachable **only** through that proxy (not published on the
host); the web server in front of PHP drops request headers whose names contain
underscores (`X_Forwarded_For` maps to the same PHP variable as
`X-Forwarded-For`, and `php -S` does not drop it — measured; whether the host's
Apache does was not checked); and the proxy appends to
`X-Forwarded-For` rather than passing a client's value through untouched. If
Apache runs `mod_remoteip`, `REMOTE_ADDR` is already the visitor and no list is
needed. `php wain.php clientip <peer> [x-forwarded-for] [trusted]` prints which
address would be counted, for the same three arguments.

**One IPv6 /64 is one visitor.** A /64 holds 2^64 addresses, so a counter per
address would be no limit at all. An IPv6 visitor's counter is filed under the
/64 (`2001:db8:1:2::/64`, hashed like any other key), and every address in it
shares that counter. IPv4 and IPv4-mapped addresses keep their old file names,
so a direct IPv4 visitor's file does not move. A direct IPv6 visitor's file name
does change once; the old per-address file is left for the sweep below.

**Counters are swept.** Each endpoint deletes a counter file (`all-`, `write-`
and `.rate-`) that nobody has written for an hour. This runs at most once every
ten minutes per directory, and the clock is `.swept`. It decides nothing: a
window that has passed already counts from zero, so deleting one never changes
an answer, including for a request that races the delete.

**A wrong admin secret is counted.** A request with a non-empty, wrong
`X-Wain-Admin` is counted against its address's own bucket before the 250 ms
sleep, and it hits the same per-minute cap as everything else, so guessing stops
at that cap instead of running at the sleep's rate (finding 1 of the 14 October
login scan). A secret under 32 bytes is refused before that count (above), so no
allowance is spent on one.

Known limits: a visitor is one /64, not one person; and a proxy that forwards
without appending can still be rotated around, because there is no coarse
backstop bucket on the peer yet. Past the cap, a wrong admin secret or media key
is still answered at once, with no delay: the 32-byte floor is what makes a
search infeasible, and a per-attempt delay past the cap is the owner's decision
(it holds PHP workers during a flood).

## What the tests prove, and where

- `npm run test:wain-api` — 230 assertions against a real `php -S` on SQLite:
  every refusal by name, every write read back, the token answers, the queue
  under contention, the write cap, the log's promises.
- `npm run test:net` — the client's reading of every answer, on a fake server
  that speaks the real shapes.
- `npm run test:backend` — the fixture build served by `php -S` with the real
  endpoints beside it: the whole customer journey (46) and the admin board in
  a browser (24), one wire end to end.
- `npm run audit:schema` (in `scan`) — every action the client calls exists,
  with the right gate.

What none of them can prove: MySQL (no server here — `selftest` on the host
is the check), and anything on the live site before `install` has run.

## How many places take orders is still a data question

`acceptsOrders`, `menuAr`, `orderWhatsApp`, `salonKind` and `takesQueue` are
set per place in `places.ts`, and `docs/content.md` (`npm run content`) counts
them. Where a count is zero the matching panel renders nowhere, with or
without a back end. With the back end on, an order from a place with a menu
goes to the board; `orderWhatsApp` is used only by a build with the back end
off (`docs/orders.md`).

---

# The other back end, still live

`api.php` over `wain.db` on Hostinger is **not** dead, and `admin.html` reads
and writes through it on every load. It is a separate system from everything
above — the Next site has never used it, and the old panel has never used
`wain.php`. See `server/README.md` and `docs/hosting.md`; the short version is
that deleting it takes the shop's order screen with it, and the hardened v3
cannot be uploaded until `admin.html` sends its token.
