import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { AdminShell, adminStyles } from '@/components/admin-shell';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing, TapTarget } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { adminApi, Unauthorized, type Summary } from '@/lib/admin';
import { useLang } from '@/lib/i18n';
import { formatPrice } from '@/lib/money';
import { useSession } from '@/lib/session';

export default function BackendsHome() {
  const { token, ready } = useSession();
  if (!ready) return <AdminShell title="" loading />;
  return token ? <Dashboard /> : <SignIn />;
}

function SignIn() {
  const theme = useTheme();
  const { signIn } = useSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await signIn(email, password);
    } catch (e) {
      // The message is the server's, except for the one case worth rewording:
      // "unauthorized" tells a manager nothing about which half was wrong, and
      // saying which half is exactly what an attacker wants.
      setError(e instanceof Unauthorized ? 'Wrong email or password.' : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AdminShell title="Sign in">
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.form}>
          <ThemedText type="small" themeColor="textSecondary">
            Email
          </ThemedText>
          <TextInput
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            keyboardType="email-address"
            autoComplete="email"
            accessibilityLabel="Email"
            style={[
              styles.input,
              { color: theme.text, backgroundColor: theme.backgroundElement, borderColor: theme.border },
            ]}
          />
          <ThemedText type="small" themeColor="textSecondary">
            Password
          </ThemedText>
          <TextInput
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoCapitalize="none"
            autoComplete="current-password"
            accessibilityLabel="Password"
            onSubmitEditing={submit}
            style={[
              styles.input,
              { color: theme.text, backgroundColor: theme.backgroundElement, borderColor: theme.border },
            ]}
          />

          {error && (
            <ThemedText type="small" themeColor="danger" accessibilityLiveRegion="polite">
              {error}
            </ThemedText>
          )}

          <Pressable
            accessibilityRole="button"
            accessibilityState={{ busy, disabled: busy }}
            disabled={busy}
            onPress={submit}
            style={({ pressed }) => [
              styles.primary,
              { backgroundColor: theme.tint },
              pressed && styles.pressed,
            ]}>
            {busy && <ActivityIndicator color="#ffffff" />}
            <Text style={styles.primaryText}>{busy ? 'Signing in…' : 'Sign in'}</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </AdminShell>
  );
}

function Dashboard() {
  const theme = useTheme();
  const router = useRouter();
  const { lang } = useLang();
  const { token, signOut } = useSession();
  const [data, setData] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!token) return;
    setLoading(true);
    setError(null);
    adminApi
      .summary(token)
      .then(setData)
      .catch((e) => (e instanceof Unauthorized ? signOut() : setError(String(e))))
      .finally(() => setLoading(false));
  }, [token, signOut]);

  useEffect(load, [load]);

  return (
    <AdminShell title="Today" loading={loading} error={error} onRetry={load}>
      {data && (
        <>
          <View style={styles.tiles}>
            <Tile label="Orders today" value={String(data.todayOrders)} />
            <Tile label="Taken today" value={formatPrice(data.todayRevenue, lang)} />
            <Tile label="Waiting" value={String(data.pending)} tone={data.pending > 0} />
          </View>

          <Pressable
            accessibilityRole="link"
            onPress={() => router.replace('/backends/orders')}
            style={({ pressed }) => [
              styles.primary,
              { backgroundColor: theme.tint },
              pressed && styles.pressed,
            ]}>
            <Text style={styles.primaryText}>Open orders</Text>
          </Pressable>

          <ThemedText type="smallBold" style={styles.section}>
            Running out
          </ThemedText>
          {data.lowStock.length === 0 ? (
            <ThemedText type="small" themeColor="textSecondary">
              Nothing is low.
            </ThemedText>
          ) : (
            data.lowStock.map((s) => (
              <ThemedView
                key={`${s.slug}-${s.size}`}
                type="backgroundElement"
                style={[adminStyles.card, adminStyles.rowBetween, { borderColor: theme.border }]}>
                <ThemedText type="small">
                  {s.name} · {s.size}
                </ThemedText>
                <ThemedText type="smallBold" themeColor={s.stock === 0 ? 'danger' : 'tint'}>
                  {s.stock}
                </ThemedText>
              </ThemedView>
            ))
          )}
        </>
      )}
    </AdminShell>
  );
}

function Tile({ label, value, tone }: { label: string; value: string; tone?: boolean }) {
  const theme = useTheme();
  return (
    <ThemedView type="backgroundElement" style={[styles.tile, { borderColor: theme.border }]}>
      <ThemedText type="small" themeColor="textSecondary">
        {label}
      </ThemedText>
      <ThemedText type="smallBold" themeColor={tone ? 'tint' : 'text'} style={styles.tileValue}>
        {value}
      </ThemedText>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  form: { gap: Spacing.one },
  input: {
    minHeight: TapTarget,
    borderWidth: 1,
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    fontSize: 16,
  },
  primary: {
    marginTop: Spacing.three,
    minHeight: TapTarget,
    borderRadius: Spacing.three,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
  },
  primaryText: { color: '#ffffff', fontSize: 16, fontWeight: '700' },
  // Wraps to one per row on a narrow phone and sits three-up on anything
  // wider, without a breakpoint: each tile asks for 30% and flexWrap does the
  // rest.
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  tile: {
    flexGrow: 1,
    flexBasis: '30%',
    minWidth: 140,
    borderWidth: 1,
    borderRadius: Spacing.three,
    padding: Spacing.three,
    gap: Spacing.half,
  },
  tileValue: { fontSize: 22, lineHeight: 28 },
  section: { marginTop: Spacing.four, fontSize: 16 },
  pressed: { opacity: 0.85 },
});
