import { Link, useRouter } from 'expo-router';
import Head from 'expo-router/head';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PlaceCard } from '@/components/place-card';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { categories } from '@/lib/places';
import { usePlaces } from '@/lib/places-store';

export default function HomeScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { getFeatured } = usePlaces();
  const featured = getFeatured();

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <Head>
        <title>Wain? — where shall we go in Kuwait?</title>
      </Head>
      <ScrollView
        contentContainerStyle={[styles.scrollContent, { paddingBottom: BottomTabInset + Spacing.five }]}
        showsVerticalScrollIndicator={false}>
        <View style={styles.content}>
          {/* Hero */}
          <View style={styles.hero}>
            <ThemedView type="tintSoft" style={styles.heroBadge}>
              <ThemedText type="small" themeColor="tint">
                🇰🇼 Your guide to Kuwait
              </ThemedText>
            </ThemedView>
            <ThemedText type="subtitle" style={styles.heroTitle}>
              Wain nrooh?{'\n'}
              <Text style={{ color: theme.tint }}>We know where.</Text>
            </ThemedText>
            <ThemedText themeColor="textSecondary" style={styles.heroText}>
              وين نروح؟ — the question every group chat asks. Wain answers it with
              the best landmarks, food, beaches, and hidden gems across Kuwait.
            </ThemedText>
            <Pressable
              onPress={() => router.push('/explore')}
              style={({ pressed }) => [
                styles.heroButton,
                { backgroundColor: theme.tint },
                pressed && styles.pressed,
              ]}>
              <Text style={styles.heroButtonText}>Start exploring →</Text>
            </Pressable>
          </View>

          {/* Categories */}
          <ThemedText type="smallBold" style={styles.sectionTitle}>
            Browse by mood
          </ThemedText>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.categoryRow}>
            {categories.map((cat) => (
              <Pressable
                key={cat.name}
                onPress={() =>
                  router.push({ pathname: '/explore', params: { category: cat.name } })
                }
                style={({ pressed }) => pressed && styles.pressed}>
                <ThemedView
                  type="backgroundElement"
                  style={[styles.categoryCard, { borderColor: theme.border }]}>
                  <Text style={styles.categoryEmoji}>{cat.emoji}</Text>
                  <ThemedText type="smallBold">{cat.name}</ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">
                    {cat.blurb}
                  </ThemedText>
                </ThemedView>
              </Pressable>
            ))}
          </ScrollView>

          {/* Featured */}
          <View style={styles.featuredHeader}>
            <ThemedText type="smallBold" style={styles.sectionTitle}>
              Featured this week
            </ThemedText>
            <Link href="/explore" asChild>
              <Pressable style={({ pressed }) => pressed && styles.pressed}>
                <ThemedText type="small" themeColor="tint">
                  View all →
                </ThemedText>
              </Pressable>
            </Link>
          </View>
          <View style={styles.featuredList}>
            {featured.map((place) => (
              <PlaceCard key={place.slug} place={place} />
            ))}
          </View>

          {/* About link */}
          <Link href="/about" asChild>
            <Pressable style={({ pressed }) => pressed && styles.pressed}>
              <ThemedView
                type="backgroundElement"
                style={[styles.aboutCard, { borderColor: theme.border }]}>
                <Text style={styles.aboutEmoji}>🧭</Text>
                <View style={styles.aboutTextWrap}>
                  <ThemedText type="smallBold">What is Wain?</ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">
                    The story behind the app — and the question it answers.
                  </ThemedText>
                </View>
                <ThemedText themeColor="tint">→</ThemedText>
              </ThemedView>
            </Pressable>
          </Link>
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
    alignItems: 'center',
  },
  content: {
    width: '100%',
    maxWidth: MaxContentWidth,
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.four,
  },
  hero: {
    alignItems: 'flex-start',
    gap: Spacing.three,
    marginBottom: Spacing.five,
  },
  heroBadge: {
    borderRadius: 999,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one,
  },
  heroTitle: {
    fontSize: 34,
    lineHeight: 42,
  },
  heroText: {
    fontSize: 15,
    lineHeight: 22,
  },
  heroButton: {
    borderRadius: Spacing.three,
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.three,
  },
  heroButtonText: {
    color: '#ffffff',
    fontWeight: '700',
    fontSize: 15,
  },
  pressed: {
    opacity: 0.8,
  },
  sectionTitle: {
    fontSize: 18,
    marginBottom: Spacing.three,
  },
  categoryRow: {
    gap: Spacing.two,
    paddingBottom: Spacing.five,
  },
  categoryCard: {
    width: 170,
    borderRadius: Spacing.three,
    borderWidth: 1,
    padding: Spacing.three,
    gap: Spacing.one,
  },
  categoryEmoji: {
    fontSize: 26,
  },
  featuredHeader: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
  },
  featuredList: {
    gap: Spacing.three,
    marginBottom: Spacing.five,
  },
  aboutCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    borderRadius: Spacing.three,
    borderWidth: 1,
    padding: Spacing.three,
  },
  aboutEmoji: {
    fontSize: 26,
  },
  aboutTextWrap: {
    flex: 1,
    gap: Spacing.half,
  },
});
