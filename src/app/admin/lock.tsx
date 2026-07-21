import { Redirect, useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAdminAuth } from '@/lib/admin-auth';

export default function AdminLockScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { unlocked, unlock } = useAdminAuth();
  const [pin, setPin] = useState('');
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);

  if (unlocked) {
    return <Redirect href="/admin" />;
  }

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    const ok = await unlock(pin);
    setBusy(false);
    if (ok) {
      router.replace('/admin');
    } else {
      setError(true);
      setPin('');
    }
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['bottom']}>
      <View style={styles.content}>
        <Text style={styles.emoji}>🔐</Text>
        <ThemedText type="subtitle" style={styles.title}>
          Admin access
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary" style={styles.subtitle}>
          Enter your PIN to manage the places in Wain.
        </ThemedText>

        <TextInput
          value={pin}
          onChangeText={(t) => {
            setPin(t.replace(/[^0-9]/g, '').slice(0, 8));
            setError(false);
          }}
          onSubmitEditing={submit}
          placeholder="••••"
          placeholderTextColor={theme.textSecondary}
          keyboardType="number-pad"
          secureTextEntry
          autoFocus
          returnKeyType="go"
          style={[
            styles.input,
            {
              backgroundColor: theme.backgroundElement,
              borderColor: error ? '#dc2626' : theme.border,
              color: theme.text,
            },
          ]}
        />

        {error && (
          <ThemedText type="small" style={styles.error}>
            Wrong PIN — try again.
          </ThemedText>
        )}

        <Pressable
          onPress={submit}
          disabled={pin.length < 4 || busy}
          style={({ pressed }) => [
            styles.button,
            { backgroundColor: theme.tint, opacity: pin.length < 4 || busy ? 0.5 : pressed ? 0.85 : 1 },
          ]}>
          <Text style={styles.buttonText}>Unlock</Text>
        </Pressable>

        <Pressable onPress={() => router.back()} style={styles.cancel}>
          <ThemedText type="small" themeColor="textSecondary">
            Cancel
          </ThemedText>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  content: {
    flex: 1,
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.four,
    gap: Spacing.three,
  },
  emoji: {
    fontSize: 48,
  },
  title: {
    fontSize: 26,
    lineHeight: 34,
  },
  subtitle: {
    textAlign: 'center',
  },
  input: {
    width: '100%',
    maxWidth: 240,
    borderRadius: Spacing.three,
    borderWidth: 1,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    fontSize: 24,
    letterSpacing: 8,
    textAlign: 'center',
  },
  error: {
    color: '#dc2626',
  },
  button: {
    width: '100%',
    maxWidth: 240,
    borderRadius: Spacing.three,
    paddingVertical: Spacing.three,
    alignItems: 'center',
  },
  buttonText: {
    color: '#ffffff',
    fontWeight: '700',
    fontSize: 16,
  },
  cancel: {
    padding: Spacing.two,
  },
});
