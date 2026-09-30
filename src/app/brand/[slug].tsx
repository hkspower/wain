import { useLocalSearchParams } from 'expo-router';
import React, { useMemo, useRef } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { press } from '@/components/ui/press';
import { ContentColumn, Screen } from '@/components/ui/screen';

import { ProductCard } from '@/components/product-card';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing, TapTarget } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useWindowWidth } from '@/hooks/use-window-width';
import { useCart } from '@/lib/cart';
import { formatNumber } from '@/lib/money';
import { useLang } from '@/lib/i18n';
import { brandSlug } from '@/lib/catalog';

type Sort = 'new' | 'low' | 'high';

const SHOP_MAX_WIDTH = 1400;

// Same fixed breakpoint columns and gaps as (tabs)/shop.tsx and
// category/[id].tsx — see (tabs)/shop.tsx's own comment for why.
const TABLET_MIN = 768;
const DESKTOP_MIN = 1024;
const DESKTOP_COLUMNS = 4;
const TABLET_COLUMNS = 3;
const MOBILE_COLUMNS = 2;
const GAP_DESKTOP = 22;
const GAP_MOBILE = 11;

/**
 * A brand page, not a filter on the shop screen. Deliberately: 2026-09-09
 * removed every on-page filter control from /shop on the owner's own
 * instruction ("the shop narrows nothing"), because a hidden `?category=`
 * param left a customer looking at a subset of the shop with nothing on
 * screen saying so and no way back to "all". This screen avoids that the
 * same way category/[id].tsx already does: it is its own destination, with
 * the brand's name as a heading and the tab bar as the way out — narrowed,
 * and visibly so, rather than narrowed and silent.
 */
export default function BrandScreen() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const theme = useTheme();
  const { t, lang, dir, row, text } = useLang();
  const { products } = useCart();

  const sortRow = useRef<ScrollView>(null);

  const startAtReadingEdge = (ref: React.RefObject<ScrollView | null>) => () => {
    if (dir !== 'rtl') return;
    ref.current?.scrollToEnd({ animated: false });
    requestAnimationFrame(() => ref.current?.scrollToEnd({ animated: false }));
  };

  const windowWidth = useWindowWidth();
  const contentWidth = Math.max(320, Math.min(windowWidth, SHOP_MAX_WIDTH) - Spacing.three * 2);
  const columns =
    windowWidth >= DESKTOP_MIN ? DESKTOP_COLUMNS : windowWidth >= TABLET_MIN ? TABLET_COLUMNS : MOBILE_COLUMNS;
  const gap = windowWidth >= TABLET_MIN ? GAP_DESKTOP : GAP_MOBILE;
  const cardWidth = (contentWidth - gap * (columns - 1)) / columns;

  const [sort, setSortState] = React.useState<Sort>('new');

  // The display name comes from the first product that matches, rather than
  // being re-derived from the slug — "ATE" would otherwise print as "Ate".
  const brandName = useMemo(
    () => products.find((p) => brandSlug(p.brand) === slug)?.brand ?? '',
    [products, slug],
  );

  const brandProducts = useMemo(
    () => products.filter((p) => brandSlug(p.brand) === slug),
    [products, slug],
  );

  const shown = useMemo(() => {
    if (sort === 'low') return [...brandProducts].sort((a, b) => a.price - b.price);
    if (sort === 'high') return [...brandProducts].sort((a, b) => b.price - a.price);
    return brandProducts;
  }, [brandProducts, sort]);

  const Chip = ({
    label,
    active,
    onPress,
  }: {
    label: string;
    active: boolean;
    onPress: () => void;
  }) => (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      aria-pressed={active}
      onPress={onPress}
      style={press(false, styles.chipHit)}>
      <ThemedView
        type={active ? 'backgroundSelected' : 'backgroundElement'}
        style={[styles.chip, { borderColor: active ? theme.tint : theme.controlBorder }]}>
        <ThemedText type="label" themeColor={active ? 'tintText' : 'textSecondary'}>
          {label}
        </ThemedText>
      </ThemedView>
    </Pressable>
  );

  if (!brandName) {
    return (
      <Screen>
        <ContentColumn>
          <ThemedText>{t.shop.empty}</ThemedText>
        </ContentColumn>
      </Screen>
    );
  }

  return (
    <Screen
      tabBar
      contentMaxWidth={SHOP_MAX_WIDTH}
      stickyHeader={
        <ThemedView type="background" style={styles.sortBar}>
          <ContentColumn style={{ maxWidth: SHOP_MAX_WIDTH }}>
            <ScrollView
              ref={sortRow}
              horizontal
              showsHorizontalScrollIndicator={false}
              onContentSizeChange={startAtReadingEdge(sortRow)}
              contentContainerStyle={[styles.chipRow, row]}>
              <Chip label={t.shop.sortNew} active={sort === 'new'} onPress={() => setSortState('new')} />
              <Chip label={t.shop.sortLow} active={sort === 'low'} onPress={() => setSortState('low')} />
              <Chip
                label={t.shop.sortHigh}
                active={sort === 'high'}
                onPress={() => setSortState('high')}
              />
            </ScrollView>
          </ContentColumn>
        </ThemedView>
      }>
      <ThemedText type="labelBold" style={[styles.brandTitle, text]}>
        {brandName}
      </ThemedText>
      <ThemedText type="label" themeColor="textSecondary" style={text}>
        {t.shop.results(formatNumber(shown.length, lang), shown.length === 1)}
      </ThemedText>

      {shown.length === 0 ? (
        <ThemedText style={[styles.empty, text]}>{t.shop.empty}</ThemedText>
      ) : (
        <View style={[styles.grid, { gap }]}>
          {shown.map((p) => (
            <View key={p.slug} style={{ width: cardWidth, flexShrink: 0 }}>
              <ProductCard product={p} />
            </View>
          ))}
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  sortBar: {
    paddingTop: Spacing.two,
    paddingBottom: Spacing.two,
    gap: Spacing.two,
  },
  brandTitle: {
    marginBottom: Spacing.one,
  },
  chipRow: {
    gap: Spacing.two,
    paddingVertical: Spacing.one,
  },
  chipHit: { minHeight: TapTarget, justifyContent: 'center' },
  chip: {
    minHeight: TapTarget - 12,
    justifyContent: 'center',
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: Spacing.three,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: Spacing.one,
  },
  empty: {
    marginTop: Spacing.five,
    textAlign: 'center',
  },
});
