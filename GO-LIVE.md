# Sporta — Go Live on www.sporta.com.kw

> **The live site is the VPS now — `187.7.78.123`.** `www.sporta.com.kw`
> resolves there: Traefik in front, the `apache-sporta` container behind it,
> serving `/docker/sporta/site`. Routes A and B below upload to the old
> shared-hosting account (`46.202.158.211`), which no visitor reaches any more,
> and `npm run publish` now refuses to run while that is true. Deploy with
> **Deploying to the VPS**, directly below.

## Deploying to the VPS

`scripts/vps-deploy.mjs` prints a one-shot Docker Compose job. It is started
on the VPS through the Hostinger API (project `sporta-deploy`); Claude runs it
from a session with the Hostinger connector — **`hostinger-vps`** in
`.mcp.json` (`mcp/hostinger-mcp.mjs vps`: Hostinger's own MCP server, pinned,
VPS operations only). It authenticates with an API token saved as the cloud
environment's network secret for `developers.hostinger.com`, so it never
lapses the way a claude.ai sign-in does; its calls ask before running. On the VPS the job downloads this
repository **at a pinned commit** from GitHub, builds it exactly as
`npm run release` does, runs the file audit, and compares every file with
what is live. No SSH, no deploy endpoint on the server, and no `curl`/`wget`
(the Hostinger API firewall refuses a job containing either word, or `require('fs')`; the job uses Node and an ES-module import).

