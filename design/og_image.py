#!/usr/bin/env python3
"""Draw the social share card — almuhallab/og.png, 1200x630.

Every link to the site that lands in WhatsApp, Instagram, LinkedIn or a search
result's rich preview shows this image. Without it a share is a naked URL, and
واتساب is the company's main channel — so this is not decoration.

It is drawn from the page's own sprite (the wide boum) and the page's own
tokens, so it can never drift from the identity: re-run after any change to
the mark and the card follows.
"""
import pathlib, re, subprocess, sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
SITE = ROOT / "almuhallab"
OUT = SITE / "og.png"
CHROME = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"

BROWN = "#25292f"


def wide_mark() -> str:
    """Lift the illustrated boum straight out of the page sprite (#i-ship)."""
    html = (SITE / "index.html").read_text(encoding="utf-8")
    m = re.search(r'<symbol id="i-ship" viewBox="([^"]+)">(.*?)</symbol>', html, re.S)
    if not m:
        sys.exit("i-ship symbol not found in index.html — did the mark move?")
    return f'<svg viewBox="{m.group(1)}" style="width:340px;height:auto;color:#fff;--ship-cut:#25292f">{m.group(2)}</svg>'


def build() -> str:
    # Fonts go in as data: URIs. The page is set_content()'d onto about:blank,
    # which may not load file:// URLs — every face silently fell back to the
    # system font, and the share card shipped in DejaVu for months.
    def uri(name):
        import base64
        b = (SITE / "fonts" / name).read_bytes()
        return "data:font/woff2;base64," + base64.b64encode(b).decode()
    font, font7 = uri("cairo-800.woff2"), uri("cairo-700.woff2")
    kufi, mono = uri("reemkufi-700.woff2"), uri("sharetechmono-400.woff2")
    return f"""<!doctype html><html dir="rtl"><head><meta charset="utf-8"><style>
      @font-face {{ font-family:"Cairo"; font-weight:800; src:url("{font}") format("woff2"); }}
      @font-face {{ font-family:"Cairo"; font-weight:700; src:url("{font7}") format("woff2"); }}
      @font-face {{ font-family:"Reem Kufi"; font-weight:700; src:url("{kufi}") format("woff2"); }}
      @font-face {{ font-family:"Share Tech Mono"; font-weight:400; src:url("{mono}") format("woff2"); }}
      * {{ margin:0; box-sizing:border-box; }}
      body {{ width:1200px; height:630px; background:{BROWN}; color:#fff;
             font-family:"Cairo",system-ui,sans-serif;
             display:flex; flex-direction:column; align-items:center;
             justify-content:center; gap:26px; }}
      .name {{ font-family:"Reem Kufi","Cairo",sans-serif; font-size:96px; font-weight:700; line-height:1.35; }}
      .en {{ font-family:"Share Tech Mono",monospace; font-size:32px; font-weight:400;
            letter-spacing:.32em; margin-inline-end:-.32em;
            direction:ltr; unicode-bidi:isolate; }}
      .sub {{ font-size:27px; font-weight:700; color:rgba(255,255,255,.84); }}
      .rule {{ width:132px; height:3px; background:rgba(255,255,255,.42); border-radius:2px; }}
    </style></head><body>
      {wide_mark()}
      <div class="name">المهلب</div>
      <div class="en">Almuhallab&nbsp;Code</div>
      <div class="rule"></div>
      <div class="sub">شركة برمجة وأنظمة في الكويت</div>
    </body></html>"""


def main() -> None:
    from playwright.sync_api import sync_playwright
    with sync_playwright() as p:
        b = p.chromium.launch(executable_path=CHROME)
        pg = b.new_page(viewport={"width": 1200, "height": 630})
        pg.set_content(build())
        pg.evaluate("document.fonts.ready")
        faces = pg.evaluate("""Promise.all([
            document.fonts.load('700 96px "Reem Kufi"', 'المهلب'),
            document.fonts.load('400 32px "Share Tech Mono"', 'Code'),
            document.fonts.load('700 27px "Cairo"', 'شركة')]).then(r => r.map(x => x.length))""")
        if 0 in faces:
            sys.exit(f"a face failed to load {faces} — refusing to ship a system-font card")
        pg.screenshot(path=str(OUT))
        b.close()
    kb = OUT.stat().st_size / 1024
    print(f"{OUT.relative_to(ROOT)} — 1200x630, {kb:.0f} KB")


if __name__ == "__main__":
    main()
