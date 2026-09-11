import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Button } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { Field } from '@/components/ui/field';
import { press } from '@/components/ui/press';
import { Screen } from '@/components/ui/screen';
import { Elevation, Radius, Spacing, TapTarget } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import {
  fetchReturnable,
  requestReturn,
  type ReturnableLine,
  type ReturnableOrder,
} from '@/lib/api';
import { useLang } from '@/lib/i18n';
import { formatNumber, formatPrice } from '@/lib/money';

/**
 * Exchange or return, from the customer's own order.
 *
 * The website had this and the app did not — a customer who bought in the app
 * had to open a browser to send something back. It drives the SAME two routes
 * the website's /returns/request page drives, so the rules are the shop's and
 * are stated once: fourteen days from delivery, a line cannot be sent back
 * twice, women's clothing can be returned but not exchanged.
 *
 * NONE OF THOSE ARE ENFORCED HERE. They are the server's, and this screen only
 * draws them — the greying and the day count are courtesies so the customer
 * finds out before they fill the form in, not the check itself.
 *
 * The sizes come from what the shop sells, not from what is in stock: asking
 * for a size that has run out is a conversation the shop has with the
 * customer, and refusing it on this screen would be the app deciding something
 * the warehouse is better placed to decide.
 */
const SIZES = ['S', 'M', 'L', 'XL', '2XL', '3XL', '4XL', '5XL'] as const;

type Chosen = { qty: number; wantSize: string | null };

