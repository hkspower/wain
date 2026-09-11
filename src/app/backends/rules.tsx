import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AdminShell } from '@/components/admin-shell';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Chip } from '@/components/ui/chip';
import { Field } from '@/components/ui/field';
import { Spacing } from '@/constants/theme';
import { adminApi, Unauthorized, type ShopRules } from '@/lib/admin';
import { useSession } from '@/lib/session';

/**
 * The numbers the shop runs on: delivery, returns, the cash-on-delivery limit,
 * the review reward, the discount cap, the delivery areas, and which sizes and
 * fits are offered.
 *
 * Every one of these was a PHP constant until 2026-09-10, so changing one meant
 * a code edit and a publish. The website's panel has the same card
 * (assets/rules.js) — this screen exists so the two panels do not diverge,
 * which is the trap this project has fallen into four times: the KNET editor,
 * the footer editor, the theme editor and the brand-logo uploader all began
 * app-only, and "it is in /backends" was true of a panel the owner does not
 * open in a browser. The reverse is just as bad.
 *
 * ONE SAVE, not one per card, and that is the opposite of the Settings screen's
 * choice — deliberately. There, the promo bar and the contact details are
 * unrelated and a single button would make editing one rewrite the other. Here
 * the nine are ONE POLICY and two of them are checked against each other by the
 * server: a review reward above the discount cap is refused. Splitting the save
 * would let the owner save half a policy and be told why by the other half.
 *
 * THE LISTS COME FROM THE SERVER. `allowed` arrives with the rules and every
 * chip is built from it. Sizes and fits are pinned by CHECK constraints on
 * order_items, so a picker offering a size MySQL will refuse is a checkout that
 * dies on its last step — and a list typed here would be a third home for it,
 * stale the day someone migrates the schema.
 *
 * MONEY IS SHOWN IN KWD AND SENT IN FILS, converted once on each edge. The
 * server's unit is integer fils, like every price in this shop.
 */

/** fils → the three-decimal KWD string this shop writes everywhere. */
const toKwd = (fils: number) => (fils / 1000).toFixed(3);

/** A KWD string → integer fils, or null if it is not a number the shop can
 *  store. A comma decimal is accepted because that is what an Arabic keyboard
 *  offers; refusing it would make the field look broken. */
const toFils = (text: string): number | null => {
  const raw = text.trim().replace(',', '.');
  if (!/^\d+(\.\d{1,3})?$/.test(raw)) return null;
  return Math.round(parseFloat(raw) * 1000);
};

const toCount = (text: string): number | null => {
  const raw = text.trim();
  return /^\d+$/.test(raw) ? parseInt(raw, 10) : null;
};

/** admin.php refuses with a token that names the field. Printing it would make
 *  a careful message look like a crash. */
const FIELD_NAMES: Record<string, string> = {
  delivery_fee_fils: 'the delivery fee',
  free_delivery_fils: 'the free-delivery threshold',
  return_days: 'the returns window',
  cod_open_max: 'the cash-on-delivery limit',
  review_reward_pct: 'the review reward',
  discount_max_pct: 'the discount cap',
  governorates: 'the delivery areas',
  sizes: 'the sizes',
  fits: 'the fits',
};

function explain(message: string): string {
  const head = message.split(':')[0];
  const rest = message.slice(head.length + 1);
  const field = FIELD_NAMES[rest.split(':')[0]] ?? rest.split(':')[0];

  switch (head) {
    case 'rule_size_in_use':
      // Keeps its detail, because this is the one refusal where the detail is
      // the action: "you cannot remove XL" is not useful, "XL has 42 stock
      // rows" tells the owner exactly what to clear.
      return `Those sizes still have stock rows, so removing them would leave garments showing a size nobody can buy: ${rest}. Clear the stock in Stock first.`;
    case 'rule_unknown_value':
      return `That is not a value this shop can store — ${rest}. Adding a genuinely new size or fit is a database change, not a setting.`;
    case 'rule_empty_list':
      return `You cannot leave ${field} empty.`;
    case 'rule_out_of_range':
      return `That value for ${field} is outside what the shop accepts.`;
    case 'rule_not_a_number':
      return `${field} has to be a number.`;
    case 'rule_reward_above_cap':
      return 'The review reward is higher than the discount cap, so a customer would be promised more than the checkout will ever give them.';
    default:
      // Shown rather than swallowed: a message nobody wrote is still better
      // than "save failed", which says nothing at all.
      return message;
  }
}

