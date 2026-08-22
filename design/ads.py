#!/usr/bin/env python3
"""Advertising creatives for المهلب كود — square posts and full-screen stories.

    python3 design/ads.py

Writes design/ads/<name>-post.png (1080×1080) and <name>-story.png (1080×1920),
their HTML sources beside them, and contact-sheet.png.

WHAT THIS IS NOT. design/instagram/ holds highlight covers — the little circles
under the profile that a visitor taps to navigate. They are signage. Nothing in
this repository was an advertisement until now: something a stranger scrolling
past has to be stopped by, told one thing, and given a way to answer.

TWO SIZES BECAUSE META TAKES TWO. 1080×1080 for the feed, 1080×1920 for stories
and reels. A square stretched to a story is letterboxed with grey; a story
cropped to a square loses its ends. They are laid out separately here, from the
same content, rather than one being resized into the other.

BUILT FROM THE SITE, NOT BESIDE IT. The mark is lifted from the page's own
<symbol> sprite, the colours are the tokens, the type is the bundled Cairo. An
advertisement drawn by hand in a design tool drifts from the product the first
time either changes, and nobody notices until a customer sees two different
brown. Re-run this after changing the logo and the ads follow.

WHITE PAPER, BROWN INK — the composition the site already uses: a brown bar at
the top, white beneath it, a brown bar at the foot carrying the way to reach
them. The covers in design/instagram/ are filled brown because a white circle
would dissolve into Instagram's white profile page, and at 64px there is room
for one shape; an advertisement is read at full width and has room to be the
brand's own way round.

EVERY CLAIM IS ONE THE COMPANY CAN MAKE. النوخذة is free, it runs offline, the
records stay on the device, the XBRL file is filed through the Ministry of
Commerce portal, and there are seven services. No invented customers, no
invented figures, no "number one in Kuwait".
"""

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SITE = ROOT / "almuhallab"
OUT = ROOT / "design" / "ads"

# the site's own tokens, not approximations of them
TINT = "#7a4418"
TINT_STRONG = "#6f3f1c"
TEXT = "#1b2430"
MUTED = "#586981"
PANEL_2 = "#f1f4f8"
BORDER = "#d0d7e1"

POST = (1080, 1080)
STORY = (1080, 1920)


def sprite_symbol(html: str, sid: str):
    m = re.search(r'<symbol id="%s" viewBox="([^"]+)">(.*?)</symbol>'
                  % re.escape(sid), html, re.S)
    if not m:
        raise SystemExit(f"the sprite has no #{sid}")
    return m.group(1), m.group(2)


# ── the advertisements themselves ─────────────────────────────────────────
# (name, kicker, headline, lines, proof, symbol)
ADS = [
    ("nokhatha", "من المهلب كود", "نظامك المحاسبي كامل.<br><b>مجاناً.</b>",
     ["المحفظة والقيمة السوقية",
      "الميزانية السنوية وملف XBRL",
      "الطلبات من الطلب حتى التسليم"],
     "يعمل بلا إنترنت · سجلاتك لا تغادر جهازك", "i-anchor"),

    ("xbrl", "الميزانية السنوية", "ملف <b>XBRL</b> جاهز للبوابة.",
     ["الإجماليات تُحسب من سطورها",
      "تدقيق يريك ما يمنع الإيداع",
      "قبل أن تودعه لا بعده"],
     "الإيداع عبر بوابة وزارة التجارة", "i-report"),

    ("company", "شركة برمجة وأنظمة", "نبني الأنظمة التي <b>تُشغّل</b> عملك.",
     ["مواقع · تطبيقات · برمجيات مخصّصة",
      "ذكاء اصطناعي · UI/UX",
      "حلول سحابية · تطوير ألعاب"],
     "سبع خدمات تحت سقف واحد", "i-blocks"),
]

WHATSAPP = "+965 6589 4110"
SITE_URL = "www.almuhallab-code.com"


