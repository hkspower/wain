import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { AdminShell, adminStyles } from '@/components/admin-shell';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Chip } from '@/components/ui/chip';
import { Field } from '@/components/ui/field';
import { press } from '@/components/ui/press';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { adminApi, Unauthorized, type Discount, type DiscountDraft } from '@/lib/admin';
import { useLang } from '@/lib/i18n';
import { formatPrice, toFils, toKwd } from '@/lib/money';
import { useSession } from '@/lib/session';

const BLANK: DiscountDraft = {
  kind: 'code',
  code: '',
  label: '',
  type: 'percent',
  value: 10,
  minOrder: 0,
  category: null,
  startsAt: null,
  endsAt: null,
  usageLimit: 0,
  active: true,
};

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A date, typed as digits, punctuated for you.
 *
 * The two window fields are plain text with the default keyboard, so setting a
 * promotion on a phone meant switching to the numeric layout, hunting for the
 * hyphen, and typing it twice — and `problem()` rejects the whole draft if
 * either one lands wrong. The manager gets "The start date has to be
 * YYYY-MM-DD" for a stray character they cannot see.
 *
 * So the field takes DIGITS and puts the hyphens in: 20260915 becomes
 * 2026-09-15 while it is being typed.
 *
 * It works off the digits alone rather than patching the string in place,
 * which is what makes deleting behave. Backspacing over a hyphen removes the
 * digit before it and the rest re-punctuates, instead of leaving the cursor
 * stuck against a separator it cannot delete.
 *
 * Eight digits is a whole date, so anything beyond is dropped rather than
 * quietly making an ISO string the validator will refuse.
 */
