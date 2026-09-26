import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Image } from 'expo-image';
import { ActivityIndicator, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { AdminShell } from '@/components/admin-shell';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Chip } from '@/components/ui/chip';
import { Field } from '@/components/ui/field';
import { press } from '@/components/ui/press';
import { Radius, Spacing, TapTarget } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import {
  adminApi,
  Unauthorized,
  type Brand,
  type Product,
  type ProductVariant,
} from '@/lib/admin';
import { filsToInput, formatPrice, normaliseDigits, parseAmount, parseCount } from '@/lib/money';
import { useSession } from '@/lib/session';

/**
 * The product editor and its inventory — the one piece stock.tsx and
 * images.tsx did not cover between them.
 *
 * WHAT ALREADY EXISTED. stock.tsx moves the STOCK on a size that already
 * exists; it has no way to give a new garment its first size, remove one, or
 * touch the garment's own name, price or description — those are
 * product_save, variant_save and variant_delete, all live in admin.php since
 * this project's "make full dynamic" work, and none of them reachable from
 * the app before this screen. images.tsx is the photograph uploader and stays
 * exactly as it is; this screen links to it rather than rebuilding any part
 * of it, per the standing rule against duplicating work already done — it
 * even preselects the garment there, see images.tsx's own note on the
 * `slug` param this screen passes.
 *
 * ONE FORM FOR ADD AND EDIT, the same shape brands.tsx already uses: the
 * server is one route (product_save) and the only difference is whether an
 * id came with it.
 *
 * THE SLUG IS EDITABLE AND MATTERS. product_save's own comment says a rename
 * carries the garment's photographs and size ladder with it, in one
 * transaction — that is the server's guarantee, not something re-implemented
 * here. A NEW product's slug is suggested from its English name (kebab-case,
 * client-side) the moment a name is typed, but only until the slug field is
 * touched by hand — after that the suggestion stops overwriting a
 * deliberate choice. Unlike brand_save, product_save does NOT derive a slug
 * from the name itself when none is sent, so this screen must always send
 * one — checked by requiring it non-empty before saving, same as the name.
 *
 * SIZES ARE A SUBSET THE SERVER OWNS, not a free list. variant_save checks
 * every size against ?r=rules' `allowed.sizes` — the same CHECK constraint
 * order_items enforces — so this screen only ever offers sizes that list
 * contains, the same argument rules.tsx already makes for its own pickers.
 *
 * DELETING A SIZE WITH STOCK ON IT ASKS FIRST. The server refuses outright
 * unless `force` is sent — variant_delete's own comment: a deleted row that
 * held stock is indistinguishable afterwards from that stock having sold —
 * so a tap here shows what it is about to discard rather than passing force
 * straight through.
 *
 * CATEGORY CARRIES A POLICY, and this screen used to be a bare free-text
 * box for it. `store_return_lookup()` decides whether a garment may be
 * exchanged from `category === 'women'`, exact string, case-sensitive
 * — checked in api/store.php — and `store_size_chart_for()` picks the
 * size chart the same way. A free-text field with no dropdown meant an
 * owner typing "Women", "women " or "womens" saved perfectly and broke
 * both silently: no error, no warning, and the product page would just
 * answer with the wrong chart and the wrong exchange rule. There is no
 * server route that lists categories (research.php's research_categories()
 * is private to that file), so this screen derives the list itself from
 * the products already loaded — the same "read what the shop already
 * uses" rule research.php documents for its own picker, applied without
 * needing a new endpoint. A category typed by hand is still allowed (a
 * shop's first "outerwear" has to come from somewhere), and is trimmed and
 * lowercased before it is sent, because every category in the database is
 * lowercase and the one comparison that matters is exact and
 * case-sensitive.
 */
