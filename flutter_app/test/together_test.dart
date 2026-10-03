// The rest of «سالم، شوق، الطلعة والخريطة كلها وحدة» (3 October), mirrored
// from the web: the /pick screen a shortlist opens (PickClient.tsx), شوق's
// answer on the search screen leading to the share panel and to سالم
// (ShouqAnswer.tsx), the invitation's way to the map and to سالم
// (InviteBanner.tsx), and the links that reach all of it from outside.
import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:wain/ai/salem_transcript.dart';
import 'package:wain/app/deep_link.dart';
import 'package:wain/data/catalogue.dart';
import 'package:wain/map/wain_map.dart';
import 'package:wain/screens/pick_screen.dart';
import 'package:wain/screens/salem_screen.dart';
import 'package:wain/share/hangout.dart';
import 'package:wain/share/hangout_panel.dart';
import 'package:wain/share/invite_banner.dart';
import 'package:wain/share/share_service.dart';
import 'package:wain/data/places.g.dart';
import 'package:wain/data/voice_lines.dart' show placeTryLine;

import 'app_smoke_test.dart' show pumpAt;
import 'hangout_panel_test.dart' show FakeShare;

final _towers = getPlace('kuwait-towers')!;
final _souq = getPlace('souq-al-mubarakiya')!;
final _park = getPlace('al-shaheed-park')!;
// 17:00 and 21:30 in Kuwait, January.
final _before8pm = DateTime.utc(2026, 1, 15, 14, 0);
final _after8pm = DateTime.utc(2026, 1, 15, 18, 30);

