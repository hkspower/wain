# Security audit — Sporta / فحص الثغرات الأمنية

## ملخص (Arabic summary)
تم فحص الكود بالكامل. لا توجد برمجيات خبيثة، لا أسرار مكشوفة، لا ثغرات في
المكتبات (0). أهم ثغرة كانت **تلاعب بمبلغ الدفع** (المبلغ يأتي من المتصفح) —
تم تعزيزها بالتحقق من الإدخال ومطابقة المبلغ المدفوع مع مبلغ الطلب في
`callback.php`. يبقى إجراء واحد مطلوب منك: تفعيل RLS في Supabase وجعل الأسعار
مصدرها الخادم (انظر أدناه).

## What was checked
- Dependencies: `npm audit` → **0 vulnerabilities**.
- Secrets: none committed (only `.example` placeholders + env references).
- XSS: no `dangerouslySetInnerHTML` / `innerHTML` / `document.write`. React
  escapes by default; PHP form output uses `htmlspecialchars`.
- Transport: site + `/pay/` force HTTPS + HSTS; payment endpoints reject
  non-HTTPS (`cbk_require_https`).
- Secrets exposure: CBK keys are server-side only (PHP `config.php`, blocked by
  `.htaccess`). The Supabase service key is only in server code, never the client.

## Findings & fixes

### 🔴 Amount tampering (fixed / hardened)
`pay.php` received the amount from the client, so a user could pay less than the
real price. Fixes applied:
1. **Strict input validation** in `pay.php` — amount must be numeric (≤10 digits,
   ≤3 decimals, > 0); track id must be alphanumeric ≤30. Blocks bad input and
   NVP-parameter injection.
2. **Amount verification** in `callback.php` — after CBK confirms payment, we
   fetch the order's recorded amount from Supabase and compare it to the amount
   CBK actually charged. On mismatch the order is **NOT** marked paid
   (`amount_mismatch`).

### 🟠 Server-side price authority (ACTION REQUIRED — you)
The order's recorded amount still originates from the browser (`checkout.js`
inserts it). Verification above only catches tampering *between* order creation
and payment. For full protection, make the price authoritative on the server:
- Store product prices in a Supabase `products` table (source of truth), and
- Compute the order total server-side — e.g. a Supabase **Edge Function** or a DB
  **trigger** that recomputes `orders.amount` from the line items, so the client
  can never set the price it pays.

### 🟠 Supabase RLS (ACTION REQUIRED — you)
`checkout.js` inserts orders with the browser (anon) key. Add Row Level Security:
- `orders`: allow INSERT of new pending rows only; **deny** clients from UPDATE
  (paid status is set server-side via the service key) and from SELECTing other
  users' orders.
- `products`: SELECT only where `active = true`; no client writes.
- Admin tables / `admin_device_passcodes`: restrict to authenticated admins.

### 🟢 Admin passcode
Device id is 256-bit; enrollment is server-side (`set_device_passcode`);
verification is server-side with attempt limits + lockout (`verify_device_passcode`).
Local enrollment flag is only a UI hint; the server is authoritative.

## Checklist for going live
- [ ] Enable RLS on `orders`, `products`, and admin tables.
- [ ] Make order amount server-authoritative (Edge Function or trigger).
- [ ] Keep CBK keys only in `pay/config.php` (never client-side).
- [ ] Confirm SSL grade A on SSL Labs; cert covers apex + www.
- [ ] Rotate any credential ever pasted into chat/email.
