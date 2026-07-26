"""
Compose the captured pages into a presentable A4-landscape PDF sample.
Cover + contents + one plate per page + mobile trio + a closing spec sheet.
"""
import math, pathlib
from PIL import Image, ImageDraw, ImageFont

W, H = 3508, 2480                      # A4 landscape @ 300dpi
D = pathlib.Path("/home/user/wain/design")
SH = D / "shots"

FONTS = "/root/.claude/skills/canvas-design/canvas-fonts/"
F_DISP = FONTS + "Italiana-Regular.ttf"
F_TECH = FONTS + "Jura-Light.ttf"
F_MED  = FONTS + "Jura-Medium.ttf"
F_MONO = FONTS + "GeistMono-Regular.ttf"
F_AR   = "/home/user/wain/design/fonts/plex-arabic-600.ttf"   # IBM Plex Sans Arabic, bundled

INK        = (11, 18, 32)
INK_SOFT   = (17, 26, 43)
BORDER     = (34, 48, 73)
BONE       = (216, 205, 184)
MUTED      = (138, 160, 189)
TEAL       = (77, 179, 168)
BRASS      = (227, 165, 86)

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
f_word = font(F_DISP, 236)
cap_h = f_word.getbbox("N")[3] - f_word.getbbox("N")[1]
f_one = font(F_MED, 190)
one_h = f_one.getbbox("1")[3] - f_one.getbbox("1")[1]
f_one = font(F_MED, int(190 * cap_h / one_h))
w_word = sum(dr.textlength(c, font=f_word) for c in "NOKHA") + 44 * 4
w_one = dr.textlength("1", font=f_one)
gap = 46
x0 = W // 2 - (w_word + gap + w_one) / 2
ls_text(dr, x0, 980, "NOKHA", f_word, BONE, 44)
dr.text((x0 + w_word + gap, 980 + (f_word.getbbox("N")[1] - f_one.getbbox("1")[1])),
        "1", font=f_one, fill=BRASS)