export default function ExchangeScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { t, lang, row, text } = useLang();
  /** /exchange?ref=SP… — the Order screen sends the customer here with their
   *  number already known, so they only have to prove the phone. */
  const { ref: fromOrder } = useLocalSearchParams<{ ref?: string }>();

  const [ref, setRef] = useState(String(fromOrder ?? ''));
  const [phone, setPhone] = useState('');
  const [order, setOrder] = useState<ReturnableOrder | null>(null);
  const [kind, setKind] = useState<'exchange' | 'return'>('exchange');
  const [chosen, setChosen] = useState<Record<number, Chosen>>({});
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [made, setMade] = useState<{ ref: string; items: number } | null>(null);

  /** The server's token, said in the customer's language. A JSON error code
   *  shown to a shopper is a shopper who telephones — and an unknown code
   *  falls back to something vague rather than pretending to explain it. */
  const say = (e: unknown) => {
    const code = e instanceof Error ? e.message : '';
    const known = t.exchange.errors as Record<string, string>;
    return known[code] ?? known.failed;
  };

  const phoneDigits = phone.replace(/\D/g, '').replace(/^965/, '');

  const find = async () => {
    if (busy) return;
    setError(null);
    if (!ref.trim()) return setError(t.exchange.errors.return_not_found);
    if (phoneDigits.length !== 8) return setError(t.exchange.errors.invalid_phone);
    setBusy(true);
    try {
      const found = await fetchReturnable(ref.trim().toUpperCase(), phoneDigits);
      setOrder(found);
      setChosen({});
    } catch (e) {
      setError(say(e));
    } finally {
      setBusy(false);
    }
  };

  const send = async () => {
    if (busy || !order) return;
    const lines = Object.entries(chosen).map(([id, c]) => ({
      id: Number(id),
      qty: c.qty,
      wantSize: kind === 'exchange' ? c.wantSize : null,
    }));
    if (!lines.length) return setError(t.exchange.pickOne);
    setError(null);
    setBusy(true);
    try {
      setMade(
        await requestReturn({
          ref: order.ref,
          phone: phoneDigits,
          kind,
          lang,
          reason: reason.trim() || undefined,
          lines,
        }),
      );
    } catch (e) {
      setError(say(e));
    } finally {
      setBusy(false);
    }
  };

  const restart = () => {
    setMade(null);
    setOrder(null);
    setChosen({});
    setReason('');
    setError(null);
  };

  /** A line is unavailable for two different reasons and the customer is told
   *  which. Only one of them changes with the return/exchange choice. */
  const barred = (l: ReturnableLine) => kind === 'exchange' && l.noExchange;
  const spent = (l: ReturnableLine) => l.available < 1;

  const toggle = (l: ReturnableLine) => {
    setError(null);
    setChosen((c) => {
      const next = { ...c };
      if (next[l.id]) delete next[l.id];
      else next[l.id] = { qty: 1, wantSize: null };
      return next;
    });
  };

  // ------------------------------------------------------------------ done
  if (made) {
    return (
      <Screen edges={['bottom']}>
        <Stack.Screen options={{ title: t.exchange.title }} />
        <ThemedText type="heading" style={text}>{t.exchange.done}</ThemedText>
        <ThemedView type="backgroundElement" style={[styles.refBox, Elevation.card]}>
          <ThemedText type="label" themeColor="textSecondary" style={styles.centre}>
            {t.exchange.doneRef}
          </ThemedText>
          {/* Selectable: it is the one thing here the customer may need to
              paste into a message. */}
          <ThemedText type="labelBold" selectable style={styles.ref}>
            {made.ref}
          </ThemedText>
        </ThemedView>
        <ThemedText type="label" themeColor="textSecondary" style={text}>
          {t.exchange.doneNote}
        </ThemedText>
        <Button label={t.exchange.another} variant="secondary" onPress={restart} />
        <Button label={t.order.home} onPress={() => router.replace('/')} />
      </Screen>
    );
  }

  // ---------------------------------------------------------------- lookup
  if (!order) {
    return (
      <Screen edges={['bottom']}>
        <Stack.Screen options={{ title: t.exchange.title }} />
        <ThemedText type="label" themeColor="textSecondary" style={text}>
          {t.exchange.lede}
        </ThemedText>
        {/* Field carries flex: 1, so in a column it grows into its siblings —
            each one gets a plain wrapper rather than the shared component
            being changed for this screen. */}
        <View>
          <Field
            label={t.exchange.ref}
            value={ref}
            onChangeText={setRef}
            autoCapitalize="none"
            autoComplete="off"
          />
        </View>
        <View>
          <Field
            label={t.exchange.phone}
            value={phone}
            onChangeText={setPhone}
            keyboardType="phone-pad"
            autoComplete="tel"
            textContentType="telephoneNumber"
            onSubmitEditing={find}
          />
        </View>
        <ThemedText type="caption" themeColor="textSecondary" style={text}>
          {t.exchange.hint}
        </ThemedText>
        {error ? (
          <ThemedText type="label" themeColor="danger" style={text} accessibilityLiveRegion="polite">
            {error}
          </ThemedText>
        ) : null}
        <Button label={busy ? t.exchange.finding : t.exchange.find} onPress={find} busy={busy} />
      </Screen>
    );
  }

  // ------------------------------------------------------------------ pick
  return (
    <Screen edges={['bottom']}>
      <Stack.Screen options={{ title: t.exchange.title }} />

      <ThemedText type="label" themeColor="textSecondary" style={text}>
        {order.open
          // formatNumber, not String(): in Arabic the shop renders ٠١٢٣, and a
          // Latin '12' beside prices in Arabic-Indic reads as a different app.
          ? t.exchange.daysLeft.replace('{n}', formatNumber(order.daysLeft, lang))
          : t.exchange.closed}
        {order.existing.length
          ? ' ' + t.exchange.already.replace('{refs}', order.existing.map((e) => e.ref).join(', '))
          : ''}
      </ThemedText>

      <View style={[styles.kinds, row]}>
        <Chip label={t.exchange.kindExchange} active={kind === 'exchange'} role="radio"
          onPress={() => { setKind('exchange'); setChosen({}); setError(null); }} />
        <Chip label={t.exchange.kindReturn} active={kind === 'return'} role="radio"
          onPress={() => { setKind('return'); setChosen({}); setError(null); }} />
      </View>

      <ThemedText type="labelBold" style={text}>{t.exchange.pick}</ThemedText>

      {order.lines.map((l) => {
        const off = spent(l) || barred(l);
        const picked = !!chosen[l.id];
        return (
          <ThemedView
            key={l.id}
            type="backgroundElement"
            style={[styles.line, Elevation.card, off && styles.off]}>
            <Pressable
              accessibilityRole="checkbox"
              accessibilityState={{ checked: picked, disabled: off }}
              accessibilityLabel={lang === 'ar' ? l.nameAr : l.nameEn}
              disabled={off}
              onPress={() => toggle(l)}
              style={press(!off, styles.lineHit)}>
              <View style={[styles.lineRow, row]}>
                <ThemedText type="labelBold" themeColor={picked ? 'tintText' : 'text'}>
                  {picked ? '☑' : off ? '☒' : '☐'}
                </ThemedText>
                <View style={styles.lineBody}>
                  <ThemedText type="labelBold" style={text}>
                    {lang === 'ar' ? l.nameAr : l.nameEn}
                  </ThemedText>
                  <ThemedText type="caption" themeColor="textSecondary" style={text}>
                    {[l.size, `×${formatNumber(l.qty, lang)}`, formatPrice(l.price, lang)]
                      .filter(Boolean)
                      .join(' · ')}
                  </ThemedText>
                  {off ? (
                    <ThemedText type="caption" themeColor="danger" style={text}>
                      {barred(l) ? t.exchange.noExchange : t.exchange.spent}
                    </ThemedText>
                  ) : null}
                </View>
              </View>
            </Pressable>

            {/* The size wanted instead. Only on an exchange, and only once the
                line is actually chosen — a row of size pills under every item
                on the order is a wall of controls that do nothing. */}
            {picked && kind === 'exchange' ? (
              <View style={styles.sizes}>
                <ThemedText type="caption" themeColor="textSecondary" style={text}>
                  {t.exchange.wantSize}
                </ThemedText>
                <View style={[styles.sizeRow, row]}>
                  <Chip
                    label={t.exchange.sameSize}
                    active={chosen[l.id].wantSize === null}
                    role="radio"
                    onPress={() =>
                      setChosen((c) => ({ ...c, [l.id]: { ...c[l.id], wantSize: null } }))
                    }
                  />
                  {SIZES.filter((s) => s !== l.size).map((s) => (
                    <Chip
                      key={s}
                      label={s}
                      active={chosen[l.id].wantSize === s}
                      role="radio"
                      onPress={() =>
                        setChosen((c) => ({ ...c, [l.id]: { ...c[l.id], wantSize: s } }))
                      }
                    />
                  ))}
                </View>
              </View>
            ) : null}
          </ThemedView>
        );
      })}

      <View>
        <Field label={t.exchange.reason} value={reason} onChangeText={setReason} />
      </View>

      {error ? (
        <ThemedText type="label" themeColor="danger" style={text} accessibilityLiveRegion="polite">
          {error}
        </ThemedText>
      ) : null}

      {/* The window is the server's decision, but a form that cannot succeed
          should not be offered. */}
      <Button
        label={busy ? t.exchange.sending : t.exchange.send}
        onPress={send}
        busy={busy}
        disabled={!order.open}
      />
      <Button label={t.exchange.another} variant="secondary" onPress={restart} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  centre: { textAlign: 'center' },
  kinds: { gap: Spacing.two },
  line: { borderRadius: Radius.card, padding: Spacing.three, gap: Spacing.two },
  off: { opacity: 0.55 },
  lineHit: { minHeight: TapTarget, justifyContent: 'center' },
  lineRow: { alignItems: 'flex-start', gap: Spacing.three },
  lineBody: { flex: 1, gap: Spacing.half },
  sizes: { gap: Spacing.one },
  sizeRow: { flexWrap: 'wrap', gap: Spacing.two },
  refBox: {
    alignItems: 'center',
    gap: Spacing.half,
    borderRadius: Radius.card,
    padding: Spacing.four,
  },
  ref: { fontSize: 20, letterSpacing: 1 },
});
