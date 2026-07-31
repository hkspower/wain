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

3. **Keep replies brief.** Short answers, minimal preamble, no long recaps of
   what was just done. Lead with the result; give detail only when asked or
   when something genuinely needs a warning. Code comments stay thorough —
   this is about chat replies, not the codebase.

4. **Deployment target: Hostinger** (`www.sporta.com.kw`), a PHP host serving a
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
- **Backend: TWO, switchable at runtime** (saved by user request — apply
  always). `config.js` `backend: 'php'` selects the **native backend**: MySQL
  on the same Hostinger plan + PHP at `/api` (source
  `sporta-web/dropin/php-store/`, docs `sporta-web/NATIVE-BACKEND.md`); any
  other value = **Supabase** (Postgres, Auth, Edge Functions), unchanged. Both
  enforce the SAME contract — identical validation tokens and response shapes —
  proven by `npm run test:native` (36 checks) and `test:native-e2e` (14 browser
  checks). `api/config.php` lives ONLY on the server, same rule as
  `knet/config.php`. Any change to one backend's contract must be mirrored in
  the other and covered in native-backend-test.mjs.
- **Payments — two products from the SAME bank (CBK), two separate setups**
  (saved by user request — apply always):

  | | **KNET** | **T-Pay** |
  |---|---|---|
  | What it is | payment page at checkout — the customer pays with a **Kuwaiti debit card** | an **online payment link** |
  | Ships to | `public_html/knet/` | `public_html/pay/` |
  | Source | `sporta-web/dropin/php-knet/` | `sporta-web/dropin/php-cbk/` |
  | Credentials | Tranportal ID + password + 16-byte resource key (AES `trandata`) | `ClientId` + `ClientSecret` + `ENCRP_KEY` (CBK issues `AccessToken`; **no client-side AES**) |
  | Config file | `knet/config.php` | `pay/config.php` |

  **Both dropins need an orders database configured or they refuse every
  payment** — `'store' => 'mysql'` on the native backend, `supabase_*`
  otherwise. Every secret the money path needs, and what breaks without each,
  is mapped in `sporta-web/CHECKOUT-SECRETS.md`.

  Same bank, different activation, different credentials, different endpoints.
  **Neither set of credentials works for the other**, and T-Pay cannot be served
  through `/knet`. On the native backend `knet/config.php` MUST carry the
  `'store' => 'mysql'` block or the card path is dead (400 Invalid amount) —
  `npm run test:knet` (39 checks, real MariaDB + a fake gateway speaking the
  real Tranportal protocol) is what keeps it alive. Both are selectable at checkout; `orders.payment_method` records
  which was used (`knet` / `tpay` / `cod`).

  CBK's manual describes the T-Pay selector as `tij_MerchPayType = 2`; the owner
  describes the product as an online payment link. Customer-facing copy therefore
  says "pay online with T-Pay" and does NOT promise a QR code — see the note in
  `src/i18n/translations.js`.
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
- **After any deploy:** run `./scan-server-response.sh` (HTTPS, single-hop
  redirects, security headers, cookies, cache tiers, real 404s, directory
  listings, exposed files). Before a deploy, `npm run audit:storage` asks the
  same questions of `dist/` against a real Apache with the production
  `.htaccess`.
- **`SERVER-LAYOUT.md` is the storage map** (saved by user request — apply
  always): what belongs in `public_html`, what must stay ABOVE it, the cache
  tier per folder, and permissions. Two things live above the web root because
  they are credentials, not configuration: `knet-payments.log` and
  `.cbk_token.json` (a CBK bearer token — its old default was inside
  `public_html/pay/`). Files are `644`, folders `755`; `npm run publish` applies
  them over FTPS. Never `777`.
- **A `<FilesMatch>` in `public/.htaccess` is inherited by subdirectories; a
  `RewriteRule` is NOT** — measured under Apache: a dotfile in a folder whose
  own `.htaccess` says `RewriteEngine On` was served 200 while the same file at
  the root was 403. Deny by NAME for anything that must hold everywhere.
- **Supabase Storage is arranged but unused** — one `product-images` bucket,
  public read, writes gated on `is_admin()`, 5 MB cap, no SVG. See
  `supabase/storage-migration.sql`; it is a no-op if Storage is not provisioned.
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
  `npm run publish:dry` shows what would change without writing, and
  `npm run ftp:doctor` finds the right FTP host (DNS → TCP → TLS → LOGIN → DIR,
  so the failing stage names the fix). **Never guess the FTP host** —
  `ftp.sporta.com.kw` has no DNS record; shipping it as a default cost a round
  trip. `publish` builds with the `VITE_` variables emptied, so nothing from a
  local `.env` is baked in and the output matches the audited zip; it sends
  `index.html` last so a half-finished run is not a white screen; it does not
  re-upload `go-live.html`/`selftest.php`/`setup-config.php` (the owner is told
  to delete those) unless `--setup-tools` is passed; and it reports leftover
  files from the old site, since it never deletes anything.
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

- **Every order emails the logistics company** — see `sporta-web/FULFILMENT.md`.
  A deferred constraint trigger writes `fulfilment_outbox` in the same
  transaction as the order (so a message cannot go missing), and the
  `notify-warehouse` Edge Function drains it. Fires **on INSERT**, i.e. BEFORE
  payment — the owner chose that knowing it, so every message states the payment
  state in its subject and a follow-up says ship / do not ship. Needs
  `WAREHOUSE_EMAIL` set, and needs SPF/DKIM/DMARC from `DNS-EMAIL-RECORDS.txt`
  or the mail silently goes to spam.

- **ElevenLabs MCP** — `.mcp.json` at the repo root, pinned to
  `elevenlabs-mcp==0.11.0` and run through `uvx`. 27 tools: text-to-speech,
  voice cloning, sound effects, agents, outbound calls.

  Two things it needs, and it is silent about neither:

  1. **`ELEVENLABS_API_KEY` in the environment.** `.mcp.json` reads
     `${ELEVENLABS_API_KEY}` and the key itself is **never** in the file —
     `.mcp.json` is committed, and a key in a committed file is a key on
     GitHub. Set it in the Claude Code environment settings.
  2. **`api.elevenlabs.io` on the network allowlist.** Without it the server
     starts, answers the MCP handshake, lists all 27 tools, and then fails
     every single call at CONNECT — which reads like a broken integration
     rather than a firewall. Measured: the sandbox proxy answers 403 to
     CONNECT for anything outside the package registries.

  This is the SELF-HOSTED server, not the claude.ai ElevenLabs connector. The
  connector is a separate thing, authenticates by OAuth, has nowhere to put an
  API key, and is enabled per chat in the connector menu — none of which can be
  done from inside a session.

  `make_outbound_call` places real telephone calls and `voice_clone` spends
  credits. Both are one tool call away once this is on.

  To bump: change the pin in `.mcp.json`, nothing else.
