/// Port of `src/lib/answer-order.ts` — which place شوق names first, one
/// ordering for the search screen and سالم's chat. The web file carries the
/// reasons; the order is: the search's score, then the Kuwaiti summer by day
/// (open-air 0.6, half-covered 0.9, unless the question chose the outdoors or
/// the evening) — or, when the question asks to be inside («داخلي», «مكيّف»),
/// open-air 0.3 and half-covered 0.7 in any month instead — then the hour
/// asked for («فطور», «وين أتغدى», «عشا»: 0.6 for a place whose best time is
/// another part of the day), then «رخيص» (0.5 above the cheapest band), then
/// the Google
/// figures within a band of near-equal matches (`reorderByReviews`). A
/// question with no topic gets the hour's default pick.
///
/// Replayed against the web's own answers in `test/search_parity_test.dart`
/// (the `answers` block of `search_parity.json`).
library;

import '../share/hangout.dart' show kuwaitHour, kuwaitMonth;
import 'models.dart';
import 'search.dart';
import 'search_data.g.dart' show kGoogleFigures, kNegators;
import 'voice_lines.dart' show isKuwaitNight, isSummerMonth;

/// Kuwait's month (0-based) and hour.
typedef AnswerClock = ({int month, int hour});

AnswerClock kuwaitClock([DateTime? now]) =>
    (month: kuwaitMonth(now), hour: kuwaitHour(now));

const double kSummerOutdoor = 0.6;
const double kSummerMixed = 0.9;
const double kNotCheap = 0.5;
const double kInsideOutdoor = 0.3;
const double kInsideMixed = 0.7;

Set<String> _fold(List<String> words) => {for (final w in words) normalise(w)};

final Set<String> _asksOutside = _fold(const [
  'ليل',
  'ليله',
  'سهره',
  'سهر',
  'اسهر',
  'نسهر',
  'مغرب',
  'غروب',
  'عشا',
  'عشاء', //
  'اتعشى', 'نتعشى', 'تعشى', 'برا', 'بره', 'مكشوف', 'بحر', 'شاطئ', 'شواطئ', //
  'بيتش', 'بر', 'كشته', 'صحراء', 'حديقه', 'حدائق',
]);

/// Words that ask to be inside. «مكيّف» folds to «مكيف».
final Set<String> _asksInside = _fold(const [
  'داخلي',
  'داخل',
  'مكيف',
  'مكيفه',
  'مسكر',
  'مغلق',
  'indoor',
]);
final Set<String> _asksCheap = _fold(const [
  'رخيص',
  'رخيصه',
  'ارخص',
  'ميزانيه',
  'اقتصادي',
  'بلاش',
  'ببلاش',
]);
final Set<String> _dear = _fold(const ['غالي', 'غاليه', 'مكلف']);

/// The part of the day a question names, by a meal or by the hour.
enum DayPart { morning, midday, evening }

/// «فطور», «وين أتغدى», «عشا» — and «الصبح», «الظهر», «الليلة». The web's
/// `ASKS_PART`, in the same order.
final List<(DayPart, Set<String>)> _asksPart = [
  (
    DayPart.morning,
    _fold(const [
      'فطور', 'فطار', 'افطر', 'نفطر', 'ريوق', 'صبح', 'صباحا', 'بدري', //
      'breakfast', 'morning',
    ]),
  ),
  (
    DayPart.midday,
    _fold(const [
      'غدا', 'غداء', 'اتغدى', 'نتغدى', 'تغدى', 'ظهر', 'lunch', 'noon', //
    ]),
  ),
  (
    DayPart.evening,
    _fold(const [
      'عشا', 'عشاء', 'اتعشى', 'نتعشى', 'تعشى', 'ليل', 'ليله', 'سهره', 'سهر', //
      'اسهر', 'نسهر', 'مغرب', 'غروب', 'dinner', 'night', 'evening', 'tonight',
    ]),
  ),
];

/// How a place's best time names each part — what the asked part is held to.
final Map<DayPart, RegExp> _partOfBest = {
  DayPart.morning: RegExp('(الصبح|بدري|الفطور|الريوق)'),
  DayPart.midday: RegExp('(الظهر|الغدا)'),
  DayPart.evening: RegExp('(المغرب|الغروب|الليل|ليالي|العشا|السهر)'),
};

/// How much a place whose best time names ANOTHER part keeps of its score.
const double kOtherPart = 0.6;

