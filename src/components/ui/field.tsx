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
  multiline,
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
  /**
   * FOR THE FIELDS THAT HOLD A SENTENCE, not a value — an answer the shop
   * writes for the assistant, a note on an order. A single-line input shows
   * one line of a 1000-character answer and scrolls the rest sideways past the
   * cursor, which is unreadable in Latin and worse in Arabic, where the text
   * runs the other way and the caret ends up off the wrong edge.
   *
   * `textAlignVertical` is Android-only and does nothing on iOS, where a
   * multiline TextInput already starts at the top — it is set rather than left
   * out because without it Android centres the first line in the taller box.
   */
  multiline?: boolean;
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
        multiline={multiline}
        textAlignVertical={multiline ? 'top' : undefined}
        returnKeyType={returnKeyType}
        onSubmitEditing={onSubmitEditing}
        accessibilityLabel={label}
        placeholderTextColor={theme.textSecondary}
        style={[
          styles.input,
          multiline && styles.multiline,
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
  // Four lines at the 16px the input already sets, plus the padding — enough
  // to see a whole short answer without the box dominating the form. It grows
  // no further on its own: a taller box for a longer answer is a scroll, not a
  // layout that shifts every time somebody types.
  multiline: {
    minHeight: TapTarget * 2,
    paddingTop: Spacing.two,
    paddingBottom: Spacing.two,
  },
});