| Step | Command | What it changes |
|---|---|---|
| Plan | `node scripts/vps-deploy.mjs compose --ref <commit>` | **Nothing** — the server is mounted read-only. Prints same / changed / new / live-only, the live health probes, headers and redirect hops. |
| Apply | `… compose --apply --ref <sha> --confirm <sha>` | Copies changed and new files in place, `index.html` last. Backs up everything it overwrites to `/docker/sporta/backups/`. |
| Undo | `… compose --rollback deploy-<stamp>-<sha7>` | Restores that backup and removes the files that deploy added. |
| Scope | add `--only api,knet,pay` to plan or apply | Compares and deploys only those folders. **Use it for now:** the live storefront (`index.html` + its bundle) is a different build whose source is not in this repo, with customer accounts, support, returns and a much larger admin. A whole-site apply over it is **refused** (the live page has no `sporta-build` marker) unless `--replace-storefront`. |
| Scan | `… compose --scan` | **Nothing.** `scripts/live-scan.mjs`: TLS, redirects, routes, headers, cache tiers, cookies, exposed files, SEO, the web root on disk. |
| Scan JSON | `… compose --scan json` | **Nothing.** `scripts/json-scan.mjs`: every API answer is JSON, labelled JSON, `nosniff` + `no-store`, carries no private field or trace, refuses bad input with a JSON 4xx; Arabic intact; no JSONP/CORS; both manifests and their icons; JSON-LD; no `.json`/`.map` in the web root. Its only POSTs are bodies refused at validation. |
| Scan ports | `… compose --scan ports --edge tcp/80@any,tcp/443@any,tcp/22@<ip>` | **Nothing.** `scripts/port-scan.mjs`: every TCP/UDP listener on the host from its own socket table, what it is bound to, who answers (SSH/MySQL/HTTP/TLS), the Hostinger firewall rules passed in `--edge` (read them from the API first), and the SSH banner. It cannot read sshd's settings: the Hostinger API refuses (403) a job that mounts them. |
| Scan KNET | `… compose --scan knet` | **Nothing — not even a log line.** `scripts/knet-scan.mjs`: `knet/` on disk (what must and must not be there, PHP syntax), what the internet can ask (`pay.php` refuses bad input; library, config and tools 403/404; HTTP→HTTPS), the private config run through the live `knet.php` and `pay.php`'s own validator (`scripts/knet-config-check.php` prints verdicts, never values), the bank host's DNS and TLS certificate, and the payment log summarised by counts. `callback.php` and a well-formed track id are never sent: both write to the payment log. |
| Scan backends | `… compose --scan backends` | **Nothing — and no sign-in attempt** (five failures lock the account). `scripts/admin-scan.mjs`: `/backends` and every script and chunk reachable from `index.html` exist; every protected `admin.php` route answers a signed-out request with 401 JSON; the sign-in steps refuse a request without `X-Sporta-Admin` before reading it; no-store, noindex, not frameable, robots.txt, no `/admin` alias; every `?r=` route the screens build is served, which admin routes have no screen, and whether the screens answer the MFA and forced-password-change steps the server can ask for. |
| Preflight | `node scripts/vps-preflight.mjs compose` (or `npm run vps:preflight`, which writes `ops/vps-preflight.compose.json`; regenerate it at release time, it embeds HEAD's add-on md5s and the script itself, nothing is fetched; `npm run test:vps-preflight` fails when the committed file is stale against HEAD) | **Nothing.** A separate project (`sporta-preflight`, two services) that checks the release gate's live requirements and prints `PREFLIGHT <name> OK\|WARN\|FAIL <reason>` lines, never a config value: `trusted_proxy_ips` covers `172.16.1.1` and that address is a host interface; `private/mail/password` present and readable by uid 33; `private/voice` owned by uid 33 and `admin-sessions` under it; the live `api/knet/pay` against a baseline commit (`--baseline`, default `1eb487aa`); every live add-on, `.htaccess` and font against HEAD with size and md5; and, from the database network in a READ ONLY session, the `outbox_kind_ck` CHECK, the 2026-09-30 cash order and what the first `cron-stock.php --release` would do, and every column, table and CHECK the migrations add, present or absent by name. Each service ends with `PREFLIGHT_DONE ok warn fail part=fs\|db`; `node scripts/vps-preflight.mjs verdict <saved log>` adds the two. `--part fs` / `--part db` give one service at a time. |

**Reading a deploy log.** The job prints numbered stages with the seconds since
it started (`== 2/4 compare (+41.0s)`; a plan has four, an apply six: build,
compare, live health, backup, copy, verify), running counts (`copied 25/137`),
and a `== SUMMARY` block (counts, backup name, the rollback command, the health
line) just before the marker. The markers are what to grep for: `PLAN_OK`,
`DEPLOY_OK`, `DEPLOY_FAIL`, `ROLLED_BACK`, `STOREFRONT`. When the live
`index.html` is a foreign build, an unscoped plan counts that bundle on one
`storefront:` line and lists none of its files, and the summary prints the
`--only` list of the release set it found (the backend folders, `.htaccess`,
`fonts`, the root `.js`/`.css` add-ons; other root files that differ are named
apart). That list is a scope, not a verdict: an add-on that calls a route or
reads a key the live backend lacks (`sporta-admin-brands.js` today —
`brand_products`, `brand_assign`, `abandoned_orders` are not in the live
`admin.php`) ships with the api release, never before it; the manifest under
`ops/release` decides per file. `--quiet` drops the per-file
lines; `--json` appends one `DEPLOY_JSON {...}` line (mode, result, stages,
counts, file names, backup, both health checks) — also when the job fails. The
Hostinger API keeps 300 log entries; a whole-site plan prints about 50 lines.

What apply will not do, ever: touch `config.js`, any `config.php`,
`.cbk_token.json` or a log; bring back the setup tools; write into the photo
folders (served from `/docker/sporta/private/media`); delete a live-only file.
It **refuses** when a PHP, HTML or `.htaccess` file would shrink below 70% of
its live size — older code over newer, which is how this repo breaks the live
site today — unless `--allow-shrink`. After copying it re-probes `/`, `/shop`,
`/checkout`, `/backends`, the products API and the entry chunk; anything that
answered 200 before and does not now is **rolled back automatically**.

Proven by `npm run test:vps-deploy` (100 checks: real plan/apply/rollback code
against a throwaway live tree served by PHP with the VPS config layout,
including a deploy that breaks the page and undoes itself, all five scans, the
stage and summary lines, `--quiet`, `--json`, and a foreign bundle of 439 files
counted on one line) and `npm run test:vps-preflight` (86 checks: the compose
file, then the embedded job on a fake `/sporta` tree with a private MariaDB
carrying the repository schema, every check OK in order and each planted fault
named, no canary secret in any output).

**A backend release, in order** (nothing reaches the VPS from a session without
the Hostinger connector): `npm run release` → `node scripts/file-audit.mjs dist`
→ `node scripts/vps-preflight.mjs compose` and read its two `PREFLIGHT_DONE`
lines (every FAIL fixed first; the live schema diff, `ops/db/SCHEMA-DIFF.md`,
before any code that touches a new column) → `compose --ref <sha> --only
api,knet,pay,.htaccess,<add-on names>` and read the plan → the same with
`--apply --confirm <sha>` → `DEPLOY_OK` in the log, then `--scan`,
`--scan backends`, `--scan knet` → move the baseline (`1eb487aa` in CLAUDE.md
item 5) to the deployed commit. Delete every one-shot project afterwards.

---

Everything below was written for the shared-hosting account and is kept for
reference. Pick **one** of the two routes only if that account serves the site
again.

> **Claude cannot reach your machine's network.** This sandbox has no route to
> SFTP/SSH (`46.202.158.211:65002`) or `https://www.sporta.com.kw`; it reaches
> the VPS only through the Hostinger API.

---

## Which route

**Route A — `npm run publish`.** Uploads over **FTPS**, which is a separate
Hostinger service from SSH and keeps working with SSH switched off. This is the
standing bridge. Needs Node and this repo on your machine.

**Route B — the zip.** A browser and nothing else. No Node, no npm, no terminal.

Both do the same thing. Use whichever you are near.

> There used to be a third route, `npm run deploy`, uploading over SFTP. SFTP
> rides on SSH, so it stopped working the day SSH was turned off, and it has
> now been deleted rather than left as a command that only ever errors. If SSH
> is ever re-enabled it is one `git revert` away — but `npm run publish` does
> the same job over FTPS and does not need it.

---

## Route A — `npm run publish` (FTPS, works with SSH off)

**Node 24 LTS ("Krypton")** is what this project is built and tested with. Node
22.12+ also works; older versions fail because Vite 8 needs modern ESM support.

```bash
cd sporta-web
npm install
cp .env.deploy.example .env.deploy
```

Open `.env.deploy` and fill in three lines from **hPanel → Files → FTP
Accounts**:

```
FTP_HOST=ftp.sporta.com.kw
FTP_USER=your-ftp-user
FTP_PASSWORD=your-ftp-password
```

**Not sure of the hostname?** Don't guess it — `ftp.sporta.com.kw` does not
exist. Run the doctor and it will tell you which one works:

```bash
npm run ftp:doctor              # try the likely hosts
npm run ftp:doctor -- --write   # save the one that works to .env.deploy
npm run ftp:doctor srv1814.hstgr.io   # or test the exact host hPanel shows
```

It reports each host as DNS → TCP → TLS → LOGIN → DIR, so the stage that fails
names the thing to fix: no DNS record means the hostname is wrong, a refused
login means the username or password is, and a missing directory means
`remoteDir` is. It never prints your password.

If every host that resolves also refuses port 21, that is usually your own
network blocking outbound FTP rather than the server — a phone hotspot is the
quickest way to tell.

Then, every time you want to publish:

```bash
npm run publish:dry    # show exactly what would change. Uploads nothing.
npm run publish        # do it
```

What it does, in order: regenerate the SEO files → production build **with the
`VITE_` variables emptied**, so nothing from your local `.env` is baked in and
the output matches the audited zip → bundle the KNET PHP endpoints → **run the
file audit and refuse to upload if it fails** → upload over explicit TLS, with
`index.html` sent **last** so a half-finished run leaves a working site rather
than a white screen → re-download `.htaccess`, `knet/.htaccess` and `index.html`
and compare them byte for byte. If any of those three is missing from the build
it refuses to publish at all, rather than skipping the check quietly.

It then tells you what is on the server that should not be — `index.php`,
`sporta-deploy.php` and the rest of the old site — because publishing never
deletes anything.

**`go-live.html`, `knet/selftest.php` and `knet/setup-config.php` are not sent.**
GO-LIVE tells you to delete them once the site is set up, and re-uploading them
every time would silently undo that. Pass `--setup-tools` on a first deploy when
you still need them.

**`config.js`, `api/config.php`, `knet/config.php` and `pay/config.php` are
never uploaded and never deleted.** They hold your live database and bank
credentials and exist only on the server.
That is hard-coded, not a setting, so no configuration mistake can overwrite
them.

**Why not a deploy script on the server?** Your `public_html` had one —
`sporta-deploy.php`, answering to anyone on the internet who asked. That is a way
in, not a bridge. FTPS adds no attack surface: Hostinger already runs the server
and authenticates it, and if the password ever leaks you delete the FTP account
in hPanel and make another.

---

## Route B — upload the zip (no tools, no terminal)

Use this if you have no shell on the server (`/sbin/nologin` on login) or no
project folder on your Mac. Nothing is installed and nothing is rebuilt.

1. Download **`SPORTA-GO-LIVE.zip`** and read `README-FIRST.txt` inside it.
2. Hostinger hPanel → **File Manager** → open `public_html`.
3. Upload everything inside the zip's `public_html/` folder.
4. In hPanel → **Databases → MySQL Databases**, create a database and a user
   and give that user all privileges on it. Note the four values.
5. In **phpMyAdmin → Import**, run the zip's `database-sql/` files **in their
   **one file — `database-sql/IMPORT-THIS-ONE.sql`** (the four parts joined in
   dependency order; nothing to get wrong). The numbered parts are still there
   if you ever need just one re-run: `1-schema.mysql.sql`, `2-seed.mysql.sql`,
   `3-brands.mysql.sql`, `4-promo.mysql.sql`.
6. Copy `public_html/api/config.example.php` to `api/config.php` and fill in
   those four values. The site cannot sell anything until this exists —
   the catalogue is empty and every checkout is refused.

Regenerate the zip any time with `node sporta-web/scripts/make-package.mjs`.

> ⚠️ **`.htaccess` is a hidden file.** Turn on "show hidden files" in File
> Manager (or your FTP app) and confirm it arrived. Without it you get no HTTPS
> redirect, no security headers, and `/shop` will show "404 Not Found".

---

## After uploading — 4 required steps

### 1. Create the payment config on the server

`config.php` is deliberately **not** in the package, because it holds live
credentials. With SSH off, create it in **File Manager**:

1. Copy `public_html/knet/config.example.php` to `public_html/knet/config.php`
2. Fill in the Tranportal ID, password and resource key from your bank, plus
   the four `mysql_*` values — the same database as `api/config.php`, which
   spells the same four keys `db_*`
3. Set its permissions to **600**
4. Open `https://www.sporta.com.kw/knet/selftest.php`

That last step matters. It catches the two mistakes that fail silently and cost
you money:

- **a resource key that is not exactly 16 bytes** — AES-128 needs 16, and one
  trailing space from a copy/paste makes KNET reject every transaction with no
  useful error message;
- **an orders database that is not actually reachable** — without one the
  server has no authority over the price, so `pay.php` has no amount to charge
  and refuses every card with a blunt `400 Invalid amount`. This is not
  hypothetical: it is exactly how the card path died when the shop moved to
  MySQL, and `npm run test:knet` exists to stop it happening again.

Delete `setup-config.php` and `selftest.php` from the server once every line
reads OK — both reveal configuration state.

<details>
<summary>If you re-enable SSH, there is a guided script instead</summary>

```bash
cd public_html/knet
php setup-config.php
```

It asks for the secrets, validates them, writes the file with the right
permissions, and proves the `products` and `orders` tables are readable before
it writes anything.
It refuses to run over HTTP. Note it cannot run if the account's login shell is
`/sbin/nologin`, even with SSH enabled.

</details>

### 2. Set up the database — three files, in order

hPanel → **Databases → phpMyAdmin → Import**, and run these one after another:

| File | What it does | If you skip it |
|---|---|---|
| `api/schema.mysql.sql` | every table, plus the triggers that price an order server-side | nothing works; the admin says the migration is not applied |
| `api/seed.mysql.sql` | the 46 products and the AHED stock | the catalogue is empty and **every checkout is refused** |
| `api/brands.mysql.sql` | the brands table and eight brands | the Brands screen has nothing to show |
| `api/promo.mysql.sql` | home slides, site settings, sale prices, discounts | the Slides, Promotions and Discounts screens say the migration is missing |

The order matters and getting it wrong fails *silently* — the storefront still
renders and checkout refuses everything. All three are safe to re-run: products
match on slug and variants on SKU, so prices and names update in place, nothing
duplicates, and **your stock counts are never overwritten**.

Then create your sign-in. Open

```
https://www.sporta.com.kw/api/setup-admin.php
```

It asks for the `cron_key` from `api/config.php` (so only someone who can
already read the server's config can use it), an email — any email, it does not
need a real inbox and it is not where order mail goes — and a password of at
least 12 characters. It refuses to run once an account exists, so it can
bootstrap but never add.

**Delete `api/setup-admin.php` from the server afterwards.** That email and
password are what you type at `https://www.sporta.com.kw/backends`.

### 3. Confirm the site is live and correctly configured

**Open `https://www.sporta.com.kw/api/preflight.php` first.** It is the fastest
answer to "why is the shop not working", because it checks the install from the
INSIDE — which is where every problem so far has been:

- PHP version and the four extensions the site needs.
- **Whether the upload actually landed**: it reads `index.html`, takes every
  hashed asset that file names, and checks each one is on the disk. A page that
  shows an orange bar, the logo and nothing else is this check failing.
- All four `.htaccess` files (the ones File Manager hides).
- `api/config.php`, and if MySQL refuses it, **which** of the four values is
  wrong.
- Every table imported, the catalogue seeded, an admin account existing, and
  whether that account is currently locked out.
- `knet/config.php` and `pay/config.php` — including the `mysql_*` block, whose
  absence refuses every card payment while the shop looks perfectly fine.
- Which setup tools are still on the server and should be deleted.

It writes nothing and prints no secret value. Before `api/config.php` exists it
answers openly, because there is nothing yet to protect; once it exists, the
database and payment sections need the `cron_key` from that file. **Delete
`api/preflight.php` when the shop is live** — `npm run publish` never puts it
back.

Then, from your own machine, the outside view:

```bash
./scan-server-response.sh
```

Everything should be green. It checks HTTPS, single-hop redirects, all security
headers, cookies, compression, the cache tier of every kind of file, real 404s,
directory listings, and that nothing sensitive is reachable — `.git`, `.env`,
`config.php`, the payment log, the CBK token, backup archives, and the old
site's `index.php`.

If it cannot reach the site at all it now says so and stops. It used to print a
page of green ticks for an unreachable host, because "this path must not return
200" passes when nothing answers.

Before deploying, the same questions can be asked of the build without a server:

```bash
cd sporta-web && npm run audit:storage
```

That stands up a real Apache with the production `.htaccess` and tries to fetch
every file that should never be served — including from a subdirectory, which is
where the rules are easiest to get wrong.

**`SERVER-LAYOUT.md` is the map**: what belongs in `public_html`, what must stay
above it (the payment log and the CBK token are credentials, and they live one
directory up), which folders may be cached for how long, and the file
permissions publish now applies.

### 4. Tell Google about it

- [Google Search Console](https://search.google.com/search-console) → add
  `www.sporta.com.kw` → **Sitemaps** → submit `sitemap.xml`
- [Bing Webmaster Tools](https://www.bing.com/webmasters) → same
- Request indexing for the home page to speed up first crawl

---

## Also worth doing

- **Email authentication** — add the SPF/DKIM/DMARC records in
  `DNS-EMAIL-RECORDS.txt`, or order confirmations from `@sporta.com.kw` will
  land in spam. Confirm your mail provider first.
- **Real product photos** — the biggest remaining gap. Product images are
  currently generated placeholders, which limits both conversion and Google
  Shopping eligibility.

---

## بالعربي — النشر على www.sporta.com.kw

**الطريقة الأولى (أمر واحد):** من جهازك، داخل مجلد `sporta-web`، انسخ
`.env.deploy.example` إلى `.env.deploy` وضع فيه بيانات FTP من هوستنجر
(hPanel ← Files ← FTP Accounts)، ثم نفّذ `npm run publish`. سيقوم بالبناء
والفحص والرفع والتحقق تلقائياً.

> الرفع يتم عبر **FTPS** وليس SFTP، وخدمة FTP منفصلة عن SSH — لذلك تعمل هذه
> الطريقة رغم أن SSH مغلق. ولن يُرفع أو يُحذف ملفا `config.js` و
> `knet/config.php` إطلاقاً، فهما يحملان بيانات الدخول الحقيقية.
> استخدم `npm run publish:dry` لمعاينة ما سيتغيّر دون رفع أي شيء.

**الطريقة الثانية (بدون أدوات):** حمّل ملف `SPORTA-GO-LIVE.zip`، وافتح
File Manager في هوستنجر، ثم ارفع كل ما بداخل مجلد `public_html` إلى مجلد
`public_html` على الخادم.

> ⚠️ ملف `.htaccess` مخفي. فعّل خيار «إظهار الملفات المخفية» وتأكد من رفعه،
> وإلا لن يعمل التحويل إلى HTTPS ولن تفتح صفحات مثل `/shop`.

**بعد الرفع:**

1. أنشئ ملف الدفع على الخادم من File Manager (SSH مغلق):
   انسخ `public_html/knet/config.example.php` إلى `public_html/knet/config.php`،
   واملأ القيم (بيانات Tranportal من البنك، وبيانات قاعدة بيانات MySQL)،
   واضبط صلاحياته على 600، ثم افتح
   `https://www.sporta.com.kw/knet/selftest.php` للتأكد.
   واحذف `setup-config.php` و `selftest.php` بعد الانتهاء.
2. **مهم جداً:** أنشئ قاعدة بيانات ومستخدماً لها من hPanel، ثم شغّل ملفات
   قاعدة البيانات في phpMyAdmin بالترتيب:
   `api/schema.mysql.sql` ثم `api/seed.mysql.sql` ثم `api/brands.mysql.sql`.
   ثم انسخ `public_html/api/config.example.php` إلى `api/config.php` واملأ
   بيانات قاعدة البيانات الأربعة — بدون هذا الملف لا يعمل المتجر إطلاقاً:
   القائمة فارغة ويُرفض كل طلب.
   و`seed.mysql.sql` يحمّل المنتجات بأسعارها الحالية، والسعر يُحتسب من قاعدة
   البيانات وليس من المتصفح.
   يمكن إعادة تشغيل كل الملفات بأمان: التطابق على `slug` فيُحدّث السعر
   ولا يكرّر المنتج، ولا يمسح كميات المخزون التي عندك.
   وأخيراً افتح `https://www.sporta.com.kw/api/setup-admin.php` لإنشاء حساب
   الدخول، **ثم احذف هذا الملف من الخادم**. تسجّل الدخول من
   `https://www.sporta.com.kw/backends`.
3. شغّل `./scan-server-response.sh` للتأكد أن إعدادات الخادم سليمة.
4. أضف الموقع في Google Search Console وأرسل `sitemap.xml`.

**مهم أيضاً:** أضف سجلات SPF/DKIM/DMARC الموجودة في `DNS-EMAIL-RECORDS.txt`
حتى لا تذهب رسائل تأكيد الطلبات إلى البريد المزعج. والصور الحقيقية للمنتجات
هي أهم ما تبقّى.

---

## What was verified before packaging

The **extracted zip** (not the source) was served through Apache 2.4 over TLS
and driven in a real browser:

| Check | Result |
|---|---|
| Public routes (home, shop, product, about, contact, cart, returns, track, wishlist, checkout) | all **200**, correct `<h1>` |
| Product grid | 20 products |
| Add to cart → cart | item present with KWD total |
| Arabic toggle | `dir="rtl"` |
| Unknown URL | real **404** (not a soft 404) |
| robots.txt / sitemap.xml / llms.txt | **200** |
| CSP violations | **0** |
| JavaScript errors | **0** |
| PHP endpoints (`pay`, `callback`, `knet`, `selftest`, `api`) | lint clean |

Then every file in the package was audited on its own terms
(`npm run audit:files`) — 43 files, 0.94 MB, **0 problems**. That audit now runs
inside `make-package.mjs` and refuses to write the zip if anything fails, so a
broken package cannot be produced by accident. It checks the things that go
wrong specifically on this route — Mac → browser file manager → Linux:

- a reference whose **case** does not match the file on disk (fine on macOS,
  a 404 on the server);
- a **byte-order mark before `<?php`**, which sends bytes before any `header()`
  and so stops `pay.php` redirecting to KNET — the payment dies at the last step;
- zero-byte files, editor droppings, `._` resource forks from zipping on a Mac,
  shipped source maps, CRLF in server-side scripts, invalid UTF-8 (half the site
  is Arabic), duplicate and orphaned files;
- `knet/config.php`, `.env` and `.env.deploy` present — must never ship;
- `index.html`, both `.htaccess` files, `config.js`, `robots.txt`, `sitemap.xml`,
  `site.webmanifest` and the four KNET endpoints absent — must always ship.

The audit was verified by fault injection rather than by passing: each of those
faults was deliberately introduced into a copy of the package and each was
caught. Two blind spots surfaced that way and were fixed — `site.webmanifest`
was being truncated to a phantom `/site.webma`, and the only reference to
`logo.png` on the whole site is a JSON-LD `"logo"` key, so renaming it produced
no warning at all.
