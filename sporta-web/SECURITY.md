# Security audit — Sporta / فحص الثغرات الأمنية

## ملخص (Arabic summary)
تم فحص الكود بالكامل. لا توجد برمجيات خبيثة، لا أسرار مكشوفة، لا ثغرات في
المكتبات (0). أهم ثغرة كانت **تلاعب بمبلغ الدفع** (المبلغ يأتي من المتصفح) —
تم تعزيزها بالتحقق من الإدخال ومطابقة المبلغ المدفوع مع مبلغ الطلب في
`callback.php`. والأسعار الآن مصدرها الخادم بالكامل: قاعدة البيانات هي التي
تحسب المبلغ، والمتصفح لا يرسل سعراً إطلاقاً (انظر أدناه).

## What was checked
- Dependencies: `npm audit` → **0 vulnerabilities**.
- Secrets: none committed (only `.example` placeholders + env references).
- XSS: no `dangerouslySetInnerHTML` / `innerHTML` / `document.write`. React
  escapes by default; PHP form output uses `htmlspecialchars`.
- Transport: site + `/pay/` force HTTPS + HSTS; payment endpoints reject
  non-HTTPS (`cbk_require_https`).
- Secrets exposure: CBK keys are server-side only (PHP `config.php`, blocked by
  `.htaccess`). The database password is only in `config.php` on the server —
  the browser has no credential of any kind, because there is nothing for it to
  talk to but our own `/api`.

## Findings & fixes

### 🔴 Amount tampering (fixed / hardened)
`pay.php` received the amount from the client, so a user could pay less than the
real price. Fixes applied:
1. **Strict input validation** in `pay.php` — amount must be numeric (≤10 digits,
   ≤3 decimals, > 0); track id must be alphanumeric ≤30. Blocks bad input and
   NVP-parameter injection.
2. **Amount verification** in `callback.php` — after CBK confirms payment, we
   fetch the order's recorded amount from the database and compare it to the amount
   CBK actually charged. On mismatch the order is **NOT** marked paid
   (`amount_mismatch`).

### 🟢 Server-side price authority (IMPLEMENTED)
Prices are authoritative on the server (`dropin/php-store/schema.mysql.sql`):
- `products.price` is the single source of truth.
- A DB trigger copies each item's price from `products` and recomputes
  `orders.amount` from the line items — the client cannot set the price.
- `checkout.js` inserts the order + line items (no client amount); `pay.php`
  charges the order's server-computed amount (via `cbk_order_amount`), and
  `callback.php` verifies the charged amount again.

**Remaining for you:** import `api/schema.mysql.sql` and `api/seed.mysql.sql`.

### 🟢 Table-level access (RESOLVED BY DESIGN)
This used to require Row Level Security, because the browser held a database
key and talked to the database directly. It no longer does. The browser can
only reach `/api/api.php`, which exposes exactly five read routes plus order
creation, and never a table. Everything privileged — orders, stock with cost
prices, the catalogue editor — is behind `admin.php` and its session:

- `api.php` returns only shop-window columns; the public stock route omits
  `cost_aed` entirely, which the admin route returns.
- Order creation ignores any price the browser sends; the amount is computed
  from `products` by a trigger.
- Reading an order back needs its `track_id`, which only the customer has.

### 🟢 Admin sign-in
Email + password (`password_hash`), a session cookie that is HttpOnly and
SameSite=Strict, plus an `X-Sporta-Admin: 1` header the PHP side requires — the
two together are the CSRF defence. Five wrong passwords lock the account for
15 minutes, counted **in the database**, not the session, so clearing cookies
does not reset it.

## Checklist for going live
- [ ] Keep the database password only in `api/config.php`, `knet/config.php`
      and `pay/config.php` — all three server-side, all three denied by name.
- [ ] Delete `api/setup-admin.php`, `knet/selftest.php`, `knet/setup-config.php`
      and `go-live.html` from the server once setup is done.
- [ ] Keep CBK keys only in `pay/config.php` (never client-side).
- [ ] Confirm SSL grade A on SSL Labs; cert covers apex + www.
- [ ] Rotate any credential ever pasted into chat/email.
- [ ] Run `./scan-server-response.sh` after every deploy, and
      `npm run audit:storage` before one.
