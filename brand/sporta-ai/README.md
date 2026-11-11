# Sporta AI icon (سبورتا AI) — new mark

Status: **designed, not applied.** Nothing in `sporta-web/` or on the live site was changed.
Masters live here, never in `sporta-web/public/` (anything there ships).

Revision 2. The first version (concept C below) was a stopwatch with a four-point spark in the dial. An
independent review found the spark was the generic "AI sparkle" (close to the glyph other assistants use),
carried the whole meaning at 20 to 32 px with the stopwatch reduced to a frame, and had no link to the Sporta S
swoosh. It sat 1.25 units high in its box, and its four sharp tips thinned to grey slivers at 16 px. This version replaces the spark with the brand's own
swoosh and fixes the box and the rim; `concept-c.svg` stays only as the record of the rejected idea.

## The mark

A stopwatch whose dial carries the **Sporta S swoosh** (the tapered, slanted S of the logo, drawn with pointed
terminals, thickest in its two bowls): **sport (the stopwatch, pace) + Sporta (the S that no other assistant has)**.
It is built from the logo's own gesture, so it is the shop's mark rather than a sparkle, a robot or a brain, and
nothing in it can be mistaken for another assistant's glyph.

| File | Use |
|---|---|
| `sporta-ai-icon.svg` | master, full colour for light surfaces: dial #E0561C, swoosh #171A1E |
| `sporta-ai-icon-on-dark.svg` | full colour for charcoal surfaces (the launcher, the panel header, the header bar): dial #FF7B17, swoosh #171A1E |
| `sporta-ai-icon-mono.svg` | one colour, `fill="currentColor"`, one path, the swoosh is a real cut-out (nonzero winding, the swoosh wound the other way to the dial), so it works on any ground, including orange and beige: set `color: #171A1E` |
| `concept-d.svg` | the chosen concept (byte-identical to the master) |
| `concept-a.svg`, `concept-b.svg`, `concept-c.svg` | the rejected concepts, kept for the record |
| `preview.png` | every treatment from 16 to 96 px, rendered from these exact files (see Reviewing) |

All files: viewBox 0 0 48 48, no text, no external references, no filters, no strokes (everything is filled
paths, so there is nothing to scale wrongly). Geometry, fixed and asserted by `npm run test:ai-icon`:

- Dial: circle r 18 centred (24, 27). Crown on top, stem, and a **side pusher at one o'clock**. The pusher is what
  makes it a stopwatch: a round body with a neck and an S inside reads as a money bag without it.
- **The ink is centred in the box on both axes** (x 6 to 42.0, y 3 to 45, centre 24, 24): in a 20 px launcher or a 28 px
  panel header it sits on the text's centre line. The dial is a little below the box centre by design, the crown
  balances it.
- **The swoosh never comes closer than 4.4 units to the rim** (1.5 px at 16 px), measured over its whole outline,
  so the orange ring is solid on every ground. Thickest stroke is 5.5 units (1.8 px at 16 px); the swoosh covers 22% of the dial.
- The swoosh is not mirror-symmetric (the logo S is not either, and the logo is never mirrored). Do not flip the
  icon in RTL.
- No `<title>`: the accessible name is the host's job; the launcher already has `aria-label` (`t.assistant.open`)
  and the icon sits in an `alt=""` image today.

## Concepts and the choice

- **A, S in a speech bubble.** The brand S as a cut-out in a rounded bubble. Clear "chat" and clearly Sporta, but
  the S was a thin blob at 16 px inside a 28 px bubble, and a bubble says "message", not "Sporta".
- **B, voice bars in a bubble.** Five rounded bars in a round bubble. Reads as "voice message", which is every
  messenger. The bars are 1 px apart at 16 px and smear into a texture.
- **C, stopwatch + four-point spark (rejected).** Legible at 16 px, but the spark is the generic AI sparkle: it
  carried the meaning, the stopwatch was a frame, it belongs to no brand, and at 20 to 32 px a shopper could take it
  for another assistant's button or a plain timer. Kept in `concept-c.svg` unchanged.
- **D, stopwatch + Sporta S swoosh (chosen).** The A idea done properly: the S is not a letter in a bubble but the
  logo's swoosh, bold enough for 16 px (22% of the dial, strokes up to 1.8 px there), with the stopwatch giving the
  silhouette. It is tied to the logo, distinct from every assistant icon, and still one object at 16 px.
  Honest weakness: nothing in the glyph says "AI" or "chat". That comes from the label next to it (`T.title`, shown from
  640 px up), the panel it opens and the launcher's `aria-label`; the old icon (the plain S) said no more.
  A speech bubble or a spark was left out on purpose: either would be the cliché again.

Contrast (WCAG 1.4.11 asks 3:1 for a graphic that carries meaning): #E0561C on white 3.81, on charcoal 4.59;
#FF7B17 on charcoal 6.73; charcoal swoosh on #E0561C 4.59, on #FF7B17 6.73. **#E0561C on the beige canvas
#E2DBCE is 2.77: below 3:1, so on beige use the mono file in charcoal**, not the full-colour master.

