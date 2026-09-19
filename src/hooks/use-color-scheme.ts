import { useColorScheme as useRNColorScheme } from 'react-native';

import type { SchemeName } from '@/constants/theme';

/**
 * Which palette this device should use.
 *
 * NATIVE. The web twin beside this file reads a stored choice and can also
 * answer `darkWhite`; there is no such choice here, because dark-white is a
 * website theme selected by a `data-theme` attribute and nothing in the native
 * app sets one.
 *
 * IT RETURNS A PALETTE KEY, not React Native's ColorSchemeName. That type
 * includes `null` and `'unspecified'`, and both of them index Colors to
 * `undefined` — a crash one property access later, in a hook every themed view
 * in the app calls. Narrowing here rather than at each call site is what stops
 * the next screen re-deciding what `null` means; app-tabs.tsx had already made
 * its own choice, which is how it came to paint a light tab bar under a dark
 * app.
 */
export function useColorScheme(): SchemeName {
  return useRNColorScheme() === 'dark' ? 'dark' : 'light';
}
