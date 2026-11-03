# Sporta AI icon (سبورتا AI) — new mark

Status: **designed, not applied.** Nothing in `sporta-web/` or on the live site was changed.
Masters live here, never in `sporta-web/public/` (anything there ships).

## The mark

A stopwatch with a four-point spark where the dial would be: **sport (pace, performance) + smart (the spark)**.
It is deliberately not a robot face, a brain, or a sparkle on its own, and it is not the logo S, so it never
competes with the logo that sits next to it in the header.

| File | Use |
|---|---|
| `sporta-ai-icon.svg` | master, full colour for light surfaces: body #E0561C, spark #171A1E |
| `sporta-ai-icon-on-dark.svg` | full colour for charcoal surfaces (the launcher, the panel header, the header bar): body #FF7B17, spark #171A1E |
| `sporta-ai-icon-mono.svg` | one colour, `fill="currentColor"`, the spark is a real cut-out (one path, nonzero winding, holes wound the other way), so it works on any ground, including orange where the full-colour body would vanish: set `color: #171A1E` |
| `concept-a.svg`, `concept-b.svg`, `concept-c.svg` | the three concepts (C is the chosen one, byte-identical to the master) |

All files: viewBox 0 0 48 48, no text, no external references, no filters, no strokes (everything is filled
paths, so there is nothing to scale wrongly), 350 to 500 bytes each, symmetric about the vertical axis so it reads
the same in RTL and LTR (never mirror it). No `<title>`: the accessible name is the host's job; the launcher
already has `aria-label` (`t.assistant.open`) and the icon sits in an `alt=""` image today.

## Concepts and the choice

- **A, S in a speech bubble.** The brand S as a cut-out in a rounded bubble. Clear "chat" and clearly Sporta, but
  it is the logo again, right beside the logo in the header, says nothing about "smart", and the S is a blob at 16 px.
- **B, voice bars in a bubble.** Five rounded bars (voice mode) in a round bubble with a centred tail. Reads as
  "voice message", which is every messenger. The bars are 1 px apart at 16 px and smear into a texture; the
  weakest at small size.
- **C, stopwatch spark (chosen).** The only one that still reads as one object at 16 px: disc, crown, spark.
  Distinct silhouette in the header (round with a crown, where the logo is a slanted S and the cart is a bag).
  Works in all four treatments in `/tmp/.../aiicon/preview.png` (white, charcoal, orange, one colour) and 16 to 96 px.
  Honest weakness: no bubble, so "chat" comes from the launcher's label (`T.title`, shown from 640 px up) and the
  panel, not from the glyph. A bubble tail was rejected: at 16 px it would cost the crown, which is
  what makes it a stopwatch rather than a coin.

Contrast (WCAG 1.4.11 asks 3:1 for a graphic that carries meaning): #E0561C on white 3.81, on charcoal 4.59;
#FF7B17 on charcoal 6.73; charcoal spark on #E0561C 4.59, on #FF7B17 6.73. **#E0561C on the beige canvas
#E2DBCE is 2.77: below 3:1, so on beige use the mono file in charcoal**, not the full-colour master.

## Where the OLD icon is used

The current "icon" is the brand S (`public/favicon-192.png`, 192 px PNG, the same file as the favicon and the
PWA icon) shown as a plain `<img alt="">`; there is no AI-specific artwork at all.

| Place | File : line | How |
|---|---|---|
| Floating launcher (20 px, charcoal pill) | `src/components/Assistant.jsx` : 37 | `<img src="/favicon-192.png" className="h-5 w-5">` inside `button[aria-label=T.open]` |
| Panel header (28 px, charcoal bar) | `src/components/AssistantPanel.jsx` : 100 | `<img src="/favicon-192.png" className="h-7 w-7">` |
| Speaker and mic buttons in the panel | `AssistantPanel.jsx` Speaker and Mic | text glyphs 🔊 ■ 🎙 ●, not artwork; out of scope here, but they are the least on-brand part of the panel |

Live site: the assistant is part of the compiled storefront. What is known from the repo:
`public/sporta-ui-colours.css` ("سبورتا AI panel: opened OFF the top of the screen") records, measured live on
2026-11-02, that the live build renders the launcher **inside `<header class="app-header">`** and the panel
(`[role="dialog"].fixed.bottom-24`) inside it too. **The launcher's own markup (img, inline svg or CSS) on the live
page was NOT measured in this task**: the Hostinger connector was not authorised in this session, so the
read-only probe could not run. Run it before applying (below).

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
   panel rule above already lives but is currently owned by another workflow):

   ```css
   /* Sporta AI mark: stopwatch + spark (brand/sporta-ai/sporta-ai-icon-on-dark.svg) */
   button[aria-label="افتح مساعد سبورتا"] img,
   button[aria-label="Open the Sporta assistant"] img,
   [role="dialog"][aria-label="سبورتا AI"] > header img {
     content: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='48' height='48' viewBox='0 0 48 48'%3E%3Cpath fill='%23FF7B17' d='M24 8A18 18 0 0 1 24 44A18 18 0 0 1 24 8ZM19.5 1.5H28.5Q30 1.5 30 3V5Q30 6.5 28.5 6.5H19.5Q18 6.5 18 5V3Q18 1.5 19.5 1.5ZM22 6.5H26V9H22Z'/%3E%3Cpath fill='%23171A1E' d='M24 12C23.3 20.5 21 24 10 26C21 28 23.3 31.5 24 40C24.7 31.5 27 28 38 26C27 24 24.7 20.5 24 12Z'/%3E%3C/svg%3E");
   }
   ```

   `content: url()` on a real `<img>` is honoured by Chromium and Safari; **Firefox support was not tested here**,
   so check it in Firefox and, if it fails, swap the `src` from the existing live `sporta-features.js` with a
   MutationObserver on the same selectors instead. If step 1 finds an inline `<svg>`, replace its `innerHTML`
   from JS rather than using CSS. Keep the rule in plain light/dark neutral CSS: the artwork carries its own colours.
3. Verify by DOM measurement on the VPS (naturalWidth/computed size of the swapped image at 20 and 28 px, no
   horizontal overflow in the header at 390 px) and with a mutation check that the rule is what changes it.

### Repo storefront source

1. Add `SportaAiIcon` to `src/components/icons.jsx` (inline SVG, no request, 376 bytes, so the launcher chunk
   rule in `Assistant.jsx` still holds):

   ```jsx
   export function SportaAiIcon({ className = 'h-5 w-5' }) {
     return (
       <svg viewBox="0 0 48 48" className={className} aria-hidden="true" focusable="false">
         <path fill="#FF7B17" d="(body path from sporta-ai-icon-on-dark.svg)" />
         <path fill="#171A1E" d="(spark path from sporta-ai-icon-on-dark.svg)" />
       </svg>
     )
   }
   ```

2. `src/components/Assistant.jsx` line 37: replace the `<img src="/favicon-192.png" …>` with
   `<SportaAiIcon className="h-5 w-5" />`.
3. `src/components/AssistantPanel.jsx` line 100: same, `className="h-7 w-7"`.
4. Do not touch `favicon*.png`: they are the brand mark and the PWA icon, which stay the S.

## Reviewing

`preview.png` (all concepts, 16/20/24/32/48/96 px, on white, charcoal, orange, in mono and full colour) is rendered
by Playwright from these exact files; regenerate it after any edit to a path.
