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
  textContentType,
  secureTextEntry,
  autoCapitalize,
  autoCorrect,
  maxLength,
  returnKeyType,
  onSubmitEditing,
}: {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  error?: string | null;
  keyboardType?: KeyboardTypeOptions;
  autoComplete?: 'name' | 'tel' | 'street-address' | 'email' | 'current-password' | 'one-time-code' | 'off';
  /**
   * iOS AUTOFILL, WHICH autoComplete DOES NOT DO.
   *
   * `autoComplete` is the ANDROID hint. iOS reads `textContentType`, and with
   * it unset the QuickType bar never offers the shopper their own phone
   * number, their email or their name from Contacts — they type all of it by
   * hand. The two have to be given together; neither covers both platforms.
   *
   * `oneTimeCode` is the one that matters most: it is what makes iOS surface a
   * six-digit code straight from Mail or Messages above the keyboard. Without
   * it an admin signing in reads the code, memorises it, switches apps and
   * types it — which is the whole friction the second factor was worth
   * accepting, made worse for no reason.
   */
  textContentType?:
    | 'name' | 'telephoneNumber' | 'emailAddress' | 'password' | 'newPassword'
    | 'oneTimeCode' | 'streetAddressLine1' | 'addressCity' | 'postalCode' | 'none';
  secureTextEntry?: boolean;
  autoCapitalize?: 'none' | 'sentences' | 'words';
  autoCorrect?: boolean;
  maxLength?: number;
  returnKeyType?: 'done' | 'go' | 'next' | 'search' | 'send';
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
        textContentType={textContentType ?? 'none'}
        secureTextEntry={secureTextEntry}
        autoCapitalize={autoCapitalize}
        // AUTOCORRECT OFF WHEREVER THE KEYBOARD IS NOT A PROSE KEYBOARD. A
        // phone number, a code, an email and an order reference are not words,
        // and a keyboard that "corrects" them turns a valid entry into an
        // invalid one after the shopper has looked away. Defaults to on only
        // for the plain text keyboard, which is the one used for names and
        // notes.
        autoCorrect={autoCorrect ?? (keyboardType && keyboardType !== 'default' ? false : undefined)}
        spellCheck={autoCorrect ?? (keyboardType && keyboardType !== 'default' ? false : undefined)}
        maxLength={maxLength}
        returnKeyType={returnKeyType}
        onSubmitEditing={onSubmitEditing}
        accessibilityLabel={label}
        placeholderTextColor={theme.textSecondary}
        style={[
          styles.input,
          text,
          {
            color: theme.text,
            backgroundColor: theme.background,
            borderColor: error ? theme.danger : theme.controlBorder,
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
    borderRadius: Radius.button,
    paddingHorizontal: Spacing.three,
    fontSize: 16,
  },
});
