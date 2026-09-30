// Arabic count agreement is the one class of bug this repo's own CLAUDE.md
// records being written by hand and gotten wrong three separate times on the
// web side (durations, then /search's own result count). Asserted here so
// the native port can't repeat it silently.

import 'package:flutter_test/flutter_test.dart';
import 'package:wain/data/text_kit.dart';

void main() {
  test('toArabicDigits converts only the digits', () {
    expect(toArabicDigits(0), '٠');
    expect(toArabicDigits(17), '١٧');
    expect(toArabicDigits('4.7'), '٤.٧');
  });

  test('countAr agrees with the Arabic numeral rule', () {
    expect(countAr(0, kResultsCount), 'ما فيه نتائج');
    expect(countAr(1, kResultsCount), 'نتيجة وحدة');
    expect(countAr(2, kResultsCount), 'نتيجتين');
    expect(countAr(3, kResultsCount), '٣ نتائج');
    expect(countAr(10, kResultsCount), '١٠ نتائج');
    expect(countAr(11, kResultsCount), '١١ نتيجة');
    expect(countAr(17, kResultsCount), '١٧ نتيجة');
    expect(countAr(52, kResultsCount), '٥٢ نتيجة');
    // 103 % 100 == 3, which is back in the 3–10 "few" band — the rule
    // repeats every hundred, not just below it.
    expect(countAr(103, kResultsCount), '١٠٣ نتائج');
  });
}
