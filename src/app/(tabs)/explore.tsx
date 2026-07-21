import { useLocalSearchParams } from 'expo-router';
import Head from 'expo-router/head';
import { useMemo, useState } from 'react';
import { FlatList, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { CategoryPill } from '@/components/category-pill';
import { PlaceCard } from '@/components/place-card';
import { ThemedText } from '@/components/themed-text';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { categories, type Category } from '@/lib/places';
import { usePlaces } from '@/lib/places-store';

export default function ExploreScreen() {
  const theme = useTheme();
  const { places } = usePlaces();
  const params = useLocalSearchParams<{ category?: string }>();
  const initialCategory = categories.some((c) => c.name === params.category)
    ? (params.category as Category)
    : 'All';

  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<Category | 'All'>(initialCategory);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return places.filter((place) => {
      const matchesCategory = category === 'All' || place.category === category;
      const matchesQuery =
        q === '' ||
        place.name.toLowerCase().includes(q) ||
        place.nameAr.includes(q) ||
        place.area.toLowerCase().includes(q) ||
        place.tagline.toLowerCase().includes(q);
      return matchesCategory && matchesQuery;
    });
  }, [places, query, category]);

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <Head>
        <title>Explore Kuwait — Wain?</title>
      </Head>
      <FlatList
        data={filtered}
        keyExtractor={(place) => place.slug}
        renderItem={({ item }) => <PlaceCard place={item} />}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[
          styles.listContent,
          { paddingBottom: BottomTabInset + Spacing.five },
        ]}
        style={styles.list}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        ListHeaderComponent={
          <View>
            <ThemedText type="subtitle" style={styles.title}>
              Explore Kuwait
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary" style={styles.subtitle}>
              {places.length} places, zero “I don’t know, you choose”.
            </ThemedText>

            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Search places, areas, or vibes… (English or عربي)"
              placeholderTextColor={theme.textSecondary}
              style={[
                styles.search,
                {
                  backgroundColor: theme.backgroundElement,
                  borderColor: theme.border,
                  color: theme.text,
                },
              ]}
            />

            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.pillRow}>
              <CategoryPill
                label="All"
                selected={category === 'All'}
                onPress={() => setCategory('All')}
              />
              {categories.map((cat) => (
                <CategoryPill
                  key={cat.name}
                  label={`${cat.emoji} ${cat.name}`}
                  selected={category === cat.name}
                  onPress={() => setCategory(cat.name)}
                />
              ))}
            </ScrollView>
          </View>
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyEmoji}>🤷</Text>
            <ThemedText type="smallBold" style={styles.emptyTitle}>
              No places found
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              Try a different search or category — Kuwait has more to offer!
            </ThemedText>
          </View>
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  list: {
    flex: 1,
  },
  listContent: {
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.four,
    maxWidth: MaxContentWidth,
    width: '100%',
    alignSelf: 'center',
  },
  title: {
    fontSize: 28,
    lineHeight: 36,
  },
  subtitle: {
    marginTop: Spacing.one,
    marginBottom: Spacing.three,
  },
  search: {
    borderRadius: Spacing.three,
    borderWidth: 1,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    fontSize: 15,
  },
  pillRow: {
    gap: Spacing.two,
    paddingVertical: Spacing.three,
  },
  separator: {
    height: Spacing.three,
  },
  empty: {
    alignItems: 'center',
    gap: Spacing.two,
    paddingVertical: Spacing.six,
  },
  emptyEmoji: {
    fontSize: 40,
  },
  emptyTitle: {
    fontSize: 16,
  },
});
