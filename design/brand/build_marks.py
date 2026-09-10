#!/usr/bin/env python3
"""Draw four candidate marks for المهلب as Design Component artboards.

    python3 design/brand/build_marks.py     # writes the .dc.html artboards

FOUR DIRECTIONS, FOUR AXES — not four shades of one idea. A set where every
candidate is the same thought at a different angle is no choice at all, so each
of these answers the brief from somewhere else: the company's own letter, a
navigator's instrument, one abstract form, and a geometric pattern.

ONE GENERATOR, NOT FOUR HAND-WRITTEN PAGES. The four artboards differ only in
the mark; everything around them — the stage, the lockup, the size ladder, the
mono and reversed tests — is identical on purpose, because a comparison set
whose frames differ is comparing the frames. Written by hand they would drift
apart on the first edit.

THE BROWN STAYS. The owner asked to replace the mark, not the palette, so
#7a4418 / #6f3f1c on white carries over unchanged. Nothing here touches the
locked boum: the site, the logo pack, the app, the ads and the film all still
fly it, and none of this is wired into any of them.
"""

import pathlib

HERE = pathlib.Path(__file__).resolve().parent

TINT = "#7a4418"
TINT_STRONG = "#6f3f1c"
LINE = "#e3e5e8"        # cool near-neutral, never warm — the no-beige rule
SURFACE = "#f5f6f7"
MUTED = "#666d75"

# ---------------------------------------------------------------------------
# The marks. Each is (viewBox, body) drawn with currentColor so one definition
# serves the brown stage, the black mono test and the white reversed test.

MARKS = {
    # An astrolabe: the instrument a navigator reads, not the boat he steers.
    # Suspension ring, mater, rete and the alidade laid across it.
    "astrolabe": ("0 0 48 52", """
  <circle cx="24" cy="4.6" r="3" fill="none" stroke="currentColor" stroke-width="2.2"/>
  <path d="M24 7.6 V12" fill="none" stroke="currentColor" stroke-width="2.8"/>
  <circle cx="24" cy="29" r="17" fill="none" stroke="currentColor" stroke-width="3.2"/>
  <circle cx="24" cy="29" r="8" fill="none" stroke="currentColor" stroke-width="2.4"/>
  <path d="M11.98 41.02 36.02 16.98" fill="none" stroke="currentColor" stroke-width="3.2"/>
  <circle cx="24" cy="29" r="2.8" fill="currentColor"/>"""),

    # Square-Kufic ميم: the bowl with its counter, and the descender. The
    # company's own initial, built on right angles.
    # The descender hangs from the RIGHT. Drawn on the left it is a Latin P —
    # not "may be mistaken for", it IS one: the left-hand stem under a bowl is
    # exactly where a P's stem goes. Arabic writes right to left and the meem
    # connects on its right, so that is where the tail belongs, and putting it
    # there is also what stops the mark reading as a Latin letter.
    "meem": ("0 0 52 50", """
  <path fill="currentColor" fill-rule="evenodd"
        d="M14 6 H38 V30 H14 Z M21.5 13.5 H30.5 V22.5 H21.5 Z"/>
  <path fill="currentColor" d="M30 30 H38 V44 H30 Z"/>"""),

    # One form: a sail, and the line it stands on. Nothing else.
    "sail": ("0 0 48 50", """
  <path fill="currentColor" d="M15 40 V8 C29 15 37 26 39 40 Z"/>
  <path fill="currentColor" d="M6 43.5 H42 V47.5 H6 Z"/>"""),

    # Two squares, one turned: the eight-point star of Islamic geometry.
    "star": ("0 0 48 48", """
  <path fill="none" stroke="currentColor" stroke-width="3.4" stroke-linejoin="miter"
        d="M9 9 H39 V39 H9 Z"/>
  <path fill="none" stroke="currentColor" stroke-width="3.4" stroke-linejoin="miter"
        d="M24 4.5 L43.5 24 L24 43.5 L4.5 24 Z"/>
  <path fill="currentColor" d="M24 19 L29 24 L24 29 L19 24 Z"/>"""),
}

