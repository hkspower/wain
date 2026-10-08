# مُخرجات — لا يُحرَّر شيء هنا بيد

كل ملفّ في هذا المجلّد **يُولَّد**، ويُكتب فوقه في المرّة القادمة. فمن حرّر
واحداً منها بيده فقد كتب على الماء: السكربت لا يقرأ ما هنا، إنّما يكتبه.

| الملفّ | يكتبه |
|---|---|
| `shots/` — ‏١٨ لقطة + `index.json` | `design/capture.py` (الموقع والنظام) و`design/admin_test.py` (لوحة الإدارة) |
| `almuhallab-website-sample.pdf` | `design/build_pdf.py`، من `shots/` |
| `pdf-preview/pv-00…13.png` | `design/build_pdf.py` نفسه — صفحات الـPDF مصغّرة خمس مرّات، للنظر إليها من غير فتح الملفّ |
| `sounding-lines-plate-iv.png` | `design/plate.py` |
| `topbar/before/`, `topbar/after/` | قياس الشريط العلوي (2026-10-07): الصفحات الأربع بستّة مقاسات، أعلى الصفحة وبعد التمرير، و`measure.json` بالأرقام |
| `logo-hq/before/`, `logo-hq/after/`, `logo-hq/pairs/` | الشعار بجودة أعلى (2026-10-08): شعار الشريط بستّة مقاسات × كثافة 1 و2 و3، أعلى الصفحة وبعد التمرير، وعلامة التذييل؛ `pairs/` قبل وبعد مكبّرة 4 إلى 8 مرّات (ومعها الأيقونات وبطاقة المشاركة والشعار المربّع، ونسخ «قبل» منها في `before-files/`)، و`measure.json` بأطوال الشريط. سكربت القصّ مؤقّت لم يُحفظ في المستودع |

وكان هذا كلّه مبعثراً في `design/` نفسه بين السكربتات، فلا يُعرف الداخل من
الخارج. والمجلّدات الأخرى (`film/`, `ship/`, `logo-pack/`, `instagram/`,
`design-system/`, `ads/`, `brand/`) تحتفظ بمُخرجاتها بجانب مصادرها لأنها
مشاريع قائمة بذاتها، لا ملفّات سائبة.

```bash
python3 design/capture.py      # → out/shots/
python3 design/admin_test.py   # → out/shots/2*.png
python3 design/build_pdf.py    # → out/almuhallab-website-sample.pdf + out/pdf-preview/
python3 design/plate.py        # → out/sounding-lines-plate-iv.png
```
