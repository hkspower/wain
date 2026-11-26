# API full scan, 2026-11-26

Read-only scan of the backend: the PHP source in `dropin/php-store/` and the LIVE API at https://www.sporta.com.kw/api.
Only GET requests were sent to the live API. No POST, no order, no sign-in, nothing written.

## What was run

1. **PHP lint.** `php -l` on all 44 files in `dropin/php-store/`: 44 clean, 0 errors.
2. **Route inventory (from source).** `api.php` has 21 GET-or-POST routes; `admin.php` has 106; `customer.php` has its
   own set. Every admin route is listed in `admin.php` under `$r === '...'`.
3. **Live public routes, GET.** The 22 `api.php` routes that take a GET were requested once each. Recorded: HTTP status,
   the `Cache-Control` header, and whether the body shows error text (PHP warnings, SQL errors, file paths, secrets).
4. **Live admin routes, GET, no session.** All 106 admin routes were requested once each, without a signed-in cookie.
   Expected: every one refuses (401).
5. **Live customer routes, GET.** `customer.php?r=me` and `r=logout` (405 on GET, as expected).
6. **Existing suites (rig).** `test:native` (682 ok, 0 FAIL) covers the API contract; `test:config` (32), `test:knet`,
   `test:tpay`, `test:assistant` and `test:install-sql` are green (13-suite check-in, 2026-11-26).

## Results

- **PHP:** clean.
- **Admin gate:** 106 of 106 admin routes answer 401 to a signed-out visitor, except three that answer 200 with no data:
  - `google_available` returns `{"available": false}`: a boolean, no key.
  - `passcode_status` returns `{"enabled": false}`: a boolean, no e-mail or passcode.
  - `me` returns `null`: a signed-out visitor has no session.
  None leaks data.
- **Public routes:** 21 of 22 answer as their design says. Errors are JSON (`not_found`, `invalid_review_link`), and no body
  showed PHP warnings, SQL text, file paths or secrets.
  - `products`, `brands`, `slides`, `theme`, `content`, `text_style`, `stock`, `status`, `shipping`, `checkout_config`,
    `invoice`, `catalogue`: 200.
  - `say`: 400 on GET (needs its parameters). `return_lookup`: 405 on GET (POST only).
  - `assistant`, `discount`, `order`: 404 on GET. These are POST-only routes, so GET is "not found" by design.
  - `review`: `invalid_review_link` (needs a token).
  - `brand_logo`, `slide_image`, `site_icon`: 404 without their id or slug; `site_icon` with no custom icon is 404 by design.
  - `support_create` and `support_lookup`: 403 on GET.
- **Cache headers:** dynamic routes send `no-store`; `catalogue` sends `no-cache` (public and revalidated, by design).
  No route sends a cacheable header on a personal answer.
- **Customer routes:** `me` answers 200 with `null` for a signed-out visitor, the same as the admin's `me`.

## Not covered

- **POST routes:** not sent (the scan is read-only). Their checks come from the rig suites (`test:native`, `test:knet`,
  `test:tpay`, `test:assistant`, `test:config`), which pass.
- **Admin routes with a session:** not tested live (no sign-in). The rig suites cover them.
- **`accounts_report`** (new, not on the live server yet): it answers 401 to a signed-out visitor like every admin route, so
  its presence can't be seen from outside. It goes live with the API release that is still held for review.
- **Load, rate limits and timeouts:** not measured in this pass.

## Findings

No new findings. Nothing was changed. The three 200 responses on admin routes are benign (booleans and `null`), and the
POST-only routes answering 404 to GET is the design.

## How to re-run

- Lint: `cd dropin/php-store && for f in *.php; do php -l "$f"; done`
- Live GET probes: `curl -s -o /dev/null -w "%{http_code}" "https://www.sporta.com.kw/api/api.php?r=<route>"`
  (and `admin.php?r=<route>`; expect 401 for admin routes without a session).
