import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { press } from '@/components/ui/press';

import { AdminShell, adminStyles } from '@/components/admin-shell';
import { StatusChip } from '@/components/status-chip';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing, TapTarget } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { adminApi, Unauthorized, type OrderStatus, type OrderSummary } from '@/lib/admin';
import { useLang } from '@/lib/i18n';
import { formatPrice } from '@/lib/money';
import { useSession } from '@/lib/session';

const FILTERS: (OrderStatus | 'all')[] = [
  'all',
  'new',
  'paid',
  'packing',
  'shipped',
  'delivered',
  'cancelled',
];

export default function OrdersScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { lang } = useLang();
  const { token, signOut } = useSession();
  const [filter, setFilter] = useState<OrderStatus | 'all'>('all');
  const [orders, setOrders] = useState<OrderSummary[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!token) return;
    setLoading(true);
    setError(null);
    adminApi
      .orders(token, filter)
      .then((r) => setOrders(r.orders))
      .catch((e) => (e instanceof Unauthorized ? signOut() : setError(String(e))))
      .finally(() => setLoading(false));
  }, [token, filter, signOut]);

  useEffect(load, [load]);

  return (
    <AdminShell title="Orders" loading={loading} error={error} onRetry={load}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.filters}>
        {FILTERS.map((f) => {
          const active = filter === f;
          return (
            <Pressable
              key={f}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              onPress={() => setFilter(f)}
              style={press()}>
              <ThemedView
                type={active ? 'backgroundSelected' : 'backgroundElement'}
                style={[styles.filter, { borderColor: active ? theme.tint : theme.border }]}>
                <ThemedText type="label" themeColor={active ? 'tintText' : 'textSecondary'}>
                  {f}
                </ThemedText>
              </ThemedView>
            </Pressable>
          );
        })}
      </ScrollView>

      {orders && orders.length === 0 ? (
        <ThemedText type="label" themeColor="textSecondary" style={styles.empty}>
          No orders with that status.
        </ThemedText>
      ) : (
        orders?.map((o) => (
          // CARDS, NOT A TABLE. Seven columns of order data on a 390px screen
          // is a horizontal scrollbar, and a manager checking an order on their
          // phone should not have to drag a table sideways to find the total.
          <Pressable
            key={o.id}
            accessibilityRole="link"
            accessibilityLabel={`Order ${o.ref}`}
            onPress={() => router.push({ pathname: '/backends/order/[id]', params: { id: o.id } })}
            style={press()}>
            <ThemedView
              type="backgroundElement"
              style={[adminStyles.card, adminStyles.lift]}>
              <View style={adminStyles.rowBetween}>
                <ThemedText type="labelBold">{o.ref}</ThemedText>
                <StatusChip status={o.status} />
              </View>
              <View style={adminStyles.rowBetween}>
                <ThemedText type="label" themeColor="textSecondary">
                  {o.name} · {o.phone}
                </ThemedText>
                <ThemedText type="labelBold">{formatPrice(o.total, lang)}</ThemedText>
              </View>
              <View style={adminStyles.rowBetween}>
                <ThemedText type="label" themeColor="textSecondary">
                  {o.payment.toUpperCase()}
                </ThemedText>
                <ThemedText type="label" themeColor="textSecondary">
                  {o.createdAt}
                </ThemedText>
              </View>
            </ThemedView>
          </Pressable>
        ))
      )}
    </AdminShell>
  );
}

const styles = StyleSheet.create({
  filters: { gap: Spacing.two, paddingVertical: Spacing.two, flexDirection: 'row' },
  filter: {
    minHeight: TapTarget - 12,
    justifyContent: 'center',
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: Spacing.three,
  },
  empty: { paddingVertical: Spacing.five, textAlign: 'center' },
});
