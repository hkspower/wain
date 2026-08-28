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

import { press } from '@/components/ui/press';

import { AdminShell, adminStyles } from '@/components/admin-shell';
import { Button } from '@/components/ui/button';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Elevation, Radius, Spacing, TapTarget } from '@/constants/theme';
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
  const { signIn, signInCode, resendCode } = useSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  // The second factor. Null until the server says one is enrolled — the
  // field must not exist before then, or every shop without 2FA shows an
  // input nothing will ever accept.
  const [code, setCode] = useState<string | null>(null);
  /** Which factor the server asked for, and — for an emailed code — where it
   *  went and whether the mail actually left. Null until it says. */
  const [factor, setFactor] = useState<
    { via: 'totp' | 'email'; sentTo: string | null; sent: boolean | null } | null
  >(null);
  const [resent, setResent] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      if (code !== null) {
        await signInCode(code);
      } else {
        const res = await signIn(email, password);
        if (res.need === 'code') {
          setCode('');
          setFactor({ via: res.via, sentTo: res.sentTo, sent: res.sent });
        }
      }
    } catch (e) {
      // The message is the server's, except for the one case worth rewording:
      // "unauthorized" tells a manager nothing about which half was wrong, and
      // saying which half is exactly what an attacker wants.
      setError(
        e instanceof Unauthorized
          ? code !== null
            ? 'That code was not accepted.'
            : 'Wrong email or password.'
          : e instanceof Error && e.message === 'no_admin_account'
            ? 'No admin account exists on this server yet — see api/setup-admin.php.'
            : String(e),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <AdminShell title="Sign in">
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.form}>
          <ThemedText type="label" themeColor="textSecondary">
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
          <ThemedText type="label" themeColor="textSecondary">
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

          {code !== null && (
            <>
              {/* WHICH CODE, AND WHERE TO FIND IT. The two factors are typed
                  into the same box and live in completely different places —
                  telling somebody to open an authenticator they never
                  installed, while the code sits unread in their inbox, is how
                  a sign-in stalls with everything working. */}
              <ThemedText type="label" themeColor="textSecondary">
                {factor?.via === 'email' ? 'Code from your email' : 'Authenticator code'}
              </ThemedText>
              {factor?.via === 'email' && factor.sentTo && factor.sent !== false && (
                <ThemedText type="caption" themeColor="textSecondary">
                  Sent to {factor.sentTo}. It works once and expires in ten minutes.
                </ThemedText>
              )}
              {/* THE MAIL DID NOT GO. Said plainly, because the alternative is
                  an owner typing a code that was never sent and concluding the
                  shop is broken. It is the shop's mail configuration. */}
              {factor?.via === 'email' && factor.sent === false && (
                <ThemedText type="caption" themeColor="danger">
                  The code could not be emailed — this server cannot send mail.
                  Ask whoever set the shop up to check the mail settings.
                </ThemedText>
              )}
              <TextInput
                value={code}
                onChangeText={setCode}
                keyboardType="number-pad"
                autoComplete="one-time-code"
                accessibilityLabel={factor?.via === 'email' ? 'Code from your email' : 'Authenticator code'}
                onSubmitEditing={submit}
                // The password was right; only the code is being retyped.
                autoFocus
                style={[
                  styles.input,
                  { color: theme.text, backgroundColor: theme.backgroundElement, borderColor: theme.border },
                ]}
              />
              {factor?.via === 'email' && (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Send the code again"
                  onPress={async () => {
                    setResent(null);
                    setError(null);
                    try {
                      const r = await resendCode();
                      setResent(r.sent ? `Sent again to ${r.to}.` : 'Still could not send it.');
                    } catch (e) {
                      // too_soon is the one-a-minute floor, and it is not an
                      // error the way a refusal is — say what it means.
                      setResent(e instanceof Error && e.message === 'too_soon'
                        ? 'Wait a minute before asking for another.'
                        : 'Could not send another code.');
                    }
                  }}
                  style={press(true, styles.resend)}>
                  <ThemedText type="labelBold" themeColor="tintText">Send it again</ThemedText>
                </Pressable>
              )}
              {resent && (
                <ThemedText type="caption" themeColor="textSecondary" accessibilityLiveRegion="polite">
                  {resent}
                </ThemedText>
              )}
            </>
          )}

          {error && (
            <ThemedText type="label" themeColor="danger" accessibilityLiveRegion="polite">
              {error}
            </ThemedText>
          )}

          <Button
            label={busy ? 'Signing in…' : code !== null ? 'Verify code' : 'Sign in'}
            onPress={submit}
            busy={busy}
            style={styles.primary}
          />
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
      .summary()
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

          <Button
            label="Open orders"
            onPress={() => router.replace('/backends/orders')}
            style={styles.primary}
          />

          <ThemedText type="labelBold" style={styles.section}>
            Running out
          </ThemedText>
          {data.lowStock.length === 0 ? (
            <ThemedText type="label" themeColor="textSecondary">
              Nothing is low.
            </ThemedText>
          ) : (
            data.lowStock.map((s) => (
              <ThemedView
                key={`${s.slug}-${s.size}`}
                type="backgroundElement"
                style={[adminStyles.card, adminStyles.rowBetween, adminStyles.lift]}>
                <ThemedText type="label">
                  {s.name} · {s.size}
                </ThemedText>
                <ThemedText type="labelBold" themeColor={s.stock === 0 ? 'danger' : 'tintText'}>
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
    <ThemedView type="backgroundElement" style={[styles.tile, Elevation.card]}>
      <ThemedText type="label" themeColor="textSecondary">
        {label}
      </ThemedText>
      <ThemedText type="labelBold" themeColor={tone ? 'tintText' : 'text'} style={styles.tileValue}>
        {value}
      </ThemedText>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  // 48 tall like every other pressable, not the height of its own text.
  resend: { minHeight: TapTarget, justifyContent: 'center' },
  form: { gap: Spacing.one },
  input: {
    minHeight: TapTarget,
    borderWidth: 1,
    borderRadius: Radius.button,
    paddingHorizontal: Spacing.three,
    fontSize: 16,
  },
  primary: { marginTop: Spacing.three },
  // Wraps to one per row on a narrow phone and sits three-up on anything
  // wider, without a breakpoint: each tile asks for 30% and flexWrap does the
  // rest.
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  tile: {
    flexGrow: 1,
    flexBasis: '30%',
    minWidth: 140,
    borderRadius: Radius.card,
    padding: Spacing.four,
    gap: Spacing.half,
  },
  tileValue: { fontSize: 22, lineHeight: 28 },
  section: { marginTop: Spacing.four, fontSize: 16 },
});
