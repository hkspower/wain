import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Field } from '@/components/ui/field';
import { press } from '@/components/ui/press';
import { Radius, Spacing, TapTarget } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/**
 * One colour the owner can set, with the thing that decides whether they should.
 *
 * WHY THIS IS NOT JUST A HEX BOX. The theme card has had a brand field for
 * months and it is a plain text input — which is fine for someone who already
 * knows their brand colour and useless for someone choosing one on a phone.
 * Presets make it a control you can tap; the readout makes it one you can tap
 * safely.
 *
 * THE CONTRAST READOUT IS THE POINT.
 *
 * Every colour this component sets is a BACKGROUND, and something is painted on
 * top of it — white on the header, ink on the secondary chips, the tab bar's
 * own labels. A picker with no readout lets the owner choose a pale header in
 * two taps and discover in a week that the shop's navigation is white on cream.
 * This project has already recorded three separate contrast failures found only
 * because a rig went looking: the brand as small text at 4.28:1, white on the
 * dark mode's ember at 2.59:1, and a control edge at 1.15:1 that was the only
 * thing marking out a text field.
 *
 * The number is live rather than validated on save, because a refusal after the
 * fact teaches nothing — it says "no" about a colour the owner has stopped
 * looking at. A figure that moves while they drag through the swatches is what
 * makes the trade visible at the moment they are making it.
 *
 * IT WARNS AND DOES NOT REFUSE. 4.5:1 is the floor for body text and 3:1 for
 * large; a header's own wordmark is large, so a value between the two is a
 * judgement rather than a fault. Refusing here would also mean refusing colours
 * the design already ships — and a picker that will not accept the shop's
 * current appearance is a broken picker.
 */

/** Relative luminance, per WCAG 2.1. Null for anything that is not a plain
 *  six-digit hex — the same strictness the server and assets/theme.js use, and
 *  for the same reason: a value nothing can interpret must not be scored. */
const luminance = (hex: string): number | null => {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  const channel = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channel[0] + 0.7152 * channel[1] + 0.0722 * channel[2];
};

export const contrast = (a: string, b: string): number | null => {
  const la = luminance(a);
  const lb = luminance(b);
  if (la === null || lb === null) return null;
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
};

export function ColourField({
  label,
  hint,
  value,
  onChange,
  presets,
  /** What is painted ON this colour, and therefore what the ratio is against.
   *  Omit for a surface that carries nothing — then no readout is drawn, which
   *  is honester than a number measured against a guess. */
  foreground,
  /** The literal the stylesheet falls back to when this field is empty. Shown
   *  as the swatch so an untouched field still previews what the shop does. */
  shipped,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (v: string) => void;
  presets: string[];
  foreground?: string;
  shipped: string;
}) {
  const theme = useTheme();
  const effective = /^#[0-9a-f]{6}$/i.test(value.trim()) ? value.trim() : shipped;
  const ratio = foreground ? contrast(effective, foreground) : null;
  // 3:1 is WCAG 1.4.3's floor for large text, which is what a bar's own label
  // and a chip's are. Below it nothing is arguable.
  const poor = ratio !== null && ratio < 3;
  const fair = ratio !== null && ratio >= 3 && ratio < 4.5;

  return (
    <View style={styles.wrap}>
      <View style={styles.head}>
        <View
          style={[styles.swatch, { backgroundColor: effective, borderColor: theme.controlBorder }]}
        />
        <View style={styles.headText}>
          <ThemedText type="labelBold">{label}</ThemedText>
          {ratio !== null && (
            <ThemedText
              type="caption"
              themeColor={poor ? 'danger' : fair ? 'tintText' : 'success'}
              accessibilityLiveRegion="polite">
              {ratio.toFixed(1)}:1 against what sits on it
              {poor ? ' — under 3:1, not readable' : fair ? ' — fine for large text only' : ' — passes'}
            </ThemedText>
          )}
        </View>
      </View>

      {hint ? (
        <ThemedText type="caption" themeColor="textSecondary">
          {hint}
        </ThemedText>
      ) : null}

      {/* Real buttons with labels, not coloured divs: a swatch a screen reader
          announces as nothing is a control only some people have. */}
      <View style={styles.presets}>
        {presets.map((p) => (
          <Pressable
            key={p}
            accessibilityRole="button"
            accessibilityLabel={`Use ${p}`}
            accessibilityState={{ selected: effective.toLowerCase() === p.toLowerCase() }}
            onPress={() => onChange(p)}
            style={press(true, styles.presetHit)}>
            <View
              style={[
                styles.preset,
                {
                  backgroundColor: p,
                  borderColor:
                    effective.toLowerCase() === p.toLowerCase() ? theme.tint : theme.controlBorder,
                  borderWidth: effective.toLowerCase() === p.toLowerCase() ? 2 : 1,
                },
              ]}
            />
          </Pressable>
        ))}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Clear, and use the built-in colour"
          onPress={() => onChange('')}
          style={press(true, styles.presetHit)}>
          <View style={[styles.preset, styles.clear, { borderColor: theme.controlBorder }]}>
            <ThemedText type="caption" themeColor="textSecondary">
              —
            </ThemedText>
          </View>
        </Pressable>
      </View>

      <Field
        label={`${label} — hex, or empty for ${shipped}`}
        value={value}
        onChangeText={onChange}
        autoCapitalize="none"
        autoCorrect={false}
        maxLength={7}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: Spacing.two },
  head: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  headText: { flex: 1, gap: Spacing.half },
  swatch: { width: 44, height: 44, borderRadius: Radius.button, borderWidth: 1 },
  presets: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.one },
  // The full tap target round a smaller drawn swatch — the pattern the panel's
  // nav pills and the shop's carousel arrows both use, so a colour is as easy
  // to hit as every other control in here.
  presetHit: {
    minHeight: TapTarget,
    minWidth: TapTarget,
    alignItems: 'center',
    justifyContent: 'center',
  },
  preset: { width: 32, height: 32, borderRadius: Radius.button, alignItems: 'center', justifyContent: 'center' },
  clear: { borderStyle: 'dashed' },
});
