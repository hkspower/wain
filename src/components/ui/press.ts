import type { StyleProp, ViewStyle } from 'react-native';

import { Opacity, Scale } from '@/constants/theme';

/**
 * The press feedback, in one place.
 *
 * Fifteen files declared their own `pressed: { opacity: … }` and disagreed on
 * the number — 0.85 in some, 0.7 in others, 0.6 in one — so the same tap felt
 * different depending on which screen it landed on.
 *
 *   style={press()}                 // the default, for cards and buttons
 *   style={press(true)}             // stronger, for small chips and text links
 *   style={press(false, styles.x)}  // with the element's own style
 *
 * SCALE, ADDED ALONGSIDE OPACITY, NOT INSTEAD OF IT — asked for as "make
 * button touch feel better". Opacity alone was already correct and stays;
 * the complaint a shrink answers is different from the one a dim answers.
 * Fading says "this is disabled or fading out"; shrinking says "this got
 * pushed in", which is what a finger on a real button expects to feel. The
 * two together read as a single, more physical response rather than either
 * alone.
 *
 * ONE TRANSFORM PROPERTY, so it composes with whatever the caller's own
 * `rest` styles already transform (`hero-slider.tsx` and `qty-stepper.tsx`
 * both had their own). React Native merges an array of style objects by
 * property, not by object identity, so a second `transform` array here would
 * REPLACE the caller's rather than combine with it — this stays scale-only
 * for exactly that reason, and any pressable that also needs its own
 * transform must fold `scale` into that transform's own array instead of
 * relying on this one.
 */
export const press =
  (subtle = false, ...rest: StyleProp<ViewStyle>[]) =>
  ({ pressed }: { pressed: boolean }): StyleProp<ViewStyle> =>
    [
      ...rest,
      pressed && { opacity: subtle ? Opacity.pressedSubtle : Opacity.pressed },
      pressed && { transform: [{ scale: Scale.pressed }] },
    ];
