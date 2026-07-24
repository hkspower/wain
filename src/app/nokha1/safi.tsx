import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, Share, StyleSheet, TextInput, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import {
  cleanNum,
  cleanTicker,
  Holding,
  holdingsCsv,
  holdingValue,
  loadHoldings,
  saveHoldings,
} from '@/lib/nokha1';

const fmt = (n: number) =>
  n.toLocaleString('en-US', { minimumFractionDigits: 3, maximumFractionDigits: 3 });

export default function SafiScreen() {
  const theme = useTheme();
  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [ticker, setTicker] = useState('');
  const [name, setName] = useState('');
  const [qty, setQty] = useState('');
  const [cost, setCost] = useState('');
  const [price, setPrice] = useState('');

  useEffect(() => {
    loadHoldings().then(setHoldings);
  }, []);

  const persist = useCallback((next: Holding[]) => {
    setHoldings(next);
    saveHoldings(next);
  }, []);

  const totals = holdings.reduce(
    (acc, h) => {
      const { cost: c, value: v } = holdingValue(h);
      return { cost: acc.cost + c, value: acc.value + v };
    },
    { cost: 0, value: 0 },
  );
  const totalPl = totals.value - totals.cost;

  const submit = () => {
    const t = cleanTicker(ticker);
    if (!t) {
      Alert.alert('رمز غير صالح', 'رمز السهم: أحرف إنجليزية وأرقام فقط.');
      return;
    }
    const entry: Holding = {
      ticker: t,
      name: name.trim().slice(0, 80),
      qty: Math.floor(cleanNum(qty, 1e9)),
      cost: cleanNum(cost, 1e7),
      price: cleanNum(price, 1e7),
    };
    if (entry.qty < 1) {
      Alert.alert('كمية غير صالحة', 'الكمية يجب أن تكون ١ على الأقل.');
      return;
    }
    const existing = holdings.findIndex((h) => h.ticker === t);
    const next = [...holdings];
    if (existing >= 0) next[existing] = entry;
    else next.push(entry);
    persist(next);
    setTicker('');
    setName('');
    setQty('');
    setCost('');
    setPrice('');
  };

  const remove = (t: string) => {
    Alert.alert('حذف ' + t, 'إزالة هذا السهم من المحفظة؟', [
      { text: 'إلغاء', style: 'cancel' },
      {
        text: 'حذف',
        style: 'destructive',
        onPress: () => persist(holdings.filter((h) => h.ticker !== t)),
      },
    ]);
  };

  const exportCsv = () => Share.share({ message: holdingsCsv(holdings), title: 'safi-statement.csv' });

  const inputStyle = [
    styles.input,
    { borderColor: theme.border, color: theme.text, backgroundColor: theme.backgroundElement },
  ];

  return (
    <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
      <View style={styles.content}>
        {/* Totals */}
        <View style={styles.statRow}>
          <Stat label="التكلفة (د.ك)" value={fmt(totals.cost)} />
          <Stat label="القيمة (د.ك)" value={fmt(totals.value)} />
          <Stat
            label="ربح/خسارة (د.ك)"
            value={fmt(totalPl)}
            color={totalPl > 0 ? '#3fa66d' : totalPl < 0 ? '#d05b62' : undefined}
          />
        </View>

        {/* Form */}
        <ThemedText type="smallBold" style={styles.sectionTitle}>
          إضافة / تحديث سهم
        </ThemedText>
        <View style={styles.form}>
          <TextInput
            style={inputStyle}
            value={ticker}
            onChangeText={setTicker}
            placeholder="الرمز (NBK)"
            placeholderTextColor={theme.textSecondary}
            autoCapitalize="characters"
            maxLength={12}
          />
          <TextInput
            style={inputStyle}
            value={name}
            onChangeText={setName}
            placeholder="اسم الشركة"
            placeholderTextColor={theme.textSecondary}
            maxLength={80}
          />
          <View style={styles.formRow}>
            <TextInput
              style={[...inputStyle, styles.flex1]}
              value={qty}
              onChangeText={setQty}
              placeholder="الكمية"
              placeholderTextColor={theme.textSecondary}
              keyboardType="number-pad"
            />
            <TextInput
              style={[...inputStyle, styles.flex1]}
              value={cost}
              onChangeText={setCost}
              placeholder="التكلفة (فلس)"
              placeholderTextColor={theme.textSecondary}
              keyboardType="decimal-pad"
            />
            <TextInput
              style={[...inputStyle, styles.flex1]}
              value={price}
              onChangeText={setPrice}
              placeholder="السعر (فلس)"
              placeholderTextColor={theme.textSecondary}
              keyboardType="decimal-pad"
            />
          </View>
          <Pressable
            onPress={submit}
            style={({ pressed }) => [
              styles.button,
              { backgroundColor: theme.tint },
              pressed && styles.pressed,
            ]}>
            <ThemedText type="smallBold" style={styles.buttonText}>
              حفظ
            </ThemedText>
          </Pressable>
        </View>

        {/* Holdings */}
        <View style={styles.listHeader}>
          <ThemedText type="smallBold" style={styles.sectionTitle}>
            المحفظة ({holdings.length})
          </ThemedText>
          {holdings.length > 0 && (
            <Pressable onPress={exportCsv} style={({ pressed }) => pressed && styles.pressed}>
              <ThemedText type="small" themeColor="tint">
                ⬆ مشاركة كشف CSV
              </ThemedText>
            </Pressable>
          )}
        </View>

        {holdings.length === 0 ? (
          <ThemedText type="small" themeColor="textSecondary" style={styles.empty}>
            المحفظة فارغة — أضف أول سهم من النموذج أعلاه.
          </ThemedText>
        ) : (
          <View style={styles.list}>
            {holdings.map((h) => {
              const { value, pl, pct } = holdingValue(h);
              const plColor = pl > 0 ? '#3fa66d' : pl < 0 ? '#d05b62' : theme.textSecondary;
              return (
                <ThemedView
                  key={h.ticker}
                  type="backgroundElement"
                  style={[styles.holdingCard, { borderColor: theme.border }]}>
                  <View style={styles.holdingTop}>
                    <ThemedText type="smallBold">
                      {h.ticker} · {h.name}
                    </ThemedText>
                    <Pressable onPress={() => remove(h.ticker)} hitSlop={8}>
                      <ThemedText type="small" style={{ color: '#d05b62' }}>
                        حذف
                      </ThemedText>
                    </Pressable>
                  </View>
                  <ThemedText type="small" themeColor="textSecondary">
                    {h.qty.toLocaleString()} سهم · تكلفة {h.cost} فلس · سعر {h.price} فلس
                  </ThemedText>
                  <View style={styles.holdingBottom}>
                    <ThemedText type="small">القيمة: {fmt(value)} د.ك</ThemedText>
                    <ThemedText type="smallBold" style={{ color: plColor }}>
                      {fmt(pl)} د.ك ({pct.toFixed(1)}%)
                    </ThemedText>
                  </View>
                </ThemedView>
              );
            })}
          </View>
        )}
      </View>
    </ScrollView>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  const theme = useTheme();
  return (
    <ThemedView type="backgroundElement" style={[styles.stat, { borderColor: theme.border }]}>
      <ThemedText type="smallBold" style={color ? { color } : undefined}>
        {value}
      </ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
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
    padding: Spacing.three,
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
  input: {
    borderWidth: 1,
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two + 2,
    fontSize: 14,
    textAlign: 'right',
  },
  button: {
    borderRadius: Spacing.two,
    paddingVertical: Spacing.three,
    alignItems: 'center',
  },
  buttonText: {
    color: '#ffffff',
  },
  pressed: {
    opacity: 0.8,
  },
  listHeader: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
  },
  empty: {
    textAlign: 'center',
    paddingVertical: Spacing.four,
  },
  list: {
    gap: Spacing.two,
  },
  holdingCard: {
    borderRadius: Spacing.three,
    borderWidth: 1,
    padding: Spacing.three,
    gap: Spacing.one,
  },
  holdingTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  holdingBottom: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
});
