/// Arabic-Indic digits, count agreement, distances, variants and the two
/// catalogue predicates — a faithful Dart port of the matching helpers in
/// `src/lib/place-kit.ts`, replayed against the web's own answers in
/// `test/place_kit_parity_test.dart`. Kept by hand (not
/// generated) because it is logic, not catalogue data; CLAUDE.md records this
/// exact class of bug — Arabic count agreement written by hand and gotten
/// wrong — being made three separate times on the web side, so this follows
/// the source function's rules exactly rather than re-deriving them.
library;

import 'dart:math' as math;

import 'models.dart';

const _arabicDigits = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];

String toArabicDigits(Object value) {
  final s = value.toString();
  final buf = StringBuffer();
  for (final ch in s.split('')) {
    final d = int.tryParse(ch);
    buf.write(d != null ? _arabicDigits[d] : ch);
  }
  return buf.toString();
}

class CountForms {
  final String one;
  final String two;
  final String few;
  final String many;
  final String? zero;
  const CountForms({
    required this.one,
    required this.two,
    required this.few,
    required this.many,
    this.zero,
  });
}

/// "1 takes the singular alone, 2 takes the dual, 3–10 take the plural, and
/// 11+ revert to the singular." — countAr's own comment, unchanged here.
String countAr(int n, CountForms forms) {
  final digits = toArabicDigits(n);
  if (n == 0) return forms.zero ?? '$digits ${forms.many}';
  if (n == 1) return forms.one;
  if (n == 2) return forms.two;
  final mod100 = n % 100;
  if (mod100 >= 3 && mod100 <= 10) return '$digits ${forms.few}';
  return '$digits ${forms.many}';
}

const kResultsCount = CountForms(
  zero: 'ما فيه نتائج',
  one: 'نتيجة وحدة',
  two: 'نتيجتين',
  few: 'نتائج',
  many: 'نتيجة',
);

/// «صوت واحد» / «صوتين» / «٣ أصوات» — a shortlist's tally (the web's
/// VOTES_COUNT).
const kVotesCount = CountForms(
  zero: 'ما فيه أصوات',
  one: 'صوت واحد',
  two: 'صوتين',
  few: 'أصوات',
  many: 'صوت',
);

const kPlacesCount = CountForms(
  zero: 'ما فيه أماكن',
  one: 'مكان واحد',
  two: 'مكانين',
  few: 'أماكن',
  many: 'مكان',
);

const kMinutesCount = CountForms(
  one: 'دقيقة',
  two: 'دقيقتين',
  few: 'دقايق',
  many: 'دقيقة',
);

const kHoursCount = CountForms(
  one: 'ساعة',
  two: 'ساعتين',
  few: 'ساعات',
  many: 'ساعة',
);

/// A decimal in Arabic — digits AND the separator. `toArabicDigits` alone
/// leaves a Latin dot, which in Arabic is the THOUSANDS mark: ٤.٧ reads as
/// forty-seven hundred. U+066B is the Arabic decimal separator.
String toArabicNumber(num value, [int digits = 1]) =>
    toArabicDigits(_toFixed(value, digits)).replaceFirst('.', '٫');

/// JavaScript's `Number#toFixed` rounds half away from zero on the decimal
/// expansion; Dart's rounds the same way for the values used here.
String _toFixed(num v, int digits) => v.toStringAsFixed(digits);

/// How far one place is from another, said the way a person says it:
/// metres below a kilometre, one decimal above; [rough] for pins that are the
/// right AREA rather than the right building.
String distanceAr(double km, {bool rough = false}) {
  if (rough) {
    return km < 1
        ? 'قريب جداً'
        : '${toArabicNumber(_jsRound(km * 2) / 2)} كم تقريباً';
  }
  if (km < 1)
    return '${toArabicDigits((_jsRound(km * 1000 / 100) * 100).toInt())} متر';
  final one = _jsRound(km * 10) / 10;
  return '${one == one.truncateToDouble() ? toArabicDigits(one.toInt()) : toArabicNumber(one)} كم';
}

/// `Math.round`: halves go UP (toward +∞), unlike Dart's away-from-zero.
double _jsRound(double x) => (x + 0.5).floorToDouble();

/// Great-circle distance in kilometres.
double distanceKm(({double lat, double lng}) a, ({double lat, double lng}) b) {
  const r = 6371.0;
  final dLat = (b.lat - a.lat) * math.pi / 180;
  final dLng = (b.lng - a.lng) * math.pi / 180;
  final lat1 = a.lat * math.pi / 180;
  final lat2 = b.lat * math.pi / 180;
  final h =
      math.pow(math.sin(dLat / 2), 2) +
      math.pow(math.sin(dLng / 2), 2) * math.cos(lat1) * math.cos(lat2);
  return 2 * r * math.asin(math.sqrt(h));
}

/// Stable 0–3 derived from the slug (`placeVariant`): places in one category
/// share a scene, and this mirrors or shifts it so each card is its own.
int placeVariant(String slug) {
  var h = 0;
  for (final c in slug.codeUnits) {
    h = (h * 38 + c) % 65521;
  }
  return h % 4;
}

/// A menu alone is not consent to take orders.
bool acceptsOrders(Place p) => p.acceptsOrdersFlag && p.menuAr.isNotEmpty;

bool takesQueue(Place p) => p.takesQueueFlag && p.salonKind != null;
