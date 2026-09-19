import type { ReactNode } from 'react';
import { StyleSheet, type StyleProp, type ViewStyle } from 'react-native';

import { ThemedView } from '@/components/themed-view';
import { Elevation, Radius, Spacing } from '@/constants/theme';

/**
 * A white block on the grey page, rounded and lifted the way the home page's
 * hero and category tiles are — 24 at the corner, no outline, and a shadow
 * doing the separating.
 *
 * It used to be the opposite: a hairline and no shadow anywhere. That changed
 * on the shop and the basket first, and this is the rest of the app catching
 * up so that a customer moving between screens meets one shop.
 */
export function Card({
  children,
  padded = true,
  tone,
  style,
}: {
  children: ReactNode;
  padded?: boolean;
  /** Override the border, e.g. danger on an out-of-stock row. */
  tone?: string;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <ThemedView
      type="backgroundElement"
      style={[
        styles.card,
        padded && styles.padded,
        // A tone is still drawn as an outline — it is saying something (this
        // row is out of stock, this one failed) and a coloured shadow says
        // nothing at any distance.
        tone ? { borderWidth: 1, borderColor: tone } : Elevation.card,
        style,
      ]}>
      {children}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: Radius.card,
    overflow: 'hidden',
  },
  padded: { padding: Spacing.four, gap: Spacing.one },
});
