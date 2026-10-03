// The order panel and «طلباتي» on the back end («db» channel): the panel asks
// for a phone and sends the server's own column names; a lost first attempt
// is one order; the card reads the status back, says «ما قدرنا نتأكد» when it
// cannot, and a cancel is a real cancel the server answers.
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:provider/provider.dart';
import 'package:wain/app/app_state.dart';
import 'package:wain/data/catalogue.dart';
import 'package:wain/data/models.dart';
import 'package:wain/main.dart';
import 'package:wain/map/wain_map.dart';
import 'package:wain/orders/order_api.dart';
import 'package:wain/orders/order_kit.dart';
import 'package:wain/orders/order_panel.dart';
import 'package:wain/orders/order_store.dart';

import 'app_smoke_test.dart' show settleSteps, tab;
import 'order_panel_test.dart' show withMenu;

/// The server, as a script: every request is recorded, and each entry of
/// [plan] answers one in turn — fail in transit, or answer with a status and
/// a body. Once the plan runs out everything answers `{ok:true}`.
class FakeServer {
  final requests = <({String action, Map<String, Object?> body})>[];
  final plan = <Object>[];
  late final OrderApi api = OrderApi(
    client: MockClient((req) async {
      final action = req.url.queryParameters['a']!;
      final body = Map<String, Object?>.from(jsonDecode(req.body) as Map);
      requests.add((action: action, body: body));
      final step = plan.isEmpty ? null : plan.removeAt(0);
      if (step == 'fail') throw http.ClientException('dropped');
      if (step is http.Response) return step;
      return http.Response('{"ok":true}', 200);
    }),
    url: 'https://example.test/api/wain.php',
  );
  static http.Response json(int status, Object body) =>
      http.Response(jsonEncode(body), status, headers: {'content-type': 'application/json'});
}

final at = DateTime(2026, 8, 20, 18, 5);
const kId = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const kToken = 'f1e2d3c4b5a60718293a4b5c6d7e8f90';

TrackedOrder dbOrder() => TrackedOrder(
  id: kId,
  token: kToken,
  reference: '9A8B7C',
  placeSlug: 'mubarakiya-tea-houses',
  placeNameAr: 'مقاهي المباركية',
  totalFils: 500,
  pickupAt: '18:30',
  placedAt: at.toUtc().toIso8601String(),
  channel: 'db',
  lines: const [OrderLine(id: 'm1', nameAr: 'چاي كرك', priceFils: 250, qty: 2)],
);

