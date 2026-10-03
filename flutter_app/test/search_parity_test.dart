// Replays the web engine's own answers (test/fixtures/search_parity.json,
// written by scripts/gen-flutter-search.mjs from the real src/lib/search.ts)
// and demands the same documents, in the same order, with the same scores.
import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:wain/data/answer_order.dart';
import 'package:wain/data/places.g.dart';
import 'package:wain/data/search.dart';
import 'package:wain/data/voice_lines.dart';

void main() {
  final fixture = jsonDecode(
    File('test/fixtures/search_parity.json').readAsStringSync(),
  ) as Map<String, dynamic>;
  final index = SearchIndex.build();
  final cases = (fixture['cases'] as List).cast<Map<String, dynamic>>();

  test('the index holds the same number of documents as the web', () {
    expect(index.docs.length, fixture['docs']);
  });

  test('has real coverage', () {
    expect(cases.length, greaterThan(150));
    expect(
      cases.where((c) => (c['hits'] as List).isNotEmpty).length,
      greaterThan(120),
    );
  });

  for (final c in cases) {
    final q = c['q'] as String;
    test('«$q» ranks like the web', () {
      final want = (c['hits'] as List).cast<Map<String, dynamic>>();
      final got = search(q, index, limit: 20);
      expect(
        got.map((h) => h.doc.id).toList(),
        want.map((h) => h['id']).toList(),
        reason: 'ordered document ids',
      );
      for (var i = 0; i < got.length; i++) {
        final w = (want[i]['score'] as num).toDouble();
        expect(
          got[i].score,
          closeTo(w, w.abs() * 1e-9 + 1e-12),
          reason: 'score of #$i (${got[i].doc.id})',
        );
        expect(
          got[i].matched,
          (want[i]['matched'] as List).cast<String>(),
          reason: 'matched terms of #$i',
        );
      }
    });
  }

  // The answer: the same hits through answerOrder (season, price, reviews,
  // the default pick), then answerParts — at four Kuwait clocks, so the app
  // names the same place and says the same sentences as /search and سالم.
  final answers = (fixture['answers'] as List).cast<Map<String, dynamic>>();
  test('the answer cases cover the clocks and the default pick', () {
    expect(answers.length, greaterThan(300));
    expect(answers.where((a) => a['fallback'] == true).length, greaterThan(8));
  });
  for (final a in answers) {
    final q = a['q'] as String;
    final clock = (month: a['month'] as int, hour: a['hour'] as int);
    test('«$q» at ${clock.month}/${clock.hour} answers like the web', () {
      final ordered = answerOrder(
        q,
        search(q, index, limit: 40, kinds: const ['place']),
        index,
        kPlaces,
        clock,
      );
      final found = placesOf(ordered.hits, kPlaces);
      expect(ordered.fallback, a['fallback'], reason: 'topicless');
      expect(
        found.map((p) => p.slug).toList(),
        (a['slugs'] as List).cast<String>(),
        reason: 'the order of the places',
      );
      final parts = answerParts(
        ordered.hits.map((h) => h.doc.title).toList(),
        found,
        month: clock.month,
        hour: clock.hour,
      );
      expect(
        [
          for (final p in parts) [p.key, p.text],
        ],
        (a['parts'] as List),
        reason: 'what she says',
      );
    });
  }
}
