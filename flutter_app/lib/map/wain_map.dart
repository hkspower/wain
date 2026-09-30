/// The map: `flutter_map` over OpenStreetMap tiles, with the site's pins drawn
/// as widgets so the category tint, the selected state and the callout are the
/// same things the web shows.
///
/// Using OSM's tiles directly is a different relationship from embedding their
/// page, and carries two obligations kept here exactly as `map-tiles.ts` keeps
/// them: attribution rendered ON the map (in Arabic), and modest use — tiles
/// load only when a map is on screen. If this app ever has real traffic, move
/// off those tiles: `--dart-define=WAIN_TILES=<url>` repoints it with no code
/// change and `none` removes the tile layer entirely (a pin-only canvas).
library;

import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:latlong2/latlong.dart';

import '../data/models.dart';
import '../theme/app_theme.dart';
import '../theme/colors.dart';

const String _configured = String.fromEnvironment('WAIN_TILES');
const String kDefaultTiles = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';

/// Empty when switched off with «none».
String get tileUrl {
  final override = debugTileUrl;
  if (override != null) return override;
  final c = _configured.trim().isEmpty ? kDefaultTiles : _configured.trim();
  return c.toLowerCase() == 'none' ? '' : c;
}

/// Tests set this to '' so no tile is ever requested.
@visibleForTesting
String? debugTileUrl;

const String kAttributionAr = 'بيانات الخريطة © المساهمين في OpenStreetMap';
const double kMinZoom = 7;
const double kMaxZoom = 19;

/// Kuwait City, for an empty frame.
const LatLng kKuwaitCity = LatLng(29.3759, 47.9774);

class WainMap extends StatelessWidget {
  final List<Place> places;
  final String? activeSlug;
  final ValueChanged<String?>? onActive;

  /// Open the place (a second tap on the selected pin, or a tap on its callout).
  final ValueChanged<Place>? onOpen;
  final double height;
  final bool interactive;

  const WainMap({
    super.key,
    required this.places,
    this.activeSlug,
    this.onActive,
    this.onOpen,
    this.height = 260,
    this.interactive = true,
  });

  @override
  Widget build(BuildContext context) {
    final points = [for (final p in places) LatLng(p.lat, p.lng)];
    final url = tileUrl;
    return ClipRRect(
      borderRadius: BorderRadius.circular(WainRadius.s3xl),
      child: SizedBox(
        height: height,
        child: Stack(
          children: [
            Positioned.fill(
              child: FlutterMap(
                options: MapOptions(
                  initialCenter: points.length == 1
                      ? points.first
                      : kKuwaitCity,
                  initialZoom: 11,
                  minZoom: kMinZoom,
                  maxZoom: kMaxZoom,
                  backgroundColor: WainColors.sea50,
                  initialCameraFit: points.length > 1
                      ? CameraFit.coordinates(
                          coordinates: points,
                          padding: const EdgeInsets.fromLTRB(40, 56, 40, 40),
                          maxZoom: 15,
                        )
                      : null,
                  interactionOptions: InteractionOptions(
                    flags: interactive
                        ? InteractiveFlag.all & ~InteractiveFlag.rotate
                        : InteractiveFlag.none,
                  ),
                  onTap: (_, _) => onActive?.call(null),
                ),
                children: [
                  if (url.isNotEmpty)
                    TileLayer(
                      urlTemplate: url,
                      userAgentPackageName: 'com.wainkw.app',
                      minZoom: kMinZoom,
                      maxZoom: kMaxZoom,
                    ),
                  MarkerLayer(
                    markers: [
                      for (final p in places)
                        Marker(
                          point: LatLng(p.lat, p.lng),
                          width: 160,
                          height: 96,
                          // The dot sits at the bottom of this box; put the
                          // coordinate under the dot's centre, not the box's top.
                          alignment: const Alignment(0, 0.75),
                          child: MapPin(
                            place: p,
                            selected: p.slug == activeSlug,
                            onTap: () {
                              if (p.slug == activeSlug) {
                                onOpen?.call(p);
                              } else {
                                onActive?.call(p.slug);
                              }
                            },
                          ),
                        ),
                    ],
                  ),
                ],
              ),
            ),
            PositionedDirectional(
              end: 0,
              bottom: 0,
              child: Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                color: Colors.white.withValues(alpha: 0.85),
                child: Text(
                  kAttributionAr,
                  style: wainText(WainText.s2xs, color: WainColors.ink600),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// A pin: a teardrop in the category's ink on a white ring, with a callout when
/// selected. On a touch device a first tap SELECTS and a second opens — the
/// same contract as the web's `selectedOnPress`, for the same reason: a finger
/// has no hover to preview with, and opening on first touch would make the
/// callout unreachable.
class MapPin extends StatelessWidget {
  final Place place;
  final bool selected;
  final VoidCallback onTap;

  const MapPin({
    super.key,
    required this.place,
    required this.selected,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final ink = catInk(place.category);
    return Semantics(
      button: true,
      selected: selected,
      label: place.nameAr,
      child: GestureDetector(
        behavior: HitTestBehavior.opaque,
        onTap: onTap,
        child: Column(
          mainAxisAlignment: MainAxisAlignment.end,
          children: [
            if (selected)
              Container(
                constraints: const BoxConstraints(maxWidth: 160),
                padding: const EdgeInsets.symmetric(
                  horizontal: 10,
                  vertical: 6,
                ),
                decoration: BoxDecoration(
                  color: WainColors.ink900.withValues(alpha: 0.95),
                  borderRadius: BorderRadius.circular(WainRadius.xl),
                  boxShadow: WainShadows.xl,
                ),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      place.nameAr,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: wainText(
                        WainText.s2xs,
                        weight: FontWeight.w600,
                        color: Colors.white,
                      ),
                    ),
                    Text(
                      place.areaAr,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: wainText(WainText.s2xs, color: WainColors.sand300),
                    ),
                  ],
                ),
              ),
            if (selected) const SizedBox(height: 4),
            AnimatedScale(
              scale: selected ? 1.25 : 1,
              duration: const Duration(milliseconds: 150),
              child: Container(
                width: 24,
                height: 24,
                decoration: BoxDecoration(
                  color: ink,
                  shape: BoxShape.circle,
                  border: Border.all(color: Colors.white, width: 3),
                  boxShadow: WainShadows.md,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// Great-circle midpoint helper for tests and a stable default zoom.
double zoomForSpan(double latSpan, double lngSpan) {
  final span = math.max(latSpan, lngSpan);
  if (span <= 0) return 14;
  return (math.log(360 / span) / math.ln2).clamp(kMinZoom, 15).toDouble();
}
