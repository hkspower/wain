# Security review — wainkw.com

Full scan of the site, the build output, the Apache config and the database
policies. Everything below was checked; findings are separated from things
that were verified clean, and residual risk is stated rather than implied.

The shape of the system matters for reading this: the site is a **static
export** served by Apache. There is no application server, so there is no
server-side request handling to attack. The only live backend is Supabase,
reached directly from the browser with the public anon key, where **row level
security is the entire authorization boundary**.

## Fixed in this pass

### 1. RLS recursion took the whole admin panel down (high)

The policy on `admins` asked `admins` whether the caller was an admin:

```sql
create policy "admins can see the admin list" on public.admins for select
  using (exists (select 1 from public.admins a where a.user_id = auth.uid()));
```

PostgreSQL refuses this: `ERROR: infinite recursion detected in policy for
relation "admins"`. And it does not stay local — every policy on `places` and
`submissions` asks this table the same question, so the error propagated to
every admin read and write while the public site kept working normally.

Reproduced against a real PostgreSQL 16, before and after:

| | recursive policy | fixed |
|---|---|---|
| admin reads `admins` | ERROR recursion | returns their row |
| admin inserts a place | ERROR recursion | succeeds |
| non-admin inserts a place | — | correctly refused |
| public reads places | works | works |

The fix matches the row directly instead of asking a question that re-enters
the policy:

```sql
create policy "an admin can see their own row" on public.admins for select
  using (user_id = auth.uid());
```

One behaviour change: an admin now sees only their own row, not the whole
list. The panel only ever asks about itself, and one admin does not need to
enumerate the others.

### 2. Missing security headers (medium)

`X-Content-Type-Options`, `Referrer-Policy` and `Permissions-Policy` were
present. Added:

- **`Content-Security-Policy`** — see the honest limits below.
- **`X-Frame-Options: DENY`** and **`frame-ancestors 'none'`**. The site was
  framable by anyone, and `/admin` holds a real session, so that was a
  clickjacking route into it.
- **`Strict-Transport-Security: max-age=31536000`**, deliberately without
  `includeSubDomains` or `preload` — both are hard to walk back, and a
  subdomain not yet on HTTPS would be unreachable for a year. Add them once
  every subdomain is confirmed HTTPS.
- **`Options -Indexes`** and a dotfile deny. Directories without an
  `index.html` — `/_next/static/chunks/` and friends — must not answer with a
  file listing. Usually off at the host, but "usually" is not a setting.

### 3. Third-party map frames were unsandboxed (low)

Both OpenStreetMap embeds now carry `sandbox="allow-scripts"` and
`referrerPolicy="no-referrer"`. Scripts are all the map needs; withholding
`allow-same-origin`, `allow-popups`, `allow-forms` and `allow-top-navigation`
means the frame cannot reach its own cookies, open windows, or navigate the
page out from under the visitor.

### 4. `website` accepted any scheme (low, latent)

Nothing renders the submitted `website` field today, but a stored
`javascript:…` becomes stored XSS the day someone puts it in an `href`. It is
now scheme-checked at rest. Verified: `javascript:` and `data:` rejected,
`https://` and empty accepted.

## Verified clean

- **No secrets anywhere.** No keys, tokens or private material in the repo or
  the build output. `.env*` is gitignored with `.env.example` allowed; the
  three `service_role` matches in the tree are warnings *never to add it*.
- **No XSS sinks.** No `dangerouslySetInnerHTML`, `innerHTML`, `eval`,
  `new Function`, `document.write` or `insertAdjacentHTML` anywhere.
- **No untrusted parsing.** No `JSON.parse` of external input.
- **URL parameters are safe.** `?q=` renders as React text (escaped);
  `?category=` is validated against the eight known ids before use.
- **Every `target="_blank"` carries `rel="noopener noreferrer"`** — all four.
- **Every dynamic `href` is internally constructed.** Place links are always
  prefixed `/places/`, and the database pins slugs to `^[a-z0-9-]+$`, so a
  slug cannot become a scheme or escape the path.
- **Service worker is GET-only and same-origin-only**, so it cannot cache or
  rewrite third-party responses.
- **No source maps ship** (0 `.map` files), so the source is not published.
- **Admin authorization is server-side.** The client `isAdmin` check is UX
  only; RLS enforces it regardless.
- **`robots.txt` disallows `/admin/`** — discoverability, not a control. The
  control is the auth session plus RLS.

## The anonymous-write boundary, proven

`/add/` lets anyone insert into `submissions` — the one table the anon key can
write. Tested against real PostgreSQL:

| attempt | result |
|---|---|
| anon submits a pending business | succeeds |
| anon submits with `status='approved'` | **refused by RLS** |
| anon reads the submissions table | **no data** |
| anon updates a row to approved | **refused** |
| anon deletes rows | **no rows affected** |
| same business submitted twice while pending | **refused** by the unique index |

The duplicate guard also normalises whitespace and case, so `' مقهى '` and
`مقهى` collide as intended.

## Residual risk, stated plainly

- **CSP contains `'unsafe-inline'` for scripts and cannot not.** Next.js
  inlines its hydration payload and a static export has no server to mint a
  per-request nonce. So the CSP is *not* a strong defence against injected
  inline script. What it does buy is real but narrower: script execution is
  pinned to this origin plus unpkg, `connect-src` names Supabase and
  ElevenLabs so exfiltration to an arbitrary host is blocked, `form-action`
  stops an injected form posting offsite, `base-uri` stops a `<base>` tag
  re-pointing every relative URL, and `object-src 'none'` removes plugins.
- **فهد's widget is loaded unversioned** from
  `https://unpkg.com/@elevenlabs/convai-widget-embed`. unpkg resolves that to
  whatever is newest at request time, so any future or compromised publish
  executes on the page with full DOM access — including the admin's session in
  localStorage. **Pin an exact version** (`…/convai-widget-embed@X.Y.Z`) and
  add an `integrity` hash if the artifact allows. This is inert until
  `NEXT_PUBLIC_ELEVENLABS_AGENT_ID` is set, so it costs nothing to fix first.
- **The admin session lives in localStorage** (supabase-js `persistSession`).
  Standard, but it means any XSS on `/admin` can lift the JWT. Given the CSP
  caveat above, treat `/admin` as the sensitive surface it is.
- **Submission spam has no CAPTCHA and no rate limit**, because there is no
  server to enforce one. Nothing publishes without a human, so the failure
  mode is a spammed review queue, not spam on the site. Escalation options are
  in `docs/business-registration.md`.
- **`npm audit` reports 3 high advisories** — postcss path traversal and sharp
  via libvips, both pulled in by Next 15.5.23. Both are **build-time only**:
  neither appears in the shipped bundle, and `next/image` is not used
  anywhere, so sharp is never invoked. A visitor to wainkw.com cannot reach
  either. The only fix `npm audit` offers is Next 16, a breaking major
  upgrade, which is a deliberate decision rather than a security emergency.

## Not verifiable from here

`openstreetmap.org` and `unpkg.com` are unreachable from the build sandbox, so
the CSP's `frame-src` and `script-src` allowances were reasoned about but not
exercised against the live third parties. The CSP was otherwise tested by
serving the built site with the exact header applied and driving nine routes
plus search and the registration form: no violations, hydration intact,
service worker still registering.
