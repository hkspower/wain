"""
Compose the captured pages into a presentable A4-landscape PDF sample.
Cover + contents + one plate per page + mobile trio + a closing spec sheet.
"""
import math, pathlib
from PIL import Image, ImageDraw, ImageFont

W, H = 3508, 2480                      # A4 landscape @ 300dpi
# Resolved from this file, never from an absolute path: the checkout is not
# always at the same place, and an absolute one silently writes nowhere.
D   = pathlib.Path(__file__).resolve().parent
OUT = D / "out"                        # everything generated lives under out/
SH  = OUT / "shots"
PV  = OUT / "pdf-preview"   # the small page previews, beside the PDF they come from
PV.mkdir(parents=True, exist_ok=True)

FONTS = "/root/.claude/skills/canvas-design/canvas-fonts/"
F_DISP = FONTS + "Italiana-Regular.ttf"
F_TECH = FONTS + "Jura-Light.ttf"
F_MED  = FONTS + "Jura-Medium.ttf"
F_MONO = FONTS + "GeistMono-Regular.ttf"
F_AR   = str(D.parent / "almuhallab" / "fonts" / "cairo-700.woff2")   # Cairo, the site's own face

INK        = (255, 255, 255)   # --bg: white surfaces, no dark theme, on the page as on the site
INK_SOFT   = (241, 244, 248)   # --panel-2: the cool near-neutral grey for recessed surfaces
BORDER     = (208, 215, 225)   # --border
INK_TEXT   = (27, 36, 48)      # --text: primary ink for headlines
MUTED      = (67, 77, 85)      # --muted
TINT       = (122, 68, 24)     # --tint: the brand brown
BRASS      = (227, 165, 86)    # --sand-vivid: the brand amber accent

def font(p, s): return ImageFont.truetype(p, s)

def ls_text(dr, x, y, s, f, fill, track=0, anchor="lt"):
    ws = [dr.textlength(c, font=f) for c in s]
    total = sum(ws) + track * (len(s) - 1)
    asc, _ = f.getmetrics()
    if anchor[0] == "c": x -= total / 2
    elif anchor[0] == "r": x -= total
    if anchor[1] == "m": y -= asc / 2
    elif anchor[1] == "b": y -= asc
    cur = x
    for c, w in zip(s, ws):
        dr.text((cur, y), c, font=f, fill=fill)
        cur += w + track
    return total

def ar_text(dr, x, y, s, size, fill, anchor="rt"):
    """Arabic must be drawn as one shaped, right-to-left run."""
    dr.text((x, y), s, font=font(F_AR, size), fill=fill,
            direction="rtl", language="ar", anchor=anchor)

def new_page():
    im = Image.new("RGB", (W, H), INK)
    dr = ImageDraw.Draw(im)
    return im, dr

def anchor_mark(dr, cx, cy, r, color, width=6):
    """The ⚓ drawn as geometry, so it stays crisp at print size."""
    dr.ellipse([cx - r * .26, cy - r, cx + r * .26, cy - r * .48], outline=color, width=width)
    dr.line([cx, cy - r * .48, cx, cy + r * .86], fill=color, width=width)
    dr.line([cx - r * .62, cy - r * .2, cx + r * .62, cy - r * .2], fill=color, width=width)
    dr.arc([cx - r * .86, cy - r * .1, cx + r * .86, cy + r * .95], 20, 160, fill=color, width=width)
    for sx in (-1, 1):
        dr.line([cx + sx * r * .86, cy + r * .42, cx + sx * r * .62, cy + r * .18], fill=color, width=width)
        dr.line([cx + sx * r * .86, cy + r * .42, cx + sx * r * 1.06, cy + r * .2], fill=color, width=width)

pages = []

# ------------------------------------------------------------------ COVER
im, dr = new_page()
for i in range(H):                                   # slow vertical lift
    t = i / H
    c = tuple(int(INK[k] + (INK_SOFT[k] - INK[k]) * (1 - t) ** 2) for k in range(3))
    dr.line([0, i, W, i], fill=c)
