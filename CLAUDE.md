# Project notes

## Design preferences

- **No beige.** Never use beige, cream, sand-tinted or warm "paper" tones for
  backgrounds and surfaces. Use **white** for the page and cards, with
  near-neutral cool greys for recessed surfaces (inputs, hover) and borders.
  This applies to the website, the app, and any generated document or mockup.
  The brand amber (`--sand-vivid`, used in the logo gradient and for warning
  accents) and the brand **brown** (`--tint` / `--tint-strong`, the primary
  accent since the identity change) are deliberate inks on white surfaces and
  are not affected by this rule — it governs backgrounds and surfaces only.

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
| Mark | a **Kuwaiti boum under sail**, in two forms of one drawing (redrawn 2026-08-12 at the owner's word, after an independent review found the previous mark was a generic dhow with bare poles). Four things make her a boum and none may change: she is **double-ended** — a raked pointed sternpost aft and a **tall, near-straight raked stem** forward, both continuous with the hull as one filled path, **never a transom** (a transom makes her a baghlah); she carries **filled lateen sails**, peak high aft and tack low forward — bare poles read as a laid-up hull, and the sail is the only mass that survives small; the **tall mainmast is forward** and the short mizzen aft; and the sheer rises into both ends. The **wide form** (2:1, `logo.svg` and `#i-boum`) is the mark wherever width allows — masthead and print. The **square form** (`favicon.svg`, `#i-sail`) is that same drawing cropped to one hull, one stem, one mast and one sail at heavier weights, because 16px is its real working size. Stroke weight is **two steps, not seven**: masts 1.0, everything else 0.6 (square: 1.3 / 0.8). Masts stop at their sail's luff with butt caps. **No stays, no pennant, no hawse hole** — hairlines die first, a pennant on a bare masthead read as a bird's head, and the hawse read as an eye, which put a whale on the masthead bar. The suite pins both forms' path signatures, and `design/logo_pack.py` generates the whole delivery pack from the sprite so nothing can drift |
| Wordmark | **المهلب**, then `Almuhallab Code` on its own line beneath (LTR in its own bidi isolate), then «شركة برمجة وأنظمة». On the brown bar all three are white. Enlarging the lockup covers more of the page, so `scroll-margin-top` moved with it — 178px desktop, 152px phone |
| Brand ink | `--tint` `#7a4418` · `--tint-strong` `#6f3f1c` |
| Surfaces | **white on every device** — no dark theme; white page, white cards, cool near-neutral greys. Brown is ink, never paper — with one exception the owner asked for (2026-07-31): the **masthead bar is brown** (`--tint-strong`) with white ink on every page, and `theme-color` matches it. Everything below the bar stays white |
| Icons | the drawn `<symbol>` sprite — no emoji anywhere on the public page |
| Layout | full-height hero with real counters · **slide rails** (scroll-snap sliders with arrows + dots — the card grids became sliders at the owner's request, 2026-07-30) · the automation `ol.flow` · wide `.product` rows · commitments `.band` · `ol.steps` as a slider timeline · the technology cloud · the WhatsApp project form · «ما نبنيه لعملك» offers rail · contact channels as a bar · the four-column footer on a recessed grey base |
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
  eye. Text ≥ 4.5:1 (body ≥ 7:1) against the darkest surface it can land on;
  essential UI boundaries ≥ 3:1; chart marks ≥ 2:1.
- **The company's real identity, from the live site**: the mark is a Kuwaiti
  boum under sail — wide form in `logo.svg`/`#i-boum` (masthead), square form in
  `favicon.svg`/`#i-sail` (footer, tab) — the
  wordmark is **المهلب** in brand brown, and the palette is brown on white.
  النوخذة keeps the ⚓ anchor (`icon.svg`) — the company and the product are
  marked differently on purpose.
- Contact channels are the real ones and must not be replaced with placeholders:
  واتساب `+965 6589 4110` · انستغرام `@almuhallab.code` · البريد
  `hello@almuhallab-code.com`.
- Arabic is set in bundled **Cairo** (SIL OFL, `almuhallab/fonts/`, Arabic
  subset, weights 400/500/700/800 — 500 also serves the 600 slot; 54 KB).
  Chosen at the owner's request for a modern face (2026-08-01) by rendering
  Cairo, Almarai, Readex Pro, Alexandria and IBM Plex Sans Arabic side by side
  in the page's own copy and looking at them. Plex is ruled out — that is the
  face the owner rejected when asking for a better Arabic font. Never link a
  webfont CDN — the CSP blocks it. Any new page must declare the five
  `@font-face` rules, carry `font-src 'self'`, and be precached. Arabic set in
  Cairo needs `line-height` ≥ 1.35 on display sizes, or a damma collides with
  the line above.
- **There is no dark theme.** The site is white whatever the device prefers:
  no `prefers-color-scheme: dark` block anywhere and `color-scheme: light` on
  `:root`. `theme-color` is the masthead brown `#6f3f1c` on every page so the
  browser chrome continues the bar — that is not a dark theme, and the page
  below the bar stays white. The suite fails if a dark override reappears.
- **The masthead is a sticky brown bar on all four pages** (owner's request,
  2026-07-31): the company page centres the mark above the wordmark and
  shrinks the bar once scrolled (two thresholds — 60px down, 24px up — or a
  bar that changes the page's height retriggers itself forever); the app
  screens keep their row layout so nav and tabs stay in reach. On brown the
  ink inverts: white links, a **white pill** for the one call to action, and
  outlined white for logout — the brand red measures **1.6:1** on this brown
  and must never appear there. Set `color:#fff` on `.brand` itself, not only
  on its children: two pages shipped a dark wordmark because their markup was
  a `<div>`/`<span>` the colour rule never named. The suite measures every
  masthead label on every page.
- The **footer is the site's map**, not a copyright line: four columns (the
  company and its channels written out in full · الشركة · الخدمات · النوخذة's
  units), on the one recessed grey surface, opened by the brand hairline. Do
  not put an icon-only channel row beside the written one — it repeats the
  same three links while hiding the values.
- **A sticky bar hides whatever an in-page link jumps to.** Every anchor
  target carries `scroll-margin-top` (178px desktop, 152px phone, clearing the
  compact bar's 130px) and `html` uses `scroll-behavior: smooth`, off under
  reduced motion. Tests that measure scroll positions must pass
  `behavior:'instant'` or they race the animation and read mid-flight values.
- **المهلب is the company; النوخذة is النظام الموحد it built and runs.** The
  masthead says «شركة برمجة وأنظمة», and the system is named «النوخذة — النظام
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
- **«ما نبنيه لعملك» is drawn, not written** (owner's request, 2026-08-01:
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
  arrows hide and the thumb does the work. "لماذا" is a `.band` of three
  `.fact`s, "كيف نعمل" a numbered timeline, the channels one bar of pills.
- Icons on the public site are a **drawn inline-SVG set** (`<symbol>` + `<use>`),
  not emoji: emoji are a different typeface, weight and colour on every platform.
  Three service icons (automation gear, AI-agent spark, design pen) are inlined
  rather than `<use>`-referenced so their parts can animate — spin, pulse and
  stroke-draw, all stopped by `prefers-reduced-motion`.
  النوخذة's own screens still use emoji in tab labels.
- Charts are hand-built inline SVG — the strict CSP forbids any chart library.
  Colour follows the encoding job: ordinal one-hue ramps where order carries
  meaning, a diverging pair for profit/loss where the sign is *also* shown by
  bar direction and a signed label.
- Data lives in `localStorage` under `nokhatha-*` keys (the admin console's own
  four are `almuhallab-admin-*`). Treat it as untrusted input on read: escape all
  rendered strings, re-coerce and **clamp every index** — a stored `plan` from a
  retired tier once crashed the dashboard because `PLANS[plan]` was undefined.
- Numbers are formatted with an **explicit `"en-US"` locale**. A bare
  `toLocaleString()` follows the visitor's device and printed Arabic-Indic digits
  beside Latin ones in the same table.
- `favicon.svg` (the company boum) is the tab icon for `index.html`; `icon.svg`
  (the ⚓ anchor) is النوخذة's. Don't cross them.
- The units print: `nizam.html` carries an `@media print` block that strips the
  chrome, forms and row actions so a statement prints as a document.

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
- `python3 design/test_suite.py` is the full system test — 590 checks covering
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
  WebSite · SoftwareApplication). The share card `og.png` is **drawn from the
  page's own sprite** by `design/og_image.py`, so it cannot drift from the mark
  — re-run it after any change to the logo. The structured data states only
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
- `design/instagram_covers.py` draws the whole Instagram set from the page
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
  web container). Three traps, all hit while building it: extraction must be
  scoped to `<style>` blocks or a line of **JavaScript** gets swept in
  (`ev.target.closest(".btn.primary")` parses as a rule) and one syntax error
  silently voids every rule after it; a selector must be matched anywhere in
  the selector *list*, since the base button is written `nav.site a, .btn {`;
  and `.btn.danger` lives in `admin.html`, not on the company page. Pinned by
  `--check` in the suite.
- `design/logo_pack.py` builds `design/logo-pack/` — the 39-file delivery pack a
  printer or a partner asks for: SVG in brown/white/black for both forms, the
  gradient tile, PNGs at three grounds, a multi-size `.ico`, and a README fixing
  clear space (height ÷ 4), the minimum sizes (wide 90px/20mm, square 16px) and
  the CMYK figure for `#6F3F1C` (0·43·75·56, computed from sRGB — ask the
  printer for a proof, it is not a colour-managed conversion). Every file is
  generated from the page's own sprite, so the pack cannot drift from the mark
  the site flies. Re-run it after any change to the logo.
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
- **Dates in generated filings must be computed in UTC** and anchored to the
  first of the opening month. Local-midnight parsing shifts the date east of
  Greenwich, and subtracting months from a 31st overflows into the wrong month.
- **The site deploys to GitHub Pages** (`.github/workflows/pages.yml`), which
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
