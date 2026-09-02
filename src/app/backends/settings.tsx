import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AdminShell } from '@/components/admin-shell';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Chip } from '@/components/ui/chip';
import { Field } from '@/components/ui/field';
import { Spacing } from '@/constants/theme';
import {
  adminApi,
  Unauthorized,
  type ContactDetails,
  type PromoBar,
} from '@/lib/admin';
import { useSession } from '@/lib/session';

/**
 * The two things about the shop that are text rather than stock or money: the
 * strip above the header, and how to reach the shop.
 *
 * ONE SCREEN, TWO SAVES. They are unrelated — a marketing line that changes
 * weekly and a phone number that changes once — so a single Save would make
 * editing one of them rewrite the other. Each card owns its own button, its
 * own busy state and its own notice, and neither can lose the other's edit.
 *
 * WHAT THE OWNER SHOULD KNOW, and the screen says it rather than leaving it in
 * a commit message: the top bar takes effect on the website immediately,
 * because the storefront reads it from the server on every load. The contact
 * details reach the website through assets/contact.js, which swaps them into
 * the built pages — so they also take effect at once, but only on a server
 * where that file has been uploaded.
 */

const ISO = /^\d{4}-\d{2}-\d{2}$/;

export default function SettingsScreen() {
  const { token, signOut } = useSession();

  const [bar, setBar] = useState<PromoBar | null>(null);
  const [contact, setContact] = useState<ContactDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Per-card, so saving the bar cannot put the contact card into a busy state
  // or clear the notice it just showed.
  const [barBusy, setBarBusy] = useState(false);
  const [barNote, setBarNote] = useState<string | null>(null);
  const [contactBusy, setContactBusy] = useState(false);
  const [contactNote, setContactNote] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!token) return;
    setLoading(true);
    setError(null);
    Promise.all([adminApi.promoBar(), adminApi.contact()])
      .then(([b, c]) => {
        setBar(b);
        setContact(c);
      })
      .catch((e) => (e instanceof Unauthorized ? signOut() : setError(String(e))))
      .finally(() => setLoading(false));
  }, [token, signOut]);

  useEffect(load, [load]);

  /* AN EMPTY DATE FIELD IS null, NOT "". The server reads null as "no bound"
     and refuses an unparseable string, so sending "" would fail the whole save
     because somebody cleared an end date — losing the text edit beside it.

     What is typed is kept as typed rather than being validated here. Rejecting
     a half-finished date on every keystroke means the field fights the owner
     while they are still typing "2026-0"; badDate() runs at save instead. */
  const asDate = (v: string): string | null => (v.trim() === '' ? null : v.trim());
  const badDate = (v: string | null) => v !== null && !ISO.test(v);

  const saveBar = async () => {
    if (!bar || barBusy) return;
    if (badDate(bar.startsAt) || badDate(bar.endsAt)) {
      setBarNote('Dates must be YYYY-MM-DD, or empty.');
      return;
    }
    setBarBusy(true);
    setBarNote(null);
    try {
      await adminApi.savePromoBar(bar);
      // RE-READ rather than trust the draft. The server trims the text to 160
      // characters and refuses an external href by blanking it; showing the
      // owner what was typed rather than what was stored is how a silently
      // dropped link becomes "I saved it and it does not work".
      setBar(await adminApi.promoBar());
      setBarNote('Saved. The website picks this up on the next page load.');
    } catch (e) {
      if (e instanceof Unauthorized) return signOut();
      setBarNote(String(e));
    } finally {
      setBarBusy(false);
    }
  };

  const saveContact = async () => {
    if (!contact || contactBusy) return;
    setContactBusy(true);
    setContactNote(null);
    try {
      await adminApi.saveContact(contact);
      // Same reason, and here it matters more: the server normalises the
      // WhatsApp number through the checkout's own phone function and strips
      // the @ off an instagram handle. The owner should see the stored value.
      setContact(await adminApi.contact());
      setContactNote('Saved.');
    } catch (e) {
      if (e instanceof Unauthorized) return signOut();
      setContactNote(
        String(e).includes('invalid_email')
          ? 'That email address is not valid.'
          : String(e).includes('invalid_whatsapp')
            ? 'That WhatsApp number is not a Kuwaiti number.'
            : String(e),
      );
    } finally {
      setContactBusy(false);
    }
  };

  const set = <K extends keyof PromoBar>(k: K, v: PromoBar[K]) =>
    setBar((b) => (b ? { ...b, [k]: v } : b));
  const setC = <K extends keyof ContactDetails>(k: K, v: ContactDetails[K]) =>
    setContact((c) => (c ? { ...c, [k]: v } : c));

  return (
    <AdminShell title="Settings" loading={loading} error={error} onRetry={load}>
      {bar && (
        <Card style={styles.card}>
          <ThemedText type="heading">Top bar</ThemedText>
          <ThemedText type="caption" themeColor="textSecondary" style={styles.hint}>
            The strip above the header, on every page of the website.
          </ThemedText>

          <View style={styles.row}>
            <Chip
              label={bar.enabled ? 'Showing' : 'Hidden'}
              active={bar.enabled}
              onPress={() => set('enabled', !bar.enabled)}
            />
          </View>

          <Field
            label="Arabic"
            value={bar.textAr}
            onChangeText={(v) => set('textAr', v)}
          />
          <Field
            label="English"
            value={bar.textEn}
            onChangeText={(v) => set('textEn', v)}
          />
          <Field
            label="Link (optional, a path on this site — e.g. /shop)"
            value={bar.href}
            onChangeText={(v) => set('href', v)}
            autoCapitalize="none"
          />

          {/* The window is optional at BOTH ends, and they are independent —
              "from Thursday, forever" and "until the end of the month" are
              both real things a shop wants. */}
          <Field
            label="Starts (YYYY-MM-DD, optional)"
            value={bar.startsAt ?? ''}
            onChangeText={(v) => set('startsAt', asDate(v))}
            autoCapitalize="none"
          />
          <Field
            label="Ends (YYYY-MM-DD, optional)"
            value={bar.endsAt ?? ''}
            onChangeText={(v) => set('endsAt', asDate(v))}
            autoCapitalize="none"
          />

          {barNote && (
            <ThemedText type="label" themeColor="textSecondary" style={styles.note}>{barNote}</ThemedText>
          )}
          <Button label="Save top bar" onPress={saveBar} busy={barBusy} />
        </Card>
      )}

      {contact && (
        <Card style={styles.card}>
          <ThemedText type="heading">Contact details</ThemedText>
          <ThemedText type="caption" themeColor="textSecondary" style={styles.hint}>
            Shown on the contact, about, terms, privacy and returns pages, and on
            every invoice. Leave a field empty to hide it.
          </ThemedText>

          <Field
            label="Phone, as it should be printed"
            value={contact.phone}
            onChangeText={(v) => setC('phone', v)}
            keyboardType="phone-pad"
            textContentType="telephoneNumber"
          />
          <Field
            label="WhatsApp number (with country code)"
            value={contact.whatsapp}
            onChangeText={(v) => setC('whatsapp', v)}
            keyboardType="phone-pad"
            textContentType="telephoneNumber"
          />
          <Field
            label="Email"
            value={contact.email}
            onChangeText={(v) => setC('email', v)}
            keyboardType="email-address"
            textContentType="emailAddress"
            autoCapitalize="none"
          />
          <Field
            label="Instagram handle (without the @)"
            value={contact.instagram}
            onChangeText={(v) => setC('instagram', v)}
            autoCapitalize="none"
          />
          <Field
            label="Address — Arabic"
            value={contact.addressAr}
            onChangeText={(v) => setC('addressAr', v)}
          />
          <Field
            label="Address — English"
            value={contact.addressEn}
            onChangeText={(v) => setC('addressEn', v)}
          />
          <Field
            label="Opening hours — Arabic"
            value={contact.hoursAr}
            onChangeText={(v) => setC('hoursAr', v)}
          />
          <Field
            label="Opening hours — English"
            value={contact.hoursEn}
            onChangeText={(v) => setC('hoursEn', v)}
          />

          {contactNote && (
            <ThemedText type="label" themeColor="textSecondary" style={styles.note}>
              {contactNote}
            </ThemedText>
          )}
          <Button label="Save contact details" onPress={saveContact} busy={contactBusy} />
        </Card>
      )}
    </AdminShell>
  );
}

const styles = StyleSheet.create({
  card: { marginBottom: Spacing.four, gap: Spacing.two },
  hint: { fontSize: 13, marginBottom: Spacing.two },
  row: { flexDirection: 'row', gap: Spacing.two, marginBottom: Spacing.two },
  note: { fontSize: 13, marginBottom: Spacing.one },
});
