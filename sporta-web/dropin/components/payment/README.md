# CBK payment — React/frontend pieces

Drop-in for your Lovable app (TypeScript + shadcn + react-router v7). Pairs with
the PHP endpoints in `dropin/php-cbk/`.

## Files → your `src/`
| From | To |
|---|---|
| `lib/checkout.ts` | `src/lib/checkout.ts` |
| `components/payment/CheckoutButton.tsx` | `src/components/payment/CheckoutButton.tsx` |
| `pages/PaymentResult.tsx` | `src/pages/PaymentResult.tsx` |

## 1. Env var
Point the app at your Hostinger pay folder:
```
VITE_PAY_BASE_URL=https://www.sporta.com.kw/pay
```

## 2. Add the result route
```tsx
import PaymentResult from "@/pages/PaymentResult";
// in your <Routes>:
<Route path="/payment/result" element={<PaymentResult />} />
```
(This must match `result_page_url` in the PHP `config.php`.)

## 3. Trigger checkout
```tsx
import { CheckoutButton } from "@/components/payment/CheckoutButton";
<CheckoutButton amount={12.5} payRef="Order #1024" />
// or programmatically:
import { startCbkCheckout } from "@/lib/checkout";
await startCbkCheckout({ amount: 12.5, ref: "Order #1024" });
```

## 4. Orders table (Supabase)
`checkout.ts` inserts a pending order; `callback.php` updates it. Suggested table:

```sql
create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  track_id text unique not null,
  order_ref text,
  amount text,
  payment_status text not null default 'pending', -- pending | paid | failed
  cbk_status text,
  cbk_message text,
  cbk_paymentid text,
  cbk_transaction text,
  cbk_authcode text,
  cbk_reference text,
  cbk_receipt text,
  cbk_paytype text,
  paid_at timestamptz,
  created_at timestamptz not null default now()
);
```
Adjust column names to your real schema — then tell me and I'll match `callback.php`
and `checkout.ts` exactly.

## Security note
The insert uses the browser (anon) client, so add an RLS policy allowing inserts
of `pending` orders, or move order creation into an Edge Function if you want it
locked down. The authoritative paid/failed update happens server-side from
`callback.php` using the Supabase service key.