# name · what it is · why it earns the mark · what it costs
BOARDS = [
    ("Main", "astrolabe", "الأسطرلاب",
     "آلة الملّاح، لا المركب الذي يقوده",
     "يبقي معنى الملاحة الذي تعيش فيه أسماء المنتجات كلّها — النوخذة والبحّار — "
     "من غير أن يرسم قارباً. والآلة تقول دقّةً وضبطاً، وهو ما تبيعه شركة أنظمة.",
     "أكثر الأربعة تفصيلاً، وعيبه أثقل ممّا يبدو: عند ١٦ بكسل تذوب الحلقة "
     "الداخلية فيبقى قرصٌ يشقّه خطّ مائل — وهو شكل علامة المنع. رأيتُه في "
     "سلّم المقاسات هنا، فانظر إليه بنفسك قبل أن تقرّر."),
    ("Meem", "meem", "الميم الكوفيّة",
     "حرف الاسم نفسه، بالكوفي المربّع",
     "الاسم يصير العلامة — أملَكُ ما يكون، ولا يشبه أحداً غيرك. وهو أقوى الأربعة "
     "عند المقاسات الصغيرة: كتلتان فقط، لا تذوبان.",
     "يقطع صلة الشركة بالبحر قطعاً تامّاً، فتبقى النوخذة والبحّار بلا سند بصري. "
     "وقد يقرؤه غير العربي حرفاً لاتينياً."),
    ("Sail", "sail", "الشراع المجرّد",
     "شكل واحد، والخطّ الذي يقوم عليه",
     "أبسط الأربعة وأقواها في الحركة وعلى الشاشات الصغيرة، ويبقي إيماءةً إلى "
     "البحر بلا حكاية. حديث وبرمجيّ النبرة.",
     "أعمّها: شراعٌ منحنٍ شكلٌ تستعمله شركات كثيرة، فيحتاج التزاماً في التطبيق "
     "ليصير لك لا لغيرك."),
    ("Star", "star", "النجمة الثمانية",
     "مربّعان، أحدهما مُدار",
     "هندسة إسلاميّة كويتيّة المزاج، تقول نظاماً وانضباطاً بشكل واحد. تمتاز على "
     "الورق وفي الختم والحفر.",
     "شائعة في المنطقة، فهي أقلّ الأربعة تميّزاً وحدها؛ تحتاج التواءً خاصّاً "
     "بك لتملكها."),
]


def svg(key, px, color):
    vb, body = MARKS[key]
    w, h = float(vb.split()[2]), float(vb.split()[3])
    return (f'<svg viewBox="{vb}" width="{px * w / h:.0f}" height="{px}" '
            f'style="color: {color}; display: block" '
            f'role="img" aria-label="mark">{body}\n  </svg>')


def artboard(name, key, title, kicker, why, cost):
    ladder = "".join(f"""
        <div style="display: flex; flex-direction: column; align-items: center; gap: 10px">
          {svg(key, px, TINT_STRONG)}
          <span style="font-size: 11px; color: {MUTED}; letter-spacing: .04em">{px}px</span>
        </div>""" for px in (56, 32, 24, 16))

    return f"""<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <script src="./support.js"></script>
</head>
<body>
<x-dc>
<helmet>
  <link rel="stylesheet"
        href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;500;700;800&display=swap">
  <style>
    body {{ margin: 0; background: #fff;
           font-family: Cairo, "Segoe UI", Tahoma, sans-serif; }}
    a {{ color: {TINT}; }} a:hover {{ color: {TINT_STRONG}; }}
  </style>
</helmet>
<div dir="rtl" style="width: 680px; min-height: 1100px; background: #fff; padding: 44px;
     box-sizing: border-box; display: flex; flex-direction: column; gap: 26px;
     color: #1a1c1e">

  <div style="display: flex; flex-direction: column; gap: 6px">
    <div style="font-size: 26px; font-weight: 800; color: {TINT_STRONG};
         line-height: 1.35">{title}</div>
    <div style="font-size: 14px; color: {MUTED}; line-height: 1.5">{kicker}</div>
  </div>

  <div style="border: 1px solid {LINE}; height: 260px; display: flex;
       align-items: center; justify-content: center; background: #fff">
    {svg(key, 168, TINT_STRONG)}
  </div>

  <div style="display: flex; align-items: center; gap: 18px; border: 1px solid {LINE};
       padding: 22px 24px">
    {svg(key, 62, TINT_STRONG)}
    <div style="display: flex; flex-direction: column; gap: 3px">
      <div style="font-size: 27px; font-weight: 800; color: {TINT_STRONG};
           line-height: 1.2">المهلب</div>
      <div style="font-size: 13px; font-weight: 700; color: {TINT}; letter-spacing: .1em;
           direction: ltr; unicode-bidi: isolate; line-height: 1.3">Almuhallab Code</div>
      <div style="font-size: 12px; font-weight: 500; color: {MUTED};
           line-height: 1.4">شركة برمجة وأنظمة</div>
    </div>
  </div>

  <div style="display: flex; align-items: flex-end; justify-content: space-between;
       border: 1px solid {LINE}; padding: 22px 30px">{ladder}
  </div>

  <div style="display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px">
    <div style="border: 1px solid {LINE}; background: #fff; height: 118px;
         display: flex; align-items: center; justify-content: center">
      {svg(key, 58, "#101112")}
    </div>
    <div style="background: {TINT_STRONG}; height: 118px; display: flex;
         align-items: center; justify-content: center">
      {svg(key, 58, "#ffffff")}
    </div>
  </div>

  <div style="background: {SURFACE}; padding: 20px 22px; display: flex;
       flex-direction: column; gap: 12px">
    <div style="font-size: 13px; line-height: 1.65; color: #26292c">
      <b style="color: {TINT_STRONG}">لماذا</b> — {why}</div>
    <div style="font-size: 13px; line-height: 1.65; color: #26292c">
      <b style="color: {TINT_STRONG}">المقايضة</b> — {cost}</div>
  </div>

</div>
</x-dc>
</body>
</html>
"""


def main():
    for name, key, title, kicker, why, cost in BOARDS:
        out = HERE / f"{name}.dc.html"
        out.write_text(artboard(name, key, title, kicker, why, cost),
                       encoding="utf-8")
        print(f"  {out.name:<16} {title}")
    print(f"\n  {len(BOARDS)} artboards · brown on white, unchanged")


if __name__ == "__main__":
    main()
