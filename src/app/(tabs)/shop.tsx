import { useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ProductCard } from '@/components/product-card';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, MaxContentWidth, Spacing, TapTarget } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useCart } from '@/lib/cart';
import { categoryName, type CategoryId } from '@/lib/catalog';
import { useLang } from '@/lib/i18n';

type Sort = 'new' | 'low' | 'high';

export default function ShopScreen() {
  const theme = useTheme();
  const { t, lang, row, text } = useLang();
  const { products, categories } = useCart();
  const params = useLocalSearchParams<{ category?: string }>();

  // The tab is reachable both from the tab bar and from a category tile, so
  // the filter starts from the route and is then owned by the screen.
  const [filter, setFilter] = useState<CategoryId | 'all'>(
    (params.category as CategoryId | undefined) ?? 'all',
  );
  const [sort, setSort] = useState<Sort>('new');

  const shown = useMemo(() => {
    const list = filter === 'all' ? products : products.filter((p) => p.category === filter);
    if (sort === 'low') return [...list].sort((a, b) => a.price - b.price);
    if (sort === 'high') return [...list].sort((a, b) => b.price - a.price);
    return list;
  }, [products, filter, sort]);

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
      onPress={onPress}
      style={({ pressed }) => pressed && styles.pressed}>
      <ThemedView
        type={active ? 'backgroundSelected' : 'backgroundElement'}
        style={[styles.chip, { borderColor: active ? theme.tint : theme.border }]}>
        <ThemedText type="small" themeColor={active ? 'tint' : 'textSecondary'}>
          {label}
        </ThemedText>
      </ThemedView>
    </Pressable>
  );

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <ScrollView
        contentContainerStyle={[
          styles.scrollContent,
          { paddingBottom: BottomTabInset + Spacing.five },
        ]}
        showsVerticalScrollIndicator={false}
        stickyHeaderIndices={[0]}>
        {/* The filters stay on screen while the grid scrolls. On a phone the
            alternative is scrolling back to the top to change your mind. */}
        <ThemedView type="background" style={styles.filterBar}>
          <View style={styles.content}>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={[styles.chipRow, row]}>
              <Chip label={t.shop.all} active={filter === 'all'} onPress={() => setFilter('all')} />
              {categories.map((c) => (
                <Chip
                  key={c.id}
                  label={categoryName(c, lang)}
                  active={filter === c.id}
                  onPress={() => setFilter(c.id)}
                />
              ))}
            </ScrollView>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={[styles.chipRow, row]}>
              <Chip label={t.shop.sortNew} active={sort === 'new'} onPress={() => setSort('new')} />
              <Chip label={t.shop.sortLow} active={sort === 'low'} onPress={() => setSort('low')} />
              <Chip
                label={t.shop.sortHigh}
                active={sort === 'high'}
                onPress={() => setSort('high')}
              />
            </ScrollView>
          </View>
        </ThemedView>

        <View style={styles.content}>
          <ThemedText type="small" themeColor="textSecondary" style={text}>
            {t.shop.results(shown.length)}
          </ThemedText>

          {shown.length === 0 ? (
            <ThemedText style={[styles.empty, text]}>{t.shop.empty}</ThemedText>
          ) : (
            <View style={styles.grid}>
              {shown.map((p) => (
                <View key={p.slug} style={styles.gridItem}>
                  <ProductCard product={p} />
                </View>
              ))}
            </View>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: Spacing.five,
  },
  content: {
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
    paddingHorizontal: Spacing.three,
    gap: Spacing.two,
  },
  filterBar: {
    paddingTop: Spacing.two,
    paddingBottom: Spacing.two,
    gap: Spacing.two,
  },
  chipRow: {
    gap: Spacing.two,
    paddingVertical: Spacing.one,
  },
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
    gap: Spacing.three,
    marginTop: Spacing.one,
  },
  gridItem: {
    width: `${(100 - 4) / 2}%`,
  },
  empty: {
    marginTop: Spacing.five,
    textAlign: 'center',
  },
  pressed: {
    opacity: 0.7,
  },
});
