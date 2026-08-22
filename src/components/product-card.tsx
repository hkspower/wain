import { Link } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { press } from '@/components/ui/press';

import { Price } from '@/components/price';
import { ProductBadge } from '@/components/product-badge';
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
        style={press(false, styles.press)}>
        <ThemedView type="backgroundElement" style={[styles.card, { borderColor: theme.border }]}>
          <RemoteArt
            uri={productPhoto(product)}
            ground={product.color}
            emoji={product.emoji}
            emojiSize={56}
            style={styles.banner}>
            {/* On the artwork, not under it: the grid is scanned by picture,
                and a badge below the fold of the card is read after the
                decision has already been made. */}
            <ProductBadge product={product} />
            {!available && <View style={styles.dim} pointerEvents="none" />}
          </RemoteArt>

          <View style={styles.body}>
            <ThemedText type="labelBold" numberOfLines={2} style={text}>
              {productName(product, lang)}
            </ThemedText>
            <ThemedText type="label" themeColor="textSecondary" style={text}>
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
  card: {
    flex: 1,
    borderRadius: Spacing.three,
    borderWidth: 1,
    overflow: 'hidden',
  },
  // A sold-out card is dimmed as well as badged. The badge says why; the wash
  // is what makes the card read as unavailable before anything is read at all.
  dim: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    start: 0,
    end: 0,
    backgroundColor: 'rgba(20,22,26,0.45)',
  },
  banner: {
    // A FIXED HEIGHT, not an aspect ratio derived from the photograph. The
    // grid puts two of these side by side and they must line up whether the
    // picture has loaded, failed, or never existed.
    height: 132,
    justifyContent: 'flex-end',
  },
  body: {
    padding: Spacing.three,
    gap: Spacing.one,
  },
});
