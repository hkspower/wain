import { Stack, useLocalSearchParams } from 'expo-router';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { PlaceCard } from '@/components/place-card';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { getPlace, getPlacesByCategory, priceLabels } from '@/lib/places';

export default function PlaceScreen() {
  const theme = useTheme();
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const place = getPlace(slug);

  if (!place) {
    return (
      <View style={styles.missing}>
        <Text style={styles.missingEmoji}>🧭</Text>
        <ThemedText type="smallBold">Wain are you going?</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          This place doesn’t exist — head back and pick a real one.
        </ThemedText>
      </View>
    );
  }

  const related = getPlacesByCategory(place.category)
    .filter((p) => p.slug !== place.slug)
    .slice(0, 2);

  return (
    <>
      <Stack.Screen options={{ title: place.name }} />
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}>
        <View style={styles.content}>
          {/* Banner */}
          <View style={[styles.banner, { backgroundColor: place.color }]}>
            <Text style={styles.bannerEmoji}>{place.emoji}</Text>
            <View style={styles.ratingBadge}>
              <Text style={styles.ratingText}>⭐ {place.rating.toFixed(1)}</Text>
            </View>
          </View>

          {/* Header */}
          <ThemedText type="subtitle" style={styles.name}>
            {place.name}
          </ThemedText>
          <ThemedText themeColor="textSecondary" style={styles.nameAr}>
            {place.nameAr}
          </ThemedText>

          <View style={styles.chipRow}>
            <ThemedView type="tintSoft" style={styles.chip}>
              <ThemedText type="small" themeColor="tint">
                {place.category}
              </ThemedText>
            </ThemedView>
            <ThemedView type="sandSoft" style={styles.chip}>
              <ThemedText type="small" themeColor="sand">
                KD {'•'.repeat(place.priceLevel)} · {priceLabels[place.priceLevel - 1]}
              </ThemedText>
            </ThemedView>
          </View>

          <ThemedText type="small" themeColor="textSecondary" style={styles.area}>
            📍 {place.area}, Kuwait
          </ThemedText>

          <ThemedText style={styles.description}>{place.description}</ThemedText>

          {/* Highlights */}
          <ThemedView
            type="backgroundElement"
            style={[styles.infoCard, { borderColor: theme.border }]}>
            <ThemedText type="smallBold" style={styles.infoTitle}>
              ✨ Highlights
            </ThemedText>
            {place.highlights.map((h) => (
              <View key={h} style={styles.highlightRow}>
                <ThemedText type="small" themeColor="tint">
                  ✓
                </ThemedText>
                <ThemedText type="small" themeColor="textSecondary" style={styles.highlightText}>
                  {h}
                </ThemedText>
              </View>
            ))}
          </ThemedView>

          <ThemedView
            type="backgroundElement"
            style={[styles.infoCard, { borderColor: theme.border }]}>
            <ThemedText type="smallBold" style={styles.infoTitle}>
              🕐 Best time to visit
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {place.bestTime}
            </ThemedText>
          </ThemedView>

          {/* Related */}
          {related.length > 0 && (
            <>
              <ThemedText type="smallBold" style={styles.relatedTitle}>
                More {place.category.toLowerCase()}
              </ThemedText>
              <View style={styles.relatedList}>
                {related.map((p) => (
                  <PlaceCard key={p.slug} place={p} />
                ))}
              </View>
            </>
          )}
        </View>
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  scrollContent: {
    alignItems: 'center',
    paddingBottom: Spacing.six,
  },
  content: {
    width: '100%',
    maxWidth: MaxContentWidth,
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.three,
  },
  banner: {
    height: 180,
    borderRadius: Spacing.four,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.four,
  },
  bannerEmoji: {
    fontSize: 72,
  },
  ratingBadge: {
    position: 'absolute',
    top: Spacing.three,
    right: Spacing.three,
    backgroundColor: 'rgba(255,255,255,0.92)',
    borderRadius: 999,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.half,
  },
  ratingText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#1e293b',
  },
  name: {
    fontSize: 28,
    lineHeight: 36,
  },
  nameAr: {
    fontSize: 18,
    marginTop: Spacing.half,
  },
  chipRow: {
    flexDirection: 'row',
    gap: Spacing.two,
    marginTop: Spacing.three,
    flexWrap: 'wrap',
  },
  chip: {
    borderRadius: 999,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one,
  },
  area: {
    marginTop: Spacing.two,
  },
  description: {
    marginTop: Spacing.three,
    lineHeight: 26,
  },
  infoCard: {
    borderRadius: Spacing.three,
    borderWidth: 1,
    padding: Spacing.three,
    marginTop: Spacing.three,
    gap: Spacing.two,
  },
  infoTitle: {
    fontSize: 15,
  },
  highlightRow: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  highlightText: {
    flex: 1,
  },
  relatedTitle: {
    fontSize: 18,
    marginTop: Spacing.five,
    marginBottom: Spacing.three,
  },
  relatedList: {
    gap: Spacing.three,
  },
  missing: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    padding: Spacing.four,
  },
  missingEmoji: {
    fontSize: 40,
  },
});
