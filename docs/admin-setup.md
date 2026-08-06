# لوحة التحكّم — الإعداد

The admin lives at `/admin`. It is a client-side app that talks to Supabase
directly; the site itself stays a static export on Hostinger, so nothing about
hosting, the domain, or the deploy pipeline changes.

Until the two environment variables below are set, `/admin` renders a short
"not configured" page and **the public site behaves exactly as it does today**,
serving its built-in copy of the places. Nothing breaks by not doing this.

## 1. Create the project

1. Create a project at supabase.com (the free tier is enough).
2. Open **SQL Editor** and run the whole of `supabase/schema.sql`.
   It creates the `places` and `admins` tables, the row-level-security
   policies, and seeds the 17 places the site already ships with.
   Re-running it is safe — the seed uses `on conflict do nothing`.

## 2. Create your login

1. **Authentication → Users → Add user.** Use a real email and a strong
   password. Tick "auto confirm".
2. Copy that user's UUID.
3. Back in the SQL editor, grant it admin rights:

   ```sql
   insert into public.admins (user_id, email)
   values ('PASTE-THE-UUID', 'you@example.com');
   ```

4. **Authentication → Providers → Email:** turn **off** "Enable sign ups".
   Otherwise anyone could create an account. They still could not edit
   anything — writes require a row in `admins` — but there is no reason to
   allow it.

## 3. Point the site at it

**Settings → API** gives you the two values. Put them in `.env.local` for local
work, and in the GitHub repo (**Settings → Secrets and variables → Actions →
Variables**) as `SUPABASE_URL` and `SUPABASE_ANON_KEY` for deploys:

```
NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
```

Then rebuild. `/admin` will show a login form.

> The anon key is meant to be public — it ships in the JavaScript of every
> Supabase site. Row level security is what protects the data.
> **Never** put the `service_role` key in this project: it bypasses RLS
> entirely and would hand full database access to anyone who views source.

## What is live, and what waits for a deploy

| Change | Visible on the site |
| --- | --- |
| Editing an existing place | **Immediately** on `/explore` |
| Hiding / unhiding a place | **Immediately** on `/explore` |
| Adding a new place | Listed immediately; its own `/places/<slug>/` page after the next deploy |
| Home page "featured" | After the next deploy |

The reason is the static export: every place page is generated at build time,
so a brand-new slug has no page until the site is rebuilt. Push any commit, or
run the deploy workflow manually, to regenerate.

## Keeping the built-in copy fresh

`src/lib/places.ts` stays the build-time snapshot and the fallback used when
Supabase is unreachable. It is not updated automatically. When the database has
drifted meaningfully, refresh it so first paint and SEO match what the database
holds.

## Security notes

- Reads are limited by RLS to rows where `published = true`.
- Every insert, update and delete additionally requires the caller to be in
  `admins`. Being signed in is not enough.
- The `/admin` page is `noindex, nofollow` and disallowed in `robots.txt`. That
  keeps it out of search results; it is not a security boundary — RLS is.
