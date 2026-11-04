# Abandoned orders: route contract (backend step 1, for the UI step)

Source: `sporta-web/dropin/php-store/abandoned.php` (new), `abandoned.mysql.sql` (new).
Registered in `admin.php` by the patch (`abandoned-orders-registration.patch`, applied after the release gate).
Proven by `npm run test:abandoned-orders`.

Two routes on the existing admin endpoint, `/api/admin.php`. Both need the admin session cookie
(`sporta_admin`, same as every other admin route) **and** the header `X-Sporta-Admin: 1`.
Responses are JSON with `Cache-Control: no-store`. Errors are always a bare token `{"error":"<token>"}`
(never an echo of what was sent), plus `retry_after` on a 429.

## What "abandoned" means (decided from the code, shown in the UI as the reason chip)

| `reason` | counts as abandoned | meaning |
|---|---|---|
| `unpaid` | yes | card order (KNET or T-Pay), still pending, older than `abandoned_after_minutes` (default 30) and still inside the sweeper's hold: the shopper left the bank page; the garments are still held |
| `expired` | yes | card order, still pending, whose hold (`stock_hold_minutes`, min 15, default 120) has run out: the sweeper has put the stock back (or will within 15 minutes); also a card order cancelled only after its hold ran out |
| `declined` | yes | card order the bank refused, or the shopper backed out at the gateway (`payment_status = failed`) |
| `cod_expired` | yes | cash order nobody confirmed: pending + unfulfilled past `cod_hold_hours` (default 24), or cancelled only after that time |
| `waiting` | **no** | card order inside the threshold: the shopper is probably still paying. Only on request (`reason=waiting`) |
| `cancelled` | **no** | an unpaid order the shop cancelled BEFORE its hold ran out: a person's decision. Only on request (`reason=cancelled`) |

