import { useCallback, useEffect, useRef, useState } from 'react';
import { TextInput, View } from 'react-native';

import { AdminShell } from '@/components/admin-shell';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
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
 *
 * ------------------------------------------------------------- ON TYPING
 *
 * Asked for on 2026-09-18 as "more flex and easy for typing at iOS and
 * android devices" — this screen has more text fields than any other in the
 * panel, and until now every one of them was a bare TextInput: no iOS
 * autofill hint (`textContentType`), no "next" on the keyboard to move to
 * the following field, nothing stopping the keyboard from closing and
 * reopening between two fields in the same short form.
 *
 * EVERY FIELD NOW GOES THROUGH `Field`, not a hand-rolled TextInput. It
 * already carried the iOS/Android autofill split (`textContentType` /
 * `autoComplete`) that four other screens in this app already rely on —
 * this screen was the one place still writing that by hand, and the two
 * platforms need different props for the same thing, which is exactly the
 * kind of split that drifts if it is done more than once.
 *
 * EACH CARD CHAINS ITS OWN FIELDS with refs and `returnKeyType="next"`,
 * ending in `"go"` on the last one, wired to submit — so a manager can type
 * a whole card without lifting a finger off the keyboard except to press
 * the final key. `blurOnSubmit={false}` on every field but the last is what
 * stops the keyboard visibly closing and reopening between them, which
 * Field now supports for the same reason this screen needed it.
 */
export default function SecurityScreen() {
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

  return (
    <AdminShell title="Security" loading={loading} error={error} onRetry={load}>
      {/* No KeyboardAvoidingView here any more: AdminShell carries one for
          every screen in the panel, and two nested ones pad twice. */}
      {account && (
        <View style={{ gap: Spacing.four }}>
          <ContactCard account={account} onSaved={load} />
          <LoginAlertCard email={account.email} />
          <PasswordCard
            account={account}
            onChanged={() => {
              passwordChanged();
            }}
          />
          <TotpCard account={account} onSaved={load} />
          <EmailCodeCard account={account} onSaved={load} />
        </View>
      )}
    </AdminShell>
  );
}

type Account = { email: string; phone: string | null; totp: boolean; emailOtp: boolean };

/** No toggle, no setting — this is on for every account and cannot be turned
 *  off from here, so the card is informational rather than editable. It
 *  exists so the alert is not a surprise the first time it fires: an owner
 *  who has never heard of it and gets a "new sign-in" email while on a trip
 *  has one more reason to wonder whether the account was actually theirs.
 *  store_admin_alert_new_ip() in api/store.php is where this is implemented,
 *  behind store_admin_grant() — the one hook every sign-in path funnels
 *  through, so it cannot be reached by a route this card knows nothing about. */
function LoginAlertCard({ email }: { email: string }) {
  return (
    <Card style={{ gap: Spacing.two }}>
      <ThemedText type="labelBold">Sign-in alerts</ThemedText>
      <ThemedText type="label" themeColor="textSecondary">
        {email} gets an email the first time this account signs in from an address it has
        never signed in from before. Every sign-in still succeeds — the alert never blocks
        one — it only tells you it happened, so a password that reaches someone else does
        not go unnoticed.
      </ThemedText>
    </Card>
  );
}

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
function ContactCard({ account, onSaved }: { account: Account; onSaved: () => void }) {
  const [email, setEmail] = useState(account.email);
  const [phone, setPhone] = useState(account.phone ?? '');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const phoneRef = useRef<TextInput>(null);
  const passwordRef = useRef<TextInput>(null);
  const codeRef = useRef<TextInput>(null);

  const dirty = email.trim() !== account.email || phone.trim() !== (account.phone ?? '');

  const save = async () => {
    if (busy || !dirty || !password) return;
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
      <Field
        label="Email" value={email} onChangeText={setEmail}
        autoComplete="email" textContentType="emailAddress" keyboardType="email-address" autoCapitalize="none"
        returnKeyType="next" blurOnSubmit={false} onSubmitEditing={() => phoneRef.current?.focus()}
      />
      <Field
        ref={phoneRef}
        label="Phone" value={phone} onChangeText={setPhone}
        autoComplete="tel" textContentType="telephoneNumber" keyboardType="phone-pad"
        returnKeyType="next" blurOnSubmit={false} onSubmitEditing={() => passwordRef.current?.focus()}
      />
      <Field
        ref={passwordRef}
        label="Current password" value={password} onChangeText={setPassword}
        secureTextEntry autoCapitalize="none" autoComplete="current-password" textContentType="password"
        returnKeyType="next" blurOnSubmit={false} onSubmitEditing={() => codeRef.current?.focus()}
      />
      <Field
        ref={codeRef}
        label="Verification code — only if you have a second factor on" value={code} onChangeText={setCode}
        keyboardType="number-pad" textContentType="oneTimeCode" maxLength={6}
        returnKeyType="go" onSubmitEditing={save}
      />
      {msg && <ThemedText type="label" themeColor={msg === 'Saved.' ? 'text' : 'danger'}>{msg}</ThemedText>}
      <Button label={busy ? 'Saving…' : 'Save'} onPress={save} busy={busy} disabled={!dirty || !password} />
    </Card>
  );
}

/** The password itself. Its own card: changing it ends every session,
 *  including this one, which is not something email/phone edits do. */
