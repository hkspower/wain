import { Link } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { serviceUnits } from '@/lib/nokha1';

export default function Nokha1Screen() {
  const theme = useTheme();

  return (
    <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
      <View style={styles.content}>
        <View style={styles.hero}>
          <ThemedView type="tintSoft" style={styles.badge}>
            <ThemedText type="small" themeColor="tint">
              ⚓ نظام واحد… كل الخدمات
            </ThemedText>
          </ThemedView>
          <ThemedText type="subtitle" style={styles.title}>
            Nokha1 — النوخذة
          </ThemedText>
          <ThemedText themeColor="textSecondary" style={styles.heroText}>
            نظام المهلب الموحد: صافي لمتابعة المحفظة، تقارير XBRL المالية، ونظام
            التوصيل — كلها تعمل على جهازك مباشرة.
          </ThemedText>
        </View>

        <View style={styles.units}>
          {serviceUnits.map((unit) => (
            <Link key={unit.id} href={unit.href} asChild>
              <Pressable style={({ pressed }) => pressed && styles.pressed}>
                <ThemedView
                  type="backgroundElement"
                  style={[styles.unitCard, { borderColor: theme.border }]}>
                  <Text style={styles.unitEmoji}>{unit.emoji}</Text>
                  <View style={styles.unitTextWrap}>
                    <ThemedText type="smallBold">
                      {unit.title} — {unit.titleEn}
                    </ThemedText>
                    <ThemedText type="small" themeColor="textSecondary">
                      {unit.blurb}
                    </ThemedText>
                  </View>
                  <ThemedText themeColor="tint">←</ThemedText>
                </ThemedView>
              </Pressable>
            </Link>
          ))}
        </View>

        <ThemedText type="small" themeColor="textSecondary" style={styles.footer}>
          بياناتك محفوظة على جهازك فقط · Nokha1 by Almuhallab 🇰🇼
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
  hero: {
    alignItems: 'flex-start',
    gap: Spacing.two,
    marginBottom: Spacing.four,
  },
  badge: {
    borderRadius: 999,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one,
  },
  title: {
    fontSize: 30,
    lineHeight: 38,
  },
  heroText: {
    fontSize: 15,
    lineHeight: 24,
    textAlign: 'right',
    writingDirection: 'rtl',
    alignSelf: 'stretch',
  },
  units: {
    gap: Spacing.three,
  },
  unitCard: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: Spacing.three,
    borderRadius: Spacing.three,
    borderWidth: 1,
    padding: Spacing.three,
  },
  unitEmoji: {
    fontSize: 28,
  },
  unitTextWrap: {
    flex: 1,
    gap: Spacing.half,
    alignItems: 'flex-end',
  },
  pressed: {
    opacity: 0.8,
  },
  footer: {
    textAlign: 'center',
    marginTop: Spacing.five,
  },
});
