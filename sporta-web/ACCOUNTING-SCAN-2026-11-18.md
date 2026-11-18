# Accounting and footer scan — 2026-11-18 (owner: "scan footer / scan accounting")

**STATUS 2026-11-18 (owner: "fix all"): A1, A2, A3, A4 (the part the data supports), A6 and A7 are fixed in `dropin/php-store/xbrl.php`, proven by
`npm run test:xbrl` (30, was 17: five orders built for it, a month cut at the Kuwait midnight, a refund in a later month, a closing refund
with its cost reversed, one order that does not add up) and by the mutants run on each fix (every one is killed except A6, which the old
code also got right at these sizes, so it is a regression guard only). A5 and A8 are NOT fixable in code: expenses are not dated
data (they need a per-month table and the owner's numbers) and the entity identifier is the owner's registration number. Both are now
printed in the figures instead of left to be assumed. NOT deployed: it is an API release (`xbrl.php`), behind the review gate.
Two suites that encoded the old rules were updated with it: `knet-refund-test.mjs` (a closing refund no longer drops the order from
`PaidOrders`; its period is the shop's day) and the mutant P2-M12 in `knet-mutants.mjs`. That suite's track ids were nine characters, which the
order route has refused since it began requiring ten, so it had not been running at all; they are longer now and it passes (114).**

**REVIEW 2026-11-18 (independent, before any deploy): not ready, two blockers, both fixed.** (1) A refund of scope `duplicate` (a second capture of one
payment, the order stays paid) was booked against revenue; only scope `order` counts now. (2) A refund of an order that was never paid (`paid_at` NULL,
refunded from `review`) took revenue and cost off a sale that was never booked; it is skipped. Also fixed: the cost comes back only when the garments did
(`orders.stock_released = 1`; a shipped or delivered order keeps its cost); only "table does not exist" (SQLSTATE 42S02) is the no-migration case, any other
database error now fails the export instead of leaving the refunds out; the figures are applied once after the loop; `RefundsRead` says whether the table was
read; `xbrl_fils` reads `.5`, `+5`, `1e3` (it read them as 0). Left as is: a period of one day is refused (`from` must be before `to`, unchanged); the
database session is assumed UTC (not measured live). **The live database has no `order_refunds` and no `orders.refunded_amount`** (read-only schema diff,
2026-11-18, `SCHEMA_DIFF_EXIT=1`: `refunds.mysql.sql` and `customers.mysql.sql` are not applied), so on the live shop this release changes the period cut,
the stock date, the fils sums and the reconciliation line, and books no refund; `npm run test:xbrl` has five LIVE STATE checks that hide the table.
`test:xbrl` is 46 checks; of 26 mutants, 23 are killed and 3 are equivalent (the SQL pre-filter `created_at <= to` is re-checked in PHP, the SQL pre-filter
`scope = 'order'` is repeated on the rows query, `order by id` is the table's own order).

READ-ONLY (the findings below; the fixes are the status above). Nothing was changed in the product and nothing was measured on the live database (that needs a read-only job through the
Hostinger connector). Method: read `dropin/php-store/xbrl.php`, `payment-records.php`, the admin `orders` / `items` routes and the public
invoice route; ran `npm run test:xbrl` (17 ok, 0 FAIL); the footer by `scripts/footer-scan-1118.mjs` on the captured live storefront.
`npm run test:xbrl-ui` could not run here (the sign-in page never appeared; a set-up problem, not examined).

## Footer — clean

Five pages x two languages x 320 / 390 / 768 / 1280 px, with this repo's add-ons over the captured live app: a real `<footer>`, three
headings, 15 links, none dead, none empty, no duplicate, tel / WhatsApp / Instagram / TikTok links well formed and owned by the shop,
no sideways scroll, 44 px taps on a phone, contrast at AA or better (the icon links were first flagged by the scan itself: a white icon on a
2% white fill; fixed in the scan), direction and `lang` right, no English left in the Arabic footer, digits consistent. The two anchors
the footer uses land under the sticky header on the live app: `/terms#delivery` and `/about#why` (heading 112 px from the top).
Left as a note, not a defect: no KNET / card mark in the footer (only "Cash on delivery"), which a shopper may look for.

## Accounting — what the figures are, and where they can mislead

The report is cash basis: a paid order, in the period of `paid_at`, revenue = subtotal - discount, delivery fees as other income,
cost = quantity x the variant's unit cost (a line with no cost is counted, never guessed). Refunds in `payment-records.php` are in
whole fils and exact. The findings below are about `xbrl.php`. None is fixed: it is the money-path release gate.

| # | Severity | Finding | Why it matters | Suggested fix (owner decision where marked) |
|---|---|---|---|---|
| A1 | Medium | The period is cut at UTC midnight (`paid_at >= from and paid_at < to + 1 day`), the shop's day is Kuwait's (UTC+3). Assumes the database clock is UTC (the rest of the code does; the live `@@time_zone` was not measured). | Up to three hours of orders at each end of a month land in the neighbouring month; the new Invoices screen already uses Kuwait dates, so the two disagree at month ends. | Shift both bounds by 3 h in SQL, after one read-only `select @@global.time_zone, now()` on the live database. |
| A2 | Medium | `Inventories` is "stock on hand at the end date" in the comment, but the query reads the CURRENT `product_variants.stock`. | A report for a past period shows today's stock, so the balance sheet line is wrong for every period but the current one. | Rebuild the quantity at `to` from `inventory_movements` (they exist), or state "as of today" in the file. |
| A3 | Medium | A refund reduces the revenue of the order's ORIGINAL period, and a fully refunded or voided order disappears from it. | A period that was reported and closed changes when a later refund lands (a restatement), and the books no longer match what was filed. | Decision: book a refund in the period it happens (needs a refund date; `payment_records` may already hold one) or accept restatement and say so. |
| A4 | Medium | `CostOfSales` is not reversed on a refund. | A partial refund cuts revenue and keeps the full cost, so gross profit is understated; if the goods go back on the shelf the stock rises as well, counting that cost twice. | Decision on whether returned goods are restocked; then reverse the cost of the returned lines. |
| A5 | Medium | Expenses are the CURRENT numbers in the inventory settings, "not dated transactions". | The same expenses appear in every period asked for, so profit is only meaningful for the period they were typed for. | Keep expenses per month (a small table), or print the period they belong to. |
| A6 | Low | Money is summed as floats and rounded at the end (`(float)` and `round(x, 3)`), everywhere else in the shop it is whole fils. | A large period can drift by 0.001 KWD against the sum of the invoices. | Sum in integer fils. |
| A7 | Low | The report never looks at `orders.amount`; it rebuilds the total from subtotal, discount and delivery. | An order whose stored total differs (the "Check" mark on the Invoices screen) is reported differently from what the customer paid, silently. | Add one reconciliation line to the export: sum(amount - refunded) against Revenue + OtherIncome. |
| A8 | Info | The entity identifier is a placeholder until the commercial registration is set (documented in the file). | A filing with the placeholder is not a filing. | Owner supplies the number. |

Not covered: the live data (how many orders fail A7 today, whether any variant has no cost), the admin Finance screen's own maths, the
KNET / CBK settlement files, and tax (Kuwait has no VAT today, so none is computed).
