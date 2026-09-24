import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useMemo, useRef } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { press } from '@/components/ui/press';
import { ContentColumn, Screen } from '@/components/ui/screen';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ProductCard } from '@/components/product-card';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, Spacing, TapTarget } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useWindowWidth } from '@/hooks/use-window-width';
import { useCart } from '@/lib/cart';
import { formatNumber } from '@/lib/money';
import { useLang } from '@/lib/i18n';
import { categories, CategoryId, categoryName } from '@/lib/catalog';

type Sort = 'new' | 'low' | 'high';

const SHOP_MAX_WIDTH = 1400;

// Same fixed breakpoint columns and gaps as (tabs)/shop.tsx — see that
// file's own comment for why 768/1024 and these exact gap numbers.
const TABLET_MIN = 768;
const DESKTOP_MIN = 1024;
const DESKTOP_COLUMNS = 4;
const TABLET_COLUMNS = 3;
const MOBILE_COLUMNS = 2;
const GAP_DESKTOP = 22;
const GAP_MOBILE = 11;

/**
 * ONE PAGE PER CATEGORY at export time. Without this, `expo export` renders a
 * single category/[id].html with the literal id "[id]", which matches no
 * category, so the static HTML is the "nothing here" branch while the browser
 * renders the real page — React error #418 (hydration mismatch) on every
 * category visit, and the whole tree thrown away and redrawn. Read from the
 * same `categories` list the screen looks ids up in, so a new category is
 * exported the day it is added.
 */
export function generateStaticParams(): { id: string }[] {
  return categories.map((c) => ({ id: c.id }));
}

export default function CategoryScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const theme = useTheme();
  const { t, lang, dir, row, text } = useLang();
  const { products } = useCart();

  const category = categories.find((c) => c.id === id);
  const categoryId = id as CategoryId;

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

  const categoryProducts = useMemo(
    () => products.filter((p) => p.category === categoryId),
    [products, categoryId],
  );

  const shown = useMemo(() => {
    if (sort === 'low') return [...categoryProducts].sort((a, b) => a.price - b.price);
    if (sort === 'high') return [...categoryProducts].sort((a, b) => b.price - a.price);
    return categoryProducts;
  }, [categoryProducts, sort]);

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

  if (!category) {
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
      <ThemedText type="labelBold" style={[styles.categoryTitle, text]}>
        {categoryName(category, lang)}
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
  categoryTitle: {
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
    // gap set inline — see (tabs)/shop.tsx's own note on this.
    marginTop: Spacing.one,
  },
  empty: {
    marginTop: Spacing.five,
    textAlign: 'center',
  },
});