dr.line([W // 2 - 430, 1310, W // 2 + 430, 1310], fill=BORDER, width=3)
ls_text(dr, W // 2, 1372, "ALMUHALLAB  UNIFIED  SERVICES", font(F_TECH, 54), MUTED, 15, "ct")
ls_text(dr, W // 2, 1520, "WEBSITE SAMPLE", font(F_MED, 62), TEAL, 22, "ct")
ls_text(dr, W // 2, 1660, "www.almuhallab-code.com", font(F_MONO, 46), BONE, 4, "ct")
ls_text(dr, W // 2, 1790, "SAFI  ·  XBRL  ·  DELIVERY  ·  CODE", font(F_TECH, 40), MUTED, 14, "ct")
dr.line([260, 2270, W - 260, 2270], fill=BORDER, width=2)
ls_text(dr, 260, 2320, "PROGRESSIVE WEB APP — OFFLINE CAPABLE", font(F_MONO, 32), MUTED, 2)
ls_text(dr, W - 260, 2320, "11 SCREENS", font(F_MONO, 32), BRASS, 2, "rt")
pages.append(im)

# ------------------------------------------------------------------ CONTENTS
im, dr = new_page()
ls_text(dr, 260, 240, "CONTENTS", font(F_DISP, 132), BONE, 22)
dr.line([260, 470, W - 260, 470], fill=BORDER, width=3)
rows = [
    ("01", "Landing", "الرئيسية", "Hero, service fleet, install prompt"),
    ("02", "Plans", "الاشتراكات", "Three tiers — pricing deferred, all units open"),
    ("03", "Registration", "إنشاء حساب", "PBKDF2-hashed credentials, validated"),
    ("04", "Dashboard", "لوحة التحكم", "Account, plan badge, unit access"),
    ("05", "SAFI", "صافي", "Portfolio, market value, profit and loss"),
    ("06", "XBRL", "التقارير المالية", "Statements, balance check, IFRS instance"),
    ("07", "Delivery", "التوصيل", "Orders, couriers, status pipeline"),
    ("08", "Code Editor", "المحرر", "Sandboxed live preview"),
    ("09", "Mobile", "الجوال", "Installed app, three screens"),
    ("10", "Specification", "المواصفات", "Stack, security, deployment"),
]
y = 590
fnum, fen, far, fd = font(F_MONO, 46), font(F_MED, 60), font(F_TECH, 52), font(F_TECH, 40)
for n, en, ar, desc in rows:
    ls_text(dr, 262, y, n, fnum, BRASS, 3)
    ls_text(dr, 420, y - 4, en, fen, BONE, 6)
    ar_text(dr, 1560, y - 6, ar, 58, TEAL, "rt")
    ls_text(dr, 1620, y + 8, desc, fd, MUTED, 2)
    dr.line([260, y + 118, W - 260, y + 118], fill=(26, 38, 58), width=2)
    y += 176
pages.append(im)

# ------------------------------------------------------------------ PLATES
plates = [
    ("01-landing",  "01", "Landing", "الرئيسية", "index.html"),
    ("02-pricing",  "02", "Plans", "الاشتراكات", "index.html#/pricing"),
    ("03-register", "03", "Registration", "إنشاء حساب", "index.html#/register"),
    ("04-dashboard","04", "Dashboard", "لوحة التحكم", "index.html#/dashboard"),
    ("05-safi",     "05", "SAFI — Portfolio", "صافي", "safi.html"),
    ("06-xbrl",     "06", "XBRL — Reporting", "التقارير المالية", "xbrl.html"),
    ("07-delivery", "07", "Delivery", "التوصيل", "delivery.html"),
    ("08-editor",   "08", "Code Editor", "المحرر", "editor.html"),
]
fnum_s, fttl, far_s, furl = font(F_MONO, 40), font(F_MED, 64), font(F_TECH, 54), font(F_MONO, 34)

for fn, num, title, ar, url in plates:
    im, dr = new_page()
    ls_text(dr, 250, 150, num, fnum_s, BRASS, 3)
    ls_text(dr, 360, 138, title, fttl, BONE, 5)
    ar_text(dr, W - 250, 138, ar, 62, TEAL, "rt")
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
    ls_text(dr, W - 250, H - 132, "NOKHA1 — ALMUHALLAB", font(F_MONO, 30), MUTED, 3, "rt")
    pages.append(im)

# ------------------------------------------------------------------ MOBILE
im, dr = new_page()
ls_text(dr, 250, 150, "09", fnum_s, BRASS, 3)
ls_text(dr, 360, 138, "Installed on device", fttl, BONE, 5)
ar_text(dr, W - 250, 138, "الجوال", 62, TEAL, "rt")
dr.line([250, 268, W - 250, 268], fill=BORDER, width=3)

mobiles = [("09-m-landing", "الرئيسية"), ("10-m-safi", "صافي"), ("11-m-delivery", "التوصيل")]
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
    ar_text(dr, cx, py + nh + 56, cap, 52, TEAL, "mt")
dr.line([250, H - 168, W - 250, H - 168], fill=BORDER, width=2)
ls_text(dr, 250, H - 132, "402 × 874 — ADD TO HOME SCREEN", furl, MUTED, 2)
ls_text(dr, W - 250, H - 132, "NOKHA1 — ALMUHALLAB", font(F_MONO, 30), MUTED, 3, "rt")
pages.append(im)

# ------------------------------------------------------------------ SPEC
im, dr = new_page()
ls_text(dr, 250, 150, "10", fnum_s, BRASS, 3)
ls_text(dr, 360, 138, "Specification", fttl, BONE, 5)
ar_text(dr, W - 250, 138, "المواصفات", 62, TEAL, "rt")
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
            dr.ellipse([x + 2, yy + 20, x + 12, yy + 30], fill=TEAL)
            ls_text(dr, x + 38, yy, it, fb, BONE if i != 2 or yy < 1300 else MUTED, 1)
        yy += 86

anchor_mark(dr, W // 2, 1900, 96, BRASS, 5)
ar_text(dr, W // 2, 2060, "النوخذة", 64, BONE, "mt")
ls_text(dr, W // 2, 2170, "ONE CAPTAIN — EVERY SERVICE — ONE SYSTEM",
        font(F_TECH, 38), MUTED, 12, "ct")

dr.line([250, H - 168, W - 250, H - 168], fill=BORDER, width=2)
ls_text(dr, 250, H - 132, "www.almuhallab-code.com", furl, TEAL, 2)
ls_text(dr, W - 250, H - 132, "MADE IN KUWAIT", font(F_MONO, 30), MUTED, 3, "rt")
pages.append(im)

# ------------------------------------------------------------------ SAVE
out = D / "nokha1-website-sample.pdf"
pages[0].save(out, "PDF", resolution=300.0, save_all=True, append_images=pages[1:])
print(f"{len(pages)} pages -> {out}  ({out.stat().st_size/1e6:.1f} MB)")
for i, p in enumerate(pages):
    p.resize((p.width // 5, p.height // 5), Image.LANCZOS).save(D / f"pv-{i:02d}.png")
