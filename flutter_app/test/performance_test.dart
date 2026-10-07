// Work that is not repeated: a search asked once per query, and the home's
// animation stopped while Home is not on screen.
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:wain/app/app_state.dart';
import 'package:wain/main.dart';
import 'package:wain/map/wain_map.dart';
import 'package:wain/screens/home_screen.dart';
import 'package:wain/screens/search_screen.dart';

Future<void> at(WidgetTester t, String location) async {
  t.view.physicalSize = const Size(390 * 2, 844 * 2);
  t.view.devicePixelRatio = 2;
  addTearDown(t.view.reset);
  await t.pumpWidget(
    WainApp(state: AppState.ephemeral(), initialLocation: location),
  );
  await t.pump(const Duration(milliseconds: 400));
}

void main() {
  setUp(() => debugTileUrl = '');
  tearDown(() => debugTileUrl = null);

  testWidgets('choosing a pin does not search the whole index again', (
    t,
  ) async {
    await at(t, '/search?q=قهوة');
    // The map is a bar until opened (7 October); opening it is not a search.
    await t.tap(find.byKey(const ValueKey('search-map-bar')));
    await t.pump(const Duration(milliseconds: 100));
    final state = t.state(find.byType(SearchScreen)) as dynamic;
    final before = state.searchRuns as int;
    expect(before, greaterThan(0));
    final pin = find.byWidgetPredicate(
      (w) =>
          w.key is ValueKey<String> &&
          (w.key! as ValueKey<String>).value.startsWith('map-pin-'),
    );
    await t.tap(pin.last, warnIfMissed: false);
    await t.pump(const Duration(milliseconds: 100));
    await t.tap(pin.first, warnIfMissed: false);
    await t.pump(const Duration(milliseconds: 100));
    expect(state.searchRuns, before, reason: 'same query, same answer');
  });

  testWidgets('Home\'s animation is stopped while another tab is showing', (
    t,
  ) async {
    await at(t, '/');
    bool homeTicks() => TickerMode.valuesOf(
      t.element(find.byType(HomeScreen, skipOffstage: false)),
    ).enabled;
    expect(homeTicks(), isTrue);
    await t.tap(find.text('استكشف').last);
    await t.pump(const Duration(milliseconds: 400));
    expect(homeTicks(), isFalse);
  });
}
