import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { Colors, type SchemeName } from '@/constants/theme';
import { API_BASE } from '@/lib/config';
import { KEYS, readJson, writeJson } from '@/lib/storage';

/**
 * The owner's colours, fetched from the shop rather than compiled into the app.
 *
 * WHY THIS EXISTS. Until now every colour in this app was a literal in
 * constants/theme.ts, so the theme editor in /backends recoloured the website
 * and the phone app went on being orange. The two halves of one shop could
 * disagree about the brand and nothing anywhere would say so — the same
 * app-versus-website drift this project has already recorded four times for
 * whole SCREENS, happening here to the palette.
 *
 * FIVE FIELDS, NOT THE WHOLE THEME. `radius`, `space`, the fonts and the custom
 * CSS are all web concepts: the app's corners are Radius, its rhythm is Spacing,
 * its faces are bundled .ttf files, and arbitrary CSS means nothing to a native
 * view. Only the colours cross over, so only the colours are read here.
 *
 * IT FAILS TO THE BUILT PALETTE, ALWAYS. No network, a slow shop, a malformed
 * value, storage blocked in a private browser — every one of those paths ends
 * with `null` and the compiled colour standing. assets/theme.js states the same
 * rule for the website in one line: no theme is the built theme, never a broken
 * page. An app that cannot start because a colour did not load would be a far
 * worse feature than one that is briefly the wrong orange.
 *
 * DARK-WHITE IS DELIBERATELY UNTOUCHED, and that is in applyServerTheme below
 * rather than here: that theme exists to be colourless, so a brand tint reaching
 * into it would defeat the one thing it is for.
 */

export interface ServerTheme {
  /** #rrggbb, or null for "leave the built palette alone". */
  brand: string | null;
  headerBg: string | null;
  tabBar: string | null;
  tabBarActive: string | null;
  secondaryBg: string | null;
}

export const NO_SERVER_THEME: ServerTheme = {
  brand: null,
  headerBg: null,
  tabBar: null,
  tabBarActive: null,
  secondaryBg: null,
};

/**
 * #rrggbb, or null.
 *
 * As strict as assets/theme.js's own reader and for the same reason: a value
 * this cannot interpret is a value it must not paint with. The server already
 * refuses anything but a six-digit hex on save — this is the second of two
 * guards, not the only one, because the cache on the device is writable by
 * anyone who can open a browser's developer tools.
 */
const hex6 = (v: unknown): string | null => {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(v ?? '').trim());
  return m ? `#${m[1]}` : null;
};

const isHexOrNull = (v: unknown): v is string | null =>
  v === null || (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v));

/** storage.ts requires a real guard rather than a cast, and this is why: the
 *  cached value survives app upgrades and can be anything at all. */
const isServerTheme = (v: unknown): v is ServerTheme => {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    isHexOrNull(o.brand) &&
    isHexOrNull(o.headerBg) &&
    isHexOrNull(o.tabBar) &&
    isHexOrNull(o.tabBarActive) &&
    isHexOrNull(o.secondaryBg)
  );
};

/** The server's snake_case, which is the shape api.php?r=theme actually
 *  returns — not the camelCase the panel's own ThemeSettings uses. Reading the
 *  public route means this needs no session and works before anyone signs in,
 *  which is the point: a shopper never signs in at all. */
const fromWire = (raw: Record<string, unknown>): ServerTheme => ({
  brand: hex6(raw.brand),
  headerBg: hex6(raw.header_bg),
  tabBar: hex6(raw.tabbar_bg),
  tabBarActive: hex6(raw.tabbar_active),
  secondaryBg: hex6(raw.secondary_bg),
});

const Ctx = createContext<ServerTheme>(NO_SERVER_THEME);

export function ServerThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<ServerTheme>(NO_SERVER_THEME);

  useEffect(() => {
    let alive = true;

    // The cache first, so a returning visit paints the owner's colours in the
    // first frame rather than showing the compiled ones and correcting itself.
    // It only ever fills an EMPTY slot: if the network answered first, that
    // answer is newer and the cache must not overwrite it.
    void readJson<ServerTheme>(KEYS.theme, isServerTheme, NO_SERVER_THEME).then((cached) => {
      if (alive) setTheme((current) => (current === NO_SERVER_THEME ? cached : current));
    });

    fetch(`${API_BASE}/api.php?r=theme`, { headers: { Accept: 'application/json' } })
      .then((r) => (r.ok ? (r.json() as Promise<unknown>) : null))
      .then((body) => {
        if (!alive || typeof body !== 'object' || body === null) return;
        const next = fromWire(body as Record<string, unknown>);
        setTheme(next);
        void writeJson(KEYS.theme, next);
      })
      .catch(() => {
        /* No theme is the built theme. Never a broken app. */
      });

    return () => {
      alive = false;
    };
  }, []);

  return <Ctx.Provider value={theme}>{children}</Ctx.Provider>;
}

