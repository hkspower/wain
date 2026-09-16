# Social

Plates for the feeds, drawn in the game's own design language rather than
a look invented for marketing: the night palette straight out of
`src/app/globals.css`, the three faces the site loads through `next/font`
(Barlow Condensed, Plus Jakarta Sans, IBM Plex Sans Arabic), and the
HUD's own vocabulary — the district chip, the speed cluster, the drift
readout with the pipe bar it really draws, the duel bars. Everything on
the canvas is something a player sees while driving.

| File | Size | Use |
| --- | --- | --- |
| `instagram-story.png` | 1080×1920 | Instagram / Facebook / WhatsApp story, TikTok |
| `post-square-*.png` | 1080×1080 | Square feed post |
| `post-portrait-*.png` | 1080×1350 | Feed post, 4:5 — and the four swipe as one carousel |
| `post-wide-*.png` | 1080×566 | 1.91:1. Renders smallest in feed and is cropped hardest on the profile grid; its real use is a link or ad preview |
| `story-*.png` | 1080×1920 | Story / Reel, TikTok, WhatsApp |

The `*` is one of four designs cut out of the manga brochure —
`cover`, `road`, `machines`, `stops`.

## The manga set

Sixteen plates, four designs across four sizes, written by

```
node press/social/build-plates.mjs
```

They are generated rather than kept as sixteen hand-written files
because they are one design system seen four ways: the ink weight, the
screentone pitch and the safe area are decided once, and a correction
lands on the whole set. Edit `build-plates.mjs`, not the plates.

They are **not** crops of the print brochure. An A4 page is 1:1.414 and
no Instagram size is, so a crop would cut the composition — and the type
would come out unreadable: 16px body on a 794px page is 22px at 1080, in
a feed, on a phone. Each plate is laid out at its own pixel size.

Two things in them exist because Instagram recompresses an upload: the
ink is **heavier** than print (a 4px border at 794 is a hairline at 1080
and the first thing a JPEG pass eats), and the screentone is **coarser**
(dots under ~3px moiré into mush).

`img/` holds the panels, inked from `press/shots/*.png` at their native
1600px — the crop keeps 70% of the width, so a panel is ~1120px and a
full-width 1080 panel is never upscaled. That is also the ceiling: about
4% headroom, so no panel gets a pan-and-zoom crop, and a full-bleed
1080×1920 vertical panel is impossible from a 16:9 still — which is why
the stories stack two horizontal bands instead.

## Rendering

```
node press/social/render.mjs
```

Chromium, the same renderer `press/logo` uses, and for the same reason:
it is the only one here that shapes Arabic correctly. PIL would set
متسابق الليل as disconnected letterforms.

The webfonts come over the network, so the renderer waits on
`document.fonts.ready` before the shot. A plate captured early is set in
a fallback face, and the Arabic is the half that shows it.

## Safe areas

Instagram covers roughly the top 250 px with the profile row and the
bottom 250 px with the reply bar. The image bleeds through both; nothing
that has to be read does. If you move type, keep it inside y 250–1650.

## The hero crop

`hero.png` is a crop of `press/shots/drift.png` taken clear of the HUD in
every corner — the area badge, the speedo, the minimap and the control
legend all sit outside it:

```
python3 -c "
from PIL import Image
im = Image.open('press/shots/drift.png').convert('RGB')
im.crop((330, 150, 1390, 800)).resize((1080, 662), Image.LANCZOS).save('press/social/hero.png')
"
```

Re-run it after `npm run shots` if the drift plate is regenerated.

## Copy

No URL is claimed anywhere, because the project does not have one yet —
the call to action is "link in bio", which is what an Instagram account
would actually carry. Put a domain in only when there is one to put in.

Arabic follows the same rules the game's own strings do
(`npm run check:arabic`): base letters, no tatweel, and يلا rather than
يالله for *yalla*.
