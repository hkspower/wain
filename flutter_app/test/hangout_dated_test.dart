// The hangout, dated and on the calendar (3 October): the link carries its
// day, a passed invitation offers another time, a send nothing took shows
// its text, a vote carries the place's link, the plan goes on the calendar,
// and a card on Explore and the home picks carries «رسّلها».
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:wain/data/catalogue.dart';
import 'package:wain/map/wain_map.dart';
import 'package:wain/screens/pick_screen.dart';
import 'package:wain/share/hangout.dart';
import 'package:wain/share/hangout_panel.dart';
import 'package:wain/share/invite_banner.dart';
import 'package:wain/share/share_service.dart';
import 'package:wain/widgets/place_card.dart';

import 'app_smoke_test.dart' show pumpAt;
import 'hangout_panel_test.dart' show FakeShare;

final _mall = getPlace('the-avenues')!;
final _beach = getPlace('marina-beach')!;
final _park = getPlace('al-shaheed-park')!;
final _towers = getPlace('kuwait-towers')!;
final _souq = getPlace('souq-al-mubarakiya')!;
// 17:00 in Kuwait on Thursday 15 January 2026.
final _thursday5pm = DateTime.utc(2026, 1, 15, 14, 0);

Widget _app(Widget body) => MaterialApp(
  locale: const Locale('ar'),
  supportedLocales: const [Locale('ar')],
  localizationsDelegates: const [
    GlobalMaterialLocalizations.delegate,
    GlobalWidgetsLocalizations.delegate,
    GlobalCupertinoLocalizations.delegate,
  ],
  builder: (c, child) =>
      Directionality(textDirection: TextDirection.rtl, child: child!),
  home: Scaffold(body: SingleChildScrollView(child: body)),
);

Future<void> _pump(WidgetTester t, Widget w) async {
  t.view.physicalSize = const Size(780, 1600);
  t.view.devicePixelRatio = 2;
  addTearDown(t.view.reset);
  await t.pumpWidget(_app(w));
  await t.pump();
}

/// Records what the app hands the clipboard; the panel's «انسخ» is a
/// platform call, so the test reads the call rather than a pasteboard.
List<String> _watchClipboard(WidgetTester t) {
  final copied = <String>[];
  t.binding.defaultBinaryMessenger.setMockMethodCallHandler(
    SystemChannels.platform,
    (call) async {
      if (call.method == 'Clipboard.setData') {
        copied.add((call.arguments as Map)['text'] as String);
      }
      return null;
    },
  );
  addTearDown(
    () => t.binding.defaultBinaryMessenger.setMockMethodCallHandler(
      SystemChannels.platform,
      null,
    ),
  );
  return copied;
}

