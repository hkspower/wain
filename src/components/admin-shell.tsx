import { useRouter, usePathname } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { press } from '@/components/ui/press';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Elevation, MaxContentWidth, Radius, Spacing, TapTarget } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useWindowWidth } from '@/hooks/use-window-width';
import { useSession } from '@/lib/session';

/** Below this, the thirteen-item pill row no longer fits a thumb's worth of
 *  scrolling in one glance — it takes several swipes to find "Activity" from
 *  "Today". Above it (tablet and desktop web, where this panel is also
 *  used) the horizontal strip stays: there is room for all of it at once,
 *  and a dropdown would be a worse fit for a mouse. */
const COMPACT_NAV_WIDTH = 700;

const NAV: [string, string][] = [
  ['/backends', 'Today'],
  ['/backends/orders', 'Orders'],
  // Next to Orders, because it is the same job seen from the other end —
  // a parcel coming back rather than going out.
  ['/backends/returns', 'Returns'],
  // Before Stock, because a size cannot be stocked until the product editor
  // has given it one — Products is where a garment and its size ladder are
  // created; Stock is where the count on an existing size is moved day to
  // day, which is a different, more frequent job by the same person.
  ['/backends/products', 'Products'],
  ['/backends/stock', 'Stock'],
  ['/backends/promos', 'Promotions'],
  ['/backends/images', 'Photos'],
  // After Photos, because it is the same kind of job — a picture and a name
  // attached to something the shop sells — and before Settings, which is
  // where things go that are changed once a year.
  ['/backends/brands', 'Brands'],
  // Its own entry rather than a button inside Brands, because it is a
  // different job: Brands is one brand at a time and mostly about names,
  // this is a folder of logos and every brand at once.
  ['/backends/brand-logos', 'Brand logos'],
  ['/backends/settings', 'Settings'],
  // Last, next to Settings, because it is the same kind of thing — changed
  // rarely and deliberately — but its own entry rather than a card inside
  // Settings: these nine numbers are ONE policy the server checks against
  // itself, so they save together, and Settings saves each card separately.
  ['/backends/rules', 'Shop rules'],
  // Before Activity for the same reason Settings sits before Shop rules —
  // changed rarely and deliberately, and the website panel already has a
  // Security entry in the same relative spot; this app had every one of
  // the server routes it needs (otp_begin/totp_begin and their partners)
  // with no screen to reach them from until now.
  ['/backends/security', 'Security'],
  // Last, because it is the one screen nobody opens to DO something — every
  // other entry here is a job; this is the record of every job already
  // done, by anyone, anywhere in the panel.
  ['/backends/activity', 'Activity'],
];

/**
 * The chrome every /backends screen sits in: brand bar, sign-out, and the
 * nav — rendered ONCE, wrapping the whole Stack in _layout.tsx, rather than
 * by each screen.
 *
 * WHY IT MOVED OUT OF AdminShell. Every screen used to render its own copy —
 * SafeAreaView, header bar and the thirteen-item nav row included — so
 * switching screens meant expo-router unmounting all of that and mounting a
 * fresh copy a beat later, on top of the screen's own network fetch. The nav
 * was rebuilt from scratch on every tap, which is the "switching pages feels
 * slow" a person actually notices: the whole chrome blinks out and back
 * before the new screen's data even arrives. Hoisting it here means a tap
 * only ever swaps the CONTENT underneath a header and nav that were already
 * on screen and stay there.
 *
 * LTR, in both languages, and that is deliberate. This panel is a table of
 * order references, phone numbers, sizes and amounts — all of which are read
 * left to right even in Arabic — and the website's panel made the same call
 * (`dir="ltr"` on its shell) after mirrored rows put the order number at the
 * far end of every line. The customer-facing app follows the customer's
 * language; the panel follows the data's.
 */
