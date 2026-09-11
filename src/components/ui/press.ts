import type { StyleProp, ViewStyle } from 'react-native';

import { Opacity } from '@/constants/theme';

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
 */
export const press =
  (subtle = false, ...rest: StyleProp<ViewStyle>[]) =>
  ({ pressed }: { pressed: boolean }): StyleProp<ViewStyle> =>
    [...rest, pressed && { opacity: subtle ? Opacity.pressedSubtle : Opacity.pressed }];
