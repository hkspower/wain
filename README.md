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
| Home | `/` | The shop's own banners, the four categories full width, best sellers |
| Shop | `/shop` | Category and sort filters that stay put while the grid scrolls |
| Product | `/product/[slug]` | Sizes with real stock, pinned add-to-cart |
| Cart | `/cart` | Quantity steppers capped by stock, totals above the tab bar |
| Checkout | `/checkout` | Kuwaiti address, KNET / T-Pay / cash, spinner inside the button |
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
| Promotions | Codes and automatic rules: value, minimum, window, usage limit, pause |

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
| `discounts` | GET | `{ discounts[] }` |
| `discount-save` | POST | `{ ok, discount }` — 409 if the code exists |
| `discount-active` | POST | `{ ok, active }` |
| `discount-delete` | POST | `{ ok }` — 409 once it has been redeemed |

Everything but `login` takes `Authorization: Bearer <token>`; a 401 or 403 signs
the panel out.

## Tests

Everything is an npm script now — `npm run` on its own lists them. They were
loose `node scripts/…` lines, and the docs had drifted into naming four
commands that did not exist.

```sh
npm run sandbox        # MariaDB, the PHP site, the mock admin API, the built app
npm run build:web      # the export the browser rigs read
```

`npm run sandbox` is safe to run again at any time: it starts only what is not
already answering, tops the seed stock back up and clears the order throttle,
because the rigs place real orders against a real database.

| Command | What it checks |
|---|---|
| `npm test` | Everything that needs no server: types, contrast, CSP, PHP deprecations |
| `npm run test:shop` | The storefront end to end, in a phone-sized browser |
| `npm run test:pages` | Every route: status, console, layout, radii, spacing, alignment |
| `npm run test:color` | Every colour as PAINTED, both light and dark, against AA |
| `npm run test:contrast` | The palette's pairs, with no browser |
| `npm run test:art` | The category tiles, bundled and remote |
| `npm run test:live` | The real `api.php` contract |
| `npm run test:tpay` | CBK T-Pay: the link, the dropin's refusals, the pending state |
| `npm run test:admin` | The panel in a browser, against `scripts/mock-admin.py` |
| `npm run test:admin-contract` | admin.ts, admin.php and the mock name the same routes — no server |
| `npm run test:admin-live` | The panel's protocol against the REAL `admin.php` + MariaDB |
| `npm run test:admin-browser` | The panel itself, in a browser, against the real `admin.php` and the real database |
| `npm run test:wallet` | A built `.pkpass`, the way Wallet reads one |
| `npm run test:assistant` | سبورتا AI: the facts are the shop's, and a customer cannot forge them |
| `npm run test:csp` | Every inline script in the website is declared in its CSP |
| `npm run test:htaccess` | `.htaccess` run by a real Apache — routes, redirects and refusals (needs `apache2`) |
| `npm run test:styles` | No dead style keys, and no hard-coded white on a surface that changes with the theme |
| `npm run test:db` | The database's values against the website and app that read them |
| `npm run test:site-contrast` | Every run of text on the website, measured against what is behind it — `THEME=light` for the other one |
| `npm run scan:site` | The website, in a browser — `BASE=` to aim it |
| `npm run scan:site:curl` | The same, with nothing but curl |
| `npm run site:diff` | Is a live server the same build as this repo's copy? |

`npm run test:admin` needs the export built against the mock, which serves the
app itself on the same origin — the topology Apache gives production:

```sh
EXPO_PUBLIC_API_BASE=http://127.0.0.1:8899 npm run build:web && npm run test:admin
```

`scripts/mock-admin.py` is a test fixture standing in for `admin.php` — the panel
has no offline fallback by design, so there is no way to exercise it without a
server. It is not a reference implementation, and it is not allowed to drift:
it once grew a vocabulary of its own (Bearer tokens, hyphenated routes, five
routes admin.php never had) and the panel was written against the fixture —
every test green, every production request doomed. `test:admin-contract` now
holds all three files to one set of route names, and `test:admin-live` runs the
same protocol against the real PHP, which is the check whose absence let that
happen.

`test:admin-browser` closes the last gap between those three: the contract test
reads files, `test:admin-live` speaks the protocol with node's fetch, and
`test:admin` drives the real screens — but against the fixture. Only this one
puts the actual panel in front of the actual server, which is the only
combination a manager ever uses. It needs the export pointed at the proxy that
serve-dist.py opens onto the PHP site, so panel and API share one origin:

```sh
bash scripts/sandbox.sh && python3 scripts/serve-dist.py &
EXPO_PUBLIC_API_BASE=http://127.0.0.1:4173/api npm run build:web
npm run test:admin-browser
```

It moves one order along its fulfilment axis and moves it straight back, and
checks the DATABASE rather than the screen — the panel saying "packing" only
proves React re-rendered; the row saying `packed` proves the request arrived
and that admin.ts still translates the app's word into the server's.

### A note on the website's own comments

`sporta-site/` is the restored go-live package, and its PHP files still mention
`npm run publish`, `test:claims` and `test:seo`. Those belonged to the WEBSITE's
own repository, whose source was lost with an earlier container. They are true
history and they are not commands this repo has — the website here is a built
artefact plus its PHP, not a project you can rebuild from source.

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

The client uses three endpoints, all on `api.php`:

- `GET  {apiBase}/api.php?r=products` → the catalogue, priced in KWD
- `GET  {apiBase}/api.php?r=stock` → `{slug, size, stock}` rows, a SEPARATE call
- `POST {apiBase}/api.php?r=order` → `{ track_id, amount, pay_url }`
- `GET  {apiBase}/api.php?r=status&id=…` → whether the bank has answered yet

**Not `store.php`.** This page said `store.php?r=catalogue` for a long time and
it was wrong the whole time: `store.php` is the shop's LIBRARY, not a router. It
answers 200 with an empty body, so the app fell back to its bundled catalogue
for ever and looked like it was working. `scripts/live-api-test.mjs` asserts the
emptiness of that response now, precisely so the wrong contract cannot come back
quietly.

Sizes do not come with the catalogue — that is why `r=stock` is a second call
and why `lib/api.ts` adapts the two into one model. Prices arrive as KWD
decimals and are converted to integer fils on the way in.

`pay_url` is the bank's hosted page for that order, RELATIVE to the site
(`/pay/pay.php?trackid=…&paytype=2` for T-Pay, `/knet/pay.php?trackid=…` for
KNET, and null for cash on delivery). The app resolves it against the site
rather than the API and opens it in the system browser sheet, so the customer
sees the real bank URL and padlock. Coming back from that sheet proves nothing —
`r=status` is what says whether the money arrived. See `sporta-site/TPAY.md`.

## Tab icons

`assets/images/tabIcons/*.png` are generated, not drawn:

```
python3 scripts/make-tab-icons.py
```

They are alpha masks rendered from signed distance functions at @1x/@2x/@3x.
Edit the geometry in the script, never the PNGs.
