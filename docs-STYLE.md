# The style system

Native, not CSS: React Native has no cascade, no selectors and no inheritance,
so "the stylesheet" here is a set of tokens and a set of components that consume
them. Nothing in the app should invent a colour, a radius or a press opacity.

## Tokens — `src/constants/theme.ts`

| Token | What it is |
|---|---|
| `Colors.light` / `Colors.dark` | Every surface and every foreground, per theme |
| `Radius` | `chip` 999, `control` 8, `card` 16, `panel` 24 — named for what they are on |
| `Spacing` | `half` 2 … `six` 64 |
| `Opacity` | `pressed`, `pressedSubtle`, `disabled` |
| `TapTarget` | 48. Every pressable is sized against this, not against its text |
| `MaxContentWidth` | 800 — where a column stops widening |
| `EMBER_ON_INK` | The brand orange measured for a charcoal panel, in both themes |
| `Type` | The type scale: roles, not sizes — `display`, `title`, `heading`, `body`, `bodyBold`, `label`, `labelBold`, `caption`, `price` |
| `FONT_FILES` | The four typefaces the app loads at startup |

Colour rules that are not obvious:

- **`tint` is for fills, `tintText` is for text.** The brand orange as small text
  measures 4.28:1 on the page and 4.20:1 on its own soft tint; `tintText` is the
  same hue one step darker and clears AA. Buttons, chips and badges keep `tint`.
- **The page is grey and cards are white**, so a card separates without a shadow.
  There are no shadows in this app.
- **`silver` / `silverSoft`, not sand.** The warm pair was the last beige in the
  app — a brown notice on a beige panel, on a neutral grey page, which read as a
  stain rather than a surface. Besides the ember, this palette is neutral.
- `npm run test:contrast` measures every pair in both themes, plus that a card is
  distinguishable from the page. It needs no browser.

## Type

Roles, not sizes. A screen asks for a `title`; it does not ask for 24/32 bold.
Before the scale there were eight loosely named text types and twelve screens
overriding them inline — 22, 24, 26, 28, 30, 32 — so "a screen's title" was four
different sizes depending which screen you were on.

**Arabic gets its own leading, and that is not a preference.** Arabic carries
marks above the letters and descenders below; at the line height that suits
Latin they collide, and a dotted qaf lands on the line above. Every role has
`line` and `lineAr`, and `ThemedText` picks by language.

## Fonts

The same pair the website uses, so a customer who has seen one does not meet
different letterforms in the other:

- **Alexandria** — display, headings
- **IBM Plex Sans Arabic** — everything else, at 400/600/700

They are built from the storefront's own webfonts by `scripts/build-fonts.py`,
not copied: the site ships `.woff2`, which expo-font cannot load, and its files
are subset per script. React Native has no font-family fallback chain, so an
Arabic subset with no Latin renders every English word as tofu. The script
decompresses each weight and merges its two subsets back into one face. The
variable weight has to be pinned first — two variable fonts cannot be merged.

`app/_layout.tsx` holds the splash screen until they are in memory, so the first
frame is not painted in the system face and then reflowed.

Emoji and the arrow glyph stay on the system font deliberately: no text face
carries them, and forcing one renders tofu. `npm run test:shop` asserts that
everything else is painted in Plex or Alexandria — it fails if a font silently
fails to register.

## Components — `src/components/ui/`

| Component | Replaces |
|---|---|
| `Screen` | `safeArea` + `scroll` + `content` in 8 files, three of which forgot the bottom-tab inset |
| `Button` | Four hand-built `primary`/`primaryText` pairs, each with a different part right |
| `Chip` | Three selectable pills, only one of which was tappable |
| `Card` | The bordered white surface |
| `Field` | Label + input + error; one copy had no `placeholderTextColor`, one no accessibility label |
| `press()` | Fifteen local `pressed: { opacity }` styles with three different values |

`ThemedText` and `ThemedView` sit under all of it and are the only places that
read the palette directly.

## What stays local

Layout. A screen's own grid, its column widths, where its hero sits — those are
that screen's business and belong in its own `StyleSheet.create`. The system
covers what must be consistent to be correct: tap size, contrast, radius, press
feedback, and the frame a screen sits in.

## Web

`src/global.css` carries four font-family variables and nothing else. The web
build is React Native Web — the same components, the same tokens — so there is
no second stylesheet to keep in step.
