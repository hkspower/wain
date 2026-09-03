# Real photographs

`npm run photos` builds them · `npm run audit:photos` checks them (it is in `npm run scan`)

Every picture on the site is drawn. `PlaceArt` gives the famous places a
hand-made scene, `CategoryArt` gives everything else its category's, and that
was a deliberate choice: it costs nothing, it never shows the wrong building,
and it looks like one site rather than a scrape.

It is also, for someone deciding whether to drive across town, less information
than a photograph. So the hero now has three layers and degrades downwards:

```
photograph  →  the place's own drawing  →  the category's drawing
```

A place with no photograph looks finished, not broken. That is why the manifest
can be empty — and it is empty. See **Where photographs come from** below.

## Adding one

1. Put the original in `photos-src/<slug>.<ext>` — full resolution, as it came
   from the photographer or the library. `photos-src/` is not committed.
2. Add an entry to `PHOTOS` in `src/lib/photos.ts`: credit, licence, source,
   Arabic alt text, and `creditOnPage` when the licence requires the credit to
   be visible.
3. `npm run photos`
4. `npm run audit:photos`

The web-sized output in `public/photos/` **is** committed, so a clone builds the
real site without needing the originals.

## What the pipeline does, and why

| step | reason |
| --- | --- |
| cover-crop to 3:2 | The hero is a fixed shape. Letterboxing shows bars; stretching shows a lie. Cover keeps the geometry true. |
| resize to 1200×800 | Two-times density on a phone, one-times on the widest desktop column the layout allows. |
| strip metadata | A photograph carries the camera, often the lens, and sometimes the GPS coordinates of the person who took it. None of that is ours to publish. |
| walk the quality down | From 82 until the file is inside 160KB, rather than one flat number — which gives a 60KB sky and a 400KB market stall. |
| refuse, don't ship | A picture that cannot be made to fit at a quality worth looking at is an error, not a warning. |

160KB is roughly what the whole of the shared JavaScript costs after the split.
A photograph is not allowed to cost more than the app.

### The bug the first run found

The pipeline was written, run once against a 6000×4000 original, and wrote
**200KB against a 160KB budget while printing a tick**. `sharp(buf).toFile()`
decodes the JPEG that was just measured and re-encodes it at sharp's default
quality — so the budget was checked against one file and a different, larger one
reached the disk. Everything the script checked was true of a buffer that never
got written. It writes the measured buffer now.

## What may go in the manifest

**A picture of the place it names, and nothing else.**

Adobe Stock's reachable collection, searched while this was written, holds
perhaps six genuinely Kuwaiti photographs — and several hundred «Arab market»,
«grand mosque» and «old town» shots taken in Nizwa, Dubai, Marrakesh and
Istanbul. Putting one of those on سوق المباركية would be indistinguishable from
doing the job, and it would be a lie told to somebody about to drive there.

A drawing never claims to be a specific building. A photograph always does.

The same rule rules out a generated image of a real landmark: there is no such
thing as an AI photograph of أبراج الكويت, only a picture of something that
looks like it.

## Where photographs come from

Nowhere reachable, yet. Every route was tried:

| source | result |
| --- | --- |
| Wikimedia Commons, Unsplash, Flickr | `403` at CONNECT — the network policy denies every host outside the package registries |
| Adobe Stock | Real Kuwaiti photographs exist and the licensed download host **is** reachable, but the account has no Stock plan: `"Your download couldn't be completed"` |
| Adobe Lightroom / Creative Cloud | No photograph of a Kuwaiti place. One Firefly generation, which is not a photograph |
| Dropbox | Only this site's own generated OG cards, copied there with the 1.1 release |

What Stock does have, by title, if a plan is ever added — none of these were
licensed, so none has been seen, only read:

| asset | claims to show | place it would serve |
| --- | --- | --- |
| 236264025 | Kuwait Towers at night | `kuwait-towers` |
| 148854060 | Kuwait Towers from a beach | `kuwait-towers` |
| 148852369 | The Grand Mosque of Kuwait | `grand-mosque` |
| 242691058 | Kuwait City skyline at Al Shaheed Park | `al-shaheed-park` |
| 243311991 | Skyline of Salmiya | Salmiya's places |
| 514653680 | Kuwait City skyline, panoramic | the city's places |

Six titles, covering perhaps five of forty-four places. Every one of them would
need to be looked at before it went in, because a contributor's caption is a
claim and not a check.

## The simplest route

Photographs taken in Kuwait, by someone who was there. Drop them in
`photos-src/<slug>.jpg`, name the photographer in the manifest, and run the two
commands above. That needs no licence negotiation and no network policy, and the
picture is certainly of the place it says.
