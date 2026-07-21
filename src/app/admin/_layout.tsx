import { Stack } from 'expo-router';

import { useTheme } from '@/hooks/use-theme';

export default function AdminLayout() {
  const theme = useTheme();

  return (
    <Stack
      screenOptions={{
        headerTintColor: theme.tint,
        headerStyle: { backgroundColor: theme.background },
        headerTitleStyle: { color: theme.text },
        contentStyle: { backgroundColor: theme.background },
      }}>
      <Stack.Screen name="lock" options={{ title: 'Admin access' }} />
      <Stack.Screen name="index" options={{ title: 'Admin panel' }} />
      <Stack.Screen name="edit/[slug]" options={{ title: 'Edit place' }} />
    </Stack>
  );
}
