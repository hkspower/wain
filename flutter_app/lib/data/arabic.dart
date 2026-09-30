/// Port of `src/lib/arabic.ts`: the letters Kuwaitis write that the rest of
/// the stack does not know. One table, read by search (`normalise`) and by the
/// speech path (`forSpeech`). What is on the page never changes.
library;

/// Ordered, because the substitutions must not feed each other.
final List<(RegExp, String)> _gulfLetters = [
  (RegExp('چ'), 'تش'),
  (RegExp('پ'), 'ب'),
  (RegExp('[ڤﭪ]'), 'ف'),
  (RegExp('ژ'), 'ج'),
  (RegExp('[گݣڬ]'), 'ق'),
  (RegExp('ی'), 'ي'),
  (RegExp('ک'), 'ك'),
  (RegExp('ھ'), 'ه'),
  (RegExp('ٱ'), 'ا'),
];

String toStandardArabic(String text) {
  var out = text;
  for (final (from, to) in _gulfLetters) {
    out = out.replaceAll(from, to);
  }
  return out;
}
