import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:go_router/go_router.dart';

import '../data/categories.g.dart';
import '../data/landmark_gate.dart';
import '../data/models.dart';
import '../data/text_kit.dart';
import '../share/share_service.dart';
import '../theme/app_theme.dart';
import '../theme/colors.dart';
import 'art.dart';
import 'illustrative_tag.dart';
import 'landmark_picture.dart';
import 'svg.dart';

/// A place in a list: its mark on a category-tinted band, name, tagline,
/// category, area, price dots and — when there is something to be away FROM —
/// how far it is. Mirrors `PlaceCard.tsx`.
/// The height a card needs: the 56px band and border, plus the text block
/// (name and tagline up to two lines each, the area row, padding) which grows
/// with the user's text size. A fixed extent overflowed by 15px at 320px.
///
/// From 640 wide the area row also carries the category chip, which stands
/// taller than the row's own line, and every card on a tablet overflowed by
/// 2.4px until the extent counted it (found by the 800×1280 layout test).
double placeCardExtent(BuildContext context) {
  final scale = MediaQuery.textScalerOf(context).scale(1.0);
  final chip = MediaQuery.sizeOf(context).width >= kCategoryChipWidth ? 6 : 0;
  // The band, its 1px divider, the padding, the text block, and 4 of slack.
  final band = kCardBandHeight + 1;
  return band + 8 + 8 + (36.4 + 2 + 37.2 + 6 + 16 + chip) * scale + 4;
}

/// The width from which a card names its category in a chip.
const double kCategoryChipWidth = 640;

/// The band at the top of a card: the place's mark on its category's tint, or
/// one of the five landmarks' pictures — the same height either way, so no
/// card changes height for carrying a picture.
const double kCardBandHeight = 56;

/// The text size the band's badges stop growing at: the rating chip (2 of
/// padding above and below) and the tag (1) are 16 of 11px text each at 1×,
/// and with 6 above, 6 below and 2 between, 56 holds both up to 1.19×.
const double kCardBadgeMaxScale = 1.15;

class PlaceCard extends StatelessWidget {
  final Place place;

  /// Distance from the place being looked at; absent on /explore and in search.
  final double? awayKm;

  /// «رسّلها» on the card itself, leading to the place's share panel — on
  /// Explore and the home picks, where the panel is otherwise three taps
  /// away (as `PlaceCard.tsx`, 3 October). Not where a panel already sits
  /// beside the card (/pick, سالم's rail).
  final bool shareable;

  const PlaceCard({
    super.key,
    required this.place,
    this.awayKm,
    this.shareable = false,
  });

