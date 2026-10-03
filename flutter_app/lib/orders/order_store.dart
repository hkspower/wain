/// «طلباتي» on this device, and the two ways an order leaves the app.
///
/// With the back end on (the default — `order_api.dart`), an order is a row
/// the shop reads on its board: `order_place`, then `order_status` polled while
/// the card is on screen, and `order_cancel` from the card. That is the web's
/// «db» channel (`orderChannel()` in orders.ts), and the shop's answer is a
/// status this store caches per order.
///
/// With it off (`--dart-define=WAIN_BACKEND_URL=none`), the web's WhatsApp
/// mode: the order becomes a message to the shop's number, opened in WhatsApp,
/// and this store is the whole record. Nothing can learn what the shop did
/// with the message; the card says so, and «ألغِ» is a sentence into the same
/// thread, not a status change.
///
/// Either way the record is the same JSON shape under the same key the web
/// keeps in localStorage (`wain:orders`, `TrackedOrder` in `orders.ts`), so an
/// entry reads the same on either side.
library;

import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../data/models.dart';
import '../data/text_kit.dart';
import '../share/share_service.dart';
import 'order_api.dart';
import 'order_kit.dart';

/// The web's localStorage key — one name for one thing.
const String kOrdersStoreKey = 'wain:orders';

/// Newest first, like the web; older entries fall off the end.
const int _kKeep = 20;

/// What the device remembers so the customer can come back to an order.
/// Field names are the web's (`TrackedOrder`), and are read back leniently:
/// a record written by an older build must still load.
class TrackedOrder {
  final String id;
  final String token;
  final String reference;
  final String placeSlug;
  final String placeNameAr;
  final int totalFils;
  final String pickupAt;
  final String placedAt;

  /// "db" for an order the shop's board holds, "whatsapp" for a message.
  final String channel;
  final String? whatsapp;
  final List<OrderLine> lines;
  final String noteAr;
  final bool cancelledByMe;
  final String? cancelledAt;

  const TrackedOrder({
    required this.id,
    required this.token,
    required this.reference,
    required this.placeSlug,
    required this.placeNameAr,
    required this.totalFils,
    required this.pickupAt,
    required this.placedAt,
    this.channel = 'whatsapp',
    this.whatsapp,
    this.lines = const [],
    this.noteAr = '',
    this.cancelledByMe = false,
    this.cancelledAt,
  });

  TrackedOrder cancelled(String at) => TrackedOrder(
    id: id,
    token: token,
    reference: reference,
    placeSlug: placeSlug,
    placeNameAr: placeNameAr,
    totalFils: totalFils,
    pickupAt: pickupAt,
    placedAt: placedAt,
    channel: channel,
    whatsapp: whatsapp,
    lines: lines,
    noteAr: noteAr,
    cancelledByMe: true,
    cancelledAt: at,
  );

  Map<String, Object?> toJson() => {
    'id': id,
    'token': token,
    'reference': reference,
    'placeSlug': placeSlug,
    'placeNameAr': placeNameAr,
    'totalFils': totalFils,
    'pickupAt': pickupAt,
    'placedAt': placedAt,
    'channel': channel,
    if (whatsapp != null) 'whatsapp': whatsapp,
    'lines': [for (final l in lines) l.toJson()],
    'noteAr': noteAr,
    if (cancelledByMe) 'cancelledByMe': true,
    if (cancelledAt != null) 'cancelledAt': cancelledAt,
  };

  /// The web's own guard: id, token and reference as strings, or it is not
  /// an order. Everything else has a default.
  static TrackedOrder? fromJson(Object? raw) {
    if (raw is! Map) return null;
    final id = raw['id'];
    final token = raw['token'];
    final reference = raw['reference'];
    if (id is! String || token is! String || reference is! String) return null;
    return TrackedOrder(
      id: id,
      token: token,
      reference: reference,
      placeSlug: raw['placeSlug'] is String ? raw['placeSlug'] as String : '',
      placeNameAr: raw['placeNameAr'] is String
          ? raw['placeNameAr'] as String
          : '',
      totalFils: raw['totalFils'] is num
          ? (raw['totalFils'] as num).toInt()
          : 0,
      pickupAt: raw['pickupAt'] is String ? raw['pickupAt'] as String : '',
      placedAt: raw['placedAt'] is String ? raw['placedAt'] as String : '',
      channel: raw['channel'] is String ? raw['channel'] as String : 'db',
      whatsapp: raw['whatsapp'] is String ? raw['whatsapp'] as String : null,
      lines: [
        if (raw['lines'] is List)
          for (final l in raw['lines'] as List) ?OrderLine.fromJson(l),
      ],
      noteAr: raw['noteAr'] is String ? raw['noteAr'] as String : '',
      cancelledByMe: raw['cancelledByMe'] == true,
      cancelledAt: raw['cancelledAt'] is String
          ? raw['cancelledAt'] as String
          : null,
    );
  }
}

