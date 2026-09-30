/// Data shapes for the catalogue. Mirrors the `Place`/`Category` interfaces
/// in `src/lib/places.ts` and `src/lib/place-kit.ts` field for field — kept
/// by hand because it is a *type*, not data, and generating a type from a
/// TypeScript interface is more machinery than eight fields are worth. If a
/// field is added on the TypeScript side, `flutter:catalogue` will fail to
/// compile against this file, which is the signal to update it here too.
library;

class Category {
  final String id;
  final String ar;
  final String en;
  final String icon;
  final String blurbAr;

  const Category({
    required this.id,
    required this.ar,
    required this.en,
    required this.icon,
    required this.blurbAr,
  });
}

class Place {
  final String slug;
  final String name;
  final String nameAr;
  final String category;
  final String area;
  final String areaAr;
  final double lat;
  final double lng;
  final double? rating;
  final int priceLevel;
  final String emoji;
  final String taglineAr;
  final String descriptionAr;
  final List<String> highlightsAr;
  final String bestTimeAr;
  final String setting; // "indoor" | "outdoor" | "mixed"
  final String seasonAr;
  final List<String> tagsAr;
  final bool featured;
  final bool? shisha;
  final bool? summerOk;

  const Place({
    required this.slug,
    required this.name,
    required this.nameAr,
    required this.category,
    required this.area,
    required this.areaAr,
    required this.lat,
    required this.lng,
    this.rating,
    required this.priceLevel,
    required this.emoji,
    required this.taglineAr,
    required this.descriptionAr,
    required this.highlightsAr,
    required this.bestTimeAr,
    required this.setting,
    required this.seasonAr,
    required this.tagsAr,
    this.featured = false,
    this.shisha,
    this.summerOk,
  });
}
