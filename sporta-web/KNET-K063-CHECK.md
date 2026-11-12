# KNET manual K-063 compared with Sporta: full check

**Manual:** KNET "KPAY MANUAL FOR MERCHANTS", Doc K-063 v1.3 (09 Sep 2021), 65 PDF pages. **Checked:** 2026-11-12. This was a read-only check, and no file or server was changed.

**Page references:** "doc p." means the manual's own page number. PDF page = doc page + 3.

**What the manual covers:** K-063 covers the KPay **merchant portal**: logging on, users and roles, batch upload, refund and void, reports, K-Link payment links and notifications. It is **not** the Tranportal message spec. That spec is K-064, so this check does not cover the message format.

**Live state on the day of the check:** env=test. The Tranportal ID, password and resource key are still placeholders, so no card payment works yet.

---

## 1. Verdict

- **Sporta is compatible with what K-063 describes, but card payments are not live yet.** Nothing in K-063 conflicts with how Sporta takes KNET payments. Sporta needs only a Tranportal ID, a password and a 16-character key for each environment (test and production). It needs no plug-in or KeyStore. It sends KWD amounts with 3 decimals and stores the bank's Payment ID (A6, B7, D6, D18).
- **Blocking the first test payment: the real test credentials.**
  - Copy the Tranportal ID from your KPay profile (A3).
  - Ask KNET/CBK where the password and the 16-character key come from (A4).
  - Enter all three in /backends.
  - Do not use `set-knet.sh` yet. It writes to a copy of the settings that the shop never reads (A1).
- **Blocking production: KNET certification.** The repo's notes on K-064 say the payment result page must show receipt fields. Sporta's result page does not show them yet (D1, D5).
- **Needed before real customers pay: a refund routine and a daily check against KPay.** Today:
  - A refund made in KPay leaves the order "paid" in the shop (B1).
  - A paid order that has not shipped cannot be stopped in the shop (B2).
  - A second charge on the same order raises no alert (B3).
  - There is no written daily check (C2).

  Until the code is fixed, section 2 is that routine.

---

## 2. What you do in the KPay portal

Do everything on **test** first. Repeat the marked steps for **production** after the bank approves.

### A. Log on (test)

1. Open the Login URL from your own KPay welcome e-mail. The manual's sample shows the test portal `https://kpaytest.com.kw/knetpg/merchant.htm`, but use the address in your e-mail. Log on with Institution ID, Merchant ID, User ID, password and the captcha. *(§1.2 doc p.2; Fig. 5 doc p.5)*
2. The password link in a welcome or reset e-mail expires after **1 hour**. If it lapses, the password has to be regenerated and sent again (Merchant Process > Resend Password). *(Fig. 5 doc p.5; Fig. 12 doc p.19; §2.4 doc p.21-22; Fig. 17 doc p.23)*
3. On your first logon the portal makes you change your password. Then you log on again. *(§1.2 Note doc p.3; §1.4 doc p.6)*

### B. Passwords and recovery

4. Each portal user has **two** passwords: a **logon** password and a **profile** password. Both are changed on one screen. *(§1.4 doc p.6-7)*
   - Length: 7 to 15 characters, using letters and digits.
   - Special characters: only ! @ # $ are allowed.
   - Reuse: the manual says "Same password re-occurance is 5", which most likely means you cannot reuse your last 5 passwords. *(Fig. 6 doc p.7)*
   - The manual recommends changing them often. *(§1.4 doc p.6)*
5. These portal passwords are **not** the Tranportal password the shop needs. Never type a portal password into /backends. *(A5)*
6. Set real answers to the three security questions under My Accounts > Security Questions. The manual's sample answers "hello" to all three, so do not copy it. *(§1.5 doc p.8-9)*
7. To recover a password you need:
   - your Institution ID, Merchant ID and User ID;
   - the captcha;
   - a security answer;
   - your registered e-mail address, because the reset link goes there.

   So keep that mailbox secure. Someone who controls it and knows the security answer can reset your portal password. The recovery screen also has a "Forgot Answer" link that the manual does not explain. *(§1.3 doc p.3-4; A10)*

### C. Check your shop's details (Merchant Profile)

8. Open **My Accounts > Accounts**. This is the Merchant Profile. The bank fills it in and you can only read it. *(§1.6 doc p.9)*
9. In the terminal table, find the row for test terminal **626101**. Copy the value in the **Tranportal ID** column exactly as shown.
   - It can differ from the Terminal ID. In the manual's sample, terminal 12313 has Tranportal ID 234.
   - It can contain letters or a leading zero, for example "tran89000" or "01062017".

   *(§1.6 Fig. 8 and field table doc p.10-11; A3, A2)*
10. On the same row, check:
    - Status is **Active**.
    - Accepted Currency includes **KWD (414)**.
    - Write down the Risk Profile and the Cut Over Time.

    *(Fig. 8 doc p.10-12; A8)*
11. In the merchant part of the profile, check:
    - Website Address is exactly `https://www.sporta.com.kw`.
    - Contact E-mail is a business mailbox you read.

    If anything is wrong, ask the bank to correct it. You cannot edit the profile yourself. *(§1.6 doc p.9-12; A8)*

### D. The Tranportal password and the 16-character key

12. K-063 never says where the **Tranportal password** and the **16-character resource key** come from.
    - It mentions only downloading a "plug-in, KeyStore file, and resource file" *(§1.1 doc p.1)* and the menus Plugin Download and Resource File Download *(Fig. 10 doc p.15)*.
    - Ask KNET/CBK in writing where these two are delivered: in the letter, on a portal screen, or inside the resource file. Item 32 has the full list of questions.
    - Sporta does not use the plug-in or the KeyStore. *(A4)*
13. Enter the **test** ID, password and key in **/backends → Payments → KNET**.
    - Do **not** use `ops/knet/set-knet.sh` until A1 is fixed. It writes to a copy of the settings the shop never reads. It still prints "ok", but card payments keep failing. *(A1)*
    - After entering the values, ask for the read-only KNET scan. Then make a **0.100 KWD** test payment and check that /backends shows the order as paid. *(A11)*

### E. Users and roles

14. Create the roles **before** the users, and name them carefully.
    - Roles cannot be deleted. *(§2.2 doc p.13)* Only a role's name and description can be changed later. *(§2.2.3 doc p.16)*
    - User IDs cannot be deleted either. *(§2.3 doc p.16)*
15. Suggested roles *(A9)*. Menus are ticked per role, and you save the change by clicking **Back** *(§2.2.2 Fig. 10 doc p.14-16)*.
    - **OWNER-ADMIN** (you only): every menu.
    - **RECONCILE-READONLY**:
      - Allowed: Order List, Posted Transaction, Batch Report, the report menus, Change Password, Security Questions.
      - Not allowed: Enter Transaction, Authorization, Batch Upload, the download menus, and user administration.
    - **REFUNDS**: only if someone other than you will do refunds.
16. Give each person their own user ID. The Add User form asks for:
    - name and user ID;
    - role;
    - e-mail and a 10-digit mobile number;
    - work hours;
    - an optional expiry after a number of inactive days.

    When someone leaves, set them **Inactive** or **Block User** the same day. *(§2.3.1 doc p.17-18; §2.3.2 doc p.19-20)*
