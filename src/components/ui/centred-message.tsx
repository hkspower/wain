import type { ReactNode } from 'react';
import { StyleSheet, Text, type StyleProp, type ViewStyle } from 'react-native';

import { Screen } from '@/components/ui/screen';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';

/**
 * A glyph, a line, a sentence, and whatever you do next — in the middle of an
 * otherwise empty screen.
 *
 * There were two of these, the empty basket and the order confirmation, near
 * enough identical in intent and different in every number: 8pt of gap against
 * the app's 16, one padded 24 and the other not padded at all, one button
 * hugging its label and the other stretched, and a box inside one of them
 * padded 16 by 32 where every other block in the app is 24. None of that was
 * decided; it is what happens when the same screen is written twice.
 *
 * Anything passed as children is stacked under the sentence at the SAME width
 * as everything else, which is the part that was actually visible: a stretched
 * button beside a content-width box is a ragged edge on the screen a customer
 * sees after paying.
 */
export function CentredMessage({
  glyph,
  title,
  text,
  tabBar = false,
  edges,
  style,
  children,
}: {
  glyph: string;
  title: string;
  /** The line under the title. Optional: a confirmation may say it elsewhere. */
  text?: string;
  tabBar?: boolean;
  edges?: readonly ('top' | 'bottom' | 'left' | 'right')[];
  style?: StyleProp<ViewStyle>;
  children?: ReactNode;
}) {
  return (
    <Screen tabBar={tabBar} edges={edges} scroll={false} contentStyle={[styles.wrap, style]}>
      {/* The glyph is decorative — the title says the same thing in words, and
          a screen reader announcing "party popper" before it is noise. */}
      <Text style={styles.glyph} accessible={false}>
        {glyph}
      </Text>
      <ThemedText type="title" style={styles.centre}>
        {title}
      </ThemedText>
      {text ? (
        <ThemedText themeColor="textSecondary" style={styles.centre}>
          {text}
        </ThemedText>
      ) : null}
      {children}
    </Screen>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    alignItems: 'stretch',
    justifyContent: 'center',
    // The column's own 16, not a second rhythm for the two screens that
    // happen to be centred.
    gap: Spacing.three,
  },
  centre: { textAlign: 'center' },
  glyph: { fontSize: 64, textAlign: 'center' },
});
