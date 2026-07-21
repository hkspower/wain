import { Link } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { Place } from '@/lib/places';

export function PlaceCard({ place }: { place: Place }) {
  const theme = useTheme();

  return (
    <Link href={{ pathname: '/place/[slug]', params: { slug: place.slug } }} asChild>
      <Pressable style={({ pressed }) => pressed && styles.pressed}>
        <ThemedView
          type="backgroundElement"
          style={[styles.card, { borderColor: theme.border }]}>
          <View style={[styles.banner, { backgroundColor: place.color }]}>
            <Text style={styles.bannerEmoji}>{place.emoji}</Text>
            <View style={styles.ratingBadge}>
              <Text style={styles.ratingText}>⭐ {place.rating.toFixed(1)}</Text>
            </View>
          </View>

          <View style={styles.body}>
            <View style={styles.titleRow}>
              <ThemedText type="smallBold" style={styles.name} numberOfLines={1}>
                {place.name}
              </ThemedText>
              <ThemedText type="small" themeColor="sand">
                KD {'•'.repeat(place.priceLevel)}
              </ThemedText>
            </View>
            <ThemedText type="small" themeColor="textSecondary">
              {place.nameAr}
            </ThemedText>
            <ThemedText
              type="small"
              themeColor="textSecondary"
              numberOfLines={2}
              style={styles.tagline}>
              {place.tagline}
            </ThemedText>
            <View style={styles.metaRow}>
              <ThemedView type="tintSoft" style={styles.categoryChip}>
                <ThemedText type="small" themeColor="tint">
                  {place.category}
                </ThemedText>
              </ThemedView>
              <ThemedText type="small" themeColor="textSecondary">
                📍 {place.area}
              </ThemedText>
            </View>
          </View>
        </ThemedView>
      </Pressable>
    </Link>
  );
}

const styles = StyleSheet.create({
  pressed: {
    opacity: 0.85,
  },
  card: {
    borderRadius: Spacing.three,
    borderWidth: 1,
    overflow: 'hidden',
  },
  banner: {
    height: 120,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bannerEmoji: {
    fontSize: 52,
  },
  ratingBadge: {
    position: 'absolute',
    top: Spacing.two,
    right: Spacing.two,
    backgroundColor: 'rgba(255,255,255,0.92)',
    borderRadius: 999,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.half,
  },
  ratingText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#1e293b',
  },
  body: {
    padding: Spacing.three,
    gap: Spacing.half,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
  },
  name: {
    flex: 1,
    fontSize: 16,
  },
  tagline: {
    marginTop: Spacing.one,
  },
  metaRow: {
    marginTop: Spacing.two,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  categoryChip: {
    borderRadius: 999,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.half,
  },
});
