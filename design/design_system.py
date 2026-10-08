#!/usr/bin/env python3
"""Build the Almuhallab design-system bundle from the site's own files.

Every card here is *extracted*, never redrawn: the tokens come out of
`index.html`'s `:root` block, the marks out of its `<symbol>` sprite, the
component CSS out of its stylesheet, and the contrast figures are computed
with the same WCAG maths the test suite uses. So the bundle cannot drift from
the site — the failure mode of every hand-made style guide, which starts true
and quietly stops being true.

    python3 design/design_system.py            # build
    python3 design/design_system.py --check    # fail if the committed bundle is stale

Each card's first line is a `<!-- @dsCard group="…" -->` marker, which is what
Claude Design's pane reads to build its index — so this folder is ready to
upload the moment a design-system authorization exists, without being reshaped.
"""

import re
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SITE = ROOT / "almuhallab"
OUT = ROOT / "design" / "design-system"
CHROME = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"

HOME = (SITE / "index.html").read_text(encoding="utf-8")

# Only the stylesheets. Scanning the whole page swept a line of JAVASCRIPT into
# the CSS — `ev.target.closest(".btn.primary")` reads exactly like a rule to a
# regex — and one syntax error there silently discards every rule after it, so
# the bar's buttons rendered with the wrong fills and nothing said so.
HOME_CSS = "\n".join(re.findall(r"<style>(.*?)</style>", HOME, re.S))


# ── extraction ──────────────────────────────────────────────────────────────
def root_block() -> str:
    m = re.search(r":root\s*\{(.*?)\n    \}", HOME_CSS, re.S)
    if not m:
        sys.exit(":root block not found — did the stylesheet move?")
    return m.group(1)


def token(name: str) -> str:
    m = re.search(rf"--{re.escape(name)}:\s*([^;]+);", root_block())
    if not m:
        sys.exit(f"token --{name} not found")
    return m.group(1).strip()


def font_faces() -> str:
    faces = re.findall(r"@font-face\s*\{[^}]*\}", HOME_CSS, re.S)
    # five Cairo weights in Arabic and five in Latin for the text, and the
    # logo's three Latin faces (Chakra Petch 600/700, JetBrains Mono) for
    # display words and figures — a count that moves means a face was added
    # or lost without the bundle knowing
    if len(faces) != 13:
        sys.exit(f"expected 13 @font-face rules, found {len(faces)}")
    # the bundle carries its own copy of the fonts, one directory up from
    # the cards, so a card opens correctly wherever the folder is put
    return "\n".join(f.replace("fonts/", "../fonts/") for f in faces)


def mark(name: str) -> str:
    """A mark exactly as the site serves it. The company's are written by
    design/logo-en/build.py, the anchor is النوخذة's own; the bundle copies
    the files and the cards show them as images, so no mark is redrawn and
    two copies of one SVG on a page cannot fight over their ids."""
    path = SITE / name
    if not path.exists():
        sys.exit(f"{name} not found in almuhallab/")
    return path.read_text(encoding="utf-8")


def css_rules(*selectors: str) -> str:
    """Pull whole rules out of the page's stylesheet, verbatim.

    A rule is taken when the target appears anywhere in its selector LIST, not
    only at the start. The site writes its base button as `nav.site a, .btn {`,
    and an earlier version of this that only matched rules beginning with the
    selector silently picked up a transition-only rule instead — the card
    rendered its buttons as bare underlined links, which is how a style guide
    starts lying.
    """
    out, seen = [], set()
    for m in re.finditer(r"(?m)^\s*([^\n{}@/][^{}]*?)\{([^{}]*)\}", HOME_CSS):
        selector_list, body = m.group(1), m.group(2)
        for sel in selectors:
            pat = rf"(?:^|,)\s*[^,]*(?<![\w.-]){re.escape(sel)}(?![\w-])[^,]*"
            if re.search(pat, selector_list):
                rule = f"{selector_list.strip()} {{{body}}}"
                if rule not in seen:
                    seen.add(rule)
                    out.append(rule)
                break
    if not out:
        sys.exit(f"no CSS rule found for {selectors} — did the stylesheet move?")
    return "\n".join(out)


