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

### This is a breaking change

Anything relying on public `list`, public `del`, or public overwrite stops
working. If the old admin panel (`admin.html`) uses those without sending
`X-Wain-Admin`, it will need the token added. Check before you upload.

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

And the question none of this answers: **if the old app is finished, delete
`api.php`, `wain.db` and `admin.html` instead.** The Next site does ordering
through Supabase with row-level security, and the whole of this file stops
mattering.
