import { useRouter } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { QtyStepper } from '@/components/qty-stepper';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, MaxContentWidth, Spacing, TapTarget } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { FREE_DELIVERY_OVER, useCart } from '@/lib/cart';
import { productName, stockFor } from '@/lib/catalog';
import { useLang } from '@/lib/i18n';
import { formatPrice } from '@/lib/money';

export default function CartScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { t, lang, row, text } = useLang();
  const { lines, productFor, setQty, remove, subtotal, delivery, total } = useCart();

  if (lines.length === 0) {
    return (
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <View style={styles.emptyWrap}>
          <Text style={styles.emptyEmoji}>🛒</Text>
          <ThemedText type="smallBold" style={styles.center}>
            {t.cart.empty}
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary" style={styles.center}>
            {t.cart.emptyText}
          </ThemedText>
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push('/shop')}
            style={({ pressed }) => [
              styles.primary,
              { backgroundColor: theme.tint },
              pressed && styles.pressed,
            ]}>
            <Text style={styles.primaryText}>{t.cart.browse}</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          { paddingBottom: BottomTabInset + Spacing.six },
        ]}
        showsVerticalScrollIndicator={false}>
        <View style={styles.content}>
          {lines.map((l) => {
            const p = productFor(l.slug);
            if (!p) return null;
            const cap = stockFor(p, l.size);
            return (
              <ThemedView
                key={`${l.slug}-${l.size}`}
                type="backgroundElement"
                style={[styles.line, row, { borderColor: theme.border }]}>
                <View style={[styles.thumb, { backgroundColor: p.color }]}>
                  <Text style={styles.thumbEmoji}>{p.emoji}</Text>
                </View>

                <View style={styles.lineBody}>
                  <ThemedText type="smallBold" numberOfLines={2} style={text}>
                    {productName(p, lang)}
                  </ThemedText>
                  <ThemedText type="small" themeColor="textSecondary" style={text}>
                    {t.product.size} {l.size}
                  </ThemedText>
                  <ThemedText type="smallBold" style={text}>
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
                      style={({ pressed }) => [styles.removeHit, pressed && styles.pressed]}>
                      <ThemedText type="small" themeColor="danger">
                        {t.cart.remove}
                      </ThemedText>
                    </Pressable>
                  </View>
                  {l.qty >= cap && (
                    <ThemedText type="small" themeColor="textSecondary" style={text}>
                      {t.cart.capped}
                    </ThemedText>
                  )}
                </View>
              </ThemedView>
            );
          })}

          {delivery > 0 && (
            <ThemedText type="small" themeColor="tint" style={text}>
              {t.cart.freeOver(formatPrice(FREE_DELIVERY_OVER, lang))}
            </ThemedText>
          )}
        </View>
      </ScrollView>

      {/* Totals and the checkout button ride above the tab bar, so the amount
          is visible while the basket is being edited rather than only at the
          bottom of a long list. */}
      <ThemedView
        type="background"
        style={[styles.summary, { borderColor: theme.border, paddingBottom: BottomTabInset }]}>
        <View style={styles.content}>
          <View style={[styles.totalRow, row]}>
            <ThemedText type="small" themeColor="textSecondary">
              {t.cart.subtotal}
            </ThemedText>
            <ThemedText type="small">{formatPrice(subtotal, lang)}</ThemedText>
          </View>
          <View style={[styles.totalRow, row]}>
            <ThemedText type="small" themeColor="textSecondary">
              {t.cart.delivery}
            </ThemedText>
            <ThemedText type="small">
              {delivery === 0 ? t.cart.free : formatPrice(delivery, lang)}
            </ThemedText>
          </View>
          <View style={[styles.totalRow, row]}>
            <ThemedText type="smallBold">{t.cart.total}</ThemedText>
            <ThemedText type="smallBold">{formatPrice(total, lang)}</ThemedText>
          </View>
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push('/checkout')}
            style={({ pressed }) => [
              styles.primary,
              { backgroundColor: theme.tint },
              pressed && styles.pressed,
            ]}>
            <Text style={styles.primaryText}>{t.cart.checkout}</Text>
          </Pressable>
        </View>
      </ThemedView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  scroll: {
    paddingTop: Spacing.three,
  },
  content: {
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
    paddingHorizontal: Spacing.three,
    gap: Spacing.two,
  },
  line: {
    borderRadius: Spacing.three,
    borderWidth: 1,
    padding: Spacing.two,
    gap: Spacing.three,
  },
  thumb: {
    width: 84,
    height: 84,
    borderRadius: Spacing.two,
    alignItems: 'center',
    justifyContent: 'center',
  },
  thumbEmoji: {
    fontSize: 36,
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
    borderTopWidth: 1,
    paddingTop: Spacing.three,
    gap: Spacing.one,
  },
  totalRow: {
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  primary: {
    marginTop: Spacing.two,
    minHeight: TapTarget,
    borderRadius: Spacing.three,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '700',
  },
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
  pressed: {
    opacity: 0.85,
  },
});
