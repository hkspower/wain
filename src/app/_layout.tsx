import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { useColorScheme } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { Colors } from '@/constants/theme';
import { AdminAuthProvider } from '@/lib/admin-auth';
import { PlacesProvider } from '@/lib/places-store';

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const theme = colorScheme === 'dark' ? Colors.dark : Colors.light;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <PlacesProvider>
        <AdminAuthProvider>
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
              <Stack.Screen name="admin" options={{ headerShown: false }} />
            </Stack>
          </ThemeProvider>
        </AdminAuthProvider>
      </PlacesProvider>
    </GestureHandlerRootView>
  );
}
