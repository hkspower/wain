import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:go_router/go_router.dart';
import 'package:url_launcher/url_launcher.dart';

import '../data/catalogue.dart';
import '../data/landmark_gate.dart';
import '../data/models.dart';
import '../data/text_kit.dart';
import '../map/wain_map.dart';
import '../share/directions.dart';
import '../share/hangout.dart';
import '../share/hangout_panel.dart';
import '../share/invite_banner.dart';
import '../theme/app_theme.dart';
import '../theme/colors.dart';
import '../widgets/art.dart';
import '../widgets/landmark_picture.dart';
import '../widgets/layout.dart';
import '../widgets/place_card.dart';
import '../widgets/svg.dart';

const _priceLabel = ['', 'اقتصادي', 'متوسط', 'راقي'];
const _settingLabel = {
  'indoor': 'مكيّف',
  'outdoor': 'برا',
  'mixed': 'داخلي وبرا',
};

/// A place: hero, name, what it is, the invitation if a link carried one, the
/// description, contact, share, highlights/best time/price/season, the map and
/// similar places. Order and queue panels render nothing today — 0 of 52
/// places take either (and the back end behind them is not configured).
class PlaceDetailScreen extends StatefulWidget {
  final Place place;

  /// The time a forwarded link carried, if any.
  final WhenId? invite;
  const PlaceDetailScreen({super.key, required this.place, this.invite});

  @override
  State<PlaceDetailScreen> createState() => _PlaceDetailScreenState();
}

class _PlaceDetailScreenState extends State<PlaceDetailScreen> {
  Place get place => widget.place;
  WhenId? get invite => widget.invite;

  /// The map, for an invitation's «شوفه على الخريطة» (the web's `#map`).
  final _mapKey = GlobalKey();

  void _showMap() {
    final ctx = _mapKey.currentContext;
    if (ctx == null) return;
    Scrollable.ensureVisible(
      ctx,
      alignment: 0.1,
      duration: MediaQuery.of(context).disableAnimations
          ? Duration.zero
          : const Duration(milliseconds: 300),
      curve: Curves.easeOut,
    );
  }

