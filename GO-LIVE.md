# Sporta — Go Live on www.sporta.com.kw

Everything here has been built and verified. Pick **one** of the two routes
below. Route A is one command; Route B needs no tools at all.

> **Claude cannot deploy for you.** This sandbox has no network route to your
> host — SFTP/SSH (`46.202.158.211:65002`) and `https://www.sporta.com.kw` are
> both blocked by the environment's egress policy. Every file is ready; the
> upload is the one step that must happen from your machine.

---

## Route A — one command (recommended)

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
SSH Access). Then, every time you want to publish:

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

## Route B — upload the zip (no tools)

1. Download **`SPORTA-GO-LIVE.zip`**.
2. Hostinger hPanel → **File Manager** → open `public_html`.
3. Upload everything inside the zip's `public_html/` folder.

> ⚠️ **`.htaccess` is a hidden file.** Turn on "show hidden files" in File
> Manager (or your FTP app) and confirm it arrived. Without it you get no HTTPS
> redirect, no security headers, and `/shop` will show "404 Not Found".

The zip also contains `ALTERNATIVE-static-site/` — the same store built with no
JavaScript build step. You do not need it; it is a fallback.

---

## After uploading — 3 required steps

### 1. Create the payment config on the server

`config.php` is deliberately **not** in the package, because it holds live
credentials. Over SSH, run the setup script — it asks only for the five
secrets, validates them, and writes the file with the right permissions:

```bash
cd public_html/knet
php setup-config.php
```

It refuses to run over HTTP, and it catches the two mistakes that fail
silently and cost you money:

- **a resource key that is not exactly 16 bytes** — AES-128 needs 16, and one
  trailing space from a copy/paste makes KNET reject every transaction with no
  useful error message;
- **the Supabase _anon_ key pasted where the _service_ key belongs** —
  row-level security then blocks order creation, so checkout fails for every
  customer.

It finishes by checking that your `products` and `orders` tables are reachable,
and warns you if `products` is still empty — checkout cannot work until it has
rows, because the amount is priced from that table and never from the browser.

No SSH? Copy `config.example.php` to `config.php` in File Manager, fill in the
same five values by hand, and set permissions to `600`.

Delete `setup-config.php` and `selftest.php` from the server once you are done
— both reveal configuration state.

### 2. Confirm the site is live and correctly configured

```bash
./scan-server-response.sh
```

Everything should be green. It checks HTTPS, single-hop redirects, all security
headers, compression, caching, real 404s, and that `.git`/`.env`/`config.php`
are not exposed.

### 3. Tell Google about it

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
2. شغّل `./scan-server-response.sh` للتأكد أن إعدادات الخادم سليمة.
3. أضف الموقع في Google Search Console وأرسل `sitemap.xml`.

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