export const asIsoDate = (raw: string): string => {
  const d = raw.replace(/\D/g, '').slice(0, 8);
  if (d.length <= 4) return d;
  if (d.length <= 6) return `${d.slice(0, 4)}-${d.slice(4)}`;
  return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}`;
};

export default function PromosScreen() {
  const theme = useTheme();
  const { lang } = useLang();
  const { token, signOut } = useSession();

  const [rows, setRows] = useState<Discount[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<DiscountDraft | null>(null);

  const load = useCallback(() => {
    if (!token) return;
    setLoading(true);
    setError(null);
    adminApi
      .discounts()
      .then((r) => setRows(r.discounts))
      .catch((e) => (e instanceof Unauthorized ? signOut() : setError(String(e))))
      .finally(() => setLoading(false));
  }, [token, signOut]);

  useEffect(load, [load]);

  const guard = async (run: () => Promise<unknown>) => {
    if (!token || busy) return;
    setBusy(true);
    setNotice(null);
    try {
      await run();
      load();
    } catch (e) {
      if (e instanceof Unauthorized) signOut();
      // The server's error CODES, said in words a manager can act on. The
      // one worth translating is the refusal to delete: it is admin.php
      // protecting the order history, not a fault.
      else if (e instanceof Error && e.message === 'discount_in_use')
        setNotice('This promotion has been used on real orders, so it stays for the records. Pause it instead.');
      else setNotice(String(e));
    } finally {
      setBusy(false);
    }
  };

  /**
   * Everything the server would reject, refused here first — with the reason.
   * A promotion is the one thing in this panel that costs money when it is
   * wrong, and "500" is not a reason.
   */
  const problem = (d: DiscountDraft): string | null => {
    if (!d.label.trim()) return 'Give it a label — it appears on the order.';
    if (d.kind === 'code' && !d.code?.trim()) return 'A code discount needs a code.';
    if (d.type === 'percent' && (d.value < 1 || d.value > 90))
      return 'A percentage has to be between 1 and 90.';
    if (d.type === 'fixed' && d.value <= 0) return 'A fixed amount has to be more than zero.';
    for (const [name, v] of [['start', d.startsAt], ['end', d.endsAt]] as const)
      if (v && !ISO.test(v)) return `The ${name} date has to be YYYY-MM-DD.`;
    if (d.startsAt && d.endsAt && d.endsAt < d.startsAt)
      return 'It cannot end before it starts.';
    return null;
  };

  const save = () => {
    if (!draft) return;
    const bad = problem(draft);
    if (bad) {
      setNotice(bad);
      return;
    }
    guard(async () => {
      await adminApi.saveDiscount({
        ...draft,
        code: draft.kind === 'code' ? (draft.code ?? '').trim().toUpperCase() : null,
      });
      setDraft(null);
    });
  };

  if (draft) {
    return (
      <AdminShell title={draft.id ? 'Edit promotion' : 'New promotion'} notice={notice}>
        <View style={styles.form}>
          <View style={styles.row}>
            <Chip label="Code" active={draft.kind === 'code'} role="radio"
              onPress={() => setDraft({ ...draft, kind: 'code' })} />
            <Chip label="Automatic" active={draft.kind === 'auto'} role="radio"
              onPress={() => setDraft({ ...draft, kind: 'auto', code: null })} />
          </View>

          {draft.kind === 'code' && (
            <Field
              label="Code"
              value={draft.code ?? ''}
              onChangeText={(v) => setDraft({ ...draft, code: v })}
              autoCapitalize="none"
            />
          )}
          <Field label="Label (shown on the order)" value={draft.label}
            onChangeText={(v) => setDraft({ ...draft, label: v })} />

          <View style={styles.row}>
            <Chip label="Percent" active={draft.type === 'percent'} role="radio"
              onPress={() => setDraft({ ...draft, type: 'percent', value: 10 })} />
            <Chip label="Fixed KWD" active={draft.type === 'fixed'} role="radio"
              onPress={() => setDraft({ ...draft, type: 'fixed', value: toFils(1) })} />
          </View>

          <Field
            label={draft.type === 'percent' ? 'Percent off (1–90)' : 'Amount off, KWD'}
            value={draft.type === 'percent' ? String(draft.value) : String(toKwd(draft.value))}
            keyboardType="decimal-pad"
            onChangeText={(v) => {
              const n = Number(v.replace(/[^\d.]/g, '')) || 0;
              setDraft({ ...draft, value: draft.type === 'percent' ? Math.round(n) : toFils(n) });
            }}
          />
          <Field
            label="Minimum order, KWD (0 = none)"
            value={String(toKwd(draft.minOrder))}
            keyboardType="decimal-pad"
            onChangeText={(v) => setDraft({ ...draft, minOrder: toFils(Number(v.replace(/[^\d.]/g, '')) || 0) })}
          />
          <View style={styles.row}>
            {/* numbers-and-punctuation, not number-pad: number-pad on iOS has
                no hyphen at all, so a date could not be typed even by hand if
                the formatter were ever removed. maxLength is the length of a
                whole date. */}
            <Field label="Starts (YYYY-MM-DD)" value={draft.startsAt ?? ''}
              keyboardType="numbers-and-punctuation" maxLength={10}
              onChangeText={(v) => setDraft({ ...draft, startsAt: asIsoDate(v) || null })} />
            <Field label="Ends (YYYY-MM-DD)" value={draft.endsAt ?? ''}
              keyboardType="numbers-and-punctuation" maxLength={10}
              onChangeText={(v) => setDraft({ ...draft, endsAt: asIsoDate(v) || null })} />
          </View>
          <Field
            label="Usage limit (0 = unlimited)"
            value={String(draft.usageLimit)}
            keyboardType="number-pad"
            onChangeText={(v) => setDraft({ ...draft, usageLimit: Number(v.replace(/\D/g, '')) || 0 })}
          />

          <Button label={busy ? 'Saving…' : 'Save'} onPress={save} busy={busy} style={styles.save} />
          <Button label="Cancel" variant="secondary" onPress={() => { setDraft(null); setNotice(null); }} />
        </View>
      </AdminShell>
    );
  }

  return (
    <AdminShell title="Promotions" loading={loading} error={error} notice={notice} onRetry={load}>
      <Button label="New promotion" onPress={() => setDraft({ ...BLANK })} style={styles.save} />

      {rows && rows.length === 0 ? (
        <ThemedText type="label" themeColor="textSecondary" style={styles.empty}>
          No promotions yet.
        </ThemedText>
      ) : (
        rows?.map((d) => {
          const spent = d.usageLimit > 0 && d.usedCount >= d.usageLimit;
          return (
            <Card key={d.id} tone={d.active && !spent ? undefined : theme.border}>
              <View style={adminStyles.rowBetween}>
                <ThemedText type="labelBold">
                  {d.kind === 'code' ? d.code : 'Automatic'}
                </ThemedText>
                <ThemedText type="labelBold" themeColor={d.active && !spent ? 'success' : 'textSecondary'}>
                  {spent ? 'used up' : d.active ? 'live' : 'paused'}
                </ThemedText>
              </View>
              <ThemedText type="label" themeColor="textSecondary">{d.label}</ThemedText>
              <ThemedText type="label">
                {d.type === 'percent' ? `${d.value}% off` : `${formatPrice(d.value, lang)} off`}
                {d.minOrder > 0 ? ` over ${formatPrice(d.minOrder, lang)}` : ''}
                {d.category ? ` · ${d.category}` : ''}
              </ThemedText>
              {/* The window and the counter are what a manager checks first —
                  "why is this not applying" is nearly always one of the two. */}
              <ThemedText type="caption" themeColor="textSecondary">
                {d.startsAt || d.endsAt ? `${d.startsAt ?? '—'} → ${d.endsAt ?? '—'}` : 'no end date'}
                {' · '}
                {d.usageLimit > 0 ? `${d.usedCount}/${d.usageLimit} used` : `${d.usedCount} used`}
              </ThemedText>

              <View style={[adminStyles.rowBetween, styles.actions]}>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => guard(() => adminApi.setDiscountActive(d.id, !d.active))}
                  style={press(true, styles.action)}>
                  <ThemedText type="labelBold" themeColor="tintText">
                    {d.active ? 'Pause' : 'Resume'}
                  </ThemedText>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => setDraft({ ...d })}
                  style={press(true, styles.action)}>
                  <ThemedText type="labelBold" themeColor="tintText">Edit</ThemedText>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`delete ${d.code ?? d.label}`}
                  // No confirmation dialog, and that is deliberate: a deleted
                  // promotion that has been USED is refused by the server —
                  // the orders that took it keep their snapshot — so the worst
                  // this can do is remove an unused rule the manager can
                  // retype. A modal here would be friction on every tap to
                  // guard the one that cannot happen.
                  onPress={() => guard(() => adminApi.deleteDiscount(d.id))}
                  style={press(true, styles.action)}>
                  <ThemedText type="labelBold" themeColor="danger">Delete</ThemedText>
                </Pressable>
              </View>
            </Card>
          );
        })
      )}
    </AdminShell>
  );
}

const styles = StyleSheet.create({
  form: { gap: Spacing.two },
  row: { flexDirection: 'row', gap: Spacing.two },
  save: { marginTop: Spacing.two },
  empty: { paddingVertical: Spacing.five, textAlign: 'center' },
  actions: { marginTop: Spacing.two },
  action: { minHeight: 44, justifyContent: 'center', paddingHorizontal: Spacing.two },
});
