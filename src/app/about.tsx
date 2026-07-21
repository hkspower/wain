import { Link } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

const values = [
  { emoji: '🇰🇼', title: 'Local first', text: 'Curated by people who actually live here.' },
  { emoji: '✨', title: 'Quality over quantity', text: 'Every place earns its spot.' },
  { emoji: '🗣️', title: 'Bilingual', text: 'English and Arabic, side by side.' },
];

export default function AboutScreen() {
  const theme = useTheme();

  return (
    <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
      <View style={styles.content}>
        <ThemedText type="subtitle" style={styles.title}>
          What is Wain?
        </ThemedText>

        <ThemedText style={styles.paragraph}>
          <ThemedText type="smallBold" style={styles.inlineBold}>
            Wain
          </ThemedText>{' '}
          (وين) means “where?” in Kuwaiti Arabic — as in the question asked in every
          family WhatsApp group, every Thursday night, since the dawn of time:{' '}
          <Text style={{ color: theme.tint, fontWeight: '700' }}>
            wain nrooh? — where shall we go?
          </Text>
        </ThemedText>

        <ThemedText style={styles.paragraph}>
          Wain answers that question. It’s a curated guide to the best of Kuwait —
          the iconic landmarks, the souqs that smell like cardamom and saffron, the
          beaches, the museums, the malls, and the spots only locals know about.
        </ThemedText>

        <ThemedText style={styles.paragraph}>
          Every place on Wain comes with honest highlights, the best time to visit,
          and what it’ll cost — so the only thing left to argue about in the group
          chat is who’s driving.
        </ThemedText>

        <View style={styles.valuesList}>
          {values.map((item) => (
            <ThemedView
              key={item.title}
              type="backgroundElement"
              style={[styles.valueCard, { borderColor: theme.border }]}>
              <Text style={styles.valueEmoji}>{item.emoji}</Text>
              <View style={styles.valueTextWrap}>
                <ThemedText type="smallBold">{item.title}</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  {item.text}
                </ThemedText>
              </View>
            </ThemedView>
          ))}
        </View>

        <Link href="/admin/lock" asChild>
          <Pressable
            style={({ pressed }) => [
              styles.adminButton,
              { borderColor: theme.border, opacity: pressed ? 0.85 : 1 },
            ]}>
            <ThemedText type="small" themeColor="textSecondary">
              🔐 Admin panel
            </ThemedText>
          </Pressable>
        </Link>

        <ThemedText type="small" themeColor="textSecondary" style={styles.footer}>
          Made with ❤️ in Kuwait 🇰🇼
        </ThemedText>
      </View>
    </ScrollView>
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
    paddingTop: Spacing.four,
  },
  title: {
    fontSize: 28,
    lineHeight: 36,
    marginBottom: Spacing.three,
  },
  paragraph: {
    marginBottom: Spacing.three,
    lineHeight: 26,
  },
  inlineBold: {
    fontSize: 16,
  },
  valuesList: {
    gap: Spacing.two,
    marginTop: Spacing.two,
  },
  valueCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    borderRadius: Spacing.three,
    borderWidth: 1,
    padding: Spacing.three,
  },
  valueEmoji: {
    fontSize: 24,
  },
  valueTextWrap: {
    flex: 1,
    gap: Spacing.half,
  },
  adminButton: {
    marginTop: Spacing.five,
    alignSelf: 'center',
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.two,
  },
  footer: {
    textAlign: 'center',
    marginTop: Spacing.three,
  },
});
