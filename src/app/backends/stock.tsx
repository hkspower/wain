import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { press } from '@/components/ui/press';

import { AdminShell, adminStyles } from '@/components/admin-shell';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Radius, Spacing, TapTarget } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { adminApi, Unauthorized, type StockItem } from '@/lib/admin';
import { useSession } from '@/lib/session';

export default function StockScreen() {
  const theme = useTheme();
  const { token, signOut } = useSession();
  const [items, setItems] = useState<StockItem[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Keyed by slug+size: the row being edited, the value typed, and whether a
  // save is in flight. Kept as one map so two rows can never both think they
  // are the one being saved.
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const key = (i: StockItem) => `${i.slug}|${i.size}`;

  const load = useCallback(() => {
    if (!token) return;
    setLoading(true);
    setError(null);
    adminApi
      .stock()
      .then((r) => setItems(r.items))
      .catch((e) => (e instanceof Unauthorized ? signOut() : setError(String(e))))
      .finally(() => setLoading(false));
  }, [token, signOut]);

  useEffect(load, [load]);

  const save = async (item: StockItem) => {
    const k = key(item);
    const typed = draft[k];
    if (!token || typed === undefined || saving) return;

    // Whole numbers, never negative. A stock field is the one input in this
    // panel where a typo becomes an oversold order, so the value is parsed
    // strictly rather than coerced: "12x" is refused, not read as 12.
    if (!/^\d+$/.test(typed.trim())) {
      setNotice(`"${typed}" is not a whole number of items.`);
      return;
    }
    const next = Number(typed);

    setSaving(k);
    setNotice(null);
    try {
      await adminApi.setStock(item.sku, next);
      setItems((prev) =>
        prev ? prev.map((i) => (key(i) === k ? { ...i, stock: next } : i)) : prev,
      );
      setDraft((d) => {
        const { [k]: _drop, ...rest } = d;
        return rest;
      });
      setSaved(k);
    } catch (e) {
      if (e instanceof Unauthorized) signOut();
      else setNotice(String(e));
    } finally {
      setSaving(null);
    }
  };

  return (
    <AdminShell title="Stock" loading={loading} error={error} notice={notice} onRetry={load}>
      {items?.map((i) => {
        const k = key(i);
        const typed = draft[k];
        const dirty = typed !== undefined && typed !== String(i.stock);
        return (
          <ThemedView
            key={k}
            type="backgroundElement"
            style={[adminStyles.card,
              i.stock === 0
                ? { borderWidth: 1, borderColor: theme.danger }
                : adminStyles.lift]}>
            <View style={adminStyles.rowBetween}>
              <ThemedText type="labelBold" style={styles.name}>
                {i.name}
              </ThemedText>
              <ThemedText type="label" themeColor="textSecondary">
                {i.size}
              </ThemedText>
            </View>
            <View style={[adminStyles.rowBetween, styles.editRow]}>
              <TextInput
                value={typed ?? String(i.stock)}
                onChangeText={(v) => {
                  setDraft((d) => ({ ...d, [k]: v }));
                  setSaved(null);
                  setNotice(null);
                }}
                keyboardType="number-pad"
                accessibilityLabel={`stock for ${i.name} ${i.size}`}
                style={[
                  styles.input,
                  {
                    color: theme.text,
                    backgroundColor: theme.background,
                    borderColor: dirty ? theme.tint : theme.border,
                  },
                ]}
              />
              <Pressable
                accessibilityRole="button"
                // Named per row: four buttons all announcing "Save" are
                // indistinguishable to a screen reader, and to the test rig,
                // which clicked the first one and found it rightly disabled.
                accessibilityLabel={`save stock for ${i.name} ${i.size}`}
                accessibilityState={{ disabled: !dirty, busy: saving === k }}
                disabled={!dirty || saving !== null}
                onPress={() => save(i)}
                style={press(false, styles.save,
                  { backgroundColor: dirty ? theme.tint : theme.backgroundElement, borderColor: theme.border },
                  !dirty && styles.dimmed)}>
                {saving === k ? (
                  <ActivityIndicator color={theme.onTint} />
                ) : (
                  <ThemedText type="labelBold" themeColor={dirty ? 'onTint' : 'textSecondary'}>
                    {saved === k ? 'Saved' : 'Save'}
                  </ThemedText>
                )}
              </Pressable>
            </View>
          </ThemedView>
        );
      })}
    </AdminShell>
  );
}

const styles = StyleSheet.create({
  name: { flex: 1 },
  editRow: { marginTop: Spacing.two },
  input: {
    flex: 1,
    minHeight: TapTarget,
    borderWidth: 1,
    borderRadius: Radius.button,
    paddingHorizontal: Spacing.three,
    fontSize: 16,
  },
  save: {
    minWidth: 96,
    minHeight: TapTarget,
    borderWidth: 1,
    borderRadius: Radius.button,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dimmed: { opacity: 0.6 },
});