anchor_mark(dr, W // 2, 700, 150, BRASS, 7)
# The company is the cover; النوخذة is the system inside, named in the strip below.
ls_text(dr, W // 2, 930, "ALMUHALLAB", font(F_DISP, 168), INK_TEXT, 30, "ct")
ls_text(dr, W // 2, 1130, "CODE", font(F_MED, 132), BRASS, 40, "ct")
dr.line([W // 2 - 430, 1310, W // 2 + 430, 1310], fill=BORDER, width=3)
ls_text(dr, W // 2, 1372, "SOFTWARE  AND  SYSTEMS  —  KUWAIT", font(F_TECH, 54), MUTED, 15, "ct")
ls_text(dr, W // 2, 1520, "WEBSITE SAMPLE", font(F_MED, 62), TINT, 22, "ct")
ls_text(dr, W // 2, 1660, "www.almuhallab-code.com", font(F_MONO, 46), INK_TEXT, 4, "ct")
ls_text(dr, W // 2, 1790, "NOKHATHA  ·  SAFI  ·  XBRL  ·  DELIVERY", font(F_TECH, 38), MUTED, 12, "ct")
dr.line([260, 2270, W - 260, 2270], fill=BORDER, width=2)
ls_text(dr, 260, 2320, "PROGRESSIVE WEB APP — OFFLINE CAPABLE", font(F_MONO, 32), MUTED, 2)
ls_text(dr, W - 260, 2320, "12 SCREENS", font(F_MONO, 32), BRASS, 2, "rt")
pages.append(im)

# ------------------------------------------------------------------ CONTENTS
im, dr = new_page()
ls_text(dr, 260, 240, "CONTENTS", font(F_DISP, 132), INK_TEXT, 22)
dr.line([260, 470, W - 260, 470], fill=BORDER, width=3)
rows = [
    ("01", "Almuhallab Code", "المهلب كود", "The company — services, work, contact"),
    ("02", "Al-Nokhatha — Portal", "النوخذة", "The system inside: hero, units, install"),
    ("03", "Plans", "الاشتراكات", "Free — one plan, every unit open, nothing to upgrade to"),
    ("04", "Registration", "إنشاء حساب", "PBKDF2-hashed credentials, validated"),
    ("05", "Dashboard", "لوحة التحكم", "Account, plan badge, unit access"),
    ("06", "SAFI", "صافي", "Portfolio, market value, profit and loss"),
    ("07", "XBRL", "الميزانية السنوية", "Kuwait annual filing: computed, audited, IFRS-tagged"),
    ("08", "Delivery", "التوصيل", "Orders, couriers, status pipeline"),
    ("09", "Unified Position", "المركز المالي", "One core — portfolio and orders feed the filing"),
    ("10", "Mobile", "الجوال", "Installed app, three screens"),
    ("11", "Specification", "المواصفات", "Stack, security, deployment"),
]
y = 590
fnum, fen, far, fd = font(F_MONO, 46), font(F_MED, 60), font(F_TECH, 52), font(F_TECH, 40)
for n, en, ar, desc in rows:
    ls_text(dr, 262, y, n, fnum, BRASS, 3)
    ls_text(dr, 420, y - 4, en, fen, INK_TEXT, 6)
    ar_text(dr, 1560, y - 6, ar, 58, TINT, "rt")
    ls_text(dr, 1620, y + 8, desc, fd, MUTED, 2)
    dr.line([260, y + 118, W - 260, y + 118], fill=INK_SOFT, width=2)
    y += 176
pages.append(im)

# ------------------------------------------------------------------ PLATES
plates = [
    ("01-company",  "01", "Almuhallab Code", "المهلب كود", "/"),
    ("02-landing",  "02", "النوخذة — Portal", "النوخذة", "/nokhatha"),
    ("03-pricing",  "03", "Plans", "الاشتراكات", "/nokhatha#/pricing"),
    ("04-register", "04", "Registration", "إنشاء حساب", "/nokhatha#/register"),
    ("05-dashboard","05", "Dashboard", "لوحة التحكم", "/nokhatha#/dashboard"),
    ("06-safi",     "06", "SAFI — Portfolio", "صافي", "/nizam#/safi"),
    ("07-xbrl",     "07", "XBRL — Annual Filing", "الميزانية السنوية", "/nizam#/xbrl"),
    ("08-delivery", "08", "Delivery", "التوصيل", "/nizam#/delivery"),
    ("09-position", "09", "Unified Position", "المركز المالي", "/nizam#/position"),
]
fnum_s, fttl, far_s, furl = font(F_MONO, 40), font(F_MED, 64), font(F_TECH, 54), font(F_MONO, 34)

for fn, num, title, ar, url in plates:
    im, dr = new_page()
    ls_text(dr, 250, 150, num, fnum_s, BRASS, 3)
    ls_text(dr, 360, 138, title, fttl, INK_TEXT, 5)
    ar_text(dr, W - 250, 138, ar, 62, TINT, "rt")
    dr.line([250, 268, W - 250, 268], fill=BORDER, width=3)

    shot = Image.open(SH / f"{fn}.png").convert("RGB")
    box_w, box_h = W - 500, H - 268 - 250      # frame the screenshot inside the margins
    sc = min(box_w / shot.width, box_h / shot.height)
    nw, nh = int(shot.width * sc), int(shot.height * sc)
    shot = shot.resize((nw, nh), Image.LANCZOS)
    px, py = (W - nw) // 2, 268 + (box_h - nh) // 2 + 10
    dr.rectangle([px - 3, py - 3, px + nw + 2, py + nh + 2], outline=BORDER, width=3)
    im.paste(shot, (px, py))

    dr.line([250, H - 168, W - 250, H - 168], fill=BORDER, width=2)
    ls_text(dr, 250, H - 132, url, furl, MUTED, 2)
    ls_text(dr, W - 250, H - 132, "NOKHATHA — ALMUHALLAB", font(F_MONO, 30), MUTED, 3, "rt")
    pages.append(im)

# ------------------------------------------------------------------ MOBILE
im, dr = new_page()
ls_text(dr, 250, 150, "09", fnum_s, BRASS, 3)
ls_text(dr, 360, 138, "Installed on device", fttl, INK_TEXT, 5)
ar_text(dr, W - 250, 138, "الجوال", 62, TINT, "rt")
dr.line([250, 268, W - 250, 268], fill=BORDER, width=3)

mobiles = [("10-m-company", "المهلب كود"), ("11-m-safi", "صافي"), ("12-m-position", "المركز المالي")]
avail_h = H - 268 - 300
fcap = font(F_TECH, 46)
for i, (fn, cap) in enumerate(mobiles):
    shot = Image.open(SH / f"{fn}.png").convert("RGB")
    sc = (avail_h - 120) / shot.height
    nw, nh = int(shot.width * sc), int(shot.height * sc)
    shot = shot.resize((nw, nh), Image.LANCZOS)
    cx = W // 2 + (i - 1) * (nw + 190)
    px, py = cx - nw // 2, 268 + 70
    dr.rounded_rectangle([px - 14, py - 14, px + nw + 13, py + nh + 13],
                         radius=44, outline=BORDER, width=5)
    im.paste(shot, (px, py))
    ar_text(dr, cx, py + nh + 56, cap, 52, TINT, "mt")
dr.line([250, H - 168, W - 250, H - 168], fill=BORDER, width=2)
ls_text(dr, 250, H - 132, "402 × 874 — ADD TO HOME SCREEN", furl, MUTED, 2)
ls_text(dr, W - 250, H - 132, "NOKHATHA — ALMUHALLAB", font(F_MONO, 30), MUTED, 3, "rt")
pages.append(im)

# ------------------------------------------------------------------ SPEC
im, dr = new_page()
ls_text(dr, 250, 150, "10", fnum_s, BRASS, 3)
ls_text(dr, 360, 138, "Specification", fttl, INK_TEXT, 5)
ar_text(dr, W - 250, 138, "المواصفات", 62, TINT, "rt")
dr.line([250, 268, W - 250, 268], fill=BORDER, width=3)

cols = [
    ("PLATFORM", [
        "HTML5 · CSS · vanilla JavaScript",
        "No framework, no build step",
        "Progressive Web App — installable",
        "Service worker precaches every page",
        "Full offline operation",
        "Arabic-first, RTL throughout",
        "Responsive — phone to desktop",
    ]),
    ("SECURITY", [
        "PBKDF2-SHA256, 310,000 iterations",
        "16-byte random per-user salt",
        "Constant-time hash comparison",
        "Login throttling — 5 tries, 5 min lock",
        "Sessions expire after 24 hours",
        "CSP: default-src 'none'",
        "All rendered output HTML-escaped",
        "CSV formula-injection neutralised",
        "Editor preview fully sandboxed",
    ]),
    ("DEPLOYMENT", [
        "Static hosting — any provider",
        "Apache/LiteSpeed .htaccess included",
        "Forced HTTPS + HSTS",
        "Apex redirected to www",
        "GitHub Pages workflow included",
        "Currency: Kuwaiti Dinar, 3 decimals",
        "",
        "Pending: shared database,",
        "payment gateway, live market data",
    ]),
]
fh, fb = font(F_MED, 50), font(F_TECH, 42)
for i, (head, items) in enumerate(cols):
    x = 300 + i * 1030
    ls_text(dr, x, 420, head, fh, BRASS, 10)
    dr.line([x, 510, x + 880, 510], fill=BORDER, width=2)
    yy = 580
    for it in items:
        if it:
            dr.ellipse([x + 2, yy + 20, x + 12, yy + 30], fill=TINT)
            ls_text(dr, x + 38, yy, it, fb, INK_TEXT if i != 2 or yy < 1300 else MUTED, 1)
        yy += 86

anchor_mark(dr, W // 2, 1900, 96, BRASS, 5)
ar_text(dr, W // 2, 2060, "النوخذة", 64, INK_TEXT, "mt")
ls_text(dr, W // 2, 2170, "ONE CAPTAIN — EVERY SERVICE — ONE SYSTEM",
        font(F_TECH, 38), MUTED, 12, "ct")

dr.line([250, H - 168, W - 250, H - 168], fill=BORDER, width=2)
ls_text(dr, 250, H - 132, "www.almuhallab-code.com", furl, TINT, 2)
ls_text(dr, W - 250, H - 132, "MADE IN KUWAIT", font(F_MONO, 30), MUTED, 3, "rt")
pages.append(im)

# ------------------------------------------------------------------ SAVE
out = OUT / "almuhallab-website-sample.pdf"
pages[0].save(out, "PDF", resolution=300.0, save_all=True, append_images=pages[1:])
print(f"{len(pages)} pages -> {out}  ({out.stat().st_size/1e6:.1f} MB)")
for i, p in enumerate(pages):
    p.resize((p.width // 5, p.height // 5), Image.LANCZOS).save(PV / f"pv-{i:02d}.png")
