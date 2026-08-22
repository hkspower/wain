import {
  Tabs,
  TabList,
  TabTrigger,
  TabSlot,
  TabTriggerSlotProps,
  TabListProps,
} from 'expo-router/ui';
import { Link } from 'expo-router';
import { Pressable, StyleSheet, View, type ViewStyle } from 'react-native';

import { press } from '@/components/ui/press';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Elevation, MaxContentWidth, Spacing, TapTarget } from '@/constants/theme';
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
    <Pressable {...props} style={press(true, styles.hit)}>
      {/* TEXT, NOT A PILL. Four white boxes on a grey page read as four
          buttons — the heaviest thing on a screen whose job is the shop below
          it. The label carries the state instead: the ember, in the bolder
          weight, over a 2pt ember rule.
          The rule is 2pt of colour and NOT the only signal, because colour
          alone fails anyone who cannot separate these two greys — the weight
          changes with it, and aria-selected is on the trigger either way. */}
      <View style={styles.tabButtonView}>
        <ThemedText
          type={isFocused ? 'labelBold' : 'label'}
          themeColor={isFocused ? 'tintText' : 'textSecondary'}>
          {children}
        </ThemedText>
        <View
          style={[
            styles.underline,
            { backgroundColor: isFocused ? theme.tint : 'transparent' },
          ]}
        />
      </View>
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
          <ThemedText type="label" themeColor="onInk" style={styles.badgeText}>
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
    <View {...props} style={[styles.tabListContainer, styles.safeTop]}>
      <ThemedView type="background" style={styles.fill}>
        <View style={[styles.innerContainer, row]}>
          {/* The wordmark is a link home, which is where a shopper expects a
              brand in a top bar to take them — it was plain text. */}
          <Link href="/" asChild>
            <Pressable
              accessibilityRole="link"
              accessibilityLabel={t.tabs.home}
              style={press(true, styles.brandHit)}>
              <ThemedText type="title" style={styles.brandText} themeColor="tintText">
                {t.brand}
              </ThemedText>
            </Pressable>
          </Link>
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
    zIndex: 10,
    // Lifted, not ruled off — the page scrolls under it, and that is what the
    // cart's totals bar and the checkout's Pay bar say with the same shadow.
    ...Elevation.card,
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
  brandHit: {
    // marginEnd, not marginRight: which side pushes the tabs away depends on
    // the language.
    marginEnd: 'auto',
    paddingEnd: Spacing.two,
  },
  brandText: {
    letterSpacing: 1,
    // THE HEIGHT LIVES ON THE TEXT, not on the Pressable around it. `Link
    // asChild` clones its child and the anchor it produces ignored the
    // minHeight given to that child — measured at 74x40, under the 44 a thumb
    // needs, on every page. A line box the text itself carries cannot be
    // dropped by whoever wraps it, and it is the same 48 in both scripts,
    // where padding would have been 48 in English and 56 in Arabic.
    lineHeight: TapTarget,
  },
  hit: {
    minHeight: TapTarget,
    justifyContent: 'center',
  },
  tabButtonView: {
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.two,
    alignItems: 'center',
    gap: Spacing.one,
  },
  underline: {
    height: 2,
    alignSelf: 'stretch',
    borderRadius: 999,
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
