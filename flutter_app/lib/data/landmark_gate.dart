/// Whether a generated landmark picture may be shown — the web's
/// landmark-gate.ts.
///
/// The pictures of «معالم الكويت» (scripts/gen-landmarks.mjs) were built on
/// drawn stand-ins, because the real ones could not be generated yet, and a
/// drawing must not reach a phone where the owner asked for a realistic
/// picture. So every slot asks this first:
///
///   - the slideshow under the home hero is all or nothing (`kShowLandmarks`
///     in home_screen.dart) — half real and half drawn would be worse than the
///     section not being there;
///   - a card or a place page's top goes place by place ([placePictureOf]) — a
///     place whose picture is not ready keeps its icon and its drawing, which
///     is what it had before.
///
/// `--dart-define=WAIN_SHOW_STANDINS=true` shows the stand-ins in a build
/// meant for looking at.
library;

import 'package:flutter/foundation.dart';

import 'landmarks.g.dart';

/// Mutable so a test can flip it, the way `debugTileUrl` is; the app only
/// ever reads the build's define.
@visibleForTesting
bool debugShowStandIns = const bool.fromEnvironment('WAIN_SHOW_STANDINS');

bool shownPicture(LandmarkPicture p) => !p.standIn || debugShowStandIns;

/// The picture a place's card and page top carry: one of the five
/// «معالم الكويت» places, and only once its picture may be shown.
LandmarkPicture? placePictureOf(String slug) {
  if (!kLandmarkPlaceSlots.contains(slug)) return null;
  final p = kLandmarkPictures[slug];
  return p != null && shownPicture(p) ? p : null;
}
