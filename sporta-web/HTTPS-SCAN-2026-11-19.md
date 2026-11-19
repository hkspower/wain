# HTTPS scan, 2026-11-19 (read-only)

Owner: "scan https 3". Read-only: `node scripts/vps-deploy.mjs compose --scan` (commit `dc644d07`), a one-shot job on the VPS (project `sporta-deploy`, deleted afterwards) that makes GET requests
to the live site and reads the web root on disk with `/docker/sporta` mounted read-only. It writes nothing and sends no body, cookie or credential.

**Result: `SCAN_DONE bad=0 warn=0`.** Every check passed (about 150).

| Area | Measured |
|---|---|
| Certificate | verifies, Let's Encrypt; names `sporta.com.kw`, `www.sporta.com.kw`, `srv2058651.hstgr.cloud`, `www.wainkw.com`; **expires 24 Jan 2027, 66 days left** |
| Protocol | TLS 1.3 negotiated; HTTP/2 offered (ALPN h2); **TLS 1.0 and 1.1 refused**; `sporta.com.kw` (no `www`) has a valid certificate too, so its redirect is not a browser warning |
| Redirects | `http://sporta.com.kw`, `http://www.sporta.com.kw` and `https://sporta.com.kw` each reach `https://www.sporta.com.kw/shop` in **one hop**; `/index.html` and `/index.php` 301 to `/` |
| Headers on `/` | `Strict-Transport-Security: max-age=31536000; includeSubDomains`, a Content-Security-Policy (`default-src 'self'`, `object-src 'none'`, `frame-ancestors 'self'`), `X-Content-Type-Options: nosniff`, `X-Frame-Options: SAMEORIGIN`, `Referrer-Policy: no-referrer`, a Permissions-Policy, `Cross-Origin-Opener-Policy: same-origin`; no `X-Powered-By` |
| Compression and cache | HTML is Brotli; hashed assets are `public, max-age=31536000, immutable`; `/`, `config.js`, `sw.js` and `boot.js` revalidate; `/knet/pay.php`, `/pay/pay.php` and the API are no-store |
| Cookies | none on `/` (nothing to consent to); `admin.php?r=me` without a session answers 200 `null` |
| Routes | 12 real routes 200 and unknown ones a real 404 (`/backends/` and `/admin` are 404 on purpose) |
| Paths that must not answer | 45 sensitive paths (`.git`, `.env`, `.htaccess`, `package.json`, every config and source file of `api/`, `knet/` and `pay/`, setup tools, logs, archives, `server-status`) are 403 or 404; the folders `cats/`, `fonts/`, `assets/`, `images/`, `api/`, `knet/` and `pay/` give no listing |
| API | 32 products, no wholesale cost in the feed or the stock answer, no error trace or file path in any answer |
| SEO over HTTPS | canonical and hreflang right in both languages; `robots.txt` disallows `/backends` and names the sitemap; `sitemap-products.xml` lists 66 URLs |
| Web root on disk | no `config.php`, `.env` or token file; no leftovers, archives or backups; nothing world-writable; files 644, folders 755; the four `.htaccess` files present |

## Notes (none is a defect)

- The certificate renews itself in the VPS's front proxy; 66 days is normal for a 90-day certificate. Worth looking again if it falls under about 20 days.
- HSTS has no `preload` token: the domain is not on the browsers' preload list. Adding it is a one-way decision for the owner (it needs every subdomain on HTTPS for good).
- The `Server: Apache` header names the web server without a version.
- The certificate also names `www.wainkw.com`, another site on the same VPS.

## Not measured

The cipher-suite list beyond the negotiated one, OCSP stapling, a DNS CAA record, certificate transparency, and mixed content inside a real browser (the scan reads headers and files, not a rendered page); `scripts/live-https-about-probe.mjs` does the browser part.
