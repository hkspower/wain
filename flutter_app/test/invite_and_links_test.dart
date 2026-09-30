import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:wain/app/deep_link.dart';
import 'package:wain/data/catalogue.dart';
import 'package:wain/share/hangout.dart';
import 'package:wain/share/invite_banner.dart';
import 'package:wain/share/share_service.dart';

import 'hangout_panel_test.dart' show FakeShare;

void main() {
  tearDown(() => debugShareBackend = null);
  final place = getPlace('the-avenues')!;
  final before8pm = DateTime.utc(2026, 1, 15, 14, 0); // 17:00 Kuwait
  final after8pm = DateTime.utc(2026, 1, 15, 18, 30); // 21:30 Kuwait

  Future<void> pump(WidgetTester t, Widget w) async {
    t.view.physicalSize = const Size(780, 1600);
    t.view.devicePixelRatio = 2;
    addTearDown(t.view.reset);
    await t.pumpWidget(
      MaterialApp(
        locale: const Locale('ar'),
        supportedLocales: const [Locale('ar')],
        localizationsDelegates: const [
          GlobalMaterialLocalizations.delegate,
          GlobalWidgetsLocalizations.delegate,
          GlobalCupertinoLocalizations.delegate,
        ],
        builder: (c, child) =>
            Directionality(textDirection: TextDirection.rtl, child: child!),
        home: Scaffold(body: SingleChildScrollView(child: w)),
      ),
    );
  }

  group('the invitation banner', () {
    testWidgets('a live invite: the plan, the reply and the way there', (
      t,
    ) async {
      await pump(
        t,
        InviteBanner(
          place: place,
          when: WhenId.tonight8,
          clock: () => before8pm,
        ),
      );
      expect(find.text('ربعك عازمينك هني'), findsOneWidget);
      expect(find.textContaining('الليلة الساعة ٨'), findsOneWidget);
      expect(find.byKey(const ValueKey('invite-accept')), findsOneWidget);
      expect(find.byKey(const ValueKey('invite-directions')), findsOneWidget);
    });

    testWidgets('an hour that has gone says so, and offers no reply', (
      t,
    ) async {
      await pump(
        t,
        InviteBanner(
          place: place,
          when: WhenId.tonight8,
          clock: () => after8pm,
        ),
      );
      expect(find.text('الدعوة هذي راحت'), findsOneWidget);
      expect(find.byKey(const ValueKey('invite-accept')), findsNothing);
      expect(find.textContaining('المكان نفسه بعده هني'), findsOneWidget);
    });

    testWidgets(
      '«الحين» is relative to a moment the link does not carry: never claimed passed',
      (t) async {
        await pump(
          t,
          InviteBanner(place: place, when: WhenId.now, clock: () => after8pm),
        );
        expect(find.text('ربعك عازمينك هني'), findsOneWidget);
      },
    );

    testWidgets(
      'replying sends the short confirmation, and the button then says «رديت عليهم»',
      (t) async {
        final b = FakeShare()..native = true;
        debugShareBackend = b;
        await pump(
          t,
          InviteBanner(
            place: place,
            when: WhenId.tonight8,
            clock: () => before8pm,
          ),
        );
        await t.tap(find.byKey(const ValueKey('invite-accept')));
        await t.pump();
        await t.pump();
        expect(
          b.lastText,
          'تمام، أنا معكم 👍 ${place.nameAr} — الليلة الساعة ٨',
        );
        expect(find.text('رديت عليهم'), findsOneWidget);
      },
    );

    testWidgets('a reply that could only be copied tells them to paste it', (
      t,
    ) async {
      final b = FakeShare()
        ..whatsapp = false
        ..copyOk = true;
      debugShareBackend = b;
      await pump(
        t,
        InviteBanner(
          place: place,
          when: WhenId.tonight8,
          clock: () => before8pm,
        ),
      );
      await t.tap(find.byKey(const ValueKey('invite-accept')));
      await t.pump();
      await t.pump();
      expect(find.text('نسخنا ردّك — الصقه بالجروب.'), findsOneWidget);
    });
  });

  group('links from outside', () {
    test('a forwarded invitation becomes a route, query and all', () {
      expect(
        locationFromLink(
          Uri.parse(
            'https://www.wainkw.com/places/kuwait-towers/?when=tonight-8',
          ),
        ),
        '/places/kuwait-towers?when=tonight-8',
      );
      expect(
        locationFromLink(Uri.parse('https://wainkw.com/places/marina-beach')),
        '/places/marina-beach',
      );
      expect(
        locationFromLink(
          Uri.parse('https://www.wainkw.com/explore/?category=coffee'),
        ),
        '/explore?category=coffee',
      );
      expect(locationFromLink(Uri.parse('https://www.wainkw.com/')), '/');
    });

    test('anything that is not ours, or not a route we have, is ignored', () {
      expect(
        locationFromLink(
          Uri.parse('https://evil.example/places/kuwait-towers'),
        ),
        isNull,
      );
      expect(
        locationFromLink(
          Uri.parse('http://www.wainkw.com/places/kuwait-towers'),
        ),
        isNull,
        reason: 'https only',
      );
      expect(
        locationFromLink(
          Uri.parse('https://www.wainkw.com.evil.example/places/x'),
        ),
        isNull,
      );
      expect(
        locationFromLink(Uri.parse('https://www.wainkw.com/admin')),
        isNull,
      );
      expect(
        locationFromLink(Uri.parse('https://www.wainkw.com/places/../admin')),
        isNull,
      );
      expect(
        locationFromLink(Uri.parse('https://www.wainkw.com/places/UPPER')),
        isNull,
      );
      expect(
        locationFromLink(Uri.parse('wain://places/kuwait-towers')),
        isNull,
      );
    });
  });
}