export const useServerTheme = () => useContext(Ctx);

/* ---------------------------------------------------------- the derived pair */

const toHsl = (hex: string): [number, number, number] | null => {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return null;
  const n = parseInt(m[1], 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  const d = mx - mn;
  const l = (mx + mn) / 2;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  let h = 0;
  if (d !== 0) {
    if (mx === r) h = ((g - b) / d) % 6;
    else if (mx === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h = h * 60;
    if (h < 0) h += 360;
  }
  return [h, s * 100, l * 100];
};

const toHex = (h: number, s: number, l: number): string => {
  const hh = ((h % 360) + 360) % 360;
  const ss = Math.min(100, Math.max(0, s)) / 100;
  const ll = Math.min(100, Math.max(0, l)) / 100;
  const c = (1 - Math.abs(2 * ll - 1)) * ss;
  const x = c * (1 - Math.abs(((hh / 60) % 2) - 1));
  const m = ll - c / 2;
  const v =
    hh < 60 ? [c, x, 0] : hh < 120 ? [x, c, 0] : hh < 180 ? [0, c, x]
    : hh < 240 ? [0, x, c] : hh < 300 ? [x, 0, c] : [c, 0, x];
  return '#' + v.map((u) => `0${Math.round((u + m) * 255).toString(16)}`.slice(-2)).join('');
};

/**
 * The brand, one step darker, for TEXT on a light ground.
 *
 * THE SAME DELTAS assets/theme.js USES for --brand-dark — H +0.7, S +7.1,
 * L -10.4, measured between the shop's own shipped #E0561C and #B8430F rather
 * than chosen here. Two homes for one derivation is how the app and the website
 * end up a shade apart from the same picked colour, which is exactly the drift
 * this whole file exists to close.
 *
 * WHY IT IS NEEDED AT ALL: the light palette's `tintText` is deliberately
 * darker than its `tint` — the fill colour measured 4.28:1 as small text and
 * failed AA, and the note in constants/theme.ts records it. Taking the owner's
 * brand straight into both would silently reintroduce exactly that failure at
 * whatever colour they picked.
 */
const darken = (hex: string): string => {
  const c = toHsl(hex);
  if (!c) return hex;
  return toHex(c[0] + 0.7, c[1] + 7.1, c[2] - 10.4);
};

/**
 * One palette's worth of colours.
 *
 * The values are `string`, not the literal types `as const` gives Colors — the
 * moment the owner can change a colour, "this is exactly #c8490f" stops being
 * true and a type that still claims it is lying. The KEYS stay exact, which is
 * the half that catches a typo.
 */
export type Palette = { [K in keyof typeof Colors.light]: string };

/**
 * The compiled palette with the owner's colours over it.
 *
 * Returns the base object UNCHANGED when nothing is set, which is not only an
 * optimisation: useTheme() memoises on the result, and handing back a fresh
 * object every render would re-render every themed view in the app on every
 * tick — for a shop that had never opened the colour picker.
 */
export function applyServerTheme(base: Palette, s: ServerTheme, scheme: SchemeName): Palette {
  // dark-white is colourless on purpose. See the file header.
  if (scheme === 'darkWhite') return base;
  if (!s.brand && !s.headerBg && !s.tabBar && !s.tabBarActive && !s.secondaryBg) return base;

  return {
    ...base,
    // On the dark ground the brand IS the light thing, so it is its own text
    // colour — which is what the built dark palette already does. On light it
    // has to step down or it fails as text.
    ...(s.brand ? { tint: s.brand, tintText: scheme === 'dark' ? s.brand : darken(s.brand) } : null),
    ...(s.headerBg ? { inkSilver: s.headerBg } : null),
    ...(s.tabBar ? { tabBar: s.tabBar } : null),
    ...(s.tabBarActive ? { tabBarActive: s.tabBarActive } : null),
    ...(s.secondaryBg ? { silver: s.secondaryBg } : null),
  };
}

/** The palette for a scheme, with the owner's colours already over it. The one
 *  place both useTheme() and app-tabs.tsx go through, so a screen cannot read
 *  the compiled palette by accident — which is precisely how app-tabs came to
 *  be importing useColorScheme from react-native directly. */
export function useServerPalette(scheme: SchemeName): Palette {
  const server = useServerTheme();
  return useMemo(() => applyServerTheme(Colors[scheme], server, scheme), [server, scheme]);
}
