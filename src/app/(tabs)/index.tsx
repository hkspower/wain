import { useRouter } from 'expo-router';
import React, { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { press } from '@/components/ui/press';
import { Screen } from '@/components/ui/screen';
import { SafeAreaView } from 'react-native-safe-area-context';

import { HeroSlider } from '@/components/hero-slider';
import { ProductCard } from '@/components/product-card';
import { RemoteArt } from '@/components/remote-art';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { EMBER_ON_ART, Radius, Spacing, TapTarget, Type } from '@/constants/theme';
import { useCart } from '@/lib/cart';
import { useTheme } from '@/hooks/use-theme';
import { categoryArt } from '@/lib/assets';
import { bundledCategoryArt } from '@/lib/category-art';
import { brandsFromProducts, categoryKicker, categoryName } from '@/lib/catalog';
import { useLang } from '@/lib/i18n';

export default function HomeScreen() {
  const router = useRouter();
  const theme = useTheme();
  const { t, lang, dir, row, text } = useLang();
  const { products, categories } = useCart();
  const featured = products.filter((p) => p.featured).slice(0, 4);
  const brandTiles = useMemo(() => brandsFromProducts(products), [products]);

  return (
    <Screen tabBar>
          {/* The shop's own banners, as the website runs them. The headline,
              the Arabic line and the mark are set into each photograph, so
              nothing is written on top of them — see components/hero-slider. */}
          <HeroSlider />

          {/* BRAND SELECTOR — a clean row of names, not a wall of logos.
              Replaces the removed brand-logo strip: that one grew to "dozens
              of brand logos" (its own words) because it drew every uploaded
              logo at once with no way to keep the row short. This is text,
              which does not have that failure mode — it stays one line of
              names whether the catalogue carries three brands or thirty.

              LINKS, DOES NOT FILTER: tapping a name opens /brand/<slug>, a
              page of its own with the brand as a heading — the same shape as
              the category tiles above. It does not add a filter control to
              /shop itself, which was deliberately stripped of every one on
              2026-09-09 ("the shop narrows nothing") because a hidden
              parameter left no way to tell the grid was narrowed, or back out
              of it. A dedicated page is narrowed IN THE OPEN: the heading
              says so and the tab bar is the way out. */}
          {brandTiles.length > 0 && (
            <>
              <ThemedText type="labelBold" style={[styles.sectionTitle, text]}>
                {t.home.brands}
              </ThemedText>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={[styles.brandRow, row]}>
                {brandTiles.map((b, i) => (
                  <React.Fragment key={b.slug}>
                    {i > 0 && <Text style={styles.brandDivider}>|</Text>}
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={b.name}
                      onPress={() => router.push(`/brand/${b.slug}`)}
                      style={press(false, styles.brandTap)}>
                      <Text style={[styles.brandName, { color: theme.text }]}>{b.name.toUpperCase()}</Text>
                    </Pressable>
                  </React.Fragment>
                ))}
              </ScrollView>
            </>
          )}

          {/* Categories — FULL WIDTH, one per row. They carry the shop's four
              doors and a half-width tile makes each one a thumbnail. */}
          <ThemedText type="labelBold" style={[styles.sectionTitle, text]}>
            {t.home.categories}
          </ThemedText>
          <View style={styles.categoryList}>
            {categories.map((cat) => (
              <Pressable
                key={cat.id}
                accessibilityRole="button"
                accessibilityLabel={categoryName(cat, lang)}
                onPress={() => router.push(`/category/${cat.id}`)}
                style={press()}>
                <RemoteArt
                  uri={categoryArt(cat.id, dir)}
                  bundled={bundledCategoryArt(cat.id, dir)}
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
          <ThemedText type="labelBold" style={[styles.sectionTitle, text]}>
            {t.home.featured}
          </ThemedText>
          <View style={styles.grid}>
            {featured.map((p) => (
              <View key={p.slug} style={styles.gridItem}>
                <ProductCard product={p} />
              </View>
            ))}
          </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  sectionTitle: { marginTop: Spacing.two },
  brandRow: {
    alignItems: 'center',
    gap: Spacing.three,
    paddingVertical: Spacing.one,
  },
  brandName: {
    fontFamily: Type.labelBold.family,
    fontSize: Type.label.size,
    letterSpacing: 0.5,
    fontWeight: '700',
  },
  // The name alone was an 18px-tall target; the row is spaced for a thumb,
  // so the press area grows to the shared minimum without moving the text.
  brandTap: { minHeight: TapTarget, justifyContent: 'center' },
  // A plain divider, not a button of its own — it separates two brands and
  // is never itself tappable, so it carries no press style.
  brandDivider: {
    color: 'rgba(255,255,255,0.25)',
    fontSize: Type.label.size,
  },
  categoryList: {
    gap: Spacing.two,
  },
  categoryTile: {
    // 1.69:1, measured off the tiles the owner sent. Tall enough for a standing
    // figure to be a figure rather than a band across the middle.
    borderRadius: Radius.card,
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
    fontFamily: Type.label.family,
    fontSize: Type.label.size,
    color: 'rgba(255,255,255,0.78)',
    fontWeight: '600',
    letterSpacing: 0.5,
  },
  categoryBadge: {
    alignSelf: 'flex-start',
    backgroundColor: EMBER_ON_ART,
    borderRadius: 999,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one,
  },
  categoryBadgeText: {
    fontFamily: Type.labelBold.family,
    fontSize: Type.label.size,
    color: '#ffffff',
    fontWeight: '700',
  },
  categoryName: {
    fontFamily: Type.display.family,
    fontSize: Type.display.size,
    lineHeight: Type.display.lineAr,
    color: '#ffffff',
    fontWeight: '700',
  },
  arrowChip: {
    position: 'absolute',
    bottom: Spacing.three,
    width: 44,
    height: 44,
    borderRadius: 999,
    backgroundColor: EMBER_ON_ART,
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
});
