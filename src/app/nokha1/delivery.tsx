import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import {
  cleanNum,
  Courier,
  loadCouriers,
  loadOrders,
  nextOrderId,
  Order,
  ORDER_STATUSES,
  orderStats,
  saveCouriers,
  saveOrders,
  STATUS_CANCELLED,
  STATUS_DELIVERED,
} from '@/lib/nokha1';

const STATUS_COLORS = ['#c98a2e', '#4a7fd0', '#2f8f86', '#3fa66d', '#d05b62'];

export default function DeliveryScreen() {
  const theme = useTheme();
  const [orders, setOrders] = useState<Order[]>([]);
  const [couriers, setCouriers] = useState<Courier[]>([]);
  const [filter, setFilter] = useState(-1);
  const [customer, setCustomer] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [items, setItems] = useState('');
  const [amount, setAmount] = useState('');
  const [courier, setCourier] = useState('');
  const [courierName, setCourierName] = useState('');
  const [courierPhone, setCourierPhone] = useState('');

  useEffect(() => {
    loadOrders().then(setOrders);
    loadCouriers().then(setCouriers);
  }, []);

  const persistOrders = useCallback((next: Order[]) => {
    setOrders(next);
    saveOrders(next);
  }, []);

  const persistCouriers = useCallback((next: Courier[]) => {
    setCouriers(next);
    saveCouriers(next);
  }, []);

  const stats = orderStats(orders);
  const shown = filter < 0 ? orders : orders.filter((o) => o.status === filter);

  const addOrder = () => {
    if (!customer.trim() || !phone.trim() || !address.trim() || !items.trim()) {
      Alert.alert('بيانات ناقصة', 'أكمل اسم العميل والهاتف والعنوان والطلب.');
      return;
    }
    const order: Order = {
      id: nextOrderId(orders),
      customer: customer.trim().slice(0, 80),
      phone: phone.replace(/[^0-9+ ]/g, '').slice(0, 15),
      address: address.trim().slice(0, 160),
      items: items.trim().slice(0, 160),
      amount: cleanNum(amount, 1e6),
      courier,
      status: 0,
      createdAt: new Date().toISOString(),
    };
    persistOrders([...orders, order]);
    setCustomer('');
    setPhone('');
    setAddress('');
    setItems('');
    setAmount('');
    setCourier('');
  };

  const advance = (id: string) =>
    persistOrders(
      orders.map((o) =>
        o.id === id && o.status < STATUS_DELIVERED ? { ...o, status: o.status + 1 } : o,
      ),
    );

  const cancel = (id: string) =>
    Alert.alert('إلغاء ' + id, 'إلغاء هذا الطلب؟', [
      { text: 'رجوع', style: 'cancel' },
      {
        text: 'إلغاء الطلب',
        style: 'destructive',
        onPress: () =>
          persistOrders(orders.map((o) => (o.id === id ? { ...o, status: STATUS_CANCELLED } : o))),
      },
    ]);

  const addCourier = () => {
    if (!courierName.trim() || !courierPhone.trim()) return;
    persistCouriers([
      ...couriers,
      {
        name: courierName.trim().slice(0, 80),
        phone: courierPhone.replace(/[^0-9+ ]/g, '').slice(0, 15),
      },
    ]);
    setCourierName('');
    setCourierPhone('');
  };

  const inputStyle = [
    styles.input,
    { borderColor: theme.border, color: theme.text, backgroundColor: theme.backgroundElement },
  ];

  return (
    <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
      <View style={styles.content}>
        {/* Stats */}
        <View style={styles.statRow}>
          <Stat label="الطلبات" value={String(stats.total)} />
          <Stat label="قيد التنفيذ" value={String(stats.active)} />
          <Stat label="تم التسليم" value={String(stats.delivered)} />
          <Stat label="الإيراد (د.ك)" value={stats.revenue.toFixed(3)} />
        </View>

        {/* New order */}
        <ThemedText type="smallBold" style={styles.sectionTitle}>
          طلب جديد
        </ThemedText>
        <View style={styles.form}>
          <View style={styles.formRow}>
            <TextInput
              style={[...inputStyle, styles.flex1]}
              value={customer}
              onChangeText={setCustomer}
              placeholder="اسم العميل"
              placeholderTextColor={theme.textSecondary}
              maxLength={80}
            />
            <TextInput
              style={[...inputStyle, styles.flex1]}
              value={phone}
              onChangeText={setPhone}
              placeholder="الهاتف"
              placeholderTextColor={theme.textSecondary}
              keyboardType="phone-pad"
              maxLength={15}
            />
          </View>
          <TextInput
            style={inputStyle}
            value={address}
            onChangeText={setAddress}
            placeholder="العنوان"
            placeholderTextColor={theme.textSecondary}
            maxLength={160}
          />
          <View style={styles.formRow}>
            <TextInput
              style={[...inputStyle, styles.flex2]}
              value={items}
              onChangeText={setItems}
              placeholder="الطلب (مجبوس دجاج ×٢)"
              placeholderTextColor={theme.textSecondary}
              maxLength={160}
            />
            <TextInput
              style={[...inputStyle, styles.flex1]}
              value={amount}
              onChangeText={setAmount}
              placeholder="المبلغ د.ك"
              placeholderTextColor={theme.textSecondary}
              keyboardType="decimal-pad"
            />
          </View>
          {couriers.length > 0 && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
              {couriers.map((c) => (
                <Pressable
                  key={c.name + c.phone}
                  onPress={() => setCourier(courier === c.name ? '' : c.name)}
                  style={({ pressed }) => pressed && styles.pressed}>
                  <ThemedView
                    type={courier === c.name ? 'backgroundSelected' : 'backgroundElement'}
                    style={[
                      styles.chip,
                      { borderColor: courier === c.name ? theme.tint : theme.border },
                    ]}>
                    <ThemedText
                      type="small"
                      themeColor={courier === c.name ? 'tint' : 'textSecondary'}>
                      🛵 {c.name}
                    </ThemedText>
                  </ThemedView>
                </Pressable>
              ))}
            </ScrollView>
          )}
          <Pressable
            onPress={addOrder}
            style={({ pressed }) => [
              styles.button,
              { backgroundColor: theme.tint },
              pressed && styles.pressed,
            ]}>
            <ThemedText type="smallBold" style={styles.buttonText}>
              إضافة الطلب
            </ThemedText>
          </Pressable>
        </View>

        {/* Couriers */}
        <ThemedText type="smallBold" style={styles.sectionTitle}>
          المناديب ({couriers.length})
        </ThemedText>
        <View style={[styles.formRow, styles.form]}>
          <TextInput
            style={[...inputStyle, styles.flex1]}
            value={courierName}
            onChangeText={setCourierName}
            placeholder="اسم المندوب"
            placeholderTextColor={theme.textSecondary}
            maxLength={80}
          />
          <TextInput
            style={[...inputStyle, styles.flex1]}
            value={courierPhone}
            onChangeText={setCourierPhone}
            placeholder="الهاتف"
            placeholderTextColor={theme.textSecondary}
            keyboardType="phone-pad"
            maxLength={15}
          />
          <Pressable
            onPress={addCourier}
            style={({ pressed }) => [
              styles.smallButton,
              { borderColor: theme.border, backgroundColor: theme.backgroundElement },
              pressed && styles.pressed,
            ]}>
            <ThemedText type="small">إضافة</ThemedText>
          </Pressable>
        </View>

        {/* Filters */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
          {[-1, ...ORDER_STATUSES.map((_, i) => i)].map((i) => (
            <Pressable
              key={i}
              onPress={() => setFilter(i)}
              style={({ pressed }) => pressed && styles.pressed}>
              <ThemedView
                type={filter === i ? 'backgroundSelected' : 'backgroundElement'}
                style={[styles.chip, { borderColor: filter === i ? theme.tint : theme.border }]}>
                <ThemedText type="small" themeColor={filter === i ? 'tint' : 'textSecondary'}>
                  {i < 0 ? 'الكل' : ORDER_STATUSES[i]}
                </ThemedText>
              </ThemedView>
            </Pressable>
          ))}
        </ScrollView>

        {/* Orders */}
        {shown.length === 0 ? (
          <ThemedText type="small" themeColor="textSecondary" style={styles.empty}>
            لا توجد طلبات هنا.
          </ThemedText>
        ) : (
          <View style={styles.list}>
            {[...shown].reverse().map((o) => (
              <ThemedView
                key={o.id}
                type="backgroundElement"
                style={[styles.orderCard, { borderColor: theme.border }]}>
                <View style={styles.orderTop}>
                  <ThemedText type="smallBold">
                    {o.customer}{' '}
                    <ThemedText type="small" themeColor="textSecondary">
                      {o.id}
                    </ThemedText>
                  </ThemedText>
                  <ThemedText type="smallBold" style={{ color: STATUS_COLORS[o.status] }}>
                    {ORDER_STATUSES[o.status]}
                  </ThemedText>
                </View>
                <ThemedText type="small" themeColor="textSecondary">
                  📞 {o.phone} · 📍 {o.address}
                </ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  🍽 {o.items}
                  {o.courier ? ` · 🛵 ${o.courier}` : ''} · {o.amount.toFixed(3)} د.ك
                </ThemedText>
                {o.status < STATUS_DELIVERED && (
                  <View style={styles.orderActions}>
                    <Pressable
                      onPress={() => advance(o.id)}
                      style={({ pressed }) => [
                        styles.advanceButton,
                        { backgroundColor: theme.tint },
                        pressed && styles.pressed,
                      ]}>
                      <ThemedText type="small" style={styles.buttonText}>
                        ← {ORDER_STATUSES[o.status + 1]}
                      </ThemedText>
                    </Pressable>
                    <Pressable onPress={() => cancel(o.id)} hitSlop={8}>
                      <ThemedText type="small" style={{ color: '#d05b62' }}>
                        إلغاء
                      </ThemedText>
                    </Pressable>
                  </View>
                )}
              </ThemedView>
            ))}
          </View>
        )}
      </View>
    </ScrollView>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  const theme = useTheme();
  return (
    <ThemedView type="backgroundElement" style={[styles.stat, { borderColor: theme.border }]}>
      <ThemedText type="smallBold">{value}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
        {label}
      </ThemedText>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  scrollContent: {
    alignItems: 'center',
    paddingBottom: Spacing.six,
  },
  content: {
    width: '100%',
    maxWidth: MaxContentWidth,
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.three,
  },
  statRow: {
    flexDirection: 'row',
    gap: Spacing.two,
    marginBottom: Spacing.four,
  },
  stat: {
    flex: 1,
    borderRadius: Spacing.three,
    borderWidth: 1,
    padding: Spacing.two,
    gap: Spacing.half,
    alignItems: 'center',
  },
  sectionTitle: {
    fontSize: 16,
    marginBottom: Spacing.two,
  },
  form: {
    gap: Spacing.two,
    marginBottom: Spacing.four,
  },
  formRow: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  flex1: {
    flex: 1,
  },
  flex2: {
    flex: 2,
  },
  input: {
    borderWidth: 1,
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two + 2,
    fontSize: 14,
    textAlign: 'right',
  },
  chipRow: {
    gap: Spacing.two,
    paddingBottom: Spacing.two,
  },
  chip: {
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one,
  },
  button: {
    borderRadius: Spacing.two,
    paddingVertical: Spacing.three,
    alignItems: 'center',
  },
  smallButton: {
    borderRadius: Spacing.two,
    borderWidth: 1,
    paddingHorizontal: Spacing.three,
    justifyContent: 'center',
  },
  buttonText: {
    color: '#ffffff',
  },
  pressed: {
    opacity: 0.8,
  },
  empty: {
    textAlign: 'center',
    paddingVertical: Spacing.four,
  },
  list: {
    gap: Spacing.two,
  },
  orderCard: {
    borderRadius: Spacing.three,
    borderWidth: 1,
    padding: Spacing.three,
    gap: Spacing.one,
  },
  orderTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  orderActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    marginTop: Spacing.one,
  },
  advanceButton: {
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one + 2,
  },
});
