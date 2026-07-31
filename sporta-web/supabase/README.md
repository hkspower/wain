# Setting up the database

One file, one paste. **`SETUP-ALL.sql`** — 15 parts, in the only order that
works. Safe to run again as many times as you like; it is verified to be
re-runnable on every change.

---

## Do this

1. Open **[supabase.com](https://supabase.com)** → your project → **SQL Editor**
   (left sidebar) → **New query**.
2. Open `sporta-web/supabase/SETUP-ALL.sql`, select **all** of it, paste it in.
3. **Run**.

It ends by telling you whether it worked. Not "Success" — an actual table:

```
 01. products                              | ok            | 46 products
 03. create_order (checkout works at all)  | ok            | create_order(text,jsonb,jsonb,text)
 04. orders record size and fit            | ok            | ...
 06. warehouse outbox                      | ok            | 0 message(s) waiting to send
 08. customer invoice                      | ok            | /invoice/<order number> reads this
 09. admin allowlist                       | ACTION NEEDED | EMPTY — nobody can use /admin...
 11. product-images bucket                 | not provisioned | enable Storage, then run this file again
```

Read the **status** column. Everything should say `ok`. Two exceptions below.

---

## The two lines that will not say `ok` the first time

### 09. admin allowlist — ACTION NEEDED

This is the one that locks you out of your own shop, and it fails **silently**:
`/admin` loads, shows zero orders and zero products, and explains nothing —
because row-level security denies by returning no rows, not by raising an error.

Fix it in two steps:

1. **Create your admin account first.** Supabase → **Authentication** → **Users**
   → *Add user*, with your email and a password. (Or sign in once at
   `/admin` — the account has to exist before it can be allowlisted.)
2. Then run this in the SQL editor, with your own email:

```sql
insert into public.admin_users (user_id)
select id from auth.users where email = 'you@example.com'
on conflict do nothing;
```

Re-run `SETUP-ALL.sql`, or just `verify.sql`, and line 09 should read `ok`.

### 11. product-images bucket — not provisioned

Only matters when you upload real product photographs. Supabase → **Storage** →
enable it, then run the file again and the bucket is created, locked to admin
writes, 30 MB, no SVG.

---

## Checking later

`verify.sql` is a normal file. Paste **just that** into the SQL editor any time
to ask "is this database set up?" — or, once it has been run once:

```sql
select * from public.sporta_setup_report() order by check_;
```

---

## Two things the SQL cannot do for you

- **`WAREHOUSE_EMAIL`** on the `notify-warehouse` Edge Function, or orders queue
  up and are never emailed to the logistics company. See `../FULFILMENT.md`.
- **SPF, DKIM and DMARC** on `sporta.com.kw`. See `../DNS-EMAIL-RECORDS.txt`.
  Without them that mail goes to spam and nobody tells you.

---

## If something says MISSING

Run the whole of `SETUP-ALL.sql` again — the parts must run in order and a
partial paste leaves gaps. If a line still says `MISSING` afterwards, the error
will be in the SQL editor's output above the report; the first red line is the
one that matters, the rest are consequences of it.

Never run the individual migration files out of order. `SETUP-ALL.sql` exists
because that ordering is not obvious and getting it wrong fails quietly —
`checkout-migration` needs the tables from `schema.sql`, the allowlist migration
re-gates everything created before it, and `verify.sql` reports on all of it and
so must be last.
