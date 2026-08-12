#!/usr/bin/env python3
"""Build the Almuhallab logo pack — everything a printer, a supplier or a
partner ever asks for, in one folder.

Every file here is drawn from the page's own sprite (`#i-boum`, `#i-sail` in
almuhallab/index.html), never redrawn by hand, so the pack cannot drift from
the mark the site actually flies. Re-run it after any change to the logo:

    python3 design/logo_pack.py

The PNGs are rendered by the same Chromium the rest of the design tooling uses,
so what ships is what a browser draws — not an approximation.
"""

import re
import struct
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PAGE = ROOT / "almuhallab" / "index.html"
OUT = ROOT / "design" / "logo-pack"
CHROME = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"

BROWN = "#6F3F1C"          # --tint-strong, the brand ink
AMBER = "#e3a556"          # the gradient's light end, logo tile only
BLACK = "#000000"
WHITE = "#ffffff"


def symbol(sprite_id):
    """The symbol's own paths, straight out of the page."""
    html = PAGE.read_text()
    m = re.search(rf'<symbol id="{sprite_id}" viewBox="([^"]+)">(.*?)</symbol>',
                  html, re.S)
    if not m:
        sys.exit(f"{sprite_id} not found in index.html — did the mark move?")
    return m.group(1), m.group(2)


def svg(view_box, paths, colour):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{view_box}" '
            f'role="img" aria-label="Almuhallab Code">'
            f'<g color="{colour}">{paths}</g></svg>\n')


def png(page, markup, w, h, path, background, inset=0.0):
    """Screenshot one mark at one size. background=None gives transparency.

    `inset` holds the mark off the canvas edge, so a PNG dropped straight into
    a document already carries a little of its own clear space. The icon cuts
    take inset=0: at 16px every pixel of the canvas has to be the mark.
    """
    bg = f"background:{background};" if background else ""
    pad_x, pad_y = round(w * inset), round(h * inset)
    page.set_viewport_size({"width": w, "height": h})
    page.set_content(
        f'<body style="margin:0;{bg}">'
        f'<div style="width:{w}px;height:{h}px;box-sizing:border-box;'
        f'padding:{pad_y}px {pad_x}px">{markup}</div></body>')
    page.screenshot(path=str(path), omit_background=background is None)


def ico(pngs, path):
    """A multi-size .ico — Windows picks the cut that fits the surface."""
    entries, blobs, offset = [], [], 6 + 16 * len(pngs)
    for size, blob in pngs:
        entries.append(struct.pack("<BBBBHHII", size % 256, size % 256, 0, 0,
                                   1, 32, len(blob), offset))
        blobs.append(blob)
        offset += len(blob)
    path.write_bytes(struct.pack("<HHH", 0, 1, len(pngs))
                     + b"".join(entries) + b"".join(blobs))


