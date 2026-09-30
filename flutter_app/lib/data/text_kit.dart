/// Arabic-Indic digits and count agreement — a faithful Dart port of
/// `toArabicDigits`/`countAr` in `src/lib/place-kit.ts`. Kept by hand (not
/// generated) because it is logic, not catalogue data; CLAUDE.md records this
/// exact class of bug — Arabic count agreement written by hand and gotten
/// wrong — being made three separate times on the web side, so this follows
/// the source function's rules exactly rather than re-deriving them.
library;

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

const kPlacesCount = CountForms(
  zero: 'ما فيه أماكن',
  one: 'مكان واحد',
  two: 'مكانين',
  few: 'أماكن',
  many: 'مكان',
);
