# Project notes

## Design preferences

- **No beige.** Never use beige, cream, sand-tinted or warm "paper" tones for
  backgrounds and surfaces. Since the dark logo theme (owner's approval,
  2026-10-07) the page is the logo's near-black ground `#0a0908` and the cards
  sit one near-neutral step above it (`--panel` · `--panel-2` · `--panel-3`).
  This applies to the website, the app, and any generated document or mockup;
  a printed statement or any light-ground deliverable is white, never cream.
  The logo's **amber** (`--tint` `#e6a95c`, banded with its dark `--stripe`)
  is the one accent and always an ink, never a surface; warnings are a
  separate yellow (`--sand`). This rule governs backgrounds and surfaces.

## Almuhallab Code — `almuhallab/`

### 🔒 NAMING: the system is **النوخذة**, never "Nokha"

"Nokha" / "Nokha1" was the user's **private shorthand for النوخذة, for their own
use only**. It must never appear on the live site, in any published page, name,
title, filename, or artefact. Write **النوخذة** in Arabic; where a Latin
filename or key is unavoidable, use `nokhatha` (matching the `nokhatha-*`
storage keys). The portal lives at `nokhatha.html`, reachable as `/nokhatha` on **any** host:
the extensionless form is a rewrite in `.htaccess` for Apache, and a
`<name>/index.html` stub for GitHub Pages, which ignores that file. The stub is
a script, not only a `<meta refresh>`, because a **fragment never reaches the
server** and a refresh would drop it — `/safi#/x` must keep its tab. Each stub
is `noindex` with a canonical to the `.html`, so a clean URL is an entry point
and not a second indexable copy. There is deliberately **no `/nokha1/`**: the
stub file keeps old links alive, but a new directory carrying the shorthand
would be introducing it afresh. `nokha1.html`
survives only as an unlinked redirect for links published before the rename.
`design/test_suite.py` fails if the shorthand reappears in **any authored
artefact**, not only a page — it was found in `.htaccess`, in `SECURITY.md`'s
own title, in the HTTP/3 server configs, and printed on the cover of the
generated PDF sample. Two uses are sanctioned and stay: the `nokha1.html`
redirect stub, and the `nokha1-admin-*` storage keys the console migrates old
records *from* — renaming those would strand real data.

### 🔒 THE ALMUHALLAB STYLE IS FINAL — NEVER CHANGE IT

This identity is the company's own, taken from the live site. It is **not** open
to redesign, refresh, "improvement", or substitution — not by me, not on my own
initiative, not as a side effect of another task. Change it **only** when the
user asks for that change in so many words, and change only what they name.

Locked, exactly as they are:

