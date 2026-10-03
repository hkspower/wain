// «طلباتي» in the app: the tab exists only while the device holds an order,
// the card shows what the device kept and no status it cannot know, and
// cancelling is a sentence into the shop's thread marked «طلبت» here.
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:wain/app/app_state.dart';
import 'package:wain/main.dart';
import 'package:wain/map/wain_map.dart';
import 'package:wain/orders/order_kit.dart';
import 'package:wain/orders/order_store.dart';
import 'package:wain/share/share_service.dart';

import 'app_smoke_test.dart' show tab, settleSteps;

class _Share extends ShareBackend {
  Uri? lastUrl;
  @override
  Future<bool?> nativeShare(String text, String title) async => null;
  @override
  Future<bool> openWhatsApp(Uri uri) async {
    lastUrl = uri;
    return true;
  }

  @override
  Future<bool> copy(String text) async => true;
}

final at = DateTime(2026, 8, 20, 9, 0);

TrackedOrder seed() => TrackedOrder(
  id: '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d',
  token: 'f1e2d3c4b5a60718293a4b5c6d7e8f90',
  reference: '9A8B7C',
  placeSlug: 'mubarakiya-tea-houses',
  placeNameAr: 'مقاهي المباركية',
  totalFils: 1000,
  pickupAt: '09:30',
  placedAt: at.subtract(const Duration(minutes: 5)).toUtc().toIso8601String(),
  whatsapp: '51234567',
  lines: const [
    OrderLine(id: 'm1', nameAr: 'چاي كرك', priceFils: 250, qty: 2),
    OrderLine(id: 'm2', nameAr: 'قهوة عربية', priceFils: 500, qty: 1),
  ],
  noteAr: 'بدون سكر',
);

Future<void> pump(WidgetTester t, String location, OrderStore store) async {
  t.view.physicalSize = const Size(780, 1688);
  t.view.devicePixelRatio = 2;
  addTearDown(t.view.reset);
  await t.pumpWidget(
    WainApp(
      state: AppState.ephemeral(),
      initialLocation: location,
      orderStore: store,
    ),
  );
  await t.pump(const Duration(milliseconds: 400));
}

