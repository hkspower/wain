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

## Rendering

```
node press/social/render.mjs
```

Chromium, the same renderer `press/logo` uses, and for the same reason:
it is the only one here that shapes Arabic correctly. PIL would set
ليالي شارع الخليج as disconnected letterforms.

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
