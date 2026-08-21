import {
  Tabs,
  TabList,
  TabTrigger,
  TabSlot,
  TabTriggerSlotProps,
  TabListProps,
} from 'expo-router/ui';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useCart } from '@/lib/cart';
import { useLang } from '@/lib/i18n';

/**
 * The web build gets a top bar rather than the native tab bar. Same four
 * destinations, same order, and the order is stated in `dir` terms so Arabic
 * reads right to left here too.
 */
export default function AppTabs() {
  const { t } = useLang();
  const { count, ready } = useCart();

  return (
    // The bar comes BEFORE the slot and is in normal flow, not absolutely
    // positioned over it. Floating it looked fine on a page that opens with a
    // hero and broke the moment a screen put something interactive at the top:
    // the shop's sticky filter chips rendered underneath the bar and could not
    // be tapped at all — a control that is visible, enabled, and inert.
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
            <TabButton>{ready && count > 0 ? `${t.tabs.cart} (${count})` : t.tabs.cart}</TabButton>
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

export function TabButton({ children, isFocused, ...props }: TabTriggerSlotProps) {
  return (
    <Pressable {...props} style={({ pressed }) => pressed && styles.pressed}>
      <ThemedView
        type={isFocused ? 'backgroundSelected' : 'backgroundElement'}
        style={styles.tabButtonView}>
        <ThemedText type="small" themeColor={isFocused ? 'tint' : 'textSecondary'}>
          {children}
        </ThemedText>
      </ThemedView>
    </Pressable>
  );
}

export function CustomTabList(props: TabListProps) {
  const { t, row } = useLang();

  return (
    <View {...props} style={styles.tabListContainer}>
      <ThemedView type="backgroundElement" style={[styles.innerContainer, row]}>
        <ThemedText type="smallBold" style={styles.brandText} themeColor="tint">
          {t.brand}
        </ThemedText>
        {props.children}
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
    padding: Spacing.three,
    justifyContent: 'center',
    alignItems: 'center',
    flexDirection: 'row',
  },
  innerContainer: {
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.five,
    borderRadius: Spacing.five,
    alignItems: 'center',
    flexGrow: 1,
    gap: Spacing.two,
    maxWidth: MaxContentWidth,
  },
  brandText: {
    // marginEnd, not marginRight: this is the one element that has to push the
    // others away from the brand mark, and which side that is depends on the
    // language.
    marginEnd: 'auto',
    fontSize: 18,
    letterSpacing: 1,
  },
  pressed: {
    opacity: 0.7,
  },
  tabButtonView: {
    paddingVertical: Spacing.one,
    paddingHorizontal: Spacing.three,
    borderRadius: Spacing.three,
  },
});
