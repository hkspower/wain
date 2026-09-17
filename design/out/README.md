# مُخرجات — لا يُحرَّر شيء هنا بيد

كل ملفّ في هذا المجلّد **يُولَّد**، ويُكتب فوقه في المرّة القادمة. فمن حرّر
واحداً منها بيده فقد كتب على الماء: السكربت لا يقرأ ما هنا، إنّما يكتبه.

| الملفّ | يكتبه |
|---|---|
| `shots/` — ‏١٨ لقطة + `index.json` | `design/capture.py` (الموقع والنظام) و`design/admin_test.py` (لوحة الإدارة) |
| `almuhallab-website-sample.pdf` | `design/build_pdf.py`، من `shots/` |
| `pdf-preview/pv-00…13.png` | `design/build_pdf.py` نفسه — صفحات الـPDF مصغّرة خمس مرّات، للنظر إليها من غير فتح الملفّ |
| `sounding-lines-plate-iv.png` | `design/plate.py` |

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
