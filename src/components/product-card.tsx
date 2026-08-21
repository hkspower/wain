import { Link } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Price } from '@/components/price';
import { RemoteArt } from '@/components/remote-art';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { productPhoto } from '@/lib/assets';
import { inStock, productName, type Product } from '@/lib/catalog';
import { useLang } from '@/lib/i18n';

export function ProductCard({ product }: { product: Product }) {
  const theme = useTheme();
  const { lang, t, text } = useLang();
  const available = inStock(product);

  return (
    <Link href={{ pathname: '/product/[slug]', params: { slug: product.slug } }} asChild>
      <Pressable
        accessibilityRole="link"
        accessibilityLabel={productName(product, lang)}
        style={({ pressed }) => [styles.press, pressed && styles.pressed]}>
        <ThemedView type="backgroundElement" style={[styles.card, { borderColor: theme.border }]}>
          <RemoteArt
            uri={productPhoto(product.slug)}
            ground={product.color}
            emoji={product.emoji}
            emojiSize={56}
            style={styles.banner}>
            {!available && (
              <View style={styles.soldOut}>
                <Text style={styles.soldOutText}>{t.product.soldOut}</Text>
              </View>
            )}
          </RemoteArt>

          <View style={styles.body}>
            <ThemedText type="smallBold" numberOfLines={2} style={text}>
              {productName(product, lang)}
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary" style={text}>
              {product.brand}
            </ThemedText>
            <Price price={product.price} was={product.was} />
          </View>
        </ThemedView>
      </Pressable>
    </Link>
  );
}

const styles = StyleSheet.create({
  press: {
    flex: 1,
  },
  pressed: {
    opacity: 0.85,
  },
  card: {
    flex: 1,
    borderRadius: Spacing.three,
    borderWidth: 1,
    overflow: 'hidden',
  },
  banner: {
    // A FIXED HEIGHT, not an aspect ratio derived from the photograph. The
    // grid puts two of these side by side and they must line up whether the
    // picture has loaded, failed, or never existed.
    height: 132,
    justifyContent: 'flex-end',
  },
  soldOut: {
    position: 'absolute',
    bottom: 0,
    start: 0,
    end: 0,
    backgroundColor: 'rgba(20,22,26,0.82)',
    paddingVertical: Spacing.one,
    alignItems: 'center',
  },
  soldOutText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '700',
  },
  body: {
    padding: Spacing.three,
    gap: Spacing.one,
  },
});