export function AdminChrome({
  children,
  hideNav,
}: {
  children: React.ReactNode;
  /** For the forced-password-change screen only: every nav link is a dead
   *  end there (_layout.tsx renders it in place of the Stack while
   *  mustChangePassword is set), so showing a row of buttons that all
   *  silently do nothing would read as a broken panel rather than a
   *  restricted one. */
  hideNav?: boolean;
}) {
  const theme = useTheme();
  const router = useRouter();
  const pathname = usePathname();
  const { token, signOut } = useSession();
  const width = useWindowWidth();
  const compact = width < COMPACT_NAV_WIDTH;
  const [menuOpen, setMenuOpen] = useState(false);

  const showNav = token && !hideNav;

  const go = (href: string) => {
    setMenuOpen(false);
    router.replace(href as never);
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <ThemedView type="inkSilver" style={styles.bar}>
        <View style={styles.barInner}>
          <View style={styles.barLeft}>
            {/* MOBILE ONLY: a single toggle in place of the whole strip. The
                horizontal scroller below stays for a wide viewport, where
                a mouse and the extra width make a full row the better fit —
                this is the same control either way, just shown as a row on
                one and a button on the other, so nothing is duplicated. */}
            {showNav && compact && (
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ expanded: menuOpen }}
                onPress={() => setMenuOpen((o) => !o)}
                style={press(false, styles.menuBtn)}>
                <Text style={styles.menuBtnText}>{menuOpen ? '✕' : '☰'} Menu</Text>
              </Pressable>
            )}
            <Text style={styles.brand}>SPORTA · backends</Text>
          </View>
          {token && (
            <Pressable
              accessibilityRole="button"
              onPress={signOut}
              style={press(false, styles.signOut)}>
              <Text style={styles.signOutText}>Sign out</Text>
            </Pressable>
          )}
        </View>
      </ThemedView>

      {showNav && !compact && (
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
                  onPress={() => go(href)}
                  // 48 to tap, 36 of pill inside it — the same shape the
                  // shop's filter chips carry. The panel's were 36 all the
                  // way through, which is under what a thumb needs, and no
                  // rig had ever measured them because they only exist behind
                  // a login.
                  style={press(false, styles.navHit)}>
                  <ThemedView
                    type={active ? 'backgroundSelected' : 'backgroundElement'}
                    style={[styles.navItem, { borderColor: active ? theme.tint : theme.controlBorder }]}>
                    <ThemedText type="labelBold" themeColor={active ? 'tintText' : 'textSecondary'}>
                      {label}
                    </ThemedText>
                  </ThemedView>
                </Pressable>
              );
            })}
          </ScrollView>
        </ThemedView>
      )}

      {/* MOBILE MENU: a full-width vertical list rather than the horizontal
          strip's own items stacked — one column a thumb can scan top to
          bottom without also having to scroll sideways to find it in the
          first place. Closes itself the moment a destination is picked, so
          it never sits open over the screen it just navigated to. */}
      {showNav && compact && menuOpen && (
        <ThemedView type="background" style={[styles.menuPanel, { borderColor: theme.border }]}>
          <ScrollView contentContainerStyle={styles.menuList}>
            {NAV.map(([href, label]) => {
              const active = pathname === href;
              return (
                <Pressable
                  key={href}
                  accessibilityRole="link"
                  accessibilityState={{ selected: active }}
                  onPress={() => go(href)}
                  style={press(false, styles.menuRowHit)}>
                  <ThemedView
                    type={active ? 'backgroundSelected' : 'backgroundElement'}
                    style={[styles.menuRow, { borderColor: active ? theme.tint : theme.controlBorder }]}>
                    <ThemedText type="labelBold" themeColor={active ? 'tintText' : 'text'}>
                      {label}
                    </ThemedText>
                  </ThemedView>
                </Pressable>
              );
            })}
          </ScrollView>
        </ThemedView>
      )}

      <View style={styles.body}>{children}</View>
    </SafeAreaView>
  );
}

/**
 * A single screen's content: title, and the three states a panel screen is
 * always in one of — loading, errored, or showing something. The chrome
 * around it (header, sign-out, nav) is AdminChrome above, mounted once by
 * _layout.tsx rather than by each screen.
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

  return (
    <>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.content}>
          <ThemedText type="display" style={styles.title}>
            {title}
          </ThemedText>

          {/* Loading, error and empty are rendered HERE rather than left to
              each screen, because a panel that forgets one of them shows a
              blank page and a blank page reads as "no orders". */}
          {notice && !loading && !error ? (
            <ThemedView
              type="backgroundElement"
              style={[styles.errorBox, { borderColor: theme.danger }]}>
              <ThemedText type="label" themeColor="danger" accessibilityLiveRegion="polite">
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
              <ThemedText type="labelBold" themeColor="danger">
                Could not load
              </ThemedText>
              <ThemedText type="label" themeColor="textSecondary" selectable>
                {error}
              </ThemedText>
              {onRetry && (
                <Pressable
                  accessibilityRole="button"
                  onPress={onRetry}
                  style={press(false, styles.retry,
                    { borderColor: theme.controlBorder })}>
                  <ThemedText type="labelBold">Try again</ThemedText>
                </Pressable>
              )}
            </ThemedView>
          ) : (
            children
          )}
        </View>
      </ScrollView>

      {action}
    </>
  );
}

