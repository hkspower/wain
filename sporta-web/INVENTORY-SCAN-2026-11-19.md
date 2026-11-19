# Inventory scan, 2026-11-19

Owner: "scan all invetory table". Scope: the two inventory tables (`product_variants`, `inventory_movements`), the tables they are read against
(`products`, `orders`, `order_items`), the code that writes them, and what is on the live database today.

**Method.** Read-only one-shot jobs on the VPS through the Hostinger connector (project deleted after each): `scripts/inventory-live-scan.mjs`,
first pass 18 SELECTs from commit `d720ebba`, second pass 26 SELECTs from `e8510fc0`. The session is READ ONLY at the server and every statement passes
the same SELECT/SHOW gate as `db-schema-live-diff.mjs`. No customer, address, phone or e-mail column is selected; admin actors are counted, never named.
Nothing was written, nothing deployed. The code paths were read in `store.php` and `admin.php`; two claims were proven on the local rig (below).

## Result

**The structure is clean. The numbers in it are the problem.**

What holds, measured live:

- `product_variants` 172 rows, `inventory_movements` 2 rows, both InnoDB. No negative stock, no row over the 999,999 cap.
- No duplicate (product, size) pair; no variant of a deleted product; no active or inactive product without size rows (50 products, 50 have sizes).
- Every size label is valid (L 41, M 34, 3XL 16, XL 16, 2XL 15, 4XL 15, 5XL 15, S 15, ONE 5): no blanks, no lower case, nothing over 4 characters.
- The ledger's arithmetic holds (`after = before + delta`, CHECK-enforced); both rows chain to the current stock; the one order line in `order_items` has a size row.
- `unit_cost_kwd` equals `cost_aed / 11.95` wherever both exist (0 differences). Every `low_stock_threshold` is the default 2.

## Findings