function PasswordCard({ account, onChanged }: { account: Account; onChanged: () => void }) {
  const [password, setPassword] = useState('');
  const [next, setNext] = useState('');
  const [next2, setNext2] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const nextRef = useRef<TextInput>(null);
  const next2Ref = useRef<TextInput>(null);
  const codeRef = useRef<TextInput>(null);

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
      <Field
        label="Current password" value={password} onChangeText={setPassword}
        secureTextEntry autoCapitalize="none" autoComplete="current-password" textContentType="password"
        returnKeyType="next" blurOnSubmit={false} onSubmitEditing={() => nextRef.current?.focus()}
      />
      <Field
        ref={nextRef}
        label="New password" value={next} onChangeText={setNext}
        secureTextEntry autoCapitalize="none" autoComplete="off" textContentType="newPassword"
        returnKeyType="next" blurOnSubmit={false} onSubmitEditing={() => next2Ref.current?.focus()}
      />
      <Field
        ref={next2Ref}
        label="New password, again" value={next2} onChangeText={setNext2}
        secureTextEntry autoCapitalize="none" autoComplete="off" textContentType="newPassword"
        returnKeyType="next" blurOnSubmit={false} onSubmitEditing={() => codeRef.current?.focus()}
      />
      <Field
        ref={codeRef}
        label="Verification code — only if you have a second factor on" value={code} onChangeText={setCode}
        keyboardType="number-pad" textContentType="oneTimeCode" maxLength={6}
        returnKeyType="go" onSubmitEditing={save}
      />
      {msg && <ThemedText type="label" themeColor="danger">{msg}</ThemedText>}
      <Button label={busy ? 'Saving…' : 'Change password'} onPress={save} busy={busy}
        disabled={!password || !next || !next2} />
    </Card>
  );
}

/** The authenticator app — off, mid-enrolment (secret minted, waiting for a
 *  code to prove the phone has it), or on. */
function TotpCard({ account, onSaved }: { account: Account; onSaved: () => void }) {
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [secret, setSecret] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const codeRef = useRef<TextInput>(null);

  const begin = async () => {
    if (busy || !password) return;
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
    if (busy || !code) return;
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
    if (busy || !password || !code) return;
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
          <Field
            label="Current password" value={password} onChangeText={setPassword}
            secureTextEntry autoCapitalize="none" autoComplete="current-password" textContentType="password"
            returnKeyType="go" onSubmitEditing={begin}
          />
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
          <Field
            label="Code from the app" value={code} onChangeText={setCode}
            keyboardType="number-pad" textContentType="oneTimeCode" maxLength={6}
            returnKeyType="go" onSubmitEditing={confirm}
          />
          {msg && <ThemedText type="label" themeColor="danger">{msg}</ThemedText>}
          <Button label={busy ? 'Confirming…' : 'Confirm'} onPress={confirm} busy={busy} disabled={!code} />
        </>
      )}
      {account.totp && (
        <>
          <Field
            label="Current password" value={password} onChangeText={setPassword}
            secureTextEntry autoCapitalize="none" autoComplete="current-password" textContentType="password"
            returnKeyType="next" blurOnSubmit={false} onSubmitEditing={() => codeRef.current?.focus()}
          />
          <Field
            ref={codeRef}
            label="Code from the app" value={code} onChangeText={setCode}
            keyboardType="number-pad" textContentType="oneTimeCode" maxLength={6}
            returnKeyType="go" onSubmitEditing={disable}
          />
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
function EmailCodeCard({ account, onSaved }: { account: Account; onSaved: () => void }) {
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const codeRef = useRef<TextInput>(null);

  const begin = async () => {
    if (busy || !password) return;
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
    if (busy || !code) return;
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
    if (busy || !password || !code) return;
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
          <Field
            label="Current password" value={password} onChangeText={setPassword}
            secureTextEntry autoCapitalize="none" autoComplete="current-password" textContentType="password"
            returnKeyType="go" onSubmitEditing={begin}
          />
          {msg && <ThemedText type="label" themeColor="danger">{msg}</ThemedText>}
          <Button label={busy ? 'Sending…' : 'Turn on'} onPress={begin} busy={busy} disabled={!password} />
        </>
      )}
      {!account.emailOtp && sentTo && (
        <>
          <ThemedText type="label">Sent to {sentTo}. Type the code to confirm.</ThemedText>
          <Field
            label="Code from your email" value={code} onChangeText={setCode}
            keyboardType="number-pad" textContentType="oneTimeCode" maxLength={6}
            returnKeyType="go" onSubmitEditing={confirm}
          />
          {msg && <ThemedText type="label" themeColor="danger">{msg}</ThemedText>}
          <Button label={busy ? 'Confirming…' : 'Confirm'} onPress={confirm} busy={busy} disabled={!code} />
        </>
      )}
      {account.emailOtp && (
        <>
          <Field
            label="Current password" value={password} onChangeText={setPassword}
            secureTextEntry autoCapitalize="none" autoComplete="current-password" textContentType="password"
            returnKeyType="next" blurOnSubmit={false} onSubmitEditing={() => codeRef.current?.focus()}
          />
          <Field
            ref={codeRef}
            label="Code from your email" value={code} onChangeText={setCode}
            keyboardType="number-pad" textContentType="oneTimeCode" maxLength={6}
            returnKeyType="go" onSubmitEditing={disable}
          />
          {msg && <ThemedText type="label" themeColor="danger">{msg}</ThemedText>}
          <Button label={busy ? 'Turning off…' : 'Turn off'} onPress={disable} busy={busy}
            disabled={!password || !code} variant="danger" />
        </>
      )}
    </Card>
  );
}