  @override
  Widget build(BuildContext context) {
    final category = kCategories.firstWhere((c) => c.id == place.category);
    final picture = placePictureOf(place.slug);
    return Semantics(
      button: true,
      label: place.nameAr,
      onLongPressHint: 'شارك المكان',
      child: Material(
        color: Colors.white,
        borderRadius: BorderRadius.circular(WainRadius.s3xl),
        child: InkWell(
          borderRadius: BorderRadius.circular(WainRadius.s3xl),
          onTap: () {
            HapticFeedback.selectionClick();
            context.push('/places/${place.slug}');
          },
          // A long press shares the place's link, as a long press on a
          // card does in most phone apps. The link opens the place in the app
          // for anyone who has it, and on the site for anyone who does not.
          onLongPress: () {
            HapticFeedback.mediumImpact();
            shareHangout(text: placeShareText(place), title: place.nameAr);
          },
          child: Ink(
            decoration: BoxDecoration(
              // A fill is required: a BoxShadow on a transparent box shows
              // THROUGH it, which painted the whole card grey.
              color: Colors.white,
              borderRadius: BorderRadius.circular(WainRadius.s3xl),
              border: Border.all(color: WainColors.line),
              boxShadow: WainShadows.xs,
            ),
            child: ClipRRect(
              borderRadius: BorderRadius.circular(WainRadius.s3xl - 1),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  // The band stays 56 whatever the text size, so the two
                  // badges in it stop growing at the size where both still
                  // fit: the rating at the top and «صورة توضيحية» at the foot
                  // met at 1.3× on a 320 phone. Every card's band, not only
                  // the five's, so one rating is not drawn at two sizes side
                  // by side; the rating is in the card's label as well.
                  MediaQuery.withClampedTextScaling(
                    maxScaleFactor: kCardBadgeMaxScale,
                    child: Stack(
                      children: [
                        // The five «معالم الكويت» places carry their picture in
                        // the band the icon sits in — the owner's pick (card A,
                        // 3 October): the same 56, so no card changes height and
                        // placeCardExtent holds; the other 47 keep their icon.
                        // A picture still drawn as a stand-in is not shown. It
                        // is the 3:1 strip cut around the landmark, as on the web.
                        if (picture != null)
                          SizedBox(
                            key: const ValueKey('card-band-picture'),
                            height: kCardBandHeight,
                            width: double.infinity,
                            // The tint is what shows while the picture decodes.
                            child: ColoredBox(
                              color: catTint(place.category),
                              child: LandmarkImage(picture, strip: true),
                            ),
                          )
                        else
                          PlaceMark(
                            place: place,
                            tile: kCardBandHeight,
                            mark: 32,
                            stretch: true,
                          ),
                        // No chip at all without a rating. A placeholder would be
                        // a worse answer than silence: it draws the eye to a
                        // number that does not exist.
                        if (place.rating != null)
                          PositionedDirectional(
                            start: 6,
                            top: 6,
                            child: _RatingChip(rating: place.rating!),
                          ),
                        // Four corners, four badges on a shareable card: the
                        // rating at the top-start, the preview's «رسم مؤقت»
                        // flag at the top-end as always, the share button at
                        // the bottom-end, and the tag moves to the
                        // bottom-start. The bottom row cannot hold the tag AND
                        // the flag on a 320 phone at large text, so the flag
                        // keeps the top and the button takes the corner below
                        // it (the web's button is at the top-end; the web has
                        // no 1.15× clamp to fit under).
                        if (picture != null)
                          PositionedDirectional(
                            end: shareable ? null : 6,
                            start: shareable ? 6 : null,
                            bottom: 6,
                            child: const IllustrativeTag(),
                          ),
                        if (shareable)
                          PositionedDirectional(
                            end: 2,
                            bottom: 2,
                            child: _ShareButton(place: place),
                          ),
                      ],
                    ),
                  ),
                  const Divider(
                    height: 1,
                    thickness: 1,
                    color: WainColors.line,
                  ),
                  Padding(
                    padding: const EdgeInsets.all(8),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Expanded(
                              child: Text(
                                place.nameAr,
                                maxLines: 2,
                                overflow: TextOverflow.ellipsis,
                                style: wainText(
                                  WainText.sm,
                                  weight: FontWeight.w600,
                                  color: WainColors.ink900,
                                  height: 1.3,
                                ),
                              ),
                            ),
                            const SizedBox(width: 6),
                            _PriceDots(level: place.priceLevel, small: true),
                          ],
                        ),
                        const SizedBox(height: 2),
                        Text(
                          place.taglineAr,
                          maxLines: 2,
                          overflow: TextOverflow.ellipsis,
                          style: wainText(
                            WainText.xs,
                            color: WainColors.ink500,
                          ),
                        ),
                        const SizedBox(height: 6),
                        Row(
                          children: [
                            WainSvg.icon(
                              'pinsolid',
                              size: 12,
                              color: WainColors.coral600.withValues(alpha: 0.7),
                            ),
                            const SizedBox(width: 4),
                            Flexible(
                              child: Text(
                                place.areaAr,
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                                style: wainText(
                                  WainText.s2xs,
                                  color: WainColors.ink500,
                                ),
                              ),
                            ),
                            if (awayKm != null) ...[
                              const SizedBox(width: 4),
                              Flexible(
                                child: Text(
                                  distanceAr(
                                    awayKm!,
                                    rough: place.coordsUnverified,
                                  ),
                                  maxLines: 1,
                                  softWrap: false,
                                  overflow: TextOverflow.ellipsis,
                                  style: wainText(
                                    WainText.s2xs,
                                    weight: FontWeight.w600,
                                    color: WainColors.sand700,
                                  ),
                                ),
                              ),
                            ],
                            const Spacer(),
                            // Category name only where the row has the width —
                            // the tint band and the mark ARE the category.
                            if (MediaQuery.sizeOf(context).width >=
                                kCategoryChipWidth)
                              Container(
                                padding: const EdgeInsets.symmetric(
                                  horizontal: 8,
                                  vertical: 2,
                                ),
                                decoration: BoxDecoration(
                                  color: WainColors.sea50,
                                  borderRadius: BorderRadius.circular(99),
                                ),
                                child: Text(
                                  category.ar,
                                  style: wainText(
                                    WainText.s2xs,
                                    weight: FontWeight.w600,
                                    color: WainColors.sea700,
                                  ),
                                ),
                              ),
                          ],
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// «رسّلها للربع» on the card: a 32 white disc with the send icon inside a
/// 48 tap area, leading to the place's own share panel (`?share=1`, which
/// PlaceDetailScreen scrolls to). The card's own tap and long press stay
/// what they are; this is a second, named control at the band's end corner.
class _ShareButton extends StatelessWidget {
  final Place place;
  const _ShareButton({required this.place});

  @override
  Widget build(BuildContext context) {
    // Its own node: without `container` the card's Semantics above folds
    // this one into its label, and a screen reader never meets the button.
    return Semantics(
      container: true,
      button: true,
      label: 'رسّل ${place.nameAr} للربع',
      // Not HitArea: that centres the drawing in its 48, which in a 56 band
      // puts the disc up against the preview flag in the corner above. The
      // disc hugs the bottom of its target instead; the target's upper
      // margin is still a finger's, and overlapping an invisible margin is
      // fine where overlapping the disc was not.
      child: GestureDetector(
        key: const ValueKey('card-share'),
        behavior: HitTestBehavior.opaque,
        excludeFromSemantics: true,
        onTap: () {
          HapticFeedback.selectionClick();
          context.push('/places/${place.slug}?share=1');
        },
        child: SizedBox(
          width: 48,
          height: 48,
          child: Align(
            alignment: Alignment.bottomCenter,
            child: ExcludeSemantics(
              child: Container(
                width: 32,
                height: 32,
                decoration: BoxDecoration(
                  color: Colors.white.withValues(alpha: 0.95),
                  shape: BoxShape.circle,
                  boxShadow: WainShadows.sm,
                ),
                child: Center(
                  child: WainSvg.icon(
                    'send',
                    size: 16,
                    color: WainColors.ink800,
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _RatingChip extends StatelessWidget {
  final double rating;
  const _RatingChip({required this.rating});

  @override
  Widget build(BuildContext context) {
    return Semantics(
      label: 'التقييم ${toArabicNumber(rating)} من ٥',
      child: ExcludeSemantics(
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
          decoration: BoxDecoration(
            color: Colors.white.withValues(alpha: 0.95),
            borderRadius: BorderRadius.circular(99),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              WainSvg.icon('star', size: 12, color: WainColors.sun500),
              const SizedBox(width: 2),
              Text(
                toArabicNumber(rating),
                style: wainText(
                  WainText.s2xs,
                  weight: FontWeight.w600,
                  color: WainColors.ink800,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// Price as three dots and «د.ك». Read as «مستوى السعر N من ٣».
class _PriceDots extends StatelessWidget {
  final int level;
  final bool small;
  const _PriceDots({required this.level, this.small = false});

  @override
  Widget build(BuildContext context) {
    final d = small ? 4.0 : 6.0;
    return Semantics(
      label: 'مستوى السعر ${toArabicDigits(level)} من ٣',
      child: ExcludeSemantics(
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            for (var i = 1; i <= 3; i++)
              Container(
                width: d,
                height: d,
                margin: const EdgeInsetsDirectional.only(end: 2),
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  color: i <= level ? WainColors.sand700 : WainColors.sand300,
                ),
              ),
            const SizedBox(width: 2),
            Text(
              'د.ك',
              style: wainText(
                small ? WainText.s2xs : WainText.sm,
                weight: FontWeight.w600,
                color: WainColors.sand700,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// The same dots, at the size the place page uses.
class PriceDots extends StatelessWidget {
  final int level;
  const PriceDots({super.key, required this.level});
  @override
  Widget build(BuildContext context) => _PriceDots(level: level);
}

/// What a long press on a card sends: the name, its line, and its link.
String placeShareText(Place p) =>
    '${p.nameAr} — ${p.taglineAr}\nhttps://www.wainkw.com/places/${p.slug}/';
