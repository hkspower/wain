/// The catalogue as the screens use it: lookup, featured, the related places
/// on a place page, and one shared search index (building it tokenises every
/// document, so it is built once and kept).
library;

import 'categories.g.dart';
import 'models.dart';
import 'places.g.dart';
import 'search.dart';
import 'text_kit.dart';

Place? getPlace(String slug) {
  for (final p in kPlaces) {
    if (p.slug == slug) return p;
  }
  return null;
}

Category? getCategory(String id) {
  for (final c in kCategories) {
    if (c.id == id) return c;
  }
  return null;
}

List<Place> featuredPlaces() => kPlaces.where((p) => p.featured).toList();

SearchIndex? _index;
SearchIndex get searchIndex => _index ??= SearchIndex.build();

/// «أماكن مشابهة»: the same category nearest first, then the nearest of
/// anything else, three in all — the order `places/[slug]/page.tsx` uses.
List<Place> relatedPlaces(Place place) {
  double d(Place p) =>
      distanceKm((lat: place.lat, lng: place.lng), (lat: p.lat, lng: p.lng));
  final same =
      kPlaces
          .where((p) => p.category == place.category && p.slug != place.slug)
          .toList()
        ..sort((a, b) => d(a).compareTo(d(b)));
  final other =
      kPlaces
          .where((p) => p.slug != place.slug && p.category != place.category)
          .toList()
        ..sort((a, b) => d(a).compareTo(d(b)));
  return [...same, ...other].take(3).toList();
}

double awayKm(Place from, Place to) =>
    distanceKm((lat: from.lat, lng: from.lng), (lat: to.lat, lng: to.lng));

/// The explore screen's own filter: a forgiving substring match over the same
/// five fields `ExploreClient.tsx` joins, after the same light folding. (The
/// /search screen is the ranked engine; this is a list filter.)
String _fold(String v) => v
    .toLowerCase()
    .replaceAll(RegExp('[ً-ٰٞ]'), '')
    .replaceAll(RegExp('[أإآٱ]'), 'ا')
    .replaceAll('ى', 'ي')
    .replaceAll('ة', 'ه')
    .replaceAll('ـ', '')
    .trim();

List<Place> filterPlaces(
  List<Place> all, {
  String? category,
  String query = '',
}) {
  final q = _fold(query);
  return all.where((p) {
    if (category != null && p.category != category) return false;
    if (q.isEmpty) return true;
    final hay = _fold(
      '${p.nameAr} ${p.name} ${p.areaAr} ${p.area} ${p.taglineAr}',
    );
    return hay.contains(q);
  }).toList();
}
