import { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { AdminShell } from '@/components/admin-shell';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Chip } from '@/components/ui/chip';
import { Field } from '@/components/ui/field';
import { Spacing } from '@/constants/theme';
import { adminApi, Unauthorized, type Qa } from '@/lib/admin';
import { useSession } from '@/lib/session';

/**
 * سبورتا AI — the answers the shop writes itself.
 *
 * THE ASSISTANT IS NOT A MODEL. It matches a question to one of a fixed set of
 * intents — delivery, payment, returns, sizes, stock, orders — runs a real
 * query and answers from the row. Anything outside that set falls through to
 * "a colleague will follow up" and lands in the hand-off list. That list is
 * already the record of what the shop could not answer; this screen is how it
 * gets shorter.
 *
 * WHAT A ROW IS. The owner's own sentence, returned verbatim to the customer:
 * no model rewording, no facts appended, no hand-off. Everywhere else in the
 * assistant a plausible answer is treated as worse than none — this is the one
 * case where the shop has already decided what the true answer is.
 *
 * THE PHRASE IS KEYWORDS, NOT A SENTENCE, and this is the single thing that
 * makes or breaks a row. The server folds both sides — Arabic spelled four
 * ways included — and then requires EVERY significant word of the phrase to
 * appear in what the customer typed. So "جمعه مفتوح" catches "هل انتم مفتوحين
 * يوم الجمعة؟" and the full sentence catches almost nothing. The form says so
 * on the field, and the Try box below it is how you find out before a customer
 * does.
 *
 * NO DELETE. An answer that turned out to be wrong has to stop being given at
 * once, and still be readable by whoever asks why the shop said it. Hiding does
 * both; deleting does the first and destroys the second.
 */