README = """# حزمة شعار المهلب كود — Almuhallab Code logo pack

كل ملف هنا **مولَّد** من رسم الشعار نفسه في الموقع (`design/logo_pack.py`).
لا تحرّر ملفاً من هذا المجلد يدوياً؛ عدّل الشعار ثم أعد تشغيل المولِّد.

## أي ملف أستعمل؟

| الحالة | الملف |
|---|---|
| ترويسة، لافتة، مطبوعات، أي مكان فيه عرض | `svg/boum-wide-brown.svg` |
| على خلفية بنية أو داكنة | `svg/boum-wide-white.svg` |
| طباعة بلون واحد، حفر، تطريز، فاكس | `svg/boum-wide-black.svg` |
| مربع: أيقونة، صورة حساب، غلاف | `svg/boum-square-brown.svg` |
| أيقونة تبويب المتصفح / تطبيق | `svg/boum-tile.svg` · `ico/almuhallab.ico` |
| من يطلب PNG جاهزاً | `png/` |

**المصدر دائماً هو SVG.** أعطِ المطبعة ملف SVG لا PNG: المتجه يكبر بلا حدود،
والـPNG هنا للراحة فقط.

## اللون

| | القيمة |
|---|---|
| البني (الحبر الأساسي) | `#6F3F1C` — RGB 111 · 63 · 28 |
| CMYK تقريبي (طباعة) | 0 · 43 · 75 · 56 |
| العنبري (طرف التدرّج في المربّع فقط) | `#e3a556` |
| الأبيض على البني | `#FFFFFF` |

قيمة الـCMYK محسوبة عددياً من الـsRGB بتحويل مباشر، **وليست ملفاً مُدارَ
الألوان**. قبل طباعة كمية كبيرة اطلب من المطبعة تجربة لونية (proof) ومطابقتها
على ورقها؛ البني الغامق ينزاح نحو الأحمر على الورق غير المطلي.

## المساحة الحرة والحد الأدنى

- **المساحة الحرة**: اترك حول الشعار فراغاً لا يقل عن **ارتفاع الشعار ÷ 4**
  من كل جهة. لا تضع فيه نصاً ولا حدّاً ولا صورة.
- **الحد الأدنى للشكل العريض**: **90 بكسل عرضاً** على الشاشة، و**20 مم** طباعة.
  تحته يذوب خط الحزام وخط الماء.
- **الحد الأدنى للشكل المربع**: **16 بكسل**. هذا الشكل مرسوم خصيصاً ليصمد هناك:
  هيكل واحد، ساق واحدة، صارٍ واحد، شراع واحد.
- **تحت 90 بكسل استعمل المربّع، لا تصغير العريض.**

## ما لا يجوز

- لا تُغيّر ألوان الشعار ولا تضع عليه تدرّجاً (عدا ملف `boum-tile.svg` نفسه).
- لا تُدِر الشعار، ولا تمدّه أو تضغطه — نسبة الشكل العريض **2:1** ثابتة.
- لا تضع الشعار البني على خلفية داكنة؛ استعمل النسخة البيضاء.
- لا تعِد رسم السفينة. البوم **مدبّب الطرفين** بساق أمامية عالية، وصاريه الطويل
  **أمام** والقصير خلف، وشراعه لاتيني مائل — أي تغيير في هذا يجعله سفينة أخرى.
- شعار **النوخذة** (المرساة، `almuhallab/icon.svg`) شعار المنتج لا الشركة؛
  لا تستبدل أحدهما بالآخر.
"""


def main():
    from playwright.sync_api import sync_playwright

    wide_vb, wide_paths = symbol("i-boum")
    sq_vb, sq_paths = symbol("i-sail")
    tile = (ROOT / "almuhallab" / "favicon.svg").read_text()

    for sub in ("svg", "png", "ico"):
        (OUT / sub).mkdir(parents=True, exist_ok=True)

    inks = {"brown": BROWN, "white": WHITE, "black": BLACK}
    for name, colour in inks.items():
        (OUT / "svg" / f"boum-wide-{name}.svg").write_text(
            svg(wide_vb, wide_paths, colour))
        (OUT / "svg" / f"boum-square-{name}.svg").write_text(
            svg(sq_vb, sq_paths, colour))
    (OUT / "svg" / "boum-tile.svg").write_text(tile)

    written = 7
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path=CHROME)
        page = browser.new_page()

        grounds = {"on-white": (WHITE, "brown"),
                   "on-brown": (BROWN, "white"),
                   "transparent": (None, "brown")}
        for ground, (bg, ink) in grounds.items():
            for w in (400, 800, 1600):
                markup = svg(wide_vb, wide_paths, inks[ink])
                png(page, markup, w, w // 2,
                    OUT / "png" / f"boum-wide-{w}-{ground}.png", bg, inset=0.06)
                written += 1
            for s in (16, 32, 64, 128, 256, 512, 1024):
                markup = svg(sq_vb, sq_paths, inks[ink])
                png(page, markup, s, s,
                    OUT / "png" / f"boum-square-{s}-{ground}.png", bg)
                written += 1

        # the tab/app icon: the gradient tile, at every size Windows asks for
        cuts = []
        for s in (16, 24, 32, 48, 64, 128, 256):
            tmp = OUT / "ico" / f"_tile-{s}.png"
            png(page, tile, s, s, tmp, None)
            cuts.append((s, tmp.read_bytes()))
            tmp.unlink()
        ico(cuts, OUT / "ico" / "almuhallab.ico")
        written += 1
        browser.close()

    (OUT / "README.md").write_text(README)
    written += 1
    print(f"{OUT.relative_to(ROOT)} — {written} files")


if __name__ == "__main__":
    main()
