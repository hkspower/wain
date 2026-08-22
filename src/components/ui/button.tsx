import { ActivityIndicator, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { press } from '@/components/ui/press';
import { Opacity, Radius, Spacing, TapTarget } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useLang } from '@/lib/i18n';

type Variant = 'primary' | 'secondary' | 'danger';

/**
 * Every button in the app.
 *
 * Four files declared their own `primary` and `primaryText`, and each got a
 * different part of it right: one remembered the spinner, one remembered the
 * minimum height, none of them agreed on the gap between the two. The label
 * colour in particular was hard-coded '#ffffff' in all four — which is how
 * white ended up on the dark-mode ember at 2.59:1.
 *
 * `busy` puts the spinner INSIDE the button and disables it, because the tap
 * that must never be doubled is the one that takes a payment.
 */
export function Button({
  label,
  onPress,
  variant = 'primary',
  busy = false,
  disabled = false,
  style,
}: {
  label: string;
  onPress: () => void;
  variant?: Variant;
  busy?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const theme = useTheme();
  const { row } = useLang();
  const off = disabled || busy;

  const skin: Record<Variant, { bg: string; fg: string; border: string }> = {
    primary: { bg: theme.tint, fg: '#ffffff', border: theme.tint },
    secondary: { bg: theme.backgroundElement, fg: theme.text, border: theme.border },
    danger: { bg: theme.backgroundElement, fg: theme.danger, border: theme.danger },
  };
  const { bg, fg, border } = skin[variant];

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ busy, disabled: off }}
      disabled={off}
      onPress={onPress}
      style={press(false, styles.button, row, { backgroundColor: bg, borderColor: border }, off && styles.off, style)}>
      {busy && <ActivityIndicator color={fg} style={styles.spinner} />}
      <Text style={[styles.label, { color: fg }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: TapTarget,
    borderRadius: Radius.card,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.four,
  },
  label: { fontSize: 16, fontWeight: '700' },
  spinner: { transform: [{ scale: 0.9 }] },
  off: { opacity: Opacity.disabled },
});
