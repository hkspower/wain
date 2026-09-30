/// A simplified port of `src/lib/search.ts`'s matching (not its ranking).
///
/// The web index scores and orders by relevance across many signals; this
/// first native slice only needs "does this place match the filter" for a
/// plain list, so it keeps the field set search.ts matches against
/// (nameAr, areaAr, tagsAr, descriptionAr) without reimplementing the score.
/// Note the deliberate omission recorded in CLAUDE.md's areas section: a
/// free-text match against `areaAr` is intentionally A SUBSTRING match here,
/// same as the web's free-text box — an exact-area filter is a different,
/// stricter operation the category chips do not attempt to replace.
library;

import 'models.dart';

bool _contains(String haystack, String needle) =>
    haystack.toLowerCase().contains(needle.toLowerCase());

List<Place> filterPlaces(
  List<Place> all, {
  String? category,
  String query = '',
}) {
  final q = query.trim();
  return all.where((p) {
    if (category != null && p.category != category) return false;
    if (q.isEmpty) return true;
    if (_contains(p.nameAr, q)) return true;
    if (_contains(p.areaAr, q)) return true;
    if (_contains(p.descriptionAr, q)) return true;
    for (final tag in p.tagsAr) {
      if (_contains(tag, q)) return true;
    }
    return false;
  }).toList();
}
