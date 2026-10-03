// «اطلب مقدّماً» in the app: the panel appears only for a place with a menu
// AND a number, asks for no phone, refuses an incomplete order in the web's
// words, and hands WhatsApp the web's exact message — remembered on the
// device before WhatsApp is opened, and shown with a copy button when it
// cannot be.
import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:wain/data/catalogue.dart';
import 'package:wain/data/models.dart';
import 'package:wain/orders/order_panel.dart';
import 'package:wain/orders/order_store.dart';
import 'package:wain/share/share_service.dart';

class _Share extends ShareBackend {
  bool whatsapp = true;
  Uri? lastWa;
  String? copied;
  @override
  Future<bool?> nativeShare(String text, String title) async => null;
  @override
  Future<bool> openWhatsApp(Uri uri) async {
    lastWa = uri;
    return whatsapp;
  }

  @override
  Future<bool> copy(String text) async {
    copied = text;
    return true;
  }
}

/// A real place given the fixture menu the web suites use, and a number.
Place withMenu(Place p, {String? whatsapp}) => Place(
  slug: p.slug,
  name: p.name,
  nameAr: p.nameAr,
  category: p.category,
  area: p.area,
  areaAr: p.areaAr,
  lat: p.lat,
  lng: p.lng,
  priceLevel: p.priceLevel,
  emoji: p.emoji,
  taglineAr: p.taglineAr,
  descriptionAr: p.descriptionAr,
  highlightsAr: p.highlightsAr,
  bestTimeAr: p.bestTimeAr,
  setting: p.setting,
  seasonAr: p.seasonAr,
  tagsAr: p.tagsAr,
  menuAr: const [
    MenuItem(id: 'm1', nameAr: 'چاي كرك', priceFils: 250),
    MenuItem(id: 'm2', nameAr: 'قهوة عربية', priceFils: 500),
    MenuItem(id: 'm3', nameAr: 'كيك اليوم', priceFils: 1750, soldOut: true),
  ],
  acceptsOrdersFlag: true,
  orderPrepMinutes: 15,
  orderNoteAr: 'الاستلام من الكاشير.',
  orderWhatsApp: whatsapp,
);

final at = DateTime(2026, 8, 20, 18, 5);
String decoded(Uri u) => Uri.decodeQueryComponent(u.query.substring(5));

