/**
 * The colours this screen should paint with.
 *
 * Learn more about light and dark modes:
 * https://docs.expo.dev/guides/color-schemes/
 *
 * It is no longer a plain lookup in Colors. The owner picks the shop's brand,
 * header, tab bar and secondary colours in /backends, and lib/server-theme.tsx
 * lays those over the compiled palette — so this hook is the one place that
 * knows both. A screen reading Colors directly gets the built values and
 * quietly ignores the owner, which is exactly what app-tabs.tsx used to do.
 */

import { useColorScheme } from '@/hooks/use-color-scheme';
import { useServerPalette, type Palette } from '@/lib/server-theme';

export function useTheme(): Palette {
  // Straight through: use-color-scheme narrows to a palette key on both
  // platforms, so there is nothing left to decide here. It used to decide,
  // and a second opinion about what `null` means is how two files end up
  // disagreeing about the theme for the first frames after hydration.
  return useServerPalette(useColorScheme());
}
