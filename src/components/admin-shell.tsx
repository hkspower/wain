import { useRouter, usePathname } from 'expo-router';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing, TapTarget } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useSession } from '@/lib/session';

/**
 * The chrome every /backends screen sits in: title, nav, sign-out, and the
 * three states a panel screen is always in one of.
 *
 * LTR, in both languages, and that is deliberate. This panel is a table of
 * order references, phone numbers, sizes and amounts — all of which are read
 * left to right even in Arabic — and the website's panel made the same call
 * (`dir="ltr"` on its shell) after mirrored rows put the order number at the
 * far end of every line. The customer-facing app follows the customer's
 * language; the panel follows the data's.
 */
export function AdminShell({
  title,
  children,
  loading,
  error,
  onRetry,
  notice,
  action,
}: {
  title: string;
  children?: React.ReactNode;
  loading?: boolean;
  /** A screen that could not LOAD. Replaces the content, because there is no
   *  content to show. */
  error?: string | null;
  onRetry?: () => void;
  /** A screen that loaded, where an ACTION failed. Sits above the content and
   *  leaves it alone — blanking a list of stock rows because one save was
   *  rejected takes the fix away from the person fixing it. */
  notice?: string | null;
  action?: React.ReactNode;
}) {
  const theme = useTheme();
  const router = useRouter();
  const pathname = usePathname();
  const { token, signOut } = useSession();

  const NAV: [string, string][] = [
    ['/backends', 'Today'],
    ['/backends/orders', 'Orders'],
    ['/backends/stock', 'Stock'],
  ];

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <ThemedView type="inkSilver" style={styles.bar}>
        <View style={styles.barInner}>
          <Text style={styles.brand}>SPORTA · backends</Text>
          {token && (
            <Pressable
              accessibilityRole="button"
              onPress={signOut}
              style={({ pressed }) => [styles.signOut, pressed && styles.pressed]}>
              <Text style={styles.signOutText}>Sign out</Text>
            </Pressable>
          )}
        </View>
      </ThemedView>

      {token && (
        <ThemedView type="background" style={[styles.nav, { borderColor: theme.border }]}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.navRow}>
            {NAV.map(([href, label]) => {
              const active = pathname === href;
              return (
                <Pressable
                  key={href}
                  accessibilityRole="link"
                  accessibilityState={{ selected: active }}
                  onPress={() => router.replace(href as never)}
                  style={({ pressed }) => pressed && styles.pressed}>
                  <ThemedView
                    type={active ? 'backgroundSelected' : 'backgroundElement'}
                    style={[styles.navItem, { borderColor: active ? theme.tint : theme.border }]}>
                    <ThemedText type="smallBold" themeColor={active ? 'tint' : 'textSecondary'}>
                      {label}
                    </ThemedText>
                  </ThemedView>
                </Pressable>
              );
            })}
          </ScrollView>
        </ThemedView>
      )}

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.content}>
          <ThemedText type="subtitle" style={styles.title}>
            {title}
          </ThemedText>

          {/* Loading, error and empty are rendered HERE rather than left to
              each screen, because a panel that forgets one of them shows a
              blank page and a blank page reads as "no orders". */}
          {notice && !loading && !error ? (
            <ThemedView
              type="backgroundElement"
              style={[styles.errorBox, { borderColor: theme.danger }]}>
              <ThemedText type="small" themeColor="danger" accessibilityLiveRegion="polite">
                {notice}
              </ThemedText>
            </ThemedView>
          ) : null}

          {loading ? (
            <View style={styles.centre}>
              <ActivityIndicator color={theme.tint} />
            </View>
          ) : error ? (
            <ThemedView type="backgroundElement" style={[styles.errorBox, { borderColor: theme.danger }]}>
              <ThemedText type="smallBold" themeColor="danger">
                Could not load
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary" selectable>
                {error}
              </ThemedText>
              {onRetry && (
                <Pressable
                  accessibilityRole="button"
                  onPress={onRetry}
                  style={({ pressed }) => [
                    styles.retry,
                    { borderColor: theme.border },
                    pressed && styles.pressed,
                  ]}>
                  <ThemedText type="smallBold">Try again</ThemedText>
                </Pressable>
              )}
            </ThemedView>
          ) : (
            children
          )}
        </View>
      </ScrollView>

      {action}
    </SafeAreaView>
  );
}

export const adminStyles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderRadius: Spacing.three,
    padding: Spacing.three,
    gap: Spacing.one,
  },
  rowBetween: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
  },
  chip: {
    borderRadius: 999,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.half,
  },
});

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  bar: { paddingVertical: Spacing.two },
  barInner: {
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
    paddingHorizontal: Spacing.three,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: TapTarget - 8,
  },
  brand: { color: '#ffffff', fontWeight: '700', letterSpacing: 1 },
  signOut: {
    minHeight: TapTarget - 8,
    justifyContent: 'center',
    paddingHorizontal: Spacing.two,
  },
  signOutText: { color: '#ff7b17', fontWeight: '700' },
  nav: { borderBottomWidth: 1 },
  navRow: {
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    gap: Spacing.two,
    flexDirection: 'row',
  },
  navItem: {
    minHeight: TapTarget - 12,
    justifyContent: 'center',
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: Spacing.three,
  },
  scroll: { paddingVertical: Spacing.three },
  content: {
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
    paddingHorizontal: Spacing.three,
    gap: Spacing.two,
  },
  title: { fontSize: 24, lineHeight: 32 },
  centre: { paddingVertical: Spacing.six, alignItems: 'center' },
  errorBox: {
    borderWidth: 1,
    borderRadius: Spacing.three,
    padding: Spacing.three,
    gap: Spacing.one,
  },
  retry: {
    marginTop: Spacing.two,
    minHeight: TapTarget,
    borderWidth: 1,
    borderRadius: Spacing.two,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: { opacity: 0.7 },
});
