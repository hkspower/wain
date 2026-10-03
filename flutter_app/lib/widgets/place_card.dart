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

  const PlaceCard({super.key, required this.place, this.awayKm});

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
        borderRadius: BorderRadius.circular(WainRadius.s2xl),
        child: InkWell(
          borderRadius: BorderRadius.circular(WainRadius.s2xl),
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
              borderRadius: BorderRadius.circular(WainRadius.s2xl),
              border: Border.all(color: WainColors.line),
              boxShadow: WainShadows.sm,
            ),
            child: ClipRRect(
              borderRadius: BorderRadius.circular(WainRadius.s2xl - 1),
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
                        if (picture != null)
                          const PositionedDirectional(
                            end: 6,
                            bottom: 6,
                            child: IllustrativeTag(),
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
            boxShadow: WainShadows.sm,
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
