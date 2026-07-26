# Project instructions for Claude — Sporta

## Standing preferences (saved by user request — apply for all time)

1. **Claude does the full coding — not Lovable.**
   Write complete, production-ready code directly in this repo. Do NOT delegate
   implementation to Lovable's AI or hand off "paste this into Lovable" prompts
   as the deliverable. Deliver actual files that build and run.

2. **No GitHub-based workflow is required of the user.**
   The user prefers to avoid GitHub for their own deploys. Payments and site
   updates go out via direct deploy to Hostinger, not via GitHub Actions/Lovable
   auto-deploy. (Claude still commits/pushes to its working branch as a backup.)

3. **Deployment target: Hostinger** (`www.sporta.com.kw`), a PHP host serving a
   React (Vite) app. The owner works in **hPanel**, and **SSH is off for good**.
   Publish with **`npm run publish`** (FTPS — see Working notes), or drop
   `SPORTA-GO-LIVE.zip` into hPanel File Manager. Not SFTP.

## Brand identity (saved by user request — apply always)

- **Official logo:** orange "S" swoosh + "SPORTA / SPORTS WEAR" wordmark.
  Files: `sporta-web/public/logo.png` (black text, light backgrounds),
  `logo-white.png` (white text, dark backgrounds), `favicon.png` (the S mark).
