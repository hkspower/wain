import {
  Tabs,
  TabList,
  TabTrigger,
  TabSlot,
  TabTriggerSlotProps,
  TabListProps,
} from 'expo-router/ui';
import { Pressable, StyleSheet, View, type ViewStyle } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing, TapTarget } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useCart } from '@/lib/cart';
import { useLang } from '@/lib/i18n';

/**
 * The web build's top bar. Same four destinations as the native tab bar, in the
 * same order, laid out from `dir` so Arabic reads right to left.
 *
 * It sits OUTSIDE the scrolling area — the page scrolls under it and it is
 * always reachable. That is layout, not `position: sticky`: a sticky rule was
 * added here and removed again when a mutation test showed it changed nothing,
 * because the bar is not inside the scroller for sticky to have anything to
 * stick to. Worth recording, so the next person does not add it back.
 *
 * THE TARGETS WERE 28px. Everything else in this app is sized against
 * TapTarget (48) — the steppers, the size buttons, the checkout fields — and
 * the one control on every single screen was half that, because its height came
 * from its text plus four points of padding. Measured, not guessed:
 * `الرئيسية` was 80x28.
 */
export default function AppTabs() {
  const { t } = useLang();

  return (
    <Tabs style={styles.tabs}>
      <TabList asChild>
        <CustomTabList>
          <TabTrigger name="home" href="/" asChild>
            <TabButton>{t.tabs.home}</TabButton>
          </TabTrigger>
          <TabTrigger name="shop" href="/shop" asChild>
            <TabButton>{t.tabs.shop}</TabButton>
          </TabTrigger>
          <TabTrigger name="cart" href="/cart" asChild>
            <TabButton badge>{t.tabs.cart}</TabButton>
          </TabTrigger>
          <TabTrigger name="account" href="/account" asChild>
            <TabButton>{t.tabs.account}</TabButton>
          </TabTrigger>
        </CustomTabList>
      </TabList>
      <TabSlot style={styles.slot} />
    </Tabs>
  );
}

export function TabButton({ children, isFocused, badge, ...props }: TabTriggerSlotProps & { badge?: boolean }) {
  const theme = useTheme();
  const { count, ready } = useCart();
  const showCount = badge && ready && count > 0;

  return (
    <Pressable {...props} style={({ pressed }) => [styles.hit, pressed && styles.pressed]}>
      <ThemedView
        type={isFocused ? 'backgroundSelected' : 'backgroundElement'}
        style={styles.tabButtonView}>
        <ThemedText type="small" themeColor={isFocused ? 'tint' : 'textSecondary'}>
          {children}
        </ThemedText>
      </ThemedView>
      {/* A BADGE, not "(1)" inside the label. The count changes while you shop,
          and a number inside the text re-measures the pill every time — the
          whole row shifted under the thumb as items went in. This is absolutely
          positioned, so it costs the layout nothing. */}
      {/* Charcoal, not the brand orange. White on the dark-mode ember measures
          2.59:1, and this is 11px bold — the one size that cannot afford it.
          Charcoal carries white at 13:1 in both themes, and the app already
          puts small white-on-charcoal chips on the product cards. */}
      {showCount ? (
        <View style={[styles.badge, { backgroundColor: theme.inkSteel }]}>
          <ThemedText type="small" themeColor="onInk" style={styles.badgeText}>
            {count > 9 ? '9+' : String(count)}
          </ThemedText>
        </View>
      ) : null}
    </Pressable>
  );
}

export function CustomTabList(props: TabListProps) {
  const theme = useTheme();
  const { t, row } = useLang();

  return (
    <View {...props} style={[styles.tabListContainer, styles.safeTop, { borderColor: theme.border }]}>
      <ThemedView type="background" style={styles.fill}>
        <View style={[styles.innerContainer, row]}>
          <ThemedText type="smallBold" style={styles.brandText} themeColor="tint">
            {t.brand}
          </ThemedText>
          {props.children}
        </View>
      </ThemedView>
    </View>
  );
}

const styles = StyleSheet.create({
  tabs: {
    flex: 1,
  },
  slot: {
    flex: 1,
    minHeight: 0,
  },
  tabListContainer: {
    width: '100%',
    borderBottomWidth: 1,
    zIndex: 10,
  },
  // The status bar on an installed PWA sits over the page; without this the
  // brand mark hides behind the clock. `env()` is a web value React Native's
  // types do not carry, and this file only ever runs on web — app-tabs.tsx is
  // the native tab bar.
  safeTop: {
    paddingTop: 'env(safe-area-inset-top, 0px)',
  } as unknown as ViewStyle,
  fill: {
    width: '100%',
  },
  innerContainer: {
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one,
    alignItems: 'center',
    gap: Spacing.one,
  },
  brandText: {
    // marginEnd, not marginRight: which side pushes the tabs away depends on
    // the language.
    marginEnd: 'auto',
    fontSize: 18,
    letterSpacing: 1,
  },
  hit: {
    minHeight: TapTarget,
    justifyContent: 'center',
  },
  pressed: {
    opacity: 0.7,
  },
  tabButtonView: {
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
    borderRadius: Spacing.three,
  },
  badge: {
    position: 'absolute',
    top: 2,
    end: 0,
    minWidth: 18,
    height: 18,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '700',
    lineHeight: 14,
  },
});
