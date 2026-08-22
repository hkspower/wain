import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { press } from '@/components/ui/press';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Screen } from '@/components/ui/screen';
import { ThemedView } from '@/components/themed-view';
import { Elevation, MaxContentWidth, Radius, Spacing, TapTarget } from '@/constants/theme';
import { useHydrated } from '@/hooks/use-hydrated';
import { useLang } from '@/lib/i18n';

export default function OrderScreen() {
  const router = useRouter();
  const { t } = useLang();
  const { ref } = useLocalSearchParams<{ ref: string }>();
  const hydrated = useHydrated();

  // The order number is in the URL, so the prerendered HTML has none and the
  // client has one — see hooks/use-hydrated.
  if (!hydrated) {
    return <Screen edges={['bottom']} scroll={false} contentStyle={styles.centred}>{null}</Screen>;
  }

  return (
    <Screen edges={['bottom']} scroll={false} contentStyle={styles.centred}>
      <Stack.Screen options={{ title: t.order.title }} />
      <Text style={styles.tick}>✅</Text>
      <ThemedText type="display" style={styles.center}>
        {t.order.thanks}
      </ThemedText>
      <ThemedText themeColor="textSecondary" style={styles.center}>
        {t.order.willCall}
      </ThemedText>

      <ThemedView type="backgroundElement" style={[styles.refBox, Elevation.card]}>
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
    </Screen>
  );
}

const styles = StyleSheet.create({
  centred: {
    flex: 1,
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
    borderRadius: Radius.card,
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.five,
  },
  ref: { fontSize: 20, letterSpacing: 1 },
  primary: { marginTop: Spacing.four, alignSelf: 'stretch' },
});
