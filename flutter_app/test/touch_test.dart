// Touch the way a phone app is touched: a tap outside a field puts the
// keyboard away, a drag down Explore does too, and a map inside a scrolling
// page stays still until asked, so the page under the thumb keeps scrolling.
import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:wain/app/app_state.dart';
import 'package:wain/data/catalogue.dart';
import 'package:wain/share/directions.dart';
import 'package:wain/share/share_service.dart';
import 'package:wain/widgets/place_card.dart';
import 'package:wain/main.dart';
import 'package:wain/map/wain_map.dart';

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

  testWidgets('a tap outside the search box puts the keyboard away', (t) async {
    await at(t, '/search');
    final input = find.byKey(const ValueKey('search-input'));
    await t.tap(input);
    await t.pump();
    final field = t.widget<TextField>(input);
    expect(
      field.focusNode?.hasFocus ??
          FocusManager.instance.primaryFocus is FocusNode,
      isTrue,
    );
    expect(FocusManager.instance.primaryFocus?.context?.widget, isNotNull);
    await t.tapAt(const Offset(195, 700));
    await t.pump();
    expect(
      find.descendant(
        of: input,
        matching: find.byWidgetPredicate(
          (w) => w is EditableText && w.focusNode.hasFocus,
        ),
      ),
      findsNothing,
    );
  });

  testWidgets('dragging Explore puts the keyboard away', (t) async {
    await at(t, '/explore');
    final view = t.widget<CustomScrollView>(find.byType(CustomScrollView));
    expect(
      view.keyboardDismissBehavior,
      ScrollViewKeyboardDismissBehavior.onDrag,
    );
  });

  testWidgets('the map is still until «حرّك الخريطة», and stills again', (
    t,
  ) async {
    await at(t, '/places/kuwait-towers');
    int flags() => t
        .widget<FlutterMap>(find.byType(FlutterMap))
        .options
        .interactionOptions
        .flags;
    await t.ensureVisible(find.byType(FlutterMap));
    await t.pump();
    expect(flags(), InteractiveFlag.none);
    await t.tap(find.byKey(const ValueKey('map-move')));
    await t.pump();
    expect(flags() & InteractiveFlag.drag, isNot(0));
    expect(flags() & InteractiveFlag.rotate, 0);
    await t.tap(find.byKey(const ValueKey('map-move')));
    await t.pump();
    expect(flags(), InteractiveFlag.none);
  });

  group('directions go to the phone\'s own maps app', () {
    final p = getPlace('kuwait-towers')!;
    test('Apple Maps on iOS, then the web', () {
      final links = directionsLinks(p, TargetPlatform.iOS);
      expect(links.first.host, 'maps.apple.com');
      expect(links.first.queryParameters['daddr'], '${p.lat},${p.lng}');
      expect(links.last.host, 'www.google.com');
    });
    test('the geo: handler on Android, then the web', () {
      final links = directionsLinks(p, TargetPlatform.android);
      expect(links.first.scheme, 'geo');
      expect(links.last.host, 'www.google.com');
    });
    testWidgets('the place page offers «الطريق»', (t) async {
      await at(t, '/places/kuwait-towers');
      expect(find.byKey(const ValueKey('directions')), findsOneWidget);
    });
  });

  testWidgets('a long press on a card shares its link', (t) async {
    final shared = <String>[];
    debugShareBackend = _RecordingShare(shared);
    addTearDown(() => debugShareBackend = null);
    await at(t, '/explore');
    await t.longPress(find.byType(PlaceCard).first);
    await t.pump();
    expect(shared, hasLength(1));
    expect(shared.single, contains('https://www.wainkw.com/places/'));
  });
}

class _RecordingShare implements ShareBackend {
  final List<String> log;
  _RecordingShare(this.log);
  @override
  Future<bool?> nativeShare(String text, String title) async {
    log.add(text);
    return true;
  }

  @override
  Future<bool> openWhatsApp(Uri uri) async => false;
  @override
  Future<bool> copy(String text) async => false;
}
