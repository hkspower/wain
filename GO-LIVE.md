# Sporta — Go Live on www.sporta.com.kw

Everything here has been built and verified. Pick **one** of the two routes
below. Route A is one command; Route B needs no tools at all.

> **Claude cannot deploy for you.** This sandbox has no network route to your
> host — SFTP/SSH (`46.202.158.211:65002`) and `https://www.sporta.com.kw` are
> both blocked by the environment's egress policy. Every file is ready; the
> upload is the one step that must happen from your machine.

---

## Which route

**Route A needs SSH enabled** in hPanel — `npm run deploy` uploads over SFTP,
which rides on SSH. With SSH switched off, Route A cannot run at all; that is
not a fault, it just means Route B is your path.

**Route B needs nothing** — a browser, and the zip. No Node, no npm, no
terminal, no SSH. It is the whole go-live.

---

## Route A — one command (needs SSH enabled)

**Node 24 LTS ("Krypton") is what this project is built and tested with.**
Node 22.12+ also works; older versions will fail because Vite 8 needs modern
ESM support. `nvm use` picks the right one automatically — the version is
pinned in `.nvmrc`.

```bash
node -v          # expect v24.x
nvm use          # if you use nvm; installs from .nvmrc
```

From your Mac, once:

```bash
cd sporta-web
npm install                      # installs deploy deps too
cp .env.deploy.example .env.deploy
```

> `npm install` may print a warning that an install script for `ssh2` was
> blocked — npm 11 blocks them by default. **This is expected and safe to
> ignore.** That script only builds an optional native CPU-feature addon;
> ssh2 falls back to its JavaScript implementation and the deploy works
> normally. It was verified on Node 24 with the script left blocked.

Open `.env.deploy` and put in your Hostinger SSH password (hPanel → Advanced →
SSH Access — the same page where SSH is switched on). Then, every time you want
to publish:

```bash
npm run deploy
```

That runs: regenerate SEO files → production build → bundle the KNET PHP
endpoints → upload over SFTP → verify `.htaccess` hash, critical files and a
live healthcheck.

Check `deploy.config.json` once before the first run — confirm `ssh.user` and
`ssh.port` match what hPanel shows.

`mirror` is **off**, so nothing already on the server is deleted. That is
deliberate for a first deploy: it protects `knet/config.php`, which holds your
live Tranportal credentials and is never uploaded.

---

## Route B — upload the zip (no tools, no terminal)

Use this if you have no shell on the server (`/sbin/nologin` on login) or no
project folder on your Mac. Nothing is installed and nothing is rebuilt.

1. Download **`SPORTA-GO-LIVE.zip`** and read `README-FIRST.txt` inside it.
2. Hostinger hPanel → **File Manager** → open `public_html`.
3. Upload everything inside the zip's `public_html/` folder.
4. **Edit `public_html/config.js`** — paste your Supabase Project URL and
   *anon* key. This is the whole configuration step; the site cannot sell
   anything until it is done, and checkout will say "Online ordering is
   temporarily unavailable" until it is.
5. Run the five files in the zip's `supabase-sql/` folder, in order, in the
   Supabase SQL Editor.

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
2. Fill in the five values (Tranportal ID, password and resource key from your
   bank; your Supabase URL and **service** key)
3. Set its permissions to **600**
4. Open `https://www.sporta.com.kw/knet/selftest.php`

That last step matters. It catches the two mistakes that fail silently and cost
you money:

- **a resource key that is not exactly 16 bytes** — AES-128 needs 16, and one
  trailing space from a copy/paste makes KNET reject every transaction with no
  useful error message;
- **the Supabase _anon_ key pasted where the _service_ key belongs** —
  row-level security then blocks order creation, so checkout fails for every
  customer.

Delete `setup-config.php` and `selftest.php` from the server once every line
reads OK — both reveal configuration state.

<details>
<summary>If you re-enable SSH, there is a guided script instead</summary>

```bash
cd public_html/knet
php setup-config.php
```

