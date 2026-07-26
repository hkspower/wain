# Almuhallab Code — المهلب كود

The website of **Almuhallab Code**, a software company in Kuwait, plus the
systems it runs. An **HTML5 Progressive Web App** with no build step and no
dependencies: open it in a browser, or install Nokha1 to a phone's home screen
and run it offline.

The root of the site is the **company**. **Nokha1 (النوخذة)** is a product
inside it, entered at `/nokha1` — not the front door.

## Site map

| File | Page |
|------|------|
| `index.html` | **Almuhallab Code** — the company site: what Nokha1 is, services, work, how we work, contact |
| `nokha1.html` | **Nokha1 portal** — landing, registration, login, dashboard, plans |
| `nizam.html` | **النظام الموحد** — one page, four tabs: المركز المالي · صافي · XBRL · التوصيل |
| `safi.html`, `xbrl.html`, `delivery.html` | redirects to the matching tab (keeps old links working) |
| `editor.html` | **Almuhallab Code** — in-browser HTML/CSS/JS editor |
| `admin.html` | **Admin console** — customers, operations, finance, settings |
| `404.html` | not-found page that returns visitors to the portal |
| `manifest.webmanifest`, `sw.js`, `icon.svg` | PWA app manifest, offline service worker, ⚓ icon |
| `SECURITY.md` | security measures and their limits |

## Nokha1 — the portal (`/nokha1`)

Arabic-first (RTL) and presented as **one system**:

- **Registration & login** — PBKDF2-hashed passwords (Web Crypto), login
  throttling, 24-hour sessions (see `SECURITY.md`)
- **Dashboard** with stats and one-click access to every service unit
- **Plans** (بحّار / قبطان / نوخذة) marked *قريباً* — pricing and payment come
  later; every service is unlocked for every registered account in the meantime

## One system, not three

The three service units used to be three separate pages with three separate
data stores and nothing flowing between them — the revenue you typed into XBRL
had no relationship to the orders you had actually delivered. They are now four
tabs of `nizam.html` over **one shared data core**, so the numbers are derived
rather than retyped:

| Source | Feeds |
|--------|-------|
| صافي — portfolio market value | XBRL **non-current assets** |
| التوصيل — delivered orders | XBRL **revenue** |

The **المركز المالي** tab states that linkage on screen and shows the combined
position (portfolio value, portfolio P/L, delivery revenue, orders in progress,
total resources). In the XBRL tab, **⟳ احسب من النظام** pulls both figures in and
marks the fields as derived; editing a field clears the marker, so the
derivation is a starting point and never a cage.

Storage keys are unchanged (`nokhatha-safi-v1`, `nokhatha-delivery-orders-v1`,
`nokhatha-delivery-couriers-v1`, `nokhatha-xbrl-reports-v1`), so existing data
and the admin console keep working.

## The service units

- **صافي — SAFI**: add holdings (ticker, quantity, average cost and current
  price in fils), see market value and profit/loss per stock and for the whole
  portfolio in KWD, export the statement as CSV or print it.
- **XBRL**: enter entity info and balance-sheet/income-statement figures in
  KWD, validate that assets = liabilities + equity, then generate and download
  an IFRS-tagged XBRL instance document (with preview).
- **التوصيل — Delivery**: create orders with auto IDs (`ORD-0001`), advance
  them through جديد → قيد التحضير → في الطريق → تم التسليم (or cancel),
  manage couriers, filter by status, and track delivered revenue.
- **Almuhallab Code**: three-pane editor with line numbers, sandboxed live
  preview, autosave, copy/download, Tab-indent, and Ctrl/Cmd+S to run.

## Admin console

`admin.html` is the operator view, behind its own PBKDF2 passphrase (separate
from customer accounts, 30-minute sessions, 5-try lockout):

- **Overview** — six KPIs and four charts: signups over eight weeks, plan
  distribution, the order pipeline, and portfolio profit/loss
- **Customers** — search, filter by plan or status, sort any column, change a
  plan, suspend or activate, delete, and bulk actions. A suspended account is
  refused at the portal login, so the action has real effect
- **Operations** — every order with filters, plus per-courier performance
- **Finance** — portfolio aggregate with charts, and the XBRL filing history
- **Settings** — plan/revenue table, full JSON backup export and import, a
  guarded wipe, passphrase change, and an audit log of every admin action

Charts are inline SVG with a hover layer — no chart library, so the strict CSP
holds. Colour follows the encoding: ordinal ramps where order carries meaning
(plan tiers, pipeline stages) and a diverging pair for profit/loss, where the
sign is shown by bar direction and a signed label as well as hue.

