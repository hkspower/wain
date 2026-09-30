import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Spacing } from '@/constants/theme';
import { useCustomerSession } from '@/lib/customer-session';
import { Unauthorized } from '@/lib/customer';
import { useLang } from '@/lib/i18n';

/**
 * A shopper's own sign-in, on the Account tab — fast registration on
 * purpose: email and password only. See src/lib/customer.ts's own header for
 * why nothing more is asked here — a full name and delivery address are
 * CHECKOUT's job, every time, account or no account, and were never
 * blocking fields for the account itself.
 *
 * Renders nothing while useCustomerSession() has not answered yet, so a
 * returning shopper never sees this form flash past their own signed-in
 * state — the same reasoning account.tsx's own `ready` gate would use if it
 * needed one.
 */
export function CustomerAuthCard() {
  const { customer, ready, register, signIn, signOut } = useCustomerSession();
  const { t, text } = useLang();
  const a = t.account.auth;

  const [mode, setMode] = useState<'signIn' | 'register'>('signIn');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  if (!ready) return null;

  if (customer) {
    return (
      <Card style={styles.card}>
        <ThemedText type="label" themeColor="textSecondary" style={text}>
          {a.signedInAs}
        </ThemedText>
        <ThemedText type="labelBold" style={text}>
          {customer.email}
        </ThemedText>
        <Button label={a.signOut} variant="secondary" onPress={signOut} />
      </Card>
    );
  }

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      if (mode === 'register') await register(email, password);
      else await signIn(email, password);
      setEmail('');
      setPassword('');
    } catch (e) {
      // customer_login answers a wrong email or password with 401, and
      // customer.ts's call() throws Unauthorized for ANY 401 without reading
      // the body — the same shape admin.ts's login() has, handled the same
      // way admin/index.tsx's own sign-in screen handles it: Unauthorized
      // here can only ever mean bad credentials, since register's own
      // refusals (400/409) carry their real token straight through.
      const key = e instanceof Unauthorized ? 'bad_credentials' : e instanceof Error ? e.message : 'failed';
      setError((a as Record<string, string>)[key] ?? a.failed);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card style={styles.card}>
      <ThemedText type="labelBold" style={text}>
        {mode === 'register' ? a.registerTitle : a.signInTitle}
      </ThemedText>
      {mode === 'register' && (
        <ThemedText type="label" themeColor="textSecondary" style={text}>
          {a.registerHint}
        </ThemedText>
      )}

      <Field
        label={a.email}
        value={email}
        onChangeText={setEmail}
        keyboardType="email-address"
        autoComplete="email"
      />
      <Field
        label={a.password}
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoComplete={mode === 'register' ? undefined : 'current-password'}
      />

      {error ? (
        <ThemedText type="label" themeColor="danger" style={text} accessibilityLiveRegion="polite">
          {error}
        </ThemedText>
      ) : null}

      <View style={styles.actions}>
        <Button
          label={busy ? '…' : mode === 'register' ? a.register : a.signIn}
          onPress={submit}
          disabled={busy || !email || !password}
        />
      </View>

      <ThemedText
        type="label"
        themeColor="tint"
        style={[text, styles.switch]}
        onPress={() => {
          setMode(mode === 'register' ? 'signIn' : 'register');
          setError('');
        }}>
        {mode === 'register' ? a.switchToSignIn : a.switchToRegister}
      </ThemedText>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: Spacing.two },
  actions: { marginTop: Spacing.two },
  switch: { marginTop: Spacing.two },
});
