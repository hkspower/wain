// Replays the web's own answers (test/fixtures/kit_parity.json, written by
// scripts/gen-flutter-fixtures.mjs from the real place-kit, voice-lines and
// hangout modules) against the Dart ports.
import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:wain/data/find_moment.dart';
import 'package:wain/data/places.g.dart';
import 'package:wain/data/text_kit.dart';
import 'package:wain/data/voice_lines.dart';
import 'package:wain/share/hangout.dart';

void main() {
  final f = jsonDecode(
    File('test/fixtures/kit_parity.json').readAsStringSync(),
  ) as Map<String, dynamic>;
  final bySlug = {for (final p in kPlaces) p.slug: p};

  group('text kit', () {
    const forms = {
      'places': kPlacesCount,
      'minutes': kMinutesCount,
      'hours': kHoursCount,
      'results': kResultsCount,
    };
    for (final e in forms.entries) {
      test('countAr ${e.key} agrees for 0..125', () {
        final want = (f['countAr'][e.key] as List).cast<String>();
        for (var n = 0; n < want.length; n++) {
          expect(countAr(n, e.value), want[n], reason: '${e.key} $n');
        }
      });
    }

    test('toArabicNumber', () {
      for (final c in f['toArabicNumber'] as List) {
        expect(
          toArabicNumber(c['v'] as num, c['d'] as int),
          c['out'],
          reason: '${c['v']} / ${c['d']}',
        );
      }
    });

    test('distanceAr, exact and rough', () {
      for (final c in f['distanceAr'] as List) {
        expect(
          distanceAr((c['km'] as num).toDouble(), rough: c['rough'] as bool),
          c['out'],
          reason: '${c['km']} rough=${c['rough']}',
        );
      }
    });

    test('distanceKm', () {
      for (final c in f['distanceKm'] as List) {
        final a = c['a'] as List, b = c['b'] as List;
        expect(
          distanceKm(
            (lat: (a[0] as num).toDouble(), lng: (a[1] as num).toDouble()),
            (lat: (b[0] as num).toDouble(), lng: (b[1] as num).toDouble()),
          ),
          closeTo((c['km'] as num).toDouble(), 1e-9),
        );
      }
    });

    test('placeVariant for every slug', () {
      final want = (f['placeVariant'] as Map).cast<String, int>();
      expect(want.length, kPlaces.length);
      want.forEach((slug, v) => expect(placeVariant(slug), v, reason: slug));
    });

    test('no shipped place accepts orders or a queue (CLAUDE.md: 0 of 52)', () {
      expect(kPlaces.where(acceptsOrders), isEmpty);
      expect(kPlaces.where(takesQueue), isEmpty);
      expect(f['acceptsOrders'], 0);
    });
  });

  group('voice lines', () {
    test('clip lines are identical for both personas', () {
      for (final p in PersonaId.values) {
        final want = (f['clipLines'][p.name] as Map).cast<String, String>();
        final got = buildClipLines(p, kPlaces);
        expect(got.length, want.length);
        want.forEach((k, v) => expect(got[k], v, reason: '${p.name} $k'));
      }
    });

    test('forSpeech', () {
      for (final c in f['forSpeech'] as List) {
        expect(forSpeech(c['t'] as String), c['out'], reason: c['t'] as String);
      }
    });
  });

  group('hangout', () {
    final h = f['hangout'] as Map<String, dynamic>;
    final cases = (h['cases'] as List).cast<Map<String, dynamic>>();

    test('phrases, accept message, title, invite reading', () {
      (h['phrases'] as Map).forEach((k, v) {
        expect(phraseFor(WhenId.parse(k)!), v);
      });
      expect(cases.length, greaterThan(20));
      for (final r in h['readInvite'] as List) {
        expect(
          readInvite(r['s'] as String)?.wire,
          r['out'],
          reason: r['s'] as String,
        );
      }
    });

    for (final c in cases) {
      final now = DateTime.parse(c['now'] as String);
      test('at ${c['now']} (Kuwait hour ${c['hour']})', () {
        expect(kuwaitHour(now), c['hour']);
        expect(kuwaitMonth(now), c['month']);
        expect(msToNextKuwaitHour(now), c['msToNext']);
        expect(whenOptions(now).map((o) => o.id.wire).toList(), c['options']);
        for (final pp in (c['perPlace'] as List).cast<Map<String, dynamic>>()) {
          final place = bySlug[pp['slug']]!;
          expect(
            whenOptions(now, place).map((o) => o.id.wire).toList(),
            pp['options'],
            reason: '${place.slug} options',
          );
          expect(
            defaultWhen(place, now).wire,
            pp['default'],
            reason: '${place.slug} default',
          );
          (pp['messages'] as Map).forEach((w, want) {
            final when = WhenId.parse(w)!;
            expect(
              hangoutMessage(
                place: place,
                when: when,
                url: inviteUrl(place, when, 'https://www.wainkw.com/'),
                now: now,
              ),
              want,
              reason: '${place.slug} $w',
            );
          });
          (pp['passed'] as Map).forEach((w, want) {
            expect(
              invitePassed(WhenId.parse(w)!, now),
              want,
              reason: '${place.slug} passed $w',
            );
          });
        }
      });
    }

    test('accept message and title', () {
      final sample = h['accept'] as List;
      final slugs = (h['cases'] as List).first['perPlace'] as List;
      for (var i = 0; i < sample.length; i++) {
        final p = bySlug[slugs[i]['slug']]!;
        expect(inviteAcceptMessage(p, WhenId.tonight8), sample[i]);
        expect(hangoutTitle(p), (h['title'] as List)[i]);
      }
    });
  });

  group('the shortlist («خلّهم يختارون»)', () {
    final sl = f['shortlist'] as Map<String, dynamic>;
    final known = bySlug.keys.toSet();

    test('the link, its reading, the vote and the title', () {
      expect(kShortlistMax, sl['max']);
      expect(sl['title'], shortlistTitle());
      final cases = (sl['cases'] as List).cast<Map<String, dynamic>>();
      final lists = [
        for (final l in (cases.first['lists'] as List).cast<Map>())
          [for (final s in (l['slugs'] as List)) bySlug[s]!],
      ];
      for (var i = 0; i < lists.length; i++) {
        expect(
          shortlistUrl(lists[i], WhenId.tonight8, 'https://www.wainkw.com//'),
          (sl['urls'] as List)[i],
        );
      }
      for (final r in (sl['read'] as List).cast<Map>()) {
        final got = readShortlist(r['q'] as String, known.contains);
        expect(
          {'slugs': got.slugs, 'when': got.when?.wire},
          r['out'],
          reason: r['q'] as String,
        );
      }
      final votes = <String>[];
      for (var i = 0; i < 4; i++) {
        for (final w in [null, WhenId.tonight8, WhenId.now]) {
          votes.add(shortlistVoteMessage(kPlaces[i], i, w));
        }
      }
      expect(votes, sl['votes']);
    });

    for (final c in (sl['cases'] as List).cast<Map<String, dynamic>>()) {
      final now = DateTime.parse(c['now'] as String);
      test('the times, the default and the message at ${c['now']}', () {
        for (final l in (c['lists'] as List).cast<Map<String, dynamic>>()) {
          final list = [for (final s in (l['slugs'] as List)) bySlug[s]!];
          final at = (l['slugs'] as List).join(',');
          expect(
            whenOptionsFor(list, now).map((o) => o.id.wire).toList(),
            l['options'],
            reason: '$at options',
          );
          expect(defaultWhenFor(list, now).wire, l['default'], reason: at);
          (l['messages'] as Map).forEach((w, want) {
            final when = WhenId.parse(w)!;
            expect(
              shortlistMessage(
                places: list,
                when: when,
                url: shortlistUrl(list, when, 'https://www.wainkw.com/'),
                now: now,
              ),
              want,
              reason: '$at $w',
            );
          });
        }
      });
    }
  });

  test('/find says what the web says, at all 288 moments', () {
    final cases = f['findMoment'] as List;
    expect(cases, hasLength(288));
    for (final c in cases) {
      final m = findMoment(c['hour'] as int, c['month'] as int);
      final at = '${c['month']}/${c['hour']}';
      expect(m.part.name, c['part'], reason: at);
      expect(findGreeting('شوق', m), c['shouq'], reason: at);
      expect(findGreeting('سالم', m), c['salem'], reason: at);
    }
  });
}
