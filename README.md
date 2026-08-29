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
| Exchange | `/exchange` | Return or exchange from the customer's own order — the same two routes the website's page uses |

## The backend panel

`/backends` — the same address the website's panel answers on, and outside the
tabs, because it is not a fifth thing a customer browses.

| Screen | What it does |
|---|---|
| Sign in | Email + password, then a six-digit code if the account has TOTP on; the session is a cookie, never a stored token |
| Today | Orders and takings today, how many are waiting, what is running out |
| Orders | Status filters; one card per order, not a table |
| Order | Address and items, and only the status moves that order is allowed |
| Returns | Return and exchange requests customers made from the website — approve, mark picked up, refund, or reject with a reason |
| Stock | Per-variant counts, edited one row at a time |
| Promotions | Codes and automatic rules: value, minimum, window, usage limit, pause |

Built for a phone first: cards instead of a seven-column table, 48pt targets,
and the panel is LTR in both languages — it is a screen of order references,
phone numbers and amounts, all of which read left to right even in Arabic, and
the website's panel made the same call.

**It never invents data.** The storefront falls back to a bundled catalogue when
the shop is unreachable; the panel does the opposite and says it could not load.
An order list that shows stale or made-up orders is how stock gets shipped twice.

Endpoints, all under `{apiBase}/admin.php?r=`. Route names are the server's,
underscored — the panel follows `admin.php`, never the other way round:

| Route | Method | Returns |
|---|---|---|
| `login` | POST | `{ name }` + the session cookie, or `{ need_code: true }` for TOTP |
| `login_code` | POST | the second factor, when `login` asked for one |
| `login_code_resend` | POST | posts the emailed code again — one a minute, to the pending account only |
| `otp_begin` / `otp_enable` / `otp_send` / `otp_disable` | POST | the emailed code as a second factor: enrol, confirm, re-send, turn off |
| `me` | GET | who is signed in, or a bare `null` |
| `stats` / `revenue` | GET | today's takings and the daily series |
| `orders[&status=]` | GET | rows carrying BOTH status axes, amounts in KWD |
| `items&order=` | GET | one order's lines |
| `cod_paid` | POST | marks a CASH order paid — the server refuses it for card orders |
| `fulfilment` | POST | moves the parcel: `packed` / `shipped` / `delivered` / `cancelled` |
| `variants` / `set_stock` | GET / POST | per-size stock, keyed on `sku` |
| `discounts` / `discount_save` / `discount_active` / `discount_delete` | GET / POST | promotions |
| `returns[&status=]` / `return_status` | GET / POST | return and exchange requests, lines included; a rejection needs a reason |

**Authentication is a session cookie, not a token.** `?r=login` sets it; every
request also sends `X-Sporta-Admin: 1`, and `admin.php` answers 400 without
that header — it is the CSRF backstop behind `SameSite=Strict`. Nothing stores
a bearer token, and signed-in state is a question (`?r=me`) rather than a
stored fact, so a session that expired on the server is not one the panel still
believes in. A 401 signs the panel out.

