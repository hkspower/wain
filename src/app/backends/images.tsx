import { Image } from 'expo-image';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { AdminShell } from '@/components/admin-shell';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Chip } from '@/components/ui/chip';
import { Field } from '@/components/ui/field';
import { press } from '@/components/ui/press';
import { Radius, Spacing, TapTarget } from '@/constants/theme';
import {
  adminApi,
  Unauthorized,
  type ProductImage,
  type UploadTarget,
} from '@/lib/admin';
import { pickImages, pickedName, PermissionDenied, type Picked } from '@/lib/pick-images';
import { useSession } from '@/lib/session';
import { MAX_PHOTOS, shrinkImage, TooBig } from '@/lib/shrink-image';

/**
 * Put photographs on a garment: choose several at once, find the garment by
 * brand, then size, then the code on its label, and upload.
 *
 * WHY THE SKU IS A FINDER AND NOT A DESTINATION. product_images has a slug
 * column and no size column — one shoot covers every size of a garment, which
 * is right, because a photograph of a t-shirt is a photograph of that t-shirt.
 * So the sku narrows to a PRODUCT and the screen says which product, in words,
 * before anything is uploaded. Without that line someone picks A-VTS-WH-L and
 * reasonably believes they have given the Large its own picture.
 *
 * WHY THE THREE STEPS, rather than one long list. There are 46 garments and
 * over 300 variants; a single scrolling picker is unusable on a phone, which
 * is where the panel is used. Brand cuts it to a handful, size cuts it again,
 * and the search box is there for whoever already knows the name.
 *
 * UPLOADS RUN ONE AT A TIME, ON PURPOSE. Each one is up to 900 kB of base64
 * inside a transaction that takes `for update` on the garment's rows to count
 * them against the cap; firing eight in parallel means eight PHP workers on
 * shared hosting queueing on the same lock, and the failure looks like the
 * panel hanging. Sequential is slower to watch and faster to finish.
 */

type Row = { picked: Picked; name: string; state: 'waiting' | 'working' | 'done' | 'failed'; note?: string };

