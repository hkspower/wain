# Nokha1 — النوخذة

The Almuhallab unified services website: an **HTML5 Progressive Web App**
with no build step and no dependencies. Open it in a browser, or install it
to a phone's home screen and run it offline.

## Site map

| File | Page |
|------|------|
| `index.html` | **Nokha1 portal** — landing, registration, login, dashboard, plans |
| `safi.html` | **صافي (SAFI)** — portfolio manager with P/L and CSV export |
| `xbrl.html` | **XBRL** — financial statement builder + XBRL file generator |
| `delivery.html` | **التوصيل** — delivery orders, couriers, status pipeline |
| `editor.html` | **Almuhallab Code** — in-browser HTML/CSS/JS editor |
| `nokha1.html` | redirect to `index.html` (keeps old links working) |
| `404.html` | not-found page that returns visitors to the portal |
| `manifest.webmanifest`, `sw.js`, `icon.svg` | PWA app manifest, offline service worker, ⚓ icon |
| `SECURITY.md` | security measures and their limits |

## The portal

Arabic-first (RTL) and presented as **one system**:

- **Registration & login** — PBKDF2-hashed passwords (Web Crypto), login
  throttling, 24-hour sessions (see `SECURITY.md`)
- **Dashboard** with stats and one-click access to every service unit
- **Plans** (بحّار / قبطان / نوخذة) marked *قريباً* — pricing and payment come
  later; every service is unlocked for every registered account in the meantime

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

The plan/unit gating logic (`MCPS`, `PLANS`, `minPlan`) in `index.html` is the
single source of truth to port to that backend.
