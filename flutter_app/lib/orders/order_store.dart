/// «طلباتي» on this device, and the one way an order leaves the app.
///
/// The app has no database (`docs/backend.md`), so its only channel is the
/// web's WhatsApp mode: the order becomes a message to the shop's number,
/// opened in WhatsApp, and this store is the whole record — the same JSON
/// shape under the same key the web keeps in localStorage (`wain:orders`,
/// `TrackedOrder` in `orders.ts`), so an entry reads the same on either side.
/// Nothing here can learn what the shop did with the message; the card says
/// so, and «ألغِ» is a sentence into the same thread, not a status change.
library;

import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../share/share_service.dart';
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

  /// "whatsapp" for everything the app writes; the web also writes "db".
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
  OrderStore._(this._prefs) : _orders = _read(_prefs);

  final SharedPreferences? _prefs;
  List<TrackedOrder> _orders;

  /// Injected clock for tests; stamps `placedAt` and `cancelledAt`.
  DateTime Function() clock = DateTime.now;

  List<TrackedOrder> get orders => List.unmodifiable(_orders);
  int get count => _orders.length;

  /// A missing or unreadable store is not an error: nothing persists, the
  /// way a private window behaves on the web.
  static Future<OrderStore> load() async {
    try {
      return OrderStore._(await SharedPreferences.getInstance());
    } catch (_) {
      return OrderStore._(null);
    }
  }

  /// In memory only: tests, and a device whose preferences cannot be opened.
  static OrderStore ephemeral() => OrderStore._(null);

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
