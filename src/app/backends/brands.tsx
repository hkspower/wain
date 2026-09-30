import { Image } from 'expo-image';
import { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { AdminShell } from '@/components/admin-shell';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Chip } from '@/components/ui/chip';
import { Field } from '@/components/ui/field';
import { Radius, Spacing, TapTarget } from '@/constants/theme';
import { adminApi, Unauthorized, type Brand } from '@/lib/admin';
import { pickImages, PermissionDenied } from '@/lib/pick-images';
import { useSession } from '@/lib/session';
import { shrinkImage, TooBig } from '@/lib/shrink-image';

/**
 * Brands: add one, rename one, give it a logo, hide it.
 *
 * THE SERVER ALREADY DID ALL OF THIS. brand_save, brands and brand_active have
 * been in admin.php the whole time, and the brands table ships seeded with the
 * eight the catalogue already mentions. What was missing was any way to reach
 * them: adding a ninth brand meant an INSERT by hand, and a logo meant a
 * base64 blob typed into a SQL client. This screen is the missing half, not a
 * new feature underneath.
 *
 * ONE FORM FOR ADD AND EDIT, because the server is one route and the only
 * difference is whether an id goes with it. Two forms would be two places to
 * fix the next time a field is added, and they would drift.
 *
 * THE LOGO IS SENT THE WAY EVERY OTHER PICTURE HERE IS SENT: picked, shrunk to
 * a data URI in the browser, and stored in the row. Nothing is written into
 * the web root — the same rule the product photographs and the hero follow,
 * and for the same reason, which is that an endpoint that writes files into a
 * document root is a way in.
 *
 * NO DELETE, and that is the server's decision showing through rather than an
 * omission here. A brand with orders behind it is history; hiding it is the
 * reversible answer and the storefront already respects `active`.
 */
