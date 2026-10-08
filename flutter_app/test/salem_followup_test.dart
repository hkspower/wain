// سالم's memory replays the web's own readings (test/fixtures/
// search_parity.json → `followups`, written by scripts/gen-flutter-search.mjs
// from the real src/lib/salem-followup.ts): for each first question at two
// Kuwait clocks, the same remembered places, the same chips, the same «غيره»,
// and every short reply read the same way — what is said to a person
// («السلام عليكم», «شكراً», «مين أنت؟») included, and the narrowed answer's
// places, kept to the last answer's (8 October).
import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:wain/ai/tools.dart';
import 'package:wain/data/catalogue.dart';
import 'package:wain/data/places.g.dart';
import 'package:wain/data/salem_followup.dart';
import 'package:wain/data/search.dart' show elsewhereNamed;

Map<String, Object?> _wire(FollowUp f) => {
  'kind': f.wire,
  if (f.query != null) 'query': f.query,
  if (f.added != null) 'added': f.added,
  if (f.area != null) 'area': f.area,
  if (f.slug != null) 'slug': f.slug,
  if (f.act != null) 'act': f.act!.name,
  if (f.what != null) 'what': f.what!.name,
  if (f.opener != null) 'opener': f.opener!.name,
};

void main() {
  final fixture =
      jsonDecode(File('test/fixtures/search_parity.json').readAsStringSync())
          as Map<String, dynamic>;
  final follow = fixture['followups'] as Map<String, dynamic>;
  final areas = areaIndex(kPlaces.map((p) => p.areaAr));

  test('with nothing remembered, every message is read as the web reads it', () {
    for (final r in (follow['noContext'] as List).cast<Map>()) {
      expect(
        _wire(readFollowUp(r['m'] as String, null, null, areas)),
        r['out'],
        reason: r['m'] as String,
      );
    }
  });

  test('a part of Kuwait with nothing in it is named back as it was typed', () {
    final cases = (fixture['elsewhere'] as List).cast<Map>();
    expect(
      cases.where((c) => c['area'] != null).length,
      greaterThanOrEqualTo(8),
    );
    for (final c in cases) {
      expect(
        elsewhereNamed(c['q'] as String, searchIndex),
        c['area'],
        reason: c['q'] as String,
      );
    }
  });

  final contexts = (follow['contexts'] as List).cast<Map<String, dynamic>>();
  test('has real coverage', () {
    expect(contexts.length, greaterThanOrEqualTo(14));
    final reads = [
      for (final c in contexts) ...(c['reads'] as List).cast<Map>(),
      ...(follow['noContext'] as List).cast<Map>(),
    ];
    final kinds = {for (final r in reads) (r['out'] as Map)['kind']};
    expect(
      kinds,
      containsAll(['new', 'refine', 'more', 'pick', 'where', 'social', 'ask']),
    );
    final acts = {for (final r in reads) (r['out'] as Map)['act']};
    expect(acts, containsAll(['salam', 'greet', 'how', 'thanks', 'who', 'ok']));
    expect(
      reads.any((r) => (r['out'] as Map)['opener'] != null),
      isTrue,
      reason: 'a greeting in front of a question',
    );
    expect(
      reads.any((r) => (r['out'] as Map)['area'] != null),
      isTrue,
      reason: 'an area after an answer',
    );
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
          final out = readFollowUp(m, ctx, r['active'] as String?, areas);
          expect(_wire(out), r['out'], reason: '«$m» (${r['active']})');
          if (out.kind == FollowUpKind.refine) {
            // What the chat shows for it: the last answer in that area, or
            // the narrowed question's places that the last answer found.
            final refined = out.area != null
                ? [
                    for (final s in ranked)
                      if (getPlace(s)!.areaAr == out.area) s,
                  ]
                : withinAnswer(
                    chatRanked(out.query!, searchIndex, kPlaces, clock),
                    ctx,
                  );
            expect(refined, r['refined'], reason: 'the answer to «$m»');
          }
        }
      },
    );
  }
}