export const adminStyles = StyleSheet.create({
  // The panel's block, matching the shop's: 24 at the corner, no outline,
  // lifted. The owner's panel and the customer's app are one piece of
  // software and looked like two.
  card: {
    borderRadius: Radius.card,
    padding: Spacing.four,
    gap: Spacing.one,
  },
  /** Applied alongside `card` unless the row is drawing a MEANINGFUL border —
   *  a stock count at zero, say. A shadow cannot carry that meaning, so those
   *  rows keep the outline and skip the lift. */
  lift: Elevation.card,
  rowBetween: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
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
  barLeft: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  brand: { color: '#ffffff', fontWeight: '700', letterSpacing: 1 },
  menuBtn: {
    minHeight: TapTarget,
    justifyContent: 'center',
    paddingHorizontal: Spacing.two,
  },
  menuBtnText: { color: '#ffffff', fontWeight: '700' },
  signOut: {
    // FULL TapTarget, which grows the header bar from 40 to 48.
    //
    // hitSlop was tried first and is a NO-OP ON REACT NATIVE WEB, which is
    // where this panel actually runs. Measured: with hitSlop 8 on every side,
    // elementFromPoint six pixels below the button returned the header div,
    // not the button — the touch area was exactly the 72x40 box and nothing
    // more. A prop that does nothing is worse than no prop, because the next
    // reader takes it for the fix.
    //
    // So the control is really made 48, and the bar really does get 8pt
    // taller. This is the one control present on EVERY screen in the panel,
    // and signing out of a shop's back office on a phone should not need a
    // careful aim.
    minHeight: TapTarget,
    justifyContent: 'center',
    paddingHorizontal: Spacing.two,
  },
  signOutText: { color: '#ff7b17', fontWeight: '700' },
  nav: { borderBottomWidth: 1 },
  navRow: {
    // NO width: '100%'. This is a horizontal ScrollView's content, which has
    // to size to its children; pinning it to the viewport width put the last
    // chip at x=389 on a 390pt screen — hard against the glass, while every
    // other thing on the page stopped at 374.
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    gap: Spacing.two,
    flexDirection: 'row',
  },
  navHit: { minHeight: TapTarget, justifyContent: 'center' },
  navItem: {
    minHeight: TapTarget - 12,
    justifyContent: 'center',
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: Spacing.three,
  },
  // THE MOBILE MENU. A cap on height rather than letting thirteen rows push
  // the screen's own content down an unpredictable amount before it starts —
  // it scrolls internally past that, same as the horizontal strip scrolls
  // sideways on a wide screen.
  menuPanel: { borderBottomWidth: 1, maxHeight: 320 },
  menuList: {
    maxWidth: MaxContentWidth,
    alignSelf: 'stretch',
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    gap: Spacing.one,
  },
  menuRowHit: { minHeight: TapTarget, justifyContent: 'center' },
  menuRow: {
    minHeight: TapTarget - 8,
    justifyContent: 'center',
    borderWidth: 1,
    borderRadius: Radius.button,
    paddingHorizontal: Spacing.three,
  },
  body: { flex: 1 },
  scroll: { paddingVertical: Spacing.three },
  content: {
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
    paddingHorizontal: Spacing.three,
    // 16 between blocks, which is what the customer's app uses. The panel sat
    // at 8 — the same shop, twice as dense on the screens the owner spends
    // the most time in.
    gap: Spacing.three,
  },
  title: { fontSize: 24, lineHeight: 32 },
  centre: { paddingVertical: Spacing.six, alignItems: 'center' },
  errorBox: {
    borderWidth: 1,
    borderRadius: Radius.card,
    padding: Spacing.four,
    gap: Spacing.one,
  },
  retry: {
    marginTop: Spacing.two,
    minHeight: TapTarget,
    borderWidth: 1,
    borderRadius: Radius.button,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