## Where the OLD icon is used

The current "icon" is the brand S (`public/favicon-192.png`, 192 px PNG, the same file as the favicon and the
PWA icon) shown as a plain `<img alt="">`; there is no AI-specific artwork at all.

| Place | File : line | How |
|---|---|---|
| Floating launcher (20 px, charcoal pill) | `Assistant.jsx`: 45 | `<img src="/favicon-192.png" className="h-5 w-5">` inside `button[aria-label=T.open]` |
| Panel header (28 px, charcoal bar) | `AssistantPanel.jsx`: 100 | `<img src="/favicon-192.png" className="h-7 w-7">` |
| Speaker and mic buttons in the panel | `AssistantPanel.jsx` Speaker and Mic | text glyphs, not artwork; out of scope here, but they are the least on-brand part of the panel |

(Both files are under `sporta-web/src/components/`; `npm run test:ai-icon` checks the line numbers.)

Live site: the assistant is part of the compiled storefront. What is known from the repo:
`public/sporta-ui-colours.css` ("سبورتا AI panel: opened OFF the top of the screen") records, measured live on
2026-11-02, that the live build renders the launcher **inside `<header class="app-header">`** and the panel
(`[role="dialog"].fixed.bottom-24`) inside it too. **The launcher's own markup (img, inline svg or CSS) on the live
page was NOT measured**: the Hostinger connector was not authorised for this work, so the read-only probe could not
run. The CSS below is proven only on the repo's own markup (see Reviewing), in Chromium. It is **not verified
against the live compiled build and not tested in Firefox or Safari.** Do not apply it before step 1.

## Applying it (not done)

### Live site (add-on change in an allowed live file)

CSP is `img-src 'self' data:`, so a data URI is allowed and needs no new file in `public/` (a new file would not
be linked by the live index.html anyway). Charcoal is the ground in every live spot (header bar, launcher pill,
panel header), so use the **on-dark** artwork.

1. Measure first, read-only, in a `mcr.microsoft.com/playwright:v1.49.0-noble` job (home page, ar-KW and
   ?lang=en, 390x844 and 1280x800): print `outerHTML` with text removed for
   `.app-header button[aria-label]` candidates and for `[role="dialog"].fixed.bottom-24 header`; the live
   labels are expected to be `افتح مساعد سبورتا` / `Open the Sporta assistant`. Note whether the icon is an
   `img`, an inline `svg`, or a CSS background.
2. If it is an `<img>` (as in this source), add to a live add-on CSS file that is not being edited elsewhere
   (`sporta-shadows.css` or `sporta-bag-touch.css` are the quiet ones; `sporta-ui-colours.css` is where the
   panel rule above already lives but is owned by another workflow):

   ```css
   /* Sporta AI mark: stopwatch + S swoosh (brand/sporta-ai/sporta-ai-icon-on-dark.svg) */
   button[aria-label="افتح مساعد سبورتا"] img,
   button[aria-label="Open the Sporta assistant"] img,
   [role="dialog"][aria-label="سبورتا AI"] > header img {
     content: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='48' height='48' viewBox='0 0 48 48'%3E%3Cpath fill='%23FF7B17' d='M24 9A18 18 0 0 1 24 45A18 18 0 0 1 24 9ZM19.5 3H28.5Q30 3 30 4.5V6Q30 7.5 28.5 7.5H19.5Q18 7.5 18 6V4.5Q18 3 19.5 3ZM22 7.5H26V10.5H22ZM33.3 14.3L37.9 9.7L41.3 13.1L36.7 17.7Z'/%3E%3Cpath fill='%23171A1E' d='M33.6 20.9C33.9 19.8 33.8 18.6 33.2 17.6C32.5 16.4 31.4 15.5 30.1 14.9C28.6 14.2 26.9 13.9 25.2 14C23.4 14 21.6 14.4 19.9 15.3C18.3 16.1 16.9 17.4 16.1 19C15.2 20.6 15 22.6 15.5 24.3C16.1 25.9 17.4 27.3 18.9 28.1C20.5 28.9 22.3 29.2 24 29.2C25 29.2 26 29.4 26.7 30C27.1 30.2 27.4 30.7 27.4 31.1C27.4 31.6 27.3 32 27 32.4C26.6 33.2 26 33.8 25.3 34.4C24.3 35.3 23.3 35.9 22.1 36.4C21 36.9 19.7 37.2 18.4 37.1C17.4 37 16.3 36.6 15.6 35.9C14.9 35.1 14.6 34.1 14.7 33.1L14.4 33.1C14.1 34.2 14.2 35.4 14.8 36.4C15.5 37.6 16.6 38.5 17.9 39.1C19.4 39.8 21.1 40.1 22.8 40C24.6 40 26.4 39.6 28.1 38.7C29.7 37.9 31.1 36.6 31.9 35C32.8 33.4 33 31.4 32.5 29.7C31.9 28.1 30.6 26.7 29.1 25.9C27.5 25.1 25.7 24.8 24 24.8C23 24.8 22 24.6 21.3 24C20.9 23.8 20.6 23.3 20.6 22.9C20.6 22.4 20.7 22 21 21.6C21.4 20.8 22 20.2 22.7 19.6C23.7 18.7 24.7 18.1 25.9 17.6C27 17.1 28.3 16.8 29.6 16.9C30.6 17 31.7 17.4 32.4 18.1C33.1 18.9 33.4 19.9 33.3 20.9Z'/%3E%3C/svg%3E");
   }
   ```

   `content: url()` on a real `<img>` is honoured by Chromium; **Firefox and Safari were not tested here**, so
   check both and, if one fails, swap the `src` from the existing live `sporta-features.js` with a
   MutationObserver on the same selectors instead. If step 1 finds an inline `<svg>`, replace its `innerHTML`
   from JS rather than using CSS. The artwork carries its own colours; the rule needs no light/dark variant.
