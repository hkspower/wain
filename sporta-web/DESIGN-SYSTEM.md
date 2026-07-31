# Sporta — colour, type and layout

The rules the site is actually built on, and the measurements behind them.
Everything here is checked by `npm run test:contrast`, which walks the real page
in a real browser in **both themes and both languages** and fails the build on
anything under WCAG AA. If a rule below and the code disagree, the test says
which.

---

## 1. The two-orange rule

This is the whole colour scheme in one sentence:

> **Orange as a *surface* is `#E0561C`, and the thing on top of it is near-black.
> Orange as *text* is never `#E0561C`** — it is a deeper orange on light and a
> lighter one on dark.

Measured, not assumed:

| pair | ratio | verdict |
|---|---|---|
| `#FFFFFF` on `#E0561C` | **3.81:1** | fails AA for text |
| `#171A1E` on `#E0561C` | **4.59:1** | passes — buttons, chips, badges, the announcement bar |
| `#E0561C` on `#E2DBCE` | **2.77:1** | fails badly — this was the product price |
| `#B8430F` on `#E2DBCE` | **3.97:1** | still fails — this was every card price |
| `#A33A0A` on `#E2DBCE` | **4.82:1** | passes — `--accent-text`, light |
| `#A33A0A` on `#FFFFFF` | **6.63:1** | passes |
| `#FF9A52` on `#1B2026` | **7.80:1** | passes — `--accent-text`, dark |

`#B8430F` keeps exactly one job: the **hover surface**. It was never a text
colour, and using it as one is what put 3.97:1 prices on every product card.

### Tokens

| token | light | dark | use |
|---|---|---|---|
| `brand` (Tailwind) | `#E0561C` | same | orange **surfaces**, icons, rules |
| `brand.bright` | `#FF7B17` | same | the logo mark, gradients |
| `brand.dark` | `#B8430F` | same | hover surface only |
| `--accent-text` / `.text-accent` | `#A33A0A` | `#FF9A52` | orange **words**: prices, links, eyebrows |
| `--on-brand` / `.on-brand` | `#171A1E` | same | anything sitting on brand orange |
| `ink` | `#171A1E` | — | canvas of the header/footer; headline colour on light |
| `sand` | `#E2DBCE` | remapped to `#171A1E` | the page canvas |

### The grey rule

`text-slate-500` is a **card-interior** colour: 4.76:1 on white, but only
**3.46:1 on the beige canvas**. Anything sitting directly on `bg-sand` — a
product card's description, "Showing 12 of 46", "Your bag is empty", a
breadcrumb — uses `text-slate-600` (5.51:1). Inside a white card, slate-500 is
fine.

On the charcoal header, orange flips the other way: the surface orange `#E0561C`
is only **4.09:1** there, so the active nav link uses `brand.bright` `#FF7B17`
(6.0:1) — the logo's own orange, which is what it is for.

Two utilities carry the roles so a component never repeats a hex:
`.text-accent` (orange words) and `.on-brand` (near-black on orange). Reaching
for `text-brand` on a *word* is the mistake this system exists to prevent —
`text-brand` is for icons and rules, which need 3:1 and clear it on both
canvases.

### Dark mode is one token flip

`[data-theme='dark']` re-points `--accent-text` at `#FF9A52`, and every price,
link and eyebrow that used the **role** rather than the hex follows. That is why
roles are worth the indirection: the alternative is a dark-mode override per
component, and the one that gets forgotten is invisible until someone complains.

---

## 2. Hierarchy on the product page

The rule that matters more than any single value: **one orange per column.**

Before, the product name was `brand.dark` and the price was `brand` — two
oranges, two shouts, no hierarchy, and the price was the *less* readable of the
two at 2.77:1. Now:

1. **Name** — ink (`text-slate-900`, auto-inverted in dark), Alexandria, 3xl,
   extrabold. It carries the weight.
2. **Description** — `slate-600`, relaxed leading. Quiet on purpose.
3. **Price** — the only orange in the column, Alexandria, `tabular-nums`.
   Because it is the only orange, it is where the eye lands second.
4. **Size chips** — white on a hairline border; the chosen one is near-black on
   orange **plus a ring**, so the selection survives colour blindness.
5. **Add** — solid orange. **Buy now** — ghost, orange words. **Save** — an
   outline circle. Three weights for three levels of intent.

---

## 2a. The option boxes