typedef Asks = ({bool outside, bool cheap, bool inside, DayPart? part});
final Set<String> _negators = _fold(kNegators);
final RegExp _clitic = RegExp('^(عال|بال|وال|لل|[وبلفع])');

List<String> _readings(String t) {
  final out = [t];
  final bare = t.replaceFirst(_clitic, '');
  if (bare != t && bare.length > 1) {
    out.add(
      bare.startsWith('ال') && bare.length > 3 ? bare.substring(2) : bare,
    );
  }
  return out;
}

/// What the question asks of the answer, beyond what it matches.
Asks readAsks(String query) {
  final raw = tokenize(query);
  bool has(Set<String> set) => raw.any((t) => _readings(t).any(set.contains));
  var notDear = false;
  for (var i = 0; i < raw.length; i++) {
    if (_dear.contains(raw[i]) && raw.take(i).any(_negators.contains)) {
      notDear = true;
    }
  }
  // One part, or none: «فطور وعشا» names no single hour to hold places to.
  final parts = [
    for (final (part, set) in _asksPart)
      if (has(set)) part,
  ];
  return (
    outside: has(_asksOutside),
    cheap: has(_asksCheap) || notDear,
    inside: has(_asksInside),
    part: parts.length == 1 ? parts.first : null,
  );
}

/// The multiplier the season, the price and the hour asked for put on one
/// place's score.
double answerFactor(Place p, Asks asks, AnswerClock clock) {
  var f = 1.0;
  // A place whose best time is another part of the day than the one asked
  // for; one that names no part, or names this one too, is left alone.
  final part = asks.part;
  if (part != null && p.bestTimeAr.isNotEmpty) {
    final best = p.bestTimeAr;
    final fits = _partOfBest[part]!.hasMatch(best);
    final other = DayPart.values.any(
      (k) => k != part && _partOfBest[k]!.hasMatch(best),
    );
    if (!fits && other) f *= kOtherPart;
  }
  if (asks.inside) {
    // Said, not inferred: no season and no `summerOk` changes it.
    if (p.setting == 'outdoor') {
      f *= kInsideOutdoor;
    } else if (p.setting == 'mixed') {
      f *= kInsideMixed;
    }
  } else if (isSummerMonth(clock.month) &&
      !isKuwaitNight(clock.hour) &&
      !asks.outside &&
      p.summerOk != true) {
    if (p.setting == 'outdoor') {
      f *= kSummerOutdoor;
    } else if (p.setting == 'mixed') {
      f *= kSummerMixed;
    }
  }
  if (asks.cheap && p.priceLevel > 1) f *= kNotCheap;
  return f;
}

// ── reviews (`place-reviews.ts`) ───────────────────────────────────────────

const double _prior = 4.4;
const double _priorWeight = 250;
const double _band = 0.85;
const double _minGain = 0.1;

double? reviewScore(String slug) {
  final f = kGoogleFigures[slug];
  if (f == null || f.$2 == null) return null;
  final n = f.$2! * (f.$3 ? 1 : 0.5);
  return (_priorWeight * _prior + n * f.$1) / (_priorWeight + n);
}

List<T> reorderByReviews<T>(
  List<T> hits,
  double Function(T) score,
  String Function(T) slugOf,
) {
  final out = <T>[];
  for (var i = 0; i < hits.length;) {
    final lead = score(hits[i]);
    var j = i + 1;
    while (j < hits.length && score(hits[j]) >= _band * lead) {
      j++;
    }
    final band = <(T, double?)>[];
    for (final h in hits.sublist(i, j)) {
      final r = reviewScore(slugOf(h));
      var at = band.length;
      if (r != null) {
        while (at > 0) {
          final ahead = band[at - 1].$2;
          if (ahead == null || r - ahead < _minGain) break;
          at--;
        }
      }
      band.insert(at, (h, r));
    }
    out.addAll(band.map((x) => x.$1));
    i = j;
  }
  return out;
}

// ── the default pick ───────────────────────────────────────────────────────

class _Slot {
  final bool Function(AnswerClock) when;
  final List<String> tags;
  final bool indoorOnly;
  final bool outdoorOnly;
  const _Slot(
    this.when,
    this.tags, {
    this.indoorOnly = false,
    this.outdoorOnly = false,
  });
}

