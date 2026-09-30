// Replays the web engine's own answers (test/fixtures/search_parity.json,
// written by scripts/gen-flutter-search.mjs from the real src/lib/search.ts)
// and demands the same documents, in the same order, with the same scores.
import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:wain/data/search.dart';

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
}
