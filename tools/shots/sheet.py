#!/usr/bin/env python3
"""Lay the reference stills out on one sheet.

    npm run shots && python3 tools/shots/sheet.py

Eight frames at a glance is how you actually notice that one of them is
wrong — noon read as dusk for weeks and nobody caught it until the whole
day sat side by side on a single page.
"""
from PIL import Image, ImageDraw, ImageFont
import os

F = "/root/.claude/skills/synced/canvas-design/canvas-fonts"
SHOTS = ["menu", "night", "dawn", "noon", "dusk", "coast", "city", "drift"]
CAPS = {
    "menu": "MAIN MENU · your car on the turntable",
    "night": "NIGHT 22:30 · the shipped look",
    "dawn": "DAWN 05:36 · lamps still lit",
    "noon": "NOON 12:30 · towers black at midday",
    "dusk": "DUSK 18:12 · the key light low and warm",
    "coast": "COAST · the seaward leg",
    "city": "CITY · towers behind the road",
    "drift": "DRIFT · full lock",
}
# Anything still known to be wrong is called out in amber rather than
# quietly presented as finished work.
FLAGGED = {"noon"}

imgs = [(s, Image.open(f"press/shots/{s}.png").convert("RGB"))
        for s in SHOTS if os.path.exists(f"press/shots/{s}.png")]
if not imgs:
    raise SystemExit("no stills — run npm run shots first")

COLS, PAD, LABEL, MARGIN, HEAD, TW = 2, 26, 34, 44, 118, 900
th = round(TW * imgs[0][1].height / imgs[0][1].width)
rows = (len(imgs) + COLS - 1) // COLS
W = MARGIN * 2 + COLS * TW + (COLS - 1) * PAD
H = HEAD + MARGIN + rows * (th + LABEL) + (rows - 1) * PAD + MARGIN

sheet = Image.new("RGB", (W, H), (5, 7, 14))
d = ImageDraw.Draw(sheet)
title = ImageFont.truetype(f"{F}/BigShoulders-Bold.ttf", 62)
mono = ImageFont.truetype(f"{F}/GeistMono-Regular.ttf", 21)
small = ImageFont.truetype(f"{F}/GeistMono-Regular.ttf", 17)

d.text((MARGIN, 34), "GULF ROAD NIGHTS", font=title, fill=(232, 236, 244))
d.text((MARGIN + 560, 58), "REFERENCE STILLS · npm run shots", font=small, fill=(120, 132, 152))
d.line([(MARGIN, HEAD - 14), (W - MARGIN, HEAD - 14)], fill=(40, 48, 64), width=1)

for i, (name, im) in enumerate(imgs):
    r, c = divmod(i, COLS)
    x = MARGIN + c * (TW + PAD)
    y = HEAD + MARGIN // 2 + r * (th + LABEL + PAD)
    sheet.paste(im.resize((TW, th), Image.LANCZOS), (x, y))
    d.rectangle([x, y, x + TW - 1, y + th - 1], outline=(46, 54, 72), width=1)
    d.text((x, y + th + 9), CAPS.get(name, name.upper()), font=mono,
           fill=(255, 176, 60) if name in FLAGGED else (176, 186, 204))

out = "press/shots/contact-sheet.png"
sheet.save(out, "PNG", optimize=True, compress_level=9)
print(f"{out}  {sheet.size[0]}x{sheet.size[1]}  {os.path.getsize(out)/1048576:.1f} MB")
