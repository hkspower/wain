import { forwardRef } from 'react';
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
export const Field = forwardRef<TextInput, {
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
  /** `characters` is React Native's fourth value and was missing from this
   *  union, so a field whose content IS upper case — a promo code, which the
   *  server uppercases on save — could not say so and showed the owner lower
   *  case right up until it was stored as something else. */
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
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
  /**
   * SELECT WHAT IS THERE, so typing replaces it.
   *
   * Every numeric box in this panel arrives pre-filled with the current value —
   * a price, a stock count, a percentage — because the owner is editing, not
   * creating. Without this, changing 12.500 to 9 means tapping in, and then
   * clearing six characters one backspace at a time on a phone before the
   * first useful keystroke. With it, tapping the box and typing 9 is the whole
   * interaction.
   *
   * It is opt-in rather than the default because it is exactly wrong for a
   * field somebody APPENDS to: a product description or a staff note selected
   * on focus is one keystroke away from being deleted entirely.
   */
  selectTextOnFocus?: boolean;
  /**
   * The greyed hint inside an empty box. The component has always set
   * `placeholderTextColor` — carefully, because iOS's default grey is
   * unreadable on this app's dark ground — and never accepted a placeholder to
   * paint with it. A prop that styles something no caller can produce is a
   * prop that has never once run.
   */
  placeholder?: string;
  /** For the one field a screen opens ON. More than one per screen is two
   *  fields fighting over the keyboard, so it is not a default. */
  autoFocus?: boolean;
  /**
   * FALSE WHEN THIS FIELD HANDS OFF TO ANOTHER ONE. RN's default closes the
   * keyboard on submit and a chained onSubmitEditing then has to reopen it on
   * the next field — a visible flicker on both platforms, worse on Android,
   * where the keyboard's own resize of the screen restarts. Set to false on
   * every field but the last in a chain; leave it on the last one, where
   * "done" or "go" SHOULD close the keyboard.
   */
  blurOnSubmit?: boolean;
}>(function Field({
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
  blurOnSubmit,
  selectTextOnFocus,
  placeholder,
  autoFocus,
}, ref) {
  const theme = useTheme();
  const { text } = useLang();

  return (
    <View style={styles.field}>
      <ThemedText type="label" themeColor="textSecondary" style={text}>
        {label}
      </ThemedText>
      <TextInput
        ref={ref}
        value={value}
        onChangeText={onChangeText}
        keyboardType={keyboardType ?? 'default'}
        autoComplete={autoComplete ?? 'off'}
        textContentType={textContentType ?? 'none'}
        secureTextEntry={secureTextEntry}
        autoCapitalize={autoCapitalize}
        blurOnSubmit={blurOnSubmit}
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
        selectTextOnFocus={selectTextOnFocus}
        placeholder={placeholder}
        autoFocus={autoFocus}
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
});
Field.displayName = 'Field';

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