It asks for the five secrets, validates them, writes the file with the right
permissions, and checks that your `products` and `orders` tables are reachable.
It refuses to run over HTTP. Note it cannot run if the account's login shell is
`/sbin/nologin`, even with SSH enabled.

</details>

### 2. Run the database migrations — checkout does not work without them

In the Supabase SQL editor, run these in order (each is safe to re-run):

```
supabase/schema.sql
supabase/admin-migration.sql
supabase/checkout-migration.sql
supabase/passcode-migration.sql
supabase/seed-products.sql
```

`checkout-migration.sql` is the one that makes checkout work at all. It adds
`create_order`, the single guarded function that creates an order, validates
the delivery address, and prices the cart from the products table. Until it is
run, the browser cannot create an order and every shopper hits
**404 Unknown order** at the moment they press Pay.

`passcode-migration.sql` creates the admin quick-unlock table and its three
RPCs. Without it the admin's passcode screen cannot work.

`seed-products.sql` loads all 20 products with their current prices. Orders are
priced from that table, so until it is loaded every checkout is refused with
"this item is currently unavailable". It matches on slug, so re-running it
updates prices in place and never duplicates — and it never overwrites a real
product photo URL you have added. (**Admin → Catalogue → Push products** does
the same thing from the browser if you prefer.)

To verify all five landed, the admin Catalogue screen should report every
product "in sync".

### 3. Confirm the site is live and correctly configured

```bash
./scan-server-response.sh
```

Everything should be green. It checks HTTPS, single-hop redirects, all security
headers, compression, caching, real 404s, and that `.git`/`.env`/`config.php`
are not exposed.

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
`.env.deploy.example` إلى `.env.deploy` وضع فيه كلمة مرور SSH من هوستنجر، ثم
نفّذ `npm run deploy`. سيقوم بالبناء والرفع والتحقق تلقائياً.

> الطريقة الأولى تتطلب تفعيل SSH في هوستنجر، لأن الرفع يتم عبر SFTP.
> إذا كان SSH مغلقاً فاستخدم الطريقة الثانية — وهي لا تحتاج أي أدوات.

**الطريقة الثانية (بدون أدوات):** حمّل ملف `SPORTA-GO-LIVE.zip`، وافتح
File Manager في هوستنجر، ثم ارفع كل ما بداخل مجلد `public_html` إلى مجلد
`public_html` على الخادم.

> ⚠️ ملف `.htaccess` مخفي. فعّل خيار «إظهار الملفات المخفية» وتأكد من رفعه،
> وإلا لن يعمل التحويل إلى HTTPS ولن تفتح صفحات مثل `/shop`.

**بعد الرفع:**

1. أنشئ ملف الدفع على الخادم عبر SSH:
   `cd public_html/knet && php setup-config.php`
   سيطلب منك خمس قيم فقط (بيانات Tranportal من البنك، ورابط ومفتاح Supabase)،
   ويتحقق منها ويكتب الملف بالصلاحيات الصحيحة. احذف `setup-config.php` و
   `selftest.php` بعد الانتهاء.
2. **مهم جداً:** شغّل ملفات قاعدة البيانات في Supabase بالترتيب:
   `schema.sql` ثم `admin-migration.sql` ثم `checkout-migration.sql`
   ثم `passcode-migration.sql` ثم `seed-products.sql`.
   بدون `checkout-migration.sql` لن يعمل الشراء إطلاقاً — ستظهر للعميل
   صفحة «404 Unknown order» عند الضغط على الدفع.
   و`seed-products.sql` يحمّل المنتجات العشرين بأسعارها الحالية، والسعر
   يُحتسب من قاعدة البيانات وليس من المتصفح — فبدونه يُرفض كل طلب.
   يمكن إعادة تشغيل كل الملفات بأمان: التطابق على `slug` فيُحدّث السعر
   ولا يكرّر المنتج، ولا يمسح روابط الصور الحقيقية التي أضفتها.
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