ADMIN = "\n".join(re.findall(r"<style>(.*?)</style>",
                             (SITE / "admin.html").read_text(encoding="utf-8"), re.S))


def admin_rule(selector: str) -> str:
    """Some variants only exist on the app screens — the danger button is
    defined in the admin console and nowhere on the company page."""
    m = re.search(rf"(?m)^\s*{re.escape(selector)}\s*\{{[^}}]*\}}", ADMIN)
    if not m:
        sys.exit(f"{selector} not found in admin.html")
    return m.group(0).strip()


# ── contrast, the same maths the suite uses ─────────────────────────────────
def _rgb(h):
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def _lin(c):
    c /= 255
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def lum(h):
    r, g, b = _rgb(h)
    return 0.2126 * _lin(r) + 0.7152 * _lin(g) + 0.0722 * _lin(b)


def contrast(a, b):
    la, lb = lum(a), lum(b)
    hi, lo = max(la, lb), min(la, lb)
    return (hi + 0.05) / (lo + 0.05)


# ── the page shell every card shares ────────────────────────────────────────
def card(group: str, title: str, note: str, body: str, extra_css: str = "") -> str:
    return f"""<!-- @dsCard group="{group}" -->
<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>{title} | نظام تصميم المهلب كود</title>
<link rel="stylesheet" href="../tokens.css" />
<style>{extra_css}</style>
</head>
<body>
  <header class="ds-head">
    <h1>{title}</h1>
    <p>{note}</p>
  </header>
  <main class="ds-body">
{body}
  </main>
</body>
</html>
"""


