import { useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { press } from '@/components/ui/press';

import { AdminShell, adminStyles } from '@/components/admin-shell';
import { StatusChip } from '@/components/status-chip';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing, TapTarget } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import {
  adminApi,
  NEXT_STATUS,
  Unauthorized,
  type OrderDetail,
  type OrderStatus,
} from '@/lib/admin';
import { useLang } from '@/lib/i18n';
import { formatPrice } from '@/lib/money';
import { useSession } from '@/lib/session';

export default function OrderScreen() {
  const theme = useTheme();
  const { lang } = useLang();
  const { token, signOut } = useSession();
  const { id } = useLocalSearchParams<{ id: string }>();
  const orderId = Number(id);

  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<OrderStatus | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!token || !Number.isFinite(orderId)) return;
    setLoading(true);
    setError(null);
    adminApi
      .order(token, orderId)
      .then((r) => setOrder(r.order))
      .catch((e) => (e instanceof Unauthorized ? signOut() : setError(String(e))))
      .finally(() => setLoading(false));
  }, [token, orderId, signOut]);

  useEffect(load, [load]);

  const move = async (to: OrderStatus) => {
    if (!token || !order || saving) return;
    setSaving(to);
    setNotice(null);
    try {
      const res = await adminApi.setStatus(token, order.id, to);
      // The SERVER's status is what lands in state, not the one that was
      // requested. If it refuses a transition, or another manager moved the
      // order first, the screen must show what is true rather than what this
      // phone asked for.
      setOrder({ ...order, status: res.status });
    } catch (e) {
      if (e instanceof Unauthorized) signOut();
      else setNotice(String(e));
    } finally {
      setSaving(null);
    }
  };

  return (
    <AdminShell
      title={order ? order.ref : 'Order'}
      loading={loading}
      error={error}
      notice={notice}
      onRetry={load}>
      {order && (
        <>
          <ThemedView
            type="backgroundElement"
            style={[adminStyles.card, { borderColor: theme.border }]}>
            <View style={adminStyles.rowBetween}>
              <ThemedText type="smallBold">{order.name}</ThemedText>
              <StatusChip status={order.status} />
            </View>
            {/* Selectable: the two things a manager copies out of this screen
                are the phone number and the address, usually into WhatsApp. */}
            <ThemedText type="small" themeColor="textSecondary" selectable>
              {order.phone}
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary" selectable>
              {order.governorate}, {order.area}, block {order.block}, street {order.street}, house{' '}
              {order.house}
            </ThemedText>
            {order.notes ? (
              <ThemedText type="small" themeColor="silver">
                “{order.notes}”
              </ThemedText>
            ) : null}
          </ThemedView>

          <ThemedText type="smallBold" style={styles.section}>
            Items
          </ThemedText>
          {order.lines.map((l, i) => (
            <ThemedView
              key={`${l.name}-${l.size}-${i}`}
              type="backgroundElement"
              style={[adminStyles.card, adminStyles.rowBetween, { borderColor: theme.border }]}>
              <ThemedText type="small" style={styles.lineName}>
                {l.qty} × {l.name} · {l.size}
              </ThemedText>
              <ThemedText type="smallBold">{formatPrice(l.price * l.qty, lang)}</ThemedText>
            </ThemedView>
          ))}

          <ThemedView
            type="backgroundElement"
            style={[adminStyles.card, { borderColor: theme.border }]}>
            <View style={adminStyles.rowBetween}>
              <ThemedText type="small" themeColor="textSecondary">
                Subtotal
              </ThemedText>
              <ThemedText type="small">{formatPrice(order.subtotal, lang)}</ThemedText>
            </View>
            <View style={adminStyles.rowBetween}>
              <ThemedText type="small" themeColor="textSecondary">
                Delivery
              </ThemedText>
              <ThemedText type="small">{formatPrice(order.delivery, lang)}</ThemedText>
            </View>
            <View style={adminStyles.rowBetween}>
              <ThemedText type="smallBold">Total</ThemedText>
              <ThemedText type="smallBold">{formatPrice(order.total, lang)}</ThemedText>
            </View>
          </ThemedView>

          <ThemedText type="smallBold" style={styles.section}>
            Move to
          </ThemedText>
          {/* Only the transitions this status allows are offered. The panel
              cannot send an order backwards, because a delivered order that
              becomes "new" again is a reporting bug that outlives the tap. */}
          {NEXT_STATUS[order.status].length === 0 ? (
            <ThemedText type="small" themeColor="textSecondary">
              This order is finished.
            </ThemedText>
          ) : (
            <View style={styles.moves}>
              {NEXT_STATUS[order.status].map((to) => (
                <Pressable
                  key={to}
                  accessibilityRole="button"
                  accessibilityState={{ busy: saving === to, disabled: saving !== null }}
                  disabled={saving !== null}
                  onPress={() => move(to)}
                  style={press(false, styles.move,
                    {
                      backgroundColor: to === 'cancelled' ? theme.backgroundElement : theme.tint,
                      borderColor: to === 'cancelled' ? theme.danger : theme.tint,
                    },
                    saving !== null && saving !== to && styles.dimmed)}>
                  {saving === to && (
                    <ActivityIndicator color={to === 'cancelled' ? theme.danger : '#ffffff'} />
                  )}
                  <Text
                    style={[
                      styles.moveText,
                      to === 'cancelled' && { color: theme.danger },
                    ]}>
                    {to}
                  </Text>
                </Pressable>
              ))}
            </View>
          )}
        </>
      )}
    </AdminShell>
  );
}

const styles = StyleSheet.create({
  section: { marginTop: Spacing.four, fontSize: 16 },
  lineName: { flex: 1 },
  moves: { gap: Spacing.two },
  move: {
    minHeight: TapTarget,
    borderWidth: 1,
    borderRadius: Spacing.three,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
  },
  moveText: { color: '#ffffff', fontSize: 16, fontWeight: '700' },
  dimmed: { opacity: 0.4 },
});