final List<_Slot> _slots = [
  _Slot((c) => isSummerMonth(c.month) && !isKuwaitNight(c.hour), const [
    'مكيّف',
    'مطاعم',
  ], indoorOnly: true),
  _Slot((c) => c.hour >= 17 || c.hour < 5, const ['سهرة', 'بحر']),
  _Slot((c) => c.hour < 11, const ['مشي'], outdoorOnly: true),
  _Slot((_) => true, const ['بحر', 'ممشى']),
];

final List<({int from, int to, RegExp words})> _parts = [
  (from: 5, to: 12, words: RegExp('(الصبح|بدري)')),
  (from: 12, to: 17, words: RegExp('(العصر|الظهر|الغدا)')),
  (from: 17, to: 29, words: RegExp('(المغرب|الغروب|الليل|ليالي|العشا)')),
];

bool _fitsHour(String bestTimeAr, int hour) {
  final h = hour < 5 ? hour + 24 : hour;
  for (final x in _parts) {
    if (h >= x.from && h < x.to) return x.words.hasMatch(bestTimeAr);
  }
  return false;
}

/// A pick for a question with no topic, by the hour and the season.
List<Place> defaultPicks(
  List<Place> places,
  AnswerClock clock, {
  int limit = 8,
}) {
  final slot = _slots.firstWhere((s) => s.when(clock));
  final scored = <({Place p, int i, int n, int fits})>[];
  for (var i = 0; i < places.length; i++) {
    final p = places[i];
    final n = slot.tags.where(p.tagsAr.contains).length;
    if (n == 0) continue;
    if (slot.indoorOnly && p.setting != 'indoor') continue;
    if (slot.outdoorOnly && p.setting == 'indoor') continue;
    scored.add((
      p: p,
      i: i,
      n: n,
      fits: _fitsHour(p.bestTimeAr, clock.hour) ? 1 : 0,
    ));
  }
  scored.sort((a, b) {
    if (b.n != a.n) return b.n - a.n;
    if (b.fits != a.fits) return b.fits - a.fits;
    final r = (b.p.rating ?? 0).compareTo(a.p.rating ?? 0);
    if (r != 0) return r;
    return a.i - b.i;
  });
  return [for (final x in scored.take(limit)) x.p];
}

String _slugOf(SearchHit h) => h.doc.id.replaceFirst('place:', '');

/// The search's hits in the order the answer gives them; only place hits
/// move, among the slots places already hold. [fallback] when the question
/// had no topic and these are the hour's default picks.
({List<SearchHit> hits, bool fallback}) answerOrder(
  String query,
  List<SearchHit> hits,
  SearchIndex index,
  List<Place> places, [
  AnswerClock? clock,
]) {
  final c = clock ?? kuwaitClock();
  if (isTopicless(query)) {
    final docs = {for (final d in index.docs) d.id: d};
    final picked = <SearchHit>[];
    final picks = defaultPicks(places, c);
    for (var i = 0; i < picks.length; i++) {
      final doc = docs['place:${picks[i].slug}'];
      if (doc != null) picked.add(SearchHit(doc, 1 - i / 100, const []));
    }
    return (hits: picked, fallback: true);
  }

  final asks = readAsks(query);
  final bySlug = {for (final p in places) p.slug: p};
  final scored = <(SearchHit, double)>[];
  for (final h in hits) {
    if (h.doc.kind != 'place') continue;
    final p = bySlug[_slugOf(h)];
    scored.add((h, h.score * (p == null ? 1 : answerFactor(p, asks, c))));
  }
  // Stable, as `Array#sort` is.
  final decorated = [for (var i = 0; i < scored.length; i++) (i, scored[i])];
  decorated.sort((x, y) {
    final d = y.$2.$2.compareTo(x.$2.$2);
    return d != 0 ? d : x.$1.compareTo(y.$1);
  });
  final sorted = [for (final d in decorated) d.$2];
  final ordered = reorderByReviews<(SearchHit, double)>(
    sorted,
    (x) => x.$2,
    (x) => _slugOf(x.$1),
  ).map((x) => x.$1).toList();
  var k = 0;
  return (
    hits: [for (final h in hits) h.doc.kind == 'place' ? ordered[k++] : h],
    fallback: false,
  );
}

/// The ordered places behind [answerOrder]'s hits — what the answer and the
/// chat's cards are made of.
List<Place> placesOf(List<SearchHit> hits, List<Place> places) {
  final bySlug = {for (final p in places) p.slug: p};
  return [
    for (final h in hits)
      if (h.doc.kind == 'place') ?bySlug[_slugOf(h)],
  ];
}
