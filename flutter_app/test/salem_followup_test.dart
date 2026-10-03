// سالم's memory replays the web's own readings (test/fixtures/
// search_parity.json → `followups`, written by scripts/gen-flutter-search.mjs
// from the real src/lib/salem-followup.ts): for each first question at two
// Kuwait clocks, the same remembered places, the same chips, the same «غيره»,
// and every short reply read the same way — the narrowed question's answer
// included.
import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:wain/ai/tools.dart';
import 'package:wain/data/catalogue.dart';
import 'package:wain/data/places.g.dart';
import 'package:wain/data/salem_followup.dart';

Map<String, Object?> _wire(FollowUp f) => {
  'kind': f.wire,
  if (f.query != null) 'query': f.query,
  if (f.added != null) 'added': f.added,
  if (f.slug != null) 'slug': f.slug,
};

void main() {
  final fixture = jsonDecode(
    File('test/fixtures/search_parity.json').readAsStringSync(),
  ) as Map<String, dynamic>;
  final follow = fixture['followups'] as Map<String, dynamic>;

  test('with nothing remembered, every message is a new question', () {
    for (final r in (follow['noContext'] as List).cast<Map>()) {
      expect(
        _wire(readFollowUp(r['m'] as String, null)),
        r['out'],
        reason: r['m'] as String,
      );
    }
  });

  final contexts = (follow['contexts'] as List).cast<Map<String, dynamic>>();
  test('has real coverage', () {
    expect(contexts.length, greaterThanOrEqualTo(14));
    final kinds = {
      for (final c in contexts)
        for (final r in (c['reads'] as List).cast<Map>())
          (r['out'] as Map)['kind'],
    };
    expect(kinds, containsAll(['new', 'refine', 'more', 'pick', 'where']));
  });

  for (final c in contexts) {
    final q = c['q'] as String;
    final clock = (month: c['month'] as int, hour: c['hour'] as int);
    test(
      '«$q» at ${clock.month}/${clock.hour}: the chat remembers what the web '
      'does, and reads every reply the same way',
      () {
        final ranked = chatRanked(q, searchIndex, kPlaces, clock);
        expect(ranked, (c['ranked'] as List).cast<String>(), reason: 'ranked');
        final shown = ranked.take(8).toList();
        final ctx = ChatContext(
          query: q,
          ranked: ranked,
          seen: shown,
          shown: shown,
        );
        final shownPlaces = [for (final s in shown) getPlace(s)!];
        expect(
          followUpChips(ctx, shownPlaces, month: clock.month, hour: clock.hour),
          c['chips'],
          reason: 'chips',
        );
        expect(
          followUpChips(
            ChatContext(query: q, ranked: ranked, seen: ranked, shown: shown),
            shownPlaces,
            month: clock.month,
            hour: clock.hour,
          ),
          c['chipsWhenAllSeen'],
          reason: 'chips once every place has been shown',
        );
        expect(nextPlaces(ctx), c['next'], reason: '«غيره»');
        for (final r in (c['reads'] as List).cast<Map>()) {
          final m = r['m'] as String;
          final out = readFollowUp(m, ctx, r['active'] as String?);
          expect(_wire(out), r['out'], reason: '«$m» (${r['active']})');
          if (out.kind == FollowUpKind.refine) {
            expect(
              chatRanked(out.query!, searchIndex, kPlaces, clock),
              r['refined'],
              reason: 'the answer to «${out.query}»',
            );
          }
        }
      },
    );
  }
}
