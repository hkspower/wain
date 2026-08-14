# دليل النشر — موصول

حزمتان مستقلّتان: **الموقع** ملفات ثابتة ترفعها لأي استضافة، و**النظام** خدمة
Node تحتاج خادمًا. تعملان منفصلتين تمامًا — يمكنك رفع الموقع اليوم والنظام لاحقًا.

```bash
node tools/build-release.mjs --domain=mawsool.com.kw
```

ينتج في `dist/`:

| الملف | ماذا |
|---|---|
| `mawsool-website.zip` | الموقع — ارفع محتواه إلى جذر الاستضافة |
| `mawsool-system.zip` | النظام + حزمة العربية |

---

## ١ · الموقع

موقع ثابت بحت: لا قاعدة بيانات ولا Node. يعمل على أي استضافة أو على
GitHub Pages أو Netlify أو Cloudflare Pages.

```
فُكّ mawsool-website.zip وارفع محتوى المجلد إلى جذر الموقع:
  index.html · styles.css · script.js · robots.txt · sitemap.xml · assets/
```

**قبل الرفع تأكّد من:**

**سكربت البناء يرفض العمل** ما دامت قيمة مؤقتة في `index.html` — لا يمكنك
رفع أرقام هاتف أو بريد أو نطاق تجريبي بالخطأ. استبدلها أولًا:

- **بيانات التواصل**: الهاتف والواتساب والبريد والعنوان في `index.html`،
  ورقم واتساب نموذج الطلب في السمة `data-whatsapp` على `#orderForm`.
- **النطاق**: مرّر `--domain=نطاقكم` — يُستبدل في `canonical` و`og:image`
  و`robots.txt` و`sitemap.xml`.
- **الأسعار وأوقات التوصيل**: تقديرية ومترابطة — راجع الجدول في
  `website/README.md` قبل تغيير أي رقم.
- **نموذج الطلب** يفتح واتساب برسالة جاهزة فيها بيانات الطلب — يصلكم فعلًا.
  تأكّد أن `data-whatsapp` على `#orderForm` رقمكم الصحيح.
- **روابط التواصل الاجتماعي**: أُزيلت المؤقتة؛ أضِف حساباتكم إن وُجدت.

---

## ٢ · النظام

### المتطلّبات

- **Node.js ٢٠ أو أحدث** (`node -v`)
- **HTTPS إلزامي** — لا اختيار فيه: تحديد الموقع والميكروفون لا يعملان في
  المتصفحات إلا في سياق آمن، فرابط المهمّة يفقد ثلثي وظيفته بدونه.
- أدوات بناء لـ `better-sqlite3` (على أوبنتو: `apt install build-essential python3`)

### التركيب

```bash
unzip mawsool-system.zip
cd mawsool-system/agent-system

npm install --omit=dev

cp .env.example .env
nano .env                      # املأ القيم — مشروحة أدناه

npm run setup                  # ينشئ حساب مدير واحدًا ويطبع كلمة مروره مرة واحدة
npm start                      # تجربة سريعة على المنفذ ٤٠٠٠
```

> **بنية المجلد مهمّة**: يجب أن يبقى `arabic-kit/` بجانب `agent-system/` لأن
> الاعتمادية مسجّلة `file:../arabic-kit`. لا تنقل أحدهما وحده.

### ملف `.env`

| المتغيّر | لماذا | إلزامي |
|---|---|---|
| `PORT` · `HOST` | استمع على `127.0.0.1` خلف وكيل عكسي | — |
| `MAWSOOL_SECURE_COOKIE=1` | يمنع إرسال كوكي الجلسة على اتصال غير مشفّر | **نعم** خلف HTTPS |
| `MAWSOOL_SMTP_URL` | خادم البريد لتقارير المهام | لإرسال التقارير |
| `MAWSOOL_MAIL_TO` · `MAWSOOL_MAIL_FROM` | مستلم التقارير ومرسِلها | لإرسال التقارير |
| `MAWSOOL_PROBATION_MAX_ORDERS` | سقف طلبات الكابتن تحت التجربة (`0` = بلا سقف) | — |
| `MAWSOOL_LINK_HOURS` | صلاحية رابط المهمّة | — |
| `MAWSOOL_LOCATION_RETENTION_HOURS` | مدة حفظ نقاط الموقع — كلما قلّت كان أفضل | — |

بدون ضبط البريد **لا تضيع التقارير**: تُحفظ في «الإعدادات ← صادر البريد»
بحالتها وسبب فشلها، وتُرسل عند الضغط على «إعادة المحاولة» بعد الضبط.

### التشغيل الدائم — systemd

`/etc/systemd/system/mawsool.service`:

