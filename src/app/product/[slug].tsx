import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Price } from '@/components/price';
import { RemoteArt } from '@/components/remote-art';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing, TapTarget } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useCart } from '@/lib/cart';
import { productPhoto } from '@/lib/assets';
import { productBlurb, productDetails, productName } from '@/lib/catalog';
import { useLang } from '@/lib/i18n';

export default function ProductScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { t, lang, row, text } = useLang();
  const { productFor, add } = useCart();
  const { slug } = useLocalSearchParams<{ slug: string }>();

  const product = productFor(String(slug));
  const [size, setSize] = useState<string | null>(null);
  // One piece of state for the whole confirmation, so the message and the
  // "look in your cart" affordance can never disagree.
  const [said, setSaid] = useState<'added' | 'capped' | 'pick' | null>(null);

  if (!product) {
    return (
      <SafeAreaView style={styles.safeArea} edges={['bottom']}>
        <ThemedText style={styles.missing}>404</ThemedText>
      </SafeAreaView>
    );
  }

  const stock = size ? (product.variants.find((v) => v.size === size)?.stock ?? 0) : 0;

  const onAdd = () => {
    if (!size) {
      setSaid('pick');
      return;
    }
    setSaid(add(product.slug, size) ? 'added' : 'capped');
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['bottom']}>
      {/* The native header was blank — a back chevron on an empty bar. On a
          phone that bar is the only thing telling you what you opened, and it
          is still there when the picture has scrolled away. */}
      <Stack.Screen options={{ title: productName(product, lang) }} />
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <RemoteArt
          uri={productPhoto(product.slug)}
          ground={product.color}
          emoji={product.emoji}
          emojiSize={96}
          style={styles.banner}
        />

        <View style={styles.content}>
          <ThemedText type="small" themeColor="textSecondary" style={text}>
            {product.brand}
          </ThemedText>
          <ThemedText type="subtitle" style={[styles.title, text]}>
            {productName(product, lang)}
          </ThemedText>
          <Price price={product.price} was={product.was} size="large" />
          <ThemedText themeColor="textSecondary" style={text}>
            {productBlurb(product, lang)}
          </ThemedText>

          {/* Sizes. Sold-out sizes stay VISIBLE and disabled rather than being
              hidden: a customer who cannot find their size needs to know it
              exists and is gone, otherwise they conclude the shop does not
              carry it. */}
          <ThemedText type="smallBold" style={[styles.label, text]}>
            {t.product.size}
          </ThemedText>
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
                  style={({ pressed }) => [
                    styles.size,
                    {
                      borderColor: active ? theme.tint : theme.border,
                      backgroundColor: active ? theme.tintSoft : 'transparent',
                    },
                    out && styles.sizeOut,
                    pressed && !out && styles.pressed,
                  ]}>
                  <ThemedText type="smallBold" themeColor={active ? 'tintText' : 'text'}>
                    {v.size}
                  </ThemedText>
                </Pressable>
              );
            })}
          </View>

          {size && stock > 0 && stock <= 3 ? (
            <ThemedText type="small" themeColor="tintText" style={text}>
              {stock === 1 ? t.product.lastOne : t.product.lowStock(stock)}
            </ThemedText>
          ) : null}

          <ThemedText type="smallBold" style={[styles.label, text]}>
            {t.product.details}
          </ThemedText>
          <View style={styles.details}>
            {productDetails(product, lang).map((d) => (
              <ThemedText key={d} type="small" themeColor="textSecondary" style={text}>
                • {d}
              </ThemedText>
            ))}
            <ThemedText type="small" themeColor="textSecondary" style={text}>
              • {t.product.delivery}
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary" style={text}>
              • {t.product.returns}
            </ThemedText>
          </View>
        </View>
      </ScrollView>

      {/* The add button is pinned, not at the end of the page. A product page
          is long, and a customer who has decided should not have to scroll to
          act on it. */}
      <ThemedView type="background" style={[styles.actionBar, { borderColor: theme.border }]}>
        {said ? (
          <View style={[styles.saidRow, row]}>
            <ThemedText
              type="small"
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
                <ThemedText type="smallBold" themeColor="tintText">
                  {t.tabs.cart} →
                </ThemedText>
              </Pressable>
            )}
          </View>
        ) : null}
        <Pressable
          accessibilityRole="button"
          onPress={onAdd}
          style={({ pressed }) => [
            styles.addButton,
            { backgroundColor: theme.tint },
            pressed && styles.pressed,
          ]}>
          <Text style={styles.addText}>{t.product.add}</Text>
        </Pressable>
      </ThemedView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  scroll: {
    paddingBottom: Spacing.five,
  },
  banner: {
    height: 260,
  },
  content: {
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
    padding: Spacing.three,
    gap: Spacing.two,
  },
  title: {
    fontSize: 28,
    lineHeight: 36,
  },
  label: {
    marginTop: Spacing.three,
    fontSize: 16,
  },
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
    borderRadius: Spacing.two,
  },
  sizeOut: {
    opacity: 0.32,
    textDecorationLine: 'line-through',
  },
  details: {
    gap: Spacing.one,
  },
  actionBar: {
    borderTopWidth: 1,
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
    borderRadius: Spacing.three,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '700',
  },
  missing: {
    margin: Spacing.five,
    textAlign: 'center',
  },
  pressed: {
    opacity: 0.85,
  },
});
