/**
 * Sporta theme — brand ember on charcoal, in light and dark mode.
 *
 * The dark surfaces are not free choices. #2B3138 (ink.silver) and #363D45
 * (ink.steel) are the two greys the web storefront measured for WCAG AA behind
 * white text, and they are repeated here so a customer who uses both does not
 * meet two different shops. Same for the ember pair: #E0561C is the brand
 * orange, #FF7B17 the lift used on dark ground where the darker orange loses
 * contrast.
 */

import '@/global.css';

import { Platform } from 'react-native';

export const Colors = {
  light: {
    text: '#14161a',
    // THE PAGE IS GREY AND THE CARDS ARE WHITE, which is the way round this
    // was not. A white page with warm off-white cards leaves nothing between
    // them but a hairline border: the cards do not read as cards, they read as
    // slightly discoloured page. Grey behind, white in front, and every card,
    // tile and bar in the app separates from its background without a single
    // shadow — which is what keeps it flat and modern rather than skeuomorphic.
    //
    // Neutral grey, not the warm one it replaces. #f5f2ee has a yellow cast
    // that fought the ember on every screen; this is the same lightness with
    // the cast taken out.
    background: '#f2f3f5',
    backgroundElement: '#ffffff',
    backgroundSelected: '#fdeee4',
    textSecondary: '#5c6570',
    tint: '#c8490f',
    // THE SAME EMBER, DARKENED, FOR TEXT ONLY.
    //
    // Fills keep `tint` exactly as it is — every button, chip and badge in the
    // app is the brand orange and stays the brand orange. But the same colour
    // as small TEXT was 4.28:1 on the new grey page and 4.20:1 on its own soft
    // tint (which is what every selected filter chip and size button is), and
    // both are under AA. The second of those was already failing before the
    // page changed colour; it just had nothing measuring it.
    //
    // One step darker on the same hue clears both — 4.95 on the page, 4.85 on
    // tintSoft, 5.49 on a card — without touching a single filled surface.
    tintText: '#b8420d',
    tintSoft: '#fdeee4',
    // SILVER, NOT SAND. The warm pair was the last beige left in the app —
    // a brown notice on a beige panel, sitting on a neutral grey page, which
    // read as a stain rather than as a surface. Slate on light silver instead:
    // it belongs to the same neutral family as the page and the borders, and
    // it is the only tone besides the ember that this palette needs.
    silver: '#55606b',
    silverSoft: '#e6eaee',
    // Follows the surfaces neutral. A warm border on a neutral grey page is
    // the one place the old cast would still have shown.
    border: '#e2e4e8',
    // THE EDGE OF A CONTROL, WHICH IS NOT THE EDGE OF A BOX.
    //
    // `border` above is 1.15:1 on the page. That is right for a seam — a card
    // against the page, a rule between rows — where the job is to suggest a
    // division without drawing a line anyone looks at.
    //
    // It is wrong for the edge of a text field, because that edge is the only
    // thing telling a customer where to type. WCAG 1.4.11 asks 3:1 of anything
    // marking out a control, and docs-STYLE.md recorded this as measured and
    // deliberately left alone, with the fix already specified: one more token,
    // used only on interactive outlines, rather than darkening `border` and
    // thickening every seam in the app.
    //
    // This is that token. #818b96 is the LIGHTEST grey that clears 3:1 on both
    // surfaces a control can sit on — 3.12:1 on the page and 3.46:1 on a card
    // — so it does the job with the least change to how the app looks.
    controlBorder: '#818b96',
    ink: '#14161a',
    inkSilver: '#2b3138',
    inkSteel: '#363d45',
    onInk: '#ffffff',
    // WHAT GOES ON A TINT FILL. White measures 4.76:1 on the light ember and
    // passes; on the dark mode's brighter ember it measures 2.59:1 and does
    // not — so this is a token rather than a '#ffffff' repeated in fifteen
    // files, each of which would have to be found and reasoned about again.
    onTint: '#ffffff',
    success: '#1c7a4a',
    danger: '#b3261e',
  },
  dark: {
    text: '#f6f4f1',
    background: '#14161a',
    backgroundElement: '#2b3138',
    backgroundSelected: '#3a2417',
    textSecondary: '#a8b0b9',
    tint: '#ff7b17',
    // Dark mode needs no darkening: the ember is already the light thing on a
    // dark ground, and measures 6.9:1 on the page.
    tintText: '#ff7b17',
    tintSoft: '#3a2417',
    silver: '#b3bcc6',
    silverSoft: '#232a31',
    border: '#363d45',
    // The same reasoning as the light theme's, and the same measurement.
    // #6b7683 is 3.92:1 on the page, 3.66:1 on a card and 3.14:1 on the raised
    // surfaces — over the line on all three, which the old #363d45 was not on
    // any of them at 1.65:1.
    controlBorder: '#6b7683',
    ink: '#0d0f12',
    inkSilver: '#2b3138',
    inkSteel: '#363d45',
    // INK, NOT WHITE. The dark mode's ember is the LIGHT thing on this page —
    // that is the whole reason it is brighter than the light mode's — so white
    // text on it is light on light: 2.59:1, measured on the home page's Shop
    // now button, which is the app's most prominent control. The page's own
    // near-black gives 6.98:1 on the same fill.
    onTint: '#14161a',
    onInk: '#ffffff',
    success: '#5cc98d',
    danger: '#ff8a80',
  },
} as const;

