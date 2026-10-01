// What the status bar shows over each screen: the region the framework will
// actually hand the platform is the one painted under the top edge, so read
// it there, the way RendererBinding does, rather than looking for a widget.
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:wain/ai/call_controller.dart';
import 'package:wain/app/app_state.dart';
import 'package:wain/main.dart';
import 'package:wain/map/wain_map.dart';
import 'package:wain/theme/app_theme.dart';

import 'support.dart';

SystemUiOverlayStyle? statusBarStyle(WidgetTester t) {
  final view = t.binding.renderViews.first;
  final layer = view.debugLayer!;
  // Physical pixels: the root layer is the device-pixel-ratio transform.
  final width = t.view.physicalSize.width;
  return layer.find<SystemUiOverlayStyle>(Offset(width / 2, 2));
}

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

  for (final light in [
    '/',
    '/explore',
    '/search',
    '/about',
    '/places/kuwait-towers',
  ]) {
    testWidgets('$light: dark icons on the sand', (t) async {
      await at(t, light);
      expect(statusBarStyle(t), kChromeOnLight);
    });
  }

  for (final dark in ['/find', '/salem']) {
    testWidgets('$dark: light icons on the dark screen', (t) async {
      await at(t, dark);
      expect(statusBarStyle(t), kChromeOnDark);
      await t.pumpWidget(const SizedBox());
    });
  }

  testWidgets('the call sheet is dark over any screen, and gives it back', (
    t,
  ) async {
    final sessions = <FakeSession>[];
    t.view.physicalSize = const Size(390 * 2, 844 * 2);
    t.view.devicePixelRatio = 2;
    addTearDown(t.view.reset);
    await t.pumpWidget(
      WainApp(
        state: AppState.ephemeral(),
        sessionFactory: () {
          final s = FakeSession();
          sessions.add(s);
          return s;
        },
        checkMic: () async => MicResult.ok,
        keepAlive: FakeKeepAlive(),
        agentId: 'agent_test',
      ),
    );
    await t.pump(const Duration(milliseconds: 300));
    expect(statusBarStyle(t), kChromeOnLight);
    final c = read<CallController>(t, find.byType(Scaffold));
    await c.start();
    await t.pump(const Duration(milliseconds: 100));
    expect(statusBarStyle(t), kChromeOnDark);
    c.minimise();
    await t.pump(const Duration(milliseconds: 100));
    expect(statusBarStyle(t), kChromeOnLight);
    await t.pumpWidget(const SizedBox());
  });
}
