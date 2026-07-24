import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { useColorScheme } from 'react-native';

import { Colors } from '@/constants/theme';

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const theme = colorScheme === 'dark' ? Colors.dark : Colors.light;

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <Stack
        screenOptions={{
          headerTintColor: theme.tint,
          headerStyle: { backgroundColor: theme.background },
          headerTitleStyle: { color: theme.text },
        }}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="place/[slug]" options={{ title: '' }} />
        <Stack.Screen name="about" options={{ title: 'About Wain' }} />
        <Stack.Screen name="almuhalla" options={{ title: 'Almuhalla — Code Editor' }} />
        <Stack.Screen name="nokha1/index" options={{ title: 'Nokha1 — النوخذة' }} />
        <Stack.Screen name="nokha1/safi" options={{ title: 'صافي — SAFI' }} />
        <Stack.Screen name="nokha1/xbrl" options={{ title: 'XBRL — التقارير المالية' }} />
        <Stack.Screen name="nokha1/delivery" options={{ title: 'التوصيل — Delivery' }} />
      </Stack>
    </ThemeProvider>
  );
}
