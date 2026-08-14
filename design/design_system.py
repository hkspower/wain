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
# the brown-bar buttons rendered with the wrong fills and nothing said so.
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
    if len(faces) != 5:
        sys.exit(f"expected 5 @font-face rules, found {len(faces)}")
    # the bundle carries its own copy of the fonts, one directory up from
    # the cards, so a card opens correctly wherever the folder is put
    return "\n".join(f.replace("fonts/", "../fonts/") for f in faces)


def symbol(sprite_id: str) -> tuple[str, str]:
    m = re.search(rf'<symbol id="{sprite_id}" viewBox="([^"]+)">(.*?)</symbol>',
                  HOME, re.S)
    if not m:
        sys.exit(f"{sprite_id} not found in the sprite")
    return m.group(1), m.group(2)


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
<title>{title} — نظام تصميم المهلب كود</title>
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
.ds-head {{ background: var(--tint-strong); color: #fff; padding: 24px 32px; }}
.ds-head h1 {{ margin: 0; font-size: 22px; line-height: 1.4; }}
.ds-head p {{ margin: 4px 0 0; font-size: 13px; color: rgba(255,255,255,.82); }}
.ds-body {{ padding: 32px; display: grid; gap: 24px; }}
.ds-row {{ display: flex; flex-wrap: wrap; gap: 16px; align-items: center; }}
.ds-note {{ color: var(--muted); font-size: 13px; margin: 0; }}
.ds-panel {{ background: var(--panel-2); border: 1px solid var(--border);
  border-radius: 12px; padding: 20px; }}
table {{ border-collapse: collapse; width: 100%; font-size: 13.5px; }}
th, td {{ padding: 12px 16px; text-align: start; border-bottom: 1px solid var(--border); }}
th {{ background: var(--panel-2); font-weight: 800; }}
/* A hex value or a token name is LTR text sitting in an RTL paragraph, and
   its leading `#` or `--` is bidi-neutral: it drifts to whichever side the
   paragraph pulls it. Rendered, `#ce1925` came out as `ce1925#` while
   `#7a4418` did not — the resolution depends on whether the first character
   after it is a letter or a digit. Isolate them and it stops being luck. */
code {{ font-family: var(--mono); font-size: 12.5px;
  direction: ltr; unicode-bidi: isolate; }}
"""

    # ── the mark, both forms, on both grounds ──────────────────────────────
    wide_vb, wide = symbol("i-boum")
    sq_vb, sq = symbol("i-sail")
    anchor = (SITE / "icon.svg").read_text(encoding="utf-8")
    sizes = "".join(
        f'<span style="width:{w}px;display:inline-block">'
        f'<svg viewBox="{wide_vb}" role="img" aria-label="المهلب">{wide}</svg></span>'
        for w in (320, 148, 96))
    sq_sizes = "".join(
        f'<span style="width:{w}px;display:inline-block">'
        f'<svg viewBox="{sq_vb}" role="img" aria-label="المهلب">{sq}</svg></span>'
        for w in (96, 48, 32, 16))
    files["components/mark.html"] = card(
        "Brand", "العلامة — البوم",
        "شكلان لرسم واحد. العريض 2:1 حيث يسمح العرض، والمربّع لكل ثقب مربّع "
        "— وهو مرسوم ليصمد عند 16 بكسل.",
        f"""    <div class="ds-panel" style="color:{tint}">
      <p class="ds-note">الشكل العريض — 320 · 148 · 96 بكسل</p>
      <div class="ds-row">{sizes}</div>
    </div>
    <div class="ds-panel" style="background:{strong};color:#fff">
      <p class="ds-note" style="color:rgba(255,255,255,.82)">أبيض على البني — نفس الرسم</p>
      <div class="ds-row">{sizes}</div>
    </div>
    <div class="ds-panel" style="color:{tint}">
      <p class="ds-note">الشكل المربّع — 96 · 48 · 32 · 16 بكسل</p>
      <div class="ds-row" style="align-items:flex-end">{sq_sizes}</div>
    </div>
    <p class="ds-note">البوم <b>مدبّب الطرفين</b> بساق أمامية عالية، صاريه الطويل
      أمام والقصير خلف، وشراعاه لاتينيان. لا مؤخرة مسطّحة ولا حبال ولا بيرق.</p>""")

    files["components/mark-nokhatha.html"] = card(
        "Brand", "علامة النوخذة — المرساة",
        "النوخذة نظام بناه المهلب، وعلامتها ليست علامة الشركة. لا تُستبدل إحداهما بالأخرى.",
        f"""    <div class="ds-panel ds-row">
      <span style="width:128px;display:inline-block">{anchor}</span>
      <span style="width:64px;display:inline-block">{anchor}</span>
      <span style="width:32px;display:inline-block">{anchor}</span>
    </div>
    <p class="ds-note">هذه علامة <b>المنتج</b>: تطبيق سطح المكتب وأيقونة التبويب
      في بوابة النوخذة. علامة <b>الشركة</b> هي البوم في البطاقة السابقة.</p>""")

    # ── colour, with the measured ratios ───────────────────────────────────
    swatches = [("--tint", tint, "الحبر الأساسي"),
                ("--tint-strong", strong, "شريط الترويسة"),
                ("--text", text, "النص"),
                ("--muted", muted, "نص ثانوي"),
                ("--good", good, "ربح"),
                ("--danger", danger, "خسارة / خطر"),
                ("--border", border, "حدود"),
                ("--panel-2", panel2, "سطح غائر")]
    rows = "".join(
        f"<tr><td><code>{n}</code></td>"
        f'<td><span style="display:inline-block;width:44px;height:22px;'
        f'border-radius:6px;background:{v};border:1px solid var(--border)"></span></td>'
        f"<td><code>{v}</code></td><td>{d}</td>"
        f"<td><b>{contrast(v, '#ffffff'):.2f}:1</b></td></tr>"
        for n, v, d in swatches)
    files["components/colour.html"] = card(
        "Colors", "اللون",
        "كل قيمة مأخوذة من كتلة :root في الموقع، والتباين محسوب بمعادلة WCAG "
        "نفسها التي تستعملها مجموعة الاختبارات — لا مُقدَّر بالعين.",
        f"""    <table>
      <tr><th>الرمز</th><th></th><th>القيمة</th><th>الدور</th><th>التباين على الأبيض</th></tr>
      {rows}
    </table>
    <p class="ds-note"><b>لا بيج ولا كريم.</b> الصفحة والبطاقات بيضاء، والأسطح
      الغائرة رمادية باردة. البني حِبر لا ورق — باستثناء شريط الترويسة وحده.</p>""")

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
        "Type", "الطباعة — Cairo",
        "العربية بخط Cairo المضمَّن (SIL OFL، أربعة أوزان، 54 كيلوبايت). "
        "لا يُربط أبداً بخط من CDN — سياسة الأمان تمنعه.",
        """    <div class="ds-panel">
      <p style="font-size:34px;font-weight:800;margin:0 0 8px;line-height:1.4">نبني حلولاً رقمية قوية</p>
      <p style="font-size:22px;font-weight:700;margin:0 0 8px;line-height:1.4">النوخذة — النظام الموحد</p>
      <p style="font-size:16px;margin:0 0 8px">نصّ متن عادي بوزن 400، وهو الوزن الذي تُقرأ به الفقرات.</p>
      <p style="font-size:13px;color:var(--muted);margin:0">نصّ ثانوي بلون مكتوم.</p>
    </div>
    <div class="ds-panel">
      <p class="ds-note" style="margin-bottom:8px">قاعدة لازمة: ارتفاع السطر
        <b>≥ 1.35</b> على الأحجام العرضية</p>
      <p style="font-size:30px;font-weight:800;line-height:1.2;margin:0 0 12px;
         border-inline-start:3px solid var(--danger);padding-inline-start:12px">
        1.2 — الضمة تصطدم بالسطر فوقها في نصٍّ يلتفّ إلى سطرين</p>
      <p style="font-size:30px;font-weight:800;line-height:1.4;margin:0;
         border-inline-start:3px solid var(--good);padding-inline-start:12px">
        1.4 — المسافة كافية والحركات لا تتلامس مهما التفّ النص</p>
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
    <div class="ds-panel ds-row on-brown" style="background:var(--tint-strong)">
      <a class="btn primary" href="#">النوخذة</a>
      <a class="btn outline" href="#">خروج</a>
    </div>
    <p class="ds-note">على الشريط البني ينقلب الحبر: قرص أبيض للنداء الأساسي،
      ومحدَّد أبيض للخروج. <b>الأحمر ممنوع هناك</b> — يقيس 1.6:1 على هذا البني.</p>""",
        css_rules(".btn", ".btn.primary", ".btn.outline", ".btn:hover")
        # the danger variant lives in the admin console, not on the company
        # page — take it from where it is actually defined
        + "\n" + admin_rule(".btn.danger")
        # on the brown bar the fill is dropped and the outline goes white; the
        # company page's own .btn.outline is a light chip for white surfaces
        + "\n.on-brown .btn.outline { background: transparent; border-color: #fff;"
          " color: #fff; }\n.on-brown .btn.primary { background: #fff;"
          " color: var(--tint-strong); }")

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
        "القراءة، والمبلغ في نهايتها، وبينهما خط فاصل — والصف يملك عرضه كاملاً.",
        f"""    <div class="ds-panel" style="background:var(--panel)">
      <div style="display:flex;justify-content:space-between;padding:12px 0">
        <span>النقد وما في حكمه</span><span dir="ltr">12,000.000</span></div>
      <div style="display:flex;justify-content:space-between;padding:12px 0">
        <span>ذمم مدينة تجارية</span><span dir="ltr">3,000.000</span></div>
      <div style="display:flex;justify-content:space-between;padding:12px 0;
                  border-top:1px solid {border};font-weight:800">
        <span>إجمالي الأصول المتداولة</span><span dir="ltr">15,000.000</span></div>
      <div style="display:flex;justify-content:space-between;padding:12px 0;
                  border-top:2px solid {tint};font-weight:800">
        <span>إجمالي الأصول</span><span dir="ltr">16,348.500</span></div>
    </div>
    <p class="ds-note"><b>نظام أرقام واحد</b> في كل الصفحات: أرقام لاتينية بفاصل
      آلاف. وملف XBRL نفسه يبقى بلا فواصل — الفاصلة تُفسد ملفاً يقرؤه حاسوب.</p>""")

    # ── the index ──────────────────────────────────────────────────────────
    cards = [(p, re.search(r'group="([^"]+)"', c).group(1),
              re.search(r"<title>([^—]+)", c).group(1).strip())
             for p, c in files.items() if p.startswith("components/")]
    links = "".join(
        f'<li><a href="{p}">{t}</a> <span class="ds-note">— {g}</span></li>'
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
    <p>مولَّد من ملفات الموقع نفسها — <code>design/design_system.py</code></p>
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

    fonts = OUT / "fonts"
    if not check:
        fonts.mkdir(parents=True, exist_ok=True)
        for f in sorted((SITE / "fonts").glob("*.woff2")):
            shutil.copy2(f, fonts / f.name)
        shutil.copy2(SITE / "fonts" / "LICENSE-Cairo.txt", fonts / "LICENSE-Cairo.txt")
    elif not (fonts / "cairo-400.woff2").exists():
        stale.append("fonts/")

    if check:
        if stale:
            sys.exit("design-system bundle is stale: " + ", ".join(stale))
        print("the design-system bundle is current")
    else:
        print(f"{OUT.relative_to(ROOT)} — {len(files)} files + 5 font files")


if __name__ == "__main__":
    main()