3. Verify by DOM measurement on the VPS (the swapped image's rendered size at 20 and 28 px, no horizontal overflow in
   the header at 390 px) and with a mutation check that the rule is what changes it.

### Repo storefront source

1. Add `SportaAiIcon` to `src/components/icons.jsx` (inline SVG, no request, 1.2 kB, so the launcher chunk
   rule in `Assistant.jsx` still holds):

   ```jsx
   export function SportaAiIcon({ className = 'h-5 w-5' }) {
     return (
       <svg viewBox="0 0 48 48" className={className} aria-hidden="true" focusable="false">
         <path fill="#FF7B17" d="M24 9A18 18 0 0 1 24 45A18 18 0 0 1 24 9ZM19.5 3H28.5Q30 3 30 4.5V6Q30 7.5 28.5 7.5H19.5Q18 7.5 18 6V4.5Q18 3 19.5 3ZM22 7.5H26V10.5H22ZM33.3 14.3L37.9 9.7L41.3 13.1L36.7 17.7Z" />
         <path fill="#171A1E" d="M33.6 20.9C33.9 19.8 33.8 18.6 33.2 17.6C32.5 16.4 31.4 15.5 30.1 14.9C28.6 14.2 26.9 13.9 25.2 14C23.4 14 21.6 14.4 19.9 15.3C18.3 16.1 16.9 17.4 16.1 19C15.2 20.6 15 22.6 15.5 24.3C16.1 25.9 17.4 27.3 18.9 28.1C20.5 28.9 22.3 29.2 24 29.2C25 29.2 26 29.4 26.7 30C27.1 30.2 27.4 30.7 27.4 31.1C27.4 31.6 27.3 32 27 32.4C26.6 33.2 26 33.8 25.3 34.4C24.3 35.3 23.3 35.9 22.1 36.4C21 36.9 19.7 37.2 18.4 37.1C17.4 37 16.3 36.6 15.6 35.9C14.9 35.1 14.6 34.1 14.7 33.1L14.4 33.1C14.1 34.2 14.2 35.4 14.8 36.4C15.5 37.6 16.6 38.5 17.9 39.1C19.4 39.8 21.1 40.1 22.8 40C24.6 40 26.4 39.6 28.1 38.7C29.7 37.9 31.1 36.6 31.9 35C32.8 33.4 33 31.4 32.5 29.7C31.9 28.1 30.6 26.7 29.1 25.9C27.5 25.1 25.7 24.8 24 24.8C23 24.8 22 24.6 21.3 24C20.9 23.8 20.6 23.3 20.6 22.9C20.6 22.4 20.7 22 21 21.6C21.4 20.8 22 20.2 22.7 19.6C23.7 18.7 24.7 18.1 25.9 17.6C27 17.1 28.3 16.8 29.6 16.9C30.6 17 31.7 17.4 32.4 18.1C33.1 18.9 33.4 19.9 33.3 20.9Z" />
       </svg>
     )
   }
   ```

2. `src/components/Assistant.jsx` line 45: replace the `<img src="/favicon-192.png" …>` with
   `<SportaAiIcon className="h-5 w-5" />`.
3. `src/components/AssistantPanel.jsx` line 100: same, `className="h-7 w-7"`.
4. Do not touch `favicon*.png`: they are the brand mark and the PWA icon, which stay the S.

## Reviewing

```
cd sporta-web
npm run test:ai-icon              # geometry, files, README, and (with Chromium) the cut-out and the CSS rule
npm run test:ai-icon -- --preview # also rewrites brand/sporta-ai/preview.png from these exact files
```

The suite needs no database, no PHP and no dev server. It flattens the SVG paths itself and fills them with the
nonzero rule, so the numbers (centre, rim, cut-out) do not depend on a renderer; Chromium (`CHROMIUM_PATH`,
default `/opt/pw-browsers/chromium`) cross-checks them and is skipped, loudly, when absent. Run it against another
copy of the folder with `DIR=/path/to/sporta-ai node scripts/sporta-ai-icon-test.mjs`: pointing it at revision 1 of
this folder (git `d0957c1d`) fails it, which is how the suite is shown to be a test and not a formality.
After any edit to a path, regenerate `preview.png`.
