import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { StyleSheet } from 'react-native';
import * as WebBrowser from 'expo-web-browser';


import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { CentredMessage } from '@/components/ui/centred-message';
import { Screen } from '@/components/ui/screen';
import { ThemedView } from '@/components/themed-view';
import { Elevation, Radius, Spacing } from '@/constants/theme';
import { useHydrated } from '@/hooks/use-hydrated';
import { fetchOrderStatus, type OrderStatus } from '@/lib/api';
import { useLang } from '@/lib/i18n';

export default function OrderScreen() {
  const router = useRouter();
  const { t } = useLang();
  // `pay` is the method and `payUrl` the bank's page for THIS order, both
  // handed over by the checkout. The URL is carried rather than rebuilt: the
  // shop decides what a payment link looks like, and a second copy of that
  // rule in the app is a second copy to get wrong.
  const { ref, pay, payUrl } = useLocalSearchParams<{
    ref: string;
    pay?: string;
    payUrl?: string;
  }>();
  const hydrated = useHydrated();

  // Cash on delivery is settled at the door; there is nothing to confirm and
  // no bank to wait for. Only a card or KNET order asks the shop what
  // happened, and only that order can show "not confirmed yet".
  const banked = pay === 'knet' || pay === 'tpay';
  const [status, setStatus] = useState<OrderStatus | null>(null);
  const [asking, setAsking] = useState(banked);

  // ASK THE SHOP, NOT THE CUSTOMER'S RETURN. The browser sheet closes the same
  // way whether they paid, cancelled, or gave up, so the fact that they are
  // back here says nothing at all. CBK calls the shop's callback out of band
  // and that is the only account of the payment worth trusting.
  //
  // A few tries a couple of seconds apart, not a spinner that never ends: the
  // callback is usually in before the customer is, occasionally a moment
  // behind, and if it is much later than that the honest thing is to say so
  // rather than hold a screen hostage waiting for it.
  const check = useCallback(async () => {
    if (!banked || !ref) return;
    setAsking(true);
    for (let attempt = 0; attempt < 5; attempt++) {
      const s = await fetchOrderStatus(String(ref));
      if (s) {
        setStatus(s);
        if (s.paid) break;
      }
      if (attempt < 4) await new Promise((r) => setTimeout(r, 2000));
    }
    setAsking(false);
  }, [banked, ref]);

  useEffect(() => {
    void check();
  }, [check]);

  // The order number is in the URL, so the prerendered HTML has none and the
  // client has one — see hooks/use-hydrated.
  if (!hydrated) {
    return <Screen edges={['bottom']} scroll={false}>{null}</Screen>;
  }

  return (
    // The tick is the PAYMENT's, on an order that had one to make. Showing it
    // while the bank has not answered is telling somebody their money arrived
    // on no evidence whatsoever.
    <CentredMessage
      edges={['bottom']}
      glyph={banked && !status?.paid ? '⏳' : '✅'}
      title={t.order.thanks}
      text={
        banked && !status?.paid
          ? asking
            ? t.checkout.working
            : t.order.pendingText
          : t.order.willCall
      }>
      <Stack.Screen options={{ title: t.order.title }} />
      {banked ? (
        <ThemedText
          type="labelBold"
          themeColor={status?.paid ? 'success' : 'textSecondary'}
          style={styles.centre}
          accessibilityLiveRegion="polite">
          {status?.paid ? t.order.paid : asking ? '' : t.order.pending}
        </ThemedText>
      ) : null}

      <ThemedView type="backgroundElement" style={[styles.refBox, Elevation.card]}>
        <ThemedText type="label" themeColor="textSecondary">
          {t.order.ref}
        </ThemedText>
        {/* The reference is selectable: it is the one thing on this screen
              the customer may need to paste into WhatsApp. */}
        <ThemedText type="labelBold" selectable style={styles.ref}>
          {String(ref)}
        </ThemedText>
      </ThemedView>

      {/* A second chance at the bank, on the same order. The track id is the
          idempotency key, so this reopens the SAME payment rather than
          creating another order — which is exactly why the retry belongs
          here and not back on the checkout screen. */}
      {banked && !asking && !status?.paid && payUrl ? (
        <Button
          label={t.order.retry}
          onPress={async () => {
            await WebBrowser.openBrowserAsync(payUrl);
            void check();
          }}
          style={styles.primary}
        />
      ) : null}

      <Button
        label={t.order.home}
        variant={banked && !status?.paid ? 'secondary' : 'primary'}
        onPress={() => router.replace('/')}
        style={styles.primary}
      />
    </CentredMessage>
  );
}

const styles = StyleSheet.create({
  centre: { textAlign: 'center' },
  refBox: {
    alignItems: 'center',
    gap: Spacing.half,
    borderRadius: Radius.card,
    // 24, like every other block. It was 16 by 32 — a box a third wider in
    // its padding than anything else on any screen, next to a button that
    // stretched past both of its edges.
    padding: Spacing.four,
  },
  ref: { fontSize: 20, letterSpacing: 1 },
  primary: { alignSelf: 'stretch' },
});
