import { Redirect, Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAdminAuth } from '@/lib/admin-auth';
import { usePlaces } from '@/lib/places-store';
import {
  bannerColors,
  categoryNames,
  emptyPlace,
  priceLabels,
  type Category,
  type Place,
  type PriceLevel,
} from '@/lib/places';

export default function EditPlaceScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { unlocked } = useAdminAuth();
  const { getPlace, addPlace, updatePlace } = usePlaces();
  const { slug } = useLocalSearchParams<{ slug: string }>();

  const isNew = slug === 'new';
  const existing = isNew ? undefined : getPlace(slug);

  // Seed the form once. Missing existing place (bad slug) is handled below.
  const initial = useMemo<Place>(() => existing ?? emptyPlace(), [existing]);
  const [form, setForm] = useState<Place>(initial);
  const [highlightsText, setHighlightsText] = useState(initial.highlights.join('\n'));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!unlocked) {
    return <Redirect href="/admin/lock" />;
  }

  if (!isNew && !existing) {
    return (
      <View style={styles.missing}>
        <ThemedText type="smallBold">Place not found</ThemedText>
        <Pressable onPress={() => router.back()} style={styles.missingBack}>
          <ThemedText type="small" themeColor="tint">
            ← Back to admin
          </ThemedText>
        </Pressable>
      </View>
    );
  }

  const set = <K extends keyof Place>(key: K, value: Place[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const onSave = async () => {
    if (saving) return;
    if (!form.name.trim()) {
      setError('Name is required.');
      return;
    }
    setError(null);
    setSaving(true);
    const highlights = highlightsText
      .split('\n')
      .map((h) => h.trim())
      .filter(Boolean);
    const payload: Place = {
      ...form,
      name: form.name.trim(),
      nameAr: form.nameAr.trim(),
      area: form.area.trim(),
      tagline: form.tagline.trim(),
      description: form.description.trim(),
      bestTime: form.bestTime.trim(),
      emoji: form.emoji.trim() || '📍',
      rating: Math.min(5, Math.max(0, form.rating || 0)),
      highlights,
    };
    if (isNew) {
      await addPlace(payload);
    } else {
      await updatePlace(slug, payload);
    }
    setSaving(false);
    router.back();
  };

  const inputStyle = [
    styles.input,
    { backgroundColor: theme.backgroundElement, borderColor: theme.border, color: theme.text },
  ];

  return (
    <SafeAreaView style={styles.safeArea} edges={['bottom']}>
      <Stack.Screen options={{ title: isNew ? 'Add place' : 'Edit place' }} />
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled">
        <View style={styles.content}>
          <Field label="Name">
            <TextInput
              value={form.name}
              onChangeText={(t) => set('name', t)}
              placeholder="Kuwait Towers"
              placeholderTextColor={theme.textSecondary}
              style={inputStyle}
            />
          </Field>

          <Field label="Name (Arabic)">
            <TextInput
              value={form.nameAr}
              onChangeText={(t) => set('nameAr', t)}
              placeholder="أبراج الكويت"
              placeholderTextColor={theme.textSecondary}
              style={inputStyle}
            />
          </Field>

          <Field label="Category">
            <View style={styles.chipWrap}>
              {categoryNames.map((cat) => (
                <SelectChip
                  key={cat}
                  label={cat}
                  selected={form.category === cat}
                  onPress={() => set('category', cat as Category)}
                />
              ))}
            </View>
          </Field>

          <Field label="Area">
            <TextInput
              value={form.area}
              onChangeText={(t) => set('area', t)}
              placeholder="Kuwait City"
              placeholderTextColor={theme.textSecondary}
              style={inputStyle}
            />
          </Field>

          <View style={styles.twoCol}>
            <Field label="Emoji" style={styles.colItem}>
              <TextInput
                value={form.emoji}
                onChangeText={(t) => set('emoji', t)}
                placeholder="🗼"
                placeholderTextColor={theme.textSecondary}
                style={[inputStyle, styles.emojiInput]}
              />
            </Field>
            <Field label="Rating (0–5)" style={styles.colItem}>
              <TextInput
                value={String(form.rating)}
                onChangeText={(t) => {
                  const n = parseFloat(t.replace(/[^0-9.]/g, ''));
                  set('rating', Number.isNaN(n) ? 0 : n);
                }}
                keyboardType="decimal-pad"
                placeholder="4.7"
                placeholderTextColor={theme.textSecondary}
                style={inputStyle}
              />
            </Field>
          </View>

          <Field label="Price level">
            <View style={styles.chipWrap}>
              {([1, 2, 3] as PriceLevel[]).map((level) => (
                <SelectChip
                  key={level}
                  label={`${'•'.repeat(level)}  ${priceLabels[level - 1]}`}
                  selected={form.priceLevel === level}
                  onPress={() => set('priceLevel', level)}
                />
              ))}
            </View>
          </Field>

          <Field label="Banner color">
            <View style={styles.chipWrap}>
              {bannerColors.map((color) => (
                <Pressable
                  key={color}
                  onPress={() => set('color', color)}
                  style={[
                    styles.swatch,
                    { backgroundColor: color },
                    form.color === color && { borderColor: theme.text, borderWidth: 3 },
                  ]}
                />
              ))}
            </View>
          </Field>

          <Field label="Tagline">
            <TextInput
              value={form.tagline}
              onChangeText={(t) => set('tagline', t)}
              placeholder="The icon of Kuwait…"
              placeholderTextColor={theme.textSecondary}
              style={inputStyle}
            />
          </Field>

          <Field label="Description">
            <TextInput
              value={form.description}
              onChangeText={(t) => set('description', t)}
              placeholder="A longer description…"
              placeholderTextColor={theme.textSecondary}
              multiline
              style={[inputStyle, styles.multiline]}
            />
          </Field>

          <Field label="Highlights (one per line)">
            <TextInput
              value={highlightsText}
              onChangeText={setHighlightsText}
              placeholder={'360° viewing sphere\nRevolving restaurant'}
              placeholderTextColor={theme.textSecondary}
              multiline
              style={[inputStyle, styles.multiline]}
            />
          </Field>

          <Field label="Best time to visit">
            <TextInput
              value={form.bestTime}
              onChangeText={(t) => set('bestTime', t)}
              placeholder="Sunset, when the towers light up"
              placeholderTextColor={theme.textSecondary}
              style={inputStyle}
            />
          </Field>

          <ThemedView
            type="backgroundElement"
            style={[styles.featureRow, { borderColor: theme.border }]}>
            <View style={styles.featureText}>
              <ThemedText type="smallBold">Featured</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                Show on the Home screen
              </ThemedText>
            </View>
            <Switch
              value={!!form.featured}
              onValueChange={(v) => set('featured', v)}
              trackColor={{ true: theme.tint }}
            />
          </ThemedView>

          {error && (
            <ThemedText type="small" style={styles.error}>
              {error}
            </ThemedText>
          )}

          <Pressable
            onPress={onSave}
            disabled={saving}
            style={({ pressed }) => [
              styles.saveButton,
              { backgroundColor: theme.tint, opacity: saving ? 0.5 : pressed ? 0.85 : 1 },
            ]}>
            <Text style={styles.saveButtonText}>{isNew ? 'Create place' : 'Save changes'}</Text>
          </Pressable>

          <Pressable onPress={() => router.back()} style={styles.cancel}>
            <ThemedText type="small" themeColor="textSecondary">
              Cancel
            </ThemedText>
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function Field({
  label,
  children,
  style,
}: {
  label: string;
  children: React.ReactNode;
  style?: object;
}) {
  return (
    <View style={[styles.field, style]}>
      <ThemedText type="smallBold" style={styles.fieldLabel}>
        {label}
      </ThemedText>
      {children}
    </View>
  );
}

function SelectChip({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.chip,
        {
          backgroundColor: selected ? theme.tint : theme.backgroundElement,
          borderColor: selected ? theme.tint : theme.border,
          opacity: pressed ? 0.85 : 1,
        },
      ]}>
      <ThemedText
        type="small"
        style={selected ? styles.chipSelectedText : undefined}
        themeColor={selected ? undefined : 'textSecondary'}>
        {label}
      </ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  scrollContent: {
    alignItems: 'center',
    paddingBottom: Spacing.six,
  },
  content: {
    width: '100%',
    maxWidth: MaxContentWidth,
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.four,
    gap: Spacing.three,
  },
  field: {
    gap: Spacing.one,
  },
  fieldLabel: {
    fontSize: 13,
  },
  input: {
    borderRadius: Spacing.three,
    borderWidth: 1,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    fontSize: 15,
  },
  multiline: {
    minHeight: 96,
    textAlignVertical: 'top',
  },
  emojiInput: {
    fontSize: 22,
  },
  twoCol: {
    flexDirection: 'row',
    gap: Spacing.three,
  },
  colItem: {
    flex: 1,
  },
  chipWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
  chip: {
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  chipSelectedText: {
    color: '#ffffff',
    fontWeight: '700',
  },
  swatch: {
    width: 40,
    height: 40,
    borderRadius: 999,
    borderColor: 'transparent',
    borderWidth: 3,
  },
  featureRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: Spacing.three,
    borderWidth: 1,
    padding: Spacing.three,
    marginTop: Spacing.one,
  },
  featureText: {
    gap: Spacing.half,
  },
  error: {
    color: '#dc2626',
  },
  saveButton: {
    borderRadius: Spacing.three,
    paddingVertical: Spacing.three,
    alignItems: 'center',
    marginTop: Spacing.two,
  },
  saveButtonText: {
    color: '#ffffff',
    fontWeight: '700',
    fontSize: 16,
  },
  cancel: {
    alignItems: 'center',
    padding: Spacing.two,
  },
  missing: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
  },
  missingBack: {
    padding: Spacing.two,
  },
});
