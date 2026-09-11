import { Link } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { press } from '@/components/ui/press';

import { Price } from '@/components/price';
import { ProductBadge } from '@/components/product-badge';
import { RemoteArt } from '@/components/remote-art';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Elevation, Radius, Spacing, Type } from '@/constants/theme';
import { productPhoto } from '@/lib/assets';
import { inStock, productName, type Product } from '@/lib/catalog';
import { useLang } from '@/lib/i18n';

export function ProductCard({ product }: { product: Product }) {
  const { lang, t, text } = useLang();
  const available = inStock(product);

  return (
    <Link href={{ pathname: '/product/[slug]', params: { slug: product.slug } }} asChild>
      <Pressable
        accessibilityRole="link"
        accessibilityLabel={productName(product, lang)}
        style={press(false, styles.press)}>
        {/* TWO VIEWS, not one. The shadow is on the outer; the rounded corners
            and the overflow clip that keeps the photograph inside them are on
            the inner. iOS clips a view's shadow to its own bounds when that
            view also hides its overflow, so a card that does both loses the
            shadow entirely — and does it only on the phone, which is the one
            place nobody would see it in a browser. */}
        <ThemedView type="backgroundElement" style={[styles.card, Elevation.card]}>
          <View style={styles.clip}>
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
            {/* TWO LINES ALWAYS, reserved whether the name needs them or not.
                numberOfLines caps a long name at two; it does nothing for a
                SHORT one, which then takes a single line and makes its card
                26px shorter than the one beside it. In a two-column grid that
                is not a small thing: the brand and the price sit at different
                heights across the row, and the bottom edge of every row is
                ragged. Measured on the shop: 258px cards next to 284px ones,
                because "تيشيرت تشيتاز رَغبي" happens to fit on one line.

                The banner above already pins its height for exactly this
                reason, in the same words — the two have to agree or the fix
                only covers half the card.

                lineAr, not line: Arabic sets at 26 against English's 20, and
                reserving the English height would clip the second line of an
                Arabic name — which is most of this catalogue. */}
            <ThemedText
              type="labelBold"
              numberOfLines={2}
              style={[
                text,
                { minHeight: 2 * (lang === 'ar' ? Type.labelBold.lineAr : Type.labelBold.line) },
              ]}>
              {productName(product, lang)}
            </ThemedText>
            <ThemedText type="label" themeColor="textSecondary" style={text}>
              {product.brand}
            </ThemedText>
            <Price price={product.price} was={product.was} />
          </View>
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
    borderRadius: Radius.card,
  },
  clip: {
    flex: 1,
    borderRadius: Radius.card,
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
