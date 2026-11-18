# Product values scan, 2026-11-18 (live, read-only)

Owner: "scan all product values". One fetch-only job on the VPS (`scripts/live-product-values-scan.mjs`, commit `de53627f`; GET and HEAD of
public URLs, no sign-in, no POST; scratch projects deleted). It reads what a shopper's browser can read: `api.php?r=products`, `?r=stock`,
`?r=brands`, and HEADs the photo files. It cannot see cost, supplier, sale dates, products switched off, or products hidden for lacking a name or
price (those need the signed-in admin).

**Result: 46 products, 167 size rows, 3 public brands. 0 errors.** 61 warnings (4 kinds), 57 notes. Nothing is on sale.

## Totals (the numbers behind the pricing task)

| | KWD |
|---|---:|
| Sum of original (list) prices, 46 products | 333.500 |
| Sum of prices charged now | 333.500 |
| Difference (sales) | 0.000 |
| Products on sale | 0 of 46 |
| Units in stock, all sizes | 1,231 |
| Stock at original prices (units x list price) | 7,453.700 |

| category | products | min | median | max | sum of list |
|---|---:|---:|---:|---:|---:|
| women | 19 | 4.200 | 8.000 | 8.000 | 133.700 |
| men | 12 | 3.000 | 5.000 | 10.000 | 68.000 |
| outerwear | 11 | 6.000 | 10.000 | 10.000 | 100.000 |
| accessories | 4 | 4.000 | 7.750 | 12.300 | 31.800 |

## What is clean

- Every price is greater than zero, has at most 3 decimals and is a multiple of 0.050; none is an outlier against its category (3.000 to 12.300).
- `price` charged equals `list_price` on every product and `on_sale` is false everywhere, so the sale maths has nothing to disagree about yet.
- No duplicate slugs, English names, Arabic names or SKUs; slugs are well formed; both names present, with Arabic letters in every Arabic name; every
  description present in both languages; one category spelling per category; no negative or fractional stock; no repeated size on a product.
- Size grammar of the shop: XS to 5XL, "ONE" for the accessories (the scanner's first run flagged these 19 + 15 products as odd and mixed; that was
  the scanner's own size rule, fixed in `de53627f`, not a data problem).

## Findings

| # | kind | products | what | action |
|---|---|---:|---|---|
| 1 | FAMILY-PRICE-VARIES (warn) | 28 | Colours of one style are priced differently (list below). May be intended (clearance), but `4.500` and `4.200` look like typos for `8.000` | owner decision; the bulk price list (pricing task) is the tool for it |
| 2 | STOCK-PLACEHOLDER (warn) | 14 | Every size holds exactly 10 (8 sizes x 10): `energy-t-shirt-red-white`, `flash-shorts-green/red`, `naples-leggings-black`, `naples-sports-bra-pink`, `sgomma-t-shirt-navy`, `street-pants-navy`, `tekno-shorts-black/royal`, `vanquish-stringer-vest-white`, `vanquish-t-shirt-navy-blue/white`, `vanquish-tank-navy`. That is 1,120 of the 1,231 units; the rest of the catalogue holds 111 units. If 10 is a default and not a count, the shop can sell pieces it does not have | owner: confirm or set the real counts in /backends -> Stock |
| 3 | PHOTO-NONE (warn) | 14 | No file `/images/products/<slug>.(jpg\|jpeg\|webp\|png)`: the grey "no photo" plate (known; the owner keeps them listed) | photographs |
| 4 | PHOTO-HEAVY (warn) | 5 | PNG photos of 403 to 703 kB: `define-jacket-iris-purple` 703, `cloudsoft-jacket-coffee-brown` 474, `cloudsoft-jacket-cherry-red` 458, `cloudsoft-leggings-coffee-brown` 405, `cloudsoft-leggings-cherry-red` 403 | lossless upload is the owner's rule; small WebP copies (`make-image-variants.mjs`) fix the grid cost |
| 5 | BRAND-NONE (note) | 40 | No brand tag (the brand chip on the product page needs one) | tag in /backends -> Brands |
| 6 | ALL-SOLD-OUT (note) | 4 | `cagliari-calcio-backpack`, `cagliari-calcio-backpack-navy`, `denver-nuggets-cap-navy`, `gymshark-phone-strap`: one size "ONE", stock 0 | restock or hide |
| 7 | BRAND-NO-LOGO (note) | 2 | `denver-nuggets-cap-navy`, `gymshark-phone-strap` carry a brand with no logo (shown as a name) | upload the logos |
| 8 | NO-EXCHANGE-MIXED (note) | 11 | Category `outerwear` has 10 no-exchange products and one exchangeable (`cagliari-calcio-sweatshirt-navy`): consistent with "women's clothing cannot be exchanged" if that sweatshirt is a men's piece; the other categories are uniform | check the flag on that product |

### 1. Same style, different prices

| style | colours and prices (KWD) |
|---|---|
| Cagliari Calcio Backpack | 4.000, Navy 9.000 |
| Cloudsoft Jacket | Army Green 10.000, Cherry Red 8.000, Coffee Brown 10.000 |
| Cloudsoft Leggings | Army Green 8.000, Cherry Red 8.000, Coffee Brown 8.000, **Grey 4.500**, Navy 8.000, Onyx Black 8.000 |
| Cloudsoft Top | Grey 6.000, Navy 6.000, Onyx Black 7.000 |
| Sculpt Jacket | Black 10.000, Grey 8.000, Navy 8.000, Taupe Brown 6.000 |
| Sculpt Leggings | Black 8.000, Grey 8.000, **Navy 4.200**, Taupe Brown 8.000 |
| Sculpt Top | Black 6.000, Grey 8.000, Navy 8.000, Taupe Brown 8.000 |
| Vanquish T-Shirt | Navy Blue 10.000, White 8.000 |

(Define Jacket x3 at 10.000, Flash Shorts x2 and Tekno Shorts x2 at 3.000 are uniform.)

## Not in the scan's reach

Cost per size (admin `variants`), sale dates, inactive and auto-hidden products, and the price history. The scan does not write anything and made no order.
Re-run: `node scripts/live-product-values-scan.mjs` on the VPS (it fetches itself from the pushed commit; see the other `live-*` probes for the compose).
