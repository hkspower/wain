// GENERATED — do not edit by hand.
// Produced by scripts/gen-landmarks.mjs from brand-source/landmarks/ (the
// web's src/lib/landmarks.g.ts lists the same six). Re-run
// `npm run landmarks` after replacing a picture.

class LandmarkPicture {
  const LandmarkPicture(this.slug, this.asset, {required this.standIn});
  final String slug;
  final String asset;

  /// A drawn placeholder rather than the approved picture.
  final bool standIn;
}

const List<LandmarkPicture> kLandmarks = [
  LandmarkPicture('kuwait-towers', 'assets/img/landmarks/kuwait-towers.webp', standIn: true),
  LandmarkPicture('liberation-tower', 'assets/img/landmarks/liberation-tower.webp', standIn: true),
  LandmarkPicture('grand-mosque', 'assets/img/landmarks/grand-mosque.webp', standIn: true),
  LandmarkPicture('seif-palace', 'assets/img/landmarks/seif-palace.webp', standIn: true),
  LandmarkPicture('souq-al-mubarakiya', 'assets/img/landmarks/souq-al-mubarakiya.webp', standIn: true),
  LandmarkPicture('marina-beach', 'assets/img/landmarks/marina-beach.webp', standIn: true),
];
