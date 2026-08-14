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
    """النوخذة's own mark — the anchor — not the company's boum.

    This used to read `#i-sail` out of the company page, which put المهلب's
    boum on النوخذة's application: the two are marked differently on purpose,
    and crossing them is exactly what the identity rule forbids. icon.svg is
    the product's mark and already carries the brand tile, so the whole file
    is used as-is rather than re-tiled here.
    """
    svg = (SITE / "icon.svg").read_text(encoding="utf-8")
    if "circle" not in svg:
        sys.exit("icon.svg does not look like the anchor — did the mark move?")
    return svg


def render(px: int) -> bytes:
    from playwright.sync_api import sync_playwright
    page = f"""<!doctype html><html><body style="margin:0">
      <div style="width:{px}px;height:{px}px">{square_mark()}</div>
      </body></html>"""
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
