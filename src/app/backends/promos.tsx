import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { AdminShell, adminStyles } from '@/components/admin-shell';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Chip } from '@/components/ui/chip';
import { Field } from '@/components/ui/field';
import { press } from '@/components/ui/press';
import { Spacing, TapTarget } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { adminApi, Unauthorized, type Discount, type DiscountDraft } from '@/lib/admin';
import { filsToInput, formatPrice, parseAmount, parseCount, toFils } from '@/lib/money';
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
  const { token, signOut } = useSession();

  const [rows, setRows] = useState<Discount[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<DiscountDraft | null>(null);

  /**
   * THE THREE NUMERIC FIELDS HOLD TEXT, NOT NUMBERS — and this is a bug fix,
   * not a refactor.
   *
   * They used to parse on every keystroke and store the result:
   *
   *     value={String(toKwd(draft.value))}
   *     onChangeText={(v) => setDraft({ ...draft, value: toFils(Number(...) || 0) })}
   *
   * So the box always showed a number derived from a number. Typing "1" gave
   * 1.000; typing the "." after it gave Number("1.") === 1, which renders as
   * "1" again — THE DECIMAL POINT DISAPPEARED AS IT WAS TYPED. A fixed-amount
   * promotion of 1.500 KD could not be entered at all, on the one screen in
   * this panel where a wrong number costs money.
   *
   * The `|| 0` made it worse in the other direction: anything unparseable
   * became a silent zero rather than a refusal, so a slip produced a working
   * promotion with the wrong value rather than an error.
   *
   * Text in, parsed once at save, refused by name if it will not parse.
   */
  const [text, setText] = useState({ value: '', minOrder: '', usageLimit: '' });

  /** Open the editor on a promotion, seeding the text boxes from its numbers.
   *  One place, so a new field cannot be added to one opener and not the other. */
  const openDraft = (d: DiscountDraft) => {
    setDraft(d);
    setText({
      value: d.type === 'percent' ? String(d.value) : filsToInput(d.value),
      minOrder: d.minOrder > 0 ? filsToInput(d.minOrder) : '',
      usageLimit: d.usageLimit > 0 ? String(d.usageLimit) : '',
    });
    setNotice(null);
  };

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

    // PARSED ONCE, HERE, where a refusal can name the field. parseAmount and
    // parseCount return null rather than zero for anything they cannot read,
    // which is the difference between telling the owner "that is not a number"
    // and quietly saving a promotion worth nothing. Both read Arabic-Indic
    // digits, so a number typed on an Arabic keyboard arrives intact.
    const value = draft.type === 'percent' ? parseCount(text.value) : parseAmount(text.value);
    if (value === null) {
      return setNotice(draft.type === 'percent'
        ? 'The percentage has to be a whole number, like 15.'
        : 'The amount has to be an amount in KWD, like 1.500.');
    }
    const minOrder = text.minOrder.trim() === '' ? 0 : parseAmount(text.minOrder);
    if (minOrder === null) {
      return setNotice('The minimum order has to be an amount in KWD, like 5.000 — or empty for none.');
    }
    const usageLimit = text.usageLimit.trim() === '' ? 0 : parseCount(text.usageLimit);
    if (usageLimit === null) {
      return setNotice('The usage limit has to be a whole number, or empty for unlimited.');
    }

    const full: DiscountDraft = { ...draft, value, minOrder, usageLimit };
    const bad = problem(full);
    if (bad) {
      setNotice(bad);
      return;
    }
    guard(async () => {
      await adminApi.saveDiscount({
        ...full,
        code: full.kind === 'code' ? (full.code ?? '').trim().toUpperCase() : null,
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

          {/* CHARACTERS, not none. save() uppercases the code before it is
              stored, so typing in lower case showed the owner one thing and
              saved another — and a customer told "use code summer" is then
              looking for a code the shop lists as SUMMER. */}
          {draft.kind === 'code' && (
            <Field
              label="Code"
              value={draft.code ?? ''}
              onChangeText={(v) => setDraft({ ...draft, code: v })}
              autoCapitalize="characters"
              autoCorrect={false}
              maxLength={40}
            />
          )}
          <Field label="Label (shown on the order)" value={draft.label}
            onChangeText={(v) => setDraft({ ...draft, label: v })} />

          <View style={styles.row}>
            {/* The TEXT moves with the type, or switching from 15 percent to a
                fixed amount leaves "15" in the box now meaning fifteen dinars. */}
            <Chip label="Percent" active={draft.type === 'percent'} role="radio"
              onPress={() => {
                setDraft({ ...draft, type: 'percent', value: 10 });
                setText((t) => ({ ...t, value: '10' }));
              }} />
            <Chip label="Fixed KWD" active={draft.type === 'fixed'} role="radio"
              onPress={() => {
                setDraft({ ...draft, type: 'fixed', value: toFils(1) });
                setText((t) => ({ ...t, value: filsToInput(toFils(1)) }));
              }} />
          </View>

          <Field
            label={draft.type === 'percent' ? 'Percent off (1–90)' : 'Amount off, KWD'}
            value={text.value}
            // number-pad for a percentage: it is a whole number, and offering a
            // decimal point invites one the server will refuse.
            keyboardType={draft.type === 'percent' ? 'number-pad' : 'decimal-pad'}
            selectTextOnFocus
            placeholder={draft.type === 'percent' ? '15' : '1.500'}
            onChangeText={(v) => setText((t) => ({ ...t, value: v }))}
          />
          <Field
            label="Minimum order, KWD (empty = none)"
            value={text.minOrder}
            keyboardType="decimal-pad"
            selectTextOnFocus
            placeholder="none"
            onChangeText={(v) => setText((t) => ({ ...t, minOrder: v }))}
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
            label="Usage limit (empty = unlimited)"
            value={text.usageLimit}
            keyboardType="number-pad"
            selectTextOnFocus
            placeholder="unlimited"
            onChangeText={(v) => setText((t) => ({ ...t, usageLimit: v }))}
          />

          <Button label={busy ? 'Saving…' : 'Save'} onPress={save} busy={busy} style={styles.save} />
          <Button label="Cancel" variant="secondary" onPress={() => { setDraft(null); setNotice(null); }} />
        </View>
      </AdminShell>
    );
  }

  return (
    <AdminShell title="Promotions" loading={loading} error={error} notice={notice} onRetry={load}>
      <Button label="New promotion" onPress={() => openDraft({ ...BLANK })} style={styles.save} />

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
                {/* 'en', not the shopper's language — see orders.tsx's note
                    on the same fix; Arabic-Indic digits here truncated to
                    "٣٠,···" on a 375px card. */}
                {d.type === 'percent' ? `${d.value}% off` : `${formatPrice(d.value, 'en')} off`}
                {d.minOrder > 0 ? ` over ${formatPrice(d.minOrder, 'en')}` : ''}
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
                  onPress={() => openDraft({ ...d })}
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
  action: { minHeight: TapTarget, justifyContent: 'center', paddingHorizontal: Spacing.two },
});
