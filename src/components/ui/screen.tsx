import type { ReactNode } from 'react';
import { ScrollView, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';

import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';

/**
 * The frame every screen sits in: safe area, a scroll view, and a column of
 * content that stops widening at MaxContentWidth and centres itself.
 *
 * Eight screens had their own `safeArea`, `scroll` and `content` styles, near
 * enough identical, and the differences between them were not decisions —
 * three forgot the bottom-tab inset, so the last row of each sat under the tab
 * bar until you scrolled past it.
 *
 * `tabBar` is the one thing worth stating per screen: a screen inside the tabs
 * has to clear them, a screen pushed on top of them does not.
 */
export function Screen({
  children,
  tabBar = false,
  edges = ['top'],
  scroll = true,
  contentStyle,
  stickyHeader,
}: {
  children: ReactNode;
  /** Reserve room for the tab bar at the bottom. */
  tabBar?: boolean;
  edges?: readonly Edge[];
  /** Set false for a screen that manages its own scrolling, or has none. */
  scroll?: boolean;
  contentStyle?: StyleProp<ViewStyle>;
  /** Rendered above the content and pinned by the ScrollView. */
  stickyHeader?: ReactNode;
}) {
  const body = (
    <View style={[styles.content, contentStyle]}>{children}</View>
  );

  return (
    <SafeAreaView style={styles.safeArea} edges={edges}>
      {scroll ? (
        <ScrollView
          contentContainerStyle={[
            styles.scroll,
            { paddingBottom: (tabBar ? BottomTabInset : 0) + Spacing.five },
          ]}
          showsVerticalScrollIndicator={false}
          stickyHeaderIndices={stickyHeader ? [0] : undefined}>
          {stickyHeader}
          {body}
        </ScrollView>
      ) : (
        body
      )}
    </SafeAreaView>
  );
}

/** The same column, for anything rendered outside the Screen's scroll view —
 *  a pinned action bar, a summary that rides above the tabs. */
export function ContentColumn({
  children,
  style,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return <View style={[styles.content, style]}>{children}</View>;
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  scroll: { paddingTop: Spacing.three },
  content: {
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
    paddingHorizontal: Spacing.three,
    gap: Spacing.two,
  },
});
