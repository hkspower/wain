import type { ReactNode } from 'react';
import { StyleSheet, type StyleProp, type ViewStyle } from 'react-native';

import { ThemedView } from '@/components/themed-view';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/**
 * A white surface on the grey page. No shadow anywhere in this app — the page
 * is grey precisely so that cards separate without one.
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
  const theme = useTheme();
  return (
    <ThemedView
      type="backgroundElement"
      style={[styles.card, padded && styles.padded, { borderColor: tone ?? theme.border }, style]}>
      {children}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderRadius: Radius.card,
    overflow: 'hidden',
  },
  padded: { padding: Spacing.three, gap: Spacing.one },
});
