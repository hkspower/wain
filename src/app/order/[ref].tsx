import { useLocalSearchParams, useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing, TapTarget } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useLang } from '@/lib/i18n';

export default function OrderScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { t } = useLang();
  const { ref } = useLocalSearchParams<{ ref: string }>();

  return (
    <SafeAreaView style={styles.safeArea} edges={['bottom']}>
      <View style={styles.content}>
        <Text style={styles.tick}>✅</Text>
        <ThemedText type="subtitle" style={styles.center}>
          {t.order.thanks}
        </ThemedText>
        <ThemedText themeColor="textSecondary" style={styles.center}>
          {t.order.willCall}
        </ThemedText>

        <ThemedView type="backgroundElement" style={[styles.refBox, { borderColor: theme.border }]}>
          <ThemedText type="small" themeColor="textSecondary">
            {t.order.ref}
          </ThemedText>
          {/* The reference is selectable: it is the one thing on this screen
              the customer may need to paste into WhatsApp. */}
          <ThemedText type="smallBold" selectable style={styles.ref}>
            {String(ref)}
          </ThemedText>
        </ThemedView>

        <Pressable
          accessibilityRole="button"
          onPress={() => router.replace('/')}
          style={({ pressed }) => [
            styles.primary,
            { backgroundColor: theme.tint },
            pressed && styles.pressed,
          ]}>
          <Text style={styles.primaryText}>{t.order.home}</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  content: {
    flex: 1,
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
    padding: Spacing.four,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
  },
  tick: { fontSize: 64 },
  center: { textAlign: 'center' },
  refBox: {
    marginTop: Spacing.three,
    alignItems: 'center',
    gap: Spacing.half,
    borderWidth: 1,
    borderRadius: Spacing.three,
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.five,
  },
  ref: { fontSize: 20, letterSpacing: 1 },
  primary: {
    marginTop: Spacing.four,
    alignSelf: 'stretch',
    minHeight: TapTarget,
    borderRadius: Spacing.three,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryText: { color: '#ffffff', fontSize: 16, fontWeight: '700' },
  pressed: { opacity: 0.85 },
});
