# The back end — what is actually wired up

Checked 28 August 2026.

**Ordering, the queue and the submission form are built, tested and enabled on
nothing.** Four separate things have to be true for a customer to place an
order, and today none of them is. They are independent, so fixing one changes
nothing on its own — which is why this file lists all four.

## 1. Supabase is not configured

`src/lib/supabase.ts` reads two variables and treats them as optional:

```ts
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
export const supabaseEnabled = URL_.length > 0 && ANON.length > 0;
```

Neither is set, here or in CI, so `supabaseEnabled` is **false**. That is a
deliberate and well-built fallback rather than a crash: every page still
renders from the build-time snapshot in `places.ts`, and `/admin` says
«Supabase غير مفعّل» instead of erroring. The site works. It just cannot take
an order, hold a queue place, or receive a business submission.

**This is baked in at build time.** A static export has no server to read an
environment variable later, so the pair is compiled into the bundle. A build
made without them is inert for its whole life, and no amount of configuring
the host afterwards changes it.

## 2. The deploy workflow never passed them

`deploy.yml` set `NEXT_PUBLIC_ELEVENLABS_AGENT_ID` and nothing else. So adding
the Supabase secrets in GitHub **would not have been enough**: the workflow
would have built the same inert site and deployed it, quietly.

Fixed. The build step now takes:

```yaml
NEXT_PUBLIC_SUPABASE_URL: ${{ vars.SUPABASE_URL }}
NEXT_PUBLIC_SUPABASE_ANON_KEY: ${{ secrets.SUPABASE_ANON_KEY }}
```

and a step after it emits a `::warning::` when the URL is empty, so a
back-endless deploy is visible in the run rather than discovered by a customer
whose order goes nowhere.

The anon key is public by design — row level security decides what it can do —
but it lives in `secrets` rather than `vars` so it is masked in logs. The
`service_role` key must never appear in either; it bypasses RLS entirely.

## 3. How many places accept orders is a data question

`acceptsOrders`, `menuAr`, `orderWhatsApp`, `salonKind` and `takesQueue` are
set per place in `places.ts`, and **`docs/content.md` (`npm run content`)
counts them** — read it rather than this file, which said «0 of 36» for weeks
after the catalogue had 52 records.

Where a count is zero the matching panel renders nowhere, with or without
Supabase. The features still pass their tests because `tests/fixture-build.mjs`
injects a place with `acceptsOrders: true`, a menu and (for the WhatsApp
flow) a number into a throwaway worktree build — the code is exercised, the
catalogue is not.

Enabling one is a data edit, not a code change, and **it no longer needs
Supabase**: with the database unconfigured an order goes to the place's
`orderWhatsApp` number as a WhatsApp message (see `docs/orders.md`, «Without
a database»). Set `acceptsOrders`, `orderWhatsApp`, `menuAr` with
fils-accurate prices and an `orderPrepMinutes`; `npm run audit:places`
refuses a place that accepts orders without a menu or a number.

## 4. The schema is written but unapplied

`supabase/schema.sql` — 72KB — defines five tables (`places`, `orders`,
`queue_tickets`, `submissions`, `admins`), **20 RLS policies** and the RPCs
behind order tracking and the queue. Whether it has been run against a real
project cannot be checked from here; nothing in this sandbox can reach a
Supabase host.

## What a release now says about itself

`build.json` records it, so the question is answerable from the deployed site
without credentials:

```json
"backend": { "supabase": false, "host": null }
```

and `npm run release` prints a warning in full when it is false. The URL's
host is recorded; the key never is.

---

# The other back end, still live

`api.php` over `wain.db` on Hostinger is **not** dead, and `admin.html` reads
and writes through it on every load. It is a separate system from everything
above — the Next site has never used it, and the old panel has never used
Supabase. See `server/README.md` and `docs/hosting.md`; the short version is
that deleting it takes the shop's order screen with it, and the hardened v3
cannot be uploaded until `admin.html` sends its token.

So there are two back ends: one live and unhardened, one hardened and unwired.