export default function BrandsScreen() {
  const { signOut } = useSession();
  const [rows, setRows] = useState<Brand[] | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // The row being edited, or a blank one for "add". `logo` is deliberately
  // absent from the draft until something is picked: undefined means "leave
  // whatever is there", which is the server's convention and the only way to
  // rename a brand without also re-uploading its logo.
  const [draft, setDraft] = useState<{
    id?: number;
    name_en: string;
    name_ar: string;
    slug: string;
    logo?: string;
    logoPreview?: string | null;
  } | null>(null);

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

  const blank = () =>
    setDraft({ name_en: '', name_ar: '', slug: '', logoPreview: null });

  const edit = (b: Brand) =>
    setDraft({
      id: b.id,
      name_en: b.name_en,
      name_ar: b.name_ar,
      slug: b.slug,
      logoPreview: b.logo,
    });

  const chooseLogo = async () => {
    if (!draft) return;
    setNotice(null);
    try {
      const [picked] = await pickImages(1);
      if (!picked) return;
      const small = await shrinkImage(picked);
      setDraft({ ...draft, logo: small.dataUri, logoPreview: small.dataUri });
    } catch (e) {
      setNotice(
        e instanceof PermissionDenied
          ? 'Sporta needs permission to open your photos. Allow it in your phone’s settings and try again.'
          : e instanceof TooBig
            ? 'that logo is too large even after shrinking — try a smaller original'
            : String(e),
      );
    }
  };

  const save = async () => {
    if (!draft || busy) return;
    // Checked here as well as on the server, because a round trip to be told
    // "name_en is required" is a round trip that did not need to happen — and
    // the server's message names a field, not a language.
    if (!draft.name_en.trim()) return setNotice('The English name is required.');
    if (!draft.name_ar.trim()) return setNotice('The Arabic name is required.');
    setBusy(true);
    setNotice(null);
    try {
      const saved = await adminApi.saveBrand({
        id: draft.id,
        name_en: draft.name_en.trim(),
        name_ar: draft.name_ar.trim(),
        // Empty means "work it out from the English name", which is what the
        // server does. Sending a blank slug is not the same as sending none.
        ...(draft.slug.trim() ? { slug: draft.slug.trim() } : {}),
        ...(draft.logo !== undefined ? { logo: draft.logo } : {}),
      });
      setDraft(null);
      setNotice(draft.id ? `${saved.name_en} updated.` : `${saved.name_en} added.`);
      await load();
    } catch (e) {
      if (e instanceof Unauthorized) return signOut();
      setNotice(
        String(e).includes('slug_taken')
          ? 'another brand already uses that address — give this one a different slug'
          : String(e).includes('invalid_slug')
            ? 'that slug has no letters or digits in it'
            : String(e).includes('logo_bad_format') || String(e).includes('logo_not_an_image')
              ? 'that file is not a picture the shop accepts (png, jpeg or webp)'
              : String(e),
      );
    } finally {
      setBusy(false);
    }
  };

  const toggle = async (b: Brand) => {
    setNotice(null);
    try {
      await adminApi.setBrandActive(b.id, !b.active);
      await load();
    } catch (e) {
      if (e instanceof Unauthorized) return signOut();
      setNotice(String(e));
    }
  };

  return (
    <AdminShell title="Brands" loading={rows === null}>
      <ScrollView contentContainerStyle={styles.page}>
        {notice ? (
          <Card>
            <ThemedText type="label">{notice}</ThemedText>
          </Card>
        ) : null}

        {draft ? (
          <Card>
            <ThemedText type="bodyBold">
              {draft.id ? 'Edit brand' : 'New brand'}
            </ThemedText>

            <Field
              label="Name (English)"
              value={draft.name_en}
              onChangeText={(v: string) => setDraft({ ...draft, name_en: v })}
            />
            <Field
              label="الاسم بالعربية"
              value={draft.name_ar}
              onChangeText={(v: string) => setDraft({ ...draft, name_ar: v })}
            />
            <Field
              label="Address in links (leave empty to work it out from the English name)"
              value={draft.slug}
              onChangeText={(v: string) => setDraft({ ...draft, slug: v })}
            />

            <View style={styles.logoRow}>
              <View style={styles.logoBox}>
                {draft.logoPreview ? (
                  <Image
                    source={{ uri: draft.logoPreview }}
                    style={styles.logo}
                    contentFit="contain"
                  />
                ) : (
                  <ThemedText type="label">no logo</ThemedText>
                )}
              </View>
              <View style={styles.logoButtons}>
                <Button label="Choose logo" onPress={chooseLogo} disabled={busy} />
                {draft.logoPreview ? (
                  // '' is REMOVE, and it is a different thing from leaving the
                  // field out — the server reads the key's presence, not its
                  // truthiness. Nothing here may send undefined for this.
                  <Button
                    label="Remove logo"
                    variant="secondary"
                    disabled={busy}
                    onPress={() => setDraft({ ...draft, logo: '', logoPreview: null })}
                  />
                ) : null}
              </View>
            </View>

            <View style={styles.actions}>
              <Button label={busy ? 'Saving…' : 'Save'} onPress={save} disabled={busy} />
              <Button
                label="Cancel"
                variant="secondary"
                disabled={busy}
                onPress={() => {
                  setDraft(null);
                  setNotice(null);
                }}
              />
            </View>
          </Card>
        ) : (
          <Button label="Add a brand" onPress={blank} />
        )}

        {(rows ?? []).map((b) => (
          <Card key={b.id}>
            <View style={styles.row}>
              <View style={styles.logoBoxSmall}>
                {b.logo ? (
                  <Image source={{ uri: b.logo }} style={styles.logo} contentFit="contain" />
                ) : (
                  <ThemedText type="label">—</ThemedText>
                )}
              </View>
              <View style={styles.rowText}>
                <ThemedText type="bodyBold">{b.name_en}</ThemedText>
                <ThemedText type="label">{b.name_ar}</ThemedText>
                <ThemedText type="label">/{b.slug}</ThemedText>
              </View>
            </View>
            <View style={styles.actions}>
              <Button label="Edit" variant="secondary" onPress={() => edit(b)} />
              <Chip
                label={b.active ? 'Shown' : 'Hidden'}
                active={!!b.active}
                onPress={() => toggle(b)}
              />
            </View>
          </Card>
        ))}
      </ScrollView>
    </AdminShell>
  );
}

const styles = StyleSheet.create({
  page: { padding: Spacing.three, gap: Spacing.three },
  row: { flexDirection: 'row', gap: Spacing.three, alignItems: 'center' },
  rowText: { flex: 1, gap: Spacing.one },
  actions: { flexDirection: 'row', gap: Spacing.two, flexWrap: 'wrap', marginTop: Spacing.two },
  logoRow: { flexDirection: 'row', gap: Spacing.three, alignItems: 'center', marginTop: Spacing.two },
  logoButtons: { flex: 1, gap: Spacing.two },
  logoBox: {
    width: 96,
    height: 96,
    borderRadius: Radius.button,
    backgroundColor: 'rgba(127,127,127,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoBoxSmall: {
    width: TapTarget,
    height: TapTarget,
    borderRadius: Radius.button,
    backgroundColor: 'rgba(127,127,127,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  logo: { width: '100%', height: '100%' },
});
