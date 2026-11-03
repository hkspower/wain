# Live security scan — 2026-11-03

**Target:** live `https://www.sporta.com.kw` on VPS `187.7.78.123` (Traefik -> `apache-sporta`
php:8.4-apache -> `/docker/sporta/site`, configs in `/docker/sporta/private/`).
**Mode:** black-box, signed out, read-only. **Asked for:** "scan api", "scan htaccess", "scan security
htaccess and config and api and admin". No secret value appears in this file.

**Handling:** the repo is public and this file names open weaknesses. Do items 1 to 3 of section 9 first.

## 0. What was scanned, and what was not

- **Five lanes**, each a node:24-alpine job on the VPS host network talking to Traefik on 127.0.0.1 with the
  real Host and SNI: `scans` (the repo's live/json/ports/knet/backends scans, a per-area header probe, the
  Hostinger edge-firewall rules), `htaccess`, `config` (mounted `/docker/sporta` read-only: names, modes, owners,
  hashes, key NAMES and verdicts only), `api` (public store API), `admin` (`/backends`, `admin.php`, n8n).
  Then an independent verification pass on the six findings the lanes rated medium.
- **Volume:** about 60 (scans header probe, plus the repo scans' own checks), 293 + 8 (htaccess), 181 (config),
  240 (api), about 215 (admin), under 40 (verifiers). GET, HEAD, OPTIONS and TRACE only. No POST/PUT/DELETE,
  no sign-in, no cron key, no credential-looking request, no 429 seen. The n8n webhook was not called.
- **Not scanned:** anything behind sign-in (admin, customer account); POST routes (order, discount, return,
  support, assistant); `/pay/callback.php` and `/knet/callback.php` (they write a log line); database contents;
  `sshd` settings (the Hostinger API refuses a job that mounts them); IPv6 from outside; the card gateways;
  rate-limit thresholds (never exercised); PHP source (a separate workflow); DNS, mail and CDN (separate probes).
- **Timing caveat, important for section 4:** the root `.htaccess` and header readings were taken BEFORE
  `deploy-20261103T104853Z-8bf6001` (10:48Z). Per CLAUDE.md that deploy changed `Permissions-Policy`
  `geolocation=()` to `geolocation=(self)` and put the build-filled CSP script hashes in. The lanes saw
  `geolocation=()` and `script-src 'self'` alone. This report was assembled from the lane results with no new
  live request, so those two items are "shipped per CLAUDE.md, not re-read".
- **Probe scripts** (all pushed to `claude/sporta-integration-tveo8b`, read-only, reusable):
  `sporta-web/scripts/sec-scans-headers.mjs` (18287e28), `sec-htaccess-scan.mjs` (66b85180, a42c2718),
  `sec-config-scan.mjs` (50a9ae54), `sec-api-scan.mjs` (feafe4af), `sec-api-slides.mjs` (679eadac),
  `sec-admin-scan.mjs` (bde7cb15).
- **Evidence grades used below.** *Verified* = a second agent reproduced it. *Corroborated* = two or three lanes
  captured it independently, no verifier run. *Single-lane* = one capture, not re-run.

## 1. Summary for the owner

**Nothing a stranger can read or change was found.** No config, log, token, backup, dump, source map or
directory listing is reachable by URL: of several hundred secret-looking paths tried, none answered 200 except
`config.js`, which is public by design. Every protected admin route refuses a signed-out caller. The public
API leaks no customer data or cost price. TLS 1.3, cookie flags and security headers are right, and the domain
spellings redirect in one hop. The edge firewall lets in only 80, 443 and SSH from one owner address. The live
PHP is byte-identical to commit `1eb487aa`.

| Grade | Critical | High | Medium | Low | Info |
|---|---|---|---|---|---|
| Verified | 0 | 0 | 2 | 3 | 0 |
| Corroborated (2+ lanes) | 0 | 0 | 0 | 5 | 0 |
| Single-lane | 0 | 0 | 0 | 12 | 13 |

**Act on first** (each is a one-liner; full list in section 9):

1. **Email cannot be sent** (medium, still open from 10-31). Create `/docker/sporta/private/mail/password`
   (owner `root`, group 33, mode 0440) holding the `cs@sporta.com.kw` mailbox password. Warehouse mail, admin
   password-reset mail and birthday mail all fail until then.
2. **n8n webhook `wain-file-tool` is still active** (medium). Archive the workflow in n8n (reversible), rotate
   `WAIN_TOOL_SECRET` and the old shared-hosting FTP password. N8N-SECURITY.md asked for this.
3. **Order dump and a `cron_key` copy sit readable on the host** (low, two minutes): `chmod 700
   /docker/sporta/backups`.
4. **Sporta AI's microphone is blocked by our own header** (low, verified in Chrome): in `public/.htaccess`
   change `microphone=()` to `microphone=(self)`.
5. **Hero photos that are not published can be downloaded** by id (low, verified): add `and active = 1` to the
   `slide_image` query. Ships with the API release, as does the fix for anonymous visitors being handed an admin
   session cookie (low).

## 2. Verified findings (reproduced by a second agent)

### V-1 [medium] Outgoing mail cannot work: `private/mail/password` is missing (STILL OPEN since 2026-10-31) — config-2

- **Where:** `/docker/sporta/private/mail/` (container `/run/sporta-mail/`, mounted `:ro`).
- **Evidence:** the directory is 0550 `root:33` and holds only `msmtprc` (0440 `root:33`, 321 B). `msmtprc` has
  no literal password; its only source is `passwordeval /bin/cat /run/sporta-mail/password`, and that file does
  not exist. The 10-31 report logged the matching `msmtp: cannot read output of '/bin/cat ...'` failure on a real
  `forgot_password`.
- **Impact:** warehouse order mail (rows stay queued in `fulfilment_outbox`), admin forgot-password mail, and
  birthday mail do not send. The only admin recovery path that needs no shell is dead. Not a data exposure.
- **Fix:** create the file as `root:33`, mode 0440, content = the mailbox password, no trailing newline. No
  restart: `passwordeval` runs on every send. Only root can create it (the directory is 0550 `root:33`).
- **Repro:** none by GET; run `SEC_MODE=keys node sporta-web/scripts/sec-config-scan.mjs` on the VPS with
  `/docker/sporta` mounted read-only (section "mail/").
- **Verifier:** fresh read-only job, same facts (mode, owner, sizes, `existsSync` false, mount `:ro`). Not
  checked: whether PHP falls back to `mail()` when `msmtp` fails (a code question). Confidence high.

### V-2 [medium] n8n webhook `wain-file-tool` is active: file read/patch/create over FTP, guarded by one shared secret — admin-2

- **Where:** the owner's n8n cloud instance, `POST /webhook/wain-file-tool`, workflow id `h1OODMNi0LS6yZes`
  ("أداة ملفات وين"), active, last updated 2026-08-28.
- **Evidence (n8n API, read-only):** `active: true`; the webhook node has no n8n authentication. The first node
  compares body field `secret` with the n8n variable `WAIN_TOOL_SECRET` (fails closed if the variable is empty;
  no longer a literal in the workflow). Modes `grep`, `patch`, `create`. The `project` field routes to
  `domains/sporta.com.kw/public_html`, `wainkw.com` or `almuhallab-code.com` on the OLD shared account, through
  one FTP credential. Writes are limited to html/js/css/json/txt/md/xml/svg/webmanifest and `.htaccess` (PHP
  handler directives refused). Reads of `config.php`, `.env`, `.htpasswd` and names containing "secret" or
  "credential" are blocked.
- **Impact:** anyone on the internet can POST to it; only the shared secret stands between a stranger and a
  read/write of the old account. That account no longer serves the domain, so the live VPS is not directly
  exposed. Residual risk: stale files or credentials still on the old account, and the day traffic returns there.
  The verifier also noted the read blocklist matches the filename ending, so an editor or backup copy such as
  `config.php.bak` or `config.php~` would not match (read from the node code, not tested).
- **Fix:** archive or unpublish the workflow (reversible; N8N-SECURITY.md section 1 asked for it). If it must
  stay: set the webhook node's Authentication to Header Auth, rotate `WAIN_TOOL_SECRET`, scope the FTP
  credential to one folder, and confirm the old FTP password was rotated.
- **Repro:** read-only via the n8n connector (`search_workflows`, `get_workflow_details`). Do not call the URL.
- **Verifier:** re-read the workflow; confirmed. Not known from outside: the secret's strength and rotation
  history, whether the old FTP login still works, what the old account still holds. Confidence high that it is
  active and unauthenticated at the n8n layer.

### V-3 [low] `Permissions-Policy: microphone=()` blocks the Sporta AI mic button — htaccess-1 (graded medium by the lane)

- **Where:** `sporta-web/public/.htaccess` line 379; sent on every page. The lane's live bundle check: both
  `AssistantPanel-*.js` chunks use `SpeechRecognition`, none uses `getUserMedia`.
- **Evidence:** live header (scans and htaccess lanes) lists `microphone=()`. The repo's `AssistantPanel.jsx`
  (lines 231-258) shows the mic button whenever the speech API exists.
- **Impact:** in Chrome, Edge and Android Chrome the button shows and fails at once with no permission prompt.
  A functional defect, not a vulnerability.
- **Fix:** line 379: `microphone=()` -> `microphone=(self)`. Keep camera, payment, usb and the rest empty.
  The `geolocation=(self)` half of the policy already shipped at 10:48Z.
- **Repro:** `curl -sI https://www.sporta.com.kw/ | grep -i permissions-policy`, then tap the mic in Chrome.
- **Verifier:** Chrome for Testing 153 (headless, mic permission granted, fake device), same page, header only
  changed: `microphone=()` -> `not-allowed`; `microphone=(self)` and no header -> `audio-capture` (the next
  stage, the headless box has no audio). So the policy gates speech recognition. Not proven end to end: real
  dictation after the fix; the verifier's own live-header probe never started.

### V-4 [low] KNET and T-Pay credentials are still the shipped example placeholders, both `env=test` (STILL OPEN since 2026-10-31) — config-1, scans-1 (graded medium by the lane)

- **Where:** `/docker/sporta/private/config/knet-config.php` and `pay-config.php` (container
  `/run/sporta-config/`); both 0600 `33:33` in a 0700 directory.
- **Evidence (verdicts only):** KNET `tranportal_id`, `tranportal_password`, `resource_key` equal the example
  literals; `resource_key` is 26 bytes, not 16, so `pay.php` refuses (`knet-scan`: "BAD pay.php would refuse
  every payment"). T-Pay `client_id`, `client_secret`, `encrp_key` equal the example. No `.cbk_token.json` ever
  written. `knet-payments.log` 976 B and `cbk-payments.log` 797 B, last written 2026-11-01. `/knet/pay.php` and
  `/pay/pay.php` GET -> 400 (door closed).
- **Impact:** fails closed, no stranger impact. Neither card path can take a payment. On 2026-10-31
  `checkout_config` hid KNET while credentials were placeholders. Nobody recorded the `methods` value this
  round, so a customer being offered a dead gateway is not ruled out.
- **Fix:** real credentials in the two private files (test card first, then `env` production), or keep
  `settings.checkout` knet/tpay false. The queued KNET/T-Pay merge changes the shape; rerun this scan after it.
  Settle now with one GET: `/api/api.php?r=checkout_config` (expect no `knet`/`tpay` in `methods`).
- **Verifier:** compared the live files with `config.example.php` and printed booleans and lengths only; all six
  secrets equal the example (a first line-based pass wrongly said `resource_key` differed; the literal compare is
  correct). Re-graded to low: nothing is reachable, the example values authenticate nowhere.

### V-5 [low] `slide_image` serves hero photographs that are not published — api-1 (graded medium by the lane)

- **Where:** `GET /api/api.php?r=slide_image&id=N`; source `dropin/php-store/api.php` lines 205-210 (query at
  206, unchanged from the live baseline `1eb487aa`).
- **Evidence:** `?r=slides` lists active ids 8, 9, 2, 3, 5, 6, 7. `slide_image` for ids 1, 4, 10, 11 (not
  listed) answered 200 `image/webp`, 436896 / 166582 / 68520 / 101734 B. ids 12-15 and 20 answered 404. The
  `v=` hash is ignored (`v=deadbeef` returns the same 94190 B as the real hash for id 8). Every 200 carries
  `Cache-Control: public, max-age=31536000, immutable`. The query is `select image from hero_slides where id = ?`
  with no `active` or hash condition; `?r=slides` does filter `active = 1`.
- **Impact:** a stranger can enumerate small ids and download every hero banner ever uploaded, including
  switched-off drafts and expired campaign art. Banners only, no credential or personal data. That ids 1/4/10/11
  are inactive is inferred from their absence in the active list.
- **Fix:** `api.php` line 206: `select image from hero_slides where id = ? and active = 1`; optionally require
  `substr(image_hash,1,16) = ?` against `v`, else 404. Mind the admin preview: `admin.php` around line 2317
  builds the same URL for its list, so previews of inactive slides need an admin-authenticated image route.
  Add a case to `native-backend-test.mjs`: inactive slide -> 404.
- **Repro:** `GET /api/api.php?r=slides` (note ids), then `GET /api/api.php?r=slide_image&id=1`, `id=4`, `id=10`.
- **Verifier:** rerun on the VPS, same bytes and statuses; confirmed. Confidence high.

## 3. Corroborated findings (seen by 2 or 3 lanes, no verifier run) — all low

### K-1 [low] Every anonymous call to `admin.php` is handed an admin session cookie — admin-1, scans-2, htaccess-7

- **Where:** `GET /api/admin.php?r=me`, `?r=orders`, `?r=login` and 77 of 79 routes (not `google_available`,
  not `/backends`).
- **Evidence:** `Set-Cookie: __Host-sporta_admin=<value withheld>; path=/; secure; HttpOnly; SameSite=Strict`
  on 200 and 401 answers, with no cookie sent. Flags are right. The live `admin.php`/`store.php` equal
  `1eb487aa`, whose `me` handler (line 88) calls `store_session_start()` before it knows who is asking. Repo
  HEAD `admin.php` lines 85-94 use `store_session_resume()`, which starts nothing without a cookie. SECURITY.md
  promises "no file and no cookie" for an anonymous call; live does not do that yet.
- **Impact:** probably one empty session file per request in PHP's default save path (swept 1 request in 100,
  `gc_maxlifetime` 1440 s). The admin lane's "345,000 files a day" is arithmetic on a throttle value (240/min)
  nobody measured, and nobody counted the files. The danger is the next release: the 30-day change gives
  `/var/lib/sporta/admin-sessions` a 30-day sweep, so unauthenticated sessions would live 30 days unless the
  resume fix ships with it. (The verifier's own run failed: the connector lost its sign-in.)
- **Fix:** ship `store_session_resume()` (already in repo HEAD) together with the 30-day release. Acceptance:
  signed-out GET of `?r=me`, `?r=orders`, `?r=login` sends no `Set-Cookie`. Settle the cost now with a read-only
  job that counts files in the container's `session.save_path`.
- **Repro:** `curl -si https://www.sporta.com.kw/api/admin.php?r=orders | grep -i set-cookie`.

### K-2 [low] Include files answer 200 instead of 403: `profiles.php`, `support.php`, `assistant.php` — htaccess-6, api-3, admin-4

- **Evidence:** `GET /api/profiles.php`, `/api/support.php`, `/api/assistant.php` -> 200, `text/html`, 0 bytes,
  `no-store`. Siblings `store`, `returns`, `crm`, `cron-auth`, `customer-auth`, `config-path` -> 403. The
  `FilesMatch` in `dropin/php-store/.htaccess` (unchanged since `1eb487aa`) does not list the three.
- **Impact:** they print nothing today. Each is an extra unauthenticated entry that runs library code outside
  its call path; any future top-level output becomes public. Same class as `config-path.php` (fixed 10-31).
- **Fix:** `api/.htaccess` line 9:
  `<FilesMatch "^(config\.php|config\.example\.php|store\.php|seo-config\.php|seo-runtime\.php|crm\.php|returns\.php|cron-auth\.php|customer-auth\.php|preflight\.php|setup-admin\.php|profiles\.php|support\.php|assistant\.php|.*\.sql)$">`
  They are loaded by `require` on the filesystem path (e.g. `cron-voice.php` loads `assistant.php`), which a
  403 over HTTP does not affect.
- **Repro:** `curl -s -o /dev/null -w '%{http_code} %{size_download}\n' https://www.sporta.com.kw/api/support.php`
  (expect `200 0` today).

### K-3 [low, latent] Admin Google sign-in returns to `/backends/`, which `.htaccess` answers with 404 — htaccess-8, admin-3

- **Evidence:** `GET /api/admin-google.php?action=start` -> 303 `Location: https://www.sporta.com.kw/backends/?google=unavailable`;
  `GET /backends/` -> 404 (SPA shell with a 404 status), `/backends` -> 200. Source: `admin-google.php` line 9
  (`$destination`) and line 22 build `/backends/?...`; `public/.htaccess` line 164 is
  `RewriteRule ^backends/+$ - [R=404,L]` (deliberate, against an old redirect loop).
- **Impact:** once Google sign-in is switched on (live `google_available` is false) every return from Google
  lands on a 404-status page. Whether the router still renders the admin was not tested.
- **Fix:** `admin-google.php` lines 9 and 22: `/backends/` -> `/backends`. Do not weaken the `.htaccess` rule.
- **Repro:** `curl -sI https://www.sporta.com.kw/api/admin-google.php?action=start`; `curl -s -o /dev/null -w '%{http_code}\n' https://www.sporta.com.kw/backends/`.

### K-4 [low] Apache-made error pages carry HSTS only — scans-5, htaccess-10

- **Evidence:** `/api/store.php`, `/api/config.php`, `/images/products/` (403) and redirects/410 show only
  `Strict-Transport-Security`, `Server: Apache`, `Content-Type`. No CSP, nosniff, X-Frame-Options,
  Referrer-Policy (the config denial adds `X-Robots-Tag`, `Cache-Control`). Every 200, the SPA 404 shell and PHP
  JSON errors carry the full set. Bodies are the stock 239-byte page, no version string.
- **Impact:** negligible (static text). Inconsistency only: such a page could be framed or sniffed.
- **Fix:** in `public/.htaccess` lines 331-333 use `Header always set` for `X-Content-Type-Options` and
  `X-Frame-Options`. Do not blindly convert `Referrer-Policy`: `api/.htaccess` sets a different value with plain
  `Header set`, and mixing `always` and plain can send the header twice on a 200. Test with `npm run
  audit:storage` (real Apache) before shipping.
- **Repro:** `curl -sI https://www.sporta.com.kw/api/store.php`.

### K-5 [low] The server IP and some HTTP aliases are not canonicalised in one hop — scans-6, htaccess-9

- **Evidence:** `http://187.7.78.123/backends` (or `/shop`) -> 301 to `https://187.7.78.123/...` (certificate
  name mismatch, then Traefik's own 404 `404 page not found`). Same for `Host: localhost`, `wain`, `mawsoool`,
  `almuhallab` and unknown hosts: they never reach this Apache. `http://sporta.com.kw/women` takes two hops
  (Traefik 301 to `https://www.../women`, then Apache 301 to `/shop?category=women`). Every other spelling is one
  hop, `//evil.example` and CRLF probes stay on www.
- **Impact:** CLAUDE.md promises a single hop to www for the IP; the VPS never does that. A browser sees a
  certificate warning. No cross-site leakage and no data exposure; SEO impact minor.
- **Fix:** optional Traefik catch-all router (low priority) redirecting any other Host to
  `https://www.sporta.com.kw${path}`, plus the http-to-www redirect middleware for the alias hosts. Or correct
  the wording in CLAUDE.md. Add the IP spelling to `live-scan.mjs`.
- **Repro:** `curl -sI -H 'Host: 187.7.78.123' http://187.7.78.123/shop`; `curl -sIL http://sporta.com.kw/women`.

## 4. `.htaccess`: live versus repo

Measured on the VPS before the 10:48Z deploy (see section 0). Live files: root `site/.htaccess` 27153 B, mode
644, owner 501:50, sha256 `ed4ebde78ea12907355ae7a350757780074fabd11ee50166b27406cf5a9f4c3d`; repo at a42c2718
27444 B, sha256 prefix `23b44cd7`. All four repo files load in Apache 2.4.58 (`httpd -t` Syntax OK).

| File | Live vs repo | Recommendation |
|---|---|---|
| `api/.htaccess` (3326 B, owner 0:0) | byte-identical to `dropin/php-store/.htaccess` (and unchanged in the repo since `1eb487aa`) | ship nothing now; edit E5 below goes with the API release |
| `knet/.htaccess` (3724 B), `pay/.htaccess` (4046 B) | byte-identical to `php-knet`, `php-cbk` | ship nothing; E3 below if wanted |
| `images/products/.htaccess` (100 B) | the media mount's own file (`Options -Indexes`, deny `php\|phtml\|phar\|cgi\|pl\|py\|sh`); no repo copy; `vps-deploy.mjs` treats `images/products/` as a media path | leave it; never overwrite |

Hunks in the root file (live as measured, repo at a42c2718, repo HEAD):

| Hunk | Live | Repo | Recommendation |
|---|---|---|---|
| H1 comment above the CSP | 4-line comment | 8-line comment | **ship** (comment only) |
| H2 CSP `script-src` | `'self'` | `'self' __SCRIPT_HASHES__` (placeholder filled by `csp-hashes.mjs` at postbuild) | **do not ship `public/.htaccess` raw**; ship only a built `dist/.htaccess`. Per CLAUDE.md the hash-filled one went live at 10:48Z; harmless because the live `index.html` has no inline script. Needed only if this repo's `index.html` goes live (it has two inline scripts, lines 189 and 437) |
| H3 `Permissions-Policy` geolocation | `()` | `()` at a42c2718, `(self)` at HEAD | **ship** (done at 10:48Z per CLAUDE.md; confirm with one GET) |

Live-only controls missing from the repo: none. Repo-only controls missing from live that matter for
security: none. Only drift: H1 to H3.

Edits that neither file has yet (from this scan), to bundle into the next `.htaccess` deploy:

| # | Edit | Finding | Recommendation |
|---|---|---|---|
| E1 | `public/.htaccess` line 379: `microphone=()` -> `microphone=(self)` | V-3 | **ship** |
| E2 | line 444 `FilesMatch`: add `map\|ini\|conf\|ya?ml\|csv\|xlsx\|pem\|key\|crt\|sqlite3?\|db\|toml\|inc\|dist\|phps\|lock` to the extension list and a name rule `^(error_log\|php_errors\|access_log\|debug)$`. Checked: `public/` contains no file with these extensions | htaccess-5 | **ship** (latent; today none exist on disk and `/error_log`, `/boot.js.map` answer 404) |
| E3 | `Header always unset X-Powered-By` (root 338, knet 27, pay 30) removes nothing PHP set (proved on Apache 2.4.58: `always` touches only the error-header table). Add plain `Header unset X-Powered-By` next to it, and put `expose_php=Off` in the Dockerfile image, not only `conf.d/92-sporta-errors.ini` | htaccess-4 | **merge by hand**, low |
| E4 | `Header always set` for nosniff and X-Frame-Options | K-4 | **merge by hand**, test first |
| E5 | `api/.htaccess`: add `profiles\|support\|assistant` (K-2). Optionally also `cron-[a-z]+\.php`: the host cron uses `docker exec php`, not HTTP. First confirm no n8n or other scheduler calls `cron-whatsapp.php` (not in the four host cron lines) by URL with a key | K-2, api-4 | **ship** the three names with the API release; the cron deny **merge by hand** after that check |

## 5. Single-lane findings (one capture, not re-run)

Fix text is exact where a line or command is meant; "settles it" says what would turn each into verified or refuted.

### Low

| ID | Finding and evidence | Fix | Settles it |
|---|---|---|---|
| scans-3 | `sshd` settings unread (the Hostinger API refuses jobs that mount them). `PasswordAuthentication` and `PermitRootLogin` unverified. SSH is open at the edge to ONE owner address only (address not recorded here: public repo). | on the VPS run `sshd -T`; want `passwordauthentication no`, `permitrootlogin prohibit-password` or `no`; optional fail2ban | a person with a shell runs it. Confidence high |
| scans-4 | Unneeded host listeners: CUPS tcp 631 (loopback), tcp 11434 and 65529 (loopback), udp 1721, mDNS udp 5353 on every interface. All dropped at the edge or loopback only, owners not identified. | `systemctl disable --now cups cups-browsed avahi-daemon`; find the owners of udp 1721, tcp 65529, tcp 11434 with `ss -lntup` | host shell. Confidence medium |
| htaccess-2 | CSP and `index.html` are coupled: this repo's `index.html` has two inline scripts that pass only through hashes; raw `public/.htaccess` and the current `dist/.htaccess` still hold `__SCRIPT_HASHES__`. Live is unaffected. After the 10:48Z deploy the live file probably carries hashes. | never ship `public/.htaccess` raw; make `file-audit.mjs` refuse an artifact still containing `__SCRIPT_HASHES__`; or move the inline scripts to files like the live `boot.js` | `grep -c __SCRIPT_HASHES__ sporta-web/dist/.htaccess`; re-read live CSP. Confidence high |
| htaccess-4 | see E3 above | E3 | local Apache rig (done by the lane) |
| htaccess-5 | see E2 above | E2 | local Apache rig (done by the lane) |
| api-2 | `GET /api/api.php?r[]=products` and `r[a]=products` -> 500 `{"error":"failed"}`. Cause: `api.php` line 24 `$r = $_GET['r'] ?? ''` then `array_key_exists($r, ...)` throws a TypeError, before the rate-limit check and after the DB connection opens. No path or trace leaks. | `$r = is_string($_GET['r'] ?? null) ? $_GET['r'] : '';` | the GET above. Confidence high |
| api-4 | Cron scripts are public HTTP doors, keyless GET -> 403 (`cron-birthday` text, others JSON). Gate is `hash_equals` on `$_GET['key']`, no throttle. A leaked key would let a stranger run the stock release / 24 h COD cancel, warehouse mail, WhatsApp run or TTS spend. | E5 optional cron deny | confirm no external caller uses the URL. Confidence medium |
| config-3 | Current `cron_key` sits in two backup copies of `api-config.php`: `backups/claude-20261031T1325Z/` (0440 `root:33`, directory 0755) and `backups/manual-20261102T1612Z-rate-limit-secret/` (0600, dir 0700). Not mounted in any container, not under `site/`. | `chmod 700 /docker/sporta/backups/claude-20261031T1325Z`; delete both copies after the 10-31 and 11-02 changes are accepted | host shell. Confidence high |
| config-4 | `backups/claude-20261031T1515Z/orders-stock.sql.gz` is 0644 in a 0755 directory: customer names, phones and addresses readable by any local host user. HTTP: 403/404. | `chmod 700 /docker/sporta/backups` (the deploy job runs as root) or `chmod 600` the dump | host shell. Confidence high |
| config-5 | Duplicate gateway configs the resolver never reads: `private/knet-config.php` (3643 B), `private/pay-config.php` (4172 B), four more under `rollback/*/private/`, and an old setup tool `private/go-live.html.saved-20261026` (0744). All 0600 or private, values equal the example today. | delete the two strays and the saved tool; keep `rollback/` at 0700 and prune it after the release gate | host shell. Confidence high |
| config-6 | `knet-config.php` holds its own literal `mysql_*` copy of the DB name, user and password; api and T-Pay read `/run/secrets`. Equal today. A DB password rotation would leave KNET on the old one (the documented "400 Invalid amount" trap). | delete the four `mysql_*` lines (the code borrows the store's `db_*`) or use the same `file_get_contents('/run/secrets/...')` expressions | host shell. Confidence high |
| config-7 | Docs say the config mounts are read-only; the compose override mounts `private/config` (-> `/run/sporta-config`), `private/voice` and `site/` read-write (`api-config.php`, `mail`, `db_*` are `:ro`). `private/config` must be writable for admin Payments > Save. `site/` is owned by uid 501 and no file belongs to www-data, so the app cannot write its web root or code (held). | correct three docs (`config-path.php` header, CHECKOUT-SECRETS.md, CLAUDE.md item 4); in `knet_gateway_url` and the CBK base-URL handling pin hosts to `kpay.com.kw`, `kpaytest.com.kw`, `pg.cbk.com`, `pgtest.cbk.com` | read `/docker/apache/docker-compose.yml` (the scan saw the override copy only). Confidence medium |

### Info

| ID | Observation | Note / fix |
|---|---|---|
| scans-7 | The VM has an IPv6 address; sshd, 80 and 443 listen on `::`. Nothing shows the firewall group covers IPv6. | From an IPv6 host outside the allowlist: `nc -6 -vz <vm-ipv6> 22` must time out. Else enforce with ip6tables/ufw. Confidence low |
| scans-8 | CSP is strong (no script `unsafe-inline`, no wildcards) but `style-src` keeps `'unsafe-inline'` and Typekit hosts. | Drop `typekit.net` if unused (fonts are self-hosted). Keep inline styles until React's are gone |
| htaccess-11 | `seo-page.php` HTML inherits `Referrer-Policy: no-referrer` from `api/.htaccess`; CORP `same-origin` is on `logo.png`, `og-image.png`. Outbound links lose Referer; a webmail hot-linking the logo is blocked. | If wanted: a `Files` block in `api/.htaccess` for `seo-page.php`; `cross-origin` for the logo and og-image |
| htaccess-12 | No `/.well-known/security.txt` (404). HSTS has `includeSubDomains` but no `preload`. Host `srv2058651.hstgr.cloud` answers `Server: nginx/1.30.6` (not our site). | Add `security.txt`; add `preload` only if every subdomain is HTTPS; hide the nginx version |
| htaccess-13 | Repo `.htaccess` route list holds `account`, `support`, `exchange` (live-storefront routes with no screen in this repo's `App.jsx`: soft 404 on a repo build). `sporta-html5/.htaccess` (not live) is weaker (`script-src 'unsafe-inline'`, no `.json/.md/.zip` deny). | The first is the known backlog. Port the deny list if the html5 fallback ever ships |
| api-5 | `?r=stock` is public: 167 rows `{slug,size,sku,stock,in_stock}`, exact counts (max 10), SKUs. No cost column; no row for a missing product (the 11-02 finding is fixed). By design (shop-window data). | If unwanted: return a capped bucket (`min(stock,5)`) and drop `sku` |
| api-6 | Live `?r=brands` rows have 5 keys; the repo adds `products` and hides empty brands. Live products and stock JSON equal the source exactly. | Repo is ahead of the live baseline; recheck after the backend release |
| api-7 | `?r=status` and `?r=invoice` are safe against enumeration (22 impossible ids each: identical body, hash and about 12 ms). Source only: `?r=order` accepts a client `track_id` of 6 to 30 alphanumerics; the shipped client makes about 64 bits; a hand-built client could send 6 characters, and the invoice shows name and full address. | Mint the track id server-side or require 16+ characters. Cannot be tested read-only. Confidence low |
| config-8 | All 8 media directories are 0755 `501:50`; PHP runs as www-data (33). `product_image_upload` (CLAUDE.md) writes into `private/media/products`, so it would fail to write (safe direction; `products/.htaccess` denies php/phtml/phar/cgi/pl/py/sh). | Before using the bulk photo uploader: `chown 33:33 /docker/sporta/private/media/products` only. Route not exercised. Confidence medium |
| config-9 | 194 macOS `._*` files in the media mounts (30 sampled: 403). Not valid images. | `find /docker/sporta/private/media -name '._*' -delete` |
| config-10 | Live `config.js` (1253 B, public, no secret) still has the `backend` key, as the live build expects. `private/voice` is 0755; the future `admin-sessions` directory does not exist. | When the 30-day sign-in ships create it 0700 and its files 0600 |
| admin-5 | Live `admin.php` has 79 routes, repo 81 (repo-only: `brand_products`, `brand_assign`). No live-only routes. The scan's "routes no live screen names" line is a false positive of its method. | Drift as documented; rerun `sec-admin-scan.mjs` after the API release |
| admin-6 | The live bundle still ships `AdminPasscode-*.js` (device-passcode unlock, gone per CLAUDE.md) and `sw.js` pre-caches it. Every `/backends/<anything>` returns the same SPA shell. | Drop the chunk at the storefront rebuild; confirm the `noindex` header covers sub-paths |

## 6. Refuted or re-graded

- **Refuted: none.** Five of the six verifier runs reproduced their finding; the sixth (K-1) could not run
  because the connector lost its sign-in, so K-1 rests on three lanes' own captures plus the source.
- **Re-graded down by verifiers:** V-3 mic header medium -> low (functional, not a vulnerability); V-4 placeholders
  medium -> low (fails closed, values are public example text); V-5 `slide_image` medium -> low (banners only);
  K-1 anonymous cookie medium -> low (cost unmeasured, verifier's own run failed). V-1 and V-2 stay medium.
- **Method noise, not findings:** the api scan's keyword flags (`notice` in `notice_en`, `api.php?r=slide_image`
  inside a slide URL); the admin scan's "routes no live screen names"; the first line-based compare that said
  `resource_key` was not the example (the literal compare is right). The verifier's remark that `wp-config.php`
  would slip past the n8n read blocklist is left out: it ends in `config.php`, so it probably does not.

## 7. What held (clean checks)

- **scans:** live-scan `SCAN_DONE bad=0 warn=0`; json-scan `bad=0 warn=0`; backends-scan `bad=0 warn=0`; port-scan
  `bad=0 warn=1` (sshd, scans-3); knet-scan `bad=4 warn=2` (V-4 only; mode 600, log outside the web root, URLs on
  the canonical origin, DB block present, bank certificate valid to Dec 14 2026). TLS 1.3 with h2, TLS 1.0/1.1
  refused, Let's Encrypt cert valid 82 days. Four redirect spellings one hop. Cache tiers right (assets
  immutable, `config.js`/`sw.js`/`boot.js` no-cache, `/api` `/knet` `/pay` no-store). No cookie on `/`. Only 22
  (one address), 80, 443 are public; 53, 631, 11434, 11435, 65529 loopback; no Docker API on 2375/2376; MariaDB
  not published on the host. Firewall group "KVM4 Restricted Web Firewall" synced, rules as the port scan assumes.
- **htaccess:** no secret or source exposed (`.env`, `.git/*`, `.htaccess`, `.htpasswd`, `.DS_Store`,
  `.cbk_token.json`, the three `config.php` and their `.bak/.save/.old/~/.phps` variants, include files, `*.sql`,
  `*.zip`, `*.log`, `*.md`, `*.json`, `package.json`: all 403/404; probe FLAGGED none). Path tricks fail (case,
  encoded and double-encoded dots, `%00`, `%20`, trailing dot, `;`, PATH_INFO, `//`). MultiViews off. Every
  directory listing 403 (`/images/`, `/assets/`, `/api/`, `/knet/`, `/pay/`, `/cats/`, `/fonts/`, `/hero/`,
  `/icons/`). No `.map` on disk or served. Nothing world-writable under `site/`. All 22 add-on files `no-cache`
  (the immutable pattern does not catch them). TRACE 405; no CORS headers; HEAD equals GET; forwarded and
  rewrite headers have no effect; CRLF and `//evil.example` probes stay on www. Headers on 200s and on PHP
  errors are complete; `X-Powered-By` absent; `Server: Apache` without a version.
- **config:** 181 GETs, 131 x 403, 49 x 404, only `config.js` 200. Configs outside the web root: `api-config.php`
  0440 `root:33`; `knet-config.php`, `pay-config.php` 0600 `33:33` in a 0700 directory; `db_name/db_user/db_pass`
  0600 `33:33`; `mail/` 0550. Payment logs 0600 `33:33` in `/var/lib/sporta`, outside the web root. Container
  environment carries three path variables only; DB credentials are `:ro` secret files. **CLAUDE.md's baseline
  claim holds: all 34 PHP files under `api/`, `knet/`, `pay/` are byte-identical to `1eb487aa`** (0 differ, 0
  unknown); no unknown PHP, no webshell signature, no PHP in media paths. `site/` 0755 `501:50`, files 0644, no
  symlink, no setuid among 5401 entries. No leftover setup tool on disk. `vps-deploy.mjs` never copies a config.
  `cron_key` present (32 to 63 hex), `rate_limit_secret` present (64+ hex), `trusted_proxy_ips` set,
  `cod_hold_hours` absent (code default). DB password is not a literal in api or T-Pay config.
- **api:** no PII, token, path or SQL text in any public JSON; products carry exactly the 19 expected keys, no
  cost/supplier/note fields. `status` and `invoice` leak nothing for 22 impossible ids (identical bodies and
  timing, no warning for `id[]=` or NUL). `review_invite`/`say` reveal nothing. No CORS header for any Origin,
  OPTIONS grants nothing, no `Set-Cookie` from public GETs, JSON routes `no-store`. Quote-breaking, 10 KB,
  Arabic, RLM, NUL and array probes give clean 404/400 (the one 500 is api-2). TRACE 405; over-long URL 414.
  Include and data files in `/api/` 403 except K-2. Customer and birthday endpoints 401 signed out. No rate-limit
  trigger at about 25 requests per bucket (limits not exercised).
- **admin:** every live route signed out answers 401 `not_signed_in` except `google_available` (200
  `{available:false}`) and `me` (200 `null`); no trace, no path, `no-store`. The repo's backends scan lists 75
  routes (67 behind the wall), the admin lane read 79 (77 x 401); they use different route lists. 34 URL variants refused cleanly. No CORS
  for `evil.example` or `null`; OPTIONS on a protected route 401. CSRF header enforced on login, login_code,
  logout, forgot_password, reset_password, change_initial_password. `/backends`: CSP `script-src 'self'`,
  frame-ancestors `'self'`, `noindex` header and meta, no cookie, no reflection; `/admin`, `/wp-admin`,
  `/administrator`, `/admin.php`, `/backends/` all 404; `/panel.php` 302 to `/backends` only. Admin JS: 59 files,
  no key, token, private key, sourcemap or secret; the browser keeps no admin token in storage. Session cookie:
  `__Host-` prefix, `Path=/`, Secure, HttpOnly, SameSite=Strict. Live `api/` PHP not writable by the web server.
  No user-enumeration difference in any unauthenticated GET.

## 8. Earlier reports and project docs: status now

| Item | Source | Status 2026-11-03 |
|---|---|---|
| `/.well-known` 403 blocks the Hostinger domain check | 10-31 | **fixed**, now 404 |
| Old-site URLs 404 (`/women`, `/privacy-policy`) | 10-31 | **fixed** for `/women` (301 to `/shop?category=women`, two hops over HTTP, K-5); `/image/cache/...` not retested |
| `/api/config-path.php` 200 | 10-31 | **fixed**, 403 (seen by four lanes) |
| 355 `._*` files in `site/` | 10-31 | **fixed** in `site/`; 194 remain in the media mounts, all 403 (config-9) |
| Old `api-config.prev/next/failed` copies | 10-31 | **fixed**; two newer backup copies carry the current `cron_key` (config-3) |
| `X-Powered-By: PHP/8.4.x`, `display_errors` on | 10-31 | **fixed** (`expose_php=Off`); no warning or path anywhere; not in the Dockerfile (E3) |
| `cron_key` empty; `rate_limit_secret` unset | 10-31, 11-02 | **fixed**, both present |
| KNET/T-Pay credentials are example placeholders | 10-31 | **STILL OPEN** (V-4); checkout hiding KNET not re-read |
| `private/mail/password` missing, email dead | 10-31, 11-02 | **STILL OPEN** (V-1) |
| Checkout 500 (live DB lacked `inventory.mysql.sql`) | 11-02 | **fixed 11-02**; this scan placed no order; `?r=stock` now matches the catalogue |
| Admin session swept after about 24 min (`gc_maxlifetime` 1440 s); 30-day sign-in | 11-02 | **not shipped** (as CLAUDE.md says); K-1 must ship with it |
| `?r=stock` publishes exact quantities | 11-02 | unchanged, by design (api-5) |
| N8N-SECURITY.md 1: archive deploy bridge and file tool | N8N-SECURITY | bridge **gone**; `wain-file-tool` **STILL ACTIVE** (V-2) |
| N8N-SECURITY.md 2 and 4: Sporta Shell, Sporta DB, host-check | N8N-SECURITY | **gone** from n8n; Events Hub inactive |
| N8N-SECURITY.md 3: rotate the FTP password | N8N-SECURITY | **unknown**, confirm (V-2) |
| N8N-SECURITY.md 5: placeholder secrets | N8N-SECURITY | file-tool secret is now an n8n variable (strength unknown) |
| The eight scheduled n8n agents | N8N-SECURITY | **not reviewed then, not reviewed now** |
| SECURITY.md: anonymous `?r=me` makes no file and no cookie | SECURITY.md | **true in the repo, false live** until the API release (K-1) |
| CLAUDE.md: server IP 301s to www in one hop | CLAUDE.md | **false on the VPS** (K-5) |
| CLAUDE.md/CHECKOUT-SECRETS.md: config mounts read-only | docs | **partly false**: gateway config dir, `voice`, `site` are rw (config-7) |
| CLAUDE.md item 5: live PHP equals `1eb487aa` | CLAUDE.md | **true** (34 of 34 files) |

## 9. Action list, in order

1. **Mail:** create `private/mail/password` (V-1). Then send one real forgot-password to prove it (owner-run).
2. **n8n:** archive `wain-file-tool`; rotate `WAIN_TOOL_SECRET`; rotate the old FTP password and check its login
   is dead (V-2).
3. **Host permissions:** `chmod 700 /docker/sporta/backups`; delete the two `api-config.php` backup copies once
   the 10-31 and 11-02 changes are accepted (config-3, config-4).
4. **Confirm checkout:** one GET of `/api/api.php?r=checkout_config`, expect no `knet`/`tpay` in `methods`. Decide
   the KNET credentials inside the queued KNET/T-Pay merge (V-4).
5. **Next `.htaccess` deploy** (`--only .htaccess,api` plus the add-ons you need): E1 microphone, E2 deny list, E5
   three include names, E3 `X-Powered-By`; `public/.htaccess` raw is not shippable (H2). Re-measure the live root
   file first: it changed at 10:48Z. Check with `sec-htaccess-scan.mjs` (files mode) and one `curl -sI`.
6. **With the API release** (behind the review gate): `store_session_resume()` with the 30-day session (K-1),
   `slide_image` `and active = 1` plus hash check and an admin image route (V-5), the `$_GET['r']` string guard
   (api-2), `admin-google.php` return without the slash (K-3). Acceptance: rerun `sec-admin-scan.mjs`,
   `sec-api-slides.mjs` and `sec-api-scan.mjs`.
7. **Host hygiene** (needs a shell): `sshd -T`; disable cups/avahi; identify udp 1721, tcp 65529, tcp 11434;
   test the firewall over IPv6 (scans-3, scans-4, scans-7).
8. **Before the bulk photo uploader:** `chown 33:33 /docker/sporta/private/media/products` (config-8). Tidy:
   delete `._*` in the media mounts, the stray gateway configs, and the KNET `mysql_*` literals (config-5, 6, 9).
9. **Optional:** Traefik catch-all for the IP and unknown hosts (K-5); `Header always set` for nosniff and
   X-Frame-Options (K-4); `security.txt`; drop Typekit from the CSP if unused.
10. **Clean up scratch jobs:** run `vps_docker_list` on VM 2058651 and delete any `sporta-sec-*` project still
    listed. Known to check: `sporta-sec-config-st3`, `-bs3`, `-tg3`, `-md3`, `-k2`, `-l2`, `-s2`, `-h2` (exited);
    `sporta-sec-verify-admin1c` (NOT deleted; sleeps 60 s then exits); `sporta-sec-verify-admin1`, `-admin1b`
    (delete delayed); `sporta-sec-verify-htaccess1` (delete unconfirmed); `sporta-sec-vfy-api1`, `-api1b`.