/// The identity of one attempt to place one basket — minted once per basket
/// and reused across presses, so a lost tab is not a second order with a
/// second reference (`OrderAttempt` in orders.ts).
class OrderAttempt {
  final String id;
  final String token;
  OrderAttempt() : id = newOrderId(), token = newTrackToken();
  String get reference => orderReference(id);
}

/// What `sendDb` ended in — `OrderResult` in orders.ts.
class DbOrderResult {
  final TrackedOrder? tracked;

  /// The first validation message, or the server's refusal in Arabic.
  final String? problem;

  /// `invalid`, `disabled` (the place stopped taking orders, or no back end)
  /// or `network`; null when it worked.
  final String? reason;
  const DbOrderResult._({this.tracked, this.problem, this.reason});
  bool get ok => problem == null;
}

class WhatsAppOrderResult {
  final TrackedOrder? tracked;
  final String? text;
  final Uri? url;

  /// false when WhatsApp could not be opened: the caller shows the text and
  /// its own copy button.
  final bool opened;

  /// The first validation message, when the order was refused.
  final String? problem;
  const WhatsAppOrderResult._({
    this.tracked,
    this.text,
    this.url,
    this.opened = false,
    this.problem,
  });
  bool get ok => problem == null;
}

class OrderStore extends ChangeNotifier {
  OrderStore._(this._prefs, {required this.api}) : _orders = _read(_prefs);

  final SharedPreferences? _prefs;
  List<TrackedOrder> _orders;

  /// The back end, or null when this build has none — then every order is a
  /// WhatsApp message and nothing here talks to a server.
  final OrderApi? api;

  /// What the server last said about each «db» order, by id.
  final Map<String, OrderState> _states = {};

  /// Orders whose last status read could not be made at all.
  final Set<String> _unreachable = {};

  /// Injected clock for tests; stamps `placedAt` and `cancelledAt`.
  DateTime Function() clock = DateTime.now;

  List<TrackedOrder> get orders => List.unmodifiable(_orders);
  int get count => _orders.length;

  /// Where an order from this place goes — `orderChannel()` in orders.ts.
  /// One channel per build, never both: two send buttons would be two orders
  /// and a board that saw half of them.
  String? channelFor(Place place) {
    if (!acceptsOrders(place)) return null;
    if (api != null) return 'db';
    return (place.orderWhatsApp?.isNotEmpty ?? false) ? 'whatsapp' : null;
  }

  /// A missing or unreadable store is not an error: nothing persists, the
  /// way a private window behaves on the web.
  ///
  /// `backend` is the build's switch (`kBackendEnabled`); a test passes
  /// `backend: false` for the WhatsApp channel, or its own [api].
  static Future<OrderStore> load({OrderApi? api, bool? backend}) async {
    final chosen = api ?? ((backend ?? kBackendEnabled) ? OrderApi() : null);
    try {
      return OrderStore._(await SharedPreferences.getInstance(), api: chosen);
    } catch (_) {
      return OrderStore._(null, api: chosen);
    }
  }

  /// In memory only: tests, and a device whose preferences cannot be opened.
  static OrderStore ephemeral({OrderApi? api, bool? backend}) => OrderStore._(
    null,
    api: api ?? ((backend ?? kBackendEnabled) ? OrderApi() : null),
  );

  OrderState? stateOf(String id) => _states[id];
  bool isUnreachable(String id) => _unreachable.contains(id);

  /// Place a «db» order. Validated WITH a phone (the shop calls when the
  /// order is ready), sent with the attempt's own id so a lost reply and a
  /// second press are one order, remembered once the server has it.
  Future<DbOrderResult> sendDb(
    OrderInput input, {
    required OrderAttempt attempt,
  }) async {
    final problems = validateOrder(input, phoneRequired: true);
    if (problems.isNotEmpty) {
      return DbOrderResult._(problem: problems.first, reason: 'invalid');
    }
    final api = this.api;
    if (api == null) {
      return const DbOrderResult._(
        problem: 'الطلب المسبق مو متاح حالياً. اتصل بالمكان مباشرة.',
        reason: 'disabled',
      );
    }
    final r = await api.placeOrder(
      input,
      id: attempt.id,
      token: attempt.token,
      phone: normalisePhone(input.customerPhone)!,
    );
    // `duplicate` is the same order already there — the first attempt landed
    // and only its reply was lost — and reporting it as a success is what
    // stops a bad signal from pressing send until the shop has four of
    // everything (orders.ts says the same).
    if (r.ok || r.error == 'duplicate') {
      final tracked = TrackedOrder(
        id: attempt.id,
        token: attempt.token,
        reference: attempt.reference,
        placeSlug: input.placeSlug,
        placeNameAr: input.placeNameAr,
        totalFils: orderTotal(input.lines),
        pickupAt: input.pickupAt,
        placedAt: clock().toUtc().toIso8601String(),
        channel: 'db',
        lines: input.lines,
        noteAr: input.noteAr.trim(),
      );
      remember(tracked);
      _states[tracked.id] = const OrderState(status: 'placed');
      return DbOrderResult._(tracked: tracked);
    }
    if (r.error == 'invalid') {
      return const DbOrderResult._(
        problem: 'في معلومة مو مضبوطة. راجع الطلب.',
        reason: 'invalid',
      );
    }
    if (r.error == 'closed') {
      return const DbOrderResult._(
        problem: 'المكان مو مستقبل طلبات مسبقة الحين. اتصل فيهم مباشرة.',
        reason: 'disabled',
      );
    }
    return DbOrderResult._(
      problem: describeApiFailure(
        r,
        'ما وصل الطلب. تأكد من الاتصال وجرّب مرة ثانية.',
      ),
      reason: 'network',
    );
  }

