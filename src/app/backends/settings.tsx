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
  type FooterText,
  type PromoBar,
  type ThemeSettings,
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
  /* Two pieces of state, not one. `knetId` is what is in the box and `knetSource`
     is where the gateway is reading from right now — and they are genuinely
     different facts. An empty box on a shop taking payments perfectly well
     means "the ID lives in knet/config.php", which is the normal case, and a
     screen that showed only the box would read as "no ID configured". */
  const [footer, setFooter] = useState<FooterText | null>(null);
  const [theme, setTheme] = useState<ThemeSettings | null>(null);
  const [themeBusy, setThemeBusy] = useState(false);
  const [themeNote, setThemeNote] = useState<string | null>(null);
  const [knetId, setKnetId] = useState('');
  const [knetSource, setKnetSource] = useState<'file' | 'database'>('file');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Per-card, so saving the bar cannot put the contact card into a busy state
  // or clear the notice it just showed.
  const [barBusy, setBarBusy] = useState(false);
  const [barNote, setBarNote] = useState<string | null>(null);
  const [contactBusy, setContactBusy] = useState(false);
  const [contactNote, setContactNote] = useState<string | null>(null);
  const [footerBusy, setFooterBusy] = useState(false);
  const [footerNote, setFooterNote] = useState<string | null>(null);
  const [knetBusy, setKnetBusy] = useState(false);
  const [knetNote, setKnetNote] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!token) return;
    setLoading(true);
    setError(null);
    Promise.all([adminApi.promoBar(), adminApi.contact(), adminApi.knetSettings(),
                 adminApi.footer(), adminApi.theme()])
      .then(([b, c, k, f, t]) => {
        setBar(b);
        setContact(c);
        setFooter(f);
        setTheme(t);
        setKnetId(k.tranportal_id);
        setKnetSource(k.source);
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

  /* SAVING THE ID CHANGES WHERE REAL MONEY GOES, so this one says more than
     "Saved." and re-reads like the others. A wrong Tranportal ID is a shop
     that takes the customer to KNET and is refused there on every order, with
     nothing in the shop's own logs explaining it — the gateway rejects the
     merchant, not the basket. The owner deserves to be told to test it. */
  /* THE FOOTER IS PROSE, so there is nothing to validate — only to save and
     read back. The server caps each field, and showing the owner the stored
     value rather than what they typed is how a silent truncation stops being
     a mystery. */
  const setT = (k: keyof ThemeSettings, v: string) =>
    setTheme((t) => (t ? { ...t, [k]: v } : t));

  const saveTheme = async () => {
    if (!theme) return;
    setThemeBusy(true);
    setThemeNote(null);
    try {
      await adminApi.saveTheme(theme);
      setTheme(await adminApi.theme());
      setThemeNote('Saved. The website picks this up on the next page load.');
    } catch (e) {
      if (e instanceof Unauthorized) throw e;
      // THE SERVER NAMES THE FIELD IT REFUSED — invalid_theme_accent, and so
      // on — because a colour in the wrong format does not look wrong, it
      // produces a declaration the browser discards. Showing the raw token is
      // worth more here than a tidy sentence that hides which box to fix.
      setThemeNote(String(e));
    } finally {
      setThemeBusy(false);
    }
  };

  const saveFooter = async () => {
    if (!footer || footerBusy) return;
    setFooterBusy(true);
    setFooterNote(null);
    try {
      await adminApi.saveFooter(footer);
      setFooter(await adminApi.footer());
      setFooterNote('Saved. The website picks this up on the next page load.');
    } catch (e) {
      if (e instanceof Unauthorized) return signOut();
      setFooterNote(String(e));
    } finally {
      setFooterBusy(false);
    }
  };

  const saveKnet = async () => {
    if (knetBusy) return;
    setKnetBusy(true);
    setKnetNote(null);
    try {
      await adminApi.saveKnetId(knetId);
      const k = await adminApi.knetSettings();
      setKnetId(k.tranportal_id);
      setKnetSource(k.source);
      setKnetNote(
        k.source === 'database'
          ? 'Saved. Place one real order to confirm KNET accepts it.'
          : 'Cleared. The gateway is back on the ID in knet/config.php.',
      );
    } catch (e) {
      if (e instanceof Unauthorized) return signOut();
      setKnetNote(
        String(e).includes('invalid_tranportal_id')
          ? 'A Tranportal ID is 3 to 32 letters or digits, with no spaces.'
          : String(e).includes('placeholder_tranportal_id')
            ? 'That is the example value, not a real ID from KNET.'
            : String(e),
      );
    } finally {
      setKnetBusy(false);
    }
  };

  const set = <K extends keyof PromoBar>(k: K, v: PromoBar[K]) =>
    setBar((b) => (b ? { ...b, [k]: v } : b));
  const setC = <K extends keyof ContactDetails>(k: K, v: ContactDetails[K]) =>
    setContact((c) => (c ? { ...c, [k]: v } : c));
  const setF = <K extends keyof FooterText>(k: K, v: FooterText[K]) =>
    setFooter((f) => (f ? { ...f, [k]: v } : f));

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

      {footer && (
        <Card style={styles.card}>
          <ThemedText type="heading">Footer</ThemedText>
          <ThemedText type="caption" themeColor="textSecondary" style={styles.hint}>
            The wording at the bottom of every page. Leave a field empty to keep the
            text the site was built with — empty never blanks anything.
          </ThemedText>

          <Field label="Strapline — Arabic" value={footer.taglineAr}
            onChangeText={(v) => setF('taglineAr', v)} multiline />
          <Field label="Strapline — English" value={footer.taglineEn}
            onChangeText={(v) => setF('taglineEn', v)} multiline />

          <Field label="Club heading — Arabic" value={footer.clubTitleAr}
            onChangeText={(v) => setF('clubTitleAr', v)} />
          <Field label="Club heading — English" value={footer.clubTitleEn}
            onChangeText={(v) => setF('clubTitleEn', v)} />

          <Field label="Club line — Arabic" value={footer.clubTextAr}
            onChangeText={(v) => setF('clubTextAr', v)} multiline />
          <Field label="Club line — English" value={footer.clubTextEn}
            onChangeText={(v) => setF('clubTextEn', v)} multiline />

          <Field label="Rights line — Arabic" value={footer.rightsAr}
            onChangeText={(v) => setF('rightsAr', v)} />
          <Field label="Rights line — English" value={footer.rightsEn}
            onChangeText={(v) => setF('rightsEn', v)} />

          <Field label="Operated by — Arabic" value={footer.managedAr}
            onChangeText={(v) => setF('managedAr', v)} multiline />
          <Field label="Operated by — English" value={footer.managedEn}
            onChangeText={(v) => setF('managedEn', v)} multiline />

          {footerNote && (
            <ThemedText type="label" themeColor="textSecondary" style={styles.note}>
              {footerNote}
            </ThemedText>
          )}
          <Button label="Save footer" onPress={saveFooter} busy={footerBusy} />
        </Card>
      )}

      {theme && (
        <Card style={styles.card}>
          <ThemedText type="heading">Theme</ThemedText>
          <ThemedText type="caption" themeColor="textSecondary" style={styles.hint}>
            The shop&apos;s colours, fonts and corners. Leave a field empty to keep
            what the site was built with — empty never blanks anything, and
            clearing a field is the way back from an edit you did not like.
          </ThemedText>

          <Field label="Brand colour — hex, e.g. #e0561c" value={theme.brand}
            onChangeText={(v) => setT('brand', v)} />
          {/* NOT hex. The stylesheet writes hsl(var(--accent-text)), so these two
              are bare triples; a hex here yields hsl(#e0561c) and no colour.
              The label says so rather than leaving it to be discovered. */}
          <Field label="Accent text on light — HSL triple" value={theme.accentTextLight}
            onChangeText={(v) => setT('accentTextLight', v)} />
          <Field label="Accent text on dark — HSL triple" value={theme.accentTextDark}
            onChangeText={(v) => setT('accentTextDark', v)} />

          <Field label="Heading font — family name" value={theme.fontHead}
            onChangeText={(v) => setT('fontHead', v)} />
          <Field label="Body font — family name" value={theme.fontBody}
            onChangeText={(v) => setT('fontBody', v)} />

          <Field label="Corner radius — up to 2rem" value={theme.radius}
            onChangeText={(v) => setT('radius', v)} />
          {/* The one that can genuinely break the page: every margin and
              padding in the shop is a multiple of it. Capped server-side. */}
          <Field label="Spacing base — up to 0.5rem (built value 0.25rem)" value={theme.space}
            onChangeText={(v) => setT('space', v)} />

          {themeNote && (
            <ThemedText type="label" themeColor="textSecondary" style={styles.note}>
              {themeNote}
            </ThemedText>
          )}
          <Button label="Save theme" onPress={saveTheme} busy={themeBusy} />
        </Card>
      )}

      <Card style={styles.card}>
        <ThemedText type="heading">KNET</ThemedText>
        <ThemedText type="caption" themeColor="textSecondary" style={styles.hint}>
          The Tranportal ID KNET issued for this shop. Only the ID is kept here —
          the password and the resource key stay in the file on the server.
        </ThemedText>

        {/* NOT a Chip. Chip is a control — it requires an onPress and reads as
            something to tap — and this is a statement of fact the owner cannot
            change by tapping it. Giving it a no-op handler to satisfy the type
            would put a dead button on a payment screen. */}
        <ThemedText type="label" themeColor="textSecondary" style={styles.note}>
          {knetSource === 'database'
            ? 'Payments are using the ID below.'
            : 'Payments are using the ID in knet/config.php on the server.'}
        </ThemedText>

        <Field
          label="Tranportal ID — empty means use the file on the server"
          value={knetId}
          onChangeText={setKnetId}
          autoCapitalize="none"
        />

        {knetNote && (
          <ThemedText type="label" themeColor="textSecondary" style={styles.note}>
            {knetNote}
          </ThemedText>
        )}
        <Button label="Save KNET ID" onPress={saveKnet} busy={knetBusy} />
      </Card>
    </AdminShell>
  );
}

const styles = StyleSheet.create({
  card: { marginBottom: Spacing.four, gap: Spacing.two },
  hint: { fontSize: 13, marginBottom: Spacing.two },
  row: { flexDirection: 'row', gap: Spacing.two, marginBottom: Spacing.two },
  note: { fontSize: 13, marginBottom: Spacing.one },
});
