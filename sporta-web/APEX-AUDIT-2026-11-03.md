# Apex audit (sporta.com.kw), repo side, 2026-11-03

Check only. No live access (Hostinger connector not authenticated); nothing changed but this note.
"Measured" = the repo's four `.htaccess` files (copies) run under a local Apache 2.4.58 with
`X-Forwarded-Proto` set the way Traefik sets it. "Documented" = what `VPS-SCAN-2026-10-31.md` and
`LIVE-SECURITY-SCAN-2026-11-03.md` record. Live behaviour was not re-measured.

## 1. Redirect rules and hops

| File:line | Rule | Flags |
|---|---|---|
| `public/.htaccess:73-74` | `RewriteCond %{HTTP_HOST} !^www\.sporta\.com\.kw(:[0-9]+)?$ [NC]` then `RewriteRule ^ https://www.sporta.com.kw%{REQUEST_URI}` | `R=301,L` |
| `public/.htaccess:80-84` | scheme: all four of `HTTPS!=on`, `X-Forwarded-Proto!=https`, `X-Forwarded-SSL!=on`, `SERVER_PORT!=443` must hold | `R=301,L` |
| `public/.htaccess:53-66` | old-site aliases (`/women`, `/shipping`, `/refund`...), ABOVE the host rule, absolute `https://www` targets | `R=301,L` (+`QSA`/`QSD`/`NE`) |
| `public/.htaccess:99,116,122` | `/index.html`, `/index.php`, `panel.php`: BELOW the host rule | `R=301,L` (panel: 302) |
| `dropin/php-knet/.htaccess:12-19`, `dropin/php-cbk/.htaccess:15-22` | same two rules, repeated (a folder with its own `RewriteEngine On` does not inherit the parent's rules) | `R=301,L` |
| `dropin/php-store/.htaccess` (api/) | no Rewrite directives at all, so api/ inherits the root rules (measured) | - |

- Repo has no `R=308` anywhere; PHP redirects are 302/303. A 308 therefore comes from Traefik, not from here.
- Host rule is a catch-all for ANY host that is not www. `wain`, `mawsoool`, `almuhallab` get no host-based rule; if a
  Traefik router ever sent one of them to this Apache it would be 301'd to Sporta (measured). Today they never arrive (K-5).
- Applies to `/api`, `/knet`, `/pay`, `/backends` and `/.well-known/acme-challenge/` alike (measured: all 301 from the
  apex and from plain-HTTP www). Dotfile deny at `:13` exempts `.well-known`.
- Query kept: no `?` in the target, so Apache appends the original query. `?lang=en` survives (measured).
- Arabic percent-encoded path: kept, but re-escaped with LOWER-case hex (`%D8%AD` becomes `%d8%ad`). Equivalent, still one hop.
- Loop risk: Apache only ever sends apex to www. A loop needs a www-to-apex rule; none exists in the repo. Rule 2 cannot loop
  behind Traefik because Traefik sets `X-Forwarded-Proto: https` on `websecure`; it needs ALL four signals to say insecure.
- HTTPS test: Apache in the container never sees TLS (`HTTPS`, `SERVER_PORT` are 80), so the rule rests on `X-Forwarded-Proto`.
  Without the header on a TLS request it would 301 to itself in a loop; Traefik sets it, so this holds. On the
  `web` entrypoint Traefik redirects first, so rule 2 is only a backstop.

Hops, repo rules alone (measured) versus live (documented):

| Start | Repo rules alone | Live |
|---|---|---|
| `http://apex/shop?x=1&lang=en` | 1 | 1 (Traefik `redirectregex`, `VPS-SCAN:429`) |
| `https://apex/...` | 1 | 1 (Apache rule 1) |
| `http://www/...` | 1 (XFP http) | 1 (Traefik entrypoint redirect) |
| `https://www/...` | 0 | 0 |
| `http://IP/shop` | 1 | 1 to `https://IP/`, then cert warning + Traefik 404 (never reaches Apache, K-5) |
| `https://IP/shop` | 1 | Traefik 404 (no router) |

Exceptions: `http://apex/women` is 2 hops live (Traefik, then the alias). `https://apex/index.html` is 2 (host rule fires
before the index rule). Trailing-dot hosts (`www.sporta.com.kw.`) go to www in 1 hop. `//evil.example/x` stays on www.

## 2. The apex redirect container and HSTS

- Documented (`VPS-SCAN-2026-10-31.md:426-432`): project `/docker/sporta-apex-redirect`, alpine idle, labels only: router on
  `web` for `Host(sporta.com.kw)` priority 100, `redirectregex` `^http://sporta\.com\.kw(.*)` to `https://www.sporta.com.kw${1}`,
  `permanent`, service `noop@internal`. Path and query kept (the regex captures both). Status code is NOT recorded; "301
  versus 308" cannot be settled from the repo.
- www HSTS: `max-age=31536000; includeSubDomains`, no `preload` (`public/.htaccess:202`, `php-knet/.htaccess:26`,
  `php-cbk/.htaccess:29`; `Header always`, so it is on redirects and errors too).
- The docs show NO headers middleware on the apex router. Even if one existed, browsers ignore HSTS received over plain HTTP
  (RFC 6797 s8.1), so the `http://apex` redirect can never establish apex HSTS.
- The only apex HSTS comes from `https://apex`, answered by Apache rule 1 (measured: its 301 carries the header). A typed
  `sporta.com.kw` goes `http://apex` to `https://www` and never visits `https://apex`. See finding A-1.

## 3. Origin spellings (everything that is not exactly `https://www.sporta.com.kw`)

- Real second spellings in shipped code: none. Sitemaps (64 + 368 `<loc>`), `robots.txt`, `llms.txt`, manifests,
  `index.html` JSON-LD, `src/lib/seo.js` (`SITE`), `checkout.js` defaults, mail links (`cron-birthday.php:70,77`,
  `customer-auth.php:48`), `admin-google.php:22`, cron comments: all `https://www`.
- Bare domain as text, not a URL (brand name in copy): `Terms.jsx:12`, `translations.js:2,544`, `detectLang.js:14`,
  `store.php:3089`, `api.php:657`. Fine.
- Mailboxes `cs@sporta.com.kw` (apex mail domain, correct): `Contact.jsx`, `Privacy.jsx`, `Terms.jsx`, `Invoice.jsx:314`,
  `translations.js`, `LegalPage.jsx:25`, `llms.txt:21`, `index.html:114,126` (JSON-LD), `seo-page.php:41`,
  `config.example.php:24,31,37`, `sporta-ai-handoff.json:78` (n8n), `assistant.php`. WhatsApp templates hold no site URL
  (`cron-whatsapp.php` only names the Graph API and a www cron URL in a comment).
- `http://www...` strings exist only in audit scripts (`mobile-audit.mjs`, `site-audit.mjs`, `url-audit.mjs`, `site-pdf.mjs`,
  `sitemap-check.mjs:589`): probes, not output. `sporta-html5/.htaccess` repeats the same rules (not live).
- Leak path (see A-2): `admin.php:245,745,988` ALLOW `sporta.com.kw` as well as www.

## 4. Cookies

No `Domain` attribute and no `session.cookie_domain` anywhere (grep of `setcookie`, `session_set_cookie_params`, `Set-Cookie`,
`document.cookie`): all host-only. Admin `__Host-sporta_admin` (`store.php:1077`), customer `__Host-sporta_customer`
(`customer-auth.php:171`), Google `__Host-sporta_google` (`admin-google.php:45`), admin device cookie `store.php:1522`
(no prefix, no Domain, so still host-only). KNET/CBK `.htaccess` only add Secure/HttpOnly/SameSite. The site itself uses
no `document.cookie` (`Privacy.jsx:56`). Nothing is sent to the apex or sibling subdomains.

## 5. CSP

`public/.htaccess:394`: `default-src 'self'`, `connect-src 'self'`, `form-action 'self' https://kpay.com.kw https://kpaytest.com.kw`,
`upgrade-insecure-requests`. No bare-domain entry; none is needed (the apex never serves the app).

## 6. Mail

`DNS-EMAIL-RECORDS.txt` prescribes, all at the apex: SPF TXT `@` (one record; the Hostinger line is
`v=spf1 include:_spf.mail.hostinger.com ~all`), DKIM `<selector>._domainkey`, DMARC `_dmarc` `p=none` to `rua=mailto:cs@...`.
No MX is prescribed (mailbox assumed present). The shop sends from `mail_from` / `admin_mail_from` / `customer_mail_from`
(example values `cs@sporta.com.kw`; the real values live in the server-only config and were not read) via `mail()` with
`-f`. `orders@` is a legacy sender (`store.php:210` comment, `hostinger-api.mjs:130`). Live DNS state belongs to the DNS lane.

## 7. SEO

hreflang: ar and x-default to the bare path, en to `?lang=en`, all under www (`seo.js:60`, `sitemap-pages.xml`, `index.html`).
Canonical is self-referencing per language. Nothing points at the apex. Sitemap index is served by
`api/sitemap-index.php` with `[END]` (200, no redirect) so the repo cannot emit a 308 for `/sitemap.xml`.

## 8. A visitor typing sporta.com.kw

`http://sporta.com.kw` to `https://www.sporta.com.kw/` (1 hop, Traefik) to the Arabic home (`localStorage` is per origin and
empty; rule is saved choice, then `?lang=`, then Arabic). `?lang=en` rides through both redirect layers, so English links stay
English. `https://sporta.com.kw/` (links, HTTPS-first browsers) is one Apache hop to the same page.

## Findings

- **A-1 [medium, owner decision] The apex is never HSTS-protected in the normal flow.** Typed visits skip `https://apex`, and
  www's `includeSubDomains` covers only `*.www`. Every typed visit starts again on `http://apex`, which can be intercepted.
  Preload is out of reach: apex would have to serve `max-age>=31536000; includeSubDomains; preload` on its own HTTPS
  response and (per hstspreload.org, from memory, verify) redirect HTTP to HTTPS on the SAME host first, which is a
  second hop and contradicts the one-hop rule. Fix options (VPS side, Traefik label on `sporta-apex-redirect`):
  keep as is and document it (recommended), or change the regex target to `https://sporta.com.kw$${1}` (2 hops). Do not
  add `preload` to `public/.htaccess:202` (hard to undo). Also unverified: whether any HTTP-only subdomain exists, since a
  learned apex HSTS with `includeSubDomains` would break it for that browser.
- **A-2 [medium, repo] Admin allows the bare domain as a payment return URL.** `admin.php:245,745,988` accept
  `sporta.com.kw`. A saved `response_url`/`error_url`/`return_url` on the apex makes the bank's server-to-server POST get a 301
  (POST becomes GET, callback lost), and `$httpsSporta` (`:984`) still reports the URLs "ready". Fix: remove
  `'sporta.com.kw'` from the three lists (keep `www.sporta.com.kw`). Money path: needs the normal review gate.
- **A-3 [low, VPS] IP spelling does not reach Apache** (K-5): `http://187.7.78.123/` goes to `https://187.7.78.123/` and a
  cert warning. Fix: Traefik label on `sporta-apex-redirect`, a second router `Host(`187.7.78.123`)` on `web`, priority 100,
  `redirectregex` `^http://187\.7\.78\.123(.*)` to `https://www.sporta.com.kw$${1}` (write `$$`: compose interpolates `$`).
  HTTPS to the IP will always warn (no cert for an IP).
- **A-4 [low, VPS] `http://apex/<alias>` is 2 hops** (`/women`, `/shipping`, `/refund`...): Traefik regex first, then the alias
  rule at `public/.htaccess:53-66`. Old URLs only. Accept, or list the aliases in the Traefik regex. Repo-side:
  `https://apex/index.html` 2 hops; moving `:99` above `:73` would make it 1 (cosmetic).
- **A-5 [info, VPS] 301 versus 308 and "IP stays on IP" are not repo questions.** The repo emits 301 only. To settle: read
  `http://` and `https://` with GET and HEAD on apex, www and `/sitemap.xml`, plus the Traefik image tag. The IP behaviour
  matches the entrypoint catch-all (`priority=10`, scheme only, host kept). Google treats 308 like 301.
- **A-6 [info, VPS] Traefik side effects to keep in mind.** `entrypoint.priority=10` lets any host's own `:80` router beat
  the https catch-all (Apache rule 2 is the backstop for Sporta). Any future www-to-apex redirect (Traefik template, Hostinger
  panel "force non-www") loops with Apache rule 1 forever. The apex regex matches only `http://sporta.com.kw` exactly, so a
  Host with an explicit port would fall to the catch-all (inferred, unmeasured).
- **A-7 [info, repo] No tool measures apex HSTS.** `dns-check.mjs:496-508` records `hsts=` only on the final 200 hop. Add it for
  each hop of the apex chains (not changed here: check only).
- **A-8 [info] ACME / certificate.** Traefik answers `/.well-known/acme-challenge/` itself on `web` (documented,
  `VPS-SCAN:445`; priority above the apex router). Repo Apache would 301 that path if it ever reached it (measured), so
  keep the challenge on Traefik. Cert covers both names, per-name vs wildcard accepted by `dns-check.mjs:476`; expiry
  24 Jan 2027 per the VPS scan, the DNS lane measured 82 days today.

Clean: cookies (4), CSP (5), hreflang/canonical/sitemap/robots (7), `?lang=` preservation, no leak of a second origin in
shipped output, no loop in the repo rules.
