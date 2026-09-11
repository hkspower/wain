import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { AdminShell, adminStyles } from '@/components/admin-shell';
import { ThemedText } from '@/components/themed-text';
import { Card } from '@/components/ui/card';
import { Chip } from '@/components/ui/chip';
import { Field } from '@/components/ui/field';
import { press } from '@/components/ui/press';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { adminApi, Unauthorized, type ReturnRequest, type ReturnStatus } from '@/lib/admin';
import { useLang } from '@/lib/i18n';
import { formatPrice } from '@/lib/money';
import { useSession } from '@/lib/session';

/**
 * Returns and exchanges — the requests customers make from /returns/request on
 * the website.
 *
 * A TO-DO LIST, NOT A LOG. Every row is somebody waiting to hear whether a
 * courier is coming, so `new` is the default filter and the count of them is
 * the first thing on the screen. The other five statuses are there to be moved
 * to, and to be looked back at, not to be browsed.
 *
 * WHAT THIS SCREEN CANNOT DO, deliberately: change what was asked for. The
 * lines, the sizes and the quantities are the customer's request and the
 * record of it. Staff decide what happens to it; they do not edit it.
 */

/** The server's six, in the order a request actually travels through them.
 *  `cancelled` is the customer's own word and is not offered as a move — it
 *  arrives when they withdraw, not when the shop decides something. */
const MOVES: { to: ReturnStatus; label: string }[] = [
  { to: 'approved', label: 'Approve' },
  { to: 'picked_up', label: 'Picked up' },
  { to: 'refunded', label: 'Refunded' },
  { to: 'rejected', label: 'Reject' },
];

const FILTERS: (ReturnStatus | 'all')[] = ['new', 'approved', 'picked_up', 'refunded', 'all'];

const WORDS: Record<ReturnStatus, string> = {
  new: 'waiting',
  approved: 'approved',
  picked_up: 'picked up',
  refunded: 'refunded',
  rejected: 'rejected',
  cancelled: 'cancelled',
};

