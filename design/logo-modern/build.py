#!/usr/bin/env python3
"""A modern lockup: the Almuhallab boum as a flat illustration, white on black.

Owner's brief (2026-10-03): «modern look logo with black background and white
font, with the Almuhallab ship in illustration style». A design proposal — the
site's identity (the pixel boum) is not replaced by it.

The ship is the same boum: drawn over the polygons in design/matrix_logo.py
(BOUM), so the double-ended hull, the two lateen sails and the tall mainmast
forward are hers, not a stock dhow. Type is the lockup's own: المهلب in Reem
Kufi 700, the Latin line in Share Tech Mono — both bundled with the site.

    python3 design/logo-modern/build.py      # writes SVG (ship only) + PNGs
"""
import base64, sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
sys.path.insert(0, str(ROOT / "design"))
import matrix_logo as ml  # noqa: E402

CHROME = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"
W, H = 420, 210            # the ship's drawing box
INK, SOFT, DIM, BG = "#ffffff", "#c9ced6", "#6b7480", "#0b0b0c"


def P(u, v):
    return f"{u * W:.1f} {v * H:.1f}"


def ship_svg():
    main_sail, mizzen, mast1, mast2, hull = ml.BOUM
    s = []
    # sails: the polygon's straight leech bowed out, like canvas holding wind
    def sail(tri, fill, belly):
        (a, b, c) = tri       # foot-fore, peak, foot-aft
        mx, my = (a[0] + b[0]) / 2 - belly, (a[1] + b[1]) / 2 - belly * .2
        return (f'<path fill="{fill}" d="M{P(*a)} Q{P(mx, my)} {P(*b)} L{P(*c)} '
                f'Q{P((a[0] + c[0]) / 2, a[1] + .03)} {P(*a)}Z"/>')
    s.append('<defs><clipPath id="cs1">' + sail(main_sail, "#000", .05) + '</clipPath>'
             '<clipPath id="cs2">' + sail(mizzen, "#000", .03) + '</clipPath></defs>')
    s.append(sail(main_sail, INK, .05))
    s.append(sail(mizzen, SOFT, .03))
    # sail panel seams, in the background colour so they read as cut lines
    for t in (.3, .55, .78):
        a, b, c = main_sail
        x1, y1 = a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t
        x2, y2 = c[0] + (b[0] - c[0]) * t * .98, c[1] + (b[1] - c[1]) * t
        s.append(f'<path clip-path="url(#cs1)" stroke="{BG}" stroke-width="2.2" d="M{P(x1, y1)} L{P(x2, y2)}"/>')
    for t in (.45,):
        a, b, c = mizzen
        x1, y1 = a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t
        x2, y2 = c[0] + (b[0] - c[0]) * t, c[1] + (b[1] - c[1]) * t
        s.append(f'<path clip-path="url(#cs2)" stroke="{BG}" stroke-width="2" d="M{P(x1, y1)} L{P(x2, y2)}"/>')
    # masts and their pennants
    for m, flag in ((mast1, .05), (mast2, .03)):
        x = (m[0][0] + m[1][0]) / 2
        s.append(f'<path stroke="{INK}" stroke-width="3.2" stroke-linecap="round" d="M{P(x, m[0][1] - .02)} L{P(x, m[2][1])}"/>')
        top = m[0][1] - .02
        s.append(f'<path fill="{SOFT}" d="M{P(x, top)} l{flag * W * 1.4:.1f} {6:.1f} l{-flag * W * 1.4:.1f} {6:.1f}z"/>')
    # hull: the polygon, with a sheer stripe and plank lines
    s.append('<path fill="%s" d="M%sZ"/>' % (INK, " L".join(P(*p) for p in hull)))
    s.append(f'<path fill="none" stroke="{BG}" stroke-width="2.4" d="M{P(.11, .7)} Q{P(.5, .73)} {P(.92, .64)}"/>')
    s.append(f'<path fill="none" stroke="{DIM}" stroke-width="1.6" d="M{P(.18, .78)} Q{P(.5, .82)} {P(.86, .74)}"/>')
    # stem and sternpost tips
    s.append(f'<circle cx="{0.01 * W:.1f}" cy="{0.43 * H:.1f}" r="3" fill="{INK}"/>')
    # sea: three flowing strokes under the keel
    for i, (y, a) in enumerate(((.93, INK), (.99, SOFT), (1.05, DIM))):
        x0, x1 = .06 + i * .07, .94 - i * .07
        s.append(f'<path fill="none" stroke="{a}" stroke-width="3" stroke-linecap="round" '
                 f'd="M{P(x0, y)} q{W * .07:.1f} -9 {W * .14:.1f} 0 t{W * .14:.1f} 0 t{W * .14:.1f} 0 t{W * .14:.1f} 0 t{W * .14:.1f} 0"/>')
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="-12 -18 {W + 24} {H * 1.12 + 30:.0f}" '
            f'fill="none">{"".join(s)}</svg>')


