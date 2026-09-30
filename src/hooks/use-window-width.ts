import { useEffect, useState } from 'react';
import { Dimensions, Platform } from 'react-native';

import { useHydrated } from '@/hooks/use-hydrated';

// A safe, narrow default — never read for its own sake, only to give the
// server render and the client's FIRST render the same answer. See below.
const SAFE_DEFAULT_WIDTH = 400;

/**
 * The window's real width — unlike `useWindowDimensions()`, which this
 * project measured reporting the SAME wrong width on the exported static
 * site no matter the browser's actual size, and never correcting itself.
 *
 * THREE ATTEMPTS BEFORE THIS ONE, each measured wrong in a different way:
 *
 *   1. `useWindowDimensions()` directly. Every card rendered with a NEGATIVE
 *      inline width (`width:-20px`) on a browser opened at 1440px.
 *   2. Re-reading `Dimensions.get('window')` from a `useEffect`, on the
 *      theory that mount, on web, only happens after hydration in a real
 *      window. Measured: every viewport — 390, 820, 1440 — produced the
 *      IDENTICAL wrong width. `Dimensions.get('window')` on this platform is
 *      not a live read of `window.innerWidth`; it is a value RNW's own
 *      module caches and only replaces on a 'resize' EVENT, which a page
 *      opened once at its final size and never resized will not fire.
 *      Calling `.get()` again does not re-measure anything.
 *   3. Reading `window.innerWidth` directly (bypassing Dimensions
 *      entirely) from `useState`'s lazy initialiser AND from a `useEffect`.
 *      Measured: STILL identical across every viewport, and independently
 *      confirmed `window.innerWidth` itself is correct in each page
 *      (390/1440 both read back correctly via a bare `page.evaluate`). So
 *      the browser had the right number; this component never got it. The
 *      likely cause is the same one use-hydrated.ts already documents for a
 *      different symptom: the export prerenders this page against a
 *      DIFFERENT window than the one the browser opens, the two renders
 *      disagree, and React's hydration-mismatch recovery — throw, discard,
 *      re-render the subtree — does not guarantee a component's OWN
 *      `useEffect` reruns against a fiber that survived the throw, so a
 *      value computed at prerender time can survive as "the" answer with no
 *      client effect ever correcting it.
 *
 * THE FIX IS TO NEVER HAND HYDRATION SOMETHING TO DISAGREE ABOUT. Every
 * render before `useHydrated()` flips — the server's, and the client's
 * first one — returns the SAME safe constant, exactly the pattern
 * use-hydrated.ts itself exists for. There is nothing to mismatch, so there
 * is nothing for React to discard, and the effect that reads the real
 * `window.innerWidth` runs on an ordinary, unremarkable second render
 * rather than depending on recovery from a first one that never properly
 * happened.
 *
 * NATIVE IS UNAFFECTED — there is no export step to prerender against —
 * but goes through `useHydrated()` too (permanently true on native) rather
 * than a second implementation of "how wide is the window" existing here
 * for no reason.
 */
export function useWindowWidth(): number {
  const hydrated = useHydrated();
  const [width, setWidth] = useState(SAFE_DEFAULT_WIDTH);

  useEffect(() => {
    if (!hydrated) return;

    const read = () =>
      Platform.OS === 'web' && typeof window !== 'undefined'
        ? window.innerWidth
        : Dimensions.get('window').width;

    setWidth(read());

    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      const onResize = () => setWidth(read());
      window.addEventListener('resize', onResize);
      return () => window.removeEventListener('resize', onResize);
    }
    const sub = Dimensions.addEventListener('change', () => setWidth(read()));
    return () => sub.remove();
  }, [hydrated]);

  return width;
}
