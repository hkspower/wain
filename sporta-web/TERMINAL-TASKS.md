# Terminal runbook — do all paused Sporta tasks

Hand this to Claude Code running in your terminal (`claude` inside the project).
Say: **"Read TERMINAL-TASKS.md, CLAUDE.md and HANDOFF.md, then do the tasks in
order, stopping to ask me only for the values marked ⚠️."**

Work top to bottom. Build after each code change.

---

## 0. Sanity
```bash
cd sporta-web
npm install
npm run build      # must pass before continuing
npm run dev        # click through: shop → cart → checkout → result
```

## 1. Environment (⚠️ needs your values)
Create `sporta-web/.env`:
```
VITE_SUPABASE_URL=⚠️ your project url
VITE_SUPABASE_ANON_KEY=⚠️ your anon key
VITE_PAY_BASE_URL=https://www.sporta.com.kw/pay
```

## 2. Database — server-side pricing + RLS
Run `sporta-web/supabase/schema.sql` in the Supabase SQL editor (or
`supabase db push`). It creates products/orders/order_items, the price triggers,
RLS, and `get_order_status`. Then confirm the admin passcode RPCs exist by also
running `sporta-web/supabase/has_device_passcode.sql`.

## 3. Real products (⚠️ your catalog)
Insert real rows into `products` (slug, name_en, name_ar, price, category, image,
active). Either SQL inserts, or the admin once product-management is built. Remove
the placeholder list in `src/lib/products.js` once Supabase is the source (the
loader already prefers Supabase and falls back to static).

## 4. KNET payment endpoints (⚠️ Tranportal values)
You have Tranportal credentials → use the classic KNET (KPG) module.
- Upload `sporta-web/dropin/php-knet/` to `public_html/knet/` on Hostinger.
- `cp config.example.php config.php`; fill `tranportal_id`, `tranportal_password`,
  `resource_key`, and the Supabase url + service key. Keep `env: 'test'`
  (uses kpaytest.com.kw) first.
- Register `…/knet/callback.php` with your bank as the response/error URL.
- Set `VITE_PAY_BASE_URL=https://www.sporta.com.kw/knet` in `.env`.
- (The `php-cbk/` REST-JSON module does NOT apply to you — ignore or delete it.)

## 5. Deploy to Hostinger
```bash
mkdir -p scripts && cp dropin/scripts/deploy.mjs scripts/deploy.mjs
cp dropin/scripts/.env.deploy.example .env.deploy   # ⚠️ set HOSTINGER_SSH_PASSWORD
npm run build && node scripts/deploy.mjs
```
Back up `public_html` first. Verify https://www.sporta.com.kw and run a 0.100 KWD
KNET test → order should flip to `paid`.

## 6. Integrate admin quick-unlock into the REAL admin
Copy the drop-ins into the real project's `src/` (see `dropin/README.md`):
`lib/deviceId.ts`, `lib/quickUnlock.ts`, `hooks/useIdleLock.ts`,
`components/quick-unlock/*`. Wrap the authed admin in `<QuickUnlockGate>`, add
`<SetupQuickUnlock/>` to Settings, add the `shake` keyframe. Fix the Supabase
import path if it isn't `@/integrations/supabase/client`.

## 7. Accessibility — white-text-on-orange (real project only)
This scaffold has none, but the real project does. Run:
```bash
grep -rnE "text-white[^\"']*bg-primary|bg-primary[^\"']*text-white" src
```
For each hit: change `text-white` → `text-primary-foreground`. For orange
text/links (`text-primary` used as text on light, or hard-coded orange), switch
to the `.link-accent` / `.price` classes or `color: hsl(var(--accent-text))`.
Wire the CSS: import `theme.css`, `admin.css`, `admin-mobile.css` after the
Tailwind layers in `index.css`, and delete duplicate `:root`/`.admin-shell`
token blocks so `theme.css` is the single source of truth.

## 7b. Import stranded Lovable asset stubs (real repo only)
The Lovable repo may commit `src/assets/**/*.asset.json` placeholders instead of
the real binaries. Import them all:
```bash
LOVABLE_PREVIEW_URL=https://id-preview--c5bf1be6-60af-4efe-96ec-ae6da15af2eb.lovable.app \
  node scripts/import-lovable-assets.mjs   # from dropin/scripts/
```
It downloads each `url`, verifies size/type, deletes the stub, and fixes any
import that referenced `.asset.json`. Then:
```bash
npm run build
grep -r "__l5e" dist/ && echo "STILL HAS STUBS" || echo "clean"
# .env must contain ONLY public VITE_ values:
grep -v '^VITE_' .env | grep -v '^#' | grep '=' && echo "NON-VITE SECRET IN .env!" || echo ".env clean"
```
Deploy + prove live:
```bash
HOSTINGER_FTP_REMOTE_DIR='/domains/sporta.com.kw/public_html' npm run deploy -- --force --verify=hash
curl -s -o /dev/null -w '%{http_code} %{content_type}\n' \
  "https://www.sporta.com.kw/assets/$(ls dist/assets | grep hero-flame | head -1)"
# expect: 200 image/png
```

## 8. Final checks
- `npm run build` passes; click through storefront + admin on mobile width.
- SSL Labs grade A; cert covers apex + www.
- RLS: confirm anon cannot UPDATE orders or read others' orders.
- Rotate any credential pasted into chat/email.
```
git add -A && git commit -m "Terminal: env, DB, products, payments, deploy, a11y" && git push
```
```
```