17. Whoever confirms card orders by hand in /backends needs a portal logon, because /backends asks for the bank's Payment ID. *(A9)*

### F. Before the first test payment

18. A test payment creates a **real order**.
    - It counts as paid revenue and cannot be cancelled once it is paid.
    - The warehouse e-mails for it are queued even while `warehouse_email` is empty, and they are sent as soon as it is set.
    - So either tell the warehouse in advance which test order numbers to ignore, or set `warehouse_email` to your own mailbox during testing and switch it back afterwards.
    - Do not just leave `warehouse_email` empty: the e-mails would only wait. *(B11, C8)*
19. Use one agreed test product and one test customer name. Write down each test order number and its Payment ID. *(B11, C8)*

### G. On the first test payment: learn the reports

20. Open **Reports > Transaction Reports > Transaction Detail Report**. Choose terminal 626101, Download Type **CSV** and View Type **Extend View**. Write down: *(§5.1 doc p.37-40; §5.2 doc p.40-43; C9)*
    - the time zone of "Transaction Date And Time";
    - whether today's rows are under **Current** or **History**;
    - the Result Code text for a success, a decline and a cancel;
    - the Action values;
    - whether the "Order ID" in the Order Detail report is the same as the Payment ID.
21. Open **Reports > List Reports** to see which list reports your account has. *(§5.4 doc p.44; C9)*
22. Note whether KNET sent an SMS or e-mail to you and to the customer, and how your shop name and contacts appear in it. *(§6.2 step 11 doc p.53; §6.3 doc p.54-55; D16)*
23. Check whether the portal can find a website payment by **UDF5**. Sporta puts the plain order number in UDF5. *(§6.2 note doc p.48; D4)*

### H. Refund or void (until the shop can record it)

24. **Before** you refund a paid order that has **not shipped**, tell the warehouse yourself not to ship it. The shop cannot cancel a paid order and does not send the warehouse a "cancel" message. *(B2)*
25. Find the payment in one of two ways.
    - **Transaction > Posted Transactions** *(§4.1 Fig. 23 doc p.30-31)*:
      - Terminal ID ("ALL" works). *(B13)*
      - Merchant Track ID.
      - Authorization Code.
      - Amount in the form NNNNN.NNN.
      - A start and end date-time. Search from the day before to the day after, because /backends shows times in UTC. *(B15)*
    - **Transaction > Order List** *(§4.2 Fig. 25-27 doc p.34-36)*: set Order Status to **PROCESSED**, then click the **Payment ID**.

    A retried payment has the Merchant Track ID `<order number>A2`, `A3` and so on, up to `A10`. Search for those as well, or use the Order List route. *(D4, B4, C1)*
26. Choose **Credit** (refund) or **Void**. For a partial refund, change the amount before you click Process. The manual does not say how long Void stays available, so ask the bank (item 32). *(§4.1 steps 4-6 doc p.32; §4.2 step 3 and Note doc p.36; B12)*
27. Afterwards, in /backends:
    - add a CRM note on the customer (orders have no staff-note field);
    - put the units back as a stock adjustment of type **"return"**;
    - tell the customer.

    The order will still show "paid" and still count in revenue until the code change B1 is built. *(B1, B2, B10)*

### I. Daily check (reconciliation)

28. Each day, run the **Transaction Detail Report** for your terminal (CSV, Extend View).
    - For each **CAPTURED** row, find the matching order and check the amount, and that the order is "paid". *(§5.1 doc p.39-40; C2)*
    - The Merchant Track ID is either the order number itself, or the order number followed by A2 to A10 for a retry.
    - If it is not an exact order number, search /backends for it without the final "A" and digits. The search matches part of an order number. Then check that the amount and the date fit.
    - Do not just assume a retry. An order number can itself end in "A" and a digit. *(C1, C4)*
29. **Two CAPTURED rows for one order** means the customer was charged twice. Refund one of them (section H). Sporta does not flag this today. *(B3, C1)*
30. For every card order still "pending" or "review" in /backends, look it up in KPay by its Merchant Track ID(s).
    - If KPay shows it CAPTURED, settle it in /backends.
    - **Before** you type the Payment ID, check in the Order Detail or Transaction Detail report that the Merchant Track ID, the amount, the CAPTURED result and the terminal all belong to this order. /backends does not check this for you. *(C2, C5, C6)*
31. Compare the **Transaction Summary** report's success count and amount with Sporta's KNET paid total for the same day. Two things to know: Sporta's revenue figure mixes all payment methods, and it counts days in UTC. *(§5.1 Fig. 29 doc p.38; C2, C7, C14)*

### J. Ask KNET/CBK in writing (one e-mail, sent with the test setup)

32. Questions:
    1. Where are the Tranportal password and the 16-character resource key delivered? *(A4)*
    2. When is Void allowed, and when is Credit needed? *(B12)*
    3. How long does a Credit take to reach the customer's card? *(B12)*
    4. Are there limits on partial credits (number or total)? *(B12)*
    5. Is a refund or void done in the portal sent to our responseURL? *(B12)*
    6. Is "Order ID" (Order List) the same value as "Payment ID"? What does the "Order Notify" column mean? *(B12, C9)*
    7. Can Credit and Void be given to a role separately from viewing Order List and Posted Transaction? *(B12)*
    8. Do we ever need the portal's **Capture** button for purchase (action 1) payments? *(B16)*
    9. Which report shows the settlement credited to our bank account? *(C9)*
    10. Which receipt fields does certification require (K-064 §9.4)? Are there branding or wording rules for our result page? Please send the current K-064 and the certification checklist. *(D5, D17)*
    11. Only if we want them:
        - the credit-row format for refunds through Batch Upload *(B14)*;
        - enabling Accept Payments (K-Link) on our terminals *(D14)*.

### K. Production (after the bank approves)

33. Repeat section C (items 8-11) for the production terminal.
34. Enter the **production** ID, password and key in /backends. They must differ from the test values: /backends refuses identical values. *(A7)*
35. Write down the date and time of the switch, in KNET.md and in the payment log, so that daily checks start at the first production payment. *(C8)*
36. Repeat section G on the production terminal. *(C9)*

---

## 3. Findings

**How to read the table**

- **Kind:** risk, gap, doc or owner-action.
- **Severity:** sorted high, then medium, low and info.
- **†** means verification corrected part of the original claim. Section 6 lists each correction.
- The "ok" items are in section 5, not in this table.

**Paths** are relative to `sporta-web/`, with these short forms:

| Short form | Full path |
|---|---|
| `knet/` | `dropin/php-knet/` |
| `store/` | `dropin/php-store/` |
| `cbk/` | `dropin/php-cbk/` |
| `brands.js` | `public/sporta-admin-brands.js` |
| `set-knet.sh` | `ops/knet/set-knet.sh` |
| `../KNET.md`, `../VPS-SCAN-2026-10-31.md`, `../CLAUDE.md` | files at the repo root |

