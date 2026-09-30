/// Data shapes for the catalogue. Mirrors the `Place`/`Category`/`MenuItem`
/// interfaces in `src/lib/places.ts`, `place-kit.ts` and `orders.ts` field for
/// field — kept by hand because it is a *type*, not data, and generating a
/// type from a TypeScript interface is more machinery than a field list is
/// worth. The VALUES are generated (`npm run flutter:catalogue`), and the
/// generator emits every field the TypeScript type has, so a field added on
/// the web side that this file lacks fails to compile rather than vanishing.
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

/// A priced item a customer can order ahead (`MenuItem` in `orders.ts`).
class MenuItem {
  final String id;
  final String nameAr;

  /// Integer fils.
  final int priceFils;
  final String? noteAr;
  final bool soldOut;

  const MenuItem({
    required this.id,
    required this.nameAr,
    required this.priceFils,
    this.noteAr,
    this.soldOut = false,
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

  /// True when the coordinates were drafted from general knowledge and never
  /// checked against a map. The pin is still drawn.
  final bool coordsUnverified;

  /// Absent means «we do not have one yet», never zero.
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

  /// Tri-state on purpose: null is «we do not know», and nothing renders the
  /// negative — saying a place has no shisha because our data is thin is worse
  /// than saying nothing.
  final bool? shisha;
  final bool? summerOk;

  // Business profile — absent on every shipped place today.
  final String? logoUrl;
  final String? bioAr;
  final List<String> imageUrls;
  final String? phone;
  final String? instagram;
  final String? website;
  final List<String> productsAr;

  // Order ahead. Gated by [acceptsOrders] in place_kit.dart: a menu alone is
  // not consent to take orders.
  final List<MenuItem> menuAr;
  final bool acceptsOrdersFlag;
  final String? orderNoteAr;
  final int? orderPrepMinutes;

  // Salon queue.
  final String? salonKind; // "men" | "women"
  final bool takesQueueFlag;
  final int? queueServiceMinutes;

  const Place({
    required this.slug,
    required this.name,
    required this.nameAr,
    required this.category,
    required this.area,
    required this.areaAr,
    required this.lat,
    required this.lng,
    this.coordsUnverified = false,
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
    this.logoUrl,
    this.bioAr,
    this.imageUrls = const [],
    this.phone,
    this.instagram,
    this.website,
    this.productsAr = const [],
    this.menuAr = const [],
    this.acceptsOrdersFlag = false,
    this.orderNoteAr,
    this.orderPrepMinutes,
    this.salonKind,
    this.takesQueueFlag = false,
    this.queueServiceMinutes,
  });
}
