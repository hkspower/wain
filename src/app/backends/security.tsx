import { useCallback, useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, TextInput, View } from 'react-native';

import { AdminShell } from '@/components/admin-shell';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing, TapTarget } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { adminApi, Unauthorized } from '@/lib/admin';
import { useSession } from '@/lib/session';

/**
 * Who can sign in, and how hard it is to fake being them.
 *
 * FOUR CARDS, EACH WITH ITS OWN "CURRENT PASSWORD" BOX. Not one shared field
 * at the top — account_update, totp_begin, totp_disable, otp_begin and
 * otp_disable are five different server routes with five different bodies,
 * and a single password field feeding all of them would mean whichever card
 * was submitted last silently decided what the others saw. Each ceremony
 * asks for exactly what its own route needs, no more.
 *
 * TOTP AND THE EMAILED CODE ARE INDEPENDENT, ON PURPOSE, MATCHING THE
 * SERVER. Both can be on at once — store_login() prefers TOTP when they are,
 * because an authenticator's secret never travels and an emailed code is
 * only as safe as the mailbox — but nothing here forces an either/or the
 * server does not enforce either.
 *
 * NO QR CODE. totp_begin() hands back an otpauth:// URI and no renderer
 * ships in this app for one — the secret itself is shown as a manually-typed
 * code instead, which every authenticator app accepts as the alternative to
 * scanning. One dependency fewer for six digits nobody needs a picture of.
 */
export default function SecurityScreen() {
  const theme = useTheme();
  const { token, signOut, passwordChanged } = useSession();

  const [account, setAccount] = useState<{
    email: string; phone: string | null; totp: boolean; emailOtp: boolean;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!token) return;
    setLoading(true);
    setError(null);
    adminApi
      .account()
      .then(setAccount)
      .catch((e) => (e instanceof Unauthorized ? signOut() : setError(String(e))))
      .finally(() => setLoading(false));
  }, [token, signOut]);

  useEffect(load, [load]);

  const inputStyle = {
    minHeight: TapTarget,
    borderWidth: 1,
    borderRadius: Radius.button,
    paddingHorizontal: Spacing.three,
    fontSize: 16,
    color: theme.text,
    backgroundColor: theme.backgroundElement,
    borderColor: theme.controlBorder,
  };

  return (
    <AdminShell title="Security" loading={loading} error={error} onRetry={load}>
      {account && (
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={{ gap: Spacing.four }}>
            <ContactCard account={account} inputStyle={inputStyle} onSaved={load} />
            <PasswordCard
              account={account}
              inputStyle={inputStyle}
              onChanged={() => {
                passwordChanged();
              }}
            />
            <TotpCard account={account} inputStyle={inputStyle} onSaved={load} />
            <EmailCodeCard account={account} inputStyle={inputStyle} onSaved={load} />
          </View>
        </KeyboardAvoidingView>
      )}
    </AdminShell>
  );
}

type Account = { email: string; phone: string | null; totp: boolean; emailOtp: boolean };

function errorText(e: unknown): string {
  if (!(e instanceof Error)) return String(e);
  switch (e.message) {
    case 'bad_password': return 'That is not the current password.';
    case 'bad_code': return 'That code was not accepted.';
    case 'password_too_short': return 'The new password must be at least twelve characters.';
    case 'password_mismatch': return 'The two new passwords do not match.';
    case 'invalid_email': return 'That is not an email address the server will take.';
    case 'invalid_phone': return 'That is not a phone number the server will take.';
    case 'email_taken': return 'Another account already uses that email.';
    case 'already_enrolled': return 'Already turned on — nothing to do.';
    case 'not_started': return 'Start enrolling first.';
    case 'not_enrolled': return 'This is already off.';
    default:
      return /weak|common|breach|similar/.test(e.message)
        ? 'That password is too easy to guess.'
        : e.message;
  }
}

/** Email and phone — the two facts account_update can also change, kept in
 *  their own card because they are edited far more often than a password. */
