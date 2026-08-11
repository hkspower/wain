#!/usr/bin/env python3
"""Draw النوخذة's Windows app icon from the site's own sprite.

Windows shows this in the Start menu, the taskbar, Alt-Tab and the installer,
at sizes from 256px down to 16px. It is built from the *square* boum — the wide
form would be squashed into a square hole — and emitted as a real multi-size
.ico so Windows picks the right one instead of scaling a single bitmap badly.
"""
import io, pathlib, re, sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
SITE = ROOT / "almuhallab"
OUT = ROOT / "nokhatha_app" / "windows" / "runner" / "resources" / "app_icon.ico"
CHROME = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"

# Windows uses every one of these; omitting the small ones is why some apps
# look like mud in the taskbar.
SIZES = [256, 128, 64, 48, 32, 24, 16]


def square_mark() -> str:
    html = (SITE / "index.html").read_text(encoding="utf-8")
    m = re.search(r'<symbol id="i-sail" viewBox="([^"]+)">(.*?)</symbol>', html, re.S)
    if not m:
        sys.exit("i-sail symbol not found — did the mark move?")
    return m.group(1), m.group(2)


def render(px: int) -> bytes:
    from playwright.sync_api import sync_playwright
    viewbox, body = square_mark()
    # The tile matches favicon.svg: the brand gradient, the mark in white,
    # inset so the hull is not shaved off by the rounded corner.
    page = f"""<!doctype html><html><body style="margin:0">
      <svg xmlns="http://www.w3.org/2000/svg" width="{px}" height="{px}" viewBox="0 0 512 512">
        <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#e3a556"/><stop offset="1" stop-color="#6f3f1c"/>
        </linearGradient></defs>
        <rect width="512" height="512" rx="96" fill="url(#g)"/>
        <!-- color, not fill: the symbol's own paths declare fill="currentColor",
             which overrides a group fill attribute and resolves to black. The
             site sets the CSS color property for exactly this reason. -->
        <g transform="translate(72 72) scale(15.3)" style="color:#ffffff">{body}</g>
      </svg></body></html>"""
    with sync_playwright() as p:
        b = p.chromium.launch(executable_path=CHROME)
        pg = b.new_page(viewport={"width": px, "height": px},
                        device_scale_factor=1)
        pg.set_content(page)
        pg.wait_for_timeout(250)
        shot = pg.screenshot(omit_background=True)
        b.close()
    return shot


def main() -> None:
    from PIL import Image
    frames = []
    for px in SIZES:
        frames.append(Image.open(io.BytesIO(render(px))).convert("RGBA"))
    OUT.parent.mkdir(parents=True, exist_ok=True)
    frames[0].save(OUT, format="ICO",
                   sizes=[(f.width, f.height) for f in frames],
                   append_images=frames[1:])
    print(f"{OUT.relative_to(ROOT)} — {', '.join(str(s) for s in SIZES)}px, "
          f"{OUT.stat().st_size // 1024} KB")


if __name__ == "__main__":
    main()
