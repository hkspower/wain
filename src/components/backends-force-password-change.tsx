import { useState } from 'react';
import { KeyboardAvoidingView, Platform, TextInput, View } from 'react-native';

import { AdminShell } from '@/components/admin-shell';
import { Button } from '@/components/ui/button';
import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing, TapTarget } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { adminApi } from '@/lib/admin';
import { useSession } from '@/lib/session';

/**
 * The screen `_layout.tsx` renders IN PLACE OF the whole panel whenever
 * `mustChangePassword` is true — never as a route of its own, because it must
 * not be something a manager can navigate away from while it applies. Every
 * other admin route already 428s on the server; this is the one door that
 * stays open, matching admin.php's own `in_array($r, ['account', 'account_update'])`
 * exception.
 *
 * LIVES IN src/components, NOT src/app/backends. Expo Router treats every
 * file under app/ as a route regardless of an underscore prefix — that
 * convention only exempts _layout.tsx by name, nothing else — so this component
 * first shipped as its own routable screen at /backends/_force-password-change,
 * reachable by anyone who typed the URL, before build:web's own route list
 * said so.
 *
 * WHY THIS EXISTS AT ALL. reset-admin-password.php is the only way this shop
 * recovers a locked-out admin, and whatever password it sets has already
 * travelled through a cron command that at least one other person — whoever
 * ran it — can read. A password like that should get exactly one use.
 */
export function ForcePasswordChange() {
  const theme = useTheme();
  const { passwordChanged } = useSession();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [next2, setNext2] = useState('');
  // Shown always rather than only for an account with a factor enrolled:
  // me() only reports `totp`, not whether an emailed code is on, and asking
  // for a code that turns out not to be needed costs nothing — the server
  // accepts '' when neither is enrolled.
  const [code, setCode] = useState('');
  const [sentCode, setSentCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const sendEmailCode = async () => {
    setError(null);
    try {
      const r = await adminApi.otpSend();
      setSentCode(r.sent ? `Sent to ${r.to}.` : 'This account has no emailed code enrolled, or the mail could not go — try an authenticator code instead if one is set up.');
    } catch (e) {
      setSentCode(e instanceof Error && e.message === 'too_soon' ? 'Wait a minute before asking again.' : 'Could not send a code.');
    }
  };

  const submit = async () => {
    if (busy) return;
    if (next.length < 12) {
      setError('The new password must be at least twelve characters.');
      return;
    }
    if (next !== next2) {
      setError('The two new passwords do not match.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await adminApi.accountUpdate(current, next, code.trim());
      // The server already ended the session on this exact success — see
      // accountUpdate's own comment. This just says so out loud before
      // catching the local state up with it.
      setDone(true);
      setTimeout(passwordChanged, 1200);
    } catch (e) {
      setError(
        e instanceof Error && e.message === 'bad_password'
          ? 'That is not the password you just signed in with.'
          : e instanceof Error && e.message === 'password_mismatch'
            ? 'The two new passwords do not match.'
            : e instanceof Error && e.message === 'password_too_short'
              ? 'The new password must be at least twelve characters.'
              : e instanceof Error && e.message === 'bad_code'
                ? 'That code was not accepted.'
                : e instanceof Error && /weak|common|breach|similar/.test(e.message)
                  ? 'That password is too easy to guess — try something less predictable.'
                  : e instanceof Error
                    ? e.message
                    : String(e),
      );
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <AdminShell title="Password changed" hideNav>
        <ThemedText type="label">
          Your new password is set. Sign in again with it.
        </ThemedText>
      </AdminShell>
    );
  }

  return (
    <AdminShell title="Choose a new password" hideNav>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={{ gap: Spacing.one }}>
          <ThemedText type="label">
            This password was set to get you back in, not to keep using. Choose a real one before doing
            anything else in the panel.
          </ThemedText>

          <ThemedText type="label" themeColor="textSecondary">
            Current (temporary) password
          </ThemedText>
          <TextInput
            value={current}
            onChangeText={setCurrent}
            secureTextEntry
            autoCapitalize="none"
            textContentType="password"
            autoComplete="current-password"
            accessibilityLabel="Current temporary password"
            style={[
              styles.input,
              { color: theme.text, backgroundColor: theme.backgroundElement, borderColor: theme.controlBorder },
            ]}
          />

          <ThemedText type="label" themeColor="textSecondary">
            New password (at least 12 characters)
          </ThemedText>
          <TextInput
            value={next}
            onChangeText={setNext}
            secureTextEntry
            autoCapitalize="none"
            textContentType="newPassword"
            autoComplete="new-password"
            accessibilityLabel="New password"
            style={[
              styles.input,
              { color: theme.text, backgroundColor: theme.backgroundElement, borderColor: theme.controlBorder },
            ]}
          />

          <ThemedText type="label" themeColor="textSecondary">
            New password, again
          </ThemedText>
          <TextInput
            value={next2}
            onChangeText={setNext2}
            secureTextEntry
            autoCapitalize="none"
            textContentType="newPassword"
            autoComplete="new-password"
            accessibilityLabel="New password, again"
            onSubmitEditing={submit}
            style={[
              styles.input,
              { color: theme.text, backgroundColor: theme.backgroundElement, borderColor: theme.controlBorder },
            ]}
          />

          <ThemedText type="label" themeColor="textSecondary">
            Verification code — only if this account has one enrolled
          </ThemedText>
          <TextInput
            value={code}
            onChangeText={setCode}
            keyboardType="number-pad"
            autoComplete="one-time-code"
            textContentType="oneTimeCode"
            maxLength={6}
            accessibilityLabel="Verification code"
            onSubmitEditing={submit}
            style={[
              styles.input,
              { color: theme.text, backgroundColor: theme.backgroundElement, borderColor: theme.controlBorder },
            ]}
          />
          <Button label="Email me a code" onPress={sendEmailCode} variant="secondary" />
          {sentCode && (
            <ThemedText type="caption" themeColor="textSecondary" accessibilityLiveRegion="polite">
              {sentCode}
            </ThemedText>
          )}

          {error && (
            <ThemedText type="label" themeColor="danger" accessibilityLiveRegion="polite">
              {error}
            </ThemedText>
          )}

          <Button
            label={busy ? 'Saving…' : 'Set new password'}
            onPress={submit}
            busy={busy}
            style={{ marginTop: Spacing.three }}
          />
        </View>
      </KeyboardAvoidingView>
    </AdminShell>
  );
}

const styles = {
  input: {
    minHeight: TapTarget,
    borderWidth: 1,
    borderRadius: Radius.button,
    paddingHorizontal: Spacing.three,
    fontSize: 16,
  },
} as const;
