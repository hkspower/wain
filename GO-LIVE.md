# Sporta — Go Live on www.sporta.com.kw

Everything here has been built and verified. Pick **one** of the two routes
below. Route A is one command; Route B needs no tools at all.

> **Claude cannot deploy for you.** This sandbox has no network route to your
> host — SFTP/SSH (`46.202.158.211:65002`) and `https://www.sporta.com.kw` are
> both blocked by the environment's egress policy. Every file is ready; the
> upload is the one step that must happen from your machine.

---

## Route A — one command (recommended)

From your Mac, once:

```bash
cd sporta-web
npm install                      # installs deploy deps too
cp .env.deploy.example .env.deploy
```

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
credentials. On the server:

```bash
cd public_html/knet
cp config.example.php config.php
```

Edit `config.php` and fill in the Tranportal **ID**, **password** and
**resource key** CBK issued you. Then set it to owner-read-only:

```bash
chmod 600 config.php
```

Test the endpoint: `https://www.sporta.com.kw/knet/selftest.php`
Delete `selftest.php` once it passes.

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

1. أنشئ ملف الدفع على الخادم: انسخ `knet/config.example.php` إلى
   `knet/config.php` وضع بيانات Tranportal (المعرّف وكلمة المرور ومفتاح
   المورد) من بنك الكويت المركزي، ثم `chmod 600 config.php`.
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
