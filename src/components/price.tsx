import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useLang } from '@/lib/i18n';
import { discountPercent, formatNumber, formatPrice, type Fils } from '@/lib/money';

/**
 * A price, with its old price and saving when there is one.
 *
 * The saving is a percentage on a solid chip rather than a struck-through
 * number alone: "was 20.000" asks the customer to do the arithmetic, and most
 * of them will not.
 */
export function Price({
  price,
  was,
  size = 'default',
}: {
  price: Fils;
  was?: Fils;
  size?: 'default' | 'large';
}) {
  const { lang, row, t } = useLang();
  const off = was ? discountPercent(price, was) : 0;

  return (
    <View style={[row, styles.wrap]}>
      {/* The price has its own role. It is the one number a customer reads
          before anything else on the card, and it was borrowing the heading
          size — which meant it changed whenever a heading did. */}
      <ThemedText type={size === 'large' ? 'display' : 'price'}>
        {formatPrice(price, lang)}
      </ThemedText>
      {off > 0 && was ? (
        <>
          <ThemedText type="label" themeColor="textSecondary" style={styles.was}>
            {formatPrice(was, lang)}
          </ThemedText>
          <View style={styles.saveChip}>
            <ThemedText type="label" style={styles.saveText}>
              {t.product.save(formatNumber(off, lang))}
            </ThemedText>
          </View>
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    gap: Spacing.two,
    flexWrap: 'wrap',
  },
  was: {
    textDecorationLine: 'line-through',
  },
  // Charcoal, not red. The whole storefront is ember on charcoal, and a red
  // sale badge would be the only red in the app.
  saveChip: {
    backgroundColor: '#363d45',
    borderRadius: 999,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.half,
  },
  saveText: {
    color: '#ffffff',
    fontWeight: '700',
  },
});