function ContactCard({
  account, inputStyle, onSaved,
}: { account: Account; inputStyle: object; onSaved: () => void }) {
  const [email, setEmail] = useState(account.email);
  const [phone, setPhone] = useState(account.phone ?? '');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const dirty = email.trim() !== account.email || phone.trim() !== (account.phone ?? '');

  const save = async () => {
    if (busy || !dirty) return;
    setBusy(true);
    setMsg(null);
    try {
      const changes: { email?: string; phone?: string } = {};
      if (email.trim() !== account.email) changes.email = email.trim();
      if (phone.trim() !== (account.phone ?? '')) changes.phone = phone.trim();
      await adminApi.accountSave(password, code, changes);
      setPassword('');
      setCode('');
      setMsg('Saved.');
      onSaved();
    } catch (e) {
      setMsg(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card style={{ gap: Spacing.two }}>
      <ThemedText type="labelBold">Email and phone</ThemedText>
      <Field label="Email" value={email} onChangeText={setEmail} autoComplete="email" keyboardType="email-address" />
      <Field label="Phone" value={phone} onChangeText={setPhone} autoComplete="tel" keyboardType="phone-pad" />
      <ThemedText type="label" themeColor="textSecondary">Current password</ThemedText>
      <TextInput value={password} onChangeText={setPassword} secureTextEntry autoCapitalize="none"
        autoComplete="current-password" accessibilityLabel="Current password" style={inputStyle as never} />
      <ThemedText type="label" themeColor="textSecondary">
        Verification code — only if you have a second factor on
      </ThemedText>
      <TextInput value={code} onChangeText={setCode} keyboardType="number-pad" maxLength={6}
        accessibilityLabel="Verification code" style={inputStyle as never} />
      {msg && <ThemedText type="label" themeColor={msg === 'Saved.' ? 'text' : 'danger'}>{msg}</ThemedText>}
      <Button label={busy ? 'Saving…' : 'Save'} onPress={save} busy={busy} disabled={!dirty || !password} />
    </Card>
  );
}

/** The password itself. Its own card: changing it ends every session,
 *  including this one, which is not something email/phone edits do. */
function PasswordCard({
  account, inputStyle, onChanged,
}: { account: Account; inputStyle: object; onChanged: () => void }) {
  const [password, setPassword] = useState('');
  const [next, setNext] = useState('');
  const [next2, setNext2] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const save = async () => {
    if (busy) return;
    if (next.length < 12) { setMsg('The new password must be at least twelve characters.'); return; }
    if (next !== next2) { setMsg('The two new passwords do not match.'); return; }
    setBusy(true);
    setMsg(null);
    try {
      await adminApi.accountSave(password, code, { newPassword: next });
      onChanged();
    } catch (e) {
      setMsg(errorText(e));
      setBusy(false);
    }
  };

  return (
    <Card style={{ gap: Spacing.two }}>
      <ThemedText type="labelBold">Password</ThemedText>
      <ThemedText type="caption" themeColor="textSecondary">
        Signs you out everywhere, including here — you will need to sign in again with the new one.
      </ThemedText>
      <ThemedText type="label" themeColor="textSecondary">Current password</ThemedText>
      <TextInput value={password} onChangeText={setPassword} secureTextEntry autoCapitalize="none"
        autoComplete="current-password" accessibilityLabel="Current password" style={inputStyle as never} />
      <ThemedText type="label" themeColor="textSecondary">New password</ThemedText>
      <TextInput value={next} onChangeText={setNext} secureTextEntry autoCapitalize="none"
        autoComplete="new-password" textContentType="newPassword" accessibilityLabel="New password"
        style={inputStyle as never} />
      <ThemedText type="label" themeColor="textSecondary">New password, again</ThemedText>
      <TextInput value={next2} onChangeText={setNext2} secureTextEntry autoCapitalize="none"
        autoComplete="new-password" textContentType="newPassword" accessibilityLabel="New password, again"
        style={inputStyle as never} />
      <ThemedText type="label" themeColor="textSecondary">
        Verification code — only if you have a second factor on
      </ThemedText>
      <TextInput value={code} onChangeText={setCode} keyboardType="number-pad" maxLength={6}
        accessibilityLabel="Verification code" style={inputStyle as never} />
      {msg && <ThemedText type="label" themeColor="danger">{msg}</ThemedText>}
      <Button label={busy ? 'Saving…' : 'Change password'} onPress={save} busy={busy}
        disabled={!password || !next || !next2} />
    </Card>
  );
}

/** The authenticator app — off, mid-enrolment (secret minted, waiting for a
 *  code to prove the phone has it), or on. */
function TotpCard({
  account, inputStyle, onSaved,
}: { account: Account; inputStyle: object; onSaved: () => void }) {
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [secret, setSecret] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const begin = async () => {
    if (busy) return;
    setBusy(true);
    setMsg(null);
    try {
      const r = await adminApi.totpBegin(password);
      setSecret(r.secret);
    } catch (e) {
      setMsg(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    if (busy) return;
    setBusy(true);
    setMsg(null);
    try {
      await adminApi.totpEnable(code);
      setSecret(null);
      setPassword('');
      setCode('');
      onSaved();
    } catch (e) {
      setMsg(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const disable = async () => {
    if (busy) return;
    setBusy(true);
    setMsg(null);
    try {
      await adminApi.totpDisable(password, code);
      setPassword('');
      setCode('');
      onSaved();
    } catch (e) {
      setMsg(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card style={{ gap: Spacing.two }}>
      <ThemedText type="labelBold">Authenticator app {account.totp ? '— on' : ''}</ThemedText>
      {!account.totp && !secret && (
        <>
          <ThemedText type="caption" themeColor="textSecondary">
            Google Authenticator, Authy or anything else that reads a TOTP code.
          </ThemedText>
          <ThemedText type="label" themeColor="textSecondary">Current password</ThemedText>
          <TextInput value={password} onChangeText={setPassword} secureTextEntry autoCapitalize="none"
            autoComplete="current-password" accessibilityLabel="Current password" style={inputStyle as never} />
          {msg && <ThemedText type="label" themeColor="danger">{msg}</ThemedText>}
          <Button label={busy ? 'Starting…' : 'Turn on'} onPress={begin} busy={busy} disabled={!password} />
        </>
      )}
      {!account.totp && secret && (
        <>
          <ThemedText type="label">
            Add this as a manual entry key in your authenticator app, then type the six-digit code it shows.
          </ThemedText>
          <ThemedText type="label" selectable style={{ fontVariant: ['tabular-nums'] }}>
            {secret}
          </ThemedText>
          <ThemedText type="label" themeColor="textSecondary">Code from the app</ThemedText>
          <TextInput value={code} onChangeText={setCode} keyboardType="number-pad" maxLength={6}
            accessibilityLabel="Code from the app" style={inputStyle as never} />
          {msg && <ThemedText type="label" themeColor="danger">{msg}</ThemedText>}
          <Button label={busy ? 'Confirming…' : 'Confirm'} onPress={confirm} busy={busy} disabled={!code} />
        </>
      )}
      {account.totp && (
        <>
          <ThemedText type="label" themeColor="textSecondary">Current password</ThemedText>
          <TextInput value={password} onChangeText={setPassword} secureTextEntry autoCapitalize="none"
            autoComplete="current-password" accessibilityLabel="Current password" style={inputStyle as never} />
          <ThemedText type="label" themeColor="textSecondary">Code from the app</ThemedText>
          <TextInput value={code} onChangeText={setCode} keyboardType="number-pad" maxLength={6}
            accessibilityLabel="Code from the app" style={inputStyle as never} />
          {msg && <ThemedText type="label" themeColor="danger">{msg}</ThemedText>}
          <Button label={busy ? 'Turning off…' : 'Turn off'} onPress={disable} busy={busy}
            disabled={!password || !code} variant="danger" />
        </>
      )}
    </Card>
  );
}

/** The emailed code — same shape as TOTP, three server routes rather than
 *  the file pretending they are one. otpBegin needs a language for the mail
 *  it sends; the panel is English-only chrome, so 'en' always. */
function EmailCodeCard({
  account, inputStyle, onSaved,
}: { account: Account; inputStyle: object; onSaved: () => void }) {
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const begin = async () => {
    if (busy) return;
    setBusy(true);
    setMsg(null);
    try {
      const r = await adminApi.otpBegin(password, 'en');
      setSentTo(r.sent ? r.to : null);
      if (!r.sent) setMsg('Could not send the code — this server cannot send mail.');
    } catch (e) {
      setMsg(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    if (busy) return;
    setBusy(true);
    setMsg(null);
    try {
      await adminApi.otpEnable(code);
      setSentTo(null);
      setPassword('');
      setCode('');
      onSaved();
    } catch (e) {
      setMsg(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const disable = async () => {
    if (busy) return;
    setBusy(true);
    setMsg(null);
    try {
      await adminApi.otpDisable(password, code);
      setPassword('');
      setCode('');
      onSaved();
    } catch (e) {
      setMsg(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card style={{ gap: Spacing.two }}>
      <ThemedText type="labelBold">Emailed code {account.emailOtp ? '— on' : ''}</ThemedText>
      {!account.emailOtp && !sentTo && (
        <>
          <ThemedText type="caption" themeColor="textSecondary">
            A six-digit code sent to your own address each time you sign in.
          </ThemedText>
          <ThemedText type="label" themeColor="textSecondary">Current password</ThemedText>
          <TextInput value={password} onChangeText={setPassword} secureTextEntry autoCapitalize="none"
            autoComplete="current-password" accessibilityLabel="Current password" style={inputStyle as never} />
          {msg && <ThemedText type="label" themeColor="danger">{msg}</ThemedText>}
          <Button label={busy ? 'Sending…' : 'Turn on'} onPress={begin} busy={busy} disabled={!password} />
        </>
      )}
      {!account.emailOtp && sentTo && (
        <>
          <ThemedText type="label">Sent to {sentTo}. Type the code to confirm.</ThemedText>
          <TextInput value={code} onChangeText={setCode} keyboardType="number-pad" maxLength={6}
            accessibilityLabel="Code from your email" style={inputStyle as never} />
          {msg && <ThemedText type="label" themeColor="danger">{msg}</ThemedText>}
          <Button label={busy ? 'Confirming…' : 'Confirm'} onPress={confirm} busy={busy} disabled={!code} />
        </>
      )}
      {account.emailOtp && (
        <>
          <ThemedText type="label" themeColor="textSecondary">Current password</ThemedText>
          <TextInput value={password} onChangeText={setPassword} secureTextEntry autoCapitalize="none"
            autoComplete="current-password" accessibilityLabel="Current password" style={inputStyle as never} />
          <ThemedText type="label" themeColor="textSecondary">Code from your email</ThemedText>
          <TextInput value={code} onChangeText={setCode} keyboardType="number-pad" maxLength={6}
            accessibilityLabel="Code from your email" style={inputStyle as never} />
          {msg && <ThemedText type="label" themeColor="danger">{msg}</ThemedText>}
          <Button label={busy ? 'Turning off…' : 'Turn off'} onPress={disable} busy={busy}
            disabled={!password || !code} variant="danger" />
        </>
      )}
    </Card>
  );
}
