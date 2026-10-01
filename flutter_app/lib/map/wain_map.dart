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
import 'package:flutter/services.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:latlong2/latlong.dart';
import 'package:provider/provider.dart';

import '../app/online.dart';
import '../data/models.dart';
import '../theme/app_theme.dart';
import '../theme/colors.dart';
import '../widgets/layout.dart';

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

class WainMap extends StatefulWidget {
  final List<Place> places;
  final String? activeSlug;
  final ValueChanged<String?>? onActive;

  /// Open the place (a second tap on the selected pin, or a tap on its callout).
  final ValueChanged<Place>? onOpen;
  final double height;
  final bool interactive;

  /// Tests pass one to read the camera; the app lets the map own its own.
  final MapController? controller;

  const WainMap({
    super.key,
    required this.places,
    this.activeSlug,
    this.onActive,
    this.onOpen,
    this.height = 260,
    this.interactive = true,
    this.controller,
  });

  @override
  State<WainMap> createState() => _WainMapState();
}

/// Where a set of places should be framed: the one place, or all of them.
CameraFit? _fitFor(List<LatLng> points) => points.length > 1
    ? CameraFit.coordinates(
        coordinates: points,
        padding: const EdgeInsets.fromLTRB(40, 56, 40, 40),
        maxZoom: 15,
      )
    : null;

class _WainMapState extends State<WainMap> {
  late final MapController _ctl = widget.controller ?? MapController();
  bool _engaged = false;

  /// A tile failed to load: the map has no network behind it. Said in words
  /// over the background, which was otherwise a blank sea with pins on it.
  bool _tilesFailed = false;
  bool _lastOffline = false;