  /// Read one «db» order's state from the server. A wrong pair or a vanished
  /// order is `null` and is kept as the last known; a failed read is marked
  /// unreachable so the card can say «ما قدرنا نتأكد» instead of a stale
  /// status. Returns whether anything is left to poll for.
  Future<bool> refresh(String id) async {
    final api = this.api;
    final order = _orders.where((o) => o.id == id).firstOrNull;
    if (api == null || order == null || order.channel != 'db') return false;
    final r = await api.orderStatus(order.id, order.token);
    if (!r.ok) {
      _unreachable.add(id);
      notifyListeners();
      return true;
    }
    _unreachable.remove(id);
    final state = OrderState.fromJson(r.data['order']);
    if (state != null) _states[id] = state;
    notifyListeners();
    return state == null ? false : !state.isFinal;
  }

  /// The customer calls a «db» order off. The server answers the status the
  /// order ended up in; only a 'cancelled' is the customer's own act.
  Future<String?> cancelDb(String id) async {
    final api = this.api;
    final order = _orders.where((o) => o.id == id).firstOrNull;
    if (api == null || order == null) return 'network';
    final r = await api.cancelOrder(order.id, order.token);
    if (!r.ok) return 'network';
    final status = r.data['status'];
    if (status is! String) return 'unknown';
    if (status == 'cancelled') {
      markCancelledByMe(id);
      _states[id] = OrderState(
        status: 'cancelled',
        cancelledAt: clock().toUtc().toIso8601String(),
      );
      notifyListeners();
    }
    return status;
  }

  static List<TrackedOrder> _read(SharedPreferences? prefs) {
    try {
      final raw = prefs?.getString(kOrdersStoreKey);
      if (raw == null) return [];
      final parsed = jsonDecode(raw);
      if (parsed is! List) return [];
      return [for (final o in parsed) ?TrackedOrder.fromJson(o)];
    } catch (_) {
      return [];
    }
  }

  void _write() {
    _prefs?.setString(
      kOrdersStoreKey,
      jsonEncode([for (final o in _orders) o.toJson()]),
    );
    notifyListeners();
  }

  void remember(TrackedOrder order) {
    _orders = [
      order,
      for (final o in _orders)
        if (o.id != order.id) o,
    ].take(_kKeep).toList();
    _write();
  }

  void forget(String id) {
    _orders = [
      for (final o in _orders)
        if (o.id != id) o,
    ];
    _write();
  }

  /// The customer asked, from here, for the order to be cancelled — the only
  /// record there is, since the shop answers in the thread.
  void markCancelledByMe(String id) {
    final at = clock().toUtc().toIso8601String();
    _orders = [for (final o in _orders) o.id == id ? o.cancelled(at) : o];
    _write();
  }

  /// Send one basket to the shop's WhatsApp. Validated with no phone, then
  /// remembered BEFORE WhatsApp is opened — a chat that opens and is lost is
  /// still an order the customer sent, and «طلباتي» has to show it.
  Future<WhatsAppOrderResult> send(
    OrderInput input, {
    required String digits,
    required OrderAttempt attempt,
    required String pageUrl,
    ShareBackend? backend,
  }) async {
    final problems = validateOrder(input, phoneRequired: false);
    if (problems.isNotEmpty)
      return WhatsAppOrderResult._(problem: problems.first);

    final text = buildOrderMessage(
      placeNameAr: input.placeNameAr,
      reference: attempt.reference,
      lines: input.lines,
      pickupAt: input.pickupAt,
      customerName: input.customerName,
      noteAr: input.noteAr,
      url: pageUrl,
    );
    final url = Uri.parse(whatsappOrderUrl(digits, text));
    final tracked = TrackedOrder(
      id: attempt.id,
      token: attempt.token,
      reference: attempt.reference,
      placeSlug: input.placeSlug,
      placeNameAr: input.placeNameAr,
      totalFils: orderTotal(input.lines),
      pickupAt: input.pickupAt,
      placedAt: clock().toUtc().toIso8601String(),
      whatsapp: digits,
      lines: input.lines,
      noteAr: input.noteAr.trim(),
    );
    remember(tracked);

    var opened = false;
    try {
      opened = await (backend ?? shareBackend).openWhatsApp(url);
    } catch (_) {
      opened = false;
    }
    return WhatsAppOrderResult._(
      tracked: tracked,
      text: text,
      url: url,
      opened: opened,
    );
  }
}