def page(w, h, kicker, headline, lines, proof, vb, body, story):
    """One creative. Sizes are absolute px against a fixed canvas, so the
    layout cannot reflow differently on another machine."""
    fonts = (SITE / "fonts").as_uri()
    # A story is read at arm's length on a phone and a post inside a feed, so
    # the story is not the post scaled up — it is set larger and breathes more.
    head = 92 if story else 76
    lead = 40 if story else 34
    mark = 200 if story else 150
    bar = 210 if story else 160
    pad = 96 if story else 76
    gap = 34 if story else 22

    items = "".join(
        f'<li><span class="dot"></span>{t}</li>' for t in lines)

    return f"""<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8">
<style>
  @font-face {{ font-family:"Cairo"; src:url("{fonts}/cairo-400.woff2") format("woff2"); font-weight:400; font-display:block; }}
  @font-face {{ font-family:"Cairo"; src:url("{fonts}/cairo-500.woff2") format("woff2"); font-weight:500; font-display:block; }}
  @font-face {{ font-family:"Cairo"; src:url("{fonts}/cairo-700.woff2") format("woff2"); font-weight:700; font-display:block; }}
  @font-face {{ font-family:"Cairo"; src:url("{fonts}/cairo-800.woff2") format("woff2"); font-weight:800; font-display:block; }}
  * {{ box-sizing:border-box; margin:0; padding:0; }}
  /* The decorative mark is meant to bleed off the edge, so it must be
     clipped, not merely allowed to hang. Without this it widened the document
     to 1160px — and because the document is RTL, the scroll origin is the
     right edge, so the screenshot's window slid and every element was cut off
     on the right. The picture looked wrong in a way that pointed at the type,
     not at an eighty-pixel decoration behind it. Measured, not guessed:
     scrollWidth 1160 against a clientWidth of 1080. */
  html,body {{ width:{w}px; height:{h}px; overflow:hidden; }}
  body {{ font-family:"Cairo",system-ui,sans-serif; background:#fff; color:{TEXT};
          display:flex; flex-direction:column; -webkit-font-smoothing:antialiased; }}

  /* the masthead, the same brown bar the site wears */
  .top {{ height:{bar}px; background:{TINT_STRONG}; color:#fff;
          display:flex; align-items:center; gap:26px; padding:0 {pad}px; flex:none; }}
  .top svg {{ width:{mark}px; height:{mark//2}px; color:#fff; }}
  .top .name {{ font-weight:800; font-size:{lead + 6}px; line-height:1.35; }}
  .top .name small {{ display:block; font-weight:500; font-size:{lead - 10}px; opacity:.92; }}

  .body {{ flex:1; padding:{pad}px; display:flex; flex-direction:column;
           position:relative; overflow:hidden;
           justify-content:center; gap:{gap}px; }}
  .kicker {{ color:{TINT}; font-weight:700; font-size:{lead - 6}px; letter-spacing:2px; }}
  h1 {{ font-size:{head}px; font-weight:500; line-height:1.35; letter-spacing:-1px; }}
  h1 b {{ font-weight:800; color:{TINT}; }}
  ul {{ list-style:none; display:flex; flex-direction:column; gap:{gap - 8}px;
        margin-top:{gap//2}px; }}
  li {{ display:flex; align-items:center; gap:18px; font-size:{lead}px; color:{TEXT}; }}
  .dot {{ width:14px; height:14px; border-radius:50%; background:{TINT};
          flex:none; }}
  .proof {{ margin-top:{gap}px; align-self:flex-start; background:{PANEL_2};
            border:2px solid {BORDER}; border-radius:999px;
            padding:{gap//2}px {gap + 8}px; font-size:{lead - 8}px; color:{MUTED}; }}
  /* The sprite's icons are DRAWN, not filled: the site sets fill:none and
     strokes them with currentColor. Dropped in without that, each one renders
     as a solid silhouette — the anchor became a grey bowl and the document a
     grey rectangle, both of which read as a failed image rather than as a
     watermark. Same treatment as .ic on the site, at a weight that survives
     being blown up to 600px. */
  .art {{ position:absolute; opacity:.10; color:{TINT};
          fill:none; stroke:currentColor; stroke-width:0.9;
          stroke-linecap:round; stroke-linejoin:round;
          {"bottom:" + str(bar + 40) + "px; left:-90px; width:620px; height:620px"
           if story else "top:" + str(bar + 30) + "px; left:-80px; width:430px; height:430px"}; }}

  /* the way to answer, which is the point of an advertisement */
  .cta {{ height:{bar}px; background:{TINT_STRONG}; color:#fff; flex:none;
          display:flex; align-items:center; justify-content:space-between;
          padding:0 {pad}px; }}
  .cta .wa {{ display:flex; align-items:center; gap:16px;
              font-size:{lead + 2}px; font-weight:800; }}
  .cta .wa svg {{ width:{lead + 10}px; height:{lead + 10}px; stroke:#fff;
                  fill:none; stroke-width:1.8; stroke-linecap:round; }}
  .cta .site {{ font-size:{lead - 8}px; opacity:.92; }}
  .ltr {{ unicode-bidi:isolate; direction:ltr; }}
</style></head><body>
  <div class="top">
    <svg viewBox="0 0 48 24" aria-hidden="true">{BOUM}</svg>
    <div class="name">المهلب<small>Almuhallab Code</small></div>
  </div>
  <div class="body">
    <svg class="art" viewBox="{vb}" aria-hidden="true">{body}</svg>
    <div class="kicker">{kicker}</div>
    <h1>{headline}</h1>
    <ul>{items}</ul>
    <div class="proof">{proof}</div>
  </div>
  <div class="cta">
    <div class="wa"><svg viewBox="0 0 24 24">{WA}</svg>
      <span class="ltr">{WHATSAPP}</span></div>
    <div class="site ltr">{SITE_URL}</div>
  </div>
</body></html>"""


