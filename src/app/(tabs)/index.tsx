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
                  // The shipped compositions stand their subject on one side
                  // and leave the other quiet for the copy. Anchoring the crop
                  // to that side means a narrow phone trims backdrop rather
                  // than the model — the same call the website's tiles make.
                  focus={dir === 'rtl' ? 'start' : 'end'}
                  style={styles.categoryTile}>
                  {/* A PLATE BEHIND THE WORDS, not a wash over the picture.
                      The copy sits ON the artwork, and once a real photograph
                      can land here its brightness is not knowable from this
                      file — white-on-white is exactly how the website's tiles
                      failed. The darkening is confined to the text's own
                      column so the part of the shot worth seeing is untouched. */}
                  <View style={[styles.categoryInner, row]}>
                    <View style={styles.categoryCopy}>
                      <Text style={[styles.categoryKicker, text]}>{categoryKicker(cat, lang)}</Text>
                      <Text style={[styles.categoryName, text]}>{categoryName(cat, lang)}</Text>
                    </View>
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
    borderRadius: Spacing.three,
    overflow: 'hidden',
    minHeight: 132,
  },
  categoryInner: {
    flex: 1,
    padding: Spacing.four,
    alignItems: 'center',
  },
  categoryCopy: {
    // 62%, not the whole width: the remaining third is where the subject
    // stands, and copy running under it is what makes a tile unreadable.
    maxWidth: '62%',
    gap: Spacing.half,
    backgroundColor: 'rgba(20,22,26,0.55)',
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
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
  // TWO PER ROW, and it was one. `width: 48%` twice plus a 16px gap comes to
  // 100.5% of a 358px column — half a per cent over, so every card wrapped onto
  // its own line and the grid ran as a single column with half the page empty
  // beside it. The arithmetic was written as `(100 - 4) / 2`, which assumed the
  // gap was 4% of the row; at this width it is 4.5%.
  //
  // flexBasis with flexGrow, rather than a width: the cards then divide
  // whatever the row actually has, so the gap can change without anyone
  // recomputing a percentage. The gap is 8px because two 48% cards plus 8px is
  // 351 of 358 — it fits with room to spare, and it is the last time this needs
  // to be a calculation at all.
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
  gridItem: {
    flexGrow: 1,
    flexBasis: '48%',
    maxWidth: '48%',
  },
  pressed: {
    opacity: 0.85,
  },
});