type Allowed = { sizes: string[]; fits: string[]; governorates: string[] };

export default function RulesScreen() {
  const { signOut } = useSession();

  const [rules, setRules] = useState<ShopRules | null>(null);
  const [defaults, setDefaults] = useState<ShopRules | null>(null);
  const [allowed, setAllowed] = useState<Allowed | null>(null);

  // The money and count fields are held as TEXT while being edited. Holding
  // them as numbers means a half-typed "2." is either rejected keystroke by
  // keystroke or silently becomes 2, and both make the field fight the person
  // using it.
  const [text, setText] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');

  const fill = useCallback((r: ShopRules) => {
    setRules(r);
    setText({
      delivery_fee_fils: toKwd(r.delivery_fee_fils),
      free_delivery_fils: toKwd(r.free_delivery_fils),
      return_days: String(r.return_days),
      cod_open_max: String(r.cod_open_max),
      review_reward_pct: String(r.review_reward_pct),
      discount_max_pct: String(r.discount_max_pct),
    });
  }, []);

  const load = useCallback(async () => {
    setError('');
    try {
      const res = await adminApi.rules();
      fill(res.rules);
      setDefaults(res.defaults);
      setAllowed(res.allowed);
    } catch (e) {
      if (e instanceof Unauthorized) return signOut();
      setError(e instanceof Error ? e.message : 'Could not load the rules.');
    }
  }, [fill, signOut]);

  useEffect(() => {
    void load();
  }, [load]);

  const toggle = (key: 'sizes' | 'fits' | 'governorates', value: string) => {
    if (!rules) return;
    const on = rules[key].includes(value);
    // Order is preserved by rebuilding from `allowed`, so the shop's own
    // ordering survives a chip being turned off and on again. Pushing to the
    // end instead would let a shopper see S, M, XL, L.
    const next = (allowed?.[key] ?? [])
      .filter((v) => (v === value ? !on : rules[key].includes(v)));
    setRules({ ...rules, [key]: next });
    setNote('');
  };

  const save = async () => {
    if (!rules || busy) return;

    const value: Partial<ShopRules> = {
      governorates: rules.governorates,
      sizes: rules.sizes,
      fits: rules.fits,
    };

    for (const key of ['delivery_fee_fils', 'free_delivery_fils'] as const) {
      const fils = toFils(text[key] ?? '');
      if (fils === null) {
        setNote(`Check ${FIELD_NAMES[key]} — it has to be a number like 1.500.`);
        return;
      }
      value[key] = fils;
    }
    for (const key of
      ['return_days', 'cod_open_max', 'review_reward_pct', 'discount_max_pct'] as const) {
      const n = toCount(text[key] ?? '');
      if (n === null) {
        setNote(`Check ${FIELD_NAMES[key]} — it has to be a whole number.`);
        return;
      }
      value[key] = n;
    }

    setBusy(true);
    setNote('');
    try {
      const saved = await adminApi.saveRules(value);
      fill(saved);
      setNote('Saved. The next order uses these.');
    } catch (e) {
      if (e instanceof Unauthorized) return signOut();
      // The typed values are LEFT IN PLACE. Reloading here would discard the
      // owner's edit and leave them retyping it under the message explaining
      // why it was refused — the website card had exactly that bug and its rig
      // caught it. Nothing was written, so the shop is unchanged either way.
      setNote(explain(e instanceof Error ? e.message : 'Could not save.'));
    } finally {
      setBusy(false);
    }
  };

  const chips = (key: 'sizes' | 'fits' | 'governorates', title: string, hint: string) => (
    <View style={styles.block}>
      <ThemedText type="labelBold">{title}</ThemedText>
      <ThemedText style={styles.hint}>{hint}</ThemedText>
      <View style={styles.chips}>
        {(allowed?.[key] ?? []).map((v) => (
          <Chip
            key={v}
            label={v}
            active={!!rules?.[key].includes(v)}
            onPress={() => toggle(key, v)}
          />
        ))}
      </View>
    </View>
  );

  return (
    <AdminShell title="Shop rules">
      {error ? <ThemedText style={styles.hint}>{error}</ThemedText> : null}

      {rules && allowed ? (
        <Card style={styles.card}>
          <ThemedText style={styles.hint}>
            The numbers the shop runs on. They take effect on the next order — nothing
            needs publishing.
          </ThemedText>

          <Field
            label="Delivery fee (KWD)"
            value={text.delivery_fee_fils ?? ''}
            onChangeText={(t) => setText({ ...text, delivery_fee_fils: t })}
            keyboardType="decimal-pad"
          />
          <ThemedText style={styles.hint}>0 means delivery is free for everyone.</ThemedText>

          <Field
            label="Free delivery over (KWD)"
            value={text.free_delivery_fils ?? ''}
            onChangeText={(t) => setText({ ...text, free_delivery_fils: t })}
            keyboardType="decimal-pad"
          />
          <ThemedText style={styles.hint}>
            Orders at or above this pay no delivery. 0 turns it off.
          </ThemedText>

          <Field
            label="Returns window (days)"
            value={text.return_days ?? ''}
            onChangeText={(t) => setText({ ...text, return_days: t })}
            keyboardType="number-pad"
          />
          <ThemedText style={styles.hint}>
            Counted from delivery, not from the order. WARNING: the shop’s pages say
            “14 days” in fixed text, so changing this changes what is enforced but not
            what customers are told.
          </ThemedText>

          <Field
            label="Unpaid cash orders per customer"
            value={text.cod_open_max ?? ''}
            onChangeText={(t) => setText({ ...text, cod_open_max: t })}
            keyboardType="number-pad"
          />

          <Field
            label="Review reward (%)"
            value={text.review_reward_pct ?? ''}
            onChangeText={(t) => setText({ ...text, review_reward_pct: t })}
            keyboardType="number-pad"
          />

          <Field
            label="Discount cap (%)"
            value={text.discount_max_pct ?? ''}
            onChangeText={(t) => setText({ ...text, discount_max_pct: t })}
            keyboardType="number-pad"
          />
          <ThemedText style={styles.hint}>
            The most any combination of discounts may take off one order.
          </ThemedText>

          {chips('governorates', 'Delivery areas',
            'A customer outside these cannot check out. WARNING: the checkout still lists '
            + 'all six areas in fixed text, so removing one does not hide it — the customer '
            + 'fills the whole form and is refused at the last step.')}
          {chips('sizes', 'Sizes',
            'Which of the sizes this shop offers, in the order they appear.')}
          {chips('fits', 'Fits', 'Which fits a customer may choose from.')}

          <View style={styles.actions}>
            <Button label={busy ? 'Saving…' : 'Save rules'} onPress={save} disabled={busy} />
            <Button
              label="Back to the shipped defaults"
              variant="secondary"
              disabled={busy || !defaults}
              onPress={() => {
                if (!defaults) return;
                fill(defaults);
                setNote('Defaults filled in — nothing is saved until you press Save.');
              }}
            />
          </View>

          {note ? <ThemedText style={styles.note}>{note}</ThemedText> : null}
        </Card>
      ) : (
        <ThemedText style={styles.hint}>Loading…</ThemedText>
      )}
    </AdminShell>
  );
}

const styles = StyleSheet.create({
  card: { gap: Spacing.three },
  hint: { opacity: 0.7, fontSize: 13, lineHeight: 18 },
  note: { marginTop: Spacing.three, fontSize: 13, lineHeight: 18 },
  block: { marginTop: Spacing.four, gap: 4 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two, marginTop: 4 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.three, marginTop: Spacing.four },
});