Never listed: paid, `review`, a packed card order, a cash order inside its hold / packed / shipped / delivered / paid,
and a cash order whose status is `failed` (the historic import's wording; 27 such rows on the live database).
Shoppers who never reached order creation are not recorded anywhere (the cart is only in their browser) and cannot be listed.

**Recovered** = a LATER order (higher id) from the same customer that succeeded (paid, or cash the shop has packed / shipped /
delivered): same stored phone (checkout writes `965XXXXXXXX`), or the same signed-in account (orders carry no email column;
`customer_accounts.email` is unique, so one email is one account). A follow-up with state `recovered_manually` counts too.
Recovered rows are hidden by default and always counted in the summary.

## GET `?r=abandoned_orders`

Query (all optional; anything else is ignored; a bad value is `400 {"error":"invalid_filter"}`):

| param | values | default |
|---|---|---|
| `reason` | `all` (= unpaid, expired, declined, cod_expired), `unpaid`, `expired`, `declined`, `cod_expired`, `waiting`, `cancelled` | `all` |
| `from`, `to` | `YYYY-MM-DD`, on `created_at`, `to` inclusive, `from <= to` | none |
| `q` | up to 80 chars, no control characters. Matches track id, customer name, phone (typed with spaces, `+965`, Arabic digits: searched by its digits). `% _` are literal | empty |
| `include_recovered` | `0` / `1` (ignored for `waiting` and `cancelled`) | `0` |
| `page` | 1..500, 20 rows a page | `1` |

Throttle: 90 reads a minute per client, then `429 {"error":"too_many_attempts","retry_after":N}` + `Retry-After`.
Other statuses: 401 `not_signed_in`, 400 `bad_request` (no `X-Sporta-Admin`), 405, 503 `no_table` (migration not applied).

Response (example, abridged to one row; **this is the complete key set, the test fails if it changes**):

```json
{
  "settings": { "abandoned_after_minutes": 30, "hold_minutes": 120, "cod_hold_hours": 24 },
  "filters":  { "reason": "all", "from": null, "to": null, "q": "", "include_recovered": false },
  "summary": {
    "abandoned": { "count": 11, "value": 141.1, "recovered_count": 4, "recovered_value": 28, "recovery_rate": 26.7 },
    "by_reason": {
      "unpaid":      { "count": 4, "value": 84.5, "recovered_count": 3, "recovered_value": 21 },
      "expired":     { "count": 3, "value": 28.6, "recovered_count": 0, "recovered_value": 0 },
      "declined":    { "count": 2, "value": 14,   "recovered_count": 1, "recovered_value": 7 },
      "cod_expired": { "count": 2, "value": 14,   "recovered_count": 0, "recovered_value": 0 }
    },
    "waiting":           { "count": 2, "value": 14 },
    "cancelled_by_shop": { "count": 2, "value": 14 }
  },
  "orders": [
    {
      "id": 17,
      "track_id": "SPAB12CD34",
      "created_at": "2026-11-04 06:21:07",
      "minutes_ago": 45,
      "reason": "unpaid",
      "abandoned": true,
      "payment_method": "knet",
      "payment_status": "pending",
      "fulfilment_status": "unfulfilled",
      "amount": 13,
      "item_count": 2,
      "items": [ { "name_en": "Cloudsoft Top — Navy", "name_ar": "توب كلاودسوفت — كحلي", "qty": 2, "size": "L", "fit": null } ],
      "items_more": 0,
      "customer_name": "سارة الأحمد",
      "customer_phone": "96555501003",
      "whatsapp_phone": "96555501003",
      "customer_governorate": "hawalli",
      "customer_area": "Salmiya",
      "customer_lang": "ar",
      "stock_released": false,
      "discount_released": false,
      "recovered": false,
      "recovered_by": null,
      "followup": null
    }
  ],
  "page": 1,
  "has_more": true
}
```

Field notes for the UI:

* `summary` counts what matches `from`/`to`/`q` (NOT the reason, NOT include_recovered, NOT the page). `count`/`value`
  are what is still lost (not recovered); `recovered_*` is what came back; `recovery_rate` is a percentage with one decimal
  = recovered / (lost + recovered), `null` when there is nothing. `value` and `amount` are KD (3 decimals, JSON numbers).
* `abandoned` on a row is `false` for `waiting` / `cancelled` rows (shown only when asked for).
* `items` holds at most 5 lines; `items_more` is how many were left out; `item_count` is the sum of all quantities.
  A historic order has no lines: `items: []`, `item_count: 0`. Names are the ones the order was SOLD under.
* `whatsapp_phone` is the canonical `965XXXXXXXX` (same function as checkout), or `null` for a historic phone that is not a
  Kuwaiti mobile. Build `https://wa.me/<whatsapp_phone>?text=<encodeURIComponent(message)>` in the browser from it. The server sends nothing.
* `customer_lang` is `"ar"`, `"en"` or `null` (pick the message language from it).
* `followup` is `null` or `{ "state": "contacted|not_interested|wrong_number|recovered_manually", "note": "…", "by": "<admin email>", "at": "YYYY-MM-DD HH:MM:SS" }`.
* `recovered_by` is `"order"` (a later order did it), `"manual"` (the owner marked it) or `null`.
* Customer text (`customer_name`, `customer_area`, `followup.note`, item names) is untrusted: escape it (`textContent`), `dir="auto"`.
* Not in the response, on purpose: address block/street/building/floor/flat, the order note (it can carry the shopper's map pin),
  any bank field (`cbk_*`), attribution, IP, user agent, tokens, hashes.
* CSV export is the browser's job (the visible rows). Prefix a cell that starts with `= + - @` (and tab / CR) with `'`.

## POST `?r=abandoned_followup`

Headers: `X-Sporta-Admin: 1`, `Content-Type: application/json`; a `Sec-Fetch-Site: cross-site` request is refused.

```json
{ "order_id": 17, "state": "contacted", "note": "called, will pay tomorrow" }
```

* `order_id`: positive integer (or its decimal string).
* `state`: `contacted` | `not_interested` | `wrong_number` | `recovered_manually` | `none` (`none` removes the follow-up; removing what is not there is fine).
* `note`: optional, string, at most 280 CHARACTERS (Arabic counts as characters); control characters (newlines, tabs, NUL) become spaces; null = empty.

Success `200`:

```json
{ "followup": { "order_id": 17, "state": "contacted", "note": "called, will pay tomorrow", "by": "owner@sporta.com.kw", "at": "2026-11-04 07:02:11" } }
```

(`{ "followup": null }` after `none`.) One atomic `INSERT … ON DUPLICATE KEY UPDATE` on the primary key: one row per order, ever;
repeating a request leaves the same state (only `at` moves); 16 concurrent writers leave exactly one writer's whole value.
Each successful write is one row in the Activity log (key `abandoned_followup`).

Errors: `400` `invalid_order` | `invalid_state` | `invalid_note` | `note_too_long`; `404 not_found` (no such order);
`409 not_abandoned` (the order is paid, under review, or a live cash order: the list could not show it);
`401`, `400 bad_request` (no `X-Sporta-Admin`), `403 bad_request` (cross-site or not JSON), `405`, `413`,
`429` (30 writes a minute per client), `503 no_table`.

## Settings (config keys, all optional, defaults in code)

| key | default | meaning |
|---|---|---|
| `abandoned_after_minutes` | 30 | a pending card order older than this is abandoned. Clamped to 5 .. the sweeper's hold |
| `stock_hold_minutes` | 120 | existing key; read exactly as `cron-stock.php` reads it (min 15) |
| `cod_hold_hours` | 24 | existing key (`store_cod_hold_hours()`); 0 = the cash rule is off, so no `cod_expired` |

The three values in force are echoed in `settings`.

## Shipping order (live)

1. Apply `abandoned.mysql.sql` to the live database (additive, idempotent; the live DB does not have `abandoned_followup`). Until then both
   routes answer `503 {"error":"no_table"}` and nothing else in `admin.php` is affected (the include is loaded only for these two routes).
2. Deploy `api/` (carries `abandoned.php` and the patched `admin.php`). The UI add-on (`sporta-admin-brands.js` block) follows in step 2.

## Not in this step

No UI, no CSV, no WhatsApp text (browser only, the owner's wording, kept in the browser). Nothing here sends a message.

## Changes made in the independent review (2026-11-04)

* `q` that is not valid UTF-8 (for example `?q=%FF%FE`) is now `400 {"error":"invalid_filter"}`. It used to come back as an EMPTY `200` body
  (json_encode failed on the echoed filter), which the admin page reads as "route absent".
* A whole phone typed with the international prefix as `00965 5570 1003` is now found (its digits never occurred in a stored `965XXXXXXXX`).
  `+965 ...`, 8 digits, spaces/dashes and Arabic-Indic digits were already found.
* UI: bidi override / embedding / isolate characters (U+202A-202E, U+2066-2069) are dropped from every customer text shown or exported;
  a customer name with `$` patterns (`$'`, `$&`) is copied into the WhatsApp text as typed.
* The registration patch now also carries `ops/db/expected-schema.json` and `ops/db/schema-diff.compose.json` (lane S3's committed expectation
  goes stale when schema.mysql.sql / install.mysql.sql change). `build-patch.sh` regenerates both; the builder's original is kept as
  `build-patch.sh.builder-original`.
