// The search map (map/wain_map.dart): where a pin can be tapped, and that a
// new set of results is framed. No tile is requested — debugTileUrl is ''.
import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:wain/data/models.dart';
import 'package:wain/data/places.g.dart';
import 'package:latlong2/latlong.dart';
import 'package:wain/map/wain_map.dart';

Place _p(String slug) => kPlaces.firstWhere((p) => p.slug == slug);

Widget _host(Widget map) => MaterialApp(
  home: Directionality(
    textDirection: TextDirection.rtl,
    child: Scaffold(
      body: Center(child: SizedBox(width: 360, child: map)),
    ),
  ),
);

void main() {
  setUp(() => debugTileUrl = '');

  testWidgets('only the pin answers a tap, not the empty box around it', (
    t,
  ) async {
    final taps = <String?>[];
    final towers = _p('kuwait-towers');
    await t.pumpWidget(
      _host(WainMap(places: [towers], onActive: taps.add, height: 300)),
    );
    await t.pump();
    final dot = t.getCenter(
      find.byKey(const ValueKey('map-pin-kuwait-towers')),
    );
    // 50px above the dot: inside the 160×96 marker box, which used to be
    // opaque and selected the pin from anywhere in it.
    await t.tapAt(dot - const Offset(0, 50));
    // flutter_map waits 250ms to tell a tap from a double tap.
    await t.pump(const Duration(milliseconds: 300));
    expect(taps.where((s) => s != null), isEmpty, reason: 'empty box: $taps');
    await t.tapAt(dot);
    await t.pump(const Duration(milliseconds: 300));
    expect(taps.last, 'kuwait-towers');
  });

  testWidgets('a new set of results is framed, not left where the last was', (
    t,
  ) async {
    final ctl = MapController();
    // The old town, then the far south: a camera left on the first set would
    // show none of the second.
    final first = [_p('souq-al-mubarakiya'), _p('kuwait-towers')];
    final second = [_p('khiran'), _p('al-shaab-beach')];
    Widget map(List<Place> ps) => _host(
      WainMap(
        key: const ValueKey('search-map'),
        places: ps,
        controller: ctl,
        height: 300,
      ),
    );
    await t.pumpWidget(map(first));
    await t.pump();
    final before = ctl.camera.center;
    await t.pumpWidget(map(second));
    await t.pump();
    await t.pump();
    final bounds = ctl.camera.visibleBounds;
    for (final p in second) {
      expect(
        bounds.contains(LatLng(p.lat, p.lng)),
        isTrue,
        reason:
            '${p.slug} in view (center was $before, now ${ctl.camera.center})',
      );
    }
  });
}