void main() {
  // The chips are behind «غيّر» since 7 October; this file drives them.
  setUp(() => debugHangoutStartOpen = true);
  tearDown(() => debugHangoutStartOpen = false);

  tearDown(() => debugShareBackend = null);
  setUp(() => debugTileUrl = '');
  tearDown(() => debugTileUrl = null);

  group('the panel', () {
    testWidgets('a send nothing took shows the text itself, with its own copy', (
      t,
    ) async {
      final b = FakeShare()
        ..native = null
        ..whatsapp = false
        ..copyOk = false;
      debugShareBackend = b;
      final copied = _watchClipboard(t);
      await _pump(t, ShareHangout(place: _mall, clock: () => _thursday5pm));
      await t.tap(find.byKey(const ValueKey('hangout-send')));
      await t.pump();
      await t.pump();
      final shown = find.byKey(const ValueKey('hangout-failed-text'));
      expect(shown, findsOneWidget);
      final text = t
          .widget<SelectableText>(
            find.descendant(of: shown, matching: find.byType(SelectableText)),
          )
          .data!;
      expect(text, b.lastText, reason: 'the message that was composed');
      expect(text, contains('https://www.wainkw.com/places/${_mall.slug}/'));
      // The block sits under the chips and the send button, past the first
      // screen at 390×800; a tap off the viewport lands on nothing.
      await t.ensureVisible(find.byKey(const ValueKey('hangout-copy')));
      await t.pump();
      await t.tap(find.byKey(const ValueKey('hangout-copy')));
      await t.pump();
      expect(copied, [text]);
      await t.pumpWidget(const SizedBox());
    });

    testWidgets(
      'the link carries the day it was sent, and after the send the plan can '
      'go on the calendar — through Google\'s page first on Android',
      (t) async {
        final b = FakeShare()..native = true;
        debugShareBackend = b;
        await _pump(t, ShareHangout(place: _mall, clock: () => _thursday5pm));
        await t.tap(find.byKey(const ValueKey('when-tonight-9')));
        await t.pump();
        await t.tap(find.byKey(const ValueKey('hangout-send')));
        await t.pump();
        await t.pump();
        expect(
          b.lastText,
          contains('/places/${_mall.slug}/?when=tonight-9&d=2026-01-15'),
        );
        final calendar = find.byKey(const ValueKey('add-to-calendar'));
        expect(calendar, findsOneWidget);
        await t.tap(calendar);
        await t.pump();
        expect(b.calls.last, 'url');
        final url = b.lastUrl.toString();
        expect(url, startsWith('https://calendar.google.com/calendar/render?'));
        expect(url, contains('ctz=Asia%2FKuwait'));
        expect(url, contains('dates=20260115T180000Z%2F20260115T200000Z'));
        await t.pumpWidget(const SizedBox());
      },
    );

    testWidgets('«الحين» gets no calendar button; nor does a shortlist', (
      t,
    ) async {
      final b = FakeShare()..native = true;
      debugShareBackend = b;
      await _pump(t, ShareHangout(place: _mall, clock: () => _thursday5pm));
      await t.tap(find.byKey(const ValueKey('when-now')));
      await t.pump();
      await t.tap(find.byKey(const ValueKey('hangout-send')));
      await t.pump();
      await t.pump();
      expect(find.byKey(const ValueKey('add-to-calendar')), findsNothing);
      await t.pumpWidget(const SizedBox());

      await _pump(
        t,
        ShareHangout(
          place: _mall,
          choices: [_mall, _beach, _park],
          clock: () => _thursday5pm,
        ),
      );
      await t.tap(find.byKey(const ValueKey('mode-list')));
      await t.pump();
      await t.tap(find.byKey(const ValueKey('when-tonight-9')));
      await t.pump();
      await t.tap(find.byKey(const ValueKey('hangout-send')));
      await t.pump();
      await t.pump();
      expect(b.lastText, contains('/pick/?p='));
      expect(find.byKey(const ValueKey('add-to-calendar')), findsNothing);
      await t.pumpWidget(const SizedBox());
    });

    testWidgets('a hot place in July is offered «عقب المغرب» first', (
      t,
    ) async {
      final july2pm = DateTime.utc(2026, 7, 15, 11, 5);
      await _pump(t, ShareHangout(place: _beach, clock: () => july2pm));
      expect(find.byKey(const ValueKey('when-sunset')), findsOneWidget);
      expect(defaultWhen(_beach, july2pm), WhenId.sunset);
      await t.pumpWidget(const SizedBox());
    });
  });

  group('the invitation banner', () {
    testWidgets('a plan from last week has gone, and «اقترح وقت ثاني» leads on', (
      t,
    ) async {
      var proposed = 0;
      await _pump(
        t,
        InviteBanner(
          place: _mall,
          when: WhenId.tomorrow,
          day: '2026-01-08',
          clock: () => _thursday5pm,
          onPropose: () => proposed++,
        ),
      );
      expect(find.text('الدعوة هذي راحت'), findsOneWidget);
      expect(find.byKey(const ValueKey('invite-accept')), findsNothing);
      await t.tap(find.byKey(const ValueKey('invite-propose')));
      expect(proposed, 1);
      await t.pumpWidget(const SizedBox());
    });

    testWidgets('«باچر» sent today names the weekday, and goes on the calendar', (
      t,
    ) async {
      await _pump(
        t,
        InviteBanner(
          place: _mall,
          when: WhenId.tomorrow,
          day: '2026-01-15',
          clock: () => _thursday5pm,
        ),
      );
      expect(find.text('ربعك عازمينك هني'), findsOneWidget);
      expect(find.textContaining('باچر الجمعة'), findsOneWidget);
      expect(find.byKey(const ValueKey('add-to-calendar')), findsOneWidget);
      await t.pumpWidget(const SizedBox());
    });

    testWidgets('a link with no day is read as it always was: no weekday, no '
        'calendar, never passed', (t) async {
      await _pump(
        t,
        InviteBanner(
          place: _mall,
          when: WhenId.tomorrow,
          clock: () => _thursday5pm,
        ),
      );
      expect(find.text('ربعك عازمينك هني'), findsOneWidget);
      expect(find.textContaining('باچر الجمعة'), findsNothing);
      expect(find.textContaining('باچر'), findsOneWidget);
      expect(find.byKey(const ValueKey('add-to-calendar')), findsNothing);
      await t.pumpWidget(const SizedBox());
    });
  });

  group('/pick', () {
    Future<void> pick(WidgetTester t, String query) async {
      t.view.physicalSize = const Size(780, 3200);
      t.view.devicePixelRatio = 2;
      addTearDown(t.view.reset);
      final router = GoRouter(
        routes: [
          GoRoute(
            path: '/',
            builder: (_, _) => Scaffold(
              body: PickScreen(query: query, clock: () => _thursday5pm),
            ),
          ),
          GoRoute(path: '/salem', builder: (_, _) => const Text('salem')),
          GoRoute(path: '/search', builder: (_, _) => const Text('search')),
          GoRoute(
            path: '/places/:slug',
            builder: (_, s) => Text('place ${s.pathParameters['slug']}'),
          ),
        ],
      );
      await t.pumpWidget(
        MaterialApp.router(
          routerConfig: router,
          locale: const Locale('ar'),
          supportedLocales: const [Locale('ar')],
          localizationsDelegates: const [
            GlobalMaterialLocalizations.delegate,
            GlobalWidgetsLocalizations.delegate,
            GlobalCupertinoLocalizations.delegate,
          ],
          builder: (c, w) =>
              Directionality(textDirection: TextDirection.rtl, child: w!),
        ),
      );
      await t.pump();
    }

    final three = '${_park.slug},${_souq.slug},${_towers.slug}';

    testWidgets('a vote carries the place\'s own dated link, then the calendar', (
      t,
    ) async {
      final b = FakeShare()..native = true;
      debugShareBackend = b;
      await pick(t, '?p=$three&when=tonight-8&d=2026-01-15');
      expect(find.byKey(const ValueKey('add-to-calendar')), findsNothing);
      await t.tap(find.byKey(ValueKey('pick-vote-${_towers.slug}')));
      await t.pump();
      await t.pump();
      expect(b.lastText, startsWith('أنا مع ٣: ${_towers.nameAr} 👍'));
      expect(
        b.lastText,
        contains('/places/${_towers.slug}/?when=tonight-8&d=2026-01-15'),
      );
      expect(find.byKey(const ValueKey('add-to-calendar')), findsOneWidget);
    });

    testWidgets('a shortlist sent yesterday for «الليلة» has gone: no vote', (
      t,
    ) async {
      final b = FakeShare()..native = true;
      debugShareBackend = b;
      await pick(t, '?p=$three&when=tonight-8&d=2026-01-14');
      expect(find.text('الوقت اللي اختاروه عدّى'), findsOneWidget);
      await t.tap(find.byKey(ValueKey('pick-vote-${_towers.slug}')));
      await t.pump();
      expect(b.calls, isEmpty);
    });
  });

  group('«رسّلها» on a card', () {
    Future<List<String>> card(WidgetTester t, {required bool shareable}) async {
      final visited = <String>[];
      t.view.physicalSize = const Size(780, 1600);
      t.view.devicePixelRatio = 2;
      addTearDown(t.view.reset);
      final router = GoRouter(
        routes: [
          GoRoute(
            path: '/',
            builder: (_, _) => Scaffold(
              body: SizedBox(
                width: 256,
                height: 200,
                child: PlaceCard(place: _towers, shareable: shareable),
              ),
            ),
          ),
          GoRoute(
            path: '/places/:slug',
            builder: (_, s) {
              visited.add(s.uri.toString());
              return const Text('place');
            },
          ),
        ],
      );
      await t.pumpWidget(
        MaterialApp.router(
          routerConfig: router,
          locale: const Locale('ar'),
          supportedLocales: const [Locale('ar')],
          localizationsDelegates: const [
            GlobalMaterialLocalizations.delegate,
            GlobalWidgetsLocalizations.delegate,
            GlobalCupertinoLocalizations.delegate,
          ],
          builder: (c, w) =>
              Directionality(textDirection: TextDirection.rtl, child: w!),
        ),
      );
      await t.pump();
      return visited;
    }

    testWidgets('a shareable card carries a named 48dp button that opens the '
        'place at its share panel', (t) async {
      // Disposed at the end of the test body, not in a tearDown: the handle
      // check runs before tearDowns do.
      final semantics = t.ensureSemantics();
      final visited = await card(t, shareable: true);
      final share = find.byKey(const ValueKey('card-share'));
      expect(share, findsOneWidget);
      expect(t.getSize(share).width, greaterThanOrEqualTo(48));
      expect(t.getSize(share).height, greaterThanOrEqualTo(48));
      expect(
        find.bySemanticsLabel('رسّل ${_towers.nameAr} للربع'),
        findsOneWidget,
      );
      await t.tap(share);
      await t.pumpAndSettle();
      expect(visited, ['/places/${_towers.slug}?share=1']);
      semantics.dispose();
    });

    testWidgets('a card that is not shareable has no such button', (t) async {
      await card(t, shareable: false);
      expect(find.byKey(const ValueKey('card-share')), findsNothing);
    });

    // One app per test: WainApp keeps its router across a second pumpWidget
    // of the same type, so a second `pumpAt` would still show the first
    // location.
    testWidgets('Explore carries it', (t) async {
      await pumpAt(t, '/explore');
      expect(find.byKey(const ValueKey('card-share')), findsWidgets);
    });

    testWidgets('the home picks carry it', (t) async {
      await pumpAt(t, '/');
      expect(find.byKey(const ValueKey('card-share')), findsWidgets);
    });

    testWidgets('a place page opened with ?share=1 lands on its panel', (
      t,
    ) async {
      await pumpAt(t, '/places/${_towers.slug}?share=1');
      await t.pumpAndSettle();
      final panel = find.byType(ShareHangout);
      expect(panel, findsOneWidget);
      final view = t.getRect(find.byType(Scrollable).first);
      final top = t.getRect(panel).top;
      expect(
        top >= view.top - 1 && top < view.bottom,
        isTrue,
        reason: 'panel top $top in $view',
      );
    });
  });
}