| id | kind | severity | finding | manual ref | code ref | recommendation |
|---|---|---|---|---|---|---|
| A1 | risk | high | `set-knet.sh` edits `private/knet-config.php`, a stray copy. The shop reads `private/config/knet-config.php` (mounted at /run/sporta-config/). If the stray exists, the script prints "ok" while the live file keeps its placeholders and pay.php keeps answering 503. If the stray was deleted, the script stops. Each run leaves `.bak-*` copies of the secrets. knet-scan may check the stray instead of the live file. | §1.6 doc p.9-11 (context only) | `set-knet.sh:26-27,31,54,58-60,69-72,109`; `store/config-path.php:13-14,48-55`; `scripts/sec-config-scan.mjs:523,541-547`; `LIVE-SECURITY-SCAN-2026-11-03.md:126-127,285`; `scripts/knet-scan.mjs:157-166`; `knet/knet.php:80-98`; `knet/pay.php:136-146` | Point the script at `private/config` (or read the container's /run/sporta-config mount). Refuse to run if both files exist. Delete the stray and its `.bak` files. Make knet-scan read the explicit path. Until then, use the /backends KNET editor. |
| B2† | gap | high | After a refund or void in KPay, a paid order that has not shipped cannot be stopped. Cancel refuses paid orders (409 `order_paid`). Returns needs "delivered". Only cancel sends the warehouse a "cancel" message. | §4.1 doc p.30-32; §4.2 doc p.36 | `store/admin.php:1312-1328,1363,643-683`; `store/returns.php:45-46,183`; `knet/callback.php:367-378`; `FULFILMENT.md:23-24,77`; `store/crm.mysql.sql:22-30` | Allow a paid card order to be cancelled only together with a recorded refund or void (B1). That cancel sends "cancel" to the warehouse and releases the stock. Until then, follow the runbook (section 2-H). |
| B3 | gap | high | A second CAPTURED callback for an already-paid order returns `already_paid`. It does not compare payment IDs, writes nothing and raises no alert; only a log line shows it. An order can be started up to 10 times. The test suite asserts that "nothing changes". This is the same defect as C1, which verification rated medium. | §4.2 doc p.34-36; §4.1 doc p.32 | `knet/knet.php:351,367-376,396-401`; `knet/callback.php:98-104,250-255,341-355`; `scripts/knet-test.mjs:181-186,240-254` | If the payment ID differs from `cbk_paymentid`: log `callback.duplicate_capture`, write a lasting admin alert, and leave the order unchanged. Update knet-test to expect the alert. |
| C2 | doc | high | There is no daily KPay reconciliation runbook. KNET.md names a "KNET settlement report", but K-063 has no report by that name. | §5 doc p.37-44; TOC | `../KNET.md:310-333,322,396-408,421` | Add a "Daily KNET reconciliation" section to KNET.md, following the steps in section 2-I. |
| A3 | doc | medium | The docs call the Tranportal ID a guess, but the KPay Merchant Profile lists it next to the Terminal ID, and the two can differ. | §1.6 doc p.9-11; Fig. 5 doc p.5 | `../KNET.md:222-229`; `knet/config.example.php:19-24`; `CHECKOUT-SECRETS.md:87` | Replace the guess with the portal steps from section 2, item 9. |
| A4 | doc | medium | The docs disagree on where the Tranportal password and the 16-character key come from: the letter or the portal. K-063 mentions neither, only the plug-in, KeyStore and resource-file downloads. | §1.1 doc p.1; Fig. 10 doc p.15 | `CHECKOUT-SECRETS.md:87-89`; `store/preflight.php:263,366,369`; `../KNET.md:186-190,206-209`; `set-knet.sh:47` | Ask KNET/CBK, then make all three docs say the same thing. State that the plug-in and KeyStore are not used. |
| A5 | risk | medium | KPay users have a logon password and a profile password, and nothing warns that neither is the Tranportal password. The live /backends readiness line and its save refusal say "Merchant ID and password", although the check behind them tests the Tranportal ID and password. | §1.2 doc p.2; §1.4 doc p.6-7; Fig. 5 doc p.5 | `scripts/fixtures/admin-payments.mjs:22,29`; `store/admin.php:1136`; `set-knet.sh:46`; `CHECKOUT-SECRETS.md:88`; `../VPS-SCAN-2026-10-31.md:669` | Relabel to "Tranportal ID and password" in brands.js. Add "(not your KPay portal logon or profile password)" to the set-knet.sh prompt, the editor hint and CHECKOUT-SECRETS step 2. |
| A8 | owner-action | medium | Before the first test payment, check the terminal row (Status, Accepted Currency, Risk Profile, Cut Over Time) and the merchant's Website Address and Contact E-mail. The merchant cannot edit the profile. | §1.6 Fig. 8 and table, doc p.9-12 | `knet/pay.php:154`; `knet/config.example.php:35-36`; `../KNET.md:172` | Section 2, items 10-11. |
| A9 | owner-action | medium | Set up least-privilege roles and users. Roles and user IDs can never be deleted. | §2.1-2.3 doc p.13-20 (Fig. 10 p.15); §2.4 doc p.21 | `store/admin.php:1443-1455`; `../KNET.md:403-408` | Section 2, items 14-17. |
| A10 | owner-action | medium | Portal password and recovery hygiene. The repo has no portal runbook. | §1.2-1.5 doc p.2-9; §2.3.1 doc p.17-18; §2.4 doc p.21-23 | (none) | Section 2, items 4-7. The security answer and the "Forgot Answer" path are what protect the account if the registered mailbox is taken over. |
| A11† | doc | medium | There is no KPay portal runbook. The setup docs still describe shared hosting (hPanel File Manager, copying config.php), and none of them names the /backends KNET editor. | §1.2-1.6 and §2, doc p.2-23 | `../KNET.md:258-281`; `CHECKOUT-SECRETS.md:24-26,82-108`; `store/preflight.php:248`; `knet/README.md:22-25` | Add a "KPay merchant portal" section to KNET.md. Rewrite CHECKOUT-SECRETS step 2 for the VPS: the private/config path, then the /backends editor, then the read-only KNET scan, then a 0.100 KWD test payment confirmed as paid. |
| B1† | gap | medium | A refund or void in KPay leaves the order "paid". There is no refunded state, so the order stays in revenue and in the XBRL export. | §4 doc p.30; §4.1 doc p.30-32; §4.2 doc p.32-36 | `store/schema.mysql.sql:59`; `store/admin.php:1169-1196,1397,1409-1415,1494-1501`; `knet/pay.php:152`; `knet/callback.php:250-255`; `store/xbrl.php:33-34` | Add a recorded "Refunded / voided in KPay" action (section 4). |
| B8† | gap | medium | Partial refunds and returns carry no money amount. Returned items are not restocked automatically and nothing links them to a refund. | §4.1 step 5 doc p.32; §4.2 Note doc p.36 | `store/schema.mysql.sql:32`; `store/admin.php:639-642,2319-2324`; `store/returns.php:256-265,350-355` | Use the refunds record from B1, with the amount and a link to the return request. Report revenue as paid minus refunded. |
| B10† | doc | medium | There is no refund or void runbook. FULFILMENT.md sends paid orders to Returns, but Returns refuses orders that have not been delivered. | §4.1 doc p.30-32; §4.2 doc p.32-36 | `FULFILMENT.md:194-196`; `store/admin.php:1312-1318`; `store/returns.php:46,183`; `../KNET.md:236-238,339-341` | Write a one-page runbook (section 2-H). Correct FULFILMENT.md:194-196. |
| B11† | doc | medium | Preflight's "pay with a real card, then refund it", and every test payment, create real paid orders. The warehouse messages are always queued; an empty `warehouse_email` only delays them. | §4.1 doc p.30-32; §4.2 doc p.36 | `store/preflight.php:449,546`; `knet/callback.php:367-378`; `store/store.php:396-407`; `store/api.php:1095`; `store/cron-fulfilment.php:33-36,106-128` | Warn the warehouse, or use your own mailbox during tests. Rewrite the preflight text with the KPay steps and the clean-up in the shop. |
| B12† | owner-action | medium | The refund and void pages leave out the time limits, partial-refund limits, any notification to the merchant, whether Order ID equals Payment ID, and what "Order Notify" means. | §4.1-4.2 doc p.30-36; Fig. 26 doc p.35; §2.2.2 doc p.14-15 | `knet/callback.php:250-255,329-335`; `../KNET.md:177` | Ask the questions in section 2-J. |
| C1† | risk | medium | Same defect as B3. The locked SELECT does not read `cbk_paymentid`, so a duplicate charge is visible only in the log. Removing a trailing "A" plus digits to match orders is unsafe, because an order number can itself end in A and a digit. | §5.1 doc p.39-40 | `knet/callback.php:98-104,237-255`; `knet/knet.php:351,355-401`; `knet/pay.php:101-105,137,160,167`; `src/lib/attempt.js:9-15` | See B3. Match KPay rows against each order's own set of references. |
| C3† | gap | medium | The admin does not return, export or search the Transaction ID, Authorization Code, attempt count or raw bank result. Search covers only the order number, name and phone. | §5.1 doc p.39-40 | `store/admin.php:1199-1209,1225-1233`; `knet/callback.php:257,341-355`; `src/admin/api.js:250-255` | Return and search these fields (section 4). Confirm which KPay column each one matches on the first test payment. |
| C6† | risk | medium | Manual card settlement accepts any 6-60 character "Payment ID" with no duplicate or amount check. It overwrites the callback's payment ID, review reason and raw result. The activity record has no order ID. | §5.2 doc p.40 | `store/admin.php:1448-1516,395-417`; `store/schema.mysql.sql:40`; `store/store.php:1436-1447` | Refuse a Payment ID already stored on another order. Keep the original values. Add the order ID to the activity record (section 4). |
| C7 | gap | medium | Sporta's days are UTC. KPay's report windows state no time zone. The repo admin shows UTC times as if they were local. The database session time zone is never set. | §5.1/§5.2 doc p.38-42 | `knet/callback.php:353`; `store/admin.php:1166-1196,1415,1500`; `src/admin/Orders.jsx:12`; `knet/knet.php:194`; `ops/handoff/DATABASE-COLUMNS-CHECK-2026-11-04.md:102`; `PHP-SCAN-2026-11-03.md:1896` | Find the portal's time zone on the first test payment, then fix the code (section 4). |
| C8† | risk | medium | Test-gateway payments look exactly like real ones in orders, revenue, XBRL and the warehouse flow. No order records which environment it was paid in. | Terminal ID* filter, §5.1-5.2 doc p.38-42 | `store/schema.mysql.sql:29-62`; `knet/callback.php:341-355,367-378`; `store/admin.php:1169-1170`; `store/xbrl.php:33-34`; `knet/pay.php:190`; `set-knet.sh:53-54,91-109` | Record the environment at settlement and leave test orders out of stats and XBRL. Write down the date of the production switch. |
| C9 | owner-action | medium | K-063 does not list the Action, Result Code or Order Status values, or say which report shows the money credited to the merchant. | §5.1 doc p.37-40; §5.2 doc p.40-43; §5.4 doc p.44 | `knet/callback.php:76-104,341-355`; `knet/pay.php:181-192` | Section 2-G. |
| C10 | gap | medium | Refunds and voids made in the portal leave no trace in Sporta, so Sporta's totals cannot match KPay's. | §5.1 doc p.39; §5.3 doc p.43-44; §4 doc p.30-36 | `store/schema.mysql.sql:59`; `store/returns.mysql.sql:16-17`; `store/admin.php:640-642,1166-1196`; `../KNET.md:177,236-239,339-341` | Same fix as B1. Include non-purchase Actions in the daily check. |
| C11† | gap | medium | `callback.db_write_failed` and `callback.review` go only to the log. knet-scan counts them but does not warn about them, and it never pairs payment attempts with bank callbacks for each order. | §5.1 doc p.40 | `knet/callback.php:124-131,384-393`; `knet/pay.php:181-192`; `scripts/knet-scan.mjs:255-283`; `../KNET.md:329-332` | Add a pairing section to knet-scan, and warn on these events (section 4). |
| D1† | gap | medium | Sporta's result page shows none of the bank fields that KNET's own result page shows (Payment ID, Transaction ID, Merchant Track ID, Amount, Reason). The repo's K-064 notes say certification needs receipt fields. | §6.3.1 doc p.54; §6.3.2 doc p.57 | `knet/callback.php:138`; `src/pages/PaymentResult.jsx:18,20,80-92`; `store/api.php:475-485,660-737`; `../VPS-SCAN-2026-10-31.md:899-900,907` | Ask KNET which fields are required, then show them from the server's order record (section 4). |
| D2† | risk | medium | The live /payment/result page is the foreign compiled build, and how it shows `status=review` is unknown. The repo's own page shows "Try again" right under its "Do not pay again" text. | §6.3.1 doc p.54; §6.3.2 doc p.57-58 | `../CLAUDE.md:38-40`; `knet/callback.php:133-141`; `src/pages/PaymentResult.jsx:41,65-70,95-99`; `src/i18n/translations.js:460-463`; `store/api.php:806`; `knet/pay.php:105-109` | Run a read-only probe of the live page. Hide the retry link on review (section 4). |
| D3 | gap | medium | An automatic KNET or T-Pay settlement sends the customer no WhatsApp confirmation; only manual settlements do. whatsapp-test calls the manual function, not the real callback. WhatsApp is off by default. | §6.2 step 11 doc p.53; §6.3.1 doc p.54-55 | `knet/callback.php:367-378`; `store/store.php:767-782,396-408,468-519`; `store/admin.php:1420,1507`; `cbk/callback.php:449`; `WHATSAPP.md:3-6`; `scripts/whatsapp-test.mjs:206-213` | Route the callbacks through `store_payment_settled()` (this is a money-path change, so it goes through the review gate), or correct WHATSAPP.md. |
| D4 | doc | medium | A retried payment's track ID ends in `A<n>`, and UDF5 holds the plain order number. No runbook says so. | §6.3.1 doc p.54-56; §6.2 note doc p.48 | `knet/knet.php:355-401`; `knet/pay.php:158-167`; `knet/callback.php:81-87,120`; `../KNET.md:396-421`; `src/admin/Orders.jsx:342-347,500-507` | Add this to KNET.md §3c/§4 and to the admin's settle and review notices. Confirm the UDF5 search on the first test payment. |
| D5 | doc | medium | The go-live P0 list has no step for the receipt fields or a customer receipt, although the repo's K-064 notes say certification needs them. | §6.3 doc p.54-59; §7 doc p.62 | `../KNET.md:216-220,256-281,334-343`; `../VPS-SCAN-2026-10-31.md:899-900,907` | Move both into P0, or get KNET's written answer that they are not needed. |
| A2† | risk | low | `set-knet.sh` refuses Tranportal IDs that contain letters, yet the manual's sample shows "tran89000" and "01062017". The script fails closed, and /backends accepts such IDs. | §1.6 Fig. 8 and table, doc p.10-11 | `set-knet.sh:48`; `store/admin.php:832,855`; `knet/setup-config.php:77` | Use one rule on every route (section 4). |
| A12† | gap | low | `set-knet.sh` lacks two checks that /backends has: refusing identical test and production values, and refusing invisible characters (the remaining exposure is the password). | none in K-063 (code consistency only) | `set-knet.sh:45-50`; `store/admin.php:832,898-905`; `store/preflight.php:276` | Section 4. |
| A13 | risk | low | `set-knet.sh tidy` deletes the Merchant ID and Terminal ID that /backends saves. | §1.6 doc p.10-11 | `set-knet.sh:11-15,75-81`; `store/admin.php:845-853,944-980`; `store/store.php:4110`; `brands.js:731-736` | Add those keys to the keep-list (section 4). |
| A14 | doc | low | The KNET README gives the AES IV as `PGKEYENCDECIVSPC`. The code uses the resource key as the IV. This is a K-064 topic. | not in K-063 | `knet/README.md:16,41`; `knet/knet.php:4-8,142` | Correct the README (same fix as C17). |
| B4† | gap | low | The track ID of a retried payment is kept only in the payment log, not on the order. The attempt count is not shown in the admin. | §4.1 Fig. 23 doc p.31; §4.2 Fig. 25 doc p.34, step 3 doc p.36 | `knet/knet.php:396-401`; `knet/pay.php:181-192`; `knet/callback.php:86-87,98-104,120,341-344`; `store/admin.php:1200-1209`; `cbk/callback.php:421-433`; `ops/db/grants.sql:311,333` | Store it in its own column (section 4). |
| B5† | gap | low | The Authorization Code and Transaction ID are saved but never shown. | §4.1 Fig. 23 doc p.31; Fig. 24 doc p.32 | `knet/callback.php:92-104,341-351`; `store/admin.php:1200-1209`; `store/store.php:356-394` | Same fix as C3 and D7. |
| B9 | gap | low | An order under review can only be closed by cancelling it. It stays "review" for ever, with no refund record. | §4.1 doc p.30-32; §4.2 doc p.36 | `store/admin.php:1172,1319-1328`; `store/store.php:3210-3243`; `store/cron-stock.php:102,114`; `NATIVE-BACKEND.md:323-330`; `../KNET.md:331-332` | Add "Close review: refunded / voided in KPay" as part of B1. |
| B15 | risk | low | /backends shows times in UTC, but KPay searches need a date-time window. | §4.1 Fig. 23 doc p.31; §4.2 Fig. 25 doc p.34-35 | `knet/callback.php:353`; `store/admin.php:1175-1178,1415,1500`; `src/admin/Orders.jsx:12`; `PHP-SCAN-2026-11-03.md:1896` | Use a wide search window (section 2, item 25), or show Kuwait time (C7). |
| B18 | gap | low | /backends cannot find an order from a KPay identifier or from a retry reference. | §3.2 doc p.27-28; §4.2 Fig. 26 doc p.35 | `store/admin.php:1225-1233`; `knet/callback.php:138`; `knet/knet.php:396-401` | Extend the search (section 4). |
| C4† | gap | low | The order does not record which `<track>A<n>` reference was settled. A KPay reference pasted with its suffix finds nothing in /backends, though searching the part before the suffix works. | §5.1 doc p.40; §5.2 doc p.42 | `knet/knet.php:396-401`; `knet/pay.php:160,181-192`; `knet/callback.php:86,98-99,341-344`; `store/schema.mysql.sql:599-608`; `cbk/callback.php:425-431`; `store/admin.php:1231` | Store it in its own column, not in `cbk_trackid`. Document that one order can have up to 10 Merchant Track IDs. |
| C5† | doc | low | An order whose callback was lost has no Payment ID in Sporta. The repo admin's hint "Find the order in the KNET portal" gives no method, and the live add-on gives no hint at all. | §5.2 doc p.40, 42; §5.1 doc p.40 | `knet/pay.php:194-202`; `knet/callback.php:88`; `src/admin/Orders.jsx:342-347,495-510` | Search by the order's set of Merchant Track IDs. Look up by Order ID only after C9 confirms it equals the Payment ID. |
| C12 | gap | low | The payment log has no backup and no rotation. | §5 doc p.37 | `ops/db/db-backup.sh:375-376`; `../VPS-SCAN-2026-10-31.md:490-492`; `../KNET.md:342`; `scripts/knet-scan.mjs:259-260`; `knet/callback.php:92-104` | Section 4. |
| C13† | risk | low | The repo admin's order CSV export does not guard against spreadsheet formulas. This affects the repo admin only, not the live one. | §5 doc p.37 | `src/admin/api.js:250-260`; `store/store.php:323-328`; `store/api.php:846`; `brands.js:5823-5828` | Section 4. |
| C14† | gap | low | The order export has no date range, holds at most 100-500 rows, and mixes all payment methods. | §5.1 doc p.37-38 | `src/admin/api.js:56-61`; `src/admin/Orders.jsx:45-52`; `store/admin.php:1186-1195,1210-1237` | Section 4. |
| C17† | doc | low | The README and the knet.php header say success is "CAPTURED (or APPROVED)", but the code accepts only CAPTURED. The README also gives the wrong IV. | §5.1 doc p.39 | `knet/README.md:16,41,44`; `knet/knet.php:4-10,142,156`; `knet/callback.php:76-80` | Correct both: CAPTURED is the only success result, and the IV is the resource key. |
| D7 | gap | low | The admin never shows the KNET Transaction ID or the authorization code. | §6.3.1 doc p.54-56 | `store/admin.php:1199-1209`; `knet/callback.php:350-351`; `src/admin/api.js:246-254` | Same fix as C3. |
| D9 | doc | low | An admin.php comment says KNET payment IDs are about 12 digits, but the manual shows 18. The behaviour is unaffected. | §6.3.1 doc p.54-55 | `store/admin.php:1452-1455` | Fix the comment at the next backend edit. |
| D11 | gap | low | After a bank error, the result page loses the order number. | §6.3.2 doc p.57 | `knet/callback.php:44-61,72`; `src/pages/PaymentResult.jsx:35,85-87` | Section 4. |
| D13† | doc | low | KNET.md and config.example.php describe the callback reply wrongly ("both" as the default, plus a meta refresh). The code has the modes auto, redirect and plain. This has no K-063 basis. | none in K-063 (K-064 topic) | `../KNET.md:388-394`; `knet/config.example.php:45-52`; `knet/README.md:44`; `knet/callback.php:77-80,161-175` | Update the docs to match callback.php. |
| D15 | risk | low | A K-Link payment never updates a Sporta order. | §6.2 steps 9-11 doc p.52-53; step 5B doc p.48 | `store/admin.php:1448-1507`; `knet/callback.php:237-246`; `knet/knet.php:418-458` | Only if you use K-Link: put the Sporta order number in the Invoice ID or a UDF, and settle the order in /backends before its stock hold lapses. |
| D16 | owner-action | low | Check the merchant name and contacts KNET shows customers, and whether website payments trigger KNET notifications. | §6.2 steps 10-11 doc p.53; §6.3.1 doc p.54-55; §6.3.2 doc p.58 | `../KNET.md:170-184,312-316` | Section 2, item 22. |
| B13† | owner-action | info | Terminal ID is a mandatory search field, but "ALL" works. Sporta does not store the terminal number. | §4.1 Fig. 23 doc p.31; Fig. 25 doc p.34; Fig. 26 doc p.35 | `set-knet.sh:12-15`; `../KNET.md:173-176` | Note the test and production Terminal IDs in the runbook. No code change. |
| D14 | owner-action | info | K-Link is KNET's own payment link, created in the portal. There is nothing to build, and it is not T-Pay. | §6.1 doc p.45; §6.2 doc p.45-53 | `../CLAUDE.md:262-283`; `../KNET.md:177` | If you want payment links, ask KNET to enable Accept Payments. |

---

## 4. Code changes recommended

Only gap and risk items that survived verification are listed here. Doc-only fixes (A3, A4, A11, A14/C17, B10, B11, C2, C5, D4, D5, D9, D13) are in the table above.

**A1: point `set-knet.sh` at the file the shop reads (high).**
- Today the script fixes `DIR=/docker/sporta/private` and `F=$DIR/knet-config.php` (`set-knet.sh:26-27`) and edits `/p/knet-config.php` (`:58-60`). The shop reads `private/config/knet-config.php` (`store/config-path.php:13-14,48-55`).
- Change it to use `/docker/sporta/private/config`, or better, read the path from the apache-sporta container's `/run/sporta-config` mount.
- Make it refuse to run when `knet-config.php` exists in both places.
- Delete the stray file and its `.bak-*` copies (`:54`).
- Make `scripts/knet-scan.mjs:157-166` read `private/config/knet-config.php` by name instead of taking the first match of a directory walk.

**B3 / C1: flag a second capture on a paid order (high).**
- The locked SELECT (`knet/callback.php:237-240`) does not read `cbk_paymentid`, and the `already_paid` branch (`:250-255`) returns before any check.
- Read `cbk_paymentid` in that SELECT.
- When the result is CAPTURED and the incoming payment ID differs from the stored one: log `callback.duplicate_capture`, write a lasting admin alert or event, and leave `payment_status` unchanged.
- Change the knet-test replay case (`scripts/knet-test.mjs:240-254`) to expect the alert.

**B2: let a paid card order be stopped when it is refunded (high).**
- `store/admin.php:1324-1327` refuses to cancel any paid order. `:1363` is the only place that sends the warehouse a "cancel" message.
- Allow a paid card order to be cancelled only together with a recorded refund or void (next item).
- That cancel should send `store_fulfilment_cancelled` (`store/store.php:3379`) to the warehouse and release the stock.

**B1 / B8 / B9 / C10: record refunds and voids made in KPay (medium).**
- `payment_status` allows only pending, paid, failed and review (`store/schema.mysql.sql:59`).
- Add a refunds table, or a `refunded_amount` column plus new status values. This needs a migration, `grants.sql` and `expected-schema.json`. Add the UI in `brands.js`.
- Each refund records its amount, its KPay reference and a link to the return request.
- A full refund of an unshipped order sends "cancel" to the warehouse, releases the stock and the discount uses, and takes the amount out of the stats (`store/admin.php:1169-1196`) and the XBRL export (`store/xbrl.php:33-34`).
- When a return is marked "received", offer a stock `return` adjustment filled in from the request lines (`store/admin.php:2319-2324`).
- Add "Close review: refunded / voided in KPay" for review orders (`store/admin.php:1172,1319-1328`).
- Report revenue as paid minus refunded.

**C6 (and B6): make manual card settlement safer (medium).**
- `card_settled` checks only the length of the ID (`store/admin.php:1455`), then overwrites `cbk_paymentid`, `cbk_status` and `cbk_message` (`:1494-1504`).
- Refuse a Payment ID that is already stored on another order. `cbk_paymentid` has no index today (`store/schema.mysql.sql:40`).
- Keep the callback's original `cbk_paymentid` and `cbk_status`, either in separate columns or in an event or log line with the order ID and the old values. Warn when the typed ID differs from one the gateway already reported (`:1497`).
- Put the order ID in the activity record (`store/store.php:1436-1447`; `store/admin.php:395-417`).

**C3 / B5 / D7 / B4 / C4 / B18: show and search the bank identifiers (medium to low).**
- `store/admin.php:1205` returns only `cbk_paymentid`, `cbk_reference` and `cbk_status`. Also return `cbk_transaction`, `cbk_authcode`, `cbk_message` and `pay_attempt`, and show them in the live drawer through `brands.js` under KPay's names.
- Store the echoed KNET attempt reference in a column of its own (for example `gateway_attempt_ref`). Do not use `cbk_trackid`, which means CBK's own Track ID (`store/schema.mysql.sql:602-605`). Write it in the KNET callback's UPDATE (`knet/callback.php:341-344`) inside a savepoint, as `cbk/callback.php:421-433` does, with an UPDATE grant (`ops/db/grants.sql:311`) and an expected-schema entry.
- Extend the search (`store/admin.php:1231`) to `cbk_paymentid`, `cbk_reference`, `cbk_transaction`, `cbk_authcode` and the new column. Try the exact term first, then the term without a trailing "A" plus digits.

**C7 / B15: time zones (medium).**
- Run `select @@global.time_zone, @@system_time_zone`.
- Set the session `time_zone` to `'+00:00'` on every PDO connection.
- Use `gmdate()` for the `paid_at` writes at `store/admin.php:1415` and `:1500`, as `knet/callback.php:353` already does.
- In the order drawer (`src/admin/Orders.jsx:12`, and the live drawer), label times as UTC or convert them to Asia/Kuwait.

**C8: mark test-gateway payments (medium).**
- Orders have no environment column (`store/schema.mysql.sql:29-62`).
- Record the environment at settlement in `knet/callback.php:341-355`, as a column or as a prefix in `cbk_message`.
- Leave test orders out of the stats (`store/admin.php:1169-1170`) and out of XBRL (`store/xbrl.php:33-34`).

**C11: reconciliation helper (medium).**
- In `scripts/knet-scan.mjs:255-283`, add a read-only section that lists, for each order:
  - payment-attempt references with no bank callback;
  - every `callback.review`;
  - every `callback.db_write_failed`;
  - any order with two CAPTURED callbacks.
- Raise `db_write_failed` and duplicate captures as warnings, not just counts.
- Its output is the list of Merchant Track IDs for the daily KPay check.

**D1 / D2 / D11: payment result page (medium to low).**
- `src/pages/PaymentResult.jsx` reads only `status` and `trackid` (`:18,20`).
- After KNET answers question 10 (D5), show the result, amount, date and time, and the KNET Payment ID (and the Transaction ID if wanted). Take them from the server's order record through a route that returns them, never from the URL. The status route at `store/api.php:475-485` returns the amount but no `cbk_*` field.
- Hide the "Try again" link when the status is review (`PaymentResult.jsx:95`).
- Pass the validated `trackid` through on the bank-error and decrypt-failure redirects (`knet/callback.php:60,72`).
- The live page is the foreign compiled build (`../CLAUDE.md:38-40`), so first run the read-only probe: `GET /payment/result?status=review&trackid=<non-existent>` and `?status=success&trackid=<non-existent>`, in Arabic and English. If the live page also offers a retry on review, fix that before go-live.

**D3: customer confirmation on automatic settlement (medium).**
- `knet/callback.php:367-378` and `cbk/callback.php:449` never call `store_payment_settled()` (`store/store.php:767-782`).
- Either route the paid transition through that function (a money-path change, so it goes through the review gate) and make `scripts/whatsapp-test.mjs:206-213` drive the real callback,
- or correct `WHATSAPP.md:3-6` to say that only manual card settlements and COD collections send the confirmation.

**A5: labels (medium).**
- In `brands.js`, relabel the KNET readiness line (`scripts/fixtures/admin-payments.mjs:22`, which mirrors the live page; the check behind it is `store/admin.php:1136`) and the save refusal (`../VPS-SCAN-2026-10-31.md:669`) to "Tranportal ID and password".
- Add "(not your KPay portal logon or profile password)" to the `set-knet.sh:46` prompt and to the editor hint.

**A2 / A12 / A13: `set-knet.sh` checks (low).**
- Replace the digits-only ID check (`set-knet.sh:48`) with one rule shared by all routes: not empty, `[A-Za-z0-9]` only, no whitespace or invisible characters, and always kept as a string.
- In the embedded PHP, refuse U+00A0, U+200B and U+FEFF in all three values. Also refuse a production value equal to the saved test value, with the same messages as `store/admin.php:898-905`.
- Add `merchant_id`, `terminal_id`, `test_merchant_id`, `test_terminal_id`, `production_merchant_id` and `production_terminal_id` to the tidy keep-list (`:75-78`).

**C12: payment log backup and rotation (low).**
- `ops/db/db-backup.sh:375-376` dumps only the database.
- Add `/docker/sporta/private/voice/knet-payments.log` and `cbk-payments.log` to the encrypted backup set.
- Add size- or month-based rotation that keeps the old files (append-only, never truncate).
- Make knet-scan read the rotated files. Today it skips a log over 64 MB (`scripts/knet-scan.mjs:259-260`).

**C13 / C14: repo admin export (low; repo admin only).**
- In `src/admin/api.js:256-259` (`toCsv`), reuse the `csvCell` rule from `brands.js:5823-5828`.
- Add from/to filters (on `paid_at`, UTC) and a `payment_method` filter to `store/admin.php:1210-1237` and to the revenue route (`:1186-1195`).
- Add an export that pages through all rows. Today `Orders.jsx:45-52` writes only the loaded screen.

---

## 5. Checked and fine

- **A6:** Sporta asks for exactly a Tranportal ID, password and 16-byte key per environment, with no plug-in or KeyStore. Every route checks that the key is 16 bytes, and placeholders never count as configured. (`knet/pay.php:149-168`; `knet/knet.php:80-98,139-147`; `store/admin.php:826-837,856`) *§1.1 doc p.1; §1.6 doc p.10-11*
- **A7:** /backends never returns the secrets. It pins the gateway hosts to kpaytest.com.kw and kpay.com.kw and the path `/kpg/PaymentHTTP.htm`, and refuses identical test and production values. (`store/admin.php:735-760,820-821,898-905`; `knet/knet.php:115-131`) *§1.6 doc p.9*. Known limit, outside this check: a URL trick that fools `parse_url` can bypass the host pin, but it needs an admin session (`PHP-SCAN-2026-11-03.md:599-605`).
- **B6†:** The Payment ID is stored for most bank outcomes, and manual settlement requires one of 6-60 characters. (`knet/callback.php:341-355`; `store/admin.php:1205,1455,1494-1501`) *§4.2 step 3a doc p.36*
- **B7:** Amounts are `decimal(10,3)`, sent with 3 decimals and compared in fils, which matches KPay's NNNNN.NNN. (`store/schema.mysql.sql:32`; `knet/knet.php:522-535`; `knet/callback.php:276-293`) *§4.1 Fig. 23 doc p.31*
- **B14:** Batch Upload needs full card data. Sporta sends no card data and should not build such an export. (`knet/pay.php:149-168`; `../KNET.md:347`) *§3.1 Fig. 19 doc p.26*
- **B16†:** Refund and void can only be done by a person in the portal. Sporta only ever sends action 1 (purchase). (`knet/pay.php:152`; `knet/knet.php:163`; `knet/callback.php:76-80`) *§4 doc p.30; §4.2 doc p.36*
- **B17†:** Captures the shop cannot honour are parked as review with their bank references stored, and stock still held stays held. (`knet/callback.php:259-321,341-355`; `store/store.php:3218-3226`) *§4.2 doc p.36*
- **C15:** Each settlement stores the bank identifiers inside one locked transaction and checks the amount in fils. (`knet/callback.php:233-255,275-293,341-365`) *§5.1 doc p.39-40*
- **C16:** The payment log keeps every attempt and every full bank response, in UTC, with file mode 0600 and no Tranportal secrets. It does contain the shopper's IP address. (`knet/knet.php:187-204`; `knet/pay.php:178-192`; `knet/callback.php:98-104`) *§5.1/§5.2 doc p.38-42*
- **D6:** The Payment ID is used as the reconciliation key. A CAPTURED result with an empty payment ID goes to review. (`knet/callback.php:278-281,341-355`; `store/admin.php:1205,1448-1455`) *§6.3 doc p.54-58*
- **D8†:** KNET's example identifier sizes fit Sporta's columns: `track_id` is `varchar(30)`, and `cbk_paymentid` and `cbk_transaction` are `varchar(60)`. (`store/schema.mysql.sql:31,40-43`; `knet/callback.php:117`) *§6.3.1 doc p.54*
- **D10:** NOT CAPTURED becomes a clean decline. Only CAPTURED counts as paid. (`knet/callback.php:76-80,329-338`) *§6.3.2 doc p.57*
- **D12:** The result-page wiring is consistent from the config through to the route. (`knet/config.example.php:29-33`; `knet/callback.php:117-121,163-175`; `public/.htaccess:193,199`; `src/App.jsx:98`) *§6.3 doc p.54-57*
- **D17:** K-063 sets no logo or wording rule for the merchant's own result page. *§6-7 doc p.45-62*
- **D18:** Amounts use KNET's three-decimal KWD format. (`knet/knet.php:522-535`; `knet/pay.php:123-131,155`) *§6.2 step 5B doc p.48*

---

## 6. Refuted claims

No finding was refuted outright. Verification corrected part of each finding marked † in the tables above:

- **A2:** Severity was lowered from medium to low. Nothing shows that Sporta's own ID contains letters; the Fig. 8 sample is a vendor demo profile in Indian rupees.
- **A11:** The claim "no doc mentions the /backends KNET editor" was too strong. `../VPS-SCAN-2026-10-31.md:669,723-725` does mention it; only the setup docs do not.
- **A12:** K-063 §1.4 is about portal passwords, not test and production Tranportal values. The finding has no K-063 basis.
- **B1:** Severity was lowered to medium. Three statements were corrected:
  - `cod_paid` can move an order from paid back to pending (`store/admin.php:1409-1415`), so the routes do not only mark orders paid.
  - The assistant does not say "being prepared" for an unshipped order under 48 hours (`assistant.php:3155-3159`).
  - Stock can be put back by hand (`store/admin.php:2319-2324`).
- **B2:** Orders have no staff-note field. The nearest record is a CRM note on the customer (`store/crm.mysql.sql:22-30`).
- **B4:** "Not stored" was too strong: the reference is in the payment log. The manual does not say that a search by order number finds nothing. Severity was lowered to low.
- **B5:** Severity was lowered to low. The owner can still find a payment with what /backends shows.
- **B6:** More cases than replays and orders already under review skip the database write: order not found, a paid order with the wrong method, the bank-error leg, a decrypt failure, and an invalid track ID. Manual settlement also overwrites a Payment ID the gateway reported.
- **B8:** "Never goes back on sale" was too strong. A manual stock "return" adjustment exists.
- **B10:** Orders have no staff-note field; use a CRM note.
- **B11:** Warehouse e-mails do not depend on `warehouse_email`. An empty value only delays them, so keeping it empty during tests does not prevent them.
- **B12:** Question 7 is partly answered by §2.2.2: access is granted per menu.
- **B13:** Terminal ID is mandatory, but "ALL" works. The claim that test payments never appear under the production terminal is an inference from the README, not from K-063.
- **B16:** The claim that "Capture is for authorise-then-capture flows" is not in K-063. Confirm it with KNET.
- **B17:** When the stock reservation or the discount was already released, the hold is already gone. A second capture on a non-KNET order already under review leaves its references only in the log.
- **C1:** Severity was lowered from high to medium: the money is not lost, and the payment IDs are in the log. Matching orders by removing a trailing "A" plus digits blindly is unsafe.
- **C3:** `cbk_status` does hold the bank's result word for paid and failed orders (`knet/callback.php:257`). Which KPay column each field matches is an inference.
- **C4:** An order's set of possible references can be worked out from `track_id` and `pay_attempt`. `cbk_trackid` must not be reused. Severity was lowered to low.
- **C5:** The repo drawer does not point to a wrong lookup; it gives no method at all. `src/admin` is not the live admin.
- **C6:** `cbk_transaction`, `cbk_reference`, `cbk_authcode`, `cbk_receipt` and `cbk_paytype` survive a manual settlement.
- **C8:** `set-knet.sh` does record when it switches environment: a UTC time in the config header (`:104`) and timestamped `.bak` files (`:53-54`).
- **C11:** knet-scan does count these events, so they are not "never surfaced". A payment attempt with no callback may just be a bank page the shopper abandoned.
- **C13:** Severity was lowered from medium to low. `src/admin` is not the live /backends.
- **C14:** Merchant Velocity has no Terminal ID filter. Only Transaction Summary uses a date window per terminal.
- **C17:** The line numbers were corrected to `README.md:16,41,44`, and `knet/knet.php:10` is also out of date.
- **D1:** Only KNET's SMS messages say "Keep Payment ID"; the e-mails do not. These figures are K-Link notifications. The server can already supply the amount and the paid time, but not the bank IDs.
- **D2:** The repo's own page also shows "Try again" on review. The manual's "Keep Payment ID" is not an instruction not to pay twice.
- **D8:** The 15-character Track ID is stored in `orders.track_id`, not in `cbk_reference`.
- **D13:** The K-063 pages say nothing about the callback reply. This is a docs-versus-code finding only.

---

## Owner's UAT receipt and error-page spec (2026-11-12)

KNET's UAT reviewers check that the customer's result page shows the transaction clearly. The owner supplied the
field list; build it on `/payment/result` (live: an add-on block in `public/sporta-features.js` reading the server's
order status, never the address bar).

**Success (result CAPTURED):** a clear "Payment successful" line, then, each labelled in Arabic and English:
Order reference (the shop's order number) · Amount paid (KWD, 3 decimals) · Payment ID · Transaction ID ·
Track ID · Reference number (`ref`) · Auth code (`auth`) · Date & time **of the payment** (the server's `paid_at`,
Kuwait time), not the time the page was opened.

**Failure / cancel (NOT CAPTURED, CANCELED, errorURL with ErrorText, missing trandata):** a clear
"Payment unsuccessful" line, the reason in plain words (mapped from the bank's result / ErrorText; never the raw
text echoed unescaped), Track ID, Payment ID when the bank gave one, and a "Try again" link back to the bag /
checkout. Same fields in both languages.

**Rules:** every value comes from the server (the order row the callback wrote), shown only to that order's own
shopper (same proof as the invoice route); nothing is read from the URL except the order reference used to ask
the server; `textContent` only; works RTL; no layout shift; the invoice shows the same bank fields.

## Order-page check findings to include in the receipt build (2026-11-12, local e2e + read-only live probe)

1. **Live result page says "Payment received — being confirmed … Do not pay again" for an unknown order, a KNET order
   still pending (shopper left KNET / reply not arrived) and when the status check fails.** Someone who paid nothing is
   told not to pay again. The receipt block in `public/sporta-features.js` must replace that text on `/payment/result`:
   unknown order -> "We could not find this order"; pending -> "Waiting for the bank's answer" with a refresh and a
   "Try again" path; status check failed -> "Could not check the payment right now" (never "do not pay again").
2. **Language:** the shopper returns from KNET to the result page in the order's language: carry `lang` on every
   result redirect from `callback.php` (both legs), taken from the language saved on the order, not the browser.
3. **errorURL leg:** keep the Track ID and Payment ID on the redirect (`callback.php:60`) so the failure page can show them.
4. **/backends orders:** the orders route returns Transaction ID, Auth code, the bank result and the attempt number
   (`admin.php:1201-1209`); the admin search also finds an order by Payment ID, Reference and attempt reference
   (`admin.php:1231`). Paid-at shown in Kuwait time where this repo formats it.
5. **Placeholder check** (`store.php:2718-2724`): KNET must stay hidden at checkout unless the Tranportal ID, password
   and 16-byte key are real (no placeholder of any spelling); otherwise checkout offers KNET and the bank refuses.
