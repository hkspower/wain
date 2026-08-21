import { useRouter } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ProductCard } from '@/components/product-card';
import { RemoteArt } from '@/components/remote-art';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, MaxContentWidth, Spacing, TapTarget } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useCart } from '@/lib/cart';
import { categoryArt } from '@/lib/assets';
import { categoryKicker, categoryName } from '@/lib/catalog';
import { useLang } from '@/lib/i18n';

export default function HomeScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { t, lang, dir, row, text } = useLang();
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
                <RemoteArt
                  uri={categoryArt(cat.id)}
                  ground={cat.color}
                  emoji={cat.emoji}
                  emojiSize={40}
                  // The compositions stand their subject on one side and leave
                  // the other quiet for the copy, so the crop is anchored to
                  // the subject's side: a narrow phone trims backdrop rather
                  // than the model.
                  focus={dir === 'rtl' ? 'start' : 'end'}
                  style={styles.categoryTile}>
                  {/* Copy on the reading side, sitting straight on the
                      artwork. No plate: the tiles the owner sent are composed
                      dark under the text, and a box drawn over them is a
                      different design. The ground under the picture is
                      charcoal for the same reason — see catalog.ts. */}
                  <View style={[styles.categoryInner, row]}>
                    <View style={styles.categoryCopy}>
                      {cat.badge ? (
                        <View style={styles.categoryBadge}>
                          <Text style={styles.categoryBadgeText}>{categoryKicker(cat, lang)}</Text>
                        </View>
                      ) : (
                        <Text style={[styles.categoryKicker, text]}>
                          {categoryKicker(cat, lang)}
                        </Text>
                      )}
                      <Text style={[styles.categoryName, text]}>{categoryName(cat, lang)}</Text>
                    </View>
                  </View>

                  {/* The arrow chip, in the corner opposite the copy. It points
                      the way the language reads — up-and-forward — so it is
                      mirrored rather than rotated. */}
                  <View style={[styles.arrowChip, dir === 'rtl' ? styles.arrowStart : styles.arrowEnd]}>
                    <Text style={styles.arrowGlyph}>{dir === 'rtl' ? '↖' : '↗'}</Text>
                  </View>
                </RemoteArt>
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
    // 1.69:1, measured off the tiles the owner sent. Tall enough for a standing
    // figure to be a figure rather than a band across the middle.
    borderRadius: Spacing.four,
    overflow: 'hidden',
    minHeight: 212,
  },
  categoryInner: {
    flex: 1,
    paddingHorizontal: Spacing.four,
    alignItems: 'center',
  },
  categoryCopy: {
    // Just over half: the rest is where the subject stands, and copy running
    // under it is what makes a tile unreadable.
    maxWidth: '55%',
    gap: Spacing.one,
  },
  categoryKicker: {
    color: 'rgba(255,255,255,0.78)',
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: 0.5,
  },
  categoryBadge: {
    alignSelf: 'flex-start',
    backgroundColor: '#e0561c',
    borderRadius: 999,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one,
  },
  categoryBadgeText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '700',
  },
  categoryName: {
    color: '#ffffff',
    fontSize: 30,
    lineHeight: 40,
    fontWeight: '700',
  },
  arrowChip: {
    position: 'absolute',
    bottom: Spacing.three,
    width: 44,
    height: 44,
    borderRadius: 999,
    backgroundColor: '#e0561c',
    alignItems: 'center',
    justifyContent: 'center',
  },
  arrowStart: { start: Spacing.three },
  arrowEnd: { end: Spacing.three },
  arrowGlyph: {
    color: '#ffffff',
    fontSize: 20,
    fontWeight: '700',
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