export default function ProductsScreen() {
  const router = useRouter();
  const { signOut } = useSession();
  const [products, setProducts] = useState<Product[] | null>(null);
  const [brands, setBrands] = useState<Brand[] | null>(null);
  const [allowedSizes, setAllowedSizes] = useState<string[] | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  const [draft, setDraft] = useState<{
    id?: number;
    slug: string;
    slugTouched: boolean;
    name_en: string;
    name_ar: string;
    desc_en: string;
    desc_ar: string;
    price: string;
    salePrice: string;
    category: string;
    brandSlug: string | null;
    active: boolean;
  } | null>(null);

  const load = useCallback(async () => {
    try {
      const [ps, bs, rules] = await Promise.all([
        adminApi.products(),
        adminApi.brands(),
        adminApi.rules(),
      ]);
      setProducts(ps);
      setBrands(bs);
      setAllowedSizes(rules.allowed.sizes);
    } catch (e) {
      if (e instanceof Unauthorized) return signOut();
      setNotice(String(e));
    }
  }, [signOut]);

  useEffect(() => {
    void load();
  }, [load]);

  const blank = () =>
    setDraft({
      slug: '', slugTouched: false, name_en: '', name_ar: '', desc_en: '', desc_ar: '',
      price: '', salePrice: '', category: '', brandSlug: null, active: true,
    });

  const edit = (p: Product) =>
    setDraft({
      id: p.id,
      slug: p.slug,
      // An EXISTING slug counts as touched — the suggestion is only for a
      // brand-new product, never a silent rewrite of a garment's address the
      // moment its name is edited.
      slugTouched: true,
      name_en: p.name_en,
      name_ar: p.name_ar,
      desc_en: p.desc_en,
      desc_ar: p.desc_ar,
      price: filsToInput(p.price),
      salePrice: p.salePrice != null ? filsToInput(p.salePrice) : '',
      category: p.category ?? '',
      brandSlug: p.brandSlug,
      active: !!p.active,
    });

  const slugify = (s: string) =>
    s.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

  const setName = (v: string) =>
    setDraft((d) => d && ({
      ...d,
      name_en: v,
      slug: d.slugTouched ? d.slug : slugify(v),
    }));

  // The categories this shop already uses, derived from the products already
  // on screen rather than a new server route — the same reasoning
  // research.php's own research_categories() gives for reading them out of
  // the database instead of a hardcoded list, applied here without needing
  // an endpoint of its own.
  const categories = Array.from(
    new Set((products ?? []).map((p) => p.category).filter((c): c is string => !!c)),
  ).sort();

  const save = async () => {
    if (!draft || busy) return;
    if (!draft.name_en.trim()) return setNotice('The English name is required.');
    if (!draft.name_ar.trim()) return setNotice('The Arabic name is required.');
    if (!draft.slug.trim()) return setNotice('An address (slug) is required.');
    // parseAmount, NOT Number(). It returns integer fils or null, and it
    // refuses rather than rounds: `Number('1.2345')` was accepted and then
    // became 1.235 KWD at toFils, a price the owner never typed and would only
    // find by looking. It also reads Arabic-Indic digits, which nothing in
    // this app could do — formatPrice has always WRITTEN them.
    const price = parseAmount(draft.price);
    if (price === null || price <= 0) {
      return setNotice('The price must be an amount in KWD, like 12.500.');
    }
    let salePrice: number | null = null;
    if (draft.salePrice.trim()) {
      salePrice = parseAmount(draft.salePrice);
      if (salePrice === null || salePrice <= 0) {
        return setNotice('The sale price must be an amount in KWD, like 9.750.');
      }
      if (salePrice >= price) return setNotice('The sale price must be lower than the price.');
    }

    setBusy(true);
    setNotice(null);
    try {
      const saved = await adminApi.saveProduct({
        id: draft.id,
        slug: draft.slug.trim(),
        name_en: draft.name_en.trim(),
        name_ar: draft.name_ar.trim(),
        desc_en: draft.desc_en,
        desc_ar: draft.desc_ar,
        // Already fils — parseAmount converted once, on the way in.
        price,
        salePrice,
        // Trimmed AND lowercased: every category in the database is
        // lowercase, and `category === 'women'` in api/store.php is an
        // exact, case-sensitive comparison. Normalising here is what stops
        // "Women" or "women " from saving as a category that looks right in
        // this list and never matches the one comparison that decides the
        // exchange policy and the size chart.
        category: draft.category.trim().toLowerCase() || null,
        brandSlug: draft.brandSlug,
        active: draft.active,
      });
      setDraft(null);
      setNotice(draft.id ? `${saved.name_en} updated.` : `${saved.name_en} added.`);
      await load();
    } catch (e) {
      if (e instanceof Unauthorized) return signOut();
      setNotice(
        String(e).includes('slug_taken')
          ? 'another product already uses that address — give this one a different slug'
          : String(e).includes('invalid_slug')
            ? 'that slug has no letters or digits in it'
            : String(e).includes('unknown_brand')
              ? 'that brand no longer exists — pick another'
              : String(e),
      );
    } finally {
      setBusy(false);
    }
  };

  const toggle = async (p: Product) => {
    setNotice(null);
    try {
      await adminApi.setProductActive(p.id, !p.active);
      await load();
    } catch (e) {
      if (e instanceof Unauthorized) return signOut();
      setNotice(String(e));
    }
  };

  return (
    <AdminShell title="Products" loading={products === null}>
      {/* A View, NOT A SCROLLVIEW. AdminShell already scrolls, and this was a
          second vertical ScrollView inside it — two of them competing for the
          same drag, which is why a flick sometimes moved nothing. It also
          carried its own 16pt padding on top of the shell's, so this one
          screen sat 32pt in from each edge while every other screen sat 16:
          on a 390pt phone that is 326pt of usable width against 358. */}
      <View style={styles.page}>
        {notice ? (
          <Card>
            <ThemedText type="label">{notice}</ThemedText>
          </Card>
        ) : null}

        {draft ? (
          <Card>
            <ThemedText type="bodyBold">
              {draft.id ? 'Edit product' : 'New product'}
            </ThemedText>

            <Field label="Name (English)" value={draft.name_en} onChangeText={setName} />
            <Field
              label="الاسم بالعربية"
              value={draft.name_ar}
              onChangeText={(v) => setDraft(draft && { ...draft, name_ar: v })}
            />
            <Field
              label="Address in links (slug)"
              value={draft.slug}
              autoCapitalize="none"
              onChangeText={(v) => setDraft(draft && { ...draft, slug: v, slugTouched: true })}
            />
            <Field
              label="Description (English)"
              value={draft.desc_en}
              multiline
              onChangeText={(v) => setDraft(draft && { ...draft, desc_en: v })}
            />
            <Field
              label="الوصف بالعربية"
              value={draft.desc_ar}
              multiline
              onChangeText={(v) => setDraft(draft && { ...draft, desc_ar: v })}
            />
            <Field
              label="Price (KWD)"
              value={draft.price}
              keyboardType="decimal-pad"
              selectTextOnFocus
              onChangeText={(v) => setDraft(draft && { ...draft, price: v })}
            />
            <Field
              label="Sale price (KWD) — leave empty for no sale"
              value={draft.salePrice}
              keyboardType="decimal-pad"
              selectTextOnFocus
              onChangeText={(v) => setDraft(draft && { ...draft, salePrice: v })}
            />
            <Field
              label="Category"
              value={draft.category}
              autoCapitalize="none"
              onChangeText={(v) => setDraft(draft && { ...draft, category: v })}
            />
            {categories.length > 0 && (
              <>
                <ThemedText type="caption" themeColor="textSecondary" style={styles.hint}>
                  Already used on this shop — tap to reuse one exactly
                </ThemedText>
                <View style={styles.chips}>
                  {categories.map((c) => (
                    <Chip
                      key={c}
                      label={c}
                      active={draft.category.trim().toLowerCase() === c}
                      onPress={() => setDraft(draft && { ...draft, category: c })}
                    />
                  ))}
                </View>
              </>
            )}
            <ThemedText type="caption" themeColor="textSecondary" style={styles.hint}>
              The category decides whether this product can be exchanged
              (only "women" is, exactly) and which size chart it uses — check
              it before saving.
            </ThemedText>

            <ThemedText type="caption" themeColor="textSecondary" style={styles.hint}>Brand</ThemedText>
            <View style={styles.chips}>
              <Chip
                label="No brand"
                active={draft.brandSlug === null}
                onPress={() => setDraft(draft && { ...draft, brandSlug: null })}
              />
              {(brands ?? []).map((b) => (
                <Chip
                  key={b.id}
                  label={b.name_en}
                  active={draft.brandSlug === b.slug}
                  onPress={() => setDraft(draft && { ...draft, brandSlug: b.slug })}
                />
              ))}
            </View>

            <ThemedText type="caption" themeColor="textSecondary" style={styles.hint}>Shown on the shop</ThemedText>
            <View style={styles.chips}>
              <Chip
                label={draft.active ? 'Shown' : 'Hidden'}
                active={draft.active}
                onPress={() => setDraft(draft && { ...draft, active: !draft.active })}
              />
            </View>

            <View style={styles.actions}>
              <Button label={busy ? 'Saving…' : 'Save'} onPress={save} disabled={busy} />
              <Button
                label="Cancel"
                variant="secondary"
                disabled={busy}
                onPress={() => { setDraft(null); setNotice(null); }}
              />
            </View>
          </Card>
        ) : (
          <Button label="Add a product" onPress={blank} />
        )}

        {(products ?? []).map((p) => (
          <Card key={p.id}>
            <View style={styles.row}>
              {/* THE GARMENT'S OWN PHOTOGRAPH, at 4:5 — the crop the shop's
                  grid uses, so what the owner judges here is what a shopper
                  sees. `thumb` is a url at w=96, not a data URI: forty-six of
                  those in one response is megabytes to draw pictures this
                  size. 46 of 46 products are currently null, which is what the
                  empty frame is for — it says "no photograph" rather than
                  leaving the row looking like it failed to load. */}
              {p.thumb ? (
                <Image
                  source={{ uri: p.thumb }}
                  style={styles.rowThumb}
                  contentFit="cover"
                  transition={120}
                  recyclingKey={String(p.id)}
                  accessibilityLabel={`Photograph of ${p.name_en}`}
                />
              ) : (
                <View style={[styles.rowThumb, styles.rowThumbNone]}>
                  <ThemedText type="caption" themeColor="textSecondary">—</ThemedText>
                </View>
              )}
              <View style={styles.rowText}>
                {/* labelBold over bodyBold, caption under label: this is a list
                    of forty-six rows that is scrolled rather than read, and the
                    name is the only thing on it anybody scans for. The smaller
                    scale fits the two names, the address and the price in the
                    height the photograph already takes. */}
                <ThemedText type="labelBold" numberOfLines={1}>{p.name_en}</ThemedText>
                <ThemedText type="caption" numberOfLines={1}>{p.name_ar}</ThemedText>
                <ThemedText type="caption" themeColor="textSecondary" numberOfLines={1}>/{p.slug}</ThemedText>
                <ThemedText type="caption" themeColor="textSecondary" numberOfLines={1}>
                  {formatPrice(p.price, 'en')}
                  {p.salePrice != null ? ` · sale ${formatPrice(p.salePrice, 'en')}` : ''}
                  {p.category ? ` · ${p.category}` : ''}
                </ThemedText>
              </View>
            </View>
            {/* ONE BUTTON, not four. Edit stays the emphasised action — the
                same weight brands.tsx gives its own single "Edit" — and the
                other three move to chips: on a list of forty-six garments,
                four full-size buttons wrapped into two rows per card (measured
                at 375px), which is a lot of card to scroll past to reach the
                next garment. Chips are the same tap target height but narrower
                per label, so all three now sit on one row beside Edit on most
                phones instead of wrapping. */}
            <View style={styles.actions}>
              <Button label="Edit" onPress={() => edit(p)} />
              <Chip
                label="Photographs"
                active={false}
                onPress={() => router.push({ pathname: '/backends/images', params: { slug: p.slug } })}
              />
              <Chip
                label={expanded === p.slug ? 'Hide sizes' : 'Sizes & stock'}
                active={expanded === p.slug}
                onPress={() => setExpanded(expanded === p.slug ? null : p.slug)}
              />
              <Chip label={p.active ? 'Shown' : 'Hidden'} active={!!p.active} onPress={() => toggle(p)} />
            </View>

            {expanded === p.slug && allowedSizes && (
              <VariantLadder slug={p.slug} allowedSizes={allowedSizes} onUnauthorized={signOut} />
            )}
          </Card>
        ))}
      </View>
    </AdminShell>
  );
}

