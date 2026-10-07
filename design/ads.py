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

BUILT FROM THE SITE, NOT BESIDE IT. The marks are the site's own files,
the icons its <symbol> sprite, the colours the tokens, the type the bundled faces. An
advertisement drawn by hand in a design tool drifts from the product the first
time either changes, and nobody notices until a customer sees two different
brown. Re-run this after changing the logo and the ads follow.

THE LOGO'S DARK, AMBER INK (since 2026-10-07): the near-black ground, the
English logo (design/logo-en/) heading every creative as the company's mark,
amber as ink only. An ad for النوخذة also shows the product's own amber
anchor (almuhallab/icon.svg): the company and the product are marked
differently on purpose. Arabic in Cairo, Latin display in Chakra Petch,
figures and the address in JetBrains Mono, all from almuhallab/fonts.

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

# the site's own tokens (the dark logo theme, 2026-10-07), not approximations
BG = "#0a0908"        # --bg, the logo's ground
PANEL = "#141211"     # --panel
PANEL_3 = "#242321"   # --panel-3
TINT = "#e6a95c"      # --tint, the logo's amber: always ink, never paper
STRIPE = "#7f5d33"    # --stripe
TEXT = "#f4f4f4"      # --on-bar
MUTED = "#b9b3ab"
BORDER = "#363534"    # --border

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
     "يعمل بلا إنترنت · سجلاتك لا تغادر جهازك", "ANCHOR"),

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
    # Relative, not (SITE / "fonts").as_uri(): that baked the generating
    # machine's absolute path (file:///home/user/wain/...) into every
    # committed .html here, which is exactly the class of bug already fixed
    # in the design/ scripts themselves — except this one lived in the
    # generated OUTPUT, so it survived that sweep. OUT (design/ads/) sits a
    # fixed two levels from SITE/fonts (almuhallab/fonts/) in this repo
    # layout, so the relative path is stable and the committed files open
    # correctly from any checkout, not only this container's.
    fonts = "../../almuhallab/fonts"
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
    if vb is None:   # النوخذة: its own amber anchor tile, not a watermark
        art = '<img class="anchor" src="../../almuhallab/icon.svg" alt="">'
    else:
        art = f'<svg class="art" viewBox="{vb}" aria-hidden="true">{body}</svg>'
    logo = "../logo-en/almuhallab-code-logo-for-dark.svg"
    lat = "U+0000-00FF,U+2000-206F"
    ar = "U+0600-06FF,U+0750-077F,U+08A0-08FF,U+FB50-FDFF,U+FE70-FEFF"
    faces = "".join(
        f'@font-face {{ font-family:"Cairo"; src:url("{fonts}/cairo-{w_}.woff2") format("woff2"); font-weight:{w_}; unicode-range:{ar}; font-display:block; }}\n'
        f'@font-face {{ font-family:"Cairo"; src:url("{fonts}/cairo-latin.woff2") format("woff2"); font-weight:{w_}; unicode-range:{lat}; font-display:block; }}\n'
        for w_ in (400, 500, 700, 800))
    aw = 260 if story else 190

    return f"""<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8">
<style>
  {faces}
  @font-face {{ font-family:"Chakra Petch"; src:url("{fonts}/chakrapetch-700.woff2") format("woff2"); font-weight:700; font-display:block; }}
  @font-face {{ font-family:"JetBrains Mono"; src:url("{fonts}/jetbrainsmono-latin.woff2") format("woff2"); font-weight:400 800; font-display:block; }}
  * {{ box-sizing:border-box; margin:0; padding:0; }}
  /* The decorative mark bleeds off the edge, so it must be clipped: without
     this the RTL document widened to 1160px and the screenshot slid. */
  html,body {{ width:{w}px; height:{h}px; overflow:hidden; }}
  body {{ font-family:"Cairo",sans-serif; background:{BG}; color:{TEXT};
          display:flex; flex-direction:column; -webkit-font-smoothing:antialiased; }}

  /* the masthead: the company's English logo on its own ground */
  .top {{ height:{bar + 40}px; display:flex; align-items:center; justify-content:center;
          flex:none; position:relative;
          background:radial-gradient(60% 70% at 50% 55%, rgba(230,169,92,.10), transparent 70%); }}
  .top img {{ height:{bar - 20}px; }}
  .top::after, .cta::before {{ content:""; position:absolute; left:{pad}px; right:{pad}px; height:2px;
          background:linear-gradient(90deg, transparent, {STRIPE}, {TINT}, {STRIPE}, transparent); }}
  .top::after {{ bottom:0; }}

  .body {{ flex:1; padding:{pad}px; display:flex; flex-direction:column;
           position:relative; overflow:hidden;
           justify-content:center; gap:{gap}px; }}
  .kicker {{ color:{TINT}; font-weight:700; font-size:{lead - 6}px; }}
  .kicker .p {{ font-family:"JetBrains Mono",monospace; margin-left:14px; }}
  h1 {{ font-size:{head}px; font-weight:500; line-height:1.35; letter-spacing:-1px; }}
  h1 b {{ font-weight:800; color:{TINT}; }}
  ul {{ list-style:none; display:flex; flex-direction:column; gap:{gap - 8}px;
        margin-top:{gap//2}px; }}
  li {{ display:flex; align-items:center; gap:18px; font-size:{lead}px; color:{TEXT}; }}
  .dot {{ width:14px; height:14px; border-radius:2px; background:{TINT}; flex:none; }}
  .proof {{ margin-top:{gap}px; align-self:flex-start; background:{PANEL_3};
            border:2px solid {BORDER}; border-radius:999px;
            padding:{gap//2}px {gap + 8}px; font-size:{lead - 8}px; color:{TEXT}; }}
  /* sprite icons are drawn, not filled: stroke with currentColor */
  .art {{ position:absolute; opacity:.12; color:{TINT};
          fill:none; stroke:currentColor; stroke-width:0.9;
          stroke-linecap:round; stroke-linejoin:round;
          {"bottom:40px; left:-90px; width:620px; height:620px"
           if story else "top:30px; left:-80px; width:430px; height:430px"}; }}
  .anchor {{ position:absolute; left:{pad}px; bottom:{pad}px;
             width:{aw}px; height:{aw}px; }}

  /* the way to answer, which is the point of an advertisement */
  .cta {{ height:{bar}px; background:{PANEL}; color:{TEXT}; flex:none; position:relative;
          display:flex; align-items:center; justify-content:space-between;
          padding:0 {pad}px; }}
  .cta::before {{ top:0; }}
  .cta .wa {{ display:flex; align-items:center; gap:16px;
              font-family:"JetBrains Mono",monospace; font-size:{lead}px; font-weight:800; }}
  .cta .wa svg {{ width:{lead + 10}px; height:{lead + 10}px; stroke:{TINT};
                  fill:none; stroke-width:1.8; stroke-linecap:round; }}
  .cta .site {{ font-family:"JetBrains Mono",monospace; font-size:{lead - 12}px; color:{TINT}; }}
  .ltr {{ unicode-bidi:isolate; direction:ltr; }}
</style></head><body>
  <div class="top"><img src="{logo}" alt="Almuhallab Code"></div>
  <div class="body">
    {art}
    <div class="kicker"><bdi class="p" dir="ltr">&gt;_</bdi>{kicker}</div>
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


WA = ""


def main() -> int:
    global WA
    html = (SITE / "index.html").read_text()
    _, WA = sprite_symbol(html, "i-whatsapp")

    OUT.mkdir(parents=True, exist_ok=True)
    written = []
    for name, kicker, headline, lines, proof, sid in ADS:
        vb, body = (None, None) if sid == "ANCHOR" else sprite_symbol(html, sid)
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
          padding:36px; background:#0a0908; font-family:system-ui; display:flex;
          flex-wrap:wrap; gap:28px; align-items:flex-end">
          <style>figure{{margin:0;text-align:center}}
                 img{{border:1px solid #363534;display:block}}
                 figcaption{{font-size:12px;color:#b9b3ab;margin-top:8px}}</style>
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
