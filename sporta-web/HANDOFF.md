# Sporta — handoff to Claude Code (terminal)

Read this first. It's the current state and the next tasks. Also read `CLAUDE.md`
(standing rules: Claude does the full coding — not Lovable; deploy direct to
Hostinger; no GitHub workflow required).

## What already exists in this repo (`sporta-web/`)

- **Storefront (bilingual AR/EN, RTL/LTR):** Home, Shop (category filters),
  Product detail, Cart (localStorage), Checkout, Payment result. All routes are
  lazy-loaded. UI text in `src/i18n/translations.js`. Indigo accent for admin.
- **Products:** `src/lib/products.js` — 8 PLACEHOLDER products with inline-SVG
  images. `loadProducts()` tries Supabase `products` table first, falls back to
  the static list.
- **Cart:** `src/lib/cart.jsx` (context). **Checkout:** `src/lib/checkout.js`
  creates a pending `orders` row then redirects to the CBK PHP endpoint.
- **Payments — CBK Hosted KNET & T-Pay (native PHP):** `dropin/php-cbk/`
  (`cbk.php`, `pay.php`, `callback.php`, `config.example.php`, `.htaccess`).
  REST-JSON + NVP per CBK manual v2.93. Deploys to `public_html/pay/`.
- **Admin quick-unlock (device passcode):** `dropin/` TS/shadcn drop-ins +
  `supabase/functions/` and `supabase/has_device_passcode.sql`.
- **Performance:** route splitting, `react-vendor` chunk, Hostinger `.htaccess`
  (Brotli/gzip + immutable caching). See `PERFORMANCE.md`.
- **Deploy:** `dropin/scripts/deploy.mjs` (config-driven, SFTP). Env in `.env.deploy`.

## Next tasks (in order)

1. **Install & sanity check**
   - `npm install` then `npm run dev` — confirm the store loads and the cart works.
2. **Load the real products**
   - Replace the placeholder array in `src/lib/products.js` with real Sporta
     products (name{en,ar}, desc{en,ar}, price in KWD, category, image), OR
     create a Supabase `products` table and let `loadProducts()` read it.
3. **Wire Supabase**
   - Create `.env` from `.env.example` with VITE_SUPABASE_URL + anon key.
   - Create the `orders` table (schema in `dropin/components/payment/README.md`).
   - For admin quick-unlock: run `supabase/has_device_passcode.sql` and confirm
     RPCs set_/verify_/has_device_passcode exist.
4. **CBK payment config**
   - Copy `dropin/php-cbk/` to `public_html/pay/`; make `config.php` from the
     example with CBK's test_base/production_base, client_id, client_secret,
     encrp_key. Register `.../pay/callback.php` with CBK. Keep env=test first.
   - Set `VITE_PAY_BASE_URL=https://www.sporta.com.kw/pay` in `.env`.
5. **Deploy**
   - `cp dropin/scripts/deploy.mjs scripts/deploy.mjs` and make `.env.deploy`
     with the NEW Hostinger SSH password.
   - `npm run build && node scripts/deploy.mjs`
   - Verify https://www.sporta.com.kw loads and a 0.100 KWD KNET test succeeds.

## Important cautions
- Deploy with `mirror` REPLACES `public_html`. Back it up first, and don't wipe
  server-side files that aren't in the build (e.g. `/pay/`). Configure excludes.
- Never commit `.env`, `.env.deploy`, or `config.php`.
- The Hostinger SSH/FTP password was rotated (auto-deploy from Lovable is off).
