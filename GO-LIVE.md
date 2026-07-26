# Sporta — Go Live on www.sporta.com.kw

Everything here has been built and verified. Pick **one** of the two routes
below. Route A is one command; Route B needs no tools at all.

> **Claude cannot deploy for you.** This sandbox has no network route to your
> host — SFTP/SSH (`46.202.158.211:65002`) and `https://www.sporta.com.kw` are
> both blocked by the environment's egress policy. Every file is ready; the
> upload is the one step that must happen from your machine.

---

## Which route

**Route A — `npm run publish`.** Uploads over **FTPS**, which is a separate
Hostinger service from SSH and keeps working with SSH switched off. This is the
standing bridge. Needs Node and this repo on your machine.

**Route B — the zip.** A browser and nothing else. No Node, no npm, no terminal.

Both do the same thing. Use whichever you are near.

> The old `npm run deploy` uploaded over SFTP, which rides on SSH. With SSH off
> it cannot run at all. It is left in place for if SSH is ever re-enabled.

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

Then, every time you want to publish:

```bash
npm run publish:dry    # show exactly what would change. Uploads nothing.
npm run publish        # do it
```

What it does, in order: regenerate the SEO files → production build → bundle the
KNET PHP endpoints → **run the file audit and refuse to upload if it fails** →
upload over explicit TLS → re-download `.htaccess`, `knet/.htaccess` and
`index.html` and compare them byte for byte against what it just sent.

**`config.js` and `knet/config.php` are never uploaded and never deleted.** They
hold your live Supabase and Tranportal credentials and exist only on the server.
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
   واملأ القيم الخمس (بيانات Tranportal من البنك، ورابط ومفتاح Supabase)،
   واضبط صلاحياته على 600، ثم افتح
   `https://www.sporta.com.kw/knet/selftest.php` للتأكد.
   واحذف `setup-config.php` و `selftest.php` بعد الانتهاء.
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