/// The pick screen on its own, with somewhere for its links to go.
Future<void> _pick(
  WidgetTester t,
  String query, {
  DateTime? now,
  Size size = const Size(390, 1600),
}) async {
  t.view.physicalSize = size * 2;
  t.view.devicePixelRatio = 2;
  addTearDown(t.view.reset);
  final router = GoRouter(
    routes: [
      GoRoute(
        path: '/',
        builder: (_, _) => Scaffold(
          body: PickScreen(query: query, clock: () => now ?? _before8pm),
        ),
      ),
      GoRoute(
        path: '/salem',
        builder: (_, s) => Text('salem asked ${s.uri.queryParameters['q']}'),
      ),
      GoRoute(path: '/search', builder: (_, _) => const Text('the search')),
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

/// Centred, not merely «visible»: at the edge of the list a control can sit
/// under the tab bar, and the tap goes there instead (CLAUDE.md, 1 October).
Future<void> _centre(WidgetTester t, Finder f) async {
  Scrollable.ensureVisible(t.element(f), alignment: 0.5);
  await t.pumpAndSettle();
}

void main() {
  setUp(() {
    debugTileUrl = '';
    SalemTranscript.instance.clear();
  });
  tearDown(() {
    debugTileUrl = null;
    debugShareBackend = null;
  });

  final three = [_towers, _souq, _park];
  final link =
      'p=${three.map((p) => p.slug).join(',')}&when=${WhenId.tonight8.wire}';

  group('/pick — the shortlist a friend sent', () {
    testWidgets('the places, numbered as the message numbered them, on one '
        'map; a vote is «أنا مع ٢» sent back as one tap', (t) async {
      final b = FakeShare()..native = true;
      debugShareBackend = b;
      await _pick(t, link);
      expect(find.text('ربعك يختارون'), findsOneWidget);
      expect(
        find.text('وين نروح الليلة الساعة ٨؟ اختار واحد ورد عليهم.'),
        findsOneWidget,
      );
      for (final (i, n) in const [(0, '١'), (1, '٢'), (2, '٣')]) {
        expect(
          find.descendant(
            of: find.byKey(ValueKey('pick-${three[i].slug}')),
            matching: find.text(n),
          ),
          findsOneWidget,
        );
      }
      final pins = {
        for (final m in t.widgetList<MapPin>(
          find.descendant(
            of: find.byKey(const ValueKey('pick-map')),
            matching: find.byType(MapPin),
          ),
        ))
          m.place.slug,
      };
      expect(pins, {for (final p in three) p.slug});
      await t.tap(find.byKey(ValueKey('pick-vote-${_souq.slug}')));
      await t.pump();
      await t.pump();
      // The vote carries the place's own link under it (3 October), so the
      // chat ends up holding the winner's plan the way one proposal would.
      final voteLink = inviteUrl(_souq, WhenId.tonight8, kInviteOrigin);
      expect(
        b.lastText,
        shortlistVoteMessage(_souq, 1, WhenId.tonight8, voteLink),
      );
      expect(
        b.lastText,
        'أنا مع ٢: ${_souq.nameAr} 👍 — الليلة الساعة ٨\n'
        'https://www.wainkw.com/places/${_souq.slug}/?when=tonight-8',
      );
      expect(b.lastTitle, shortlistTitle());
      expect(
        find.descendant(
          of: find.byKey(ValueKey('pick-vote-${_souq.slug}')),
          matching: find.text('رديت'),
        ),
        findsOneWidget,
      );
    });

    testWidgets('a vote that could only be copied says to paste it', (t) async {
      debugShareBackend = FakeShare()..whatsapp = false;
      await _pick(t, link);
      await t.tap(find.byKey(ValueKey('pick-vote-${_towers.slug}')));
      await t.pump();
      await t.pump();
      expect(find.text('نسخنا ردّك — الصقه بالجروب.'), findsOneWidget);
    });

    testWidgets('an hour that has gone says so, and takes no vote', (t) async {
      final b = FakeShare()..native = true;
      debugShareBackend = b;
      await _pick(t, link, now: _after8pm);
      expect(find.text('الوقت اللي اختاروه عدّى'), findsOneWidget);
      await t.tap(find.byKey(ValueKey('pick-vote-${_towers.slug}')));
      await t.pump();
      expect(b.calls, isEmpty);
    });

    testWidgets('a pin points at its place on the list', (t) async {
      await _pick(t, link);
      t
          .widget<MapPin>(
            find.byWidgetPredicate(
              (w) => w is MapPin && w.place.slug == _park.slug,
            ),
          )
          .onTap();
      await t.pump();
      final box = t.widget<AnimatedContainer>(
        find
            .descendant(
              of: find.byKey(ValueKey('pick-${_park.slug}')),
              matching: find.byType(AnimatedContainer),
            )
            .first,
      );
      final border = (box.decoration as BoxDecoration).border as Border;
      expect(border.top.color, isNot(const Color(0x00000000)));
      final other = t.widget<AnimatedContainer>(
        find
            .descendant(
              of: find.byKey(ValueKey('pick-${_towers.slug}')),
              matching: find.byType(AnimatedContainer),
            )
            .first,
      );
      expect(
        ((other.decoration as BoxDecoration).border as Border).top.color,
        isNot(border.top.color),
        reason: 'only the one pointed at is marked',
      );
    });

    testWidgets('«اسأل سالم عن غيرها» asks him about the first one\'s kind '
        'of place, in its area', (t) async {
      await _pick(t, link);
      final ask = find.byKey(const ValueKey('pick-ask-salem'));
      await t.ensureVisible(ask);
      await t.tap(ask);
      await t.pumpAndSettle();
      expect(
        find.text(
          'salem asked ${getCategory(_towers.category)!.ar} ${_towers.areaAr}',
        ),
        findsOneWidget,
      );
    });

    for (final q in [
      'p=${_towers.slug}',
      'p=not-a-place,${_towers.slug}&when=now',
      '',
    ]) {
      testWidgets('«?$q» is not a shortlist: said, with a way on', (t) async {
        await _pick(t, q);
        expect(find.text('ما لقينا الأماكن اللي بالرابط'), findsOneWidget);
        await t.tap(find.byKey(const ValueKey('pick-salem')));
        await t.pumpAndSettle();
        expect(find.text('salem asked null'), findsOneWidget);
      });
    }

    for (final size in const [
      Size(390, 844),
      Size(320, 568),
      Size(800, 1280),
    ]) {
      testWidgets('laid out at ${size.width.toInt()} without overflow', (
        t,
      ) async {
        await _pick(t, link, size: size);
        await t.pumpAndSettle();
        expect(t.takeException(), isNull);
        await t.scrollUntilVisible(
          find.byKey(const ValueKey('pick-ask-salem')),
          200,
          scrollable: find.byType(Scrollable).first,
        );
        await t.pump();
        expect(t.takeException(), isNull);
      });
    }

    testWidgets('a forwarded /pick link opens the pick screen in the app', (
      t,
    ) async {
      final where = locationFromLink(
        Uri.parse('https://www.wainkw.com/pick/?$link'),
      );
      expect(where, '/pick?$link');
      await pumpAt(t, where!);
      expect(find.byType(PickScreen), findsOneWidget);
      // Its title, whichever the real clock makes it.
      expect(find.byKey(const ValueKey('pick-title')), findsOneWidget);
      expect(find.byKey(ValueKey('pick-${_souq.slug}')), findsOneWidget);
    });
  });

  group('links from outside reach سالم too', () {
    test('/salem with a question is ours; the query rides along', () {
      expect(
        locationFromLink(
          Uri.parse('https://wainkw.com/salem/?q=%D8%A8%D8%AD%D8%B1'),
        ),
        '/salem?q=%D8%A8%D8%AD%D8%B1',
      );
      expect(
        locationFromLink(Uri.parse('https://evil.example/pick/?p=a,b')),
        isNull,
      );
    });

    testWidgets('/salem?q= in the app asks the question as his own', (t) async {
      await pumpAt(t, '/salem?q=${Uri.encodeQueryComponent('بحر')}');
      await t.pump(const Duration(milliseconds: 400));
      expect(
        t.widget<SalemScreen>(find.byType(SalemScreen)).initialQuery,
        'بحر',
      );
      expect(
        SalemTranscript.instance.lines.whereType<ChatText>().where(
          (l) => l.role == 'user' && l.text == 'بحر',
        ),
        hasLength(1),
      );
    });
  });

  group('شوق\'s answer on the search screen', () {
    testWidgets('«رسّلها للربع» points the share panel at the place she named '
        'and brings it into view', (t) async {
      await pumpAt(t, '/search?q=${Uri.encodeQueryComponent('قهوة')}');
      // The place her answer names, read off the card itself.
      final first = kPlaces.firstWhere(
        (p) =>
            find.text('أقترح عليك: ${placeTryLine(p)}').evaluate().isNotEmpty,
      );
      final panel = find.byKey(const ValueKey('search-hangout'));
      // Point the panel somewhere else first.
      final other = t
          .widget<ShareHangout>(panel)
          .choices!
          .firstWhere((p) => p.slug != first.slug);
      await _centre(t, find.byKey(ValueKey('place-${other.slug}')));
      await t.tap(find.byKey(ValueKey('place-${other.slug}')));
      await t.pump();
      expect(t.widget<ShareHangout>(panel).place.slug, other.slug);
      // Back up to her answer.
      final share = find.byKey(const ValueKey('answer-share'));
      await _centre(t, share);
      await t.tap(share);
      await t.pumpAndSettle();
      expect(t.widget<ShareHangout>(panel).place.slug, first.slug);
      final view = t.getRect(find.byType(Scrollable).first);
      final top = t.getRect(panel).top;
      expect(
        top >= view.top && top < view.bottom,
        isTrue,
        reason: 'the panel is on screen: $top in $view',
      );
    });

    testWidgets('«كمّل مع سالم» carries the same question to his chat', (
      t,
    ) async {
      await pumpAt(t, '/search?q=${Uri.encodeQueryComponent('قهوة')}');
      await t.tap(find.byKey(const ValueKey('answer-salem')));
      await t.pumpAndSettle(const Duration(milliseconds: 100));
      expect(
        t.widget<SalemScreen>(find.byType(SalemScreen)).initialQuery,
        'قهوة',
      );
      expect(find.byKey(const ValueKey('chat-places')), findsOneWidget);
    });

    for (final size in const [Size(320, 568), Size(800, 1280)]) {
      testWidgets('the answer card lays out at ${size.width.toInt()}', (
        t,
      ) async {
        await pumpAt(
          t,
          '/search?q=${Uri.encodeQueryComponent('قهوة')}',
          size: size,
        );
        expect(t.takeException(), isNull);
        expect(find.byKey(const ValueKey('answer-share')), findsOneWidget);
      });
    }
  });

  group('the invitation', () {
    testWidgets('«شوفه على الخريطة» brings the place page\'s map into view', (
      t,
    ) async {
      await pumpAt(t, '/places/${_towers.slug}?when=tonight-8');
      final map = find.byType(WainMap);
      final view = t.getRect(find.byType(Scrollable).first);
      expect(t.getRect(map).top, greaterThan(view.bottom), reason: 'below');
      await t.tap(find.byKey(const ValueKey('invite-map')));
      await t.pumpAndSettle();
      final top = t.getRect(map).top;
      expect(top >= view.top && top < view.bottom, isTrue, reason: '$top');
    });

    testWidgets('«اسأل سالم» asks about the same kind of place in the same '
        'area', (t) async {
      await pumpAt(t, '/places/${_souq.slug}?when=tonight-8');
      await t.tap(find.byKey(const ValueKey('invite-salem')));
      await t.pumpAndSettle(const Duration(milliseconds: 100));
      final asked = '${getCategory(_souq.category)!.ar} ${_souq.areaAr}';
      expect(inviteSalemQuestion(_souq), asked);
      expect(
        t.widget<SalemScreen>(find.byType(SalemScreen)).initialQuery,
        asked,
      );
    });

    for (final size in const [
      Size(320, 568),
      Size(390, 844),
      Size(800, 1280),
    ]) {
      testWidgets('the banner lays out at ${size.width.toInt()}', (t) async {
        t.view.physicalSize = size * 2;
        t.view.devicePixelRatio = 2;
        addTearDown(t.view.reset);
        await t.pumpWidget(
          MaterialApp(
            builder: (c, w) =>
                Directionality(textDirection: TextDirection.rtl, child: w!),
            home: Scaffold(
              body: SingleChildScrollView(
                child: InviteBanner(
                  place: _souq,
                  when: WhenId.tonight8,
                  clock: () => _before8pm,
                ),
              ),
            ),
          ),
        );
        expect(t.takeException(), isNull);
        expect(find.text('تبي مكان ثاني؟'), findsOneWidget);
      });
    }
  });
}
