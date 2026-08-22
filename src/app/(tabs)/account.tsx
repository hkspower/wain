import { Linking, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Card } from '@/components/ui/card';
import { press } from '@/components/ui/press';
import { Screen } from '@/components/ui/screen';
import { Radius, Spacing, TapTarget } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useCart } from '@/lib/cart';
import { useLang, type Lang } from '@/lib/i18n';

const WHATSAPP = 'https://wa.me/96500000000';

export default function AccountScreen() {
  const theme = useTheme();
  const { t, lang, setLang, row, text } = useLang();
  const { source } = useCart();

  return (
    <Screen tabBar>
      <ThemedText type="subtitle" style={[styles.title, text]}>
        {t.account.title}
      </ThemedText>

      {/* LANGUAGE FIRST. It is the setting most likely to be wanted on a
          first run, and burying it under the order history means an
          English speaker has to read Arabic to find it. */}
      <ThemedText type="smallBold" style={[styles.label, text]}>
        {t.account.language}
      </ThemedText>
      <View style={[styles.langRow, row]}>
        {(
          [
            ['ar', t.account.arabic],
            ['en', t.account.english],
          ] as [Lang, string][]
        ).map(([id, label]) => {
          const active = lang === id;
          return (
            <Pressable
              key={id}
              accessibilityRole="radio"
              accessibilityState={{ selected: active }}
              onPress={() => setLang(id)}
              style={press(false, styles.lang,
                {
                  borderColor: active ? theme.tint : theme.border,
                  backgroundColor: active ? theme.tintSoft : theme.backgroundElement,
                })}>
              <ThemedText type="smallBold" themeColor={active ? 'tintText' : 'text'}>
                {label}
              </ThemedText>
            </Pressable>
          );
        })}
      </View>

      <ThemedText type="smallBold" style={[styles.label, text]}>
        {t.account.contact}
      </ThemedText>
      <Pressable
        accessibilityRole="link"
        onPress={() => Linking.openURL(WHATSAPP)}
        style={press()}>
        <ThemedView
          type="backgroundElement"
          style={[styles.rowCard, row, { borderColor: theme.border }]}>
          <ThemedText type="smallBold">{t.account.whatsapp}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            →
          </ThemedText>
        </ThemedView>
      </Pressable>

      <ThemedText type="smallBold" style={[styles.label, text]}>
        {t.account.about}
      </ThemedText>
      <ThemedText type="small" themeColor="textSecondary" style={text}>
        {t.account.aboutText}
      </ThemedText>

      {/* Said plainly rather than hidden. If the catalogue on screen is the
          bundled one, a product the customer was sent a link to may not be
          in it, and they are entitled to know why. */}
      {source === 'bundled' && (
        <ThemedView type="silverSoft" style={[styles.notice, { borderColor: theme.border }]}>
          <ThemedText type="small" themeColor="silver" style={text}>
            {t.account.offline}
          </ThemedText>
        </ThemedView>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 26, lineHeight: 34 },
  label: { marginTop: Spacing.three, fontSize: 16 },
  langRow: { gap: Spacing.two },
  lang: {
    flex: 1,
    minHeight: TapTarget,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderRadius: Spacing.three,
  },
  rowCard: {
    minHeight: TapTarget,
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.three,
    borderWidth: 1,
    borderRadius: Spacing.three,
  },
  notice: {
    marginTop: Spacing.three,
    borderWidth: 1,
    borderRadius: Spacing.three,
    padding: Spacing.three,
  },
});