def build() -> dict[str, str]:
    files: dict[str, str] = {}
    tint, strong = token("tint"), token("tint-strong")
    text, muted, panel2 = token("text"), token("muted"), token("panel-2")
    border, danger, good = token("border"), token("danger"), token("good")
    bg, panel3 = token("bg"), token("panel-3")

    # ── tokens.css: the site's own :root, fonts, and the shell ──────────────
    files["tokens.css"] = f"""/* Generated by design/design_system.py from almuhallab/index.html.
   Edit the site, then re-run — never edit this file. */
{font_faces()}

:root {{{root_block()}
}}

* {{ box-sizing: border-box; }}
body {{ margin: 0; background: var(--bg); color: var(--text);
  font-family: var(--sans); line-height: 1.7; }}
/* the site's own link reset — without it every button here is underlined,
   which would be the card inventing a difference the site does not have */
a {{ color: var(--tint); text-decoration: none; }}
.ds-head {{ background: var(--tint-strong); color: var(--on-bar); padding: 24px 32px;
  border-bottom: 1px solid var(--on-bar-fill); }}
.ds-head h1 {{ margin: 0; font-size: 22px; line-height: 1.4; }}
.ds-head p {{ margin: 4px 0 0; font-size: 13px; color: var(--muted); }}
.ds-body {{ padding: 32px; display: grid; gap: 24px; }}
.ds-row {{ display: flex; flex-wrap: wrap; gap: 16px; align-items: center; }}
.ds-note {{ color: var(--muted); font-size: 13px; margin: 0; }}
.ds-panel {{ background: var(--panel); border: 1px solid var(--border);
  border-radius: 12px; padding: 20px; }}
table {{ border-collapse: collapse; width: 100%; font-size: 13.5px; }}
th, td {{ padding: 12px 16px; text-align: start; border-bottom: 1px solid var(--border); }}
th {{ background: var(--panel-2); font-weight: 800; }}
/* A hex value or a token name is LTR text sitting in an RTL paragraph, and
   its leading `#` or `--` is bidi-neutral: it drifts to whichever side the
   paragraph pulls it. Rendered, `#ce1925` came out as `ce1925#` while
   `#7a4418` did not: the resolution depends on whether the first character
   after it is a letter or a digit. Isolate them and it stops being luck. */
code {{ font-family: var(--mono); font-size: 12.5px;
  direction: ltr; unicode-bidi: isolate; }}
"""

    # ── the marks, as the site serves them ─────────────────────────────────
    for name, out in (("logo.svg", "logo.svg"), ("favicon.svg", "monogram.svg"),
                      ("icon.svg", "anchor.svg")):
        files[f"marks/{out}"] = mark(name)
    img = lambda f, w, alt: (f'<img src="../marks/{f}" width="{w}" alt="{alt}" '
                             f'style="display:block;height:auto">')
    files["components/mark.html"] = card(
        "Brand", "العلامة: ALMUHALLAB CODE",
        "الشعار الإنجليزي بالكهرماني على أرضية الشعار السوداء، وحرفا AC للمربّع. "
        "يكتبهما design/logo-en/build.py، ولا يُرسمان باليد.",
        f"""    <div class="ds-panel" style="background:{strong}">
      <p class="ds-note">الشعار الكامل: 360 · 240 · 160 بكسل</p>
      <div class="ds-row">{img("logo.svg", 360, "ALMUHALLAB CODE")}{img("logo.svg", 240, "ALMUHALLAB CODE")}{img("logo.svg", 160, "ALMUHALLAB CODE")}</div>
    </div>
    <div class="ds-panel">
      <p class="ds-note">المربّع AC: 96 · 48 · 32 · 16 بكسل</p>
      <div class="ds-row" style="align-items:flex-end">{img("monogram.svg", 96, "AC")}{img("monogram.svg", 48, "AC")}{img("monogram.svg", 32, "AC")}{img("monogram.svg", 16, "AC")}</div>
    </div>
    <p class="ds-note">حروف <b>Chakra Petch</b> مخطَّطة، يقطعها شريط داكن
      <code>--stripe</code>، وتحتها <b>&gt;_</b> بخط <b>JetBrains Mono</b>.
      في الترويسة يُرسم الشعار نفسه بثلاثة أشرطة لتبقى حادّة على الشاشة.</p>""")

    files["components/mark-nokhatha.html"] = card(
        "Brand", "علامة النوخذة: المرساة",
        "النوخذة نظام بناه المهلب، وعلامتها ليست علامة الشركة. لا تُستبدل إحداهما بالأخرى.",
        f"""    <div class="ds-panel ds-row">
      {img("anchor.svg", 128, "النوخذة")}{img("anchor.svg", 64, "النوخذة")}{img("anchor.svg", 32, "النوخذة")}
    </div>
    <p class="ds-note">هذه علامة <b>المنتج</b>: تطبيق سطح المكتب وأيقونة التبويب
      في بوابة النوخذة، بألوان الشعار نفسها. علامة <b>الشركة</b> هي ALMUHALLAB CODE
      في البطاقة السابقة.</p>""")

    # ── colour, with the measured ratios ───────────────────────────────────
    swatches = [("--tint", tint, "اللون المميِّز: الروابط والأزرار والأرقام"),
                ("--tint-hover", token("tint-hover"), "الكهرماني عند التمرير"),
                ("--stripe", token("stripe"), "شريط الشعار الداكن"),
                ("--text", text, "النص"),
                ("--muted", muted, "نص ثانوي"),
                ("--sand", token("sand"), "التحذيرات فقط"),
                ("--good", good, "ربح"),
                ("--danger", danger, "خسارة / خطر"),
                ("--info", token("info"), "معلومة"),
                ("--border-input", token("border-input"), "حدّ عنصر التحكّم"),
                ("--border", border, "خط فاصل"),
                ("--panel-3", panel3, "سطح مرفوع"),
                ("--panel-2", panel2, "سطح غائر: الحقول"),
                ("--panel", token("panel"), "البطاقات"),
                ("--bg", bg, "الصفحة والشريط")]
    rows = "".join(
        f"<tr><td><code>{n}</code></td>"
        f'<td><span style="display:inline-block;width:44px;height:22px;'
        f'border-radius:8px;background:{v};border:1px solid var(--border-input)"></span></td>'
        f"<td><code>{v}</code></td><td>{d}</td>"
        f"<td><b>{contrast(v, bg):.2f}:1</b></td><td><b>{contrast(v, panel3):.2f}:1</b></td></tr>"
        for n, v, d in swatches)
    on_tint = token("on-tint")
    files["components/colour.html"] = card(
        "Colors", "اللون",
        "كل قيمة مأخوذة من كتلة :root في الموقع، والتباين محسوب بمعادلة WCAG "
        "نفسها التي تستعملها مجموعة الاختبارات، لا مُقدَّر بالعين.",
        f"""    <table>
      <tr><th>الرمز</th><th></th><th>القيمة</th><th>الدور</th><th>على الصفحة</th><th>على أفتح سطح</th></tr>
      {rows}
    </table>
    <p class="ds-note"><b>داكن كالشعار.</b> الصفحة والشريط بلون أرضية الشعار
      <code>{bg}</code>، والبطاقات أعلى منها بدرجة. على الداكن يُقاس الحبر على
      <b>أفتح</b> سطح قد يقع عليه (<code>--panel-3</code>): النص ≥ 7:1، وغيره ≥ 4.5:1.</p>
    <p class="ds-note"><b>الكهرماني هو اللون المميِّز الوحيد</b>، والأبيض عليه
      2.06:1 فقط، لذلك حِبر أي تعبئة كهرمانية هو <code>--on-tint</code>
      <code>{on_tint}</code> ({contrast(on_tint, tint):.2f}:1). التحذير أصفر
      <code>--sand</code> لا كهرماني، كي لا يُقرأ تحذيرٌ زرّاً. لا بيج ولا كريم في أي سطح.</p>""")

    # ── spacing ────────────────────────────────────────────────────────────
    scale = [4, 6, 8, 12, 16, 20, 24, 32, 40, 56]
    bars = "".join(
        f'<div style="display:flex;align-items:center;gap:12px">'
        f'<code style="width:44px">{v}</code>'
        f'<span style="height:14px;width:{v}px;background:{tint};border-radius:3px"></span>'
        f"</div>" for v in scale)
    files["components/spacing.html"] = card(
        "Spacing", "سلّم المسافات",
        "عشر قيم، وكل حشوة وهامش في الموقع واحدة منها. قبل هذا السلّم كانت "
        "الصفحات تحمل 27 قيمة مختلفة، سبعٌ منها خارج أي نظام.",
        f"""    <div class="ds-panel" style="display:grid;gap:8px">{bars}</div>
    <p class="ds-note">الصفوف التفاعلية (<code>.btn</code> · روابط التنقّل ·
      خلايا الجداول) عند <code>12px 16px</code> فتقيس ~44 بكسل — بالقصد، لا
      بالتقريب إلى السلّم.</p>""")

    # ── type ───────────────────────────────────────────────────────────────
    files["components/type.html"] = card(
        "Type", "الطباعة: Cairo · Chakra Petch · JetBrains Mono",
        "العربية بخط Cairo المضمَّن، والنصف اللاتيني للعناوين بخط الشعار Chakra Petch، "
        "والأرقام والرموز بـ JetBrains Mono. كلها SIL OFL ومضمَّنة، ولا يُربط أي خط من CDN.",
        """    <div class="ds-panel">
      <p style="font-size:34px;font-weight:800;margin:0 0 8px;line-height:1.4">نبني حلولاً رقمية قوية</p>
      <p style="font-size:22px;font-weight:700;margin:0 0 8px;line-height:1.4">النوخذة: النظام الموحد</p>
      <p style="font-size:16px;margin:0 0 8px">نصّ متن عادي بوزن 400، وهو الوزن الذي تُقرأ به الفقرات.</p>
      <p style="font-size:13px;color:var(--muted);margin:0">نصّ ثانوي بلون مكتوم.</p>
    </div>
    <div class="ds-panel">
      <p style="font-family:var(--display);font-weight:700;font-size:30px;color:var(--tint);margin:0 0 8px;line-height:1.35" dir="ltr">ALMUHALLAB CODE</p>
      <p style="font-family:var(--mono);font-size:16px;margin:0" dir="ltr"><span style="color:var(--tint)">&gt;_</span> +965 6589 4110 · 12,000.000 KWD</p>
      <p class="ds-note" style="margin-top:8px">لا حرف عربي في الخطّين اللاتينيين، فكل منهما يحمل نطاق Cairo
        اللاتيني، والعربية في العنصر نفسه تعود إلى Cairo.</p>
    </div>
    <div class="ds-panel">
      <p class="ds-note" style="margin-bottom:8px">قاعدة لازمة: ارتفاع السطر
        <b>≥ 1.35</b> على الأحجام العرضية</p>
      <p style="font-size:30px;font-weight:800;line-height:1.2;margin:0 0 12px;
         border-inline-start:3px solid var(--danger);padding-inline-start:12px">
        1.2: الضمة تصطدم بالسطر فوقها في نصٍّ يلتفّ إلى سطرين</p>
      <p style="font-size:30px;font-weight:800;line-height:1.4;margin:0;
         border-inline-start:3px solid var(--good);padding-inline-start:12px">
        1.4: المسافة كافية والحركات لا تتلامس مهما التفّ النص</p>
    </div>""")

    # ── components, using the page's own rules ─────────────────────────────
    files["components/buttons.html"] = card(
        "Components", "الأزرار",
        "مأخوذة من ورقة أنماط الموقع نفسها. كل زر يقيس 44 بكسل ارتفاعاً على الأقل.",
        """    <div class="ds-panel ds-row">
      <a class="btn primary" href="#">ابدأ مشروعك</a>
      <a class="btn" href="#">شاهد أعمالنا</a>
      <a class="btn outline" href="#">خروج</a>
      <a class="btn danger" href="#">حذف</a>
    </div>
    <div class="ds-panel ds-row on-bar" style="background:var(--tint-strong)">
      <a class="btn primary" href="#">النوخذة</a>
      <a class="btn outline" href="#">خروج</a>
    </div>
    <p class="ds-note">الحبر على الكهرماني داكن (<code>--on-tint</code>)، لا أبيض.
      على الشريط: الكهرماني للنداء الأساسي وحده، ومحدَّد فاتح للخروج. <b>لا أحمر
      على الشريط</b>: الخروج ليس حذفاً.</p>""",
        css_rules(".btn", ".btn.primary", ".btn.outline", ".btn:hover")
        # the danger variant lives in the admin console, not on the company
        # page — take it from where it is actually defined
        + "\n" + admin_rule(".btn.danger")
        # on the bar the outline drops its fill and takes the bar's own inks,
        # as the app screens' logout does
        + "\n.on-bar .btn.outline { background: transparent;"
          " border-color: var(--on-bar-bd); color: var(--on-bar); }")

    files["components/card.html"] = card(
        "Components", "البطاقة",
        "بطاقة موحّدة برأس أيقوني ورقاقات. هي وحدة البناء في كل شريط شرائح.",
        """    <div class="ds-row" style="align-items:stretch">
      <div class="card" style="max-width:280px">
        <h3>تطوير المواقع</h3>
        <p>مواقع تُبنى للسرعة ولمحركات البحث.</p>
        <ul class="feats"><li>مواقع شركات</li><li>متاجر إلكترونية</li></ul>
      </div>
      <div class="card" style="max-width:280px">
        <h3>تطوير الألعاب</h3>
        <p>ألعاب تُبنى لأجهزة الحاسوب.</p>
        <ul class="feats"><li>ويندوز</li><li>2D</li><li>3D</li></ul>
      </div>
    </div>""",
        css_rules(".card", ".card h3", ".card p", ".feats", ".feats li"))

    # ── the statement row: the rule the filing depends on ──────────────────
    files["components/statement.html"] = card(
        "Components", "صف المجموع",
        "المجموع المحسوب بيانٌ في القائمة، لا حقل إدخال آخر: التسمية في بداية "
        "القراءة، والمبلغ في نهايتها، وبينهما خط فاصل، والصف يملك عرضه كاملاً.",
        f"""    <div class="ds-panel" style="background:var(--panel)">
      <div style="display:flex;justify-content:space-between;padding:12px 0">
        <span>النقد وما في حكمه</span><span dir="ltr" style="font-family:var(--mono)">12,000.000</span></div>
      <div style="display:flex;justify-content:space-between;padding:12px 0">
        <span>ذمم مدينة تجارية</span><span dir="ltr" style="font-family:var(--mono)">3,000.000</span></div>
      <div style="display:flex;justify-content:space-between;padding:12px 0;
                  border-top:1px solid {border};font-weight:800">
        <span>إجمالي الأصول المتداولة</span><span dir="ltr" style="font-family:var(--mono)">15,000.000</span></div>
      <div style="display:flex;justify-content:space-between;padding:12px 0;
                  border-top:2px solid {tint};font-weight:800">
        <span>إجمالي الأصول</span><span dir="ltr" style="font-family:var(--mono)">16,348.500</span></div>
    </div>
    <p class="ds-note"><b>نظام أرقام واحد</b> في كل الصفحات: أرقام لاتينية بفاصل
      آلاف، بخط JetBrains Mono. وملف XBRL نفسه يبقى بلا فواصل: الفاصلة تُفسد ملفاً يقرؤه حاسوب.</p>""")

    # ── the index ──────────────────────────────────────────────────────────
    cards = [(p, re.search(r'group="([^"]+)"', c).group(1),
              re.search(r"<title>([^|]+)", c).group(1).strip())
             for p, c in files.items() if p.startswith("components/")]
    links = "".join(
        f'<li><a href="{p}">{t}</a> <span class="ds-note">· {g}</span></li>'
        for p, g, t in cards)
    files["index.html"] = f"""<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>نظام تصميم المهلب كود</title>
<link rel="stylesheet" href="tokens.css" />
</head>
<body>
  <header class="ds-head">
    <h1>نظام تصميم المهلب كود</h1>
    <p>مولَّد من ملفات الموقع نفسها: <code>design/design_system.py</code></p>
  </header>
  <main class="ds-body">
    <ul style="line-height:2.2">{links}</ul>
    <p class="ds-note">لا تُحرَّر هذه الملفات يدوياً: عدّل الموقع ثم أعد تشغيل
      المولِّد. كل بطاقة تحمل في سطرها الأول علامة <code>@dsCard</code>، فهي
      جاهزة للرفع إلى Claude Design متى توفّر التفويض.</p>
  </main>
</body>
</html>
"""
    return files