export default function QaScreen() {
  const { signOut } = useSession();
  const [rows, setRows] = useState<Qa[] | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [draft, setDraft] = useState<{
    id?: number;
    q_ar: string;
    q_en: string;
    a_ar: string;
    a_en: string;
  } | null>(null);

  // The Try box. Kept beside the list rather than inside the form: it asks
  // "what would the shop say to this", which is a question about every row,
  // not about the one being edited.
  const [probe, setProbe] = useState('');
  const [probeHit, setProbeHit] = useState<number | null | 'none'>(null);

  const load = useCallback(async () => {
    try {
      setRows(await adminApi.qa());
    } catch (e) {
      if (e instanceof Unauthorized) return signOut();
      setNotice(String(e));
    }
  }, [signOut]);

  useEffect(() => {
    void load();
  }, [load]);

  const blank = () => setDraft({ q_ar: '', q_en: '', a_ar: '', a_en: '' });

  const edit = (q: Qa) =>
    setDraft({ id: q.id, q_ar: q.q_ar, q_en: q.q_en, a_ar: q.a_ar, a_en: q.a_en });

  const save = async () => {
    if (!draft || busy) return;
    // Both checked here as well as on the server. A round trip to be told the
    // row has no question is a round trip that did not need to happen — and
    // the server's message names a field, not what to do about it.
    if (!draft.q_ar.trim() && !draft.q_en.trim()) {
      return setNotice('Give the question in at least one language, or nothing will ever match it.');
    }
    if (!draft.a_ar.trim() || !draft.a_en.trim()) {
      return setNotice('Both answers are required — a shop that replies to Arabic in English has not replied.');
    }
    setBusy(true);
    setNotice(null);
    try {
      await adminApi.saveQa({
        id: draft.id,
        q_ar: draft.q_ar.trim(),
        q_en: draft.q_en.trim(),
        a_ar: draft.a_ar.trim(),
        a_en: draft.a_en.trim(),
      });
      setDraft(null);
      setNotice(draft.id ? 'Answer updated.' : 'Answer added.');
      await load();
    } catch (e) {
      if (e instanceof Unauthorized) return signOut();
      const s = String(e);
      setNotice(
        s.includes('question_required')
          ? 'Give the question in at least one language.'
          : s.includes('answer_required')
            ? 'Both answers are required.'
            : s.includes('question_too_long')
              ? 'That question phrase is over 200 characters — it should be keywords, not a sentence.'
              : s.includes('answer_too_long')
                ? 'That answer is over 1000 characters.'
                : s,
      );
    } finally {
      setBusy(false);
    }
  };

  const toggle = async (q: Qa) => {
    setNotice(null);
    try {
      await adminApi.setQaActive(q.id, !q.active);
      await load();
    } catch (e) {
      if (e instanceof Unauthorized) return signOut();
      setNotice(String(e));
    }
  };

  const tryIt = async () => {
    if (!probe.trim()) return;
    setNotice(null);
    try {
      const r = await adminApi.tryQa(probe.trim());
      setProbeHit(r.id ?? 'none');
    } catch (e) {
      if (e instanceof Unauthorized) return signOut();
      setNotice(String(e));
    }
  };

  return (
    <AdminShell title="سبورتا AI answers" loading={rows === null}>
      <ScrollView contentContainerStyle={styles.page}>
        {notice ? (
          <Card>
            <ThemedText type="label">{notice}</ThemedText>
          </Card>
        ) : null}

        {draft ? (
          <Card>
            <ThemedText type="bodyBold">
              {draft.id ? 'Edit answer' : 'New answer'}
            </ThemedText>
            <ThemedText type="label">
              The question is keywords, not a sentence. Every word you write must
              appear in what the customer types, so write the two or three words
              the question cannot be asked without.
            </ThemedText>

            <Field
              label="Question keywords (العربية) — e.g. جمعه مفتوح"
              value={draft.q_ar}
              onChangeText={(v: string) => setDraft({ ...draft, q_ar: v })}
            />
            <Field
              label="Question keywords (English) — e.g. open friday"
              value={draft.q_en}
              onChangeText={(v: string) => setDraft({ ...draft, q_en: v })}
            />
            <Field
              label="الإجابة بالعربية"
              value={draft.a_ar}
              multiline
              onChangeText={(v: string) => setDraft({ ...draft, a_ar: v })}
            />
            <Field
              label="Answer in English"
              value={draft.a_en}
              multiline
              onChangeText={(v: string) => setDraft({ ...draft, a_en: v })}
            />

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
          <Button label="Add an answer" onPress={blank} />
        )}

        <Card>
          <ThemedText type="bodyBold">Try a question</ThemedText>
          <ThemedText type="label">
            Type it the way a customer would. Nothing is sent to a customer and
            no count is changed — this only says which answer would fire.
          </ThemedText>
          <Field label="" value={probe} onChangeText={setProbe} />
          <View style={styles.actions}>
            <Button label="Try it" onPress={tryIt} />
          </View>
          {probeHit === 'none' ? (
            <ThemedText type="label">
              Nothing matches — the customer would get the assistant’s usual
              answer, or the hand-off.
            </ThemedText>
          ) : probeHit !== null ? (
            <ThemedText type="label">Answer #{probeHit} would fire.</ThemedText>
          ) : null}
        </Card>

        {(rows ?? []).map((q) => (
          <Card key={q.id}>
            <ThemedText type="bodyBold">{q.q_ar || q.q_en}</ThemedText>
            {q.q_ar && q.q_en ? <ThemedText type="label">{q.q_en}</ThemedText> : null}
            <ThemedText type="label">{q.a_ar}</ThemedText>
            <ThemedText type="label">{q.a_en}</ThemedText>
            <ThemedText type="label">
              {q.hits === 0
                ? 'never used — customers may not phrase it this way'
                : `used ${q.hits} time${q.hits === 1 ? '' : 's'}`}
            </ThemedText>
            <View style={styles.actions}>
              <Button label="Edit" variant="secondary" onPress={() => edit(q)} />
              <Chip
                label={q.active ? 'Answering' : 'Hidden'}
                active={!!q.active}
                onPress={() => toggle(q)}
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
  actions: { flexDirection: 'row', gap: Spacing.two, flexWrap: 'wrap', marginTop: Spacing.two },
});
