import { useCallback, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { press } from '@/components/ui/press';
import { ContentColumn, Screen } from '@/components/ui/screen';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ProductCard } from '@/components/product-card';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, Spacing, TapTarget } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useWindowWidth } from '@/hooks/use-window-width';
import { useCart } from '@/lib/cart';
import { formatNumber } from '@/lib/money';
import { useLang } from '@/lib/i18n';

type Sort = 'new' | 'low' | 'high';

// A wider cap than the shared MaxContentWidth (800px) — see the comment
// beside `columns`/`cardWidth` below. Chosen so five columns of
// MIN_CARD_WIDTH plus their gaps still fit with room to spare, not tuned to
// look right at one screen size in particular.
const SHOP_MAX_WIDTH = 1400;
const MIN_CARD_WIDTH = 200;
const MAX_COLUMNS = 5;

export default function ShopScreen() {
  const theme = useTheme();
  const { t, lang, dir, row, text } = useLang();

  /**
   * A HORIZONTAL LIST IN ARABIC STARTS AT ITS OTHER END.
   *
   * The chips are laid out row-reverse, so the first one — «الأحدث», and
   * «الكل» on the category row this used to serve as well — sits at the far
   * right of the content. A ScrollView opens at scrollLeft 0, which is the
   * LEFT, so the first chip was off the screen: measured at x=382 on a 390px
   * phone, three quarters of it past the edge. The control a customer wants
   * most often was the one they had to go looking for.
   *
   * React Native does not do this for you on either platform, and it is not
   * something a screenshot in English can ever show.
   */
  const startAtReadingEdge = useCallback(
    (ref: React.RefObject<ScrollView | null>) => () => {
      if (dir !== 'rtl') return;
      ref.current?.scrollToEnd({ animated: false });
      // And again after the frame settles. The row lays out more than once —
      // the chips' 48pt hit areas resize it after the first pass — and a
      // scroll issued against the old width lands short, which puts the first
      // chip back off the screen. Cheap, idempotent, and it is the difference
      // between the row opening on its first chip and opening on nothing.
      requestAnimationFrame(() => ref.current?.scrollToEnd({ animated: false }));
    },
    [dir],
  );
  const sortRow = useRef<ScrollView>(null);
  const { products } = useCart();

  /**
   * TWO COLUMNS ON A PHONE, MORE AS THERE IS ROOM — asked first as "fix
   * images grid layout" (stuck at two per row on every viewport, phone
   * through 1920px), then again as "more columns on wide screens": capping
   * at three within the shared MaxContentWidth (800px, tuned for a
   * paragraph's line length) meant a wide desktop got three big cards and
   * empty margins rather than more of them. A grid of photographs has no
   * reading-width limit the way body text does, so this screen alone asks
   * `Screen` for a wider column — `SHOP_MAX_WIDTH` below, not the shared
   * constant, so nothing else in the app (checkout, the product page, the
   * panel) changes shape.
   *
   * PIXEL WIDTH, NOT A PERCENTAGE. The old rule was `flexBasis: '48%'`, tuned
   * by trial for one column count at one width — its own comment records
   * getting the arithmetic wrong once already (48% assumed a 4%-of-row gap
   * that was actually 4.5%, and every card wrapped onto its own line).
   * Computing the exact pixel width from the actual available space cannot
   * drift the same way: it is arithmetic on real numbers, not a constant
   * tuned to look right at one size and left to survive every other one.
   *
   * THE FLOOR IS THE CARD, not the screen. MIN_CARD_WIDTH (200px) is the
   * same number the three-column threshold was already built on — three
   * columns of the OLD 800px cap divide out to ~201px each — below which
   * `RemoteArt`'s own 4:5 crop reads as too thin a strip of a garment
   * photograph to shop from. Column count is however many of that width
   * fit, capped at five so a very wide monitor gets more breathing room per
   * card rather than a sixth column of the same width again.
   */
  const windowWidth = useWindowWidth();
  // Floored at 320 (the narrowest phone this app targets) rather than left to
  // go negative — useWindowWidth's own comment explains why its FIRST read on
  // web can still be wrong for one frame, before the effect that corrects it
  // has run, and a negative card width is worse than one frame at the wrong
  // (but sane) column count.
  const contentWidth = Math.max(320, Math.min(windowWidth, SHOP_MAX_WIDTH) - Spacing.three * 2);
  const columns = Math.max(
    2,
    Math.min(MAX_COLUMNS, Math.floor((contentWidth + Spacing.two) / (MIN_CARD_WIDTH + Spacing.two))),
  );
  const cardWidth = (contentWidth - Spacing.two * (columns - 1)) / columns;

  /**
   * NO CATEGORY FILTER — removed 2026-09-09 on the owner's instruction. The
   * shop shows everything, always.
   *
   * WHAT WENT WITH IT, and why it could not stay: the screen used to accept a
   * `?category=` route parameter, which is how the home screen's four tiles
   * opened it already narrowed. With no pill row there is no visible way back
   * to "all", so honouring that parameter would have left a customer in a
   * subset of the shop with nothing on screen to say so and no control to undo
   * it. The tiles now open the whole shop — see (tabs)/index.tsx.
   *
   * The SORT row stays. Sorting narrows nothing: every product is still on the
   * page, in a different order, and the control that changed it is still there
   * to change back.
   */
  const [sort, setSort] = useState<Sort>('new');

  const shown = useMemo(() => {
    if (sort === 'low') return [...products].sort((a, b) => a.price - b.price);
    if (sort === 'high') return [...products].sort((a, b) => b.price - a.price);
    return products;
  }, [products, sort]);

  const Chip = ({
    label,
    active,
    onPress,
  }: {
    label: string;
    active: boolean;
    onPress: () => void;
  }) => (
    <Pressable
      accessibilityRole="button"
      // `selected` is not valid aria on a button and the web build drops it,
      // so every chip announced identically whether it was on or off.
      // `pressed` is the attribute for a button that is on; `selected` stays
      // for native, which reads it directly. This is a LOCAL copy of the chip
      // rather than components/ui/chip.tsx — the shared one exists to stop
      // exactly this drift, and it did not reach here.
      accessibilityState={{ selected: active }}
      aria-pressed={active}
      onPress={onPress}
      // The pill is 36pt because that is how the chip row is meant to look.
      // The thing you TAP is this, and it is 48 — measured at 36 before, which
      // is under the 44 a phone is expected to offer and small enough to miss
      // with a thumb on a moving bus. The pill inside is unchanged.
      style={press(false, styles.chipHit)}>
      <ThemedView
        type={active ? 'backgroundSelected' : 'backgroundElement'}
        style={[styles.chip, { borderColor: active ? theme.tint : theme.controlBorder }]}>
        <ThemedText type="label" themeColor={active ? 'tintText' : 'textSecondary'}>
          {label}
        </ThemedText>
      </ThemedView>
    </Pressable>
  );

  return (
    <Screen
      tabBar
      contentMaxWidth={SHOP_MAX_WIDTH}
      stickyHeader={
        /* The sort row stays on screen while the grid scrolls. On a phone the
           alternative is scrolling back to the top to change your mind.
           The SAME wider cap as the grid below it — otherwise the sticky
           header stays at the old 800px while the grid it sits above
           stretches past it, and the two visibly disagree about how wide
           the page is. */
        <ThemedView type="background" style={styles.sortBar}>
          <ContentColumn style={{ maxWidth: SHOP_MAX_WIDTH }}>
            <ScrollView
              ref={sortRow}
              horizontal
              showsHorizontalScrollIndicator={false}
              onContentSizeChange={startAtReadingEdge(sortRow)}
              contentContainerStyle={[styles.chipRow, row]}>
              <Chip label={t.shop.sortNew} active={sort === 'new'} onPress={() => setSort('new')} />
              <Chip label={t.shop.sortLow} active={sort === 'low'} onPress={() => setSort('low')} />
              <Chip
                label={t.shop.sortHigh}
                active={sort === 'high'}
                onPress={() => setSort('high')}
              />
            </ScrollView>
          </ContentColumn>
        </ThemedView>
      }>

          <ThemedText type="label" themeColor="textSecondary" style={text}>
            {t.shop.results(formatNumber(shown.length, lang), shown.length === 1)}
          </ThemedText>

          {shown.length === 0 ? (
            <ThemedText style={[styles.empty, text]}>{t.shop.empty}</ThemedText>
          ) : (
            <View style={styles.grid}>
              {shown.map((p) => (
                // flexShrink:0 so a card never gives up width to its
                // neighbours: without it, content-based defaults (a flex
                // item's minimum width is its own content, not zero) let a
                // card with a long badge ("الكمية محدودة") resist shrinking
                // while a short one beside it absorbed the difference —
                // visible only once `useWindowWidth` (see its own comment)
                // was reporting the real width and cards should have been
                // uniform but were not.
                <View key={p.slug} style={{ width: cardWidth, flexShrink: 0 }}>
                  <ProductCard product={p} />
                </View>
              ))}
            </View>
          )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  sortBar: {
    paddingTop: Spacing.two,
    paddingBottom: Spacing.two,
    gap: Spacing.two,
  },
  chipRow: {
    gap: Spacing.two,
    paddingVertical: Spacing.one,
  },
  chipHit: { minHeight: TapTarget, justifyContent: 'center' },
  chip: {
    minHeight: TapTarget - 12,
    justifyContent: 'center',
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: Spacing.three,
  },
  // COLUMN COUNT AND CARD WIDTH ARE COMPUTED, not styled — see the comment
  // beside `columns`/`cardWidth` above the render. This used to be a
  // percentage tuned by trial for one width (`flexBasis: '48%'`) and its own
  // comment records the trial getting it wrong once already; the computed
  // pixel width cannot drift the same way because it is arithmetic on the
  // real available space rather than a constant.
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
    marginTop: Spacing.one,
  },
  empty: {
    marginTop: Spacing.five,
    textAlign: 'center',
  },
});
