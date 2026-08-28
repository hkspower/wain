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
      // `selected` IS NOT VALID ARIA ON EITHER OF THESE ROLES, so React Native
      // Web dropped it and the chip announced nothing at all: a screen reader
      // heard "الكل, button" whether that filter was on or off, and the same
      // for the language on the Account tab. Found by pressing them — the
      // button audit could not tell an already-selected chip from a dead one,
      // because the page published nothing to tell it with.
      //
      // The correct attribute depends on the role: `checked` for a radio,
      // `pressed` for a toggle button. `selected` is kept alongside for the
      // native side, which reads it and has no notion of aria.
      accessibilityState={
        role === 'radio' ? { checked: active, selected: active } : { selected: active }
      }
      aria-pressed={role === 'button' ? active : undefined}
      onPress={onPress}
      style={press(true, styles.hit, style)}>
      <ThemedView
        type={active ? 'backgroundSelected' : 'backgroundElement'}
        style={[styles.chip, { borderColor: active ? theme.tint : theme.border }]}>
        <ThemedText type="label" themeColor={active ? 'tintText' : 'textSecondary'}>
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
