import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { press } from '@/components/ui/press';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
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
      <Stack.Screen options={{ title: t.order.title }} />
      <View style={styles.content}>
        <Text style={styles.tick}>✅</Text>
        <ThemedText type="display" style={styles.center}>
          {t.order.thanks}
        </ThemedText>
        <ThemedText themeColor="textSecondary" style={styles.center}>
          {t.order.willCall}
        </ThemedText>

        <ThemedView type="backgroundElement" style={[styles.refBox, { borderColor: theme.border }]}>
          <ThemedText type="label" themeColor="textSecondary">
            {t.order.ref}
          </ThemedText>
          {/* The reference is selectable: it is the one thing on this screen
              the customer may need to paste into WhatsApp. */}
          <ThemedText type="labelBold" selectable style={styles.ref}>
            {String(ref)}
          </ThemedText>
        </ThemedView>

        <Button label={t.order.home} onPress={() => router.replace('/')} style={styles.primary} />
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
  primary: { marginTop: Spacing.four, alignSelf: 'stretch' },
});