void main() {
  setUp(() => debugTileUrl = '');
  tearDown(() {
    debugTileUrl = null;
    debugShareBackend = null;
  });

  testWidgets(
    'with nothing ordered: the empty state; the tab is there only while you are on it',
    (t) async {
      await pump(t, '/orders', OrderStore.ephemeral());
      expect(find.text('ما عندك طلبات'), findsOneWidget);
      expect(
        tab('طلباتي'),
        findsOneWidget,
        reason: 'the branch on screen always has its tab',
      );
      await t.tap(tab('الرئيسية'));
      await settleSteps(t);
      expect(tab('طلباتي'), findsNothing);
      expect(tab('بحث'), findsOneWidget);
    },
  );

  testWidgets('the store round-trips its JSON in the web\'s shape', (t) async {
    final o = seed();
    final back = TrackedOrder.fromJson(o.toJson())!;
    expect(back.reference, '9A8B7C');
    expect(back.channel, 'whatsapp');
    expect(back.lines.length, 2);
    expect(back.lines.first.qty, 2);
    expect(back.noteAr, 'بدون سكر');
    expect(back.cancelledByMe, isFalse);
    // A record from before this build, with no channel, is a database order.
    final legacy = TrackedOrder.fromJson({
      'id': 'a',
      'token': 'b',
      'reference': 'C',
    })!;
    expect(legacy.channel, 'db');
    expect(TrackedOrder.fromJson({'id': 'a'}), isNull);
  });

  testWidgets(
    'one order on the device: the tab appears, and the card says what it can',
    (t) async {
      final store = OrderStore.ephemeral()
        ..clock = (() => at)
        ..remember(seed());
      await pump(t, '/', store);
      expect(tab('طلباتي'), findsOneWidget);
      await t.tap(tab('طلباتي'));
      await settleSteps(t);
      expect(find.text('9A8B7C'), findsOneWidget);
      expect(find.text('أرسلته عبر واتساب'), findsOneWidget);
      expect(find.textContaining('الحالة ما تنعرض هني'), findsOneWidget);
      expect(find.textContaining('ما قدرنا نتأكد'), findsNothing);
      expect(find.textContaining('بانتظار التجهيز'), findsNothing);
      expect(find.text('مقاهي المباركية'), findsOneWidget);
      expect(find.text('٩:٣٠ ص'), findsOneWidget);
      expect(find.textContaining('چاي كرك'), findsOneWidget);
      expect(find.textContaining('×٢'), findsOneWidget);
      expect(find.text('١٫٠٠٠ د.ك'), findsOneWidget);
      expect(find.text('ملاحظتك: بدون سكر'), findsOneWidget);
      expect(find.textContaining('مدفوع'), findsNothing);
      expect(find.text('الدفع عند الاستلام'), findsOneWidget);
    },
  );

  testWidgets('«افتح المحادثة» opens the thread with the shop', (t) async {
    final b = _Share();
    debugShareBackend = b;
    final store = OrderStore.ephemeral()..remember(seed());
    await pump(t, '/orders', store);
    await t.tap(find.byKey(ValueKey('order-thread-${seed().id}')));
    await t.pump();
    expect(b.lastUrl.toString(), 'https://wa.me/96551234567');
  });

  testWidgets(
    'cancelling is a sentence into the same thread, marked «طلبت» here',
    (t) async {
      final b = _Share();
      debugShareBackend = b;
      final store = OrderStore.ephemeral()
        ..clock = (() => at)
        ..remember(seed());
      await pump(t, '/orders', store);
      final id = seed().id;
      await t.tap(find.byKey(ValueKey('order-cancel-$id')));
      await t.pump();
      await t.pump();
      expect(find.textContaining('تبي تلغي الطلب 9A8B7C'), findsOneWidget);
      await t.tap(find.byKey(const ValueKey('order-cancel-yes')));
      await t.pump();
      await t.pump();
      expect(
        b.lastUrl.toString(),
        startsWith('https://wa.me/96551234567?text='),
      );
      final text = Uri.decodeQueryComponent(b.lastUrl!.query.substring(5));
      expect(text, cancelOrderMessage('9A8B7C'));
      expect(store.orders.single.cancelledByMe, isTrue);
      expect(store.orders.single.cancelledAt, at.toUtc().toIso8601String());
      expect(find.text('طلبت إلغاءه'), findsOneWidget);
      expect(find.textContaining('طلبت الإلغاء عبر واتساب'), findsOneWidget);
      expect(find.textContaining('المكان ألغى'), findsNothing);
      expect(find.byKey(ValueKey('order-cancel-$id')), findsNothing);
      expect(find.byKey(ValueKey('order-thread-$id')), findsOneWidget);
    },
  );

  testWidgets('backing out of the dialog changes nothing', (t) async {
    final b = _Share();
    debugShareBackend = b;
    final store = OrderStore.ephemeral()..remember(seed());
    await pump(t, '/orders', store);
    await t.tap(find.byKey(ValueKey('order-cancel-${seed().id}')));
    await t.pump();
    await t.tap(find.byKey(const ValueKey('order-cancel-no')));
    await t.pump();
    expect(b.lastUrl, isNull);
    expect(store.orders.single.cancelledByMe, isFalse);
  });

  testWidgets(
    'forgetting the last order empties the list and the tab goes with it',
    (t) async {
      final store = OrderStore.ephemeral()..remember(seed());
      await pump(t, '/orders', store);
      expect(tab('طلباتي'), findsOneWidget);
      await t.tap(find.byKey(ValueKey('order-forget-${seed().id}')));
      await settleSteps(t);
      expect(store.count, 0);
      expect(find.text('ما عندك طلبات'), findsOneWidget);
      // Still on the page, so its tab is still there; leave, and it is gone.
      expect(tab('طلباتي'), findsOneWidget);
      await t.tap(tab('الرئيسية'));
      await settleSteps(t);
      expect(tab('طلباتي'), findsNothing);
      expect(find.text('إلى وين؟'), findsWidgets);
    },
  );

  for (final size in const [Size(390, 844), Size(320, 568)]) {
    testWidgets('lays out at ${size.width.toInt()}px with an order', (t) async {
      t.view.physicalSize = size * 2;
      t.view.devicePixelRatio = 2;
      addTearDown(t.view.reset);
      final store = OrderStore.ephemeral()..remember(seed());
      await t.pumpWidget(
        WainApp(
          state: AppState.ephemeral(),
          initialLocation: '/orders',
          orderStore: store,
        ),
      );
      await t.pump(const Duration(milliseconds: 400));
      expect(t.takeException(), isNull);
      expect(find.text('9A8B7C'), findsOneWidget);
    });
  }
}
