import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { useColorScheme } from 'react-native';

import { Colors } from '@/constants/theme';
import { CartProvider } from '@/lib/cart';
import { LanguageProvider } from '@/lib/i18n';

/**
 * Providers wrap the navigator, not each screen: the basket has to survive
 * moving between tabs and opening a product, which is exactly what a provider
 * above the router gives and a per-screen one does not.
 */
export default function RootLayout() {
  const colorScheme = useColorScheme();
  const theme = colorScheme === 'dark' ? Colors.dark : Colors.light;

  return (
    <LanguageProvider>
      <CartProvider>
        <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
          <Stack
            screenOptions={{
              headerTintColor: theme.tint,
              headerStyle: { backgroundColor: theme.background },
              headerTitleStyle: { color: theme.text },
            }}>
            <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
            <Stack.Screen name="product/[slug]" options={{ title: '' }} />
            <Stack.Screen name="checkout" options={{ title: '' }} />
            <Stack.Screen name="order/[ref]" options={{ title: '', headerBackVisible: false }} />
          </Stack>
        </ThemeProvider>
      </CartProvider>
    </LanguageProvider>
  );
}
