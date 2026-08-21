import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing, TapTarget } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useLang } from '@/lib/i18n';

/**
 * −  n  +
 *
 * Laid out with `row`, so in Arabic the minus sits where an Arabic reader
 * expects it. The buttons are TapTarget square: a stepper is the control
 * people miss most on a phone, and it is usually built at the size of its
 * glyph.
 */
export function QtyStepper({
  qty,
  max,
  onChange,
}: {
  qty: number;
  max: number;
  onChange: (next: number) => void;
}) {
  const theme = useTheme();
  const { row } = useLang();
  const atMax = qty >= max;

  const Button = ({ label, to, disabled }: { label: string; to: number; disabled: boolean }) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label === '+' ? 'increase quantity' : 'decrease quantity'}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={() => onChange(to)}
      style={({ pressed }) => [
        styles.button,
        { borderColor: theme.border },
        pressed && !disabled && styles.pressed,
        disabled && styles.disabled,
      ]}>
      <ThemedText type="smallBold" style={styles.glyph}>
        {label}
      </ThemedText>
    </Pressable>
  );

  return (
    <View style={[row, styles.wrap]}>
      <Button label="−" to={qty - 1} disabled={qty <= 1} />
      <View style={styles.count}>
        <ThemedText type="smallBold">{qty}</ThemedText>
      </View>
      <Button label="+" to={qty + 1} disabled={atMax} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
  },
  button: {
    width: TapTarget,
    height: TapTarget,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderRadius: Spacing.two,
  },
  glyph: {
    fontSize: 18,
  },
  count: {
    minWidth: TapTarget,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: {
    opacity: 0.7,
  },
  disabled: {
    opacity: 0.35,
  },
});