| # | Severity | What | Who decides |
|---|---|---|---|
| INV-01 | **High** | **1,120 of the shop's 1,237 units are 14 products holding exactly 10 of every one of 8 sizes.** That is a placeholder pattern, not a count. Ten of those products are hidden from the shop today (no photo file); **four are on sale with 80 units each: `cagliari-calcio-sweatshirt-navy`, `sgomma-t-shirt-navy`, `tekno-shorts-black`, `vanquish-tank-navy`**, so a shopper can order 10 of any size of a garment nobody may have 10 of. The real stock is about 117 units. | Owner: count the four, enter the real numbers in /backends -> Stock (each change writes a ledger row), or switch them off until counted. The other ten when they get photos. |
| INV-02 | **High, FIXED 2026-11-19** (`deploy-20261119T060144Z-269a373`: `variants_create` refuses any size outside the nine; the picker offers only the nine and folds xxl/xxxl; 5 suites updated, independent review SHIP, live sizes re-read first: all 172 rows inside the nine) | **The size pickers can create sizes nobody can buy.** `variants_create` (admin.php:2750) accepts any 1-4 letter/digit label, and the sizes selector offers `XS`, shoe sizes 38-46 and kids 4-14 (`PRESETS` / quick sets in `sporta-admin-brands.js`). The order path takes only `S M L XL 2XL 3XL 4XL 5XL ONE` (`STORE_SIZES`, store.php:257, refused at store.php:4001) and `order_items.items_size_ck` holds the same nine. **Proven on the rig:** an `XS` row with 5 in stock, ordered through `api.php?r=order` -> `{"error":"invalid_size"}`; the same product's `ONE` row passes the size gate. The shop would show the size and refuse it at checkout. Not hit yet: all 172 live rows are inside the nine. | Owner: either widen the order path (a `STORE_SIZES` change, a migration of `items_size_ck`, and a look at the compiled storefront's size ladder) or limit the pickers to the nine. Until then do not add XS, numbers or kids sizes. |
| INV-03 | Medium | **Costs are mostly missing.** 128 of 172 sizes have no KWD cost; the stock whose cost is known is 52 units (332.667 KWD) of 1,237. Four sizes of active products cost more than they sell for (`A-CSL-GR-L` 5.858 vs 4.500, `A-CST-GR-L` and `A-CST-NA-L` 6.025 vs 6.000, `A-SL-NA-M` 5.523 vs 4.200); two more sit on inactive products priced 0.000 (`VANQUISH-TRIUMPH-NAVY-LONG-L` 10.000, `VANQUISH-TSP-CHALK-RED-MUL-3XL` 12.000). The accounting export uses the variant's current cost, so margin and inventory value are mostly blank. All units at selling price: 7,453.800 KWD (1,120 of those units are INV-01's). | Owner: enter costs in /backends -> Stock; check the four. |
| INV-04 | Medium | **The ledger has never recorded a stock count.** 2 movements, both `variant_update` with a net change of 0, on 2026-11-17 (one admin). No `count`, `receive`, `return` or `damage` row exists, so no stock number in the table has a recorded origin. By design the ledger covers admin actions only: an order's claim (store.php:3383) and a release (store.php:3599) change `stock` and bump `inventory_version` with no ledger row. The one trace is `A-VAN-NA-S`: version 1, no ledger row. | Owner: the first real count (INV-01) starts the history. A ledger row for order claims and releases is a design change, not built. |
| INV-05 | Medium | **Sales cannot be matched to stock.** 120 orders (first 2022-05-06, last 2026-09-30); only 1 has line rows in `order_items`; 119 do not, and most of those are cancelled (2026-04 and 2026-05: all 12 cancelled). The one order with lines is not counted as a sale (failed, voided or cancelled), so units sold per month is empty. The older history came without lines. | Information; matters for any future report of "what sold". |
| INV-06 | Low | **No key backs the (product, size) address.** Claim and release find a row by `(slug, size)`, not by SKU; `product_variants` has no unique index on that pair and no foreign key to `products`. A second row for the same size would be decremented twice by one order. Live today: 0 duplicates, 0 orphans, so nothing is wrong yet. | A unique index is a small migration with a backup (the duplicate query is clean). Not built. |
| INV-07 | Low | **Real low stock:** 47 sizes hold 1 or 2 units (the Stock screen's low list); 6 are sold out: four accessories at 0 (`cagliari-calcio-backpack`, `cagliari-calcio-backpack-navy`, `denver-nuggets-cap-navy`, `gymshark-phone-strap`; the two backpacks and the strap are also among the 14 products with no photo) and `ahed` L and M (an inactive product). `define-jacket-steel-grey` holds 1 of each of 3 sizes. | Owner: restock or leave. |
| INV-08 | Info | 4 products are switched off: `ahed` (0 units), `payment-test` (1 unit, a test product left in the catalogue), `vanquish-triumph-navy-longline-tank` (4), `vanquish-tsp-chalk-red-multi-print-oversized-t-shirt` (1). | Owner: delete `payment-test` when convenient. |

## Code paths (read, not changed)

- Writers of `product_variants`: admin `inventory_adjust` (receive / return / damage / count), `inventory_variant_save`, `set_stock` (legacy), `variants_create`
  (all or nothing, never overwrites, opens each new size with a `count` row 0 -> n). Each carries the optimistic `inventory_version` check and writes a
  `inventory_movements` row in the same transaction (admin.php:2444).
- Writers that do not leave a ledger row: the order claim (`stock = stock - ?` guarded by `stock >= ?`, taken in (slug, size) order) and the release
  (`stock + ?`), both bumping `inventory_version`; the 15-minute `cron-stock.php` release rides the same release function.
- `inventory_movements.sku` is a foreign key to `product_variants(sku)` without a cascade, so a variant with history cannot be deleted: the ledger is protected.
- Existing proofs on these paths: `test:admin-stock-tools` (85), `test:admin-sizes-selector` (92), `test:race-money` (87), `test:native` (682 on today's rerun alone).

## What changed in the repo

Only the scan tool: `scripts/inventory-live-scan.mjs` gained nine read-only SELECTs (orders with and without line rows, the sold-out and cost-above-price
rows, variants with a non-zero version, inactive products, single-size products, stock value); validated on the local rig database before the live run.
No application code, no migration, no deploy.
