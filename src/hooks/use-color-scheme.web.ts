import { useEffect, useState } from 'react';
import { useColorScheme as useRNColorScheme } from 'react-native';

import type { SchemeName } from '@/constants/theme';

/**
 * Which palette this browser should use.
 *
 * To support static rendering, the value is re-calculated on the client: the
 * server has no localStorage and no media query, so the first HTML is rendered
 * against a fixed guess and corrected once the real answer is available.
 *
 * THIS FILE WAS BROKEN, in three ways that compounded — found by a typecheck on
 * 2026-09-19, not by anyone using it:
 *
 *   `setHydrated(true)` NAMED A FUNCTION THAT DOES NOT EXIST. The setter is
 *   `setHasHydrated`. It was the last statement in the effect, so every run
 *   threw a ReferenceError, `hasHydrated` never became true, and the guard
 *   below returned 'dark' for ever. The stored preference was read correctly
 *   on the line above and then thrown away — so on the app's web build the
 *   theme toggle could not work at all, and the reason was a name.
 *
 *   IT RETURNED 'dark-white', which is not a key of Colors — that palette is
 *   `darkWhite`. The hyphenated form is the website's `data-theme` value and
 *   what localStorage holds; mapping between them is this file's job, and it
 *   did the read and skipped the mapping. Colors['dark-white'] is undefined,
 *   and undefined.background is a crash on the next line.
 *
 *   THE SYSTEM-PREFERENCE BRANCH COULD NOT FIRE. It asked for a scheme that
 *   was neither 'light' nor 'dark' and then chose between 'light' and 'dark'
 *   — so the only reachable answer was 'dark', and the branch under it was
 *   doing the real work anyway.
 *
 * None of it produced an error anyone would see: a shop that is meant to
 * default to dark, stuck on dark, looks exactly like a shop that is working.
 */
export function useColorScheme(): SchemeName {
  // Dark is the shop's default — what theme-color says, what the hero art was
  // tuned against — so it is also the right thing to render before the answer
  // is known. A wrong first frame here is a flash of the wrong theme.
  const [colorScheme, setColorScheme] = useState<SchemeName>('dark');
  const [hasHydrated, setHasHydrated] = useState(false);
  const systemScheme = useRNColorScheme();

  useEffect(() => {
    // The owner's or shopper's own choice wins over the operating system's,
    // which is the whole point of having a toggle. Wrapped because Safari in
    // a private window throws on the getter rather than returning null.
    let stored: string | null = null;
    try {
      stored = localStorage.getItem('sporta_theme');
    } catch {
      /* storage blocked — the system preference decides instead */
    }

    // 'dark-white' on the wire, `darkWhite` in Colors. One map, one place.
    if (stored === 'light' || stored === 'dark') setColorScheme(stored);
    else if (stored === 'dark-white') setColorScheme('darkWhite');
    else if (systemScheme === 'light' || systemScheme === 'dark') setColorScheme(systemScheme);

    // LAST, and it must run whatever the branches above did: it is what lets
    // the value below be anything other than the pre-hydration guess.
    setHasHydrated(true);
  }, [systemScheme]);

  // Before hydration every client has to agree with the server's HTML or React
  // reports a mismatch and rerenders the tree — so this is not a default, it is
  // the only answer that is safe to give yet.
  return hasHydrated ? colorScheme : 'dark';
}