export type ThemeColor = keyof typeof Colors.light & keyof typeof Colors.dark;

/**
 * THE TYPE SCALE. Roles, not sizes.
 *
 * Before this there were eight loosely named text "types" and then twelve
 * screens overriding them inline — fontSize 22, 24, 26, 28, 30, 32 — so the
 * same thing (a screen's title) was four different sizes depending which screen
 * it was on, and changing "how big is a title" meant finding all four.
 *
 * ARABIC NEEDS MORE LEADING, and this is not a preference. Arabic letterforms
 * carry marks above and descenders below the baseline; at the line height that
 * suits Latin they collide, and a dotted qaf lands on the line above. Every
 * role therefore has two line heights, and ThemedText picks by language.
 *
 * `family` names a file loaded in app/_layout.tsx. Alexandria is the display
 * face, IBM Plex Sans Arabic everything else — the same pair the website uses,
 * so a customer who has seen one does not meet different letterforms in the
 * other.
 */
/**
 * The ember on a charcoal panel.
 *
 * Neither theme's `tint` is right here: a dark panel is dark in both light and
 * dark mode, so the colour on it cannot come from the mode. The light-mode
 * ember is too dark against #2B3138 (2.4:1) and the raw brand orange too loud;
 * this is the one measured for this ground — 4.62:1.
 */
export const EMBER_ON_INK = '#e2803f';

/**
 * The ember for a fill that sits ON THE ARTWORK — the category tiles' badge
 * and their arrow chip — where white text rides on top of it.
 *
 * Fixed rather than themed, because the artwork is dark in both schemes and
 * the tile does not change with the page. It was '#e0561c', hand-written
 * twice, and white on that measures 3.81:1 — under AA for the 14pt bold it
 * carries. This is the brand ember the light mode already uses, where the
 * same white measures 4.76:1.
 */
export const EMBER_ON_ART = '#c8490f';

/**
 * ONE TYPEFACE, THREE WEIGHTS. Alexandria carries the whole app.
 *
 * It used to be Alexandria for the two display roles and IBM Plex Sans Arabic
 * for the other seven — two families, four files, and a change of letterform
 * halfway down every screen between a heading and the line under it.
 *
 * Alexandria is drawn for Arabic and Latin together, which is the thing that
 * matters in a bilingual shop: the two scripts share a weight, a rhythm and a
 * cap height rather than being two typefaces stitched at the language switch.
 *
 * The Arabic line heights stay TALLER than the Latin ones, per role. That is
 * not a hedge — Arabic ascenders and descenders reach further, and a line box
 * sized for Latin clips them.
 */
export const Type = {
  display: { size: 30, line: 38, lineAr: 46, family: 'Alexandria-700', weight: '700' },
  title: { size: 24, line: 32, lineAr: 40, family: 'Alexandria-700', weight: '700' },
  heading: { size: 17, line: 24, lineAr: 30, family: 'Alexandria-700', weight: '700' },
  body: { size: 16, line: 24, lineAr: 30, family: 'Alexandria-400', weight: '400' },
  bodyBold: { size: 16, line: 24, lineAr: 30, family: 'Alexandria-600', weight: '600' },
  label: { size: 14, line: 20, lineAr: 26, family: 'Alexandria-400', weight: '400' },
  labelBold: { size: 14, line: 20, lineAr: 26, family: 'Alexandria-600', weight: '600' },
  caption: { size: 12, line: 16, lineAr: 22, family: 'Alexandria-400', weight: '400' },
  price: { size: 20, line: 28, lineAr: 34, family: 'Alexandria-700', weight: '700' },
} as const;

