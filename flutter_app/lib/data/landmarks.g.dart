// GENERATED — do not edit by hand.
// Produced by scripts/gen-landmarks.mjs from brand-source/landmarks/ (the
// web's src/lib/landmarks.g.ts lists the same eight). Re-run
// `npm run landmarks` after replacing a picture.

class LandmarkPicture {
  const LandmarkPicture(
    this.slug,
    this.asset, {
    required this.focusX,
    required this.focusY,
    required this.alt,
    required this.standIn,
    this.cardAsset,
  });
  final String slug;
  final String asset;

  /// The card's strip, cut around the landmark when it was made (3:1) — the
  /// web's card file. Null outside the five «معالم الكويت» places.
  final String? cardAsset;

  /// Where the landmark sits, as fractions of the picture's width and height.
  final double focusX, focusY;

  /// What the approved picture shows; only a place page's picture uses it.
  final String alt;

  /// A drawn placeholder rather than the approved picture.
  final bool standIn;
}

/// All eight, by slug.
const Map<String, LandmarkPicture> kLandmarkPictures = {
  'kuwait-towers': LandmarkPicture('kuwait-towers', 'assets/img/landmarks/kuwait-towers.webp', focusX: 0.52, focusY: 0.42, alt: 'رسم مؤقت: أبراج الكويت', standIn: true, cardAsset: 'assets/img/landmarks/kuwait-towers-card.webp'),
  'liberation-tower': LandmarkPicture('liberation-tower', 'assets/img/landmarks/liberation-tower.webp', focusX: 0.5, focusY: 0.3, alt: 'رسم مؤقت: برج التحرير', standIn: true, cardAsset: 'assets/img/landmarks/liberation-tower-card.webp'),
  'grand-mosque': LandmarkPicture('grand-mosque', 'assets/img/landmarks/grand-mosque.webp', focusX: 0.5, focusY: 0.42, alt: 'رسم مؤقت: المسجد الكبير', standIn: true),
  'seif-palace': LandmarkPicture('seif-palace', 'assets/img/landmarks/seif-palace.webp', focusX: 0.5, focusY: 0.3, alt: 'رسم مؤقت: قصر السيف', standIn: true, cardAsset: 'assets/img/landmarks/seif-palace-card.webp'),
  'souq-al-mubarakiya': LandmarkPicture('souq-al-mubarakiya', 'assets/img/landmarks/souq-al-mubarakiya.webp', focusX: 0.5, focusY: 0.45, alt: 'رسم مؤقت: سوق المباركية', standIn: true),
  'marina-beach': LandmarkPicture('marina-beach', 'assets/img/landmarks/marina-beach.webp', focusX: 0.6, focusY: 0.62, alt: 'رسم مؤقت: شاطئ المارينا', standIn: true),
  'al-hamra-tower': LandmarkPicture('al-hamra-tower', 'assets/img/landmarks/al-hamra-tower.webp', focusX: 0.52, focusY: 0.35, alt: 'رسم مؤقت: برج الحمراء', standIn: true, cardAsset: 'assets/img/landmarks/al-hamra-tower-card.webp'),
  'sheikh-jaber-causeway': LandmarkPicture('sheikh-jaber-causeway', 'assets/img/landmarks/sheikh-jaber-causeway.webp', focusX: 0.55, focusY: 0.5, alt: 'رسم مؤقت: جسر الشيخ جابر', standIn: true, cardAsset: 'assets/img/landmarks/sheikh-jaber-causeway-card.webp'),
};

/// The slideshow under the home hero, in the order it plays.
final List<LandmarkPicture> kLandmarks = [
  kLandmarkPictures['kuwait-towers']!,
  kLandmarkPictures['liberation-tower']!,
  kLandmarkPictures['grand-mosque']!,
  kLandmarkPictures['seif-palace']!,
  kLandmarkPictures['souq-al-mubarakiya']!,
  kLandmarkPictures['marina-beach']!,
];

/// The places whose card and page carry their picture.
const Set<String> kLandmarkPlaceSlots = {'kuwait-towers', 'liberation-tower', 'seif-palace', 'al-hamra-tower', 'sheikh-jaber-causeway'};