void main() {
  tearDown(() => debugShareBackend = null);
  final tea = getPlace('mubarakiya-tea-houses')!;

  Future<OrderStore> pump(WidgetTester t, Place place) async {
    t.view.physicalSize = const Size(780, 2400);
    t.view.devicePixelRatio = 2;
    addTearDown(t.view.reset);
    // The WhatsApp channel: this file is the app without a back end.
    final store = OrderStore.ephemeral(backend: false)..clock = () => at;
    await t.pumpWidget(
      ChangeNotifierProvider<OrderStore>.value(
        value: store,
        child: MaterialApp(
          locale: const Locale('ar'),
          supportedLocales: const [Locale('ar')],
          localizationsDelegates: const [
            GlobalMaterialLocalizations.delegate,
            GlobalWidgetsLocalizations.delegate,
            GlobalCupertinoLocalizations.delegate,
          ],
          builder: (c, child) =>
              Directionality(textDirection: TextDirection.rtl, child: child!),
          home: Scaffold(
            body: SingleChildScrollView(
              child: OrderPanel(place: place, clock: () => at),
            ),
          ),
        ),
      ),
    );
    await t.pump();
    return store;
  }

  Future<void> basket(WidgetTester t) async {
    await t.tap(find.byKey(const ValueKey('order-plus-m1')));
    await t.tap(find.byKey(const ValueKey('order-plus-m1')));
    await t.tap(find.byKey(const ValueKey('order-plus-m2')));
    await t.pump();
    await t.enterText(find.byKey(const ValueKey('order-name')), 'سالم');
    await t.tap(find.byKey(const ValueKey('order-slot-18:30')));
    await t.pump();
  }

  testWidgets('no panel without a number, nor without a menu', (t) async {
    await pump(t, withMenu(tea));
    expect(find.byKey(const ValueKey('order-panel')), findsNothing);
    await pump(t, tea);
    expect(find.byKey(const ValueKey('order-panel')), findsNothing);
  });

  testWidgets(
    'with a menu and a number: the panel, no phone, send disabled until something is chosen',
    (t) async {
      await pump(t, withMenu(tea, whatsapp: '51234567'));
      expect(find.byKey(const ValueKey('order-panel')), findsOneWidget);
      expect(find.textContaining('واتساب'), findsWidgets);
      expect(find.textContaining('الدفع عند الاستلام'), findsWidgets);
      expect(find.textContaining('مدفوع'), findsNothing);
      expect(find.byKey(const ValueKey('order-phone')), findsNothing);
      expect(find.byKey(const ValueKey('order-name')), findsOneWidget);
      expect(find.text('خلصت'), findsOneWidget);
      final send = t.widget<FilledButton>(
        find.byKey(const ValueKey('order-send')),
      );
      expect(send.onPressed, isNull);
      expect(find.text('أرسل عبر واتساب'), findsOneWidget);
      // The first slot is after the shop's 15 minutes, on the half hour.
      expect(find.byKey(const ValueKey('order-slot-18:30')), findsOneWidget);
      expect(find.byKey(const ValueKey('order-slot-18:00')), findsNothing);
    },
  );

  testWidgets(
    'the total counts in fils and the sold-out item cannot be added',
    (t) async {
      await pump(t, withMenu(tea, whatsapp: '51234567'));
      await t.tap(find.byKey(const ValueKey('order-plus-m1')));
      await t.tap(find.byKey(const ValueKey('order-plus-m1')));
      await t.pump();
      expect(find.text('٠٫٥٠٠ د.ك'), findsWidgets);
      expect(find.byKey(const ValueKey('order-plus-m3')), findsNothing);
      await t.tap(find.byKey(const ValueKey('order-minus-m1')));
      await t.pump();
      expect(
        t.widget<Text>(find.byKey(const ValueKey('order-total'))).data,
        '٠٫٢٥٠ د.ك',
      );
    },
  );

  testWidgets(
    'an incomplete order is refused in the web\'s words, and never asks for a phone',
    (t) async {
      final b = _Share();
      debugShareBackend = b;
      final store = await pump(t, withMenu(tea, whatsapp: '51234567'));
      await t.tap(find.byKey(const ValueKey('order-plus-m1')));
      await t.pump();
      await t.tap(find.byKey(const ValueKey('order-send')));
      await t.pump();
      await t.pump();
      expect(find.byKey(const ValueKey('order-errors')), findsOneWidget);
      expect(find.text('اكتب اسمك.'), findsOneWidget);
      expect(find.textContaining('رقم كويتي'), findsNothing);
      expect(b.lastWa, isNull);
      expect(store.count, 0);
    },
  );

  testWidgets(
    'sending hands WhatsApp the web\'s message and remembers the order',
    (t) async {
      final b = _Share();
      debugShareBackend = b;
      final store = await pump(t, withMenu(tea, whatsapp: '51234567'));
      await basket(t);
      await t.tap(find.byKey(const ValueKey('order-send')));
      await t.pump();
      await t.pump();
      expect(
        b.lastWa.toString(),
        startsWith('https://wa.me/96551234567?text='),
      );
      final text = decoded(b.lastWa!);
      expect(text, startsWith('طلب مسبق من وين — رقم الطلب '));
      expect(text, contains('٢× چاي كرك — ٠٫٥٠٠ د.ك'));
      expect(text, contains('١× قهوة عربية — ٠٫٥٠٠ د.ك'));
      expect(text, contains('المجموع التقريبي: ١٫٠٠٠ د.ك'));
      expect(text, contains('الاستلام: الساعة ٦:٣٠ م'));
      expect(text, contains('الاسم: سالم'));
      expect(text, contains('الدفع عند الاستلام 👍'));
      expect(
        text,
        endsWith('https://www.wainkw.com/places/mubarakiya-tea-houses/'),
      );
      expect(text, isNot(contains('مدفوع')));

      expect(store.count, 1);
      final o = store.orders.single;
      expect(o.channel, 'whatsapp');
      expect(o.whatsapp, '51234567');
      expect(o.lines.length, 2);
      expect(o.totalFils, 1000);
      expect(text, contains(o.reference));
      expect(o.placedAt, at.toUtc().toIso8601String());

      expect(find.byKey(const ValueKey('order-placed')), findsOneWidget);
      expect(find.text('فتحنا لك واتساب'), findsOneWidget);
      expect(find.textContaining(o.reference, findRichText: true), findsOneWidget);
      expect(find.byKey(const ValueKey('order-track')), findsOneWidget);
      expect(find.byKey(const ValueKey('order-failed-text')), findsNothing);
    },
  );

  testWidgets(
    'when WhatsApp cannot be opened: the text, a copy button and a button to try again',
    (t) async {
      final b = _Share()..whatsapp = false;
      debugShareBackend = b;
      final store = await pump(t, withMenu(tea, whatsapp: '51234567'));
      await basket(t);
      await t.tap(find.byKey(const ValueKey('order-send')));
      await t.pump();
      await t.pump();
      final text = decoded(b.lastWa!);
      expect(find.byKey(const ValueKey('order-blocked')), findsOneWidget);
      expect(find.text('جهّزنا رسالتك'), findsOneWidget);
      expect(
        t
            .widget<SelectableText>(
              find.descendant(
                of: find.byKey(const ValueKey('order-failed-text')),
                matching: find.byType(SelectableText),
              ),
            )
            .data,
        text,
      );
      expect(store.count, 1, reason: 'remembered before WhatsApp was tried');
      await t.tap(find.byKey(const ValueKey('order-copy')));
      await t.pump();
      await t.pump();
      expect(b.copied, text);
      expect(find.text('انتسخ ✓'), findsOneWidget);
      b.lastWa = null;
      await t.tap(find.byKey(const ValueKey('order-open-wa')));
      await t.pump();
      expect(
        decoded(b.lastWa!),
        text,
        reason: 'the retry carries the same message, same reference',
      );
    },
  );
}
