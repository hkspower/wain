# server/ — what runs on Hostinger, not in the Next build

`api.php` is the legacy site's back end: a key-value store over `wain.db`
(SQLite), still sitting in wainkw.com's `public_html`. The Next site does not
use it — that uses Supabase — but the old app does, and the database holds
real orders, RSVPs and invitations.

It is in this repository now because it was not, and that is most of how it
went wrong: the only copy was on the server, so nothing reviewed it, nothing
tested it, and five of its actions were open to the internet.

`npm run test:api` — 40 assertions against a real PHP server.

## What changed (v2 → v3)

| action | before | now |
| --- | --- | --- |
| `get?k=` | public | public — but you must know the exact key |
| `set {k,v}` | public **upsert** | public **create only**, in its own namespaces |
| `event` | public, logged the caller's IP | public, logs a salted hash |
| `list?p=` | **public** | **admin** |
| `del?k=` | **public, over GET** | **admin, POST only** |
| `stats bulk search export import purge` | admin | admin |

### Why each one

**`list` was the breach.** `list?p=orders:` returned up to a thousand order
keys to anyone who asked, and `get` did the rest. Closing it is what makes the
keys' unguessability worth anything.

**`del` over GET could fire by itself.** A crawler, a prefetch or a link
preview following such a URL deletes data with no human involved. Destructive
verbs are POST-only now.

**`set` was an upsert**, so anybody could rewrite an order that already
existed — its total, its status, whose it was. The public may now *create* a
key in `orders:`, `rsvp:`, `inv:`, `queue:`, `ask:`, `vm:`, `vmi:` and no
others; changing an existing key, or writing to the catalogue and the indexes,
needs the token.

**CORS was `*`**, so any website could do all of the above from a visitor's
browser. It is now the site's own two origins. A caller with no `Origin` — curl,
a cron job, the server itself — still works and gets no CORS header.

**The event log stored a raw IP per entry**, in a row the open API would hand
back. The privacy page promises nothing is collected. It stores a salted,
truncated hash now: still tells you "same visitor or not", is not an address.

**The token bootstrapped itself.** The old code wrote a hash of whatever token
the next caller presented if the file was missing, so deleting one file was a
way to become admin. An absent token file now disables admin actions and says
so.

### This is a breaking change — and it breaks the live admin panel

Anything relying on public `list`, public `del`, or public overwrite stops
working. The instruction here used to be "check `admin.html` before you
upload". **That check has now been done, by reading the live file through the
Hostinger connector, and the answer is that v3 breaks it.**

`admin.html` builds its entire data layer on `api.php`. It pings
`api.php?a=ping`, and if that answers `{wain:"api"}` it swaps its storage
backend from `localStorage` to the API — the file's own comment calls this
"مشترك حقيقي بين كل المستخدمين", real sharing between all users. Those four
operations are:

| panel calls | how | v3 verdict |
| --- | --- | --- |
| `?a=get&k=` | GET, no token | works — still public |
| `{a:"set",k,v}` | POST, no token | **breaks on update** — v3 is create-only |
| `?a=del&k=` | **GET**, no token | **breaks** — v3 is admin + POST only |
| `?a=list&p=` | GET, no token | **breaks** — v3 is admin only |

None of the four sends `X-Wain-Admin`. The panel *does* have a token — a
separate admin path reads `localStorage['wain-api-token']` and sends the header
— but the storage adapter never uses it.

**And the failure would be silent.** The wrapper around the adapter swallows
every error:

```js
async keys(p){ try{ … }catch(_){ return []; } }
async set(k,v){ try{ … }catch(_){ return false; } }
async del(k){  try{ … }catch(_){ return false; } }
```

So under v3 the shop's panel would not show an error. It would show **zero
orders, zero queue tickets, zero everything**, and quietly fail to save. For an
order screen that is the worst available failure mode: it looks fine and it is
empty.

**Do not upload `api.php` v3 until the adapter sends the token.** The change is
small — thread the same `wain-api-token` through the `call()` helper in
`admin.html` — but it has to land first, or at the same moment, and `admin.html`
is not in this repository.

## Installing it

1. **Put the token above the web root.** `api.php` reads
   `__DIR__ . '/../wain-admin.token'` — one level up from `public_html`, where
   no URL can reach it whatever `.htaccess` says.

   Generate the hash locally and paste the result into that file:

   ```bash
   php -r 'echo password_hash("PASTE-A-LONG-RANDOM-TOKEN-HERE", PASSWORD_DEFAULT), "\n";'
   ```

   Keep the plaintext token in your password manager — it is what you send as
   `X-Wain-Admin`. Minimum 24 characters; the code refuses shorter.

2. **Upload `api.php`** into `public_html`, replacing the old one. Keep a copy
   of the old one first.

3. **Delete the old `public_html/admin.token`.** It is a bcrypt hash of the
   previous token and nothing reads it any more. That completes the rotation.

4. **Check it:**

   ```bash
   curl -s 'https://www.wainkw.com/api.php?a=ping'                     # ok, v:3
   curl -s 'https://www.wainkw.com/api.php?a=list&p=orders:'           # 401
   curl -s -H 'X-Wain-Admin: YOUR-TOKEN' \
        'https://www.wainkw.com/api.php?a=stats'                       # counts
   ```

   If `ping` reports `v: 3` and `list` returns 401, it is in.

## Still open

The database is inside the web root. `.htaccess` denies it — the export's
`.htaccess` carries that rule forward — but a deny rule is one edit away from
being gone. `wain.db` belongs beside `wain-admin.token`, above `public_html`,
with `api.php` pointing at it there. That is a one-line change and a move, and
it needs a moment when nothing is writing.

And the question this used to end on — *is the old app finished?* — is now
answered: **no.** `admin.html` reads and writes `wain.db` through `api.php` on
every load. Deleting `api.php` would not throw an error either; the adapter
would fall through its `catch` to `localStorage` and the panel would carry on
looking normal while quietly becoming per-device and empty.

So the two paths are no longer equal. Deleting the old app is off the table
until the business has somewhere else to run its orders from. Hardening it in
place is the live option, and it needs the `admin.html` change above to go with
it.
