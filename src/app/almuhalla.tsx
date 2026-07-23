import { useMemo, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Fonts, MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type Language = {
  id: string;
  label: string;
  sample: string;
};

const languages: Language[] = [
  {
    id: 'javascript',
    label: 'JavaScript',
    sample: [
      '// wain — where shall we go?',
      'const places = ["Souq", "Beach", "Museum"];',
      '',
      'function pick(list) {',
      '  const i = Math.floor(Math.random() * list.length);',
      '  return list[i];',
      '}',
      '',
      'console.log("Yalla:", pick(places));',
    ].join('\n'),
  },
  {
    id: 'typescript',
    label: 'TypeScript',
    sample: [
      'type Place = { name: string; category: string };',
      '',
      'const featured: Place[] = [',
      '  { name: "Kuwait Towers", category: "Landmark" },',
      '];',
      '',
      'export const first = (list: Place[]): Place | undefined => list[0];',
    ].join('\n'),
  },
  {
    id: 'json',
    label: 'JSON',
    sample: [
      '{',
      '  "app": "wain",',
      '  "meaning": "where?",',
      '  "categories": ["Food", "Beaches", "Culture"]',
      '}',
    ].join('\n'),
  },
];

export default function AlmuhallaScreen() {
  const theme = useTheme();
  const [languageId, setLanguageId] = useState<Language['id']>(languages[0].id);
  const [code, setCode] = useState<string>(languages[0].sample);

  const activeLanguage = useMemo(
    () => languages.find((lang) => lang.id === languageId) ?? languages[0],
    [languageId],
  );

  const lineCount = useMemo(() => code.split('\n').length, [code]);
  const charCount = code.length;

  const gutter = useMemo(
    () => Array.from({ length: lineCount }, (_, i) => String(i + 1)).join('\n'),
    [lineCount],
  );

  const loadSample = (lang: Language) => {
    setLanguageId(lang.id);
    setCode(lang.sample);
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['bottom']}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.content}>
          {/* Language chips */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.chipRow}>
            {languages.map((lang) => {
              const selected = lang.id === languageId;
              return (
                <Pressable
                  key={lang.id}
                  onPress={() => setLanguageId(lang.id)}
                  style={({ pressed }) => pressed && styles.pressed}>
                  <ThemedView
                    type={selected ? 'backgroundSelected' : 'backgroundElement'}
                    style={[styles.chip, { borderColor: selected ? theme.tint : theme.border }]}>
                    <ThemedText
                      type="small"
                      themeColor={selected ? 'tint' : 'textSecondary'}>
                      {lang.label}
                    </ThemedText>
                  </ThemedView>
                </Pressable>
              );
            })}
          </ScrollView>

          {/* Editor */}
          <ThemedView
            type="backgroundElement"
            style={[styles.editor, { borderColor: theme.border }]}>
            <View style={styles.editorRow}>
              <Text style={[styles.gutter, { color: theme.textSecondary, borderColor: theme.border }]}>
                {gutter}
              </Text>
              <TextInput
                value={code}
                onChangeText={setCode}
                multiline
                autoCapitalize="none"
                autoCorrect={false}
                spellCheck={false}
                textAlignVertical="top"
                keyboardType={Platform.OS === 'ios' ? 'ascii-capable' : 'default'}
                placeholder="Write some code…"
                placeholderTextColor={theme.textSecondary}
                style={[styles.input, { color: theme.text }]}
              />
            </View>
          </ThemedView>

          {/* Status bar */}
          <View style={styles.statusBar}>
            <ThemedText type="small" themeColor="textSecondary">
              {activeLanguage.label}
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {lineCount} {lineCount === 1 ? 'line' : 'lines'} · {charCount}{' '}
              {charCount === 1 ? 'char' : 'chars'}
            </ThemedText>
          </View>

          {/* Actions */}
          <View style={styles.actions}>
            <Pressable
              onPress={() => setCode('')}
              style={({ pressed }) => [
                styles.actionButton,
                { borderColor: theme.border },
                pressed && styles.pressed,
              ]}>
              <ThemedText type="smallBold" themeColor="textSecondary">
                Clear
              </ThemedText>
            </Pressable>
            <Pressable
              onPress={() => loadSample(activeLanguage)}
              style={({ pressed }) => [
                styles.actionButton,
                styles.actionPrimary,
                { backgroundColor: theme.tint },
                pressed && styles.pressed,
              ]}>
              <Text style={styles.actionPrimaryText}>Reset sample</Text>
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  flex: {
    flex: 1,
  },
  content: {
    flex: 1,
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.three,
    gap: Spacing.three,
  },
  chipRow: {
    gap: Spacing.two,
    paddingBottom: Spacing.one,
  },
  chip: {
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one,
  },
  editor: {
    flex: 1,
    borderRadius: Spacing.three,
    borderWidth: 1,
    overflow: 'hidden',
  },
  editorRow: {
    flex: 1,
    flexDirection: 'row',
  },
  gutter: {
    fontFamily: Fonts.mono,
    fontSize: 13,
    lineHeight: 20,
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.two,
    textAlign: 'right',
    borderRightWidth: 1,
    minWidth: 40,
  },
  input: {
    flex: 1,
    fontFamily: Fonts.mono,
    fontSize: 13,
    lineHeight: 20,
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.three,
  },
  statusBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  actions: {
    flexDirection: 'row',
    gap: Spacing.two,
    paddingBottom: Spacing.three,
  },
  actionButton: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Spacing.three,
    borderWidth: 1,
    paddingVertical: Spacing.three,
  },
  actionPrimary: {
    borderWidth: 0,
  },
  actionPrimaryText: {
    color: '#ffffff',
    fontWeight: '700',
    fontSize: 14,
  },
  pressed: {
    opacity: 0.8,
  },
});
