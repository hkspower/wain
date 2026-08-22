import { Linking, Platform, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Card } from '@/components/ui/card';
import { press } from '@/components/ui/press';
import { Screen } from '@/components/ui/screen';
import { Elevation, Radius, Spacing, TapTarget } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { API_BASE } from '@/lib/config';
import { useCart } from '@/lib/cart';
import { useLang, type Lang } from '@/lib/i18n';

const WHATSAPP = 'https://wa.me/96500000000';

export default function AccountScreen() {
  const theme = useTheme();
  const { t, lang, setLang, row, text } = useLang();
  const { source, lastOrder } = useCart();

  return (
    <Screen tabBar>
      <ThemedText type="display" style={text}>
        {t.account.title}
      </ThemedText>

      {/* LANGUAGE FIRST. It is the setting most likely to be wanted on a
          first run, and burying it under the order history means an
          English speaker has to read Arabic to find it. */}
      <ThemedText type="labelBold" style={[styles.label, text]}>
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
              <ThemedText type="labelBold" themeColor={active ? 'tintText' : 'text'}>
                {label}
              </ThemedText>
            </Pressable>
          );
        })}
      </View>

      {/* iOS ONLY, and shown rather than disabled elsewhere would be worse:
          Apple Wallet does not exist on Android, and a button that opens
          nothing is a promise the app cannot keep. Android's equivalent is
          Google Wallet, which needs a different pass format and a different
          account — when that exists this becomes a choice, not a hidden
          button. */}
      {/* Only once they have ordered. The endpoint issues a first pass against
          a phone plus one of its own order references, and without an order
          there is nothing to prove and no points to put on the card. A button
          that 403s is worse than one that is not there yet. */}
      {Platform.OS === 'ios' && lastOrder && (
        <>
          <ThemedText type="labelBold" style={[styles.label, text]}>
            {t.account.wallet}
          </ThemedText>
          <ThemedText type="label" themeColor="textSecondary" style={text}>
            {t.account.walletWhat}
          </ThemedText>
          <Pressable
            accessibilityRole="link"
            accessibilityLabel={t.account.walletAdd}
            // Opened with the system browser, not fetched: iOS recognises the
            // application/vnd.apple.pkpass response and hands it to Wallet
            // itself. Downloading the bytes in-app would leave us holding a
            // file with nothing able to install it.
            // The real route, with the identity the endpoint requires: a phone
            // and one of that phone's own order references. Both come from the
            // last order this device placed — which is the only customer
            // identity a shop with no accounts has.
            onPress={() =>
              lastOrder &&
              Linking.openURL(
                `${API_BASE}/wallet.php?r=loyalty&phone=${encodeURIComponent(lastOrder.phone)}&track=${encodeURIComponent(lastOrder.ref)}`,
              )
            }
            disabled={!lastOrder}
            style={press()}>
            <View style={[styles.walletButton, row]}>
              <ThemedText type="labelBold" style={styles.walletText}>
                {t.account.walletAdd}
              </ThemedText>
            </View>
          </Pressable>
        </>
      )}

      <ThemedText type="labelBold" style={[styles.label, text]}>
        {t.account.contact}
      </ThemedText>
      <Pressable
        accessibilityRole="link"
        onPress={() => Linking.openURL(WHATSAPP)}
        style={press()}>
        <ThemedView
          type="backgroundElement"
          style={[styles.rowCard, row, Elevation.card]}>
          <ThemedText type="labelBold">{t.account.whatsapp}</ThemedText>
          <ThemedText type="label" themeColor="textSecondary">
            →
          </ThemedText>
        </ThemedView>
      </Pressable>

      <ThemedText type="labelBold" style={[styles.label, text]}>
        {t.account.about}
      </ThemedText>
      <ThemedText type="label" themeColor="textSecondary" style={text}>
        {t.account.aboutText}
      </ThemedText>

      {/* Said plainly rather than hidden. If the catalogue on screen is the
          bundled one, a product the customer was sent a link to may not be
          in it, and they are entitled to know why. */}
      {source === 'bundled' && (
        <ThemedView type="silverSoft" style={[styles.notice, { borderColor: theme.border }]}>
          <ThemedText type="label" themeColor="silver" style={text}>
            {t.account.offline}
          </ThemedText>
        </ThemedView>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  label: { marginTop: Spacing.three },
  langRow: { gap: Spacing.two },
  lang: {
    flex: 1,
    minHeight: TapTarget,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderRadius: Radius.button,
  },
  rowCard: {
    minHeight: TapTarget,
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.four,
    borderRadius: Radius.card,
  },
  // Apple's own guidance is a black button with white text; a branded orange
  // one reads as an advert rather than as the system affordance people already
  // recognise.
  walletButton: {
    minHeight: TapTarget,
    borderRadius: Radius.button,
    backgroundColor: '#000000',
    alignItems: 'center',
    justifyContent: 'center',
  },
  walletText: { color: '#ffffff' },
  notice: {
    marginTop: Spacing.three,
    borderWidth: 1,
    borderRadius: Radius.card,
    padding: Spacing.four,
  },
});