```ini
[Unit]
Description=Mawsool agent system
After=network.target

[Service]
Type=simple
User=mawsool
WorkingDirectory=/srv/mawsool/agent-system
ExecStart=/usr/bin/node server/index.js
Restart=always
RestartSec=5
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now mawsool
sudo systemctl status mawsool
journalctl -u mawsool -f          # السجلات
```

### الوكيل العكسي — nginx

```nginx
server {
  listen 443 ssl http2;
  server_name ops.mawsool.com.kw;

  ssl_certificate     /etc/letsencrypt/live/ops.mawsool.com.kw/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/ops.mawsool.com.kw/privkey.pem;

  # التسجيلات الصوتية أكبر من الحدّ الافتراضي لـ nginx
  client_max_body_size 8m;

  location / {
    proxy_pass http://127.0.0.1:4000;
    proxy_http_version 1.1;
    proxy_set_header Host              $host;
    proxy_set_header X-Real-IP         $remote_addr;
    proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-Host  $host;
  }
}

server {
  listen 80;
  server_name ops.mawsool.com.kw;
  return 301 https://$host$request_uri;
}
```

`X-Forwarded-Proto` و`X-Forwarded-Host` ليسا تزيينًا: منهما يبني النظام عنوان
رابط المهمّة الذي يُرسل للكابتن. بدونهما يخرج الرابط بـ `http` وباسم مضيف خاطئ.

شهادة مجانية: `sudo certbot --nginx -d ops.mawsool.com.kw`

---

## ٣ · أول تشغيل فعلي

القاعدة تبدأ **فارغة تمامًا**: حساب مدير واحد، بلا حسابات تجريبية ولا طلبات
وهمية ولا كلمات مرور منشورة.

1. **سجّل الدخول** باسم المستخدم وكلمة المرور اللذين طبعهما `npm run setup`.
2. **غيّر كلمة المرور** من «المندوبون ← تعديل» إن أردت واحدة تحفظها.
3. **اضبط العمولة** من «الإعدادات» — القيمة الافتراضية ٢٠٪ رقمٌ للبدء لا سياستك.
4. **أضف الكباتن**: كل حساب جديد يبدأ **تحت التجربة** تلقائيًا، فاعتمده من زر
   «الاعتماد» بعد المقابلة.
5. **تحقّق من البريد**: أنشئ طلبًا وأرسل تقريره يدويًا وتأكّد أنه وصل.

> كلمة المرور المولّدة تُعرض **مرة واحدة** ولا تُحفظ بنصّها في أي مكان. إن
> ضاعت، احذف ملف القاعدة وأعد `npm run setup` — وستفقد البيانات معها.

---

## ٤ · النسخ الاحتياطي

كل شيء في مجلد `data/`: قاعدة البيانات والتسجيلات الصوتية.

```bash
# نسخة آمنة أثناء التشغيل (SQLite بوضع WAL)
sqlite3 /srv/mawsool/agent-system/data/mawsool.db ".backup '/backup/mawsool-$(date +%F).db'"
tar czf /backup/voice-$(date +%F).tar.gz -C /srv/mawsool/agent-system/data voice
```

ضعهما في cron يوميًّا. **لا تنسخ ملف القاعدة بـ `cp` والخادم يعمل** — قد تحصل
على نسخة ناقصة؛ استخدم `.backup` أعلاه.

---

## ٥ · الترقية لاحقًا

```bash
sudo systemctl stop mawsool
# انسخ data/ احتياطيًا أولًا
unzip -o mawsool-system-new.zip -d /srv/mawsool-new
cp -r /srv/mawsool/agent-system/data /srv/mawsool-new/agent-system/
cd /srv/mawsool-new/agent-system && npm install --omit=dev
sudo systemctl start mawsool
```

ترحيلات المخطّط تعمل تلقائيًا عند الإقلاع: الأعمدة والجداول الجديدة تُضاف بلا
فقد بيانات، ولا حاجة لأي خطوة يدوية.

---

## ٦ · ما ليس في هذا الإصدار

حدود واضحة لا نواقص مخفية:

- **دورة الصرف**: النظام يحسب مستحقّ كل كابتن على كل طلب، لكنه لا يجمّع
  مستحقّات يوم أو أسبوع ولا يعلّم ما صُرف ولا يحفظ سجل حوالات. المحاسبة
  اليومية ستكون يدوية حتى تُبنى.
- **موديل السيارة والمقابلة وجنس الكابتن**: شروط الانضمام في نموذج العمل
  ليست حقولًا في النظام بعد.
- **لا إشعارات فورية** — الواجهة تحدّث نفسها كل ٤٥ ثانية.
- **خادم واحد**: SQLite لا يتوسّع أفقيًا. للتوسّع انقل القاعدة إلى Postgres.
- **نموذج الطلب في الموقع غير موصول بالنظام** — يسلّم الطلب عبر واتساب،
  فتُدخله في اللوحة يدويًا.
