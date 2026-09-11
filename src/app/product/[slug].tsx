import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { press } from '@/components/ui/press';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Price } from '@/components/price';
import { RemoteArt } from '@/components/remote-art';
import { ContentColumn, Screen } from '@/components/ui/screen';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Elevation, MaxContentWidth, Radius, Spacing, TapTarget } from '@/constants/theme';
import { useHydrated } from '@/hooks/use-hydrated';
import { useTheme } from '@/hooks/use-theme';
import { useCart } from '@/lib/cart';
import { productPhoto } from '@/lib/assets';
import { isTracked, productBlurb, productDetails, productName } from '@/lib/catalog';
import { useLang } from '@/lib/i18n';
import { formatNumber } from '@/lib/money';

export default function ProductScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { t, lang, row, text } = useLang();
  const { productFor, add } = useCart();
  const { slug } = useLocalSearchParams<{ slug: string }>();

  const hydrated = useHydrated();
  const product = productFor(String(slug));
  const [size, setSize] = useState<string | null>(null);
  // One piece of state for the whole confirmation, so the message and the
  // "look in your cart" affordance can never disagree.
  const [said, setSaid] = useState<'added' | 'capped' | 'pick' | null>(null);

  // Before hydration there is no slug to look up — see hooks/use-hydrated.
  // Showing 404 in the prerendered HTML would also be the wrong thing for a
  // crawler or a shared link to read about a product that exists.
  if (!hydrated) {
    return <Screen edges={['bottom']} scroll={false}>{null}</Screen>;
  }

  if (!product) {
    return (
      <Screen edges={['bottom']} scroll={false}>
        <ThemedText style={styles.missing}>404</ThemedText>
      </Screen>
    );
  }

  // A product with no rows in product_variants is UNTRACKED, not sold out —
  // the caps, the backpack, the phone strap. The server sells them without a
  // size and the website does too; the app asked for one that was never on
  // offer. Its cart line keys on the empty size, which is exactly what the
  // order body carries.
  const tracked = isTracked(product);
  const stock = size ? (product.variants.find((v) => v.size === size)?.stock ?? 0) : 0;

  const onAdd = () => {
    if (tracked && !size) {
      setSaid('pick');
      return;
    }
    setSaid(add(product.slug, tracked ? (size as string) : '') ? 'added' : 'capped');
  };

  return (
    <Screen
      edges={['bottom']}
      bleed={
        <RemoteArt
            uri={productPhoto(product)}
            ground={product.color}
            emoji={product.emoji}
            emojiSize={96}
            style={styles.banner}
          />
      }
      // Pinned, not at the end of the page. A product page is long, and a
      // customer who has decided should not have to scroll back to act on it.
      actionBar={
          <ThemedView type="backgroundElement" style={[styles.actionBar, Elevation.bar]}>
            {said ? (
              <View style={[styles.saidRow, row]}>
                <ThemedText
                  type="label"
                  themeColor={said === 'added' ? 'success' : said === 'capped' ? 'textSecondary' : 'danger'}
                  style={styles.saidText}
                  // Announced, not just shown: the confirmation is the only signal
                  // that the tap worked, and a screen reader user gets no colour.
                  accessibilityLiveRegion="polite">
                  {said === 'added'
                    ? t.product.added
                    : said === 'capped'
                      ? t.cart.capped
                      : t.product.pickSize}
                </ThemedText>
                {/* Shown for 'capped' too, not just 'added'. Being told "that is
                    all we have" is exactly the moment a customer wants to look at
                    what they already have — and the item IS in the basket either
                    way. Hiding the way there on the second tap was punishing them
                    for tapping twice. */}
                {said !== 'pick' && (
                  <Pressable accessibilityRole="button" onPress={() => router.push('/cart')}>
                    <ThemedText type="labelBold" themeColor="tintText">
                      {t.tabs.cart} →
                    </ThemedText>
                  </Pressable>
                )}
              </View>
            ) : null}
            <Pressable
              accessibilityRole="button"
              onPress={onAdd}
              style={press(false, styles.addButton,
                { backgroundColor: theme.tint })}>
              <Text style={[styles.addText, { color: theme.onTint }]}>{t.product.add}</Text>
            </Pressable>
          </ThemedView>
      }>
      {/* The native header was blank — a back chevron on an empty bar. On a
          phone that bar is the only thing telling you what you opened, and it
          is still there when the picture has scrolled away. */}
      <Stack.Screen options={{ title: productName(product, lang) }} />




          <ThemedText type="label" themeColor="textSecondary" style={text}>
            {product.brand}
          </ThemedText>
          <ThemedText type="display" style={text}>
            {productName(product, lang)}
          </ThemedText>
          <Price price={product.price} was={product.was} size="large" />
          <ThemedText themeColor="textSecondary" style={text}>
            {productBlurb(product, lang)}
          </ThemedText>

          {/* Sizes. Sold-out sizes stay VISIBLE and disabled rather than being
              hidden: a customer who cannot find their size needs to know it
              exists and is gone, otherwise they conclude the shop does not
              carry it.

              An UNTRACKED product has no sizes to show at all, and printing
              the heading over an empty row read as "sizes are loading" or
              "this is sold out" — it was neither. */}
          {tracked ? (
          <ThemedText type="labelBold" style={[styles.label, text]}>
            {t.product.size}
          </ThemedText>
          ) : null}
          <View style={[styles.sizeRow, row]}>
            {product.variants.map((v) => {
              const out = v.stock <= 0;
              const active = v.size === size;
              return (
                <Pressable
                  key={v.size}
                  disabled={out}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active, disabled: out }}
                  onPress={() => {
                    setSize(v.size);
                    setSaid(null);
                  }}
                  style={press(false, styles.size,
                    {
                      borderColor: active ? theme.tint : theme.controlBorder,
                      backgroundColor: active ? theme.tintSoft : 'transparent',
                    },
                    out && styles.sizeOut)}>
                  <ThemedText type="labelBold" themeColor={active ? 'tintText' : 'text'}>
                    {v.size}
                  </ThemedText>
                </Pressable>
              );
            })}
          </View>

          {size && stock > 0 && stock <= 3 ? (
            <ThemedText type="label" themeColor="tintText" style={text}>
              {stock === 1 ? t.product.lastOne : t.product.lowStock(formatNumber(stock, lang))}
            </ThemedText>
          ) : null}

          <ThemedText type="labelBold" style={[styles.label, text]}>
            {t.product.details}
          </ThemedText>
          <View style={styles.details}>
            {productDetails(product, lang).map((d) => (
              <ThemedText key={d} type="label" themeColor="textSecondary" style={text}>
                • {d}
              </ThemedText>
            ))}
            <ThemedText type="label" themeColor="textSecondary" style={text}>
              • {t.product.delivery}
            </ThemedText>
            <ThemedText type="label" themeColor="textSecondary" style={text}>
              • {t.product.returns}
            </ThemedText>
          </View>


    </Screen>
  );
}

const styles = StyleSheet.create({
  banner: {
    height: 260,
  },
  label: { marginTop: Spacing.three },
  sizeRow: {
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
  size: {
    minWidth: TapTarget,
    height: TapTarget,
    paddingHorizontal: Spacing.three,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderRadius: Radius.button,
  },
  sizeOut: {
    opacity: 0.32,
    textDecorationLine: 'line-through',
  },
  details: {
    gap: Spacing.one,
  },
  // Lifted and white, the same bar the basket and the checkout carry. This
  // page was the last one still ruling its action bar off with a hairline.
  actionBar: {
    padding: Spacing.three,
    gap: Spacing.two,
  },
  saidRow: {
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
  },
  saidText: {
    flex: 1,
  },
  addButton: {
    minHeight: TapTarget,
    borderRadius: Radius.button,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addText: {
    fontSize: 16,
    fontWeight: '700',
  },
  missing: {
    margin: Spacing.five,
    textAlign: 'center',
  },
});