Under the photograph: the **brand plate** — the Sporta mark (theme-aware:
`logo.png` on light, `logo-white` on dark) and, for AHED pieces, `AHED ·
Collection`. Who you buy from and who made it, in that order.

In the buy column: three boxes, all from one component (`OptionBox` / `Chip`),
so they cannot drift into three different ideas of what "chosen" looks like.

| box | values | behaviour |
|---|---|---|
| **Size** | S · M · L · XL · 2XL · 3XL · 4XL · 5XL | the full ladder always draws; sizes this piece is not carried in are struck through |
| **Fit** | Normal · Slim fit · Loose fit · Oversize · Boxy · Tank | per-garment subset, one preselected |
| **Colour** | the other colourways of the same garment | swatches are **links**, not toggles |

Three rules behind that table:

- **The ladder is always complete.** Before, a page showed only the sizes the
  piece was bought in, so a 3XL customer saw `S M L XL` and could not tell
  whether the shop does not carry 3XL or has sold out of it. Striking it through
  answers the question; hiding it says "we never made this".
- **A disabled chip still has to be readable.** WCAG exempts inactive controls
  from the contrast floor, and this one is not exempt in practice: the
  struck-through label *is* the message. `slate-400` on `slate-100` measured
  2.4:1, so it is `slate-600` (6.9:1) — plainly inactive from the grey fill and
  the strike, not from being illegible.
- **Colour is a different product, not a variant.** Each colourway has its own
  slug, price, stock and photographs, so choosing one navigates. That is what
  keeps "Only 2 left" on the page honest.

Fit subsets are per garment (`FIT_BY_GARMENT` in `src/lib/options.js`): leggings
offer slim and normal only, accessories offer no fit at all. Offering all six
everywhere is how a shop takes an order for a "tank legging".

**They reach the order.** The line key is `slug__size__fit`, so an L oversize
tee and an L slim tee are two lines to pick and pack. `create_order` validates
both against fixed lists and stores them on `order_items` — see
`supabase/order-options-migration.sql`. Before it, a customer picked L, paid for
L, and the shop received "2 × Cloudsoft Jacket" with no size on it.

---

## 2b. Checkout, and quick checkout

**Quick checkout is not a second checkout.** Same `form` object, same
`validateDelivery()`, same `create_order`, same server-side pricing — it is the
full checkout with nothing left to fill in. The gate is `canQuickCheckout()`: if
one required field is missing, the shopper sees the form, because something in
it genuinely needs them.

What it shows, in this order, and why each is non-negotiable:

1. **The address, in full.** The failure mode of express checkout is delivering
   to the flat someone moved out of two years ago. Showing it — with **Change**
   one tap away — is the defence.
2. **The bag, with size and fit on every line.** A collapsed checkout that hides
   the bag is how someone pays for the wrong size.
3. **The payment method**, as radios. "Pay now on the bank's page" vs "pay the
   driver" is the whole decision and must be readable without a tap.

`/cart` and the cart drawer say **Quick checkout** when it will actually be
quick, so it is a reason to come back rather than a pleasant surprise.

### One track id per attempt, not per tap

`create_order` has an idempotency guard — same `track_id`, same pending order,
returned rather than duplicated — and **it could never fire**, because the
browser minted a fresh id on every call. A shopper who tapped Pay, hit a slow
network and tapped again got two orders; so did anyone who backed out of the
bank page to try another card.

The id is now derived from a fingerprint of *(bag + address + method)* and kept
in **sessionStorage** — not localStorage, or someone reopening the shop a week
later would be handed the same order number for a different bag. Change the bag,
the size, or the address and it changes, because that is genuinely a different
order. `clearAttempt()` runs when the order is placed.

It lives in `src/lib/attempt.js`, deliberately free of `import.meta.env`, so
`npm run test:quick` can exercise it in plain Node — which is the only way to
prove "two taps, one order" without standing up a bank.

---

## 2c. The hero carousel

Three slides — strength, cardio, the arena (football / kickboxing / swim) —
in `src/components/HeroSlider.jsx`. Each slide prefers the owner's photograph
from **`/hero/mobile/<id>.jpg` and `/hero/desktop/<id>.jpg`** (ids `strength`,
`cardio`, `arena`; server-only, uploaded in hPanel File Manager, exactly like
`/cats`) and falls back to the drawn scene: anatomically proportioned athletes as
backlit silhouettes — skeleton + width-profile outlines generated by
`scripts/generate-hero-figures.mjs` into `src/components/heroFigures.js`
(edit the generator, re-run it, commit both) — with an ember rim on the whole
silhouette union (per-part rims drew seams inside the body), contact shadows,
haze and film grain. The sports-poster treatment: a deliberate idiom, chosen
over fake "photography" of people who do not exist.