/**
 * One garment's size ladder, self-contained: it fetches its own rows on
 * mount and manages its own draft, the same shape stock.tsx already uses for
 * the identical reason — a row being edited, the value typed, and whether a
 * save is in flight, kept as one map so two rows can never both think they
 * are the one being saved.
 */
function VariantLadder({
  slug,
  allowedSizes,
  onUnauthorized,
}: {
  slug: string;
  allowedSizes: string[];
  onUnauthorized: () => void;
}) {
  const theme = useTheme();
  const [rows, setRows] = useState<ProductVariant[] | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, { stock: string; cost: string }>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const load = useCallback(() => {
    adminApi
      .productVariants(slug)
      .then(setRows)
      .catch((e) => (e instanceof Unauthorized ? onUnauthorized() : setNotice(String(e))));
  }, [slug, onUnauthorized]);

  useEffect(load, [load]);

  // Sizes in the shop's own order, not alphabetically — 2XL before 3XL, and
  // both after L, which is the order every other screen and the garment's
  // own label use.
  const ORDER = ['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL', '4XL', '5XL', 'ONE'];
  const bySize = (a: string, b: string) => {
    const ia = ORDER.indexOf(a), ib = ORDER.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
  };

  const used = new Set((rows ?? []).map((r) => r.size));
  const addable = allowedSizes.filter((s) => !used.has(s)).sort(bySize);

  const addSize = async (size: string) => {
    setNotice(null);
    setSaving(size);
    try {
      await adminApi.saveVariant({ slug, size, stock: 0, costAed: null });
      load();
    } catch (e) {
      if (e instanceof Unauthorized) return onUnauthorized();
      setNotice(String(e));
    } finally {
      setSaving(null);
    }
  };

  const saveRow = async (v: ProductVariant) => {
    const d = draft[v.sku];
    if (!d || saving) return;
    // parseCount rather than a bare /^\d+$/: that class is ASCII-only in
    // JavaScript, so a count typed on an Arabic keyboard was refused as "not a
    // whole number" while reading as one on screen.
    const stock = parseCount(d.stock);
    if (stock === null) return setNotice(`"${d.stock}" is not a whole number of items.`);
    // AED, and a two-decimal currency — so NOT parseAmount, which is fils and
    // three decimals and would multiply this by a thousand. Only the digits are
    // normalised; the shape check is the one this column already had. (The
    // old `|| Number(cost) < 0` went with it: the pattern cannot match a minus
    // sign, so it was a condition that could never be true.)
    const cost = normaliseDigits(d.cost).trim();
    if (cost !== '' && !/^\d+(\.\d{1,2})?$/.test(cost)) {
      return setNotice(`"${d.cost}" is not a valid cost.`);
    }
    setSaving(v.sku);
    setNotice(null);
    try {
      await adminApi.saveVariant({
        slug: v.slug,
        size: v.size,
        stock,
        costAed: cost === '' ? null : Number(cost),
      });
      setDraft((m) => { const { [v.sku]: _drop, ...rest } = m; return rest; });
      load();
    } catch (e) {
      if (e instanceof Unauthorized) return onUnauthorized();
      setNotice(String(e));
    } finally {
      setSaving(null);
    }
  };

  const removeRow = async (v: ProductVariant, force: boolean) => {
    setSaving(v.sku);
    setNotice(null);
    try {
      await adminApi.deleteVariant(v.sku, force);
      setConfirmDelete(null);
      load();
    } catch (e) {
      if (e instanceof Unauthorized) return onUnauthorized();
      if (String(e).includes('variant_has_stock')) {
        // NAME THE COUNT, not just "cannot remove" — the same lesson this
        // project's own notes record about the website's orphan guard:
        // "you cannot remove XL" is not actionable, "XL has 42 stock" is.
        setConfirmDelete(v.sku);
      } else {
        setNotice(String(e));
      }
    } finally {
      setSaving(null);
    }
  };

  return (
    <View style={styles.ladder}>
      {notice && <ThemedText type="label" style={styles.hint}>{notice}</ThemedText>}
      {rows === null ? (
        <ActivityIndicator />
      ) : (
        <>
          {[...rows].sort((a, b) => bySize(a.size, b.size)).map((v) => {
            const d = draft[v.sku] ?? { stock: String(v.stock), cost: v.costAed != null ? String(v.costAed) : '' };
            const dirty = draft[v.sku] !== undefined;
            return (
              <View key={v.sku} style={styles.ladderRow}>
                <ThemedText type="labelBold" style={styles.ladderSize}>{v.size}</ThemedText>
                <TextInput
                  value={d.stock}
                  onChangeText={(t) => setDraft((m) => ({ ...m, [v.sku]: { ...d, stock: t } }))}
                  keyboardType="number-pad"
                  selectTextOnFocus
                  accessibilityLabel={`stock for ${v.slug} ${v.size}`}
                  style={[styles.ladderInput, { color: theme.text, backgroundColor: theme.background, borderColor: theme.controlBorder }]}
                />
                <TextInput
                  value={d.cost}
                  onChangeText={(t) => setDraft((m) => ({ ...m, [v.sku]: { ...d, cost: t } }))}
                  placeholder="cost (AED)"
                  placeholderTextColor={theme.textSecondary}
                  keyboardType="decimal-pad"
                  selectTextOnFocus
                  accessibilityLabel={`wholesale cost for ${v.slug} ${v.size}`}
                  style={[styles.ladderInput, { color: theme.text, backgroundColor: theme.background, borderColor: theme.controlBorder }]}
                />
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`save ${v.size}`}
                  disabled={!dirty || saving !== null}
                  onPress={() => saveRow(v)}
                  style={press(false, styles.ladderBtn, { borderColor: theme.controlBorder }, !dirty && styles.dimmed)}>
                  {saving === v.sku ? <ActivityIndicator /> : <ThemedText type="caption">Save</ThemedText>}
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={confirmDelete === v.sku ? `confirm removing ${v.size}` : `remove ${v.size}`}
                  disabled={saving !== null}
                  onPress={() => (confirmDelete === v.sku ? removeRow(v, true) : removeRow(v, false))}
                  style={press(false, styles.ladderBtn, { borderColor: theme.danger })}>
                  <ThemedText type="caption" themeColor="danger">
                    {confirmDelete === v.sku ? `Has ${v.stock} in stock — tap to remove anyway` : 'Remove'}
                  </ThemedText>
                </Pressable>
              </View>
            );
          })}
          {rows.length === 0 && (
            <ThemedText type="label" themeColor="textSecondary">
              No sizes yet — this garment has no size ladder and cannot be ordered.
            </ThemedText>
          )}
          {addable.length > 0 && (
            <>
              <ThemedText type="caption" themeColor="textSecondary" style={styles.hint}>Add a size</ThemedText>
              <View style={styles.chips}>
                {addable.map((s) => (
                  <Chip key={s} label={s} active={false} onPress={() => addSize(s)} />
                ))}
              </View>
            </>
          )}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  // NO PADDING. AdminShell's own content wrapper already insets every screen
  // by Spacing.three; this added a second one, so Products alone sat twice as
  // far in from each edge as the rest of the panel.
  page: { gap: Spacing.three },
  row: { flexDirection: 'row', gap: Spacing.three, alignItems: 'center' },
  // 4:5, the crop the shop's product grid uses — so a photograph judged here
  // is the photograph a shopper gets. images.tsx made the same call for the
  // gallery and says why: a square shows the owner a picture the storefront
  // will never display.
  rowThumb: {
    width: 48,
    height: 60,
    borderRadius: Radius.button,
    backgroundColor: 'rgba(127,127,127,0.15)',
  },
  // Dashed, so an empty frame reads as "no photograph" rather than as one
  // that failed to arrive.
  rowThumbNone: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: 'rgba(127,127,127,0.35)',
  },
  rowText: { flex: 1, gap: Spacing.half },
  actions: { flexDirection: 'row', gap: Spacing.two, flexWrap: 'wrap', marginTop: Spacing.two },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  hint: { marginTop: Spacing.two },
  ladder: { marginTop: Spacing.three, gap: Spacing.two, borderTopWidth: 1, borderTopColor: 'rgba(127,127,127,0.2)', paddingTop: Spacing.two },
  ladderRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, flexWrap: 'wrap' },
  ladderSize: { width: 40 },
  ladderInput: {
    flexGrow: 1,
    flexBasis: 90,
    minHeight: TapTarget,
    borderWidth: 1,
    borderRadius: Radius.button,
    paddingHorizontal: Spacing.two,
    // 16, NOT 15 — the only sub-16 input left in the panel. Mobile Safari
    // zooms the whole page when a field under 16px takes focus, and this panel
    // runs on the web: tapping the stock box scaled the page up and left the
    // owner scrolling back to find the row they were editing. One pixel of
    // type against a page that jumps on every tap.
    fontSize: 16,
  },
  ladderBtn: {
    minHeight: TapTarget,
    minWidth: 64,
    borderWidth: 1,
    borderRadius: Radius.button,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.two,
  },
  dimmed: { opacity: 0.5 },
});