export default function ReturnsScreen() {
  const theme = useTheme();
  const { lang } = useLang();
  const { token, signOut } = useSession();

  const [filter, setFilter] = useState<ReturnStatus | 'all'>('new');
  const [rows, setRows] = useState<ReturnRequest[] | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** The request being rejected, and the reason being typed for it. The server
   *  refuses a rejection with no reason, so the form is opened rather than the
   *  refusal being discovered after the tap. */
  const [rejecting, setRejecting] = useState<{ id: number; note: string } | null>(null);

  const load = useCallback(() => {
    if (!token) return;
    setLoading(true);
    setError(null);
    adminApi
      .returns(filter)
      .then((r) => {
        setRows(r.returns);
        setCounts(r.counts);
      })
      .catch((e) => (e instanceof Unauthorized ? signOut() : setError(String(e))))
      .finally(() => setLoading(false));
  }, [token, filter, signOut]);

  useEffect(load, [load]);

  const move = async (id: number, to: ReturnStatus, note?: string) => {
    if (!token || busy) return;
    setBusy(true);
    setNotice(null);
    try {
      await adminApi.setReturnStatus(id, to, note);
      setRejecting(null);
      load();
    } catch (e) {
      if (e instanceof Unauthorized) signOut();
      // The server's codes, said in words a manager can act on.
      else if (e instanceof Error && e.message === 'reason_required')
        setNotice('A rejection needs a reason — the customer is told what it is.');
      else setNotice(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AdminShell title="Returns" loading={loading} error={error} notice={notice} onRetry={load}>
      <View style={styles.filters}>
        {FILTERS.map((f) => (
          <Chip
            key={f}
            label={
              f === 'all'
                ? 'All'
                : `${WORDS[f]}${counts[f] ? ` ${counts[f]}` : ''}`
            }
            active={filter === f}
            role="radio"
            onPress={() => setFilter(f)}
          />
        ))}
      </View>

      {rows && rows.length === 0 ? (
        <ThemedText type="label" themeColor="textSecondary" style={styles.empty}>
          {filter === 'new' ? 'Nothing waiting.' : 'None.'}
        </ThemedText>
      ) : (
        rows?.map((r) => (
          <Card key={r.id} tone={r.status === 'new' ? undefined : theme.border}>
            <View style={adminStyles.rowBetween}>
              <ThemedText type="labelBold">
                {r.ref} · {r.kind === 'return' ? 'Return' : 'Exchange'}
              </ThemedText>
              <ThemedText
                type="labelBold"
                themeColor={
                  r.status === 'new' ? 'tintText'
                    : r.status === 'rejected' || r.status === 'cancelled' ? 'danger'
                    : 'success'
                }>
                {WORDS[r.status]}
              </ThemedText>
            </View>

            <ThemedText type="label" themeColor="textSecondary">
              {r.customerName || 'no name'} · {r.phone} · order {r.trackId}
            </ThemedText>
            <ThemedText type="caption" themeColor="textSecondary">
              asked {r.createdAt}
              {r.decidedAt ? ` · answered ${r.decidedAt}` : ''}
            </ThemedText>

            {/* The lines. An exchange says what size is wanted instead, which
                is the whole point of the request and the thing the warehouse
                has to pick. */}
            <View style={styles.lines}>
              {r.lines.map((l, i) => (
                <ThemedText key={i} type="label">
                  {l.qty} × {l.name} · {l.size}
                  {l.wantSize ? ` → ${l.wantSize}` : ''}
                  {' · '}
                  {formatPrice(l.price, lang)}
                </ThemedText>
              ))}
            </View>

            {r.reason ? (
              <ThemedText type="label" themeColor="textSecondary" style={styles.reason}>
                “{r.reason}”
              </ThemedText>
            ) : null}
            {r.staffNote ? (
              <ThemedText type="caption" themeColor="danger">
                Note: {r.staffNote}
              </ThemedText>
            ) : null}

            {rejecting?.id === r.id ? (
              <View style={styles.rejectBox}>
                <Field
                  label="Why (the customer is told this)"
                  value={rejecting.note}
                  onChangeText={(v) => setRejecting({ id: r.id, note: v })}
                />
                <View style={adminStyles.rowBetween}>
                  <Pressable
                    accessibilityRole="button"
                    disabled={!rejecting.note.trim()}
                    onPress={() => move(r.id, 'rejected', rejecting.note.trim())}
                    style={press(true, styles.action)}>
                    <ThemedText
                      type="labelBold"
                      themeColor={rejecting.note.trim() ? 'danger' : 'textSecondary'}>
                      Confirm rejection
                    </ThemedText>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => setRejecting(null)}
                    style={press(true, styles.action)}>
                    <ThemedText type="labelBold" themeColor="textSecondary">Cancel</ThemedText>
                  </Pressable>
                </View>
              </View>
            ) : (
              <View style={[adminStyles.rowBetween, styles.actions]}>
                {MOVES.filter((m) => m.to !== r.status).map((m) => (
                  <Pressable
                    key={m.to}
                    accessibilityRole="button"
                    accessibilityLabel={`${m.label} ${r.ref}`}
                    onPress={() =>
                      m.to === 'rejected'
                        ? setRejecting({ id: r.id, note: '' })
                        : move(r.id, m.to)
                    }
                    style={press(true, styles.action)}>
                    <ThemedText
                      type="labelBold"
                      themeColor={m.to === 'rejected' ? 'danger' : 'tintText'}>
                      {m.label}
                    </ThemedText>
                  </Pressable>
                ))}
              </View>
            )}
          </Card>
        ))
      )}
    </AdminShell>
  );
}

const styles = StyleSheet.create({
  filters: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.one, marginBottom: Spacing.two },
  empty: { paddingVertical: Spacing.five, textAlign: 'center' },
  lines: { marginTop: Spacing.one, gap: 2 },
  reason: { marginTop: Spacing.one, fontStyle: 'italic' },
  actions: { marginTop: Spacing.two, flexWrap: 'wrap' },
  action: { minHeight: 44, justifyContent: 'center', paddingHorizontal: Spacing.two },
  rejectBox: { marginTop: Spacing.two, gap: Spacing.one },
});