  /// A different SET of places is a new answer and gets a new frame. The
  /// search screen keeps one map under a constant key, and `initialCameraFit`
  /// is read once — so a new search drew its pins wherever the last search
  /// had left the camera, often entirely off-screen («قهوة» is the old town,
  /// «الخيران» ninety kilometres south). Only on a new set: refitting on every
  /// rebuild would yank the map back the moment the visitor dragged it.
  @override
  void didUpdateWidget(WainMap old) {
    super.didUpdateWidget(old);
    final was = [for (final p in old.places) p.slug].join(',');
    final now = [for (final p in widget.places) p.slug].join(',');
    if (was == now || widget.places.isEmpty) return;
    final points = [for (final p in widget.places) LatLng(p.lat, p.lng)];
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      final fit = _fitFor(points);
      if (fit != null) {
        _ctl.fitCamera(fit);
      } else {
        _ctl.move(points.first, 14);
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    final places = widget.places;
    final activeSlug = widget.activeSlug;
    final onActive = widget.onActive;
    final onOpen = widget.onOpen;
    final height = widget.height;
    // Inside a scrolling page a live map takes every vertical drag that starts
    // on it, so the page stops scrolling under the visitor's thumb. Like the
    // web's static frame, it is still until asked: «حرّك الخريطة» turns
    // panning and zooming on, «ثبّت الخريطة» turns them off again. Pins answer
    // taps either way.
    final interactive = widget.interactive && _engaged;
    final offline = Provider.of<Online?>(context)?.offline ?? false;
    // Back online: the next tiles get a fresh chance to say otherwise.
    if (!offline && _lastOffline) _tilesFailed = false;
    _lastOffline = offline;
    final points = [for (final p in places) LatLng(p.lat, p.lng)];
    final url = tileUrl;
    return ClipRRect(
      borderRadius: BorderRadius.circular(WainRadius.s3xl),
      child: SizedBox(
        height: height,
        child: Stack(
          children: [
            Positioned.fill(
              child: Semantics(
                label:
                    'خريطة ${places.length == 1 ? places.first.nameAr : 'النتائج'}',
                child: FlutterMap(
                  mapController: _ctl,
                  options: MapOptions(
                    initialCenter: points.length == 1
                        ? points.first
                        : kKuwaitCity,
                    initialZoom: 11,
                    minZoom: kMinZoom,
                    maxZoom: kMaxZoom,
                    backgroundColor: WainColors.sea50,
                    initialCameraFit: _fitFor(points),
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
                        errorTileCallback: (_, _, _) {
                          if (!_tilesFailed && mounted) {
                            WidgetsBinding.instance.addPostFrameCallback((_) {
                              if (mounted) {
                                setState(() => _tilesFailed = true);
                              }
                            });
                          }
                        },
                      ),
                    MarkerLayer(
                      markers: [
                        for (final p in places)
                          Marker(
                            point: LatLng(p.lat, p.lng),
                            width: 160,
                            height: 104,
                            // The dot's 48px target sits at the bottom of this
                            // box, so its centre is 24px up: (104−24)/104 of the
                            // way down, which is 0.538 in Alignment's −1…1.
                            alignment: const Alignment(0, 0.538),
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
            ),
            if (offline || _tilesFailed)
              PositionedDirectional(
                bottom: 24,
                start: 8,
                child: IgnorePointer(
                  child: Container(
                    key: const ValueKey('map-offline'),
                    padding: const EdgeInsets.symmetric(
                      horizontal: 10,
                      vertical: 6,
                    ),
                    decoration: BoxDecoration(
                      color: Colors.white.withValues(alpha: 0.92),
                      borderRadius: BorderRadius.circular(99),
                    ),
                    child: Text(
                      'الخريطة تحتاج إنترنت',
                      style: wainText(WainText.xs, color: WainColors.ink700),
                    ),
                  ),
                ),
              ),
            if (widget.interactive)
              PositionedDirectional(
                top: 8,
                start: 8,
                child: _MoveToggle(
                  engaged: _engaged,
                  onTap: () {
                    HapticFeedback.selectionClick();
                    setState(() => _engaged = !_engaged);
                  },
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

class _MoveToggle extends StatelessWidget {
  final bool engaged;
  final VoidCallback onTap;
  const _MoveToggle({required this.engaged, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return Semantics(
      button: true,
      toggled: engaged,
      label: engaged ? 'ثبّت الخريطة' : 'حرّك الخريطة',
      excludeSemantics: true,
      child: HitArea(
        onTap: onTap,
        child: Material(
          key: const ValueKey('map-move'),
          color: engaged ? WainColors.ink900 : Colors.white,
          elevation: 2,
          shape: const StadiumBorder(),
          child: InkWell(
            customBorder: const StadiumBorder(),
            onTap: onTap,
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 7),
              child: Text(
                engaged ? 'ثبّت الخريطة' : 'حرّك الخريطة',
                style: wainText(
                  WainText.xs,
                  weight: FontWeight.w600,
                  color: engaged ? Colors.white : WainColors.ink700,
                ),
              ),
            ),
          ),
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
      // No detector around the whole box. It is 160×96 so the callout has
      // room, and it was opaque: a tap anywhere in it — most of it empty, up
      // to 70px above the dot — selected this pin, and a drag that started
      // there never reached the map. Only the dot and the callout answer now;
      // the empty part of the box is not hit-tested at all.
      child: Column(
        mainAxisAlignment: MainAxisAlignment.end,
        children: [
          if (selected)
            GestureDetector(
              behavior: HitTestBehavior.opaque,
              onTap: onTap,
              child: Container(
                constraints: const BoxConstraints(maxWidth: 160, minHeight: 48),
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
            ),
          if (selected) const SizedBox(height: 4),
          // 48px around a 24px dot: Android's finger-sized target, and no
          // bigger (it was 40, under the guideline).
          Semantics(
            button: true,
            selected: selected,
            label: place.nameAr,
            child: GestureDetector(
              key: ValueKey('map-pin-${place.slug}'),
              behavior: HitTestBehavior.opaque,
              onTap: onTap,
              child: SizedBox.square(
                dimension: 48,
                child: Center(
                  child: AnimatedScale(
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
                ),
              ),
            ),
          ),
        ],
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