Rules the component encodes, learned by measurement:

- **Each slide clips its own scene** (`overflow-hidden`): the scene svg is
  wider than the slide, and without the clip slide 2's runners bled across
  slide 1 on a phone.
- **The slide height is fixed** (`min-h`, copy centred): content-driven
  padding let the Arabic font swap change the hero's height and shift the
  whole page below it — CLS 0.0456, measured; 0 after.
- **The scenes mirror under RTL, the S mark and any photograph never do.**
- Slide 1's title is the page **h1**; slides 2–3 use a styled `<p>`.
- Autoplay pauses on hover, focus, hidden tab and the explicit pause button,
  and `prefers-reduced-motion` kills it entirely (WCAG 2.2.2). Arrows are
  desktop-only; phones swipe (the arrows sat on the copy at 390px).
- The home request budget in `perf-budget-test.mjs` is 26, not 25: the first
  slide's photo probe is a real request, priced in like the tiles' probes.

## 3. Type

| role | face | notes |
|---|---|---|
| Display (`h1`–`h3`, `.font-display`, prices) | **Alexandria** | geometric, confident large, draws Arabic-Indic numerals properly |
| UI and body | **IBM Plex Sans Arabic** | humanist, legible small |
| Eyebrows (`.eyebrow`) | Alexandria 600, 0.22em tracking | uppercase in Latin |

**Arabic is never letter-spaced.** Tracking breaks the connected letterforms, so
`[dir='rtl']` zeroes it on headings, display sizes, `.eyebrow`, `.tracking-*`
and `.uppercase`, and gives Arabic *more* leading (1.3 on headings, 1.7 on body)
rather than less. The eyebrow gets a slightly larger size and heavier weight in
Arabic instead, because Arabic has no capitals to give a label its weight.

Prices and quantities are `tabular-nums` everywhere so 10.000 and 8.000 line up
digit for digit down a column.

---

## 4. Layout

- **Reserved space before content arrives.** The gallery frame is
  `aspect-square` with `width`/`height` on the `<img>`; the stock lines sit in a
  fixed `min-h-10` slot. The product page's CLS was 0.0515 before that slot
  existed, because "Only 2 left" pushed the Add button down under a thumb
  already reaching for it.
- **Sticky image column on desktop only** (`md:sticky md:top-24`). On a phone
  one column means it would eat the screen.
- **44px of finger.** `.tap`, `.btn` and form controls get `min-height: 44px`
  under `@media (pointer: coarse)`. Text links that must be tappable get
  `-my-2.5 py-2.5` — a bigger target without a bigger line box.
- **The sticky buy bar clears the home indicator** (`safe-bottom`) and is
  followed by a spacer, so it never covers the last of the page.

---

## 5. Checking it

```bash
npx vite preview --port 4173          # in one terminal
npm run test:contrast                 # AA, both themes, both languages
npm run test:product                  # product page structure and behaviour
npm run test:perf                     # CLS, scroll, unused JS, request count
npm run test:a11y                     # keyboard, PWA, offline
node scripts/shot.mjs /product/<slug> shots [dark]   # look at it
```

`test:contrast` reports the offending element's tag and classes, not just the
colours — "orange on beige" appears in four files and the fix differs in each.

Two things it deliberately does **not** fail on, both stated in its output
rather than hidden:

- **`aria-hidden` text.** The `/` between breadcrumbs and the `·` between an
  eyebrow and a heading are separators. WCAG 1.4.3 covers text that conveys
  information; darkening these would turn punctuation into a second row of
  content.
- **Text over art.** A headline on `.hero-glow` sits on a radial gradient
  painted as a background-*image*, and no colour-stack walk can measure that.
  Those are counted and reported as "N over art, not measurable here" —
  "unmeasurable" is a real answer and "fine" is not. Check those by eye.

It composites colours **on a canvas** rather than parsing them, because Tailwind
v4 emits `lab()` and `oklab()`: a regex that understood only `rgb()` skipped the
header's background entirely and reported the active nav link as
orange-on-beige when it is orange-on-charcoal.
