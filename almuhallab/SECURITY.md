# Security — Almuhallab / Nokha1 (النوخذة)

This document describes the security measures in the static prototype and the
boundaries that only a real backend can provide.

## Measures implemented (all pages)

- **Content Security Policy** (`<meta http-equiv="Content-Security-Policy">`):
  `default-src 'none'`, no external scripts/styles/connections, `base-uri 'none'`,
  `form-action 'none'` (forms are JS-handled only — a broken script can never
  leak form data into a URL). The editor additionally allows `img-src *` and
  `frame-src` for its sandboxed preview only.
- **Referrer policy**: `no-referrer` on every page.
- **Output encoding**: every user-supplied string rendered into HTML goes
  through an `esc()` helper (textContent-based encoding); numbers are re-coerced
  and clamped on read because `localStorage` is user-writable and treated as
  untrusted input.
- **Input constraints**: `maxlength`, `pattern`, numeric `min`/`step` on all
  fields, plus JS-side validation and clamping (never trust HTML validation alone).

## Authentication (nokha1.html)

- Passwords are hashed with **PBKDF2-SHA256, 310,000 iterations, 16-byte random
  per-user salt** via the Web Crypto API. No plaintext or reversible form is stored.
- Accounts from the earlier prototype (weak hash) are **transparently upgraded**
  to PBKDF2 on their next successful login.
- Hash comparison uses a constant-time loop.
- **Login throttling**: 5 failed attempts locks that email for 5 minutes.
- **Sessions expire** after 24 hours.
- Minimum password length is 8; email format is validated.

## Module-specific

- **Editor (index.html)**: user code runs in an `<iframe sandbox="allow-scripts allow-modals">`
  — no `allow-same-origin`, so preview code cannot touch the parent page,
  its localStorage, or cookies.
- **SAFI (safi.html)**: tickers are whitelisted to `[A-Z0-9.]{1,12}`; CSV export
  neutralizes leading `= + - @` in text cells (spreadsheet formula-injection guard).
- **XBRL (xbrl.html)**: all values are XML-escaped before insertion into the
  generated document; the download filename is sanitized; preview renders via
  `textContent` (never HTML).
- **Delivery (delivery.html)**: all rendered fields escaped; phone fields
  pattern-restricted; amounts clamped to `0..1,000,000`.

## Known limits of a static prototype (need a backend)

These cannot be fixed client-side, by design:

1. **Data lives in each visitor's browser.** Anyone with access to the device
   (or its devtools) can read/modify their own localStorage, including their own
   account record. Client-side hashing protects against casual disclosure of a
   reused password — it is not a substitute for server-side auth.
2. **No shared accounts, no server-enforced authorization, no real payments.**
3. **Rate limiting and lockouts are advisory** — they can be cleared by the
   same user from devtools.

The production path (documented in README.md): server-side auth with
bcrypt/argon2 over TLS, a real database, payment-gateway webhooks, and a server
that enforces plan entitlements. Keep the client-side measures in this document
anyway — defense in depth.

## Reporting

Found an issue? Email cs@sporta.com.kw.