Future<OrderStore> pumpPanel(WidgetTester t, Place place, FakeServer server) async {
  t.view.physicalSize = const Size(780, 2400);
  t.view.devicePixelRatio = 2;
  addTearDown(t.view.reset);
  final store = OrderStore.ephemeral(api: server.api)..clock = () => at;
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

Future<void> basket(WidgetTester t, {String phone = '51234567'}) async {
  await t.tap(find.byKey(const ValueKey('order-plus-m1')));
  await t.tap(find.byKey(const ValueKey('order-plus-m1')));
  await t.pump();
  await t.enterText(find.byKey(const ValueKey('order-name')), 'سالم');
  await t.enterText(find.byKey(const ValueKey('order-phone')), phone);
  await t.tap(find.byKey(const ValueKey('order-slot-18:30')));
  await t.pump();
}

Future<void> pumpApp(WidgetTester t, String location, OrderStore store) async {
  t.view.physicalSize = const Size(780, 1688);
  t.view.devicePixelRatio = 2;
  addTearDown(t.view.reset);
  await t.pumpWidget(
    WainApp(state: AppState.ephemeral(), initialLocation: location, orderStore: store),
  );
  await t.pump(const Duration(milliseconds: 400));
}

void main() {
  setUp(() => debugTileUrl = '');
  tearDown(() => debugTileUrl = null);
  final tea = getPlace('mubarakiya-tea-houses')!;

  test('the switch: unset is the live endpoint, «none» is off, a URL is itself', () {
    expect(resolveBackendUrl(''), 'https://www.wainkw.com/api/wain.php');
    expect(resolveBackendUrl('none'), '');
    expect(resolveBackendUrl(' NONE '), '');
    expect(resolveBackendUrl('http://10.0.2.2:4221/api/wain.php'), 'http://10.0.2.2:4221/api/wain.php');
  });

  test('the channel: db with a back end, WhatsApp without — and never both', () {
    final server = FakeServer();
    final withApi = OrderStore.ephemeral(api: server.api);
    final noApi = OrderStore.ephemeral(backend: false);
    final menuOnly = withMenu(tea);
    final withNumber = withMenu(tea, whatsapp: '51234567');
    expect(withApi.channelFor(withNumber), 'db');
    expect(withApi.channelFor(menuOnly), 'db', reason: 'a menu is enough on the board');
    expect(withApi.channelFor(tea), isNull, reason: 'no menu, no panel');
    expect(noApi.channelFor(withNumber), 'whatsapp');
    expect(noApi.channelFor(menuOnly), isNull, reason: 'a menu with nowhere to go');
  });

  testWidgets('the panel asks for a phone in db mode and sends the server\'s column names', (t) async {
    final server = FakeServer();
    server.plan.add(FakeServer.json(200, {'ok': true, 'id': 'x', 'status': 'placed', 'again': false}));
    final store = await pumpPanel(t, withMenu(tea), server);
    expect(find.byKey(const ValueKey('order-phone')), findsOneWidget);
    expect(find.text('أرسل الطلب'), findsOneWidget);
    expect(find.textContaining('واتساب'), findsNothing);
    await basket(t);
    await t.tap(find.byKey(const ValueKey('order-send')));
    await t.pump();
    await t.pump();
    expect(server.requests.length, 1);
    final r = server.requests.single;
    expect(r.action, 'order_place');
    expect(r.body['place_slug'], 'mubarakiya-tea-houses');
    expect(r.body['customer_phone'], '51234567');
    expect(r.body['customer_name'], 'سالم');
    expect(r.body['pickup_at'], '18:30');
    expect(r.body['total_fils'], 500);
    expect((r.body['lines'] as List).length, 1);
    expect((r.body['track_token'] as String).length, 32);
    expect(RegExp(r'^[0-9a-f-]{36}$').hasMatch(r.body['id'] as String), isTrue);
    // Remembered as a db order, placed, with the reference on screen.
    expect(store.count, 1);
    expect(store.orders.single.channel, 'db');
    expect(store.stateOf(store.orders.single.id)?.status, 'placed');
    expect(find.byKey(const ValueKey('order-placed')), findsOneWidget);
    expect(find.text('وصل طلبك'), findsOneWidget);
    expect(find.textContaining(store.orders.single.reference, findRichText: true), findsOneWidget);
    expect(find.byKey(const ValueKey('order-open-wa')), findsNothing);
  });

  testWidgets('a phone is required in db mode, in the web\'s words, and nothing is sent', (t) async {
    final server = FakeServer();
    final store = await pumpPanel(t, withMenu(tea), server);
    await basket(t, phone: '22345678');
    await t.tap(find.byKey(const ValueKey('order-send')));
    await t.pump();
    expect(find.text('اكتب رقم كويتي صحيح (٨ أرقام).'), findsOneWidget);
    expect(server.requests, isEmpty);
    expect(store.count, 0);
  });

  testWidgets('a dropped first attempt is sent again with the same id — one order', (t) async {
    final server = FakeServer();
    server.plan.add('fail');
    server.plan.add(FakeServer.json(200, {'ok': true, 'id': 'x', 'status': 'placed', 'again': false}));
    final store = await pumpPanel(t, withMenu(tea), server);
    await basket(t);
    await t.tap(find.byKey(const ValueKey('order-send')));
    await t.pump();
    await t.pump();
    expect(server.requests.length, 2);
    expect(server.requests[0].body['id'], server.requests[1].body['id']);
    expect(store.count, 1);
  });

  // Three tests, not one: a second pumpWidget with the same tree shape reuses
  // the panel's State, and the placed view from the first send stays up.
  testWidgets('the server\'s «duplicate» is already placed', (t) async {
    final server = FakeServer();
    server.plan.add(FakeServer.json(409, {'ok': false, 'error': 'duplicate'}));
    final store = await pumpPanel(t, withMenu(tea), server);
    await basket(t);
    await t.tap(find.byKey(const ValueKey('order-send')));
    await t.pump();
    await t.pump();
    expect(store.count, 1, reason: 'the row is there; only the reply was lost');
    expect(find.byKey(const ValueKey('order-placed')), findsOneWidget);
  });

  testWidgets('«closed» is a refusal that sends them to the shop', (t) async {
    final server = FakeServer();
    server.plan.add(FakeServer.json(409, {'ok': false, 'error': 'closed'}));
    final store = await pumpPanel(t, withMenu(tea), server);
    await basket(t);
    await t.tap(find.byKey(const ValueKey('order-send')));
    await t.pump();
    await t.pump();
    expect(store.count, 0);
    expect(find.textContaining('مو مستقبل طلبات'), findsOneWidget);
  });

  testWidgets('«invalid» is a refusal in the web\'s words', (t) async {
    final server = FakeServer();
    server.plan.add(FakeServer.json(422, {'ok': false, 'error': 'invalid', 'field': 'customer_phone'}));
    await pumpPanel(t, withMenu(tea), server);
    await basket(t);
    await t.tap(find.byKey(const ValueKey('order-send')));
    await t.pump();
    await t.pump();
    expect(find.text('في معلومة مو مضبوطة. راجع الطلب.'), findsOneWidget);
  });

  testWidgets('the host\'s own 404 page is «not available», not a crash', (t) async {
    final server = FakeServer();
    server.plan.add(http.Response('<html>Not Found</html>', 404));
    final store = await pumpPanel(t, withMenu(tea), server);
    await basket(t);
    await t.tap(find.byKey(const ValueKey('order-send')));
    await t.pump();
    await t.pump();
    expect(store.count, 0);
    expect(find.textContaining('مو متاحة حالياً'), findsOneWidget);
  });

  testWidgets('«طلباتي» reads a db order\'s status back, and shows it', (t) async {
    final server = FakeServer();
    server.plan.add(FakeServer.json(200, {
      'ok': true,
      'order': {'status': 'ready', 'ready_at': '2026-08-20T15:20:00Z', 'collected_at': null, 'cancelled_at': null},
    }));
    final store = OrderStore.ephemeral(api: server.api)
      ..clock = (() => at)
      ..remember(dbOrder());
    await pumpApp(t, '/orders', store);
    await t.pump(const Duration(milliseconds: 100));
    expect(server.requests.where((r) => r.action == 'order_status').length, 1);
    expect(server.requests.first.body['id'], kId);
    expect(server.requests.first.body['token'], kToken);
    expect(find.text('جاهز'), findsOneWidget);
    expect(find.textContaining('طلبك جاهز'), findsOneWidget);
    expect(find.textContaining('واتساب'), findsNothing);
    expect(find.byKey(const ValueKey('order-cancel-$kId')), findsNothing, reason: 'the food exists');
    expect(find.byKey(const ValueKey('order-thread-$kId')), findsNothing);
    expect(tab('طلباتي'), findsOneWidget);
  });

  testWidgets('when the status cannot be read, the card says so instead of inventing one', (t) async {
    final server = FakeServer();
    server.plan.add('fail');
    final store = OrderStore.ephemeral(api: server.api)
      ..clock = (() => at)
      ..remember(dbOrder());
    await pumpApp(t, '/orders', store);
    await t.pump(const Duration(milliseconds: 100));
    expect(find.textContaining('ما قدرنا نتأكد'), findsOneWidget);
    expect(find.text('9A8B7C'), findsOneWidget);
    expect(find.text('بانتظار التجهيز'), findsOneWidget);
  });

  testWidgets('cancelling a placed db order asks the server and marks it the customer\'s own', (t) async {
    final server = FakeServer();
    server.plan.add(FakeServer.json(200, {
      'ok': true,
      'order': {'status': 'placed', 'ready_at': null, 'collected_at': null, 'cancelled_at': null},
    }));
    server.plan.add(FakeServer.json(200, {'ok': true, 'status': 'cancelled'}));
    final store = OrderStore.ephemeral(api: server.api)
      ..clock = (() => at)
      ..remember(dbOrder());
    await pumpApp(t, '/orders', store);
    await t.pump(const Duration(milliseconds: 100));
    expect(find.text('بانتظار التجهيز'), findsOneWidget);
    await t.tap(find.byKey(const ValueKey('order-cancel-$kId')));
    await t.pump();
    await t.pump();
    expect(find.textContaining('تبي تلغي الطلب 9A8B7C'), findsOneWidget);
    await t.tap(find.byKey(const ValueKey('order-cancel-yes')));
    await t.pump();
    await t.pump();
    final cancel = server.requests.where((r) => r.action == 'order_cancel').single;
    expect(cancel.body['token'], kToken);
    expect(store.orders.single.cancelledByMe, isTrue);
    expect(find.text('ألغيت الطلب'), findsOneWidget);
    expect(find.textContaining('المكان ألغى'), findsNothing);
    expect(find.byKey(const ValueKey('order-cancel-$kId')), findsNothing);
  });

  testWidgets('a cancel that is too late says so, and the card follows the server', (t) async {
    final server = FakeServer();
    server.plan.add(FakeServer.json(200, {
      'ok': true,
      'order': {'status': 'placed', 'ready_at': null, 'collected_at': null, 'cancelled_at': null},
    }));
    server.plan.add(FakeServer.json(200, {'ok': true, 'status': 'ready'}));
    server.plan.add(FakeServer.json(200, {
      'ok': true,
      'order': {'status': 'ready', 'ready_at': '2026-08-20T15:20:00Z', 'collected_at': null, 'cancelled_at': null},
    }));
    final store = OrderStore.ephemeral(api: server.api)
      ..clock = (() => at)
      ..remember(dbOrder());
    await pumpApp(t, '/orders', store);
    await t.pump(const Duration(milliseconds: 100));
    await t.tap(find.byKey(const ValueKey('order-cancel-$kId')));
    await t.pump();
    await t.pump();
    await t.tap(find.byKey(const ValueKey('order-cancel-yes')));
    await t.pump();
    await t.pump();
    expect(store.orders.single.cancelledByMe, isFalse);
    expect(find.textContaining('بدأ يجهّز طلبك'), findsOneWidget);
    expect(find.text('جاهز'), findsOneWidget);
  });

  testWidgets('a WhatsApp order next to a db order keeps its own card', (t) async {
    final server = FakeServer();
    server.plan.add(FakeServer.json(200, {'ok': true, 'order': null}));
    final store = OrderStore.ephemeral(api: server.api)
      ..clock = (() => at)
      ..remember(dbOrder())
      ..remember(TrackedOrder(
        id: '11111111-2222-4333-8444-555555555555',
        token: 'b' * 32,
        reference: '111111',
        placeSlug: 'mubarakiya-tea-houses',
        placeNameAr: 'مقاهي المباركية',
        totalFils: 250,
        pickupAt: '19:00',
        placedAt: at.toUtc().toIso8601String(),
        whatsapp: '51234567',
      ));
    await pumpApp(t, '/orders', store);
    await t.pump(const Duration(milliseconds: 100));
    expect(find.text('أرسلته عبر واتساب'), findsOneWidget);
    expect(find.text('بانتظار التجهيز'), findsOneWidget);
    expect(server.requests.where((r) => r.action == 'order_status').length, 1, reason: 'only the db order is asked about');
    await t.tap(tab('الرئيسية'));
    await settleSteps(t);
    expect(tab('طلباتي'), findsOneWidget);
  });
}