  @override
  Widget build(BuildContext context) {
    final category = getCategory(place.category);
    final related = relatedPlaces(place);
    // One of the five «معالم الكويت» places shows its picture, whole and
    // tagged, once the picture may be shown; every other place, and those five
    // until then, keep the drawing.
    final picture = placePictureOf(place.slug);
    return ListView(
      padding: EdgeInsets.zero,
      children: [
        PageColumn(
          maxWidth: 896,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // No «استكشف / name» breadcrumb: the round back button sits right
              // above it and falls back to /explore — two ways back, stacked.
              Stack(
                children: [
                  if (picture != null)
                    PictureHero(place: place, picture: picture)
                  else
                    PlaceHero(place: place),
                  if (place.rating != null)
                    PositionedDirectional(
                      start: 10,
                      top: 10,
                      child: Semantics(
                        label: 'التقييم ${toArabicNumber(place.rating!)} من ٥',
                        child: ExcludeSemantics(
                          child: Container(
                            padding: const EdgeInsets.symmetric(
                              horizontal: 8,
                              vertical: 4,
                            ),
                            decoration: BoxDecoration(
                              color: Colors.white.withValues(alpha: 0.95),
                              borderRadius: BorderRadius.circular(99),
                              boxShadow: WainShadows.sm,
                            ),
                            child: Row(
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                WainSvg.icon(
                                  'star',
                                  size: 16,
                                  color: WainColors.sun500,
                                ),
                                const SizedBox(width: 4),
                                Text(
                                  toArabicNumber(place.rating!),
                                  style: wainText(
                                    WainText.xs,
                                    weight: FontWeight.w600,
                                    color: WainColors.ink800,
                                  ),
                                ),
                              ],
                            ),
                          ),
                        ),
                      ),
                    ),
                ],
              ),
              const SizedBox(height: 12),
              Semantics(
                header: true,
                child: Text(
                  place.nameAr,
                  style: wainText(
                    WainText.s4xl,
                    weight: FontWeight.w700,
                    color: WainColors.ink900,
                  ),
                ),
              ),
              Directionality(
                textDirection: TextDirection.ltr,
                child: Text(
                  place.name,
                  style: wainText(WainText.sm, color: WainColors.ink500),
                ),
              ),
              const SizedBox(height: 8),
              Wrap(
                spacing: 6,
                runSpacing: 6,
                crossAxisAlignment: WrapCrossAlignment.center,
                children: [
                  if (category != null)
                    _Pill(
                      text: category.ar,
                      bg: WainColors.sea50,
                      fg: WainColors.sea700,
                    ),
                  Container(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 12,
                      vertical: 6,
                    ),
                    decoration: BoxDecoration(
                      color: WainColors.sand100,
                      borderRadius: BorderRadius.circular(99),
                    ),
                    child: PriceDots(level: place.priceLevel),
                  ),
                ],
              ),
              const SizedBox(height: 6),
              Row(
                children: [
                  WainSvg.icon(
                    'pinsolid',
                    size: 16,
                    color: WainColors.coral600,
                  ),
                  const SizedBox(width: 6),
                  Flexible(
                    child: Text(
                      '${place.areaAr}، الكويت',
                      style: wainText(WainText.sm, color: WainColors.ink500),
                    ),
                  ),
                ],
              ),
              if (invite != null)
                InviteBanner(place: place, when: invite!, onShowMap: _showMap),
              const SizedBox(height: 12),
              ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 520),
                child: Text(
                  place.descriptionAr,
                  style: wainText(
                    WainText.base,
                    color: WainColors.ink600,
                    height: 1.7,
                  ),
                ),
              ),
              if (place.bioAr != null) ...[
                const SizedBox(height: 12),
                Text(
                  place.bioAr!,
                  style: wainText(
                    WainText.base,
                    color: WainColors.ink600,
                    height: 1.7,
                  ),
                ),
              ],
              _Contact(place: place),
              ShareHangout(place: place),
              const SizedBox(height: 12),
              _InfoGrid(place: place),
              const SizedBox(height: 12),
              Align(
                alignment: AlignmentDirectional.centerStart,
                child: OutlinedButton.icon(
                  key: const ValueKey('directions'),
                  onPressed: () {
                    HapticFeedback.selectionClick();
                    openDirections(place);
                  },
                  style: OutlinedButton.styleFrom(
                    minimumSize: const Size(0, 48),
                    foregroundColor: WainColors.sea700,
                  ),
                  icon: const Icon(Icons.directions, size: 20),
                  label: const Text('الطريق'),
                ),
              ),
              const SizedBox(height: 8),
              WainMap(
                key: _mapKey,
                places: [place, ...related],
                activeSlug: place.slug,
                onActive: null,
                onOpen: (p) => p.slug == place.slug
                    ? null
                    : context.push('/places/${p.slug}'),
                height: 240,
              ),
              if (related.isNotEmpty) ...[
                const SizedBox(height: 28),
                Text(
                  'أماكن مشابهة',
                  style: wainText(
                    WainText.xl,
                    weight: FontWeight.w700,
                    color: WainColors.ink900,
                  ),
                ),
                const SizedBox(height: 8),
                GridView.count(
                  shrinkWrap: true,
                  physics: const NeverScrollableScrollPhysics(),
                  crossAxisCount: MediaQuery.sizeOf(context).width >= 640
                      ? 3
                      : 2,
                  mainAxisSpacing: 8,
                  crossAxisSpacing: 8,
                  mainAxisExtent: placeCardExtent(context),
                  children: [
                    for (final p in related)
                      PlaceCard(place: p, awayKm: awayKm(place, p)),
                  ],
                ),
              ],
              const SizedBox(height: 24),
              Center(
                child: OutlinedButton.icon(
                  onPressed: () => context.go('/explore'),
                  icon: WainSvg.icon(
                    'back',
                    size: 16,
                    color: WainColors.ink700,
                  ),
                  label: Text(
                    'رجوع للاستكشاف',
                    style: wainText(
                      WainText.base,
                      weight: FontWeight.w600,
                      color: WainColors.ink700,
                    ),
                  ),
                  style: OutlinedButton.styleFrom(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 24,
                      vertical: 12,
                    ),
                    side: const BorderSide(color: WainColors.lineControl),
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(WainRadius.xl),
                    ),
                  ),
                ),
              ),
              const SizedBox(height: 24),
            ],
          ),
        ),
      ],
    );
  }
}

class _Pill extends StatelessWidget {
  final String text;
  final Color bg;
  final Color fg;
  const _Pill({required this.text, required this.bg, required this.fg});

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
    decoration: BoxDecoration(
      color: bg,
      borderRadius: BorderRadius.circular(99),
    ),
    child: Text(
      text,
      style: wainText(WainText.sm, weight: FontWeight.w600, color: fg),
    ),
  );
}

/// Business contact channels — absent on every shipped place today, rendered
/// when a registered business supplies them.
class _Contact extends StatelessWidget {
  final Place place;
  const _Contact({required this.place});

