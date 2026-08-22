import { Pressable, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { press } from '@/components/ui/press';
import { Radius, Spacing, TapTarget } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/**
 * A selectable pill: shop filters, sort, governorate, the admin's status
 * filters. Three files had their own and only one of them was tappable — the
 * others took their height from 14pt text plus four points of padding, which
 * is 28px against a 48 standard.
 *
 * `role` matters to a screen reader: a row of filters is a set of buttons, a
 * payment method is a radio. Stated per use rather than assumed.
 */
export function Chip({
  label,
  active,
  onPress,
  role = 'button',
  style,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  role?: 'button' | 'radio';
  style?: StyleProp<ViewStyle>;
}) {
  const theme = useTheme();

  return (
    <Pressable
      accessibilityRole={role}
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={press(true, styles.hit, style)}>
      <ThemedView
        type={active ? 'backgroundSelected' : 'backgroundElement'}
        style={[styles.chip, { borderColor: active ? theme.tint : theme.border }]}>
        <ThemedText type="small" themeColor={active ? 'tintText' : 'textSecondary'}>
          {label}
        </ThemedText>
      </ThemedView>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  hit: { minHeight: TapTarget, justifyContent: 'center' },
  chip: {
    minHeight: TapTarget - 12,
    justifyContent: 'center',
    borderRadius: Radius.chip,
    borderWidth: 1,
    paddingHorizontal: Spacing.three,
  },
});
