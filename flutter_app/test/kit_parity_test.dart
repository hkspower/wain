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
import 'package:wain/share/hangout_calendar.dart';

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

    test('the gates agree with the web on how many places take orders or a queue', () {
      // A count against the web's own reading, not a zero: the catalogue
      // decides (docs/content.md says how many today), and a menu landing in
      // places.ts must move both sides together.
      final counts = f['orders'] as Map<String, dynamic>;
      expect(kPlaces.where(acceptsOrders).length, counts['orders']);
      expect(kPlaces.where(takesQueue).length, counts['queue']);
      expect(
        kPlaces.where((p) => acceptsOrders(p) && p.orderWhatsApp != null).length,
        counts['whatsapp'],
      );
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
          {'slugs': got.slugs, 'when': got.when?.wire, 'day': got.day},
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

    test('a vote carries the place\'s own dated link (3 October)', () {
      expect(kChoiceMax, sl['choiceMax']);
      final dated = <String>[];
      for (var i = 0; i < 2; i++) {
        for (final w in [WhenId.tonight8, WhenId.tomorrow, WhenId.weekend]) {
          final url = inviteUrl(
            kPlaces[i],
            w,
            'https://www.wainkw.com',
            '2026-10-02',
          );
          dated.add(shortlistVoteMessage(kPlaces[i], i, w, url, '2026-10-02'));
        }
      }
      expect(dated, sl['datedVotes']);
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

  // The day in the link (plan_date.dart): what a dated plan means, when it
  // has gone, and the phrase it is printed with — replayed at the web's
  // edges (month, year and leap rollover; every weekday for «الويكند»).
  group('the day in the link', () {
    final pl = f['plan'] as Map<String, dynamic>;
    HourKind kindOf(String s) =>
        s == 'default' ? HourKind.defaultHour : HourKind.values.byName(s);

    test('reading, adding and naming a day', () {
      for (final r in (pl['readDay'] as List).cast<Map>()) {
        expect(parseDay(r['s'] as String), r['out'], reason: r['s'] as String);
      }
      for (final r in (pl['addDays'] as List).cast<Map>()) {
        expect(addDays(r['d'] as String, r['n'] as int), r['out']);
      }
      for (final r in (pl['weekday'] as List).cast<Map>()) {
        expect(weekday(r['d'] as String), r['out'], reason: r['d'] as String);
      }
      for (final r in (pl['readDayFromLink'] as List).cast<Map>()) {
        expect(readInviteDay(r['s'] as String), r['out'], reason: r['s'] as String);
      }
    });

    test('resolvePlan, at ${(pl['resolve'] as List).length} readings', () {
      for (final r in (pl['resolve'] as List).cast<Map>()) {
        final got = resolvePlan(
          WhenId.parse(r['when'] as String)!,
          r['day'] as String,
          DateTime.parse(r['at'] as String),
        );
        final want = r['out'] as Map;
        expect(
          {
            'date': got.date,
            'hour': got.hour,
            'minute': got.minute,
            'kind': got.hourKind,
            'weekdayAr': got.weekdayAr,
            'passed': got.passed,
          },
          {
            'date': want['date'],
            'hour': want['hour'],
            'minute': want['minute'],
            'kind': kindOf(want['kind'] as String),
            'weekdayAr': want['weekdayAr'],
            'passed': want['passed'],
          },
          reason: '${r['when']} sent ${r['day']} read at ${r['at']}',
        );
      }
    });

    test('the phrase, dated and bare', () {
      for (final r in (pl['phrase'] as List).cast<Map>()) {
        expect(
          planPhrase(WhenId.parse(r['when'] as String)!, r['day'] as String),
          r['out'],
          reason: '${r['when']} ${r['day']}',
        );
      }
      for (final r in (pl['bare'] as List).cast<Map>()) {
        expect(planPhrase(WhenId.parse(r['when'] as String)!, null), r['out']);
      }
    });

    test('the links carry the day, and only when given one', () {
      final urls = pl['urls'] as List;
      expect(
        inviteUrl(kPlaces[0], WhenId.tomorrow, 'https://www.wainkw.com', '2026-10-03'),
        urls[0],
      );
      expect(inviteUrl(kPlaces[0], WhenId.tomorrow, 'https://www.wainkw.com'), urls[1]);
      expect(
        shortlistUrl([kPlaces[0], kPlaces[1]], WhenId.weekend, 'https://www.wainkw.com/', '2026-10-03'),
        urls[2],
      );
    });

    test('passed, with and without a day; which plans get a calendar entry', () {
      for (final r in (pl['passed'] as List).cast<Map>()) {
        expect(
          invitePassed(
            WhenId.parse(r['when'] as String)!,
            DateTime.parse(r['at'] as String),
            r['day'] as String?,
          ),
          r['out'],
          reason: '${r['when']} ${r['day']} ${r['at']}',
        );
      }
      for (final r in (pl['hasEntry'] as List).cast<Map>()) {
        expect(
          hasCalendarEntry(WhenId.parse(r['when'] as String)!, r['day'] as String?),
          r['out'],
          reason: '${r['when']} ${r['day']}',
        );
      }
    });
  });

  // «أضفها للتقويم»: the ICS text, the Google link and the file name, byte
  // for byte — a calendar app reads the bytes, so «equivalent» is not enough.
  test('the calendar entry is the web\'s, byte for byte', () {
    final cases = (f['calendar'] as List).cast<Map<String, dynamic>>();
    expect(cases, hasLength(24));
    for (final c in cases) {
      final place = bySlug[c['slug']]!;
      final when = WhenId.parse(c['when'] as String)!;
      final day = c['day'] as String;
      final at = DateTime.parse(c['at'] as String);
      expect(kuwaitDay(at), day);
      expect(inviteUrl(place, when, 'https://www.wainkw.com', day), c['url']);
      final e = calendarEntry(
        place: place,
        when: when,
        day: day,
        phrase: planPhrase(when, day),
        url: c['url'] as String,
        mapsUrl: mapsUrl(place),
        now: at,
      );
      final why = '${place.slug} ${c['when']} ${c['at']}';
      expect(e.ics, c['ics'], reason: why);
      expect(e.google, c['google'], reason: why);
      expect(e.filename, c['filename'], reason: why);
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
