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
   React (Vite) app. Deploy by uploading the built `dist/` (and PHP endpoints)
   over SFTP — see `sporta-web/dropin/scripts/`.

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

- **Frontend:** React 18 + TypeScript + Vite + Tailwind + shadcn/ui, react-router v7.
- **Backend:** Supabase (Postgres, Auth, Edge Functions).
- **Payments:** CBK Hosted KNET & T-Pay (REST-JSON + NVP), native PHP on Hostinger
  under `public_html/pay/`. Implementation in `sporta-web/dropin/php-cbk/`.
  CBK issues `ENCRP_KEY` + `AccessToken` — no client-side AES encryption.
- **Admin quick-unlock:** device passcode feature in `sporta-web/dropin/` (TS/shadcn
  drop-ins) backed by Supabase RPCs set_/verify_/has_device_passcode.
- **Language:** site is bilingual Arabic/English (RTL/LTR).

## Working notes

- Claude's environment cannot reach the user's FTP/SFTP or databases directly;
  the user runs deploys / SQL on their side, or via files Claude provides.
- Keep the indigo accent for admin UI.
