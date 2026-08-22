import { useFonts } from 'expo-font';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import Head from 'expo-router/head';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { useColorScheme } from 'react-native';

import { Colors, FONT_FILES } from '@/constants/theme';
import { CartProvider } from '@/lib/cart';
import { LanguageProvider } from '@/lib/i18n';
import { SessionProvider } from '@/lib/session';

/**
 * Providers wrap the navigator, not each screen: the basket has to survive
 * moving between tabs and opening a product, which is exactly what a provider
 * above the router gives and a per-screen one does not.
 */
// Hold the splash screen until the typefaces are in memory. Without this the
// first frame paints in the system font and then reflows when the real one
// arrives — every line shifting at once, on the screen a customer forms their
// first impression from.
SplashScreen.preventAutoHideAsync().catch(() => {});

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const theme = colorScheme === 'dark' ? Colors.dark : Colors.light;
  const [fontsReady, fontError] = useFonts(FONT_FILES);

  useEffect(() => {
    // Hidden on error as well as on success: a font that fails to load is a
    // reason to render in the system face, not a reason to show the splash
    // screen for ever.
    if (fontsReady || fontError) SplashScreen.hideAsync().catch(() => {});
  }, [fontsReady, fontError]);

  if (!fontsReady && !fontError) return null;

  return (
    <LanguageProvider>
      {/* The tab every page opens in, and what a shared link shows. This is
          the app-wide default; a screen that knows better — a product page
          knows the product's name — replaces it with a Head of its own.
          Without it the export wrote an empty <title> into all twelve pages
          and every tab was called "127.0.0.1". */}
      <Head>
        <title>سبورتا — Sporta</title>
        <meta
          name="description"
          content="سبورتا — ملابس وأحذية رياضية في الكويت، توصيل خلال ١-٣ أيام."
        />
      </Head>
      <CartProvider>
        <SessionProvider>
          <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
            <Stack
              screenOptions={{
                // The tab a page opens in. On web this is what the navigator
                // writes into <title>, and every screen that sets its own
                // replaces it — the shop's name is what is left for the ones
                // that do not, in place of the empty title the export was
                // writing into every page.
                title: 'سبورتا',
                headerTintColor: theme.tint,
                headerStyle: { backgroundColor: theme.background },
                headerTitleStyle: { color: theme.text },
              }}>
              <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
              <Stack.Screen name="product/[slug]" />
              <Stack.Screen name="checkout" />
              <Stack.Screen name="order/[ref]" options={{ headerBackVisible: false }} />
              {/* /backends, the same address the website's panel answers on.
                  Outside the tabs on purpose: it is not a fifth thing a
                  customer browses, and it must not appear in the tab bar of a
                  shopping app. */}
              <Stack.Screen name="backends" options={{ headerShown: false }} />
            </Stack>
          </ThemeProvider>
        </SessionProvider>
      </CartProvider>
    </LanguageProvider>
  );
}
