import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:wain/data/catalogue.dart';
import 'package:wain/share/hangout_panel.dart';
import 'package:wain/share/share_service.dart';

class FakeShare implements ShareBackend {
  bool? native; // null = no share sheet
  bool whatsapp = true;
  bool copyOk = true;
  final calls = <String>[];
  String? lastText, lastTitle;
  Uri? lastWa;

  @override
  Future<bool?> nativeShare(String text, String title) async {
    calls.add('native');
    lastText = text;
    lastTitle = title;
    return native;
  }

  @override
  Future<bool> openWhatsApp(Uri uri) async {
    calls.add('wa');
    lastWa = uri;
    return whatsapp;
  }

  @override
  Future<bool> copy(String text) async {
    calls.add('copy');
    lastText = text;
    return copyOk;
  }
}

void main() {
  tearDown(() => debugShareBackend = null);

  group('the order of fallbacks', () {
    test('share sheet first', () async {
      final b = FakeShare()..native = true;
      debugShareBackend = b;
      expect(await shareHangout(text: 't', title: 'x'), ShareOutcome.shared);
      expect(b.calls, ['native']);
    });

    test('backing out of the sheet is a decision, not a fault — and nothing else is tried', () async {
      final b = FakeShare()..native = false;
      debugShareBackend = b;
      expect(await shareHangout(text: 't', title: 'x'), ShareOutcome.cancelled);
      expect(b.calls, ['native']);
    });

    test('no share sheet → WhatsApp, with the text URL-encoded', () async {
      final b = FakeShare();
      debugShareBackend = b;
      expect(
        await shareHangout(text: 'مرحبا بك\nhttps://a/b?c=d', title: 'x'),
        ShareOutcome.whatsapp,
      );
      expect(b.calls, ['native', 'wa']);
      expect(b.lastWa.toString(), startsWith('https://wa.me/?text='));
      expect(
        Uri.decodeQueryComponent(b.lastWa!.query.substring(5)),
        'مرحبا بك\nhttps://a/b?c=d',
      );
    });

    test('no WhatsApp either → the clipboard; never a dead end', () async {
      final b = FakeShare()..whatsapp = false;
      debugShareBackend = b;
      expect(await shareHangout(text: 't', title: 'x'), ShareOutcome.copied);
      expect(b.calls, ['native', 'wa', 'copy']);
    });

    test('only when even the clipboard fails is it a failure', () async {
      final b = FakeShare()
        ..whatsapp = false
        ..copyOk = false;
      debugShareBackend = b;
      expect(await shareHangout(text: 't', title: 'x'), ShareOutcome.failed);
    });
  });

  group('the panel', () {
    final kuwaitJuly2pm = DateTime.utc(
      2026,
      7,
      15,
      11,
      5,
    ); // 14:05 in Kuwait, July
    final kuwaitJanuary2pm = DateTime.utc(2026, 1, 15, 11, 5);
    final beach = getPlace('marina-beach')!; // outdoor
    final mall = getPlace('the-avenues')!;

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
      await t.pump();
    }

    testWidgets(
      'an outdoor place at 2pm in July is not offered «الحين» or «بعد ساعة»',
      (t) async {
        await pump(t, ShareHangout(place: beach, clock: () => kuwaitJuly2pm));
        expect(find.byKey(const ValueKey('when-now')), findsNothing);
        expect(find.byKey(const ValueKey('when-soon')), findsNothing);
        expect(find.byKey(const ValueKey('when-tonight-8')), findsOneWidget);
        await t.pumpWidget(const SizedBox());
      },
    );

    testWidgets('the same place in January is', (t) async {
      await pump(t, ShareHangout(place: beach, clock: () => kuwaitJanuary2pm));
      expect(find.byKey(const ValueKey('when-now')), findsOneWidget);
      await t.pumpWidget(const SizedBox());
    });

    testWidgets(
      'sending composes the plan with the chosen time and hands it to the share sheet',
      (t) async {
        final b = FakeShare()..native = true;
        debugShareBackend = b;
        await pump(t, ShareHangout(place: mall, clock: () => kuwaitJanuary2pm));
        await t.tap(find.byKey(const ValueKey('when-tonight-9')));
        await t.pump();
        await t.tap(find.byKey(const ValueKey('hangout-send')));
        await t.pump();
        await t.pump();
        expect(b.lastTitle, '${mall.nameAr} — وين؟');
        expect(b.lastText, contains('الليلة الساعة ٩'));
        expect(
          b.lastText,
          contains(
            'https://www.wainkw.com/places/${mall.slug}/?when=tonight-9',
          ),
        );
        expect(b.lastText, contains('destination=${mall.lat},${mall.lng}'));
        await t.pumpWidget(const SizedBox());
      },
    );

    testWidgets(
      '«انتسخت» is shown when it was copied; nothing is shown when it was shared',
      (t) async {
        final b = FakeShare()
          ..whatsapp = false
          ..copyOk = true;
        debugShareBackend = b;
        await pump(t, ShareHangout(place: mall, clock: () => kuwaitJanuary2pm));
        await t.tap(find.byKey(const ValueKey('hangout-send')));
        await t.pump();
        await t.pump();
        expect(find.text('انتسخت — الصقها بالجروب.'), findsOneWidget);
        await t.pumpWidget(const SizedBox());
      },
    );

    testWidgets(
      'with several choices, tapping one reports it (so the map and panel stay together)',
      (t) async {
        final picked = <String>[];
        await pump(
          t,
          ShareHangout(
            place: mall,
            choices: [mall, beach],
            onChoose: picked.add,
            clock: () => kuwaitJanuary2pm,
          ),
        );
        await t.tap(find.byKey(ValueKey('place-${beach.slug}')));
        expect(picked, [beach.slug]);
        await t.pumpWidget(const SizedBox());
      },
    );

    testWidgets('one choice shows no «أي مكان؟» picker', (t) async {
      await pump(
        t,
        ShareHangout(
          place: mall,
          choices: [mall],
          clock: () => kuwaitJanuary2pm,
        ),
      );
      expect(find.text('أي مكان؟'), findsNothing);
      await t.pumpWidget(const SizedBox());
    });
  });
}
