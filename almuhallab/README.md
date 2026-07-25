# Almuhallab — Nokha1 (النوخذة)

A suite of static pages — no build step, no dependencies. **Nokha1** is the
short brand name of the النوخذة unified services system.

| Page | What it is |
|------|-----------|
| `nokha1.html` | **Nokha1 portal** — registration, login, dashboard, plans |
| `safi.html` | **صافي (SAFI)** — portfolio manager with P/L and CSV export |
| `xbrl.html` | **XBRL** — financial statement builder + XBRL file generator |
| `delivery.html` | **التوصيل** — delivery orders, couriers, status pipeline |
| `index.html` | **Almuhallab Code** — in-browser HTML/CSS/JS editor |
| `SECURITY.md` | Security measures and their limits |

## Nokha1 — the unified services portal

Arabic-first (RTL) portal presenting all services as **one system**:

- **Customer registration & login** — PBKDF2-hashed passwords (Web Crypto),
  login throttling, 24-hour sessions (see `SECURITY.md`)
- **Dashboard** with stats and one-click access to every service unit
- **Monthly subscription plans** in KWD (بحّار / قبطان / نوخذة) — currently
  marked *coming soon*: all units are unlocked for every registered account
  until pricing and payments are switched on

## The service units

- **صافي — SAFI** (`safi.html`): add holdings (ticker, quantity, avg cost and
  current price in fils), get market value and profit/loss per stock and for
  the whole portfolio in KWD, export the statement as CSV or print it.
- **XBRL** (`xbrl.html`): enter entity info and balance-sheet/income-statement
  figures in KWD, validate that assets = liabilities + equity, then generate
  and download an IFRS-tagged XBRL instance document (with preview).
- **التوصيل — Delivery** (`delivery.html`): create orders with auto IDs
  (`ORD-0001`), advance them through جديد → قيد التحضير → في الطريق →
  تم التسليم (or cancel), manage couriers, filter by status, and track
  delivered revenue.
- **Almuhallab Code** (`index.html`): three-pane editor (HTML/CSS/JS) with
  line numbers, sandboxed live preview, autosave, copy/download, Tab-indent,
  and Ctrl/Cmd+S to run.

## HTML5 app (PWA) — installable & offline

Nokha1 is a full **HTML5 Progressive Web App**:

- `manifest.webmanifest` — app name, ⚓ icon (`icon.svg`), RTL/Arabic,
  standalone display, and home-screen shortcuts to صافي / XBRL / التوصيل
- `sw.js` — service worker that precaches all pages and serves them
  **offline** (stale-while-revalidate: instant load, silent background update)
- Every page registers the service worker and carries theme-color and
  Apple touch-icon metadata

On a phone, open the site and choose **Add to Home Screen** — it installs
and runs like a native app, works with no internet, and keeps all data
on the device.

## Run it

Service workers need HTTP(S), so serve the folder (any static host works —
GitHub Pages, Netlify, Cloudflare Pages, or your own server):

```bash
npx serve almuhallab
```

Opening files directly (`file://`) still works for everything except the
offline install.

## ⚠️ Prototype status — what's real and what isn't

Everything above works today, entirely in the browser. Accounts, sessions,
portfolios, reports, and orders are stored in each visitor's own
`localStorage` — there is **no shared database and no real payment yet**.
Going to production needs a backend:

1. **Payment gateway** (Kuwait-friendly): [MyFatoorah](https://myfatoorah.com),
   [Tap Payments](https://tap.company), or Stripe — recurring-subscription
   APIs plus webhooks to activate/deactivate plans.
2. **Auth + database**: e.g. Supabase (email auth + Postgres) or Firebase.
   Replace the `localStorage` calls with API calls; hash passwords
   server-side (bcrypt/argon2) in addition to the client-side PBKDF2.
3. **Service backends**: live market prices for SAFI, an XBRL filing channel,
   and shared multi-branch order data with courier apps for Delivery — all
   behind a server that checks each customer's active plan.

The plan/unit gating logic (`MCPS`, `PLANS`, `minPlan`) in `nokha1.html` is
the single source of truth to port to that backend.
