# Sporta — native app

سبورتا, the Kuwaiti sportswear shop, as a real native app: Expo + React Native,
one codebase for iOS, Android and web.

```
npm install
npm run ios      # or: npm run android, npm run web
```

## What is here

| Screen | Route | What it does |
|---|---|---|
| Home | `/` | Hero, the four categories full width, best sellers |
| Shop | `/shop` | Category and sort filters that stay put while the grid scrolls |
| Product | `/product/[slug]` | Sizes with real stock, pinned add-to-cart |
| Cart | `/cart` | Quantity steppers capped by stock, totals above the tab bar |
| Checkout | `/checkout` | Kuwaiti address, KNET / card / cash, spinner inside the button |
| Order | `/order/[ref]` | The order number, selectable |
| Account | `/account` | Language, contact, and an honest note when offline |

## The backend panel

`/backends` — the same address the website's panel answers on, and outside the
tabs, because it is not a fifth thing a customer browses.

| Screen | What it does |
|---|---|
| Sign in | Email + password; only the returned token is stored, never the password |
| Today | Orders and takings today, how many are waiting, what is running out |
| Orders | Status filters; one card per order, not a table |
| Order | Address and items, and only the status moves that order is allowed |
| Stock | Per-variant counts, edited one row at a time |

Built for a phone first: cards instead of a seven-column table, 48pt targets,
and the panel is LTR in both languages — it is a screen of order references,
phone numbers and amounts, all of which read left to right even in Arabic, and
the website's panel made the same call.

**It never invents data.** The storefront falls back to a bundled catalogue when
the shop is unreachable; the panel does the opposite and says it could not load.
An order list that shows stale or made-up orders is how stock gets shipped twice.

Endpoints, all under `{apiBase}/admin.php?r=`:

| Route | Method | Returns |
|---|---|---|
| `login` | POST | `{ token, name }` |
| `summary` | GET | `{ todayOrders, todayRevenue, pending, lowStock[] }` |
| `orders[&status=]` | GET | `{ orders[] }` |
| `order&id=` | GET | `{ order }` |
| `order-status` | POST | `{ ok, status }` — the server's status, not the requested one |
| `stock` | GET / POST | `{ items[] }` / `{ ok }` |

Everything but `login` takes `Authorization: Bearer <token>`; a 401 or 403 signs
the panel out.

## Tests

```
npx expo export --platform web
python3 scripts/serve-dist.py &
node scripts/smoke.mjs          # the shop, 15 checks

python3 scripts/mock-admin.py 8899 &
EXPO_PUBLIC_API_BASE=http://127.0.0.1:8899 npx expo export --platform web
node scripts/admin-smoke.mjs    # the panel, 16 checks
```

`scripts/mock-admin.py` is a test fixture standing in for `admin.php` — the panel
has no offline fallback by design, so there is no way to exercise it without a
server. It is not a reference implementation.

## The decisions worth knowing

**Arabic is the default.** This is a Kuwaiti shop. The language switch is on the
Account tab and takes effect instantly — layout direction comes from React state
(`row`, `text` in `lib/i18n.tsx`), not from `I18nManager.forceRTL`, which needs an
app reload and would throw the customer's basket away mid-shop.

**Money is integer fils.** 1 KWD = 1000 fils, and nothing is ever a float —
`lib/money.ts`. Arabic prices render in Eastern Arabic numerals with the Arabic
decimal separator, mapped by hand because Hermes ships a cut-down ICU on Android.

**The shop works offline.** `lib/api.ts` fetches the live catalogue from the same
PHP backend the website uses and falls back to the catalogue bundled in
`lib/catalog.ts`. Placing an order deliberately does NOT fall back: an order that
silently failed is worse than an error, so the basket is kept and the failure is
shown.

**Stock is capped in one place.** Every path that can raise a quantity goes
through `add`/`setQty` in `lib/cart.tsx`, which returns `false` when it capped, so
the screen can say why instead of ignoring the tap.

**Tap targets are 48pt.** `TapTarget` in `constants/theme.ts`; every pressable is
sized against it rather than against its own text.

## Pointing it at your shop

`app.json` → `expo.extra.apiBase`. It defaults to `https://www.sporta.com.kw/api`.
For a one-off run, `EXPO_PUBLIC_API_BASE=... npm run web`.

The client expects two endpoints:

- `GET  {apiBase}/store.php?r=catalogue` → `{ products: Product[], categories?: Category[] }`
- `POST {apiBase}/store.php?r=order` → `{ ref: string, payUrl?: string }`

`Product` and `Category` are the types in `lib/catalog.ts`; `payUrl` is the hosted
KNET/card page, opened in the system browser sheet so the customer sees the real
bank URL.

## Tab icons

`assets/images/tabIcons/*.png` are generated, not drawn:

```
python3 scripts/make-tab-icons.py
```

They are alpha masks rendered from signed distance functions at @1x/@2x/@3x.
Edit the geometry in the script, never the PNGs.
