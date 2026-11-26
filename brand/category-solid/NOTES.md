# Category pictures on one solid background: WORK IN PROGRESS, paused 2026-11-26

Nothing here is shipped and nothing here is finished. `process.py` is a working draft.

## What the owner asked for

- 2026-11-25: "use white background catories image" (answered "Tile background white": a white card behind each
  category photo, with the title and text in dark ink). What was built then (commit `ef31d92a`, CATEGORY WHITE
  FRAME 1125 in `sporta-web/public/sporta-shadows.css`, not deployed) is only a white frame around the dark photos;
  the text stayed white on the photo.
- 2026-11-26: "make catories images without ridues" -> "Remove the background glow / colour cast" -> "make one
  solid backgound without effecte" -> "design full new set".

Read together: the pictures should stand on ONE flat colour with no glow, gradient, vignette or shadow, and that
colour is WHITE (the owner's own word the day before), on a white tile with the text in dark ink.

## Where the work stands

- Generator: the ElevenLabs image tool has no credits (quota refused, nothing charged). The Figma generator works
  (`generate_image`, model gpt-image-2.5-flare). `www.figma.com` is not reachable from the sandbox, so a picture
  is fetched with `get_screenshot` (`enableBase64Response: true`, `maxDimension: 1280`), which saves the PNG in
  the session's tool-results folder.
- Figma file "Sporta category pictures - solid set", key `pWQvwEfVZjMsypfboDS0lJ`:
  - BLACK backdrop (a spare, complete): men `1:2`, women `2:2`, accessories `3:2`, outlet `4:2`.
  - WHITE backdrop (the direction): men `5:2`, women `5:3` are generated. Accessories and outlet are NOT generated
    yet (the call was interrupted). Their prompts: every item orange or dark charcoal, no white item (a white
    bottle or sock disappears on white); the outlet tag on a black string.
- `process.py` (draft): cleans a master to an exact flat colour, cuts out single things (flat-lay items by
  connected parts, outlet stacks along their dark seams) and composes every file the LIVE tiles request:
  `art-men`, `art-women`, `art-accessories-v2`, `art-outlet`, each with an `-rtl` twin, desktop 1216 x 706 and
  mobile 900 x 570, `.jpg` and `.webp`. It is written for the BLACK backdrop (rgb 17,17,19) and has to be turned
  to white: the "subject" test (dark or saturated pixels, light neutral greys are shadows), and the output colour.

## What is still to do for the white set

1. Generate accessories and outlet on white; fetch the four white masters into this folder as `<name>-src.png`.
2. Turn `process.py` to white and run it into `sporta-web/public/cats/`.
3. CSS (add-on files): tile text in ink (#171a1e) instead of white (a rule heavier than MONO-1112 rule 2 in
   `sporta-ui-colours.css`), the scrim in white instead of rgba(17,17,19) (`sporta-cat-tiles.css`, `[sog-5]` and
   `[sog-5b]` in `sporta-shadows.css`), no orange backlight (`.tile-acc::before, .tile-outlet::before`), every tile's
   picture anchored to the END side from 768px (TILES-1111 `[tiles-2]` covers only men and women), and the 12px
   inset of CATEGORY WHITE FRAME 1125 dropped (white on white).
4. Measured placement rules (tile text positions at 320-1920px, both languages) are in the header of `process.py`:
   people run the full height at the END edge; objects stand in the upper END part on a desktop tile and in the
   top END corner on a phone tile.
5. Proof suite, the existing `scripts/cat-tiles-crop-test.mjs` constants, and the repo storefront's
   `src/components/CategoryTile.jsx`.
6. Going live: `/cats/` on the VPS is the media mount `/docker/sporta/private/media/cats`; `vps-deploy.mjs` never
   writes it. The pictures need their own one-shot install job (owner's yes, backup first), right after the CSS.

`sporta-web/public/cats/` currently holds the desaturated versions of the old pictures (commit `534671a4`), not
deployed. The live site still serves the original orange-glow pictures.
