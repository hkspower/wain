import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { AdminShell } from '@/components/admin-shell';
import { ThemedText } from '@/components/themed-text';
import { Card } from '@/components/ui/card';
import { press } from '@/components/ui/press';
import { Spacing, TapTarget } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { adminApi, Unauthorized, type AuditLogRow } from '@/lib/admin';
import { useSession } from '@/lib/session';

/**
 * Every admin write, newest first — the read side of the shutdown hook
 * admin.php registers right after the gate (see store_admin_audit_log()'s
 * own comment in store.php). Nothing here calls anything to make this
 * screen's rows exist; they are a side effect of every save route below the
 * gate, whether or not this file has ever heard of that route by name.
 *
 * A LOG, NOT A TO-DO LIST — the opposite of returns.tsx one screen up. There
 * is nothing to action here, no status to move a row through; this is a
 * record of what already happened, in the order it happened.
 *
 * THE SUMMARY IS ALREADY SAFE TO SHOW. The server redacts password/code/
 * secret-shaped fields at any depth before this ever leaves it — this screen
 * does not need its own list of what to hide, and must not grow one: a
 * second list of sensitive field names here would be a second place that
 * list could go stale.
 */
export default function ActivityScreen() {
  const theme = useTheme();
  const { token, signOut } = useSession();

  const [rows, setRows] = useState<AuditLogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // False once a page came back with fewer than a full page — the server
  // does not say "no more" explicitly, so a short page is what says it.
  const [hasMore, setHasMore] = useState(true);

  const load = useCallback(() => {
    if (!token) return;
    setLoading(true);
    setError(null);
    adminApi
      .auditLog()
      .then((r) => {
        setRows(r.rows);
        setHasMore(r.rows.length >= 100);
      })
      .catch((e) => (e instanceof Unauthorized ? signOut() : setError(String(e))))
      .finally(() => setLoading(false));
  }, [token, signOut]);

  useEffect(load, [load]);

  const loadMore = async () => {
    if (!token || loadingMore || !hasMore || rows.length === 0) return;
    setLoadingMore(true);
    try {
      const r = await adminApi.auditLog(rows[rows.length - 1].id);
      setRows((prev) => [...prev, ...r.rows]);
      setHasMore(r.rows.length >= 100);
    } catch (e) {
      if (e instanceof Unauthorized) signOut();
      else setError(String(e));
    } finally {
      setLoadingMore(false);
    }
  };

  return (
    <AdminShell title="Activity" loading={loading} error={error} onRetry={load}>
      {rows.length === 0 ? (
        <ThemedText type="label" themeColor="textSecondary">
          Nothing logged yet.
        </ThemedText>
      ) : (
        <View style={{ gap: Spacing.two }}>
          {rows.map((row) => (
            <Card key={row.id} style={styles.row}>
              <View style={styles.rowTop}>
                <ThemedText type="labelBold">{row.route}</ThemedText>
                <ThemedText type="caption" themeColor="textSecondary">
                  {row.createdAt}
                </ThemedText>
              </View>
              <ThemedText type="caption" themeColor="textSecondary">
                {row.adminEmail}
              </ThemedText>
              {row.summary && (
                <ThemedText type="caption" themeColor="textSecondary" selectable>
                  {Object.entries(row.summary)
                    .map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
                    .join('  ·  ')}
                </ThemedText>
              )}
            </Card>
          ))}
          {hasMore && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Load older activity"
              onPress={loadMore}
              style={press(true, [styles.more, { borderColor: theme.controlBorder }])}>
              <ThemedText type="labelBold" themeColor="tintText">
                {loadingMore ? 'Loading…' : 'Load older'}
              </ThemedText>
            </Pressable>
          )}
        </View>
      )}
    </AdminShell>
  );
}

const styles = StyleSheet.create({
  row: { gap: Spacing.half },
  rowTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  more: {
    minHeight: TapTarget,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 12,
  },
});
