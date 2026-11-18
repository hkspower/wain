# Invoice design scan — 2026-11-18 (owner: "scan invoice design")

READ-ONLY. No source file was changed, nothing was committed or pushed, the live site and the VPS were not touched, and the running test sandbox
(127.0.0.1 :8095-8100, :4173) was not used. Everything below was rendered in my own Playwright Chromium 153 (one browser at a time) on my own ports
(4931, 4932) or from `file://` / `set content`, against fixtures. Every screenshot, PDF, JSON and script is in
`/tmp/claude-0/-home-user-wain/a128f64c-8c94-5bf5-b35a-38b83867e084/scratchpad/invoice-scan/` (called **SCAN/** below; file names are relative to it).

## 0. Read this first (scope and honesty notes)

* **Which storefront.** The customer invoice was rendered from this repo's own build (`dist/`, built 2026-11-18 15:04; its `Invoice-*.js` chunk and the
  string "Kuwait does not charge VAT" match `src/pages/Invoice.jsx`). The LIVE storefront is a different build whose source is not here (CLAUDE.md item 4),
  so the live `/invoice/<id>` page was NOT examined. A second pass put the 13 live add-on stylesheets on top of the same page (SCAN/pub-addons/): the print
  result is unchanged (same colours, margins, pagination); only the screen "Print" button turns from #DE561B to the logo orange #FF7B17.
* **Dates.** Customer, admin and receipt all assume `orders.created_at` / `paid_at` are UTC (the admin sheet, the receipt's `paid_at_kuwait` and `xbrl.php`
  do; the live `@@time_zone` was never measured). Finding C3 depends on that assumption.
* **Fonts.** The public page prints in its self-hosted IBM Plex Sans Arabic / Alexandria (embedded in the PDFs, `pdffonts`). The admin sheet uses
  `system-ui`, which is a sandbox fallback here; line breaks on the owner's computer can differ by a word.
* **Data.** 10 scenarios built from the real column limits (`install.mysql.sql`: name 120, customer 80, area 60, street 40, building 24, note 280, phone 15,
  discount label 200) and the real value formats (governorate is a slug from `STORE_GOVERNORATES`, money is `decimal(10,3)`, DB timestamps are
  `YYYY-MM-DD HH:MM:SS`). The existing suite (`scripts/admin-invoices-test.mjs`) uses `'Hawalli'` for the governorate, which is why A1 below was never seen.
* **Working tree.** While I scanned, someone else had uncommitted edits in the tree (`public/sporta-admin-brands.js` gained an ADMIN PRICE TOOLS block,
  `package.json`). `git diff` shows they do not touch the ADMIN INVOICES block, so the invoice scan stands.
* pdftotext reverses Arabic words, so page analysis used Latin tags (`L01`..`L45`) put into the product names.

## 1. Every invoice surface found

| # | Surface | Where | Rendered |
|---|---|---|---|
| S1 | **Customer invoice page** `/invoice/<order number>` (screen + print + Save as PDF) | `src/pages/Invoice.jsx`, print rules `src/styles/index.css` (`@media print`, 692-843), words `src/i18n/translations.js` (`invoice`), dates `src/lib/bidi.js stamp()`, money `src/lib/format.js` | 10 scenarios x ar/en x 390/1280 + A4 PDF (with and without "background graphics") + dark theme + live add-ons |
| S2 | **API route `?r=invoice`** (what S1 prints: `access` full/limited, totals, `receipt`) | `dropin/php-store/api.php` 682-760, `store.php` 4168-4215, `payment-records.php` | read and exercised through S1's data shape |
| S3 | **Admin Invoices screen + A4 sheet** (list, sheet, Print / Save as PDF) | block ADMIN INVOICES, `public/sporta-admin-brands.js` 15921-16522 | 9 scenarios x sheet ar/en x admin ar/en x 390/1280 + A4 PDFs + list screens |
| S4 | **Invoices CSV** for the accountant | same block, `CSV` array / `csvText()` | downloaded from the real block |
| S5 | **Compiled admin "Export CSV"** (the older courier/orders sheet) | `src/admin/api.js toCsv()` 395 | run on the scenario rows |
| S6 | **Payment receipt box** on `/payment/result` (bank Payment ID, Transaction ID, reference ...) | block PAYMENT RECEIPT, `public/sporta-features.js` 2905-3289, on `scripts/fixtures/payment-result.mjs` | paid / refunded / declined x ar/en x 390/1280 + PDF |
| S7 | **Warehouse e-mail** (the only mail an order triggers; a picking list, no prices) | `dropin/php-store/cron-fulfilment.php sporta_render_warehouse()` | 6 mail kinds rendered at 390 and 640 |
| - | Not found: **any e-mail, PDF file or WhatsApp message that carries an invoice to the shopper.** The invoice is a page only (`assistant.php:3914` says so). The links to S1 are bare `/invoice/<id>` (PaymentResult.jsx:89, TrackOrder.jsx:90, sporta-features.js:3228). | | |

## 2. Counts

**33 findings: 4 High, 12 Medium, 14 Low, 3 Info**.
Looked right: 21 checks (section 5). Measured clean across all renders: **94 screen renders (40 public + 54 admin) with 0 sideways scroll, 0 clipped
text, 0 page errors; 0 text runs below 4.5:1 contrast; 0 red in either printed invoice.**

## 3. Findings

Severity: High = wrong or unusable on a document the customer keeps; Medium = a standard invoice element is missing/inconsistent or a layout defect
a reader notices; Low = polish; Info = note. "Fix" is the smallest change and where it goes.

### HIGH

**H1 (S1+S2) A refunded, voided, failed, under-review or cancelled order's invoice says "Awaiting payment".**
`Invoice.jsx:85` `paid = payment_status === 'paid'`; everything else gets the amber "Awaiting payment" badge. Measured (scenario s5, KNET order refunded in full):
badge "Awaiting payment" (ar "بانتظار الدفع") sitting next to "Paid on 2026-11-15 12:05"; total still 29.250, no refund line (the route sends no
`refunded_amount`, `api.php:722-759`, although `payrec_receipt()` has it). Screenshots `pub/s5-refunded-knet.en.390.png`, `.ar.390.png`, `.ar.1280.png`,
print `pub/s5-refunded-knet.ar.print-1.png`. A cancelled COD order (s8) reads the same.
Fix: `Invoice.jsx` badge from the six statuses (add refunded / voided / failed / review words to `translations.js invoice.*`), show "Paid on" only for
paid/refunded; `api.php ?r=invoice` add `refunded_amount`, `Invoice.jsx` add a "Refunded -X / Net" row.

**H2 (S1+S2) Every customer gets the LIMITED invoice: the printed "Billed to" is one letter and there is no street.**
Nothing in `src/` or `public/*.js` builds `/invoice/<id>?k=<key>` or sends `X-Sporta-Phone` (grep: only `backend.js:87` mentions `?k=`), yet the server issues the key
(`api.php:1197`, `customer-auth.php:279`). The links on the result page, the track page and the receipt box are bare, so the document says
"Billed to **ف.**" and the area only (scenario s10, `pub/s10-limited-public.ar.390.png`, `pub/s10-limited-public.ar.print-1.png`). `index.css` calls the
invoice a document for "a company accounts department"; this one cannot be.
Fix: keep the privacy rule but give the owner of the order a way in: `PaymentResult`/checkout keep `invoice_key` from the order answer in sessionStorage
and append `?k=`; `Invoice.jsx` when `inv.access === 'limited'` shows a one-field "Enter the checkout phone to show your name and address" (header
`X-Sporta-Phone` via `phpOrderInvoice(trackId, key, phone)` in `backend.js`).

**H3 (S1) Order and payment times are the database's UTC value printed as if they were local: 3 hours behind Kuwait, and the date flips after 21:00 UTC.**
`bidi.js stamp()` does `new Date('2026-11-18 21:47:05')` (no zone) then `getHours()`. Measured with the browser in Asia/Kuwait, UTC, America/New_York and
Asia/Tokyo: all four print `2026-11-18 21:47`; Kuwait time is `2026-11-19 00:47` (the admin list shows "19 Nov 2026 00:47" for the same order, the customer
invoice 09:27 where the admin sheet says 12:27). The receipt box is the only surface that says "(Kuwait time)". `stamp()` is used only by `Invoice.jsx` (lines 140, 186).
Evidence `tz-run.mjs` output, `pub/s3-f45-tpay.ar.print-1.png` ("2026-11-18 21:47"), `admin/list.en.1280.png` ("19 Nov 2026 00:47").
Fix: `src/lib/bidi.js stamp()`: parse as UTC (`iso.replace(' ', 'T') + 'Z'`) and format with `Intl.DateTimeFormat(..., { timeZone: 'Asia/Kuwait' })`; add
"(Kuwait time)" / "(بتوقيت الكويت)" to `translations.js invoice.date/paidOn` or the footer.

**H4 (S3) The admin sheet prints the governorate as the raw database slug: "المحافظة: hawalli", "mubarak-al-kabeer", "capital", "jahra".**
`customer_governorate` holds one of `STORE_GOVERNORATES` (`store.php:256`, written by `api.php:869-870`); `addressLines()` (sporta-admin-brands.js:16340) prints it
unchanged, in both languages, on all 9 sheets (`admin/s1-one-knet.sheet-ar.adminEN.1280.png`, `admin/s4.admin.ar-en.png`, text dump in `admin-results.json`).
The customer invoice translates it (`governorate()` in `lib/kuwait.js`); the suite's fixture used "Hawalli" so it passed.
Fix: ADMIN INVOICES `DOC.en/ar.gov` neighbours: add a 6-entry map `{capital, hawalli, farwaniya, mubarak-al-kabeer, ahmadi, jahra}` -> en/ar names and use it in
`addressLines()`; add one test row with a real slug to `scripts/admin-invoices-test.mjs`.

### MEDIUM

**M1 (S1+S3) Arabic money columns are left-anchored blocks, so decimals do not line up.** In RTL `text-end` is the left edge, the cell is "number + currency"
and the block (not the number) is aligned. Measured decimal-point x: customer Arabic line cells spread 8.8 px at 1280 (7.8 at 390), totals block spread 66 px
(336.2 / 366.7 / 402.1 on the 45-line invoice: subtotal 1,139.299, delivery 2.000, grand total 1,141.299 at a larger font); English 0.0 px on rows but 12.4 px on the
grand total (bigger font). Admin sheet Arabic: lines 8.4 px, totals 305.7-344.4 px (38.7); English lines 0.0, total 16.2. Zoom `pub/zoom-disc-2.png` (301.206 / -8.500 /
0.000 end at x=270 / 235 / 218 at 300 dpi), `pub/s3.ar.p34.png`, `admin/s3.admin.ar.png`.
Fix: customer `Invoice.jsx` money cells: `<span dir="ltr" class="inline-block text-end tabular-nums">` with the figure only and "(د.ك)" in the column header and the total
label; same font size for the grand total's numerals, or give it its own right edge. Admin: `.sinv-d-tab .n, .sinv-d-tot .n { direction:ltr; text-align:right }`.

**M2 (S1+S3) The printed arithmetic is not reconcilable and nothing marks it.** Scenario s7 (stored total 41.000, goods 34.000 + delivery 2.000): the customer invoice and
the admin sheet both print Subtotal 34.000 / Delivery 2.000 / Total 41.000 with no flag (`pub/s7-mismatch-check.ar.print-1.png`, `admin/s7-mismatch-check.sheet-ar.print-1.png`).
"Check" exists only in the admin LIST (`admin/list.en.1280.png`) and the CSV ("DOES NOT ADD UP"). Old orders (no subtotal) have the opposite problem, see M4.
Fix: admin `buildDoc()`: a `.sinv-noprint` banner when `money(o).off`; customer `Invoice.jsx`: an "Adjustment" row = amount - (subtotal - discount + delivery) when it is not 0.

**M3 (S1+S3) Continuation pages carry no page number and no invoice/order number.** The 45-line customer invoice is 4 pages (rows 10/13/13/9 in Arabic, 10/14/14/7 in
English) and the admin one 2 pages (19 + 26 rows); pages 2-4 hold only the repeated table header and rows (`pub/s3.ar.p12.png`, `pub/s3.ar.p34.png`, `pub/s3.en.p14.png`,
`admin/s3.admin.ar.png`). A loose page cannot be matched to its invoice.
Fix: add to both print blocks `@page { margin:14mm 14mm 18mm; @bottom-center { content: counter(page) " / " counter(pages); font: 9pt sans-serif } }` (verified
working in this Chromium 153 PDF: "Page 1 / 10"...) and put the invoice/order number in the repeated `<thead>` as a first row.

**M4 (S1+S2) Old orders print "Subtotal 0.000, Delivery 0.000" above a total of 36.750.** `Invoice.jsx:91` `inv.subtotal != null ? Number(...) : lineSum` accepts 0, but orders placed before
the subtotal column hold 0. Scenario s9 (`pub/s9-old-no-subtotal.en.390.png`). The admin sheet already handles it (`money().plain`).
Fix: `Invoice.jsx`: treat `subtotal <= 0` as "unknown", use `lineSum` and hide the Subtotal/Delivery rows when it is 0.

**M5 (S1) No invoice number: the customer's document is "Order number SP4KQ7X9MA2B"; the same sale is "INV-000123" on the admin sheet.** The accountant files the
INV- number, the customer holds the order number. `?r=invoice` does not send the order id, so the page cannot print `INV-`. Scenario s1 `pub/s1-one-knet.en.print-1.png` vs
`admin/s1-one-knet.sheet-en.adminEN.1280.png`.
Fix: `api.php` invoice answer add `'invoice_no' => sprintf('INV-%06d', $o['id'])` (same rule as `invNo()`); `Invoice.jsx` header print "Invoice no." beside "Order number".

**M6 (S1) The saved PDF is named "Invoice — Sporta.pdf" / "فاتورة — سبورتا.pdf" (the `<title>`), the same for every order.** `Invoice.jsx:51` sets the title before
the data loads and never puts the number in it. Measured `document.title` in all 20 customer renders. The admin sheet is right: the title becomes `INV-004600` while the
print window is open and goes back to "Sporta admin" afterwards (measured on 9 sheets).
Fix: `Invoice.jsx`: `usePageMeta({ title: state.data ? `${t.invoice.title} ${state.data.track_id}` : t.invoice.title, ... })`.

**M7 (S1+S3) Seller block is thin and different on the two documents.** Customer: "Sporta Sports Wear · Kuwait · Licence 30199/2023", footer www + cs@ - no street address, no phone/WhatsApp.
Admin sheet: the text "SPORTA", "Sports Wear · www.sporta.com.kw" (English even on the Arabic sheet), no licence number, no e-mail, no address, no phone, no "no VAT" sentence, **no logo**.
`admin/s1-one-knet.sheet-ar.adminEN.1280.png`. The logo file is fine for print: `pdfimages` shows `logo.png` 400x123 at 323 x 328 ppi in the PDF.
Fix: `buildDoc()` header: `<img src="/logo.png" width="117" height="36" alt="Sporta">` (black wordmark, print-safe) and one seller block from the same strings as
`translations.js invoice.seller / taxNote` plus phone, address, e-mail; add a returns line ("exchange within 14 days", matches `/returns`).

**M8 (S3) Bidi and edge alignment on the Arabic sheet.** (a) The phone is `"الهاتف: +965 9876 5432"` as one string in one `dir=ltr` block: it renders `5432 9876 965+ :الهاتف`
(groups reversed; a non-Kuwaiti number "+9659999999999" shows its plus detached from the digits) - the exact bug `lib/bidi.js` documents. (b) Every LTR value (order no., Payment ID,
reference, phone) has `dir=ltr` on the BLOCK, so in Arabic it hugs the left while its label sits at the right (`admin/crop-s1-ar-meta-bill.png`, `admin/crop-s4-phone390.png`).
(c) The address is one concatenated string with Latin labels and Arabic values: on the English sheet a 200+ character Arabic address scrambles ("Area:" lands after the Arabic,
"Block:" ends line 1 and its "12" starts line 2): `admin/s4.admin.ar-en.png`.
Fix: ADMIN INVOICES `metaCell()` put `dir=ltr` on an inner `<bdi>`, keep the block's direction; phone as `label` + `<bdi dir="ltr">value</bdi>`; `addressLines()` return one
`<bdi>` per part (build nodes, not a joined string).

**M9 (S3) On a 390 px preview the item column is 57 px wide and a long Arabic name takes 21 lines, broken inside words ("للتدري/ب").** `.sinv-doc` has no minimum width, the four
numeric columns are `nowrap` (51/44/70/62 px) and `td{overflow-wrap:anywhere}`. docW 332 px; at 768 px the column is 433 px and the name takes 3 lines. `admin/s4-long-names-address.sheet-ar.adminEN.390.png`, `admin-col.mjs`.
Fix: `.sinv-doc{min-width:34rem}` (the wrapper `.sinv-paper-wrap` is already `overflow-x:auto`, so the phone scrolls the sheet like paper) and `td:first-child{overflow-wrap:break-word}`.

**M10 (S3) Refunded and cancelled orders print as if open.** Refunded: the sheet shows the badge "Refunded" but the full total and no refunded amount (the admin `orders` route does
not select `refunded_amount`, `admin.php:1272-1281`). Cancelled COD: two badges, "To be paid on delivery" and "Order cancelled", and the LIST pill ignores cancellation (INV-004900 shows
"To be paid on delivery"). `admin/s5-refunded-knet.sheet-en.adminEN.390.png`, `admin/s8-cancelled-cod.sheet-en.adminEN.390.png`, `admin/list.adminAR.390.png`.
Fix: `admin.php orders` add `refunded_amount`; `stateKey()` return 'cancelled' when `fulfilment_status==='cancelled'`; `buildDoc()` add "Refunded -X / Net".

**M11 (S4) The invoices CSV writes dates as "18 Nov 2026 12:27" (English month names).** A spreadsheet in an Arabic locale will not parse or sort them. `admin/invoices.csv`.
Fix: `CSV` array: `Date (Kuwait)` / `Paid on (Kuwait)` as `YYYY-MM-DD HH:MM` (a `isoKw()` next to `when()`).

**M12 (S4/S5) The CSVs lack what an accountant reconciles with.** Invoices CSV: no refunded amount (a refunded order is a normal row with its full total and `refunded` in the status
column), no discount CODE (only the amount; the sheet shows it), no governorate/area, no lines; an old order reads `Subtotal 0.000, Total 36.750` with an empty "Checked" (by design, never flagged).
The compiled Orders export (`src/admin/api.js toCsv`, `admin/orders-export.csv`) writes `created_at`/`paid_at` as raw UTC with no zone label, `amount` only (no subtotal, discount,
delivery), the raw governorate slug, and a phone typed in Arabic digits as typed.
Fix: invoices CSV add `Discount code`, `Refunded KWD` (needs M10's field); `toCsv` add `subtotal, discount_amount, delivery_fee, discount_code` (already returned by the route) and a Kuwait-time column.

### LOW

**L1 (S1) Free delivery prints "KWD 0.000" / "0.000 د.ك."**; the admin sheet says "Free" / "مجاني". Fix `Invoice.jsx` delivery row.
**L2 (S1) Digit systems: the Arabic seller line uses Arabic-Indic digits ("ترخيص ٣٠١٩٩/٢٠٢٣", 9 characters) while every other figure is Latin** (measured: 9 Arabic-Indic vs 59-70 Latin per print; the site footer writes 30199/2023).
Fix `translations.js` `invoice.seller` (ar). Data typed by shoppers or the catalogue ("٩٠", "قطعة ٤") also appears beside Latin money (scenario s2 `pub/s2-twelve-cod-discount-free.ar.1280.png`): normalise digits when the order is written, not when it is printed.
**L3 (S1) Palette.** The grand total is #A33B0A (hue 19, 6.59:1), a third orange - neither the logo #FF7B17 nor the small-text step #B34D00 (5.28:1) - and it stays #A33B0A with the live add-ons (`pub-addons/`).
Status colours are emerald (#004F3B on #D0FAE5), amber/brown (#7B3306 on #FEF3C6) and the discount line emerald (#007A55). No red. Fix `index.css`: `.invoice .text-accent{color:#B34D00}` (or black),
badge = black text with a 1.5 px black outline as the admin sheet does, discount in black with a minus sign.
**L4 (S1) The bank's Payment ID and reference are not printed** although the full answer carries `receipt` (`api.php:758`, `Invoice.jsx` never reads it). The admin sheet prints both. Fix: render `inv.receipt?.payment_id / reference` in the Payment block (LTR `<bdi>`).
**L5 (S1+data) A sale-price line shows only the price paid** ("KWD 19.950"), no list price, no struck-through, no saving (scenario s6). `order_items` stores only `unit_price` (`install.mysql.sql:109-122`), so this is data, not CSS. Fix = a `list_price` column (migration, owner decision), then one muted struck-through span in the unit-price cell.
**L6 (S3) Money format differs between surfaces:** admin `1141.299 د.ك` (no grouping, no final dot), customer `1,141.299 د.ك.`, receipt `26.500 د.ك`, list summary "1728.283 KWD". Fix: one `kwd()` with grouping in the admin block and one currency spelling ("د.ك.").
**L7 (S3) Print type:** labels and table heads are 11 px = **8.25 pt** (13-14 elements per sheet under 9 pt); body is 9.75 pt. Customer invoice minimum is 9.47 pt (en) / 10.26 pt (ar). Fix `.sinv-d-k, .sinv-d-tab th{font-size:.75rem}`.
**L8 (S3) List screen:** "INV-004800" breaks after the hyphen when the "Check" pill is present at 1280 (`admin/list.en.1280.png`); the Check pill and the failed pill are rose (#BE123C on #FDE8EE, 5.37:1) and the primary buttons rust #9A452C (hue 15) against the no-red/no-brown rule (the admin keeps its own colours by owner decision, `BACKENDS-SCAN-2026-11-18.md`; none of it prints); the "Total" in the summary counts refunded, unpaid and cancelled orders (1728.283 vs paid 1312.544). Fix `.sinv-no{white-space:nowrap}`.
**L9 (S4) CSV file name uses the browser's local date, not Kuwait's** (`exportCsv()`: `now.getFullYear()...`). Fix: use `kuwait(new Date())`.
**L10 (S6) The receipt box wraps an 18-digit Payment ID mid-number on a 390 px phone** ("1002026312312345 / 67", `rcpt/paid.ar.390.png`). Fix in the PAYMENT RECEIPT CSS: at <=420 px stack `dt` over `dd`.
**L11 (S6) The receipt box has no print rules:** Ctrl+P prints its action buttons (an orange "View invoice" button, `print-color-adjust:exact` from the app's print block). Fix: `@media print{.sprc__acts{display:none}}`.
**L12 (S7) Warehouse e-mail banners are dark red #7F1D1D (AWAITING, FAILED, CANCELLED, hue 0), rust #7C2D12 (COLLECT CASH, hue 15) and green #14532D** (contrast 9.1-10.0:1, fine), against the "no red" rule; the address prints the raw slug "mubarak-al-kabeer", the phone as `+96598765432`, and an Arabic name sits in an LTR block with no `dir`. `mail/new-cod-pending.png`. Fix `cron-fulfilment.php`: banners black with an orange (#FF7B17) edge for hold/cancel, the governorate name map, `dir="auto"` on the name.
**L13 (S1) A 12-line invoice takes 2 pages (10 rows + 2) because each row is 3-4 lines** (Arabic name, English name, size/fit). Fix `Invoice.jsx` row: put size/fit on the English-name line (`print:py-1`).
**L14 (S1) On a phone the floating "Sporta AI" bubble covers the first amount** (`pub/s4-long-names-address.ar.390.png`, `pub/s1-one-knet.ar.390.png`); it is hidden in print. Fix: the Assistant already has `print:hidden`; add bottom padding to `.invoice` on screens < 640 px.

### INFO

**I1** No QR code on any document. Not required in Kuwait (no VAT, no e-invoicing mandate); a QR to `/invoice/<id>` or `/track` would let a printed copy be checked.
**I2** The invoice number is read from the order id (INV-000123), not allocated: a cancelled or failed order leaves a gap. The code already says so (owner decision pending).
**I3** The receipt box is the only surface that labels the zone ("بتوقيت الكويت") and it carries no red (a failed bank result uses the orange disc; the file's header comment says "rose").

## 4. Measurements table

| Item | Customer invoice (S1) | Admin sheet (S3) |
|---|---|---|
| Paper / margins (A4, `page.pdf`) | 595.9 x 842.9 pt; text 13.9 / 14.0 mm left / right, 12.7-13.2 mm top | 595 x 841.9 pt; 14.0 / 13.8 mm, 13.0 mm top |
| 1 line | 1 page, last text 160-166 mm | 1 page |
| 12 lines | **2 pages** (10 + 2 rows), header on both | 1 page (12 rows) |
| 45 lines | **4 pages**, header on all 4, totals only on page 4, no row split, no orphan totals | **2 pages** (19 + 26), header on both, totals page 2, no row split |
| Long EN name (117 chars) / long AR name | wraps in the item column, 1 page | wraps in print; at 390 px: 57 px column, 21 lines (M9) |
| Long AR address / note (max column lengths, ~220 chars) | wraps, no overflow (full invoice) | wraps; scrambles on the English sheet (M8c) |
| Overflow / clipping | 0 of 40 screen renders | 0 of 54 screen renders (the 390 sheet crushes instead, M9) |
| Min print font | 9.47 pt en / 10.26 pt ar | **8.25 pt** labels, 9.75 pt body |
| Text below 4.5:1 | 0 | 0 |
| Ink (non-white pixels, 50 dpi render) | 3.5-4.9 % (1 page), 5.9-7.9 % (full page); identical with/without "background graphics" (`print-color-adjust:exact`) | 3.4-4.6 % (1 page), 6.7-10.6 % (full); 0 coloured boxes, nothing to lose without backgrounds |
| Dark theme print | paper white (mean luminance 98 %), black logo; `pub/dark.ar.print.pdf` | n/a (sheet is always white) |
| Logo | `logo.png` 400x123 at 323 x 328 ppi: crisp | none (text "SPORTA") |
| Colours in print | #0F172B, #314158, #45556C greys, #A33B0A total, emerald/amber badge | black and greys only |
| Red / rose / brown | none; brown-orange #A33B0A and #7B3306 (L3) | none in the sheet; rose in the list (L8) |
| Save-as-PDF name | `Invoice — Sporta.pdf` (M6) | `INV-000123.pdf` (title swap, restored) |
| Admin chrome in print | n/a (`.app-header/.app-footer/.no-print` hidden, measured) | dialog header `display:none`, `#root` `display:none`, body white |
| Date | UTC value, no zone (H3) | Kuwait UTC+3, no zone label |

## 5. What looked right

1. No sideways scroll, clipping or page error in any of the 94 screen renders at 390 and 1280, Arabic and English.
2. A4 with 14 mm margins on both documents, measured from the PDFs.
3. A table row is never split across a page (45-line test, both documents); the header repeats on every page; the totals print once, after the last row, with the rows before them (no orphan).
4. The customer print is white paper even in the dark theme; backgrounds survive "background graphics off" (identical pixel statistics).
5. Black wordmark on white for print (the white logo is screen-dark only); the PNG is 323 ppi in the PDF.
6. The admin print isolates the sheet (dialog header and `#root` hidden, no backgrounds) and names the file `INV-<6 digits>`; the title is restored afterwards.
7. Customer invoice text >= 9.47 pt and 0 contrast failures; 3-decimal KWD everywhere; line totals exact (39.995 x 2 = 79.990); thousands grouping on the customer page.
8. Money keeps Latin digits in both languages on both documents (the one exception is L2).
9. RTL done properly on the customer page: mirrored table, logical alignment, isolated order number (`SP4KQ7X9MA2B` reads correctly in Arabic), names carry their own direction, Arabic comma separators, "Sharq، العاصمة" order.
10. Admin dates are Kuwait time (an order at 22:00 UTC on 31 Oct is 1 Nov 01:00; 21:47 UTC shows 00:47 next day).
11. Admin money is added in whole fils; the "Check" mark, "Free" delivery and the plain total for an old order work.
12. The admin sheet is black and white with an outlined badge: cheapest ink and nothing disappears when backgrounds are off.
13. The admin "Print" waits for the items to load; a CSV starts with a BOM, uses CRLF, quotes every cell and writes a cell that begins with `=` or `+` as text (checked in the file).
14. The customer invoice leaves out the phone and (without proof) the street by design; the order number cannot be guessed (10+ characters).
15. The customer page shows the licence number, the no-VAT sentence, www and cs@.
16. The admin list passes 44 px targets (0 under 44 at 390), contrast and no overflow in both admin languages.
17. The receipt box shows the Kuwait-time label, the bank fields in LTR runs and orange-only tones; 9.75 pt minimum, no overflow.
18. Fit labels (Slim fit, Oversize) and size print on the customer lines in both languages.
19. Both languages keep tabular numerals in English columns (rows align to 0.0 px).
20. The customer print button, links and header are `no-print`; the Assistant bubble is `print:hidden` (not in any PDF).
21. A discount row shows the code or label in its own direction ("الخصم · عرض العيد Eid offer 10%"), with the sign inside the figure.

## 6. What a Kuwaiti retailer's invoice normally carries, and what is missing

| Element | Customer invoice | Admin sheet |
|---|---|---|
| Shop name | "Sporta Sports Wear" (text + logo) | "SPORTA" text, **no logo**, English only |
| Commercial licence | **yes** (30199/2023) | **no** |
| Street address | no | no |
| Phone / WhatsApp | no | no |
| E-mail | cs@sporta.com.kw | no |
| Web | www.sporta.com.kw | www.sporta.com.kw |
| Invoice number | **no** (order number only) | INV-000123 |
| Date in Kuwait time | **no** (UTC digits, H3) | yes (no zone label) |
| Buyer name / phone / address | name + address only with a proof key (H2); never phone | name, phone, full address |
| Payment method, state | yes; **wrong for refunded/cancelled (H1)** | yes; refund/cancel poorly shown (M10) |
| Bank Payment ID / reference | no | yes |
| VAT line | none, with the sentence "Kuwait does not charge VAT" | none, no sentence |
| Page x of y / number on every page | no | no |
| QR | no | no |
| Returns/exchange line | no | no |
| Gap-free tax-invoice sequence | no (owner decision, I2) | no |

## 7. Smallest fixes by file (for the next release)

* `src/pages/Invoice.jsx` and `src/i18n/translations.js`: H1, H2, M1, M2, M4, M5, M6, M7, L1, L2, L4, L13.
* `src/lib/bidi.js` `stamp()`: H3. `src/styles/index.css` (print block, `.text-accent` in `.invoice`): M3, L3.
* `dropin/php-store/api.php` `?r=invoice`: `refunded_amount`, `invoice_no` (H1, M5). `admin.php orders`: `refunded_amount` (M10, M12).
* `public/sporta-admin-brands.js` ADMIN INVOICES (both names): H4, M1, M2, M3, M7, M8, M9, M10, M11, M12, L6, L7, L8, L9.
* `public/sporta-features.js` PAYMENT RECEIPT: L10, L11. `dropin/php-store/cron-fulfilment.php`: L12. `src/admin/api.js toCsv`: M12.

## 8. Evidence index (all under SCAN/)

* Customer invoice, screen: `pub/<scenario>.<ar|en>.<390|1280>.png` (390 for all ten; 1280 for s1, s2, s4, s5, s9). Scenarios: `s1-one-knet`, `s2-twelve-cod-discount-free`, `s3-f45-tpay`, `s4-long-names-address`, `s5-refunded-knet`, `s6-sale-price`, `s7-mismatch-check`, `s8-cancelled-cod`, `s9-old-no-subtotal`, `s10-limited-public`.
* Customer invoice, print: `pub/<scenario>.<ar|en>.pdf` (+ `.nobg.pdf` = background graphics off), page renders `pub/<scenario>.<lang>.print-<n>.png`, montages `pub/s3.ar.p12.png`, `pub/s3.ar.p34.png`, `pub/s3.en.p14.png`, `pub/s5-bg-vs-nobg.png`, zooms `pub/crop-s1ar-1.png`, `pub/zoom-disc-2.png`, `pub/crop-s2-p2.png`; dark theme `pub/dark.ar.390.png`, `pub/dark.en.390.png`, `pub/dark.<lang>.print.pdf`; live add-ons on top `pub-addons/`.
* Admin sheet: `admin/<scenario>.sheet-<ar|en>.adminEN.<390|1280>.png`, `admin/<scenario>.sheet-ar.adminAR.1280.png`, PDFs `admin/<scenario>.sheet-<lang>.pdf` and `.bg.pdf`, page renders `admin/<scenario>.sheet-<lang>.print-<n>.png`, montages `admin/s3.admin.ar.png`, `admin/s4.admin.ar-en.png`, crops `admin/crop-s1-ar-meta-bill.png`, `admin/crop-s4-phone390.png`.
* Admin list: `admin/list.en.1280.png`, `admin/list.adminEN.390.png`, `admin/list.adminAR.390.png`, `admin/list.adminEN.1280.png`, `admin/list.adminAR.1280.png`.
* CSV: `admin/invoices.csv` (S4), `admin/orders-export.csv` (S5).
* Receipt box: `rcpt/<paid|refunded|declined>.<ar|en>.<390|1280>.png` and `.pdf`. Warehouse e-mail: `mail/<kind>.html|.txt|.390.png|.640.png`, `mail/new-cod-pending.png`.
* Numbers: `pub-results.json`, `pub-results-addons.json`, `admin-results.json`, `rcpt-results.json`, `pub-pdfscan.json`, `admin-pdfscan.json`, `mail/results.json`. Scripts: `scen.mjs` (scenarios), `probe.mjs` (in-page measurements), `pub-run.mjs`, `admin-run.mjs`, `admin-list.mjs`, `admin-col.mjs`, `rcpt-run.mjs`, `mail.php`, `mail-run.mjs`, `tz-run.mjs`, `dark-run.mjs`, `pdfscan.py`, `tocsv.mjs`.

## 9. Limits

Not measured: the live `/invoice` page (a foreign build), the live `@@time_zone`, a real printer or the browser's own print dialog (headers/footers option; I used `page.pdf`), Safari and Firefox,
the compiled admin's own Orders screen (only its CSV code), and real fonts on the admin sheet (system-ui). The receipt box was run on the repo's fixture of the compiled page, not the page itself.
