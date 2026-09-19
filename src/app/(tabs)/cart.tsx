import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { press } from '@/components/ui/press';

import { QtyStepper } from '@/components/qty-stepper';
import { Button } from '@/components/ui/button';
import { RemoteArt } from '@/components/remote-art';
import { CentredMessage } from '@/components/ui/centred-message';
import { ContentColumn, Screen } from '@/components/ui/screen';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, Elevation, Radius, Spacing, TapTarget } from '@/constants/theme';
import { useCart } from '@/lib/cart';
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
      <CentredMessage tabBar glyph="🛒" title={t.cart.empty} text={t.cart.emptyText}>
        <Button label={t.cart.browse} onPress={() => router.push('/shop')} />
      </CentredMessage>
    );
  }

  return (
    <Screen
      tabBar
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
                    {/* An untracked line — a cap, the phone strap — has no
                        size, and "Size " with nothing after it read as a
                        missing value rather than as a product without one. */}
                    {l.size ? `${t.product.size} ${l.size}` : ''}
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



    </Screen>
  );
}

const styles = StyleSheet.create({
  line: {
    borderRadius: Radius.card,
    padding: Spacing.two,
    gap: Spacing.three,
  },
  thumb: {
    width: 84,
    height: 84,
    borderRadius: Radius.button,
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
});
