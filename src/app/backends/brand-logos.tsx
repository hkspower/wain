import { Image } from 'expo-image';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { AdminShell } from '@/components/admin-shell';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Chip } from '@/components/ui/chip';
import { press } from '@/components/ui/press';
import { Radius, Spacing, TapTarget } from '@/constants/theme';
import { useImageDrop } from '@/lib/use-image-drop';
import { adminApi, Unauthorized, type Brand } from '@/lib/admin';
import { pickImages, pickedName, PermissionDenied, type Picked } from '@/lib/pick-images';
import { useSession } from '@/lib/session';
import { shrinkImage, TooBig } from '@/lib/shrink-image';

/**
 * Brand logos, many at once.
 *
 * WHY A SECOND SCREEN WHEN /backends/brands ALREADY TAKES A LOGO. That form
 * does one brand at a time: open the row, pick a file, save, go back, repeat.
 * For the shop's eight brands — none of which has a logo, measured
 * `brandLogos=0/8` — that is eight round trips through a form whose other four
 * fields you did not come to edit. This screen exists for the job the owner
 * actually has: a folder of logos, and eight brands to put them on.
 *
 * Brands.tsx keeps the naming, the slug, the sort and the hide switch. It is
 * not duplicated here, and this screen never sends a name it did not read back
 * from the server a moment ago.
 *
 * ---------------------------------------------------------------------------
 * ONE LOGO PER BRAND, SO THE QUEUE IS A SLOT PER BRAND, not a list of files.
 * A brand row holds at most one pending picture; dropping a second onto the
 * same brand replaces the first and says so. Modelling it as a list would let
 * two files be queued for one brand and then silently lose one at save time —
 * the server's last write wins and nothing would report which.
 *
 * MATCHING IS BY FILENAME FIRST, and this is most of the value. A folder of
 * logos is almost always named after the brands: `nike.png`, `Under Armour
 * .jpg`, `gymshark-logo.webp`. The name is folded to the same shape as a slug
 * and matched against the slug, the English name and the Arabic name — so the
 * common case is drop twenty files and correct nothing.
 *
 * WHAT HAPPENS TO A FILE THAT MATCHES NOTHING. It fills the next SELECTED
 * brand that has no picture yet, in the order the storefront lists them. That
 * is why the screen has a selection at all: "pick the brands, then drop the
 * files" is a working answer for logos named `1.png`, `2.png`, and it needs no
 * typing. Anything still unplaced is listed by name rather than dropped — a
 * file that quietly went nowhere is the failure this whole screen is here to
 * avoid.
 *
 * NOTHING IS SENT UNTIL Upload IS PRESSED. Every assignment is reversible up
 * to that point, which matters because a wrong logo on a brand is visible on
 * every product card that brand sells.
 */

/** Fold a filename or a name to the shape a slug has: lower case, letters and
 *  digits only, single hyphens. `Under Armour (1).PNG` and `under-armour` meet
 *  here. Extension and any trailing `-logo` / `-icon` are dropped, because
 *  that is how exported files are named and it is not part of anyone's brand. */
function fold(s: string): string {
  return s
    .replace(/\.[a-z0-9]{2,5}$/i, '')
    .toLowerCase()
    .replace(/[^a-z0-9؀-ۿ]+/g, '-')
    .replace(/-(logo|icon|mark|brand|final|copy|[0-9]{1,3})$/g, '')
    .replace(/^-+|-+$/g, '');
}

type Pending = {
  file: Picked;
  name: string;
  /** Filled after shrinking, for the thumbnail and the save. */
  dataUri?: string;
  /** How it got here — shown, because "why is this logo on this brand" is the
   *  question a wrong match produces and the answer should be on screen. */
  how: 'name' | 'order' | 'hand';
  error?: string;
};

