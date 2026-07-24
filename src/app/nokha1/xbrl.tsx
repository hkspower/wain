import { useState } from 'react';
import { Alert, Pressable, ScrollView, Share, StyleSheet, TextInput, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { buildXbrl, cleanNum, xbrlBalance, XbrlInput } from '@/lib/nokha1';

const PERIODS: XbrlInput['period'][] = ['Q1', 'Q2', 'Q3', 'FY'];

const NUM_FIELDS: { key: keyof XbrlInput; label: string }[] = [
  { key: 'currentAssets', label: 'الأصول المتداولة' },
  { key: 'nonCurrentAssets', label: 'الأصول غير المتداولة' },
  { key: 'currentLiabilities', label: 'الالتزامات المتداولة' },
  { key: 'nonCurrentLiabilities', label: 'الالتزامات غير المتداولة' },
  { key: 'equity', label: 'حقوق الملكية' },
  { key: 'revenue', label: 'الإيرادات' },
  { key: 'expenses', label: 'المصروفات' },
];

export default function XbrlScreen() {
  const theme = useTheme();
  const [entity, setEntity] = useState('');
  const [lei, setLei] = useState('');
  const [period, setPeriod] = useState<XbrlInput['period']>('Q1');
  const [periodEnd, setPeriodEnd] = useState('');
  const [nums, setNums] = useState<Record<string, string>>({});

  const setNum = (key: string, value: string) => setNums((prev) => ({ ...prev, [key]: value }));

  const input = (): XbrlInput => ({
    entity: entity.trim().slice(0, 120),
    lei: lei.trim(),
    period,
    periodEnd,
    currentAssets: cleanNum(nums.currentAssets, 1e12),
    nonCurrentAssets: cleanNum(nums.nonCurrentAssets, 1e12),
    currentLiabilities: cleanNum(nums.currentLiabilities, 1e12),
    nonCurrentLiabilities: cleanNum(nums.nonCurrentLiabilities, 1e12),
    equity: cleanNum(nums.equity, 1e12),
    revenue: cleanNum(nums.revenue, 1e12),
    expenses: cleanNum(nums.expenses, 1e12),
  });

  const balance = xbrlBalance(input());
  const netIncome = cleanNum(nums.revenue, 1e12) - cleanNum(nums.expenses, 1e12);

  const validateMeta = (): string | null => {
    if (!entity.trim()) return 'أدخل اسم الشركة.';
    if (!/^[A-Za-z0-9]{4,40}$/.test(lei.trim())) return 'الرقم التعريفي: أحرف وأرقام إنجليزية (٤–٤٠).';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(periodEnd)) return 'نهاية الفترة بصيغة YYYY-MM-DD.';
    return null;
  };

  const generate = () => {
    const err = validateMeta();
    if (err) {
      Alert.alert('بيانات ناقصة', err);
      return;
    }
    if (!balance.balanced) {
      Alert.alert(
        'القائمة غير متوازنة',
        `الأصول ${balance.assets.toFixed(3)} د.ك مقابل ${balance.liabEq.toFixed(3)} د.ك — الفرق ${balance.diff.toFixed(3)} د.ك.`,
      );
      return;
    }
    Share.share({ message: buildXbrl(input()), title: `xbrl-${period}-${periodEnd}.xml` });
  };

  const inputStyle = [
    styles.input,
    { borderColor: theme.border, color: theme.text, backgroundColor: theme.backgroundElement },
  ];

  return (
    <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
      <View style={styles.content}>
        <ThemedText type="small" themeColor="textSecondary" style={styles.hint}>
          أدخل بيانات المنشأة والقوائم المالية (د.ك)، تحقق من التوازن، ثم ولّد ملف
          XBRL بمعيار IFRS وشاركه.
        </ThemedText>

        <ThemedText type="smallBold" style={styles.sectionTitle}>
          المنشأة والفترة
        </ThemedText>
        <View style={styles.form}>
          <TextInput
            style={inputStyle}
            value={entity}
            onChangeText={setEntity}
            placeholder="اسم الشركة"
            placeholderTextColor={theme.textSecondary}
            maxLength={120}
          />
          <TextInput
            style={inputStyle}
            value={lei}
            onChangeText={setLei}
            placeholder="LEI / سجل تجاري"
            placeholderTextColor={theme.textSecondary}
            autoCapitalize="characters"
            maxLength={40}
          />
          <View style={styles.periodRow}>
            {PERIODS.map((p) => (
              <Pressable
                key={p}
                onPress={() => setPeriod(p)}
                style={({ pressed }) => [styles.flex1, pressed && styles.pressed]}>
                <ThemedView
                  type={p === period ? 'backgroundSelected' : 'backgroundElement'}
                  style={[
                    styles.periodChip,
                    { borderColor: p === period ? theme.tint : theme.border },
                  ]}>
                  <ThemedText type="small" themeColor={p === period ? 'tint' : 'textSecondary'}>
                    {p}
                  </ThemedText>
                </ThemedView>
              </Pressable>
            ))}
          </View>
          <TextInput
            style={inputStyle}
            value={periodEnd}
            onChangeText={setPeriodEnd}
            placeholder="نهاية الفترة YYYY-MM-DD"
            placeholderTextColor={theme.textSecondary}
            maxLength={10}
          />
        </View>

        <ThemedText type="smallBold" style={styles.sectionTitle}>
          القوائم المالية (د.ك)
        </ThemedText>
        <View style={styles.form}>
          {NUM_FIELDS.map((f) => (
            <TextInput
              key={f.key}
              style={inputStyle}
              value={nums[f.key] ?? ''}
              onChangeText={(v) => setNum(f.key, v)}
              placeholder={f.label}
              placeholderTextColor={theme.textSecondary}
              keyboardType="decimal-pad"
            />
          ))}
          <ThemedText type="small" themeColor="textSecondary">
            صافي الربح (تلقائي): {netIncome.toFixed(3)} د.ك
          </ThemedText>
        </View>

        <ThemedView
          type="backgroundElement"
          style={[
            styles.balanceCard,
            { borderColor: balance.balanced ? '#3fa66d' : '#d05b62' },
          ]}>
          <ThemedText
            type="small"
            style={{ color: balance.balanced ? '#3fa66d' : '#d05b62' }}>
            {balance.balanced
              ? `✔ متوازنة: الأصول ${balance.assets.toFixed(3)} = الالتزامات + حقوق الملكية ${balance.liabEq.toFixed(3)}`
              : `✘ غير متوازنة — الفرق ${balance.diff.toFixed(3)} د.ك`}
          </ThemedText>
        </ThemedView>

        <Pressable
          onPress={generate}
          style={({ pressed }) => [
            styles.button,
            { backgroundColor: theme.tint },
            pressed && styles.pressed,
          ]}>
          <ThemedText type="smallBold" style={styles.buttonText}>
            ⬆ توليد ومشاركة ملف XBRL
          </ThemedText>
        </Pressable>
      </View>
    </ScrollView>
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
  hint: {
    textAlign: 'right',
    writingDirection: 'rtl',
    marginBottom: Spacing.three,
    lineHeight: 20,
  },
  sectionTitle: {
    fontSize: 16,
    marginBottom: Spacing.two,
  },
  form: {
    gap: Spacing.two,
    marginBottom: Spacing.four,
  },
  periodRow: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  flex1: {
    flex: 1,
  },
  periodChip: {
    borderRadius: 999,
    borderWidth: 1,
    paddingVertical: Spacing.two,
    alignItems: 'center',
  },
  input: {
    borderWidth: 1,
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two + 2,
    fontSize: 14,
    textAlign: 'right',
  },
  balanceCard: {
    borderRadius: Spacing.three,
    borderWidth: 1,
    padding: Spacing.three,
    marginBottom: Spacing.three,
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
});