export default function ImagesScreen() {
  const { token, signOut } = useSession();

  const [targets, setTargets] = useState<UploadTarget[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [brand, setBrand] = useState<string | null>(null);
  const [size, setSize] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [sku, setSku] = useState<string | null>(null);

  const [gallery, setGallery] = useState<ProductImage[] | null>(null);
  const [queue, setQueue] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  // Which photograph is one tap from being deleted. Null the moment the
  // gallery changes, so a confirm cannot survive into a different picture.
  const [confirm, setConfirm] = useState<number | null>(null);

  const load = useCallback(() => {
    if (!token) return;
    setLoading(true);
    setError(null);
    adminApi
      .uploadTargets()
      .then(setTargets)
      .catch((e) => (e instanceof Unauthorized ? signOut() : setError(String(e))))
      .finally(() => setLoading(false));
  }, [token, signOut]);

  useEffect(load, [load]);

  const chosen = useMemo(
    () => targets?.find((t) => t.sku === sku) ?? null,
    [targets, sku],
  );

  // The gallery is the CHOSEN GARMENT'S, and it is reloaded whenever the
  // product changes rather than the sku — two sizes of one garment share it,
  // and refetching when the owner switches from L to XL would flicker for
  // nothing.
  const slug = chosen?.slug ?? null;
  useEffect(() => {
    setConfirm(null);
    if (!slug) { setGallery(null); return; }
    let alive = true;
    adminApi
      .productImages(slug)
      .then((g) => alive && setGallery(g))
      .catch((e) => alive && (e instanceof Unauthorized ? signOut() : setError(String(e))));
    return () => { alive = false; };
  }, [slug, signOut]);

  const brands = useMemo(() => {
    const seen = new Set<string>();
    for (const t of targets ?? []) if (t.brandSlug) seen.add(t.brandSlug);
    return [...seen].sort();
  }, [targets]);

  // Sizes are shown in the shop's own order, not alphabetically — S, M, L,
  // XL… is the order on every other screen and on the garment's own label, and
  // "2XL, 3XL, L, M, S" reads as a bug.
  const SIZE_ORDER = ['S', 'M', 'L', 'XL', '2XL', '3XL', '4XL', '5XL'];
  const sizes = useMemo(() => {
    const seen = new Set<string>();
    for (const t of targets ?? []) {
      if (brand && t.brandSlug !== brand) continue;
      seen.add(t.size);
    }
    return [...seen].sort((a, b) => {
      const ia = SIZE_ORDER.indexOf(a), ib = SIZE_ORDER.indexOf(b);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
    });
  }, [targets, brand]);

  const matches = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (targets ?? [])
      .filter((t) => (!brand || t.brandSlug === brand))
      .filter((t) => (!size || t.size === size))
      .filter((t) => !q || t.sku.toLowerCase().includes(q) || t.name.toLowerCase().includes(q))
      .slice(0, 60);
  }, [targets, brand, size, search]);

  const remaining = MAX_PHOTOS - (gallery?.length ?? 0);

  const choose = async () => {
    if (!chosen || busy) return;
    setNotice(null);
    try {
      const picked = await pickImages(remaining - queue.filter((r) => r.state !== 'failed').length);
      if (!picked.length) return;
      setQueue((q) => [...q, ...picked.map((p) => ({ picked: p, name: pickedName(p), state: 'waiting' as const }))]);
    } catch (e) {
      setNotice(e instanceof PermissionDenied
        ? 'Sporta needs permission to open your photos. Allow it in your phone’s settings and try again.'
        : String(e));
    }
  };

  const upload = async () => {
    if (!chosen || busy) return;
    setBusy(true);
    setNotice(null);
    // A COPY OF THE LIST, walked by index. Reading `queue` inside the loop
    // would read the state as it was when the loop started, and setQueue below
    // is what moves each row along — so the loop drives the work and the state
    // only records it.
    const work = queue.map((r, i) => ({ r, i })).filter(({ r }) => r.state === 'waiting' || r.state === 'failed');
    let ok = 0;
    for (const { r, i } of work) {
      setQueue((q) => q.map((row, j) => (j === i ? { ...row, state: 'working', note: undefined } : row)));
      try {
        const small = await shrinkImage(r.picked);
        await adminApi.addProductImage(chosen.slug, small.dataUri, small.width, small.height);
        ok++;
        setQueue((q) => q.map((row, j) => (j === i ? { ...row, state: 'done' } : row)));
      } catch (e) {
        if (e instanceof Unauthorized) { setBusy(false); return signOut(); }
        // EVERY FAILURE IS THE ROW'S, not the batch's. One photograph the
        // server refuses must not throw away the nine that would have worked,
        // and the row keeps its file so "Upload" retries just that one.
        const msg =
          e instanceof TooBig ? 'too large even after shrinking — try a smaller original'
          : String(e).includes('too_many_images') ? `this garment already has ${MAX_PHOTOS} photographs`
          : String(e).includes('product_not_found') ? 'that product no longer exists'
          : String(e).includes('logo_bad_format') || String(e).includes('logo_not_an_image')
            ? 'not an image the shop accepts (png, jpeg or webp)'
          : String(e);
        setQueue((q) => q.map((row, j) => (j === i ? { ...row, state: 'failed', note: msg } : row)));
      }
    }
    setBusy(false);
    if (ok) {
      setNotice(`${ok} photograph${ok === 1 ? '' : 's'} added to ${chosen.name}.`);
      setGallery(await adminApi.productImages(chosen.slug).catch(() => gallery));
      // Only the finished rows go. A failed one stays so it can be retried or
      // read; clearing the lot would hide which of twenty was refused.
      setQueue((q) => q.filter((r) => r.state !== 'done'));
    }
  };

  const remove = async (id: number) => {
    if (!chosen || busy) return;
    setBusy(true);
    try {
      await adminApi.deleteProductImage(id);
      setConfirm(null);
      setGallery(await adminApi.productImages(chosen.slug));
      setNotice('Photograph removed.');
    } catch (e) {
      if (e instanceof Unauthorized) return signOut();
      setNotice(String(e));
    } finally {
      setBusy(false);
    }
  };

  // Moving one photograph to the front is the only reorder that earns its
  // keep: the FIRST is the product's main image — the one on the shop grid —
  // and "this is the one to lead with" is the whole of what an owner wants to
  // say about the order. Drag-and-drop of a 24-item grid on a phone is not.
  const makeMain = async (id: number) => {
    if (!chosen || !gallery || busy) return;
    setBusy(true);
    try {
      await adminApi.reorderProductImages(chosen.slug, [id, ...gallery.filter((g) => g.id !== id).map((g) => g.id)]);
      setGallery(await adminApi.productImages(chosen.slug));
      setNotice('That is now the main photograph.');
    } catch (e) {
      if (e instanceof Unauthorized) return signOut();
      setNotice(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AdminShell title="Photographs" loading={loading} error={error} onRetry={load}>
      {/* ---- 1. find the garment ---- */}
      <Card style={styles.card}>
        <ThemedText type="heading">Which garment</ThemedText>

        <ThemedText type="caption" themeColor="textSecondary" style={styles.hint}>Brand</ThemedText>
        <View style={styles.chips}>
          <Chip label="All" active={brand === null} onPress={() => { setBrand(null); setSku(null); }} />
          {brands.map((b) => (
            <Chip key={b} label={b} active={brand === b} onPress={() => { setBrand(b); setSku(null); }} />
          ))}
        </View>
        {brands.length === 0 && targets && (
          <ThemedText type="caption" themeColor="textSecondary" style={styles.hint}>
            No garment has a brand set yet — set one in Products, or use the search below.
          </ThemedText>
        )}

        <ThemedText type="caption" themeColor="textSecondary" style={styles.hint}>Size</ThemedText>
        <View style={styles.chips}>
          <Chip label="Any" active={size === null} onPress={() => { setSize(null); setSku(null); }} />
          {sizes.map((s) => (
            <Chip key={s} label={s} active={size === s} onPress={() => { setSize(s); setSku(null); }} />
          ))}
        </View>

        {/* WRAPPED, and the wrapper is the point. Field carries `flex: 1` so
            that it fills a row when it sits beside another one — right there,
            wrong here: inside this column card it grew to take the leftover
            height and drew itself over the line beneath it. Seen on screen,
            not reasoned about. A plain View sizes to its content and stops the
            flex escaping, which is a smaller change than editing a component
            every other screen already relies on. */}
        <View>
          <Field
            label="Search by name or the code on the label"
            value={search}
            onChangeText={(v) => { setSearch(v); setSku(null); }}
            autoCapitalize="none"
          />
        </View>

        <ThemedText type="caption" themeColor="textSecondary" style={styles.hint}>
          {matches.length === 0 ? 'Nothing matches those filters.'
            : `${matches.length}${matches.length === 60 ? '+' : ''} matching — choose one`}
        </ThemedText>
        <ScrollView style={styles.list} nestedScrollEnabled>
          {matches.map((t) => (
            <Pressable
              key={t.sku}
              accessibilityRole="button"
              accessibilityState={{ selected: sku === t.sku }}
              onPress={() => setSku(t.sku)}
              style={press(false, [styles.rowItem, sku === t.sku && styles.rowItemOn])}>
              <ThemedText type="labelBold">{t.sku}</ThemedText>
              <ThemedText type="caption" themeColor="textSecondary">
                {t.name} · {t.size}
              </ThemedText>
            </Pressable>
          ))}
        </ScrollView>
      </Card>

      {/* ---- 2. what that means ---- */}
      {chosen && (
        <Card style={styles.card}>
          <ThemedText type="heading">{chosen.name}</ThemedText>
          {/* THE SENTENCE THAT STOPS A MISUNDERSTANDING. Said before anything
              is uploaded, not after. */}
          <ThemedText type="caption" themeColor="textSecondary" style={styles.hint}>
            You picked {chosen.sku} ({chosen.size}). Photographs belong to the whole garment,
            so these will show for every size — not just {chosen.size}.
          </ThemedText>
          <ThemedText type="label" themeColor="textSecondary">
            {gallery === null ? 'Loading its photographs…'
              : `${gallery.length} of ${MAX_PHOTOS} used · room for ${remaining} more`}
          </ThemedText>

          <View style={styles.chips}>
            <Button
              label={remaining > 0 ? 'Choose photographs' : 'No room for more'}
              onPress={choose}
              disabled={remaining <= 0 || busy}
              variant="secondary"
            />
            {queue.length > 0 && (
              <Button
                label={busy ? 'Uploading…' : `Upload ${queue.filter((r) => r.state !== 'done').length}`}
                onPress={upload}
                busy={busy}
              />
            )}
          </View>

          {notice && (
            <ThemedText type="label" themeColor="textSecondary" style={styles.note}>{notice}</ThemedText>
          )}

          {queue.map((r, i) => (
            <View key={`${r.name}-${i}`} style={styles.queueRow}>
              <ThemedText type="label" numberOfLines={1} style={styles.queueName}>{r.name}</ThemedText>
              <ThemedText
                type="caption"
                themeColor={r.state === 'failed' ? 'danger' : r.state === 'done' ? 'success' : 'textSecondary'}>
                {r.state === 'waiting' ? 'waiting'
                  : r.state === 'working' ? 'shrinking…'
                  : r.state === 'done' ? (r.note ?? 'added')
                  : (r.note ?? 'failed')}
              </ThemedText>
            </View>
          ))}
        </Card>
      )}

      {/* ---- 3. what it already has ---- */}
      {chosen && gallery !== null && gallery.length > 0 && (
        <Card style={styles.card}>
          <ThemedText type="heading">On this garment</ThemedText>
          <ThemedText type="caption" themeColor="textSecondary" style={styles.hint}>
            The first is the one on the shop grid.
          </ThemedText>
          <View style={styles.grid}>
            {gallery.map((g, i) => (
              <View key={g.id} style={styles.tile}>
                <Image source={{ uri: g.url }} style={styles.thumb} contentFit="cover" transition={120} />
                {i === 0 && (
                  <ThemedText type="caption" themeColor="tint" style={styles.mainTag}>main</ThemedText>
                )}
                <View style={styles.tileActions}>
                  {/* ALWAYS RENDERED, even on the first tile where it does
                      nothing. The row used to omit it there, so tile one's
                      Remove sat at a different height from every other
                      tile's — and on a grid that is read by position, the
                      destructive control moving between cells is the worst
                      possible thing to be ragged. Disabled and dimmed
                      instead: the layout is the same in every cell and the
                      first tile says why it is already the main one. */}
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={i === 0 ? 'already the main photograph' : `make photograph ${i + 1} the main one`}
                    accessibilityState={{ disabled: i === 0 || busy }}
                    disabled={i === 0 || busy}
                    onPress={() => makeMain(g.id)}
                    style={press(false, styles.tileAction, i === 0 && styles.tileActionOff)}>
                    <ThemedText type="caption" themeColor={i === 0 ? 'textSecondary' : 'tint'}>
                      {i === 0 ? 'Main photo' : 'Make main'}
                    </ThemedText>
                  </Pressable>
                  {/* TWO TAPS TO DELETE, and the gap above is the other half.
                      This was a 22pt-tall text link sitting two points under
                      another one — under even the 24pt WCAG 2.5.8 floor, let
                      alone the 44 a thumb wants — and it destroys a
                      photograph immediately, with no undo. A thumb aiming at
                      "Make main" landed on it.
                      A confirm step rather than a dialog: the panel has no
                      modal, an alert() is not a thing React Native Web can be
                      trusted with on a phone, and "tap again to be sure" is
                      the pattern a one-handed owner can back out of by
                      tapping anywhere else. */}
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={confirm === g.id
                      ? `confirm removing photograph ${i + 1}`
                      : `remove photograph ${i + 1}`}
                    disabled={busy}
                    onPress={() => (confirm === g.id ? remove(g.id) : setConfirm(g.id))}
                    style={press(false, styles.tileAction)}>
                    <ThemedText type="caption" themeColor="danger">
                      {confirm === g.id ? 'Tap to confirm' : 'Remove'}
                    </ThemedText>
                  </Pressable>
                </View>
              </View>
            ))}
          </View>
        </Card>
      )}
    </AdminShell>
  );
}

const styles = StyleSheet.create({
  card: { marginBottom: Spacing.four, gap: Spacing.two },
  hint: { marginTop: Spacing.one },
  note: { marginVertical: Spacing.one },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  list: { maxHeight: 260 },
  rowItem: { paddingVertical: Spacing.two, paddingHorizontal: Spacing.two, borderRadius: Radius.button },
  rowItemOn: { backgroundColor: 'rgba(224,86,28,0.14)' },
  queueRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, paddingVertical: Spacing.one },
  queueName: { flex: 1 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  // FILLS THE WIDTH INSTEAD OF SITTING AT 104pt.
  //
  // A fixed 104 put two tiles in a 358pt card and left 142pt — forty per
  // cent of the phone's width — empty down the right-hand side, while the
  // thumbnails themselves were too small to judge a photograph by, which
  // is the entire job of this grid.
  //
  // flexBasis with flexGrow rather than a breakpoint: 150 means two per
  // row on any phone and they grow to share whatever is left, three or
  // four per row on a tablet or desktop, and nothing to keep in step with
  // a media query. The same trick the Today screen's tiles already use.
  tile: { flexGrow: 1, flexBasis: 150, gap: Spacing.one },
  // 4:5 PORTRAIT, because that is what the shop grid crops to. A square
  // thumbnail here showed the owner a picture the storefront would never
  // display, so a photograph that looked fine when uploaded lost its head
  // or its feet on the grid. Now the tile IS the crop.
  thumb: { width: '100%', aspectRatio: 4 / 5, borderRadius: Radius.button, backgroundColor: 'rgba(127,127,127,0.15)' },
  mainTag: { position: 'absolute', top: 4, insetInlineStart: 6 },
  tileActions: { gap: Spacing.one },
  // A REAL TAP TARGET under each thumbnail. These were 22pt-tall pieces
  // of caption text two points apart, one of which deletes a photograph
  // for good.
  tileAction: { minHeight: TapTarget, justifyContent: 'center' },
  tileActionOff: { opacity: 0.45 },
});
