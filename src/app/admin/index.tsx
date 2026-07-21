import { Redirect, useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAdminAuth } from '@/lib/admin-auth';
import { usePlaces } from '@/lib/places-store';

/** Cross-platform confirm — Alert.alert on native, window.confirm on web. */
function confirmAsync(title: string, message: string): Promise<boolean> {
  if (Platform.OS === 'web') {
    return Promise.resolve(
      typeof window !== 'undefined' ? window.confirm(`${title}\n\n${message}`) : true,
    );
  }
  return new Promise((resolve) => {
    Alert.alert(title, message, [
      { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
      { text: 'Confirm', style: 'destructive', onPress: () => resolve(true) },
    ]);
  });
}

export default function AdminDashboard() {
  const theme = useTheme();
  const router = useRouter();
  const { unlocked, lock, changePin } = useAdminAuth();
  const { places, removePlace, toggleFeatured, resetToSeed } = usePlaces();

  const [showPinForm, setShowPinForm] = useState(false);
  const [currentPin, setCurrentPin] = useState('');
  const [nextPin, setNextPin] = useState('');
  const [pinMessage, setPinMessage] = useState<{ ok: boolean; text: string } | null>(null);

  if (!unlocked) {
    return <Redirect href="/admin/lock" />;
  }

  const featuredCount = places.filter((p) => p.featured).length;

  const onDelete = async (slug: string, name: string) => {
    const ok = await confirmAsync('Delete place', `Remove “${name}” from Wain? This can’t be undone.`);
    if (ok) await removePlace(slug);
  };

  const onReset = async () => {
    const ok = await confirmAsync(
      'Reset to defaults',
      'Replace all places with the built-in list? Any changes you made will be lost.',
    );
    if (ok) await resetToSeed();
  };

  const onChangePin = async () => {
    setPinMessage(null);
    if (nextPin.length < 4) {
      setPinMessage({ ok: false, text: 'New PIN must be at least 4 digits.' });
      return;
    }
    const ok = await changePin(currentPin, nextPin);
    if (ok) {
      setPinMessage({ ok: true, text: 'PIN updated.' });
      setCurrentPin('');
      setNextPin('');
      setShowPinForm(false);
    } else {
      setPinMessage({ ok: false, text: 'Current PIN is incorrect.' });
    }
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['bottom']}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled">
        <View style={styles.content}>
          {/* Stats */}
          <View style={styles.statsRow}>
            <ThemedView type="backgroundElement" style={[styles.statCard, { borderColor: theme.border }]}>
              <ThemedText type="subtitle" style={styles.statNumber}>
                {places.length}
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                Places
              </ThemedText>
            </ThemedView>
            <ThemedView type="backgroundElement" style={[styles.statCard, { borderColor: theme.border }]}>
              <ThemedText type="subtitle" style={styles.statNumber}>
                {featuredCount}
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                Featured
              </ThemedText>
            </ThemedView>
          </View>

          {/* Add */}
          <Pressable
            onPress={() => router.push('/admin/edit/new')}
            style={({ pressed }) => [
              styles.addButton,
              { backgroundColor: theme.tint, opacity: pressed ? 0.85 : 1 },
            ]}>
            <Text style={styles.addButtonText}>＋  Add a place</Text>
          </Pressable>

          {/* List */}
          <ThemedText type="smallBold" style={styles.sectionTitle}>
            All places
          </ThemedText>

          <View style={styles.list}>
            {places.map((place) => (
              <ThemedView
                key={place.slug}
                type="backgroundElement"
                style={[styles.row, { borderColor: theme.border }]}>
                <View style={[styles.rowEmoji, { backgroundColor: place.color }]}>
                  <Text style={styles.rowEmojiText}>{place.emoji}</Text>
                </View>

                <Pressable
                  style={styles.rowMain}
                  onPress={() => router.push(`/admin/edit/${place.slug}`)}>
                  <ThemedText type="smallBold" numberOfLines={1}>
                    {place.name}
                  </ThemedText>
                  <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
                    {place.category} · {place.area}
                  </ThemedText>
                </Pressable>

                <View style={styles.rowActions}>
                  <Pressable
                    hitSlop={8}
                    onPress={() => toggleFeatured(place.slug)}
                    style={({ pressed }) => pressed && styles.pressed}>
                    <Text style={styles.actionIcon}>{place.featured ? '⭐' : '☆'}</Text>
                  </Pressable>
                  <Pressable
                    hitSlop={8}
                    onPress={() => router.push(`/admin/edit/${place.slug}`)}
                    style={({ pressed }) => pressed && styles.pressed}>
                    <Text style={styles.actionIcon}>✏️</Text>
                  </Pressable>
                  <Pressable
                    hitSlop={8}
                    onPress={() => onDelete(place.slug, place.name)}
                    style={({ pressed }) => pressed && styles.pressed}>
                    <Text style={styles.actionIcon}>🗑️</Text>
                  </Pressable>
                </View>
              </ThemedView>
            ))}
          </View>

          {/* Settings */}
          <ThemedText type="smallBold" style={styles.sectionTitle}>
            Settings
          </ThemedText>

          <View style={styles.settingsGroup}>
            <Pressable
              onPress={() => {
                setShowPinForm((v) => !v);
                setPinMessage(null);
              }}
              style={({ pressed }) => [
                styles.settingButton,
                { borderColor: theme.border, opacity: pressed ? 0.85 : 1 },
              ]}>
              <ThemedText type="small">🔑 Change PIN</ThemedText>
            </Pressable>

            {showPinForm && (
              <ThemedView
                type="backgroundElement"
                style={[styles.pinForm, { borderColor: theme.border }]}>
                <TextInput
                  value={currentPin}
                  onChangeText={(t) => setCurrentPin(t.replace(/[^0-9]/g, '').slice(0, 8))}
                  placeholder="Current PIN"
                  placeholderTextColor={theme.textSecondary}
                  keyboardType="number-pad"
                  secureTextEntry
                  style={[styles.pinInput, { borderColor: theme.border, color: theme.text }]}
                />
                <TextInput
                  value={nextPin}
                  onChangeText={(t) => setNextPin(t.replace(/[^0-9]/g, '').slice(0, 8))}
                  placeholder="New PIN (min 4 digits)"
                  placeholderTextColor={theme.textSecondary}
                  keyboardType="number-pad"
                  secureTextEntry
                  style={[styles.pinInput, { borderColor: theme.border, color: theme.text }]}
                />
                <Pressable
                  onPress={onChangePin}
                  style={({ pressed }) => [
                    styles.pinSave,
                    { backgroundColor: theme.tint, opacity: pressed ? 0.85 : 1 },
                  ]}>
                  <Text style={styles.pinSaveText}>Save PIN</Text>
                </Pressable>
              </ThemedView>
            )}

            {pinMessage && (
              <ThemedText
                type="small"
                style={{ color: pinMessage.ok ? theme.tint : '#dc2626' }}>
                {pinMessage.text}
              </ThemedText>
            )}

            <Pressable
              onPress={onReset}
              style={({ pressed }) => [
                styles.settingButton,
                { borderColor: theme.border, opacity: pressed ? 0.85 : 1 },
              ]}>
              <ThemedText type="small">♻️ Reset to default places</ThemedText>
            </Pressable>

            <Pressable
              onPress={() => {
                lock();
                router.replace('/about');
              }}
              style={({ pressed }) => [
                styles.settingButton,
                { borderColor: theme.border, opacity: pressed ? 0.85 : 1 },
              ]}>
              <ThemedText type="small">🔒 Lock &amp; exit</ThemedText>
            </Pressable>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
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
  },
  statsRow: {
    flexDirection: 'row',
    gap: Spacing.three,
    marginBottom: Spacing.four,
  },
  statCard: {
    flex: 1,
    borderRadius: Spacing.three,
    borderWidth: 1,
    padding: Spacing.three,
    alignItems: 'center',
    gap: Spacing.half,
  },
  statNumber: {
    fontSize: 30,
    lineHeight: 36,
  },
  addButton: {
    borderRadius: Spacing.three,
    paddingVertical: Spacing.three,
    alignItems: 'center',
  },
  addButtonText: {
    color: '#ffffff',
    fontWeight: '700',
    fontSize: 15,
  },
  sectionTitle: {
    fontSize: 16,
    marginTop: Spacing.five,
    marginBottom: Spacing.three,
  },
  list: {
    gap: Spacing.two,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    borderRadius: Spacing.three,
    borderWidth: 1,
    padding: Spacing.two,
  },
  rowEmoji: {
    width: 44,
    height: 44,
    borderRadius: Spacing.two,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowEmojiText: {
    fontSize: 22,
  },
  rowMain: {
    flex: 1,
    gap: Spacing.half,
  },
  rowActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingHorizontal: Spacing.one,
  },
  actionIcon: {
    fontSize: 18,
  },
  pressed: {
    opacity: 0.5,
  },
  settingsGroup: {
    gap: Spacing.two,
  },
  settingButton: {
    borderRadius: Spacing.three,
    borderWidth: 1,
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.three,
  },
  pinForm: {
    borderRadius: Spacing.three,
    borderWidth: 1,
    padding: Spacing.three,
    gap: Spacing.two,
  },
  pinInput: {
    borderRadius: Spacing.two,
    borderWidth: 1,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    fontSize: 15,
  },
  pinSave: {
    borderRadius: Spacing.two,
    paddingVertical: Spacing.two,
    alignItems: 'center',
    marginTop: Spacing.one,
  },
  pinSaveText: {
    color: '#ffffff',
    fontWeight: '700',
  },
});
