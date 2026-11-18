# Cards scan, 2026-11-18

Owner: "scan cards then improve design". Read-only scan of every card-like box (radius of 8px or more with a border, a shadow or
a fill, at least 120 x 60 px) on home, shop, a product, about, contact, account, returns, support, brands and the bag, English,
390 and 1280 px, on the captured live storefront (the real compiled client) under this repo's add-on files. Script: the
session scratchpad `cards/scan.mjs` (not shipped; it uses `scripts/lib/add-to-cart-ux-live.mjs`).

## What is already one system (no change)

| Card | Radius | Border | Padding |
|---|---|---|---|
| product card, category tile, why-card, support card, bag line, feature item, brand chip | 16px (1rem; 17px at the larger root size) | 1px, ink 13% | 24 / 28 / 20 / 13 / 15 / 10 px |

Radius and border are shared (SHAPE-1111 and the sections before it). The resting shadow is one step (ink 2-3% for the product
card, a lighter one for the others). Paddings differ per card on purpose (a why-card holds a paragraph, a brand chip a logo).
Outliers noted, not changed: the cart summary panel is 21px with a 2px top rule (the accent edge of the summary), the home
"features" band is 20px (it is a band, not a card), form fields 12px.

## What was off and is now fixed (CARDS-1118 in `sporta-shadows.css`; `npm run test:cards-1118`, 18 checks, mutants killed)

1. **Quick-add "+" on a product card**: the logo orange inside a 1px grey-ink rim (the bundle gives the save heart and the add
   button one border colour). A fill is drawn without a rim; the border now takes the fill's colour. The "in your bag" state keeps
   its own border.
2. **About page, the 01-04 index of the why-cards**: a 12px black number, the only brand-less spot on the card. Now a 2rem disc in
   the logo orange with the near-black figure (6.73:1).

## Found, not changed (owner's call or data)

- Fourteen of the 46 products have no photo, so about a third of the cards on the first page of /shop show the grey "image
  coming soon" plate; it is the biggest visual weakness of the grid and it is data (photos), not CSS.
- The Contact page's WhatsApp and Email cards are as tall as the ones with a button (about 167px on a phone) with big gaps
  between icon, title and value; they could be a compact two-up row. Not done: it changes the page's rhythm, and
  the contact sections of `sporta-shadows.css` already tune it.
- Hero and category-tile glows behind the photographs are salmon radial gradients in the bundle's own literals; they sit under
  the pictures and were left (they are not red, but they are not the logo orange either).

## Palette change that came with this (COLOURS-1118)

See `sporta-brand-theme.css`: every orange fill is the logo's #FF7B17; small orange text on light grounds and the hover fill use
the dark step #B34D00 (same 26 degree hue, 5.28:1 on white); failures use the same two oranges (the bundle's rose and red scales
are remapped for the shop, the admin keeps its own). `npm run test:colours-1118`.
