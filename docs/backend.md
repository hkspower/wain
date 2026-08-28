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

## 3. No place in the catalogue accepts orders

`acceptsOrders`, `menuAr`, `salonKind` and `takesQueue` appear in `places.ts`
**only in the type definition**. Not one of the 36 place records sets any of
them:

```
acceptsOrders: 0 places
menuAr:        0 places
salonKind:     0 places
```

So even with Supabase live and the schema applied, the order panel and «خذ
دورك» would render nowhere. The features pass their tests because
`tests/run-journey.mjs:98` injects a place with `acceptsOrders: true` and a
menu — the code is exercised, the catalogue is not.

Enabling one is a data edit, not a code change: set `acceptsOrders`, add
`menuAr` with fils-accurate prices, and give it a `prepMinutes`.

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