def font(name):
    return base64.b64encode((ROOT / "almuhallab/fonts" / name).read_bytes()).decode()


def page(layout, ship):
    css = f"""
@font-face {{ font-family: RK; src: url(data:font/woff2;base64,{font('reemkufi-700.woff2')}) format('woff2'); }}
@font-face {{ font-family: STM; src: url(data:font/woff2;base64,{font('sharetechmono-400.woff2')}) format('woff2'); }}
@font-face {{ font-family: Cairo; src: url(data:font/woff2;base64,{font('cairo-700.woff2')}) format('woff2'); }}
html, body {{ margin: 0; background: {BG}; }}
.c {{ width: var(--w); height: var(--h); display: flex; align-items: center; justify-content: center;
      gap: var(--gap); flex-direction: var(--dir); color: {INK}; }}
.ship {{ width: var(--ship); }}
.ship svg {{ display: block; width: 100%; height: auto; }}
.t {{ display: flex; flex-direction: column; align-items: var(--align); }}
.ar {{ font-family: RK; font-weight: 700; font-size: var(--ar); line-height: 1.4; text-rendering: geometricPrecision; }}
.en {{ font-family: STM; font-size: var(--en); letter-spacing: .32em; margin-inline-end: -.32em;
       color: {SOFT}; direction: ltr; margin-top: .2em; }}
.rule {{ width: 100%; height: 2px; background: linear-gradient(90deg, transparent, {DIM}, transparent); margin: .5em 0 .3em; }}
.tag {{ font-family: Cairo; font-weight: 700; font-size: calc(var(--en) * .95); color: {SOFT}; line-height: 1.5; text-rendering: geometricPrecision; }}
"""
    vars_ = {
        "stacked": "--w:1600px;--h:1600px;--dir:column;--gap:56px;--ship:900px;--ar:200px;--en:44px;--align:center",
        "horizontal": "--w:2400px;--h:900px;--dir:row-reverse;--gap:90px;--ship:980px;--ar:220px;--en:46px;--align:flex-start",
        "mark": "--w:1024px;--h:1024px;--dir:column;--gap:0;--ship:820px;--ar:0;--en:0;--align:center",
    }[layout]
    text = "" if layout == "mark" else (
        '<div class="t" dir="rtl"><div class="ar">المهلب</div><div class="en">ALMUHALLAB CODE</div>'
        '<div class="rule"></div><div class="tag">شركة برمجة وأنظمة</div></div>')
    return (f'<!doctype html><meta charset="utf-8"><style>{css}</style>'
            f'<div class="c" style="{vars_}"><div class="ship">{ship}</div>{text}</div>')


def main():
    from playwright.sync_api import sync_playwright
    ship = ship_svg()
    (HERE / "ship-white-on-black.svg").write_text(ship.replace('fill="none">', f'fill="none"><rect x="-12" y="-18" width="100%" height="100%" fill="{BG}"/>', 1))
    sizes = {"stacked": (1600, 1600), "horizontal": (2400, 900), "mark": (1024, 1024)}
    with sync_playwright() as p:
        b = p.chromium.launch(executable_path=CHROME)
        for name, (w, h) in sizes.items():
            pg = b.new_page(viewport={"width": w, "height": h}, device_scale_factor=2)
            html = page(name, ship)
            (HERE / f"{name}.html").write_text(html)
            pg.set_content(html); pg.wait_for_timeout(600)
            if name != "mark" and not pg.evaluate("document.fonts.check('700 40px RK') && document.fonts.check('40px STM')"):
                sys.exit("a face failed to load — refusing to render a fallback")
            pg.screenshot(path=str(HERE / f"almuhallab-{name}.png"))
            print("  wrote", f"almuhallab-{name}.png")
        b.close()


if __name__ == "__main__":
    main()