## Install as an app

The site is a full PWA: an app manifest, an ⚓ icon, home-screen shortcuts
straight to صافي / XBRL / التوصيل, and a service worker that precaches every
page so the whole system **works with no internet**. Pages load instantly from
cache and refresh silently in the background. An **⬇ تثبيت التطبيق** button
appears in the header when the browser offers installation, and a banner shows
when you go offline.

On a phone: open the site → **Add to Home Screen**.

## Run it locally

Service workers require HTTP(S), so serve the folder:

```bash
npx serve almuhallab
```

Opening files directly (`file://`) works for everything except offline install.

## Publish it live

`.github/workflows/pages.yml` deploys this folder to **GitHub Pages** on every
push to `main`. Enable it once in the repo: **Settings → Pages → Source:
"GitHub Actions"**. The site then serves at
`https://<owner>.github.io/<repo>/`. Any other static host (Netlify,
Cloudflare Pages, or your own server) works the same way — just serve this
folder.

## Typography

Arabic is set in **IBM Plex Sans Arabic** (SIL OFL), bundled in `fonts/` rather
than fetched from a CDN — the strict CSP forbids external origins, and a
self-hosted face renders identically everywhere instead of depending on what the
visitor's OS happens to have installed.

- Arabic subset only, three weights (400/600/700) — 136 KB total. Latin and
  digits stay on the system face, which is well-drawn on every platform and
  keeps numerals native.
- `font-display: swap`, the 400 weight preloaded, and all three precached by the
  service worker so the face is present offline.
- The CSP carries `font-src 'self'`; without it the browser silently refuses to
  paint a self-hosted font.

## Tests

```bash
python3 design/test_suite.py     # 116 checks, exits non-zero on failure
```

Covers the company/product split (the root is the company site and carries no
account UI), token consistency and contrast in both themes, SAFI/XBRL/delivery
arithmetic against hand-computed expectations, the cross-module derivation
(portfolio value → non-current assets, delivered orders → revenue), XBRL well-formedness and fact
values, authentication (hashing, lockout, suspension, session expiry), XSS and
CSV/XML injection, resilience to tampered `localStorage`, service-worker
precaching and genuine offline loading, and layout overflow at three widths.

## HTTP/3

HTTP/3 (QUIC over UDP/443) is negotiated by the **server** — the pages
themselves are protocol-agnostic and need no change to be served over it. What
this repo provides:

- `.htaccess` sets `Alt-Svc: h3=":443"` so clients that arrive over HTTP/1.1 or
  HTTP/2 learn the origin is also reachable over HTTP/3. **Only keep it if the
  host really speaks h3** — advertising it otherwise makes browsers wait on a
  QUIC handshake that has to time out first.
- `design/check-http3.sh` reports what your domain actually negotiates, whether
  h3 is advertised, and whether UDP/443 is reachable at all. Run it from your
  own machine: `bash design/check-http3.sh`
- `design/http3/Caddyfile` and `design/http3/nginx-http3.conf` are complete
  server configs for a machine you control.

Turning it on, easiest first:

| Host | How |
|------|-----|
| **Cloudflare** (free, in front of any host) | Speed → Optimization → enable HTTP/3 (with QUIC) |
| **Hostinger** (LiteSpeed) | hPanel → Advanced → enable QUIC / HTTP/3 |
| **Own server** | use the Caddy or nginx config in `design/http3/` |
| **GitHub Pages** | not available — Pages terminates at HTTP/2 |

The site already meets HTTP/3's prerequisites: HTTPS is forced, HSTS is set, and
the service worker precaches every page, so after the first visit the transport
matters little anyway.

## ⚠️ Status — what's real and what isn't

Everything above works today, entirely in the browser. Accounts, portfolios,
reports, and orders are stored in each visitor's own browser — there is **no
shared database and no payment yet**. Production needs a backend:

1. **Payment gateway** (Kuwait-friendly): [MyFatoorah](https://myfatoorah.com),
   [Tap Payments](https://tap.company), or Stripe — recurring-subscription
   APIs plus webhooks to activate/deactivate plans.
2. **Auth + database**: e.g. Supabase (email auth + Postgres) or Firebase.
   Replace the `localStorage` calls with API calls; hash passwords
   server-side (bcrypt/argon2) in addition to the client-side PBKDF2.
3. **Service backends**: live market prices for SAFI, an XBRL filing channel,
   and shared multi-branch order data for Delivery — all behind a server that
   checks each customer's plan.

The plan/unit gating logic (`UNITS`, `PLANS`, `minPlan`) in `index.html` is the
single source of truth to port to that backend.