export type TypeRole = keyof typeof Type;

/** Every font file the app loads, by the family name the scale refers to. */
export const FONT_FILES = {
  'Alexandria-400': require('@/assets/fonts/Alexandria-400.ttf'),
  'Alexandria-600': require('@/assets/fonts/Alexandria-600.ttf'),
  'Alexandria-700': require('@/assets/fonts/Alexandria-700.ttf'),
};

export const Fonts = Platform.select({
  ios: {
    sans: 'system-ui',
    serif: 'ui-serif',
    rounded: 'ui-rounded',
    mono: 'ui-monospace',
  },
  default: {
    sans: 'normal',
    serif: 'serif',
    rounded: 'normal',
    mono: 'monospace',
  },
  web: {
    sans: 'var(--font-display)',
    serif: 'var(--font-serif)',
    rounded: 'var(--font-rounded)',
    mono: 'var(--font-mono)',
  },
});

/**
 * Corner radii. Named for what they are on, not for their size, so a change of
 * mind about "how round is a card" is one edit rather than a search for 16.
 */
export const Radius = {
  chip: 999,
  /** A BLOCK: a card, a list row, a panel, a tile. 24 everywhere, which is
   *  the home page's number — its hero and its category tiles were the only
   *  things in the app rounded that far, and every other screen was at 16.
   *  Two radii on two halves of the same app is not a style, it is a seam. */
  card: 24,
  /** A BUTTON is not a block. At 48pt tall a 24 radius is a pill, and the
   *  home page's own Shop now button is 16 — so 16 it is, everywhere.
   *
   *  This covers everything a customer presses or types into: buttons, size
   *  pills, text fields, the quantity stepper, the panel's save. There were
   *  three different numbers across those before (8, 16 and a couple of
   *  hand-written ones), which is how the same control ends up looking like
   *  two different controls on two screens. */
  button: 16,
} as const;

/**
 * ELEVATION. A block lifted off the page instead of outlined on it.
 *
 * This reverses what this app did before — a 1px hairline round everything
 * and no shadow anywhere — for the shop's product cards and for the cart,
 * checkout and order blocks. The owner asked for it; the category tiles and
 * the admin panel keep their borders, so the two live side by side and the
 * difference is deliberate rather than drift.
 *
 * Three ways of saying the same thing, because the three platforms each want
 * their own and RN maps none of them onto the others:
 *
 *   shadow*   iOS, and react-native-web turns it into a CSS box-shadow.
 *   elevation Android, which draws its own shape from a single number and
 *             ignores colour, offset and radius entirely.
 *
 * The offset is DOWNWARD ONLY and the opacity is low. A shadow that spreads
 * evenly in all directions reads as a glow; what makes a card look lifted is
 * light coming from above, which is one direction.
 */
export const Elevation = {
  /** A card in a grid, a line in a list. Barely there, on purpose. */
  card: {
    shadowColor: '#0b0e12',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 2,
  },
  /** A bar that sits ABOVE the page rather than in it: the cart's totals, the
   *  checkout's Pay bar. Higher, because it has to read as being in front of
   *  content that scrolls under it. */
  bar: {
    shadowColor: '#0b0e12',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 12,
  },
} as const;

/**
 * What a press looks like. Fifteen files had their own `pressed: { opacity }`
 * and three different values between them.
 */
export const Opacity = {
  pressed: 0.85,
  pressedSubtle: 0.7,
  disabled: 0.4,
} as const;

export const Spacing = {
  half: 2,
  one: 4,
  two: 8,
  three: 16,
  four: 24,
  five: 32,
  six: 64,
} as const;

/**
 * Minimum tap target. 44 is Apple's number and Android's is 48dp; every
 * pressable in this app is sized against this rather than against its text.
 */
export const TapTarget = 48;

export const BottomTabInset = Platform.select({ ios: 50, android: 80 }) ?? 0;
export const MaxContentWidth = 800;
