/// A landmark's generated picture (landmarks.g.dart) as widgets: cut around
/// the landmark wherever its box is another shape, and whole at the top of its
/// place's page. Whether one may be shown at all is landmark_gate.dart's
/// question, asked by the caller.
library;

import 'package:flutter/material.dart';

import '../data/landmarks.g.dart';
import '../data/models.dart';
import '../theme/app_theme.dart';
import '../theme/colors.dart';
import 'art.dart';
import 'illustrative_tag.dart';

/// The picture, covering its box. `focus` is where the landmark sits in it, and
/// it becomes the alignment — the web's object-position — so a box of another
/// shape crops around the tower rather than around the middle of the sky.
///
/// A drawn stand-in is only ever shown in a build meant for looking at
/// (landmark_gate.dart), and there it says what it is, as on the web: an orange
/// «رسم مؤقت» at [flag], away from where the «صورة توضيحية» tag sits.
class LandmarkImage extends StatelessWidget {
  const LandmarkImage(
    this.picture, {
    super.key,
    this.strip = false,
    this.flag = AlignmentDirectional.topEnd,
    this.showFlag = true,
  });

  final LandmarkPicture picture;

  /// A card's band: the 3:1 strip cut around the landmark when it was made —
  /// the web's card file, shown the way the web shows it (cover, centred), so
  /// the band shows the same part of the landmark in both.
  final bool strip;

  final AlignmentDirectional flag;

  /// False when the caller places the flag itself: the slideshow's picture
  /// drifts, and a flag inside it drifted half out of the box.
  final bool showFlag;

  @override
  Widget build(BuildContext context) {
    final image = Image.asset(
      strip ? picture.cardAsset! : picture.asset,
      fit: BoxFit.cover,
      alignment: strip
          ? Alignment.center
          : Alignment(picture.focusX * 2 - 1, picture.focusY * 2 - 1),
      width: double.infinity,
      height: double.infinity,
      excludeFromSemantics: true,
      gaplessPlayback: true,
    );
    if (!picture.standIn || !showFlag) return image;
    return Stack(
      fit: StackFit.expand,
      children: [
        image,
        Align(
          alignment: flag,
          child: StandInFlag(at: flag),
        ),
      ],
    );
  }
}

/// «رسم مؤقت»: the web's preview flag (GeneratedPicture.tsx), rounded on the
/// corner that faces into the picture.
class StandInFlag extends StatelessWidget {
  const StandInFlag({super.key, required this.at});

  final AlignmentDirectional at;

  static const String text = 'رسم مؤقت';

  @override
  Widget build(BuildContext context) {
    const r = Radius.circular(8);
    // Against an edge it rounds the side facing in; in a corner, the one
    // corner that does.
    final radius = at.y > -1
        ? const BorderRadiusDirectional.horizontal(start: r)
        : const BorderRadiusDirectional.only(bottomStart: r);
    return ExcludeSemantics(
      child: IgnorePointer(
        child: DecoratedBox(
          decoration: BoxDecoration(
            color: WainColors.sun700,
            borderRadius: radius.resolve(Directionality.of(context)),
          ),
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 1),
            child: Text(
              text,
              maxLines: 1,
              softWrap: false,
              style: wainText(
                WainText.s2xs,
                weight: FontWeight.w700,
                color: Colors.white,
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// The top of a «معالم الكويت» place's page: its picture shown whole at 3:2,
/// no wider than 576 — the web's `aspect-[3/2] max-w-xl` — at the start edge
/// like the drawing it replaces. The drawing's 18:5 band would keep 42% of a
/// 3:2 picture's height, which on a tower is the middle of the shaft.
///
/// Tagged «صورة توضيحية», and its label says so in words: the tag is for eyes.
/// A stand-in's alt already says «رسم مؤقت», so it is not called a picture.
class PictureHero extends StatelessWidget {
  const PictureHero({
    super.key,
    required this.place,
    required this.picture,
    this.radius = const BorderRadius.all(Radius.circular(WainRadius.s2xl)),
  });

  final Place place;
  final LandmarkPicture picture;
  final BorderRadius radius;

  static const double maxWidth = 576;

  String get label =>
      picture.standIn ? picture.alt : '${IllustrativeTag.text}: ${picture.alt}';

  @override
  Widget build(BuildContext context) {
    return ConstrainedBox(
      constraints: const BoxConstraints(maxWidth: maxWidth),
      child: AspectRatio(
        aspectRatio: 3 / 2,
        child: DecoratedBox(
          // The drawing's ground stays under the picture: it is what shows
          // while the picture decodes.
          decoration: BoxDecoration(
            gradient: placeGradient(place),
            borderRadius: radius,
            boxShadow: WainShadows.lg,
          ),
          child: ClipRRect(
            borderRadius: radius,
            child: Stack(
              fit: StackFit.expand,
              children: [
                // Its own node, as Image's semanticLabel would make it, or
                // the words merge into whatever node is above.
                Semantics(
                  container: true,
                  image: true,
                  label: label,
                  child: LandmarkImage(picture),
                ),
                const PositionedDirectional(
                  end: 10,
                  bottom: 10,
                  child: IllustrativeTag(),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
