# KNET direct payments in your Lovable / Supabase app (no OpenCart)

Two Supabase Edge Functions handle KNET (KPC) directly:

- `knet-initiate` — builds the encrypted KNET request, returns the redirect URL.
- `knet-response` — receives KNET's encrypted callback, verifies, marks the
  order paid, redirects the customer to your result page.

The Terminal Resource Key stays server-side only (function secret) — never in
the browser.

## 1. Set the function secrets (production values from KNET Co)

```bash
supabase secrets set \
  KNET_TRANPORTAL_ID=your_live_id \
  KNET_TRANPORTAL_PASSWORD=your_live_password \
  KNET_RESOURCE_KEY=your_terminal_resource_key \
  KNET_GATEWAY_URL=https://kpay.com.kw/kpg/PaymentHTTP.htm \
  KNET_RESPONSE_URL=https://YOUR-PROJECT.functions.supabase.co/knet-response \
  KNET_ERROR_URL=https://YOUR-PROJECT.functions.supabase.co/knet-response \
  PUBLIC_RETURN_URL=https://www.sporta.com.kw/payment/result
```
(`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected automatically.)

## 2. Deploy

```bash
supabase functions deploy knet-initiate
supabase functions deploy knet-response --no-verify-jwt   # KNET calls it without a JWT
```

## 3. Register the response URL with KNET Co

Give KNET Co your **production** `KNET_RESPONSE_URL` so their gateway is allowed
to post the result back. Live payments won't confirm until this is registered.

## 4. Order table

`knet-response` updates a row in `orders` matched by `track_id`. Adjust the
table/column names to your schema, or add columns: `payment_status`,
`knet_result`, `knet_paymentid`, `knet_tranid`, `knet_ref`, `knet_auth`,
`paid_at`. Create the order (with a unique `track_id`) BEFORE calling initiate.

## 5. Checkout flow (frontend)

```ts
const res = await fetch(`${SUPABASE_URL}/functions/v1/knet-initiate`, {
  method: "POST",
  headers: { "Content-Type": "application/json", apikey: SUPABASE_ANON_KEY },
  body: JSON.stringify({ amount: "12.500", trackid: order.track_id }),
});
const { redirectUrl } = await res.json();
window.location.href = redirectUrl;   // send customer to KNET
```

After payment KNET redirects to `PUBLIC_RETURN_URL?status=success|failed&trackid=...`.
Build a small `/payment/result` page that reads `status` and shows the outcome.

## 6. Test live
Do one real 0.100 KWD order with a real KNET card; confirm money settles and the
order flips to `paid`.

---

## Paste this into Lovable to wire the frontend

> Add KNET checkout using our Supabase Edge Functions `knet-initiate` and
> `knet-response` (already handle encryption/callback). On checkout: create an
> order row with a unique `track_id`, then POST `{ amount, trackid }` to
> `knet-initiate` and redirect the browser to the returned `redirectUrl`. Add a
> `/payment/result` page that reads `status`, `trackid`, `ref` from the query
> string and shows success or failure, loading the order to confirm
> `payment_status`. Do NOT put any KNET key in the frontend. Keep the indigo
> accent.
