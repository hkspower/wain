# Photoreal category banners — generation kit

Claude's sandbox has no image-generation model and no route to stock-photo
sites, so the photoreal banners the shop wants cannot be produced *from* the
repo. But everything needed to produce them exists in the owner's n8n account
(app.n8n.cloud): an **OpenAI API credential** (image generation) and the
**Hostinger FTP credential**. This kit contains the two pieces that make it a
five-minute job:

1. `n8n-banner-workflow.js` — a validated n8n Workflow-SDK script that
   generates all four banners with gpt-image-1 and uploads them straight to
   `public_html/cats/desktop/` and `public_html/cats/mobile/` over FTP. Import
   it in n8n ("Create workflow → with
   code"), or ask Claude in an *interactive* session to install it via the n8n
   MCP (this repo's non-interactive sessions cannot approve n8n write calls).
2. The four prompts below — also usable directly in ChatGPT (DALL-E /
   gpt-image), Midjourney, or any generator, if that is easier than n8n.

## Output contract (what the site expects)

- Filenames, exactly, all lowercase: `men.jpg`, `women.jpg`,
  `accessories.jpg`, `outlet.jpg` → upload into **both**
  `public_html/cats/desktop/` and `public_html/cats/mobile/`.
- Two folders because the tile chooses by viewport, not by pixel ratio, so a
  phone can never be handed the desktop file. Ideal widths: ~1216 px for
  `desktop/`, ~900 px for `mobile/`. The same file in both works; it just costs
  a phone more than it needs.
- The tiles probe those paths at runtime: the moment a file exists, it
  replaces the built-in artwork. Delete the file to fall back. No rebuild.
- Landscape. gpt-image-1's largest landscape is **1536×1024** — the requested
  2000×1200 is not a native size for any current model, and it does not
  matter: the tile crops with `object-cover`, so any large landscape works.
- JPEG, ideally ≤300 kB each (the n8n workflow re-encodes automatically).
- Subject centred-to-right, **left third kept clean and dark** — the tile
  lays the category title over the left side (and mirrors its scrim for
  Arabic). No text, no logos, no watermarks in the image.

## The four prompts

Shared style block (append to each): *Premium commercial sportswear
photography, in the style of a Nike or Gymshark category banner. Photorealistic,
razor sharp, natural skin tones, professional colour grading. Dark charcoal
studio environment with dramatic cinematic rim lighting in burnt orange
(#FF6A00) and deep shadows. High contrast, minimal background, generous dark
negative space on the LEFT third of the frame for a headline. Subject occupies
the right two-thirds. Landscape 3:2. No text, no logos, no watermarks.*

**men.jpg** — An athletic Middle Eastern male model with a muscular build,
mid-workout in a modern dark gym, gripping a barbell for a deadlift, chalk
dust in the air catching the orange rim light. Wearing premium unbranded
black training tee and shorts. Confident, focused expression.

**women.jpg** — An athletic female model in premium matte-black high-waist
leggings and fitted training top, holding a strong low lunge with dumbbells,
in a dark modern studio. Elegant, powerful, poised. Orange rim light tracing
her silhouette, soft key light on the face.

**accessories.jpg** — A luxury still-life composition on dark slate: a black
gym duffel bag standing as the hero, surrounded by a matte black insulated
bottle, a protein shaker, lifting straps, a folded charcoal towel, a black
baseball cap, resistance bands (one in burnt orange as the single colour
accent), and a sports watch. Dramatic side lighting, long soft shadows.

**outlet.jpg** — A premium dark retail interior: industrial shelving and
racks stocked with folded sportswear, shoeboxes and trainers, lit by warm
orange accent strips along the shelf edges. Depth of field falling away into
the store. Luxury outlet mood — clean, modern, not cluttered.

## After uploading

The live site must be running a build that includes the runtime photo probe
(commit "Photo-backed category tiles" or later). If the live site predates
it, publish first: `cd sporta-web && npm run publish`.

Then hard-refresh https://www.sporta.com.kw — the four tiles switch to the
photos. If any generation is not good enough, delete that file in hPanel and
the designed artwork returns instantly.
