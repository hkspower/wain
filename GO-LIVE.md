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
5. Paste all of the zip's `supabase-sql/SETUP-ALL.sql` into the Supabase SQL
   Editor and press Run. Read the report it prints at the end — see step 2
   below for what each number means.

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

### 2. Set up the database — one file

In the Supabase SQL editor, paste **all** of `supabase/SETUP-ALL.sql` and press
Run. That is the whole database step.

It is one file on purpose. The five migrations must run in a specific order —
`create_order` needs the tables from `schema.sql`, and the products need the
table to exist — and running them out of order fails *silently*: the storefront
still renders, and every checkout is refused. Safe to re-run at any time.

It ends by printing a report. Read it rather than assuming:

| Column | Should say | If it says 0 |
|---|---|---|
| `products_on_sale` | 46 | the catalogue did not load; checkout refuses everything |
| `products_retired` | 0+ | old products hidden, not deleted — 0 on a new project |
| `checkout_function` | 1 | every shopper hits **404 Unknown order** at Pay |
| `passcode_function` | 1 | the admin quick-unlock screen cannot work |
| `admin_users` | 1 or more | **nobody can sign in to /admin** |

**If `admin_users` is 0**, create one: Supabase → **Authentication → Users →
Add user**. Any email works — it does not need a real inbox, and it is not
where order mail goes. That email and password are what you type at
`https://www.sporta.com.kw/admin`.

The five migrations are still there individually (`supabase/schema.sql` and so
on) if you would rather run them one at a time, but they must go in the order
they are numbered.

### 3. Confirm the site is live and correctly configured

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