| | Locked value |
|---|---|
| Mark | **Since 2026-10-07 the company flies the English logo** (owner's «make full new theme use this logo with same logo theme style», choosing «Dark, like the logo» on «All pages»): ALMUHALLAB in Chakra Petch Bold outlines with the striped amber fill (`#e6a95c` banded with `--stripe` `#7f5d33`), CODE between fading rules, `>_ SOFTWARE & SYSTEMS` in JetBrains Mono, on the near-black ground with a soft amber glow; its square form is the **AC monogram** (striped amber A, white C). One generator, `design/logo-en/build.py`, writes the kit and every site mark: `logo.svg`, `favicon.svg` (the monogram on its rounded tile), the inline masthead logo between the `<!-- logo-en:masthead -->` markers (tight viewBox, `MAST_BANDS = 3` so every band clears every flat letter edge at 2×, ids prefixed `site-mast-`, `role="img"` named «المهلب كود · Almuhallab Code»), `apple-touch-icon.png`, `logo-512.png` (the JSON-LD logo) and `og.png`; `--check` compares the SVGs as text, re-renders every PNG, and fails on a hand edit. The footer sets the monogram beside ALMUHALLAB CODE / المهلب كود. — History: the boum (stroked, then a pixel grid 2026-09-28, then illustrated 2026-10-03) is retired from the site. `#i-boum`/`#i-sail` stay in the sprite for the film only, and `pixel_boum.py --check` with the boum polygon asserts still runs as legacy; `ship_mark.py` and `og_image.py` are deleted; `logo_pack.py` and `instagram_covers.py` refuse to run until they are redrawn from the logo-en kit |
| Masthead & type | The masthead **is the logo** (280px desktop · 220px phone · 200px short landscape; 168 / 140 once scrolled) over a terminal line `>_ شركة برمجة وأنظمة ▌`, prompt and cursor in amber, the cursor static; the line folds away once scrolled. **Cairo** sets all Arabic and body text; **Chakra Petch** 600/700 (`--display`) the Latin display halves: the hero's English line, the counters, the footer's ALMUHALLAB CODE; **JetBrains Mono** (`--mono`) figures, codes and every `>_`. The two logo faces are Latin subsets written by `design/site_fonts.py` (`--check` pins the bytes and the glyphs the pages set) under Cairo's own Latin `unicode-range`, so Arabic in the same element falls through to Cairo. Reem Kufi and Share Tech Mono are retired to `design/logo-modern/fonts/`. `scroll-margin-top` clears the **top** bar, because a jump from the top compacts the bar on the way and the page rises by the difference: 184px desktop (160 + 24), 168px phone (142 + 26), 160px short landscape (132 + 28) |
| Brand ink | **Amber on near-black since 2026-10-07**: `--tint` `#e6a95c` (9.66:1 on the page, 7.62:1 on `--panel-3`) · `--tint-hover` `#fabc6f` · `--on-tint` `#0a0908`, the ink ON amber (white on amber is 2.06:1: never white on `--tint`) · `--stripe` `#7f5d33` (amber × .55, the logo's band) · the bar `--tint-strong` `#0a0908` with `--on-bar` `#f4f4f4`, `--on-bar-bd` `#79736c`, `--on-bar-fill` `#272625` · chart ramp `#624621`→`#e6a95c` · warnings `--sand` `#f2d855`, a yellow kept apart from the accent. Before: dark grey `#33383f`/`#25292f` (2026-10-03), brown `#7a4418`/`#6f3f1c` |
| Surfaces | **the logo's dark on every device**: `--bg` `#0a0908` (page and bar), `--panel` `#141211` (cards), `--panel-2` `#1a1918` (fields, recessed rows), `--panel-3` `#242321` (the lightest step: inks are graded on it); `--border` `#363534` hairlines, `--border-input` `#76706a` control edges (3.21:1 on panel-3). `color-scheme: dark` on `:root`, no `prefers-color-scheme` block, `theme-color` `#0a0908`. Printing `nizam.html` swaps the tokens to white paper and dark ink. Amber is ink, never paper |
| Icons | the drawn `<symbol>` sprite — no emoji anywhere on the public page |
| Layout | full-height hero with real counters and a **code rain** in its margins (Arabic letters, digits and code marks in two seeded copies, one translate animation; masked to the outer 20% on each side so no visible column crosses the text; not drawn on phones, where the text runs edge to edge) · **slide rails** (scroll-snap sliders with arrows + dots — the card grids became sliders at the owner's request, 2026-07-30) · the automation `ol.flow` · wide `.product` rows · `ol.steps` as a slider timeline · the WhatsApp project form · contact channels as a bar (the «ما نبنيه لعملك» offers rail and «مزايا تحصل عليها» were **removed at the owner's word, 2026-08-20** — eleven sections were too many — do not restore them; «لماذا المهلب كود» (the commitments `.band`) and «التقنيات» (the technology cloud) went the same way at the owner's word, 2026-10-02 — «too much crowd contents»: the band repeated the hero's counters, the cloud listed tools rather than work) · the four-column footer on the `--panel` base |
| Products | **النوخذة only.** The in-browser code editor was retired at the owner's request — do not reintroduce it |
| Contact | واتساب `+965 6589 4110` · انستغرام `@almuhallab.code` · `hello@almuhallab-code.com` |

`design/test_suite.py` pins every one of these (section `identity`). If a change
makes those checks fail, the change is wrong — fix the change, never the test.

**Almuhallab Code (المهلب كود) is a software company.** `www.almuhallab-code.com`
is the *company* website. **النوخذة is one system the company built and
runs — a product inside the site, never the site itself.** Do not put النوخذة's
portal, registration, plans or dashboard on the root page.

Static HTML5 PWA, Arabic-first (RTL), no build step and no dependencies.

- `index.html` — the company site: services, work, how we work, contact. Links
  into the products; carries no account UI. Built from **one shared vocabulary**
  — hero, `h2.section` + `.sub`, a `.grid` of uniform `.card`s with `.chip`s, plus
  the first version's own components: wide `.product` rows for the systems the
  company built, `ol.steps` for how we work, and the `.contact` bar.
- `nokhatha.html` — the النوخذة portal · `nizam.html` (the unified system: المركز المالي · صافي ·
  XBRL · التوصيل in four tabs over one data core, plus **التواصل** — the social
  media centre, a fifth tab that is a reference desk and not a publishing tool:
  the real channels, the generated brand assets with the size each platform
  actually renders them at, and copy written only from facts already on the
  site. It stores nothing — those are the company's facts, not the user's
  records, and an editable copy would be a second source of truth. No follower
  counts and no engagement figures: the page cannot measure either without
  inventing it) ·
  `admin.html` · `sw.js` · `manifest.webmanifest` (its `start_url` is
  `nokhatha.html` — the installable app is النوخذة, not the company brochure)
- `safi.html`, `xbrl.html`, `delivery.html` are **redirect stubs** to
  `nizam.html#/<tab>`. There is one implementation of each unit — do not
  reintroduce standalone copies.
- The units are linked, not merely co-located: portfolio market value feeds the
  XBRL investments line (rolling into non-current assets), delivered-order
  totals feed XBRL revenue.
- **النوخذة is free.** One plan, every unit open, no price and nothing to upgrade
  to — in the portal and in the admin console alike. Don't reintroduce tiers,
  prices or projected revenue.
- The XBRL unit is the **Kuwaiti annual filing**: subtotals are computed from
  line items (never typed), and an audit pass reports errors that block filing,
  companies-law warnings, and suggestions with amounts (statutory reserve 10%,
  zakat 1% for KSCC, labour support 2.5% + KFAS 1% for listed). The entity is
  identified by its commercial-registration number. Final submission is via the
  Ministry of Commerce portal — say so, never imply the file itself is the
  submission.
- **Spacing is one scale on every page**: 4 · 6 · 8 · 12 · 16 · 20 · 24 · 32 · 40 ·
  56. Interactive rows (`.btn`, nav links, table cells) sit at `12px 16px` so they
  measure ~44px — set by intent, not by snapping to the scale. Before this, the
  four pages carried 27 distinct values, 7 off any scale.
- **A computed total is a statement total, not another input.** Every readonly
  field in the XBRL filing carries `label.total` and owns a full-width row —
  label at the RTL start, amount at the end, `border-top` separator (heavier for
  the two roll-ups), stacking on mobile. Pinned by the suite.
- Every colour is a CSS custom property in one `:root` block. **All pages must
  carry the identical token set** — divergence between pages has been a real bug
  before.
- Colour values are **solved numerically against WCAG targets**, never picked by
  eye. Text ≥ 4.5:1 (body ≥ 7:1) against the surface it can land on that is
  closest to it in lightness: on this dark theme that is the lightest one,
  `--panel-3`;
  essential UI boundaries ≥ 3:1; chart marks ≥ 2:1.
- **The company's identity is the English logo** (`design/logo-en/`):
  ALMUHALLAB CODE in striped amber on near-black, with the AC monogram as its
  square form (`favicon.svg`: footer, tab, touch icon). النوخذة keeps the ⚓
  anchor (`icon.svg`), now amber on the same ground: the company and the
  product are marked differently on purpose.
- Contact channels are the real ones and must not be replaced with placeholders:
  واتساب `+965 6589 4110` · انستغرام `@almuhallab.code` · البريد
  `hello@almuhallab-code.com`.
- Arabic is set in bundled **Cairo** (SIL OFL, `almuhallab/fonts/`, Arabic
  subset, weights 400/500/700/800 — 500 also serves the 600 slot; 54 KB).
  Chosen at the owner's request for a modern face (2026-08-01) by rendering
  Cairo, Almarai, Readex Pro, Alexandria and IBM Plex Sans Arabic side by side
  in the page's own copy and looking at them. Plex is ruled out — that is the
  face the owner rejected when asking for a better Arabic font. Never link a
  webfont CDN — the CSP blocks it. Any new page must declare the thirteen
  `@font-face` rules (five Cairo weights, each an Arabic and a Latin face,
  plus Chakra Petch 600/700 and JetBrains Mono), carry `font-src 'self'`, and
  be precached. A logo face is preloaded only where the first screen paints
  it; the suite's preload check asks for files by family, weight and script. Arabic set in
  Cairo needs `line-height` ≥ 1.35 on display sizes, or a damma collides with
  the line above. **The Arabic files are Arabic-only** — no digits, no Latin, not
  even a full stop — so each weight is a pair: the Arabic face under an Arabic
  `unicode-range`, and `cairo-latin.woff2` (Cairo's own Latin subset, one
  variable file for every weight) under the Latin range. Without the pair every
  figure on the site — counters, `+965`, each KWD amount — painted in the
  device's own face, and `getComputedStyle` still said "Cairo", so nothing
  noticed. The Arabic faces **must** carry their range: a face with none claims
  every character, misses the glyph, and the browser skips to the next family
  instead of the Latin file. The suite asks the engine what actually painted
  (`CSS.getPlatformFontsForNode`). Redirect stubs load no webfont at all.
- **There is one theme, and it is dark** (owner's choice 2026-10-07, «Dark,
  like the logo», reversing the white rule of 2026-07): `color-scheme: dark`
  on `:root` and no `prefers-color-scheme` block, so a device set to light
  gets the same site. `theme-color` is `#0a0908` on every page and in the
  manifest, so the browser chrome continues the bar; the redirect stubs and
  the 404 paint `#0a0908` too, so no page flashes white. The suite fails if a
  light override appears.
- **The masthead is a sticky bar on all four pages** (owner's request,
  2026-07-31): the company page centres the mark above the wordmark and
  shrinks the bar once scrolled (two thresholds — 60px down, 24px up — or a
  bar that changes the page's height retriggers itself forever); the app
  screens keep their row layout so nav and tabs stay in reach. The bar is the
  logo's own ground (`--tint-strong` `#0a0908`) with an `--on-bar-fill`
  hairline and an amber fade beneath. On it: `--on-bar` links, an **amber
  pill** with dark `--on-tint` ink for the one call to action, and outlined
  light for logout; red never appears there (a logout is not a deletion). Set
  the bar's ink on `.brand` itself, not only on its children: two pages shipped a dark wordmark because their markup was
  a `<div>`/`<span>` the colour rule never named. The suite measures every
  masthead label on every page.
  **On a phone, "in reach" decides the pattern** (2026-10-01): the system
  page and the console let their wrapped header scroll away *only because*
  their tabs move to a fixed bottom bar — a static header with nothing below
  is not that pattern (a skeptic caught exactly that). The portal has no
  bottom bar, so its bar stays sticky and its links run in one swipeable row,
  ordered by what the app needs (call to action, then dashboard or login; the
  company link, also in the footer, last) — 171px became 115px. The company
  bar takes the phone's lockup sizes when the screen is short
  (`max-height: 500px`): a landscape phone gave it 67% of the screen.
- **Boxes fit what they hold, measured from 320 to 1440, portrait and on its
  side** (audit of 2026-10-01; every trap below shipped and none was visible
  in the source). A `flex-basis` meant as a width becomes a *height* when the
  row turns into a column (three 240px contact pills holding 58px each). A
  `<figure>` keeps the browser's `16px 40px` margin until told otherwise. A
  grid track `minmax(430px,1fr)` overflows a phone — write
  `minmax(min(430px,100%),1fr)`. `text-align` centres nothing in an
  inline-flex button — `justify-content` does. `.hero > *` outranked the
  hero's own art layer at equal specificity and stacked its geometry on one
  line. `overflow:hidden` for an ellipsis also cuts below the line box: at
  1.35 it took the dots off the final ي («المالي» read «المالى»); the
  suite compares the tab's pixels clipped and unclipped. Fields are 16px on
  any `pointer: coarse` screen, not just under 640px. A half-width tile must
  hold a *signed* seven-digit figure, the widest value it can show.
- The **footer is the site's map**, not a copyright line: four columns (the
  company and its channels written out in full · الشركة · الخدمات · النوخذة's
  units), on the `--panel` surface, opened by an amber fade hairline. Do
  not put an icon-only channel row beside the written one — it repeats the
  same three links while hiding the values.
- **A sticky bar hides whatever an in-page link jumps to.** Every anchor
  target carries `scroll-margin-top` (184px desktop, 168px phone, 160px short
  landscape). It clears the **top** bar (160 / 142 / 132px), not the compact
  one (105 / 95px): a jump from the top compacts the bar on the way and the
  page rises by the difference, which the suite measures from the top. `html` uses `scroll-behavior: smooth`, off under
  reduced motion. Tests that measure scroll positions must pass
  `behavior:'instant'` or they race the animation and read mid-flight values.
- **المهلب is the company; النوخذة is النظام الموحد it built and runs.** The
  masthead says «شركة برمجة وأنظمة», and the system is named «النوخذة: النظام
  الموحد» wherever it is introduced. Never let the product name stand in for
  the company's.
- **The النوخذة section carries a flow map**, not just prose: صافي · التوصيل →
  نواة بيانات واحدة → الميزانية السنوية → ملف XBRL, with current running along
  the wires. It is a labelled diagram first and an animation second — with
  motion off it still reads as the same explanation. Each source owns its wire
  (`.frow`); one stretched connector cannot know where two boxes of unknown
  height sit and drifted off them as soon as the copy changed.
- The company page is **short copy carried by icons**: one line per card, each
  headed by an icon in its own 38px tile. Motion is opacity/transform only —
  masthead and hero entrance, per-section reveal on scroll, hover lift, one
  sheen on the flagship row, a live dot. Two rules it must keep: the hidden
  state is applied *by* the script (`html.motion [data-reveal]`), never by
  default, so a blocked script or a non-scrolling renderer still shows
  everything; and a 1.5s failsafe reveals whatever the observer never reached.
  `prefers-reduced-motion` switches all of it off. Sections reveal as whole
  blocks — staggering siblings puts cards of one row on different baselines.
- **Nothing animates off screen.** The page carries 80 endless animations and
  all 80 used to run whatever was on screen; an IntersectionObserver marks
  off-screen hosts `.offscreen` and the stylesheet pauses them (applied *by*
  the script, same reason as the reveal). The pause needs `!important`: every
  animation here is declared with the `animation` shorthand, which resets
  `animation-play-state` to running, and those declarations sit below the rule.
  The suite **measures computed play-state in the browser** rather than
  grepping for the rule — the first version was written just after a comment's
  `*/` with its own `*/`, so the parser swallowed it and the source contained a
  perfect rule the page never had. Running fell from ~76 to 16–27, with nothing
  visible ever frozen.
- *(History — the section below was removed 2026-08-20 at the owner's word; its
  lessons are kept because the services rail uses the same drawn idiom. Its
  leftover CSS — the gear and caret animations — was deleted 2026-09-28.)*
  **«ما نبنيه لعملك» was drawn, not written** (owner's request, 2026-08-01:
  «قلل الكتابة واجعل بدل كتابة أشكال»): five SVG scenes — gears that turn,
  a pen that draws, two devices labelled iOS/Android whose screens fill,
  code that types itself, and the logo drawn as فكرة → بناء → روح (below) —
  each under a two-word label. No Apple or Android
  logo is drawn: the platform names are set as text, which is nominative use;
  reproducing their marks is not ours to do. **Never name a card class
  `.shape`** — that is the hero's floating geometry and carries
  `position: absolute`; the collision stacked all four cards in one grid cell
  and silently killed the rail. The suite now checks each drawn card takes its
  own column and that none is absolutely positioned.
- **A logo is drawn as فكرة → بناء → روح**, not shown as a finished picture:
  the offer card's scene is a bulb, then the mark under construction on its
  geometry, then the finished mark with a halo. The mark drawn there is a
  neutral one — the company's own sail is never used as a sample of client
  work, and the suite fails if that scene ever `<use>`s the sprite.
- **«من أعمالنا» is delivered work; «ما نبنيه لعملك» is offers.** النوخذة is a
  system the company built and runs, so it keeps the flagship row. The five
  offers (أتمتة · تصميم · تطبيقات · برمجة خاصة · شعار وهوية) sit in their own
  rail beneath it, and the sub-line counts them — «خمسة نبدأ بها عادةً». Do not merge the two: filing
  an offer under "our work" presents it as something already delivered.
- **No em dash anywhere a visitor reads** (owner's word, 2026-10-07): use
  «:» for a label, «،» or «.» in a sentence, «·» between names, «|» in a
  title, «-» in an empty cell. Comments may keep theirs. Pinned by the suite.
- **One numeral system across the whole site**, not just the company page:
  placeholders read «٨ أحرف» and the not-found page was titled ٤٠٤ while every
  figure beside them was Latin. Pinned per page.
- **Every form control needs a name** (`label[for]`, a wrapping `<label>`, or
  `aria-label`) and **every interactive target clears 24px** (WCAG 2.2 AA).
  Five admin controls had no name; footer links measured 12px on three pages.
- **One numeral system per page.** Latin digits throughout, matching `+965`
  and the counters — an Arabic-Indic ٢٤/٧ chip beside them is the same defect
  that once printed ١٢٬٠٠٠ next to 850 in one table. Pinned by the suite.
- **Every number on the page is real and checkable.** The hero counters are the
  four النوخذة units, the suite's own check count, zero dependencies, and 100%
  offline — no invented "projects completed", "happy clients" or "years of
  experience", and no testimonials or client logos the company cannot show. If
  a counter's underlying fact changes, change the counter (the suite pins the
  settled values).
- The project form has **no server** and the CSP forbids `form-action`: a valid
  submission composes the message and hands it to WhatsApp, the same channel the
  bar below offers. It is JS-gated (`html.js .qwrap`) so a failed script leaves
  the channels as the contact surface rather than a dead form.
- **Framer Motion, Lottie and any CDN library are impossible here** — the CSP is
  `default-src 'none'` with no build step. Every effect (scroll reveal, counters,
  ripple, magnetic buttons, tilt, floating shapes, drawn SVG paths, the flow
  spine) is hand-written CSS/JS. Don't accept a request to "add Framer Motion"
  by adding a script tag; build the effect instead.
- The multi-card sections are **sliders ("rails"), not grids** (owner's request,
  2026-07-30): one scroll-snap track per section, native overflow scroll, with
  arrows + dots layered on by script. Rules: the arrows are gated behind
  `html.js` so a failed script leaves a clean swipeable row, never dead
  buttons; dots are decorative spans (`aria-hidden`) counting reachable scroll
  positions — never one per card, or the end of the rail leaves dots that can
  never light; arrows do navigation;
  RTL Chromium reports `scrollLeft` 0→negative so positions compare by
  absolute value and "next" scrolls by a negative delta; the rail's 4px inline
  padding means "at rest" ≈ 4px, so thresholds are 8px, never 0; on phones the
  arrows hide and the thumb does the work. "كيف نعمل" is a numbered
  timeline, the channels one bar of pills.
- Icons on the public site are a **drawn inline-SVG set** (`<symbol>` + `<use>`),
  not emoji: emoji are a different typeface, weight and colour on every platform.
  Three service icons (automation gear, AI-agent spark, design pen) are inlined
  rather than `<use>`-referenced so their parts can animate — spin, pulse and
  stroke-draw, all stopped by `prefers-reduced-motion`.
  **النوخذة's screens draw from the same set** (owner's request «improve all
  icons», 2026-10-01): tabs, buttons, chips, toasts, the balance verdict and
  the order rows. `design/app_sprite.py` writes each app page a sprite of only
  the icons it uses, **copied byte for byte from index.html's** — the eleven the
  company page never needs (download, print, check …) are drawn in that script
  on the same 24 grid and 1.8 pen — and `--check` in the suite fails on any
  hand edit. App icons take `stroke: currentColor`, so one drawing serves a
  the bar's light ink, an amber tab and a red status. In RTL "back" points right: back
  links flip the chevron (`.ic.back`), forward actions use it as drawn. A toast
  takes its icon as an argument (`toast(msg, "i-check")`) and keeps its text as
  `textContent` — the icon is built from fixed ids, never from data.
- **Every control has a state you can see, on every page** (theme audit,
  2026-10-03): `.btn:hover` is a fill and border change — `opacity: .88` moved a
  grey fill 1.01:1, invisible; `.btn:disabled` is `.6`, not `.45`, so the label
  still reads; tab buttons have a hover and a focus ring; the focus ring on the
  **dark bar is white** — an unscoped `.btn:focus-visible` (0,2,0) outranks
  `header a:focus-visible` (0,1,1) and painted grey on grey at 1.24:1, so the
  brand ring is scoped to `main` and `footer` on every page. Four radii only
  (999 · 12 · 8 · 2); the app pages had 9/10/14/16. Since the dark theme the
  logo's amber is the accent and warnings are yellow (`--sand`), and the suite
  scans every computed colour, gradients included: it fails on a warm hue
  outside the amber family (hue 31–36.5°), on warning yellow outside a
  warning, and on any warm light surface. Planted fixtures prove it flags an
  off-brand `#e07b39`, a cream panel and stray yellow, and passes `#e6a95c`
  as ink, fill, edge and fade. Before the theme it flagged amber itself: the
  brown palette's amber companions had painted an avatar whose white initial
  sat at 2.15:1, which is also why ink on amber is `--on-tint`, never white.
- **An action answers, asks or stays honest** (UX audit, 2026-10-03). The
  console's `mutate()` ignored `wr()`'s answer and toasted «تم تحديث الحالة»
  over a save that never happened — every write's result now decides the
  toast. Deleting a courier and cancelling an order **ask first** and name the
  record; a bulk delete asks a different sentence from a bulk suspend («نهائياً؟
  لا يمكن التراجع»). Toasts carry `role="status" aria-live="polite"` on every
  page and stay `max(1.8s, 60ms × characters)`. A refused field is marked
  `aria-invalid`, explained inline and focused; the portal's forms are
  `novalidate` (the JS already says everything in Arabic) and clear a stale
  error on input. After a route change focus lands on the new screen's
  heading; after a row action it returns to the list (`focusAfter`); a
  signed-in visitor is sent past `#/register` and `#/login`. Tabs mark
  `aria-current="page"` and name the screen in the title. Every page opens with
  a skip link to `main#main`. The project form opens WhatsApp **in the click**
  (a timer is what popup blockers stop) and leaves a real link behind.
  Overflowing tables and the phone nav fade their hidden end until scrolled
  there (`.more`, set by `cueScroll`).
- **A `display` rule beats the `[hidden]` attribute.** Every page carries
  `[hidden] { display: none !important; }`: the console's `label` is
  `display:flex`, so the login gate showed a second password box after the
  first logout, and making `.btn` inline-flex for its icons would have done the
  same to every hidden button. Pinned by the suite.
- Charts are hand-built inline SVG — the strict CSP forbids any chart library.
  Colour follows the encoding job: ordinal one-hue ramps where order carries
  meaning, a diverging pair for profit/loss where the sign is *also* shown by
  bar direction and a signed label.
- **`design/film/` builds the النوخذة film** — a page driven by one timeline,
  seeked frame by frame rather than recorded, with the Arabic voice recorded a
  line at a time and the picture re-timed to the measured speech (never the
  other way: the captions are burned in, so a line that overruns speaks one
  sentence under another's caption). Loudness is fixed by measuring, not by
  re-recording — the API offers no target and takes came back 4 LU apart.
  Pinned by `film_checks()`, whose checks were each proved able to fail.
- **`window.Nokhatha` is the documented way in and out of the records**
  (`almuhallab/docs/API.md`) — reads, writes, export/import, change events.
  It is a wrapper over the core that is already there, never a parallel one:
  reads go through the same coercion the screens use, writes through the same
  `wr()`, so it cannot hand out a record the screens would refuse nor report a
  save that did not happen. **No server** — it runs in the visitor's browser
  against their own storage, which is what lets the site keep saying the
  records never leave the device. Reads return fresh copies; writes answer
  `{ok, value}` or `{ok, error}` rather than throwing; nothing is formatted
  (an API returning `"1,240.500"` forces every caller to parse it back). A
  negative quantity is **refused, not clamped** — clamping stored a holding of
  zero shares and answered ok, which testing caught. Pinned by the suite in a
  real browser, and what it refuses is pinned as carefully as what it accepts.
- Data lives in `localStorage` under `nokhatha-*` keys (the admin console's own
  four are `almuhallab-admin-*`). Treat it as untrusted input on read: escape all
  rendered strings, re-coerce and **clamp every index** — a stored `plan` from a
  retired tier once crashed the dashboard because `PLANS[plan]` was undefined.
- Numbers are formatted with an **explicit `"en-US"` locale**. A bare
  `toLocaleString()` follows the visitor's device and printed Arabic-Indic digits
  beside Latin ones in the same table.
- `favicon.svg` (the company's AC monogram) is the tab icon for `index.html`;
  `icon.svg` (the ⚓ anchor) is النوخذة's. Don't cross them.
- The units print: `nizam.html` carries an `@media print` block that strips the
  chrome, forms and row actions so a statement prints as a document, and
  swaps the dark tokens for white paper and dark ink: a printer drops
  backgrounds, and near-white ink on a dropped black page prints nothing.

## Working practice

- **Run `python3 design/repo_state.py` before touching anything.** This
  container reverts its checkout between turns — it has happened at least seven
  times here, and it looks exactly like a normal working tree. The costs are
  real and all invisible at the time: work rebuilt from scratch, an audit run
  against code that is not the code that ships, and once a commit written on a
  fifteen-commit-old base that would have reverted all fifteen had the push not
  been refused. The script fetches, compares HEAD to origin, and prints the
  recovery command; exit 1 means do not start.
- **A scan that reports nothing is indistinguishable from a broken scan.** An
  ad-hoc `grep` once reported النوخذة clean of null assertions — the bracket
  expression had closed early on an escaped `]`, and the file had twenty. So
  the crash audit is a script with its own fixtures:
  `python3 design/dart_audit.py` refuses to report at all unless every rule
  first proves, against a line it must flag and a line it must not, that it can
  still see. Its own self-test caught the replacement rule flagging `is!`.
  Findings are questions, never verdicts: a `!` inside `if (x != null)` is
  correct and no regex can tell.
- **A test that cannot fail is worse than a missing one, because it is
  counted.** A tamper test once overrode `saltHex`/`hashHex` when the JSON
  keys are `salt`/`hash`: `addAll` appended two ignored entries, the record
  stayed valid, and four cases passed while testing nothing. Tamper tests go
  through `_corrupting()` in `test/auth_test.dart`, which fails if asked to
  corrupt a field the record does not have — and that guard has its own test,
  because otherwise it is the next thing to go quietly blind.
- Verify in a real browser (Playwright + the preinstalled Chromium at
  `/opt/pw-browsers/chromium-1194/chrome-linux/chrome` — pass it as
  `executable_path`, the pip package expects a newer build).
- `python3 design/test_suite.py` is the full system test — 646 checks covering
  token consistency and contrast, SAFI/XBRL/delivery arithmetic, generated
  artefacts, auth, hostile input, storage tampering, offline, layout, and the mobile shell
  (bottom tab bar, 16px inputs, 44px touch targets, [hidden] integrity). Run it
  after any change to `almuhallab/`; it exits non-zero on failure.
- **البحار is the voice assistant** — the sailor to النوخذة's captain. A sticky
  pill on the company page opens the ElevenLabs agent in a new tab; it is
  **never an embedded widget** (the CSP is `default-src 'none'` and widening
  it for a third-party script would undo the site's whole posture). It ships
  hidden and the script reveals it only when `AGENT_URL` (one line, top of
  index.html's script) holds an https link — a sticky button that opens
  nothing is worse than no button. It steps aside over the contact bar and
  the footer — and, since a swept measurement found it sitting on eleven other
  things a phone visitor scrolls past, over **any heading or control** it would
  otherwise cover. On phones it is an icon-only disc in the **inline-end**
  corner (the rails' arrows are hidden at that width, so that corner is free,
  and in RTL a disc there clips where a line ends rather than where it starts).
  Two traps, both hit and both pinned: the pill's own `<b>البحار</b>` matched
  the dodge's own selector and hid it on every pixel of the page; and `.away`
  translates the pill, so testing its live rect made the test undo its own
  result — measure where it **rests**. The suite sweeps for covered headings
  *and* asserts the pill is still on screen for ≥35% of the page, because a
  dodge that always fires is not a fix.
- `design/voice-agent/` is the Arabic ElevenLabs voice agent + n8n lead
  webhook: an importable n8n workflow (webhook → validate → `voice_leads`
  data table → Arabic JSON reply the agent speaks), and the full agent
  config whose prompt is locked to the company's real facts (real channels,
  النوخذة free, no invented prices/clients). The claude.ai ElevenLabs and n8n
  connectors need interactive authorization before Claude can apply these
  directly; until then the README's manual steps are the path. Do not embed
  the ElevenLabs widget in the site — the CSP stays `default-src 'none'`.
- **A brochure site nobody can find is not finished.** The site carries
  `robots.txt`, a `sitemap.xml` of exactly the three indexable pages, canonical
  URLs on all three, Open Graph + Twitter cards, and JSON-LD (Organization ·
  WebSite · SoftwareApplication). The share card `og.png` is **drawn by
  `design/logo-en/build.py`** from the logo kit (the lockup, «المهلب كود ·
  شركة برمجة وأنظمة» in Cairo, the address in JetBrains Mono), so it cannot
  drift from the mark; its `--check` re-renders it. The structured data states only
  facts already on the page: the real channels, النوخذة at 0 KWD, and
  **never an aggregateRating** — invented review markup earns a manual action.
  The six non-public pages carry `noindex`, and the suite fails if the sitemap
  ever lists one of them. `robots.txt`, `sitemap.xml` (with real git `lastmod`
  dates) and `llms.txt` are **generated** by `design/seo_files.py` — run it
  after adding a page, and `--check` in the suite fails when the committed
  files have drifted. The company page also declares its **seven** services as an
  `OfferCatalog` (تطوير المواقع · تطبيقات الجوال · برمجيات مخصّصة · حلول الذكاء
  الاصطناعي · تصميم UI/UX · الحلول السحابية · **تطوير الألعاب**, added at the
  owner's request 2026-08-13), each asserted to appear verbatim on the page, and the two
  inner pages carry a `BreadcrumbList`.
- **Retired with the boum (2026-10-07)**: `design/instagram_covers.py` now
  exits rather than draw the old mark; redraw it from the logo-en kit (the
  monogram was judged in a circle at 150/110/44/32px for exactly this) before
  it is used again. What it did, and the lessons that still hold:
  it drew the whole Instagram set from the page
  sprite (1080×1080, brown fill, white mark) — `design/instagram/`: twelve
  highlight covers **and the account's profile picture** (`profile-dp`). The DP
  is sized differently on purpose — a cover is one of twelve read at ~64px under
  a title Instagram prints, the DP carries the account alone at ~110px — but it
  is still kept well inside the crop, because **a square's corners sit 29%
  further from its centre than its edges**, so anything sized to the square gets
  shaved by the circle. Measured after generating: zero white pixels fall
  outside the circle. No wordmark on it: «المهلب» at 110px would be ~9px letters
  beside a handle Instagram already prints. The contact sheet shows the DP at
  150/110/44/32px — the four sizes Instagram really renders.
- **The desktop app is النوخذة, so it wears النوخذة's mark** — the ⚓ anchor from
  `almuhallab/icon.svg`. `design/windows_icon.py` used to draw the company's
  boum onto it, which is exactly the crossing the identity rule forbids;
  `design/macos_icon.py` draws the `.appiconset` from the same anchor.
- **macOS is built by generating the platform folder, not committing it**:
  `flutter create --platforms=macos .` runs on a real Mac in CI, then
  `nokhatha_app/tool/macos_setup.sh` asserts what must be true — the Arabic
  display name, `com.almuhallab.nokhatha`, the anchor icon, the App Sandbox on,
  and **no `network.client` entitlement**, because "it cannot phone home" is
  this app's central claim. The built `.app` is checked again with
  `codesign -d --entitlements`, since a build can pick up a different file than
  the script inspected. Hand-writing a `project.pbxproj` is how a build breaks
  in a way nobody can review.
- `design/design_system.py` builds `design/design-system/` — the design-system
  bundle, **extracted** from the site rather than written beside it: tokens from
  the `:root` block, marks from the sprite, component CSS from the stylesheet,
  contrast computed with the suite's own WCAG maths. Each card carries a
  first-line `<!-- @dsCard group="…" -->` marker, so the folder uploads to
  Claude Design unchanged once a design-system authorization exists (it needs
  `/design-login`, which wants an interactive terminal — not available in the
  web container). The marks are **copied** from the site's own files
  (`logo.svg`, the monogram, the anchor) and shown as images, so no mark is
  redrawn and two copies of one SVG cannot fight over their ids. Three traps, all hit while building it: extraction must be
  scoped to `<style>` blocks or a line of **JavaScript** gets swept in
  (`ev.target.closest(".btn.primary")` parses as a rule) and one syntax error
  silently voids every rule after it; a selector must be matched anywhere in
  the selector *list*, since the base button is written `nav.site a, .btn {`;
  and `.btn.danger` lives in `admin.html`, not on the company page. Pinned by
  `--check` in the suite.
- **Retired with the boum (2026-10-07)**: `design/logo_pack.py` exits rather
  than build a pack of the old mark; the logo-en kit (SVG and 4096px PNG on
  three grounds) is the delivery pack now. What it built:
  `design/logo-pack/`, the 39-file delivery pack a
  printer or a partner asks for: SVG in brown/white/black for both forms, the
  gradient tile, PNGs at three grounds, a multi-size `.ico`, and a README fixing
  clear space (height ÷ 4), the minimum sizes (wide 90px/20mm, square 16px) and
  the CMYK figure for `#6F3F1C` (0·43·75·56, computed from sRGB — ask the
  printer for a proof, it is not a colour-managed conversion). Every file is
  generated from the page's own sprite, so the pack cannot drift from the mark
  the site flies. Re-run it after any change to the logo.
- `design/logo-en/build.py` builds the **English logo kit** (owner's request,
  2026-10-07): ALMUHALLAB in Chakra Petch Bold with the striped amber fill,
  CODE between fading rules, `>_ SOFTWARE & SYSTEMS` in JetBrains Mono, as on
  the English banner. Full lockup, wordmark and the AC monogram (striped
  amber A, white C) on three grounds (`-dark`, `-for-dark`, `-for-light`), SVG
  plus 4096px (2048 square) PNG. Every letter is an outline shaped with
  HarfBuzz from the bundled OFL fonts, and each PNG is rasterised from its
  SVG; `--check` compares the SVGs as text **and re-renders every PNG** to
  compare pixels, and the suite runs it. Since the dark theme it is also the
  site's mark (see the identity table): it writes `logo.svg`, `favicon.svg`,
  the inline masthead logo, the touch icon, `logo-512.png` and `og.png`, and
  `og.png` refuses to draw if its fonts fail to load. Snapping the stripes
  for the masthead once chained, dragging both edges of a band onto one flat
  letter edge until it vanished: each edge now snaps to its nearest single
  flat edge, and a snap that changes a band by more than ±40% is refused.
  Traps a two-round review caught, all fixed and measured: a
  `<pattern>` stripe fill is resampled and leaves see-through seams inside
  the letters (use solid fill plus clipped band rects); a rounded PNG height
  letterboxes the ground and leaves the edge rows of an "opaque" PNG partly
  transparent (fit the viewBox to the rounded size, save dark tiles as
  RGB); CSS `drop-shadow(0 0 40px)` is a Gaussian of **sigma 40**, not 20
  (that is `box-shadow`); 8-bit compositing puts a ring one level *below*
  the ground in a glow's tail (floor the PNG at the ground); darkening a
  colour in HLS at constant saturation raises its chroma and swings it
  toward orange (solve in OKLCH); a wide wordmark letterboxed in a square is
  unreadable at profile-photo sizes (hence the monogram, judged in a circle
  at 150/110/44/32 px). Round two: Pillow's `getbbox()` looks **only at
  alpha** on an RGBA image, so a recoloured transparent PNG passed the
  pixel compare (compare premultiplied, `alpha_only=False`); generic SVG ids
  (`glow`, `fade-l`) collide when two files are inlined in one page, since
  `url(#id)` takes the document's first match (every id carries the file's
  name, and `--check` fails on a shared one); stripe edges a hair off a
  flat outline edge leave a sliver (bands snap to flat edges within a
  pixel, and the monogram's five bands keep the A's crossbar in amber).
- **The live HTTPS check is `design/ssl_check.py`, run from the owner's
  machine** — redirect ordering (plaintext must reach https on the *same* host
  before any www redirect, or preload is disqualified), certificate validity,
  SAN coverage of both hosts, days remaining, TLS ≥ 1.2 with 1.0/1.1 refused,
  and the HSTS value. Stdlib only. It **refuses to report over an intercepted
  connection**: its first live run from this container returned five PASSes
  about the site that were every one of them facts about the environment's TLS
  proxy — the only tell was the issuer, "Anthropic". It exits 2 for "could not
  check", never 0. `--self-test` proves the verdicts still discriminate, and
  the suite runs that self-test.
- `design/capture.py` drives the site end to end and screenshots every page;
  `design/build_pdf.py` composes those into the PDF sample;
  `design/admin_test.py` exercises the admin console.
- **Everything generated goes under `design/out/`** — the screenshots, the PDF
  sample and its page previews, the plate — never loose in `design/` beside the
  scripts, where the input could not be told from the output. The other folders
  (`film/`, `ship/`, `logo-pack/`, `instagram/`, `design-system/`, `ads/`,
  `brand/`) keep their own output beside their own source, because each is a
  self-contained project rather than a stray file. `design/out/README.md` says
  which script writes each thing.
- **A script resolves its paths from its own file**, never from an absolute
  `/home/user/wain/...`. Nine such literals across `test_suite.py`,
  `capture.py`, `admin_test.py`, `build_pdf.py`, `plate.py`, `dart_audit.py`
  and `repo_state.py` meant the suite silently tested a directory that does not
  exist on any other checkout. The same applies to paths **written into** a
  committed file: `shots/index.json` recorded one machine's layout until it was
  made repo-relative.
- **Dates in generated filings must be computed in UTC** and anchored to the
  first of the opening month. Local-midnight parsing shifts the date east of
  Greenwich, and subtracting months from a 31st overflows into the wrong month.
- **The live site is on Hostinger, not GitHub Pages** (found 2026-09-28): `almuhallab-code.com`
  is an addon domain on account `u130124229`, LiteSpeed, web root
  `domains/almuhallab-code.com/public_html` — which also holds `discs/` (a live
  subdomain), `salon-queue`, `mcp-admin`, the n8n `*-proxy.json` blueprints and
  landing-page folders this repo does not know about. **Never deploy by
  replacing the folder.** `.htaccess` there is v3 — the hand-maintained v2
  (Basic Auth on admin/nizam/editor/mcp-admin, proxy block, domain CSP) merged
  with this repo's rules; the repo copy IS v3 now and the suite pins its
  protections. `pages.yml` has never run (it triggers on `main`, which is the
  unrelated Wain app). This container cannot reach the host (egress policy);
  publishing is an hPanel upload by the owner. The note below describes the
  GitHub Pages case, should the site ever move there:
- **GitHub Pages** (`.github/workflows/pages.yml`)
  **ignores `.htaccess`** — so every header that file sets is inert in
  production: `nosniff`, `X-Frame-Options`, `Permissions-Policy`, HSTS. Only
  `Referrer-Policy` survives, because it is also a `<meta>`. `frame-ancestors`
  is ignored inside a `<meta>` CSP, so the three pages holding records carry a
  **frame-buster** instead — hide first, navigate second, because a sandboxed
  frame can block the navigation. It is a mitigation, not a fix; the fix is a
  host that reads `.htaccess`. `SECURITY.md` states this in a table.
- **A storage write that fails silently is data loss with a success message.**
  `wr()` swallowed the exception and returned nothing, so on a full quota — or
  in private browsing, where the first write throws — a holding was dropped
  while the toast said «تمت إضافة NBK». Every write now returns whether it
  happened and every caller checks before claiming success. Pinned by
  simulating a refusing `Storage.prototype.setItem`.
- **A formula guard that only knows `= + - @` is not a guard**: Excel strips a
  leading TAB before deciding what a cell is, and a CR inside a name split the
  CSV row in half and put its tail on a new line as a fresh first cell. Collapse
  CR/LF, **trim**, then test — trimming matters because a leading space only
  saves you until an importer strips whitespace. Pinned with real payloads.
- Screenshots must be **looked at**, not just asserted on — layout defects
  (orphaned tiles, wrapped values) do not fail a test.
