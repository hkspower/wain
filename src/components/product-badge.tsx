import { StyleSheet, Text, View } from 'react-native';

import { Radius, Spacing, Type } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { discountPercent, formatNumber } from '@/lib/money';
import { inStock, LOW_STOCK, totalStock, type Product } from '@/lib/catalog';
import { useLang } from '@/lib/i18n';

/**
 * The one badge a product card wears.
 *
 * ONE, not four. A card carrying "new", "−21%" and "almost gone" at once is a
 * card carrying nothing: the eye reads a cluster of stickers as decoration and
 * stops looking. So they are ranked by what the customer needs to know first,
 * and the winner is the only one shown:
 *
 *   1. SOLD OUT   — nothing else matters if it cannot be bought.
 *   2. DISCOUNT   — the strongest reason to click, and the only badge with a
 *                   number in it.
 *   3. ALMOST GONE — urgency, but only once it is true.
 *   4. NEW        — the weakest claim, and the one that ages worst.
 *
 * The percentage is duplicated from the price row on purpose: on a grid the
 * card is scanned before the price is read, and a discount that only appears
 * in small print beneath the name is a discount most people never see.
 */
export type BadgeKind = 'out' | 'discount' | 'low' | 'new';

export function badgeFor(product: Product): BadgeKind | null {
  if (!inStock(product)) return 'out';
  if (product.was && discountPercent(product.price, product.was) > 0) return 'discount';
  if (totalStock(product) <= LOW_STOCK) return 'low';
  if (product.isNew) return 'new';
  return null;
}

export function ProductBadge({ product }: { product: Product }) {
  const theme = useTheme();
  const { t, lang } = useLang();
  const kind = badgeFor(product);
  if (!kind) return null;

  const label =
    kind === 'out'
      ? t.product.soldOut
      : kind === 'discount'
        ? t.product.save(formatNumber(discountPercent(product.price, product.was ?? 0), lang))
        : kind === 'low'
          ? t.product.badgeLow
          : t.product.badgeNew;

  // SOLD OUT IS THE ONE THAT IS NOT ORANGE. The other three are reasons to
  // buy and share the brand colour; a sold-out sticker in the same orange
  // reads as a promotion from across a grid, and the customer only finds out
  // it is the opposite after tapping. Charcoal, which the app already uses for
  // its neutral chips.
  const background = kind === 'out' ? theme.inkSteel : theme.tint;

  return (
    // The hairline matters more than it looks. A product's fallback ground can
    // be the brand orange, and an orange badge on it vanished completely —
    // measured on the shop grid, where the discount badge on the compression
    // tee was invisible until the photograph loaded. A translucent white ring
    // separates it from any ground without being a colour of its own.
    <View
      style={[styles.badge, { backgroundColor: background }]}
      pointerEvents="none">
      <Text
        // Sold out is charcoal, where white is right; the other three are the
        // brand ember, and in the dark theme that ember is #ff7b17 — white on
        // it is 2.6:1.
        style={[styles.text, { color: kind === 'out' ? '#ffffff' : theme.onTint }]}
        accessibilityLabel={label}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    position: 'absolute',
    top: Spacing.two,
    start: Spacing.two,
    borderRadius: Radius.chip,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.55)',
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.half,
    maxWidth: '90%',
  },
  text: {
    // A raw Text, so the family is named here — see ui/button.tsx.
    fontFamily: Type.caption.family,
    fontSize: Type.caption.size,
    lineHeight: Type.caption.lineAr,
    fontWeight: '700',
  },
});