  @override
  Widget build(BuildContext context) {
    final items = <(String, String, Uri)>[
      if (place.phone != null)
        ('phone', place.phone!, Uri.parse('tel:${place.phone}')),
      if (place.instagram != null)
        (
          'instagram',
          '@${place.instagram}',
          Uri.parse('https://www.instagram.com/${place.instagram}/'),
        ),
      if (place.website != null && isHttpUrl(place.website!))
        ('globe', 'الموقع', Uri.parse(place.website!)),
    ];
    if (items.isEmpty) return const SizedBox.shrink();
    return Padding(
      padding: const EdgeInsets.only(top: 12),
      child: Wrap(
        spacing: 8,
        runSpacing: 8,
        children: [
          for (final (icon, label, uri) in items)
            ActionChip(
              avatar: WainSvg.icon(icon, size: 16, color: WainColors.ink700),
              label: Text(label, textDirection: TextDirection.ltr),
              onPressed: () =>
                  launchUrl(uri, mode: LaunchMode.externalApplication),
            ),
        ],
      ),
    );
  }
}

/// `isHttpUrl` from place-kit: only http(s) is safe to open from a record.
bool isHttpUrl(String v) {
  final u = Uri.tryParse(v);
  return u != null &&
      (u.scheme == 'http' || u.scheme == 'https') &&
      u.host.isNotEmpty;
}

class _InfoGrid extends StatelessWidget {
  final Place place;
  const _InfoGrid({required this.place});

  @override
  Widget build(BuildContext context) {
    final highlights = Panel(
      padding: const EdgeInsets.all(12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _Heading(
            'sparkle',
            'أبرز ما فيه',
            WainColors.sun600,
            size: WainText.lg,
          ),
          const SizedBox(height: 8),
          for (final h in place.highlightsAr)
            Padding(
              padding: const EdgeInsets.only(bottom: 6),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Padding(
                    padding: const EdgeInsets.only(top: 3),
                    child: WainSvg.icon(
                      'check',
                      size: 16,
                      color: WainColors.palm500,
                    ),
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      h,
                      style: wainText(WainText.sm, color: WainColors.ink600),
                    ),
                  ),
                ],
              ),
            ),
        ],
      ),
    );
    final facts = Panel(
      padding: const EdgeInsets.all(12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _Heading(
            'clock',
            'أحسن وقت للزيارة',
            WainColors.sea600,
            size: WainText.lg,
          ),
          const SizedBox(height: 6),
          Text(
            place.bestTimeAr,
            style: wainText(WainText.sm, color: WainColors.ink600),
          ),
          const SizedBox(height: 16),
          _Heading('coins', 'مستوى الأسعار', WainColors.sand600),
          const SizedBox(height: 6),
          Text(
            _priceLabel[place.priceLevel],
            style: wainText(WainText.sm, color: WainColors.ink600),
          ),
          const SizedBox(height: 16),
          _Heading('sun', 'الجو والموسم', WainColors.sun600),
          const SizedBox(height: 6),
          Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              _Pill(
                text: _settingLabel[place.setting]!,
                bg: switch (place.setting) {
                  'indoor' => WainColors.sea50,
                  'outdoor' => WainColors.palm500.withValues(alpha: 0.12),
                  _ => WainColors.sand100,
                },
                fg: switch (place.setting) {
                  'indoor' => WainColors.sea700,
                  'outdoor' => WainColors.palm700,
                  _ => WainColors.sand800,
                },
              ),
              const SizedBox(height: 6),
              Text(
                place.seasonAr,
                style: wainText(WainText.sm, color: WainColors.ink600),
              ),
            ],
          ),
          // Only ever the positive: absent is «we do not know», never «no».
          if (place.shisha == true) ...[
            const SizedBox(height: 6),
            _Pill(
              text: 'فيه شيشة',
              bg: WainColors.palm500.withValues(alpha: 0.12),
              fg: WainColors.palm700,
            ),
          ],
        ],
      ),
    );
    return LayoutBuilder(
      builder: (context, c) {
        if (c.maxWidth >= 600) {
          return Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(child: highlights),
              const SizedBox(width: 8),
              Expanded(child: facts),
            ],
          );
        }
        return Column(children: [highlights, const SizedBox(height: 8), facts]);
      },
    );
  }
}

class _Heading extends StatelessWidget {
  final String icon;
  final String text;
  final Color color;
  final double size;
  const _Heading(this.icon, this.text, this.color, {this.size = WainText.base});

  @override
  Widget build(BuildContext context) => Semantics(
    header: true,
    child: Row(
      children: [
        WainSvg.icon(icon, size: 20, color: color),
        const SizedBox(width: 8),
        Flexible(
          child: Text(
            text,
            style: wainText(
              size,
              weight: FontWeight.w600,
              color: WainColors.ink900,
            ),
          ),
        ),
      ],
    ),
  );
}
