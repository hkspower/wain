import { useRouter } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ProductCard } from '@/components/product-card';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, MaxContentWidth, Spacing, TapTarget } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useCart } from '@/lib/cart';
import { categoryKicker, categoryName } from '@/lib/catalog';
import { useLang } from '@/lib/i18n';

export default function HomeScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { t, lang, row, text } = useLang();
  const { products, categories } = useCart();
  const featured = products.filter((p) => p.featured).slice(0, 4);

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <ScrollView
        contentContainerStyle={[
          styles.scrollContent,
          { paddingBottom: BottomTabInset + Spacing.five },
        ]}
        showsVerticalScrollIndicator={false}>
        <View style={styles.content}>
          {/* Hero. Charcoal panel, ember button — the storefront's own
              proportions: the picture is the product grid below, not the
              banner, so the banner stays quiet. */}
          <ThemedView type="inkSilver" style={styles.hero}>
            <ThemedText type="small" style={[styles.heroKicker, text]}>
              {t.home.heroKicker}
            </ThemedText>
            <Text style={[styles.heroTitle, text]}>{t.home.heroTitle}</Text>
            <Text style={[styles.heroText, text]}>{t.home.heroText}</Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => router.push('/shop')}
              style={({ pressed }) => [
                styles.heroButton,
                { backgroundColor: theme.tint },
                pressed && styles.pressed,
              ]}>
              <Text style={styles.heroButtonText}>{t.home.shopNow}</Text>
            </Pressable>
          </ThemedView>

          {/* Categories — FULL WIDTH, one per row. They carry the shop's four
              doors and a half-width tile makes each one a thumbnail. */}
          <ThemedText type="smallBold" style={[styles.sectionTitle, text]}>
            {t.home.categories}
          </ThemedText>
          <View style={styles.categoryList}>
            {categories.map((cat) => (
              <Pressable
                key={cat.id}
                accessibilityRole="button"
                accessibilityLabel={categoryName(cat, lang)}
                onPress={() => router.push({ pathname: '/shop', params: { category: cat.id } })}
                style={({ pressed }) => pressed && styles.pressed}>
                <View style={[styles.categoryTile, row, { backgroundColor: cat.color }]}>
                  <View style={styles.categoryCopy}>
                    <Text style={[styles.categoryKicker, text]}>{categoryKicker(cat, lang)}</Text>
                    <Text style={[styles.categoryName, text]}>{categoryName(cat, lang)}</Text>
                  </View>
                  <Text style={styles.categoryEmoji}>{cat.emoji}</Text>
                </View>
              </Pressable>
            ))}
          </View>

          {/* Featured */}
          <ThemedText type="smallBold" style={[styles.sectionTitle, text]}>
            {t.home.featured}
          </ThemedText>
          <View style={styles.grid}>
            {featured.map((p) => (
              <View key={p.slug} style={styles.gridItem}>
                <ProductCard product={p} />
              </View>
            ))}
          </View>
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
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.three,
  },
  content: {
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
    gap: Spacing.three,
  },
  hero: {
    borderRadius: Spacing.four,
    padding: Spacing.four,
    gap: Spacing.two,
  },
  heroKicker: {
    color: '#ff7b17',
    fontWeight: '700',
    letterSpacing: 1,
  },
  heroTitle: {
    color: '#ffffff',
    fontSize: 32,
    lineHeight: 42,
    fontWeight: '700',
  },
  heroText: {
    color: 'rgba(255,255,255,0.86)',
    fontSize: 15,
    lineHeight: 24,
  },
  heroButton: {
    marginTop: Spacing.two,
    minHeight: TapTarget,
    borderRadius: Spacing.three,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.four,
  },
  heroButtonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '700',
  },
  sectionTitle: {
    marginTop: Spacing.two,
    fontSize: 16,
  },
  categoryList: {
    gap: Spacing.two,
  },
  categoryTile: {
    borderRadius: Spacing.three,
    padding: Spacing.four,
    minHeight: 104,
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  categoryCopy: {
    flex: 1,
    gap: Spacing.half,
  },
  categoryKicker: {
    color: 'rgba(255,255,255,0.82)',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1,
  },
  categoryName: {
    color: '#ffffff',
    fontSize: 24,
    fontWeight: '700',
  },
  categoryEmoji: {
    fontSize: 40,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.three,
  },
  gridItem: {
    // Two per row with one gap between them. The percentage is written out
    // rather than computed so it stays readable: (100% - gap) / 2.
    width: `${(100 - 4) / 2}%`,
  },
  pressed: {
    opacity: 0.85,
  },
});
