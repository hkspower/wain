import { useRouter } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { press } from '@/components/ui/press';
import { SafeAreaView } from 'react-native-safe-area-context';

import { QtyStepper } from '@/components/qty-stepper';
import { Button } from '@/components/ui/button';
import { RemoteArt } from '@/components/remote-art';
import { ContentColumn, Screen } from '@/components/ui/screen';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, Elevation, MaxContentWidth, Radius, Spacing, TapTarget } from '@/constants/theme';
import { FREE_DELIVERY_OVER, useCart } from '@/lib/cart';
import { productPhoto } from '@/lib/assets';
import { productName, stockFor } from '@/lib/catalog';
import { useLang } from '@/lib/i18n';
import { formatPrice } from '@/lib/money';

export default function CartScreen() {
  const router = useRouter();
  const { t, lang, row, text } = useLang();
  const { lines, productFor, setQty, remove, subtotal, delivery, total } = useCart();

  if (lines.length === 0) {
    return (
      <Screen tabBar scroll={false} contentStyle={styles.emptyWrap}>
          <Text style={styles.emptyEmoji}>🛒</Text>
          <ThemedText type="labelBold" style={styles.center}>
            {t.cart.empty}
          </ThemedText>
          <ThemedText type="label" themeColor="textSecondary" style={styles.center}>
            {t.cart.emptyText}
          </ThemedText>
          <Button label={t.cart.browse} onPress={() => router.push('/shop')} style={styles.primary} />
      </Screen>
    );
  }

  return (
    <Screen
      tabBar
      contentStyle={styles.column}
      // WHITE, not the page's grey. With the hairline gone, a bar the same
      // colour as the page behind it is not a bar — it is the bottom of the
      // page. The lift has to come from somewhere, and a surface plainly in
      // front is what an upward shadow falls from.
      //
      // Totals and the checkout button ride above the tab bar, so the amount
      // is visible while the basket is being edited rather than only at the
      // bottom of a long list.
      actionBar={
        <ThemedView
          type="backgroundElement"
          style={[styles.summary, Elevation.bar, { paddingBottom: BottomTabInset }]}>
          <ContentColumn>
            <View style={[styles.totalRow, row]}>
              <ThemedText type="label" themeColor="textSecondary">
                {t.cart.subtotal}
              </ThemedText>
              <ThemedText type="label">{formatPrice(subtotal, lang)}</ThemedText>
            </View>
            <View style={[styles.totalRow, row]}>
              <ThemedText type="label" themeColor="textSecondary">
                {t.cart.delivery}
              </ThemedText>
              <ThemedText type="label">
                {delivery === 0 ? t.cart.free : formatPrice(delivery, lang)}
              </ThemedText>
            </View>
            <View style={[styles.totalRow, row]}>
              <ThemedText type="labelBold">{t.cart.total}</ThemedText>
              <ThemedText type="labelBold">{formatPrice(total, lang)}</ThemedText>
            </View>
            <Button label={t.cart.checkout} onPress={() => router.push('/checkout')} style={styles.primary} />
          </ContentColumn>
        </ThemedView>
      }>
          {lines.map((l) => {
            const p = productFor(l.slug);
            if (!p) return null;
            const cap = stockFor(p, l.size);
            return (
              <ThemedView
                key={`${l.slug}-${l.size}`}
                type="backgroundElement"
                style={[styles.line, row, Elevation.card]}>
                <RemoteArt
                  uri={productPhoto(p)}
                  ground={p.color}
                  emoji={p.emoji}
                  emojiSize={36}
                  style={styles.thumb}
                />

                <View style={styles.lineBody}>
                  <ThemedText type="labelBold" numberOfLines={2} style={text}>
                    {productName(p, lang)}
                  </ThemedText>
                  <ThemedText type="label" themeColor="textSecondary" style={text}>
                    {t.product.size} {l.size}
                  </ThemedText>
                  <ThemedText type="labelBold" style={text}>
                    {formatPrice(p.price * l.qty, lang)}
                  </ThemedText>

                  <View style={[styles.lineControls, row]}>
                    <QtyStepper
                      qty={l.qty}
                      max={cap}
                      onChange={(n) => setQty(l.slug, l.size, n)}
                    />
                    <Pressable
                      accessibilityRole="button"
                      onPress={() => remove(l.slug, l.size)}
                      style={press(false, styles.removeHit)}>
                      <ThemedText type="label" themeColor="danger">
                        {t.cart.remove}
                      </ThemedText>
                    </Pressable>
                  </View>
                  {l.qty >= cap && (
                    <ThemedText type="label" themeColor="textSecondary" style={text}>
                      {t.cart.capped}
                    </ThemedText>
                  )}
                </View>
              </ThemedView>
            );
          })}

          {delivery > 0 && (
            <ThemedText type="label" themeColor="tintText" style={text}>
              {t.cart.freeOver(formatPrice(FREE_DELIVERY_OVER, lang))}
            </ThemedText>
          )}


    </Screen>
  );
}

const styles = StyleSheet.create({
  column: { gap: Spacing.two },
  line: {
    borderRadius: Radius.card,
    padding: Spacing.two,
    gap: Spacing.three,
  },
  thumb: {
    width: 84,
    height: 84,
    borderRadius: Spacing.two,
    overflow: 'hidden',
  },
  lineBody: {
    flex: 1,
    gap: Spacing.half,
  },
  lineControls: {
    marginTop: Spacing.one,
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
  },
  removeHit: {
    minHeight: TapTarget,
    justifyContent: 'center',
    paddingHorizontal: Spacing.two,
  },
  summary: {
    // Lifted rather than ruled off. The basket scrolls UNDER this bar, and a
    // shadow says that where a hairline only said "something ends here".
    paddingTop: Spacing.three,
    gap: Spacing.one,
  },
  totalRow: {
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  primary: { marginTop: Spacing.two },
  emptyWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    padding: Spacing.four,
  },
  emptyEmoji: {
    fontSize: 64,
  },
  center: {
    textAlign: 'center',
  },
});