def main() -> None:
    check = "--check" in sys.argv
    files = build()
    stale = []
    for rel, content in files.items():
        path = OUT / rel
        if check:
            if not path.exists() or path.read_text(encoding="utf-8") != content:
                stale.append(rel)
        else:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(content, encoding="utf-8")

    # The bundle's fonts are copies of the site's, compared byte for byte:
    # --check once asked only that cairo-400.woff2 existed, so a re-cut
    # subset left the bundle on the old file and still called it current.
    fonts = OUT / "fonts"
    site_fonts = sorted([*(SITE / "fonts").glob("*.woff2"), *(SITE / "fonts").glob("LICENSE-*.txt")])
    if not check:
        fonts.mkdir(parents=True, exist_ok=True)
        for f in site_fonts:
            shutil.copy2(f, fonts / f.name)
    else:
        for f in site_fonts:
            copy = fonts / f.name
            if not copy.exists() or copy.read_bytes() != f.read_bytes():
                stale.append(f"fonts/{f.name}")
        names = {f.name for f in site_fonts}
        stale += [f"fonts/{f.name} (not on the site)" for f in sorted(fonts.glob("*"))
                  if f.name not in names]

    if check:
        if stale:
            sys.exit("design-system bundle is stale: " + ", ".join(stale))
        print("the design-system bundle is current")
    else:
        print(f"{OUT.relative_to(ROOT)} — {len(files)} files + {len(list((SITE / 'fonts').glob('*.woff2')))} font files")


if __name__ == "__main__":
    main()