export default function BrandLogosScreen() {
  const { signOut } = useSession();
  const [rows, setRows] = useState<Brand[] | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(0);

  /** brand id -> the picture waiting to go on it. */
  const [queue, setQueue] = useState<Record<number, Pending>>({});
  /** Files that matched no brand and had no selected brand left to fill. */
  const [orphans, setOrphans] = useState<string[]>([]);
  const [picked, setPicked] = useState<Set<number>>(new Set());

  const load = useCallback(async () => {
    try {
      setRows(await adminApi.brands());
    } catch (e) {
      if (e instanceof Unauthorized) return signOut();
      setNotice(String(e));
    }
  }, [signOut]);

  useEffect(() => {
    void load();
  }, [load]);

  const brands = rows ?? [];
  const missing = useMemo(() => brands.filter((b) => !b.logo), [brands]);

  /** The brands a file with no name match may land on: selected, and not
   *  already holding one. Order is the storefront's, which is the order the
   *  owner sees on this screen — so "they fill down the list" is what it looks
   *  like as well as what it does. */
  const openSlots = useCallback(
    (q: Record<number, Pending>) => brands.filter((b) => picked.has(b.id) && !q[b.id]),
    [brands, picked],
  );

  /** THE ONE PLACE FILES ENTER, whether from the dialog, a drop or a paste.
   *  Three call sites doing their own matching is three chances for them to
   *  disagree about what a match is. */
  const enqueue = useCallback(
    (files: Picked[]) => {
      if (!files.length) return;
      setNotice(null);
      setQueue((prev) => {
        const next = { ...prev };
        const unplaced: string[] = [];
        let replaced = 0;

        for (const file of files) {
          const name = pickedName(file);
          const key = fold(name);
          const hit =
            brands.find((b) => fold(b.slug) === key) ??
            brands.find((b) => fold(b.name_en) === key) ??
            brands.find((b) => fold(b.name_ar) === key) ??
            // Only after the exact passes: a brand whose folded name is inside
            // the filename, e.g. `sporta-nike-2024.png`. Longest first, so
            // `under-armour` wins over a brand called `armour`.
            [...brands]
              .sort((a, b) => fold(b.slug).length - fold(a.slug).length)
              .find((b) => fold(b.slug).length >= 3 && key.includes(fold(b.slug)));

          if (hit) {
            if (next[hit.id]) replaced++;
            next[hit.id] = { file, name, how: 'name' };
            continue;
          }
          const slot = openSlots(next)[0];
          if (slot) next[slot.id] = { file, name, how: 'order' };
          else unplaced.push(name);
        }

        setOrphans((o) => [...o, ...unplaced]);
        if (replaced) {
          setNotice(
            `${replaced} brand${replaced === 1 ? '' : 's'} already had a picture waiting — the newer file replaced it.`,
          );
        }
        return next;
      });
    },
    [brands, openSlots],
  );

  // Web only, and it returns immediately on a phone. The same hook the product
  // photographs use, so a drop behaves identically on both screens.
  useImageDrop({
    onFiles: (files) => enqueue(files as unknown as Picked[]),
    limit: Math.max(brands.length, 1),
    enabled: !busy && brands.length > 0,
  });

  const choose = async () => {
    setNotice(null);
    try {
      const files = await pickImages(Math.max(brands.length, 1));
      enqueue(files);
    } catch (e) {
      setNotice(
        e instanceof PermissionDenied
          ? 'Sporta needs permission to open your photos. Allow it in your phone’s settings and try again.'
          : String(e),
      );
    }
  };

  const assign = (from: number, to: number) => {
    setQueue((prev) => {
      const item = prev[from];
      if (!item) return prev;
      const next = { ...prev };
      delete next[from];
      next[to] = { ...item, how: 'hand' };
      return next;
    });
  };

  const drop = (id: number) =>
    setQueue((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });

  const queued = Object.entries(queue).map(([id, p]) => [Number(id), p] as const);

  const upload = async () => {
    if (busy || !queued.length) return;
    setBusy(true);
    setNotice(null);
    setDone(0);

    let ok = 0;
    const failed: string[] = [];

    // ONE AT A TIME, on purpose. Each save shrinks an image in the browser and
    // posts up to 900 kB of base64; eight of those in parallel is eight
    // encodes competing for one main thread and eight rows of the same table
    // being written at once. The count moves after each, so a slow upload
    // looks like progress rather than like a hang.
    for (const [id, p] of queued) {
      const brand = brands.find((b) => b.id === id);
      if (!brand) continue;
      try {
        const small = p.dataUri
          ? { dataUri: p.dataUri }
          : await shrinkImage(p.file as File | { uri: string; fileSize?: number });
        await adminApi.saveBrand({
          id: brand.id,
          // The server's brand_save is one route for create and rename, so it
          // wants the whole row. These are read back from the server, not from
          // anything typed here — this screen must never rename a brand as a
          // side effect of putting a picture on it.
          name_en: brand.name_en,
          name_ar: brand.name_ar,
          slug: brand.slug,
          sort: brand.sort,
          logo: small.dataUri,
        });
        ok++;
      } catch (e) {
        if (e instanceof Unauthorized) {
          setBusy(false);
          return signOut();
        }
        failed.push(
          `${brand.name_en}: ` +
            (e instanceof TooBig
              ? 'still too large after shrinking — try a smaller original'
              : String(e).includes('logo_bad_format') || String(e).includes('logo_not_an_image')
                ? 'not a picture the shop accepts (png, jpeg or webp)'
                : String(e)),
        );
      }
      setDone((n) => n + 1);
    }

    setQueue((prev) => {
      // Keep only what failed, so pressing Upload again retries exactly those.
      const next: Record<number, Pending> = {};
      for (const [id, p] of Object.entries(prev)) {
        const brand = brands.find((b) => b.id === Number(id));
        if (brand && failed.some((f) => f.startsWith(`${brand.name_en}: `))) next[Number(id)] = p;
      }
      return next;
    });
    setBusy(false);
    setNotice(
      failed.length
        ? `${ok} uploaded. ${failed.length} did not:\n${failed.join('\n')}`
        : `${ok} logo${ok === 1 ? '' : 's'} uploaded.`,
    );
    await load();
  };

  return (
    <AdminShell title="Brand logos" loading={rows === null}>
      <ScrollView contentContainerStyle={styles.page}>
        {notice ? (
          <Card>
            <ThemedText type="label">{notice}</ThemedText>
          </Card>
        ) : null}

        <Card>
          <ThemedText type="bodyBold">
            {missing.length
              ? `${missing.length} of ${brands.length} brands have no logo`
              : `all ${brands.length} brands have a logo`}
          </ThemedText>
          <ThemedText type="label" themeColor="textSecondary">
            Pick the brands, then choose the pictures. A file named after a brand goes
            to that brand on its own; anything else fills the picked brands in order.
            {Platform.OS === 'web'
              ? ' You can also drag the pictures onto this page, or copy one and press Ctrl-V.'
              : ''}
          </ThemedText>

          <View style={styles.chips}>
            <Chip
              label="Pick all"
              active={picked.size === brands.length && brands.length > 0}
              onPress={() => setPicked(new Set(brands.map((b) => b.id)))}
            />
            <Chip
              label={`Only the ${missing.length} without one`}
              active={picked.size === missing.length && missing.length > 0 &&
                missing.every((b) => picked.has(b.id))}
              onPress={() => setPicked(new Set(missing.map((b) => b.id)))}
            />
            <Chip label="None" active={picked.size === 0} onPress={() => setPicked(new Set())} />
          </View>

          <View style={styles.actions}>
            <Button label="Choose pictures" onPress={choose} variant="secondary" />
            <Button
              label={busy ? `Uploading ${done}/${queued.length}…` : `Upload ${queued.length}`}
              onPress={upload}
              busy={busy}
              disabled={!queued.length}
            />
          </View>
        </Card>

        {orphans.length ? (
          <Card tone="danger">
            <ThemedText type="bodyBold">
              {orphans.length} picture{orphans.length === 1 ? '' : 's'} had nowhere to go
            </ThemedText>
            <ThemedText type="label" themeColor="textSecondary">
              Nothing matched their names and every picked brand already had one. Pick
              more brands and choose them again.
            </ThemedText>
            <ThemedText type="label" selectable>{orphans.join(', ')}</ThemedText>
            <Button label="Clear this list" variant="secondary" onPress={() => setOrphans([])} />
          </Card>
        ) : null}

        {brands.map((b) => {
          const pending = queue[b.id];
          const on = picked.has(b.id);
          return (
            <Card key={b.id} >
              <Pressable
                accessibilityRole="checkbox"
                accessibilityState={{ checked: on }}
                aria-pressed={on}
                onPress={() =>
                  setPicked((prev) => {
                    const next = new Set(prev);
                    if (next.has(b.id)) next.delete(b.id);
                    else next.add(b.id);
                    return next;
                  })
                }
                style={press(false, styles.rowHit)}>
                <View style={styles.row}>
                  <View style={styles.thumb}>
                    {pending?.dataUri || b.logo ? (
                      <Image
                        source={{ uri: pending?.dataUri ?? b.logo ?? '' }}
                        style={styles.img}
                        contentFit="contain"
                      />
                    ) : (
                      <ThemedText type="label" themeColor="textSecondary">
                        —
                      </ThemedText>
                    )}
                  </View>
                  {/* The tick is its OWN element, not a prefix inside the
                      name. Glued together it made the brand's name
                      unaddressable — no test and no screen reader could ask
                      for "Vanquish" and get this row — and it read the state
                      out twice, once as a glyph and once from the role. */}
                  <ThemedText type="bodyBold" themeColor={on ? 'tintText' : 'textSecondary'}>
                    {on ? '☑' : '☐'}
                  </ThemedText>
                  <View style={styles.grow}>
                    <ThemedText type="bodyBold">{b.name_en}</ThemedText>
                    <ThemedText type="label" themeColor="textSecondary">
                      {b.name_ar} · {b.slug}
                      {b.logo ? ' · has a logo' : ' · no logo'}
                    </ThemedText>
                  </View>
                </View>
              </Pressable>

              {pending ? (
                <View style={styles.pending}>
                  <ThemedText type="label">
                    {pending.name}
                    {pending.how === 'name'
                      ? ' — matched by name'
                      : pending.how === 'order'
                        ? ' — filled in order'
                        : ' — moved here by hand'}
                  </ThemedText>
                  <View style={styles.chips}>
                    {brands
                      .filter((o) => o.id !== b.id && !queue[o.id])
                      .slice(0, 8)
                      .map((o) => (
                        <Chip
                          key={o.id}
                          label={`→ ${o.name_en}`}
                          active={false}
                          onPress={() => assign(b.id, o.id)}
                        />
                      ))}
                    <Chip label="Remove" active={false} onPress={() => drop(b.id)} />
                  </View>
                </View>
              ) : null}
            </Card>
          );
        })}
      </ScrollView>
    </AdminShell>
  );
}

const styles = StyleSheet.create({
  page: { padding: Spacing.three, gap: Spacing.three, paddingBottom: Spacing.six },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two, marginTop: Spacing.two },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two, marginTop: Spacing.two },
  rowHit: { minHeight: TapTarget, justifyContent: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  grow: { flex: 1 },
  thumb: {
    width: 56,
    height: 56,
    borderRadius: Radius.button,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  img: { width: '100%', height: '100%' },
  pending: { marginTop: Spacing.two, gap: Spacing.one },
});
