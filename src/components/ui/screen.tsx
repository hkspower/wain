import type { ReactNode } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
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
  actionBar,
  bleed,
  avoidKeyboard = false,
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
  /**
   * A bar BELOW the scroll view, always visible: the Pay button, the basket
   * total, Add to cart. Four screens each built their own because the first
   * version of this component had no way to express it, which is exactly how a
   * shared frame ends up shared by half the app.
   */
  actionBar?: ReactNode;
  /**
   * Rendered inside the scroll view but OUTSIDE the padded column — a
   * full-bleed banner. The column exists to keep text off the edges of a
   * phone; a photograph wants the opposite, and putting it in the column
   * inset it by 16pt on both sides, which is a regression this prop exists to
   * avoid rather than to fix later.
   */
  bleed?: ReactNode;
  /**
   * Lift the content and the action bar above the iOS keyboard. Only the
   * screens with text inputs need it, and it is off by default because
   * wrapping a screen that has none in a KeyboardAvoidingView costs a layout
   * pass and buys nothing.
   */
  avoidKeyboard?: boolean;
}) {
  const body = <View style={[styles.content, contentStyle]}>{children}</View>;

  const frame = (
    <>
      {scroll ? (
        <ScrollView
          contentContainerStyle={[
            styles.scroll,
            // A bleed banner starts at the very top of the screen; the column's
            // usual breathing space above it would push it down and leave a
            // grey band where the picture should be.
            bleed ? { paddingTop: 0 } : null,
            { paddingBottom: (tabBar ? BottomTabInset : 0) + Spacing.five },
          ]}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          stickyHeaderIndices={stickyHeader ? [0] : undefined}>
          {stickyHeader}
          {bleed}
          {body}
        </ScrollView>
      ) : (
        body
      )}
      {actionBar}
    </>
  );

  return (
    <SafeAreaView style={styles.safeArea} edges={edges}>
      {avoidKeyboard ? (
        <KeyboardAvoidingView
          style={styles.safeArea}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          {frame}
        </KeyboardAvoidingView>
      ) : (
        frame
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
