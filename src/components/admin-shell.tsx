import { useRouter, usePathname } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

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
 *  used) the horizontal strip stays, and a dropdown would be a worse fit for
 *  a mouse — but "there is room for all of it at once" turned out to be
 *  wrong at the widths this is actually opened at: measured at 1280px, the
 *  strip's own content is 1318px wide, so "Activity" — the last of thirteen —
 *  renders past the right edge with NOTHING on screen suggesting it can be
 *  reached by scrolling: `showsHorizontalScrollIndicator={false}`, no fade,
 *  no arrow. The scrolling itself worked throughout; nothing told anyone it
 *  was there, which is the same DISCOVERABILITY gap the website's own mobile
 *  tab bar had (see panel-tabbar-fade.js's header) on a different program's
 *  desktop row. Fixed below with visible edge arrows rather than a fade,
 *  since a fade alone still leaves a mouse user nothing to click. */
const COMPACT_NAV_WIDTH = 700;

/** How far one press of an edge arrow moves the strip — enough to bring the
 *  next couple of pills fully into view rather than by one sliver. */
const NAV_SCROLL_STEP = 220;

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

  // The strip's own scroll state, so the two edge arrows can be shown only
  // where there is really something to scroll to — an arrow that is always
  // there and sometimes does nothing is worse than the invisible scroller
  // this replaces, because it invites a press that goes nowhere.
  const navScrollRef = useRef<ScrollView>(null);
  const navLayoutWidth = useRef(0);
  const navContentWidth = useRef(0);
  const navOffsetX = useRef(0);
  const navItemX = useRef<Record<string, number>>({});
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const recomputeNavArrows = (offsetX: number) => {
    navOffsetX.current = offsetX;
    setCanScrollLeft(offsetX > 4);
    setCanScrollRight(offsetX < navContentWidth.current - navLayoutWidth.current - 4);
  };

  const scrollNav = (dir: 1 | -1) => {
    const x = Math.max(0, navOffsetX.current + dir * NAV_SCROLL_STEP);
    navScrollRef.current?.scrollTo({ x, animated: true });
  };

  // THE ACTIVE TAB SCROLLS INTO VIEW ON EVERY NAVIGATION, not only the first
  // paint — the same property panel-tabbar-autocenter.js gives the website's
  // mobile bar, so a manager who scrolled to "Security" once does not have to
  // find it again from memory the next time they open a screen past the fold.
  useEffect(() => {
    const x = navItemX.current[pathname];
    if (x === undefined || !navScrollRef.current) return;
    navScrollRef.current.scrollTo({ x: Math.max(0, x - Spacing.four), animated: true });
  }, [pathname]);

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
          {/* The maxWidth/centering used to sit on the ScrollView's own
              CONTENT (navRow below), which caps the SCROLLABLE region rather
              than the page's visual column — once the thirteen pills needed
              more room than that cap, the extra pills spilled out past their
              own scrollable box via `overflow: visible` and were reachable by
              scroll only by accident, at whichever width happened to leave
              them inside the browser's own edge. The cap belongs on this
              outer, non-scrolling wrapper instead: the ScrollView beneath it
              takes the full width THAT gives it, and its content sizes to
              its children with nothing capping how far it can scroll. */}
          <View style={styles.navOuter}>
            <ScrollView
              ref={navScrollRef}
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.navRow}
              onLayout={(e) => {
                navLayoutWidth.current = e.nativeEvent.layout.width;
                recomputeNavArrows(navOffsetX.current);
              }}
              onContentSizeChange={(w) => {
                navContentWidth.current = w;
                recomputeNavArrows(navOffsetX.current);
              }}
              onScroll={(e) => recomputeNavArrows(e.nativeEvent.contentOffset.x)}
              scrollEventThrottle={16}>
              {NAV.map(([href, label]) => {
                const active = pathname === href;
                return (
                  <Pressable
                    key={href}
                    accessibilityRole="link"
                    accessibilityState={{ selected: active }}
                    onPress={() => go(href)}
                    onLayout={(e) => {
                      navItemX.current[href] = e.nativeEvent.layout.x;
                    }}
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
            {/* Shown only where there is really something past the edge —
                see COMPACT_NAV_WIDTH's own comment for why this exists at
                all. Overlaid rather than beside the strip, so it costs no
                extra row height and sits exactly where the eye already is
                when a pill is cut off against it. */}
            {canScrollLeft && (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Scroll navigation left"
                onPress={() => scrollNav(-1)}
                style={[
                  styles.navArrow,
                  styles.navArrowLeft,
                  { backgroundColor: theme.background, borderColor: theme.controlBorder },
                ]}>
                <Text style={[styles.navArrowText, { color: theme.text }]}>‹</Text>
              </Pressable>
            )}
            {canScrollRight && (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Scroll navigation right"
                onPress={() => scrollNav(1)}
                style={[
                  styles.navArrow,
                  styles.navArrowRight,
                  { backgroundColor: theme.background, borderColor: theme.controlBorder },
                ]}>
                <Text style={[styles.navArrowText, { color: theme.text }]}>›</Text>
              </Pressable>
            )}
          </View>
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
      {/* THE KEYBOARD USED TO COVER THE FIELD BEING TYPED INTO.
          Only the sign-in and security screens carried a KeyboardAvoidingView
          of their own; every other editing screen in the panel — products,
          promotions, stock, shop rules, settings, brands — renders through
          here and had none. On a phone that means the lower half of a long
          form is behind the keyboard the moment it opens, and the product
          editor's price and category sit at the bottom of the longest form in
          the panel.

          Here rather than on each screen, because "which screens have inputs"
          is a question that gets a new wrong answer every time a screen is
          added. The two that had their own have had them removed, or the two
          would nest and pad twice.

          Android gets `undefined` and its own windowSoftInputMode:adjustResize,
          which is the pairing the sign-in screen already used. */}
      <KeyboardAvoidingView
        style={styles.avoider}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
          // A TAP THAT REACHES THE BUTTON FIRST TIME. Without this, a tap while
          // the keyboard is open is spent dismissing it and the control under
          // the finger never fires — so typing a price and pressing Save does
          // nothing, and pressing Save again works. It reads as a flaky button
          // rather than as a keyboard, which is why it survives so long.
          keyboardShouldPersistTaps="handled">
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
      </KeyboardAvoidingView>

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
  // Non-scrolling: this is what carries the page's own column width, so the
  // ScrollView inside it never has more width to offer than the rest of the
  // page does — and never less, which is the bug this replaces.
  navOuter: {
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
  },
  navRow: {
    // NO width: '100%' and NO maxWidth here. This is a horizontal
    // ScrollView's CONTENT, which has to size to its children — pinning it to
    // the viewport width put the last chip at x=389 on a 390pt screen, hard
    // against the glass, and capping it at the page's own column width made
    // thirteen pills wider than that cap unreachable by scroll. It sizes
    // itself; navOuter above is what caps and centres the column.
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    gap: Spacing.two,
    flexDirection: 'row',
  },
  navHit: { minHeight: TapTarget, justifyContent: 'center' },
  navArrow: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 32,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  navArrowLeft: { left: 0, borderRightWidth: 1 },
  navArrowRight: { right: 0, borderLeftWidth: 1 },
  navArrowText: { fontSize: 20, fontWeight: '700', lineHeight: 22 },
  navItem: {
    minHeight: TapTarget,
    justifyContent: 'center',
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
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
    paddingVertical: Spacing.three,
    gap: Spacing.two,
  },
  menuRowHit: { minHeight: TapTarget, justifyContent: 'center' },
  menuRow: {
    minHeight: TapTarget,
    justifyContent: 'center',
    borderWidth: 1,
    borderRadius: Radius.button,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  body: { flex: 1 },
  // KeyboardAvoidingView measures nothing without a height to work against, so
  // an unsized one is a component that renders and does nothing — the quiet
  // kind of no-op this project keeps finding.
  avoider: { flex: 1 },
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
