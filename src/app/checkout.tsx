import { Stack, useRouter } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as WebBrowser from 'expo-web-browser';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing, TapTarget } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { placeOrder, type OrderDraft } from '@/lib/api';
import { useCart } from '@/lib/cart';
import { useLang } from '@/lib/i18n';
import { formatPrice } from '@/lib/money';

const GOVERNORATES = [
  { id: 'capital', ar: 'العاصمة', en: 'Capital' },
  { id: 'hawalli', ar: 'حولي', en: 'Hawalli' },
  { id: 'farwaniya', ar: 'الفروانية', en: 'Farwaniya' },
  { id: 'mubarak', ar: 'مبارك الكبير', en: 'Mubarak Al-Kabeer' },
  { id: 'ahmadi', ar: 'الأحمدي', en: 'Ahmadi' },
  { id: 'jahra', ar: 'الجهراء', en: 'Jahra' },
];

type Payment = 'knet' | 'card' | 'cod';

export default function CheckoutScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { t, lang, row, text } = useLang();
  const { lines, productFor, total, clear } = useCart();

  const [form, setForm] = useState({
    name: '',
    phone: '',
    governorate: '',
    area: '',
    block: '',
    street: '',
    house: '',
    notes: '',
  });
  const [payment, setPayment] = useState<Payment>('knet');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);

  const set = (k: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  // Kuwaiti mobile numbers are eight digits. Spaces and a +965 prefix are
  // stripped rather than rejected — people type their number the way they say
  // it, and refusing that is a self-inflicted abandoned basket.
  const phoneDigits = form.phone.replace(/\D/g, '').replace(/^965/, '');
  const phoneOk = phoneDigits.length === 8;

  const missing = (k: keyof typeof form) => touched && !form[k].trim() && k !== 'notes';
  const valid =
    ['name', 'governorate', 'area', 'block', 'street', 'house'].every((k) =>
      form[k as keyof typeof form].trim(),
    ) && phoneOk;

  const submit = async () => {
    setTouched(true);
    setError(null);
    if (!valid || busy) return;

    setBusy(true);
    const draft: OrderDraft = {
      ...form,
      phone: phoneDigits,
      payment,
      total,
      lang,
      lines: lines.map((l) => ({
        slug: l.slug,
        size: l.size,
        qty: l.qty,
        price: productFor(l.slug)?.price ?? 0,
      })),
    };

    try {
      const placed = await placeOrder(draft);
      // KNET and card hand off to a hosted page. It opens in the system
      // browser sheet rather than a WebView: the customer needs to see the
      // real bank URL and padlock, and a WebView hides both.
      if (placed.payUrl) {
        await WebBrowser.openBrowserAsync(placed.payUrl);
      }
      clear();
      router.replace({ pathname: '/order/[ref]', params: { ref: placed.ref } });
    } catch (e) {
      // The basket is NOT cleared here. An order that failed to reach the shop
      // must leave the customer exactly where they were.
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const Field = ({
    label,
    k,
    keyboardType,
    autoComplete,
  }: {
    label: string;
    k: keyof typeof form;
    keyboardType?: 'default' | 'phone-pad' | 'number-pad';
    autoComplete?: 'name' | 'tel' | 'street-address' | 'off';
  }) => (
    <View style={styles.field}>
      <ThemedText type="small" themeColor="textSecondary" style={text}>
        {label}
      </ThemedText>
      <TextInput
        value={form[k]}
        onChangeText={set(k)}
        keyboardType={keyboardType ?? 'default'}
        autoComplete={autoComplete ?? 'off'}
        accessibilityLabel={label}
        placeholderTextColor={theme.textSecondary}
        style={[
          styles.input,
          text,
          {
            color: theme.text,
            backgroundColor: theme.backgroundElement,
            borderColor: missing(k) ? theme.danger : theme.border,
          },
        ]}
      />
      {missing(k) && (
        <ThemedText type="small" themeColor="danger" style={text}>
          {t.checkout.required}
        </ThemedText>
      )}
      {k === 'phone' && touched && form.phone.trim() && !phoneOk && (
        <ThemedText type="small" themeColor="danger" style={text}>
          {t.checkout.badPhone}
        </ThemedText>
      )}
    </View>
  );

  return (
    <SafeAreaView style={styles.safeArea} edges={['bottom']}>
      <Stack.Screen options={{ title: t.checkout.title }} />
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}>
          <View style={styles.content}>
            <ThemedText type="subtitle" style={[styles.title, text]}>
              {t.checkout.title}
            </ThemedText>

            <Field label={t.checkout.name} k="name" autoComplete="name" />
            <Field label={t.checkout.phone} k="phone" keyboardType="phone-pad" autoComplete="tel" />

            <View style={styles.field}>
              <ThemedText type="small" themeColor="textSecondary" style={text}>
                {t.checkout.governorate}
              </ThemedText>
              <View style={[styles.govRow, row]}>
                {GOVERNORATES.map((g) => {
                  const label = lang === 'ar' ? g.ar : g.en;
                  const active = form.governorate === label;
                  return (
                    <Pressable
                      key={g.id}
                      accessibilityRole="button"
                      accessibilityState={{ selected: active }}
                      onPress={() => set('governorate')(label)}
                      style={({ pressed }) => [
                        styles.gov,
                        {
                          borderColor: active ? theme.tint : theme.border,
                          backgroundColor: active ? theme.tintSoft : theme.backgroundElement,
                        },
                        pressed && styles.pressed,
                      ]}>
                      <ThemedText type="small" themeColor={active ? 'tintText' : 'text'}>
                        {label}
                      </ThemedText>
                    </Pressable>
                  );
                })}
              </View>
              {missing('governorate') && (
                <ThemedText type="small" themeColor="danger" style={text}>
                  {t.checkout.required}
                </ThemedText>
              )}
            </View>

            <Field label={t.checkout.area} k="area" autoComplete="street-address" />
            <View style={[styles.threeUp, row]}>
              <View style={styles.third}>
                <Field label={t.checkout.block} k="block" keyboardType="number-pad" />
              </View>
              <View style={styles.third}>
                <Field label={t.checkout.street} k="street" />
              </View>
              <View style={styles.third}>
                <Field label={t.checkout.house} k="house" />
              </View>
            </View>
            <Field label={t.checkout.notes} k="notes" />

            <ThemedText type="smallBold" style={[styles.label, text]}>
              {t.checkout.payment}
            </ThemedText>
            <View style={styles.payList}>
              {(
                [
                  ['knet', t.checkout.knet, '💳'],
                  ['card', t.checkout.card, '🏦'],
                  ['cod', t.checkout.cod, '💵'],
                ] as [Payment, string, string][]
              ).map(([id, label, icon]) => {
                const active = payment === id;
                return (
                  <Pressable
                    key={id}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: active }}
                    onPress={() => setPayment(id)}
                    style={({ pressed }) => [
                      styles.pay,
                      row,
                      {
                        borderColor: active ? theme.tint : theme.border,
                        backgroundColor: active ? theme.tintSoft : theme.backgroundElement,
                      },
                      pressed && styles.pressed,
                    ]}>
                    <Text style={styles.payIcon}>{icon}</Text>
                    <ThemedText type="smallBold" themeColor={active ? 'tintText' : 'text'}>
                      {label}
                    </ThemedText>
                  </Pressable>
                );
              })}
            </View>

            {error && (
              <ThemedText type="small" themeColor="danger" accessibilityLiveRegion="polite" style={text}>
                {error}
              </ThemedText>
            )}
          </View>
        </ScrollView>

        <ThemedView type="background" style={[styles.actionBar, { borderColor: theme.border }]}>
          <View style={styles.content}>
            <View style={[styles.totalRow, row]}>
              <ThemedText type="smallBold">{t.cart.total}</ThemedText>
              <ThemedText type="smallBold">{formatPrice(total, lang)}</ThemedText>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ busy, disabled: busy }}
              disabled={busy}
              onPress={submit}
              style={({ pressed }) => [
                styles.primary,
                row,
                { backgroundColor: theme.tint },
                pressed && styles.pressed,
                busy && styles.busy,
              ]}>
              {/* The spinner sits INSIDE the button. An order takes a
                  round trip to a bank; without it the customer taps again, and
                  a second tap on a payment button is the one thing this screen
                  must never invite. */}
              {busy && <ActivityIndicator color="#ffffff" style={styles.spinner} />}
              <Text style={styles.primaryText}>
                {busy ? t.checkout.working : payment === 'cod' ? t.checkout.place : t.checkout.pay}
              </Text>
            </Pressable>
          </View>
        </ThemedView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  flex: { flex: 1 },
  scroll: { paddingVertical: Spacing.three },
  content: {
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
    paddingHorizontal: Spacing.three,
    gap: Spacing.two,
  },
  title: { fontSize: 26, lineHeight: 34 },
  field: { gap: Spacing.half, flex: 1 },
  input: {
    minHeight: TapTarget,
    borderWidth: 1,
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    fontSize: 16,
  },
  govRow: { flexWrap: 'wrap', gap: Spacing.two },
  gov: {
    minHeight: TapTarget - 8,
    justifyContent: 'center',
    paddingHorizontal: Spacing.three,
    borderWidth: 1,
    borderRadius: 999,
  },
  threeUp: { gap: Spacing.two },
  third: { flex: 1 },
  label: { marginTop: Spacing.three, fontSize: 16 },
  payList: { gap: Spacing.two },
  pay: {
    alignItems: 'center',
    gap: Spacing.three,
    minHeight: TapTarget + 8,
    paddingHorizontal: Spacing.three,
    borderWidth: 1,
    borderRadius: Spacing.three,
  },
  payIcon: { fontSize: 22 },
  actionBar: { borderTopWidth: 1, paddingVertical: Spacing.three },
  totalRow: { justifyContent: 'space-between', alignItems: 'center' },
  primary: {
    marginTop: Spacing.two,
    minHeight: TapTarget,
    borderRadius: Spacing.three,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
  },
  primaryText: { color: '#ffffff', fontSize: 16, fontWeight: '700' },
  spinner: { transform: [{ scale: 0.9 }] },
  busy: { opacity: 0.9 },
  pressed: { opacity: 0.85 },
});
