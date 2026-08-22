import { StyleSheet, TextInput, View, type KeyboardTypeOptions } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing, TapTarget } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useLang } from '@/lib/i18n';

/**
 * A labelled text input with its error underneath.
 *
 * Three files built this by hand. The differences were not deliberate: one
 * forgot placeholderTextColor, so its placeholder was iOS grey on a dark
 * background; one forgot the accessibility label, leaving a screen reader to
 * announce "text field" and nothing else.
 */
export function Field({
  label,
  value,
  onChangeText,
  error,
  keyboardType,
  autoComplete,
  secureTextEntry,
  autoCapitalize,
  onSubmitEditing,
}: {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  error?: string | null;
  keyboardType?: KeyboardTypeOptions;
  autoComplete?: 'name' | 'tel' | 'street-address' | 'email' | 'current-password' | 'off';
  secureTextEntry?: boolean;
  autoCapitalize?: 'none' | 'sentences' | 'words';
  onSubmitEditing?: () => void;
}) {
  const theme = useTheme();
  const { text } = useLang();

  return (
    <View style={styles.field}>
      <ThemedText type="label" themeColor="textSecondary" style={text}>
        {label}
      </ThemedText>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        keyboardType={keyboardType ?? 'default'}
        autoComplete={autoComplete ?? 'off'}
        secureTextEntry={secureTextEntry}
        autoCapitalize={autoCapitalize}
        onSubmitEditing={onSubmitEditing}
        accessibilityLabel={label}
        placeholderTextColor={theme.textSecondary}
        style={[
          styles.input,
          text,
          {
            color: theme.text,
            backgroundColor: theme.background,
            borderColor: error ? theme.danger : theme.border,
          },
        ]}
      />
      {error ? (
        <ThemedText type="label" themeColor="danger" style={text}>
          {error}
        </ThemedText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  field: { gap: Spacing.half, flex: 1 },
  input: {
    minHeight: TapTarget,
    borderWidth: 1,
    borderRadius: Radius.control,
    paddingHorizontal: Spacing.three,
    fontSize: 16,
  },
});
