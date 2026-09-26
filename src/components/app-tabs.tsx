import { NativeTabs } from 'expo-router/unstable-native-tabs';

import { useTheme } from '@/hooks/use-theme';
import { useCart } from '@/lib/cart';
import { useLang } from '@/lib/i18n';

export default function AppTabs() {
  // useTheme, NOT useColorScheme + Colors. This screen imported the scheme
  // from react-native and indexed the palette itself, which is the one shape
  // that bypasses every override: it is how the one-mode change left a light
  // tab bar under a dark app, and it is how the owner's colours would have
  // reached the whole shop except the bar along the bottom of it.
  const colors = useTheme();
  const { t } = useLang();
  const { count, ready } = useCart();

  return (
    <NativeTabs
      // tabBar and tabBarActive, not background and tint. The bar borrowed
      // the page's colours until those became the owner's to set — at which
      // point a shop wanting an ink bar under a pale page had no way to say
      // so. Both start at exactly the values that were borrowed.
      backgroundColor={colors.tabBar}
      indicatorColor={colors.backgroundSelected}
      labelStyle={{ selected: { color: colors.tabBarActive } }}>
      <NativeTabs.Trigger name="index">
        <NativeTabs.Trigger.Label>{t.tabs.home}</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon
          src={require('@/assets/images/tabIcons/home.png')}
          renderingMode="template"
        />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="shop">
        <NativeTabs.Trigger.Label>{t.tabs.shop}</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon
          src={require('@/assets/images/tabIcons/shop.png')}
          renderingMode="template"
        />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="cart">
        <NativeTabs.Trigger.Label>{t.tabs.cart}</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon
          src={require('@/assets/images/tabIcons/cart.png')}
          renderingMode="template"
        />
        {/* The badge is the only thing on the tab bar that changes while you
            shop, so it is worth the extra element: a basket you cannot see is
            a basket you forget to check out. */}
        {ready && count > 0 && <NativeTabs.Trigger.Badge>{String(count)}</NativeTabs.Trigger.Badge>}
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="account">
        <NativeTabs.Trigger.Label>{t.tabs.account}</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon
          src={require('@/assets/images/tabIcons/account.png')}
          renderingMode="template"
        />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