Two status axes, not one: `payment_status` (`pending` / `paid` / `review` /
`failed`) and `fulfilment_status` (`unfulfilled` / `packed` / `shipped` /
`delivered` / `cancelled`). Cash is marked paid by hand; a card order is only
ever marked paid by the bank.

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
| `npm run test:shop` | The storefront end to end, in a phone-sized browser — needs a build with NO reachable API (see below) |
| `npm run test:pages` | Every route: status, console, layout, radii, spacing, alignment |
| `npm run test:color` | Every colour as PAINTED, both light and dark, against AA |
| `npm run test:contrast` | The palette's pairs, with no browser |
| `npm run test:art` | The category tiles, bundled and remote |
| `npm run test:live` | The real `api.php` contract |
| `npm run test:payments` | All three methods side by side, both callbacks forged, and everything the checkout refuses — including a client that sends its own price |
| `npm run test:tpay` | CBK T-Pay: the link, the dropin's refusals, the pending state |
| `npm run test:admin` | The panel in a browser, against `scripts/mock-admin.py` |
| `npm run test:admin-contract` | admin.ts, admin.php and the mock name the same routes — no server |
| `npm run test:admin-live` | The panel's protocol against the REAL `admin.php` + MariaDB |
| `npm run test:admin-browser` | The panel itself, in a browser, against the real `admin.php` and the real database |
| `npm run test:wallet` | A built `.pkpass`, the way Wallet reads one |
| `npm run test:assistant` | سبورتا AI: the facts are the shop's, and a customer cannot forge them |
| `npm run test:csp` | Every inline script in the website is declared in its CSP |
| `npm run test:htaccess` | `.htaccess` run by a real Apache — routes, redirects and refusals (needs `apache2`) |
| `npm run test:package` | Every file `index.html` asks for is present — `ROOT=` to check an extracted zip before uploading |
| `npm run test:css` | No dead stylesheet, no selector that can never fire, and `sw.js` precaches only files that exist |
| `npm run test:styles` | No dead style keys, and no hard-coded white on a surface that changes with the theme |
| `npm run test:admin-permissions` | Every route in `admin.php` asked for by a stranger — one gate, and nothing standing in front of it |
| `npm run test:cron-gate` | The seven `cron-*.php` endpoints asked for by a stranger — the key is the only guard on the shop's whole outbound messaging |
| `npm run test:admin-mobile` | The back office at 390, 360 and 320pt — every control on screen, no page dragged sideways, and the photo uploader's Remove needs two taps |
| `npm run test:images` | Every photograph is reachable — the `/cats` rewrite through real Apache, cache headers, and nothing orphaned in the database |
| `npm run test:robots` | robots.txt and the sitemaps as a crawler reads them — every group complete, every listed URL a 200, every slug an active product |
| `npm run test:db` | The database's values against the website and app that read them |
| `npm run test:install` | `IMPORT-THIS-ONE.sql` imported into an empty database, twice, and diffed against the shop that works |
| `npm run test:site-contrast` | Every run of text on the website, measured against what is behind it — `THEME=light` for the other one |
| `npm run test:otp` | The admin's emailed sign-in code against the REAL `admin.php` — enrolment, single use, expiry, five-guess destruction, and that TOTP still wins |
| `npm run test:returns` | Returns and exchanges end to end — the two public routes, the admin gate, and the customer's page in a browser |
| `npm run test:borders` | Every border, all four sides, both themes, phone and desktop — none invisible, plus a census of the colours, widths and radii in use |
| `npm run test:buttons` | Every control on both halves of the shop, PRESSED — none dead, plus tap targets, accessible names and links that go nowhere |
| `npm run test:glare` | Contrast that is too HIGH — light text on a dark page past 18:1, which is halation, not legibility. `THEME=light` measures the other one and judges nothing |
| `npm run scan:storage` | Everywhere the shop keeps something — the customer's device, its database, its disk. What is permanent, what grows for ever, what must never be served |
| `npm run scan:site` | The website, in a browser — `BASE=` to aim it, and the hero measured against the type baked into it |
| `npm run scan:site:curl` | The same, with nothing but curl — aimed by ARGUMENT, not `BASE`: `bash scripts/site-scan.sh http://127.0.0.1:4300` |
| `npm run site:diff` | Is a live server the same build as this repo's copy? |

`npm run test:shop` needs the opposite of the others: an export whose API is
UNREACHABLE.

```sh
EXPO_PUBLIC_API_BASE=https://offline.invalid/api npm run build:web && npm run test:shop
```

It drives the app's BUNDLED FALLBACK catalogue — the nine products in
`src/lib/catalog.ts` — and that is deliberate: those nine carry a sold-out
product, a nearly-gone one, a new one and a discounted one, so all four badge
states are on one screen. Two of them were unreachable when the badge was
written, because nothing in a live catalogue happened to be in that state.

Point it at a working API and it fails seven checks with no clue why: the app
loads the real 46-product catalogue, `grip-training-glove` and the other four
slugs are simply not in it, and `badgeOn()` returns nothing for each. That is
not a regression, it is the wrong build — and it cost a diagnosis once, which is
why it is written down here.

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

**The order number is a capability, and the app was generating it badly.**
`/invoice/<number>` and `?r=status` take nothing but the number, so it opens a
page with the customer's name and address on it. The website has always built
it from `crypto.getRandomValues`; the app built it from `Date.now()` plus four
random base36 characters — about twenty bits behind a timestamp anybody can
guess. It now uses **`expo-crypto`**, not the global `crypto`: Hermes has no
such global, so the website's line pasted in unguarded works on web and throws
on every iPhone and Android — passing every browser test in this repo while
breaking checkout for exactly the customers the app is for.

Raising the route's length floor would NOT have helped and was reverted: the
client chooses this value, so it can satisfy any length with no randomness at
all, and a floor of twelve would also refuse about one legitimate website order
in eighty thousand. Entropy can only come from the clients.

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
- `GET  {apiBase}/api.php?r=return_items&ref=…&phone=…` → an order's lines, for a return
- `POST {apiBase}/api.php?r=return_request` → records one, answers `{ ref }`

**The phone is the gate on both return routes.** `track_id` is chosen by the
CLIENT at checkout and only has to match `[A-Za-z0-9]{6,30}`, so a six-character
order number is a legal one and the reference is not a secret. Without the
phone check `?r=return_items` would hand a stranger a customer's name and
shopping for the cost of guessing. A missing order and a wrong phone answer
identically, so the difference cannot be used to test whether a number is real.

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