BOUM = ""   # filled in main() from the page's own sprite
WA = ""


def main() -> int:
    global BOUM, WA
    html = (SITE / "index.html").read_text()
    _, BOUM = sprite_symbol(html, "i-boum")
    _, WA = sprite_symbol(html, "i-whatsapp")

    OUT.mkdir(parents=True, exist_ok=True)
    written = []
    for name, kicker, headline, lines, proof, sid in ADS:
        vb, body = sprite_symbol(html, sid)
        for kind, (w, h) in (("post", POST), ("story", STORY)):
            src = page(w, h, kicker, headline, lines, proof, vb, body,
                       kind == "story")
            f = OUT / f"{name}-{kind}.html"
            f.write_text(src)
            written.append((f"{name}-{kind}", w, h))

    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print("playwright missing — HTML written, PNGs skipped")
        return 0

    chrome = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"
    with sync_playwright() as pw:
        br = pw.chromium.launch(executable_path=chrome)
        for name, w, h in written:
            pg = br.new_context(viewport={"width": w, "height": h},
                                device_scale_factor=1).new_page()
            pg.goto((OUT / f"{name}.html").as_uri())
            pg.wait_for_timeout(150)
            pg.evaluate("document.fonts.ready")
            pg.wait_for_timeout(150)
            pg.screenshot(path=str(OUT / f"{name}.png"))
            pg.close()
            print(f"  {name}.png  {w}×{h}")

        # Shown at the size a phone actually renders them, because an ad that
        # only works at 1080px wide is an ad nobody sees working.
        cells = "".join(
            f'<figure><img src="{n}.png" style="width:{160 if h > w else 200}px">'
            f'<figcaption>{n}</figcaption></figure>' for n, w, h in written)
        sheet = f"""<!doctype html><meta charset="utf-8"><body style="margin:0;
          padding:36px; background:#fff; font-family:system-ui; display:flex;
          flex-wrap:wrap; gap:28px; align-items:flex-end">
          <style>figure{{margin:0;text-align:center}}
                 img{{border:1px solid #d0d7e1;display:block}}
                 figcaption{{font-size:12px;color:#586981;margin-top:8px}}</style>
          {cells}</body>"""
        (OUT / "contact-sheet.html").write_text(sheet)
        pg = br.new_context(viewport={"width": 1180, "height": 900}).new_page()
        pg.goto((OUT / "contact-sheet.html").as_uri())
        pg.wait_for_timeout(400)
        pg.screenshot(path=str(OUT / "contact-sheet.png"), full_page=True)
        br.close()

    print(f"\n  {len(written)} creatives in {OUT}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
