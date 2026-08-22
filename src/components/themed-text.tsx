import { StyleSheet, Text, type TextProps } from 'react-native';

import { Type, type ThemeColor, type TypeRole } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useLang } from '@/lib/i18n';

export type ThemedTextProps = TextProps & {
  /** A role from the type scale — see Type in constants/theme.ts. */
  type?: TypeRole;
  themeColor?: ThemeColor;
};

/**
 * All text goes through here, so that all text gets the loaded font and the
 * right leading for its language.
 *
 * The role names are the whole point: a screen asks for a `title`, not for
 * 24/32 bold Alexandria. Twelve screens used to override the size inline and
 * the same element ended up four different sizes across the app.
 */
export function ThemedText({ style, type = 'body', themeColor, ...rest }: ThemedTextProps) {
  const theme = useTheme();
  const { lang } = useLang();
  const t = Type[type];

  return (
    <Text
      style={[
        {
          color: theme[themeColor ?? 'text'],
          fontFamily: t.family,
          fontSize: t.size,
          // Arabic sits on a taller line: its marks go above the letters and
          // its descenders below, and at Latin leading they touch the line
          // above. Picked here rather than per screen, because every screen
          // renders both languages.
          lineHeight: lang === 'ar' ? t.lineAr : t.line,
          fontWeight: t.weight,
        },
        style,
      ]}
      {...rest}
    />
  );
}

/** Kept for the few places that need the monospace face — order references. */
export const monoStyle = StyleSheet.create({
  mono: { fontFamily: 'Plex-400', letterSpacing: 1 },
}).mono;