- **Color theme: ORANGE + BLACK — two-tone orange system (matches
  www.sporta.com.kw):** UI surfaces/buttons use burnt orange **#E0561C**
  (hover #B8430F) as on the live site; the logo's bright orange **#FF7B17**
  is `brand.bright` for the mark, gradients and accents. Charcoal black
  #171A1E, warm beige #E2DBCE canvas. Buttons: near-black text on orange
  (white on these oranges fails WCAG AA at button sizes).
- Voice: premium sportswear, Arabic-first bilingual (سبورتا).

## Project facts

- **Toolchain:** Node **24 LTS (Krypton)** — pinned in `sporta-web/.nvmrc`
  and `engines` (>=22.12). Vite 8 will not run on older Node.
- **Frontend:** React 18 + TypeScript + Vite + Tailwind + shadcn/ui, react-router v7.
- **Backend:** Supabase (Postgres, Auth, Edge Functions).
- **Payments:** CBK Hosted KNET & T-Pay (REST-JSON + NVP), native PHP on Hostinger
  under `public_html/pay/`. Implementation in `sporta-web/dropin/php-cbk/`.
  CBK issues `ENCRP_KEY` + `AccessToken` — no client-side AES encryption.
- **Admin quick-unlock:** device passcode feature in `sporta-web/dropin/` (TS/shadcn
  drop-ins) backed by Supabase RPCs set_/verify_/has_device_passcode.
- **Language:** site is bilingual Arabic/English (RTL/LTR).
- **Configuration:** the site reads Supabase settings at runtime from
  `public/config.js` (`window.SPORTA_CONFIG`), falling back to build-time
  `VITE_*` in `.env`. That is what lets the store be configured by editing a
  file in Hostinger File Manager, with no Node and no rebuild — the user's
  server account has no shell (`/sbin/nologin`). `config.js` is in the deploy
  keep-list, so a deploy never overwrites the live values.
- **Packaging:** `node sporta-web/scripts/make-package.mjs` (or `npm run
  package`) regenerates `SPORTA-GO-LIVE.zip`. Never hand-assemble it — the
  previous hand-made zip went stale and carried the payment-losing callback bug
  for weeks. It now runs `scripts/file-audit.mjs` over the staged tree and
  **refuses to write the zip** if anything fails, so the artifact cannot ship
  with a case-mismatched asset reference, a BOM before `<?php`, a stray
  `config.php`/`.env`, or a missing required file.
- **Brand masters live in `/brand/`, never in `sporta-web/public/`.** Anything
  in `public/` ships. `logo-original.png` sat there unreferenced for weeks and
  was 522 kB — a third of the entire uploadable package.

## Going live (saved by user request — apply always)

- **The live website is `https://www.sporta.com.kw`** — canonical host is
  **`www`** over **HTTPS**. Every URL the codebases emit (canonical tags,
  hreflang, sitemaps, JSON-LD, `llms.txt`) uses exactly that origin, and both
  `.htaccess` files 301 any other spelling (bare domain, server IP, plain
  HTTP) to it in a **single hop**. Never introduce a second spelling.
- **What goes live:** `sporta-web` (React/Vite). Its `dist/` is the site root
  (`/public_html`), and `npm run release` also bundles the KNET PHP endpoints
  into `dist/knet/`. `sporta-html5` is a no-build fallback, not the live site.
- **Two publish routes**, both documented in `GO-LIVE.md`:
  1. `cd sporta-web && npm run publish` — SEO regen → build → file audit →
     **FTPS** upload → byte-for-byte verify. Works with SSH off, which is the
     permanent state. Config in `deploy.config.json`; credentials in
     `.env.deploy` (git-ignored, never commit).
  2. `SPORTA-GO-LIVE.zip` — drag `public_html/` into Hostinger File Manager.
  (`npm run deploy` is the old SFTP route. It needs SSH and will not run.)
- **`.htaccess` is hidden** — it is the single most common thing to miss on a
  manual upload. Without it: no HTTPS redirect, no security headers, and deep
  routes like `/shop` 404. Always call this out when telling the user to
  upload.
- **`knet/config.php` lives ONLY on the server** (real Tranportal
  credentials). It is never committed, never in the zip, never uploaded, and
  is protected from deletion by `upload.keep` + the mirror keep-list. Deploy
  `mirror` stays **false** unless there is a reason to change it.
- **After any deploy:** run `./scan-server-response.sh` (checks HTTPS,
  single-hop redirects, security headers, caching, real 404s, exposed files).
- Outstanding before/after launch: real product photos (biggest gap), and the
  SPF/DKIM/DMARC records in `DNS-EMAIL-RECORDS.txt`.

## Working notes

- **The owner works in Hostinger hPanel, and SSH is disabled — permanently,
  by choice** (after 24 brute-force attempts were logged against it, and the
  account's shell was `/sbin/nologin` anyway, so it bought nothing). Treat SSH
  as unavailable. **Never propose an SSH- or SFTP-based step** — that includes
  `npm run deploy`, which rides on SSH — unless the owner explicitly says they
  have re-enabled it.

- **The standing bridge is FTPS: `npm run publish`** (`scripts/publish-ftps.mjs`).
  FTP is a separate Hostinger service from SSH, so it keeps working with SSH
  off. Credentials come from hPanel → Files → FTP Accounts and live in
  `sporta-web/.env.deploy` (git-ignored): `FTP_HOST`, `FTP_USER`,
  `FTP_PASSWORD`. It builds, runs `file-audit.mjs` and refuses to upload if the
  audit fails, uploads over explicit TLS, then re-downloads `.htaccess`,
  `knet/.htaccess` and `index.html` and compares them byte for byte.
  `npm run publish:dry` shows what would change without writing.
  `config.js` and `knet/config.php` are in a hard-coded never-touch list — not
  configuration — so a publish can never overwrite the live Supabase or
  Tranportal credentials. Verified against a real FTPS server, including that
  both files survive untouched and that a wrong password or a failing audit
  stops the run before anything is written.

- **Never build a PHP deploy endpoint.** The live server had one —
  `sporta-deploy.php` in the web root, answering to anyone on the internet.
  That is a way in, not a bridge. FTPS adds no attack surface: Hostinger
  already runs and authenticates it, and the credentials are revocable in
  hPanel.

- hPanel **File Manager + `SPORTA-GO-LIVE.zip`** remains the no-tools fallback
  for when the owner is not at a machine with the repo and Node.

- Claude's environment cannot reach the user's FTP/SFTP, the live site, or
  databases — SSH `46.202.158.211:65002` and `https://www.sporta.com.kw` are
  both blocked by the sandbox egress policy. Claude therefore **cannot deploy
  or fetch the live site**; it ships verified artifacts and the user uploads.
  Say this plainly rather than implying a deploy happened.
- Adding a route to `sporta-web/src/App.jsx` also requires adding it to the
  known-route list in `sporta-web/public/.htaccess`, or it will 404 in
  production.
- Keep the indigo accent for admin UI.
