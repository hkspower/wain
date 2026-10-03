/// The app's half of `/api/wain.php`, for orders only — `src/lib/backend.ts`
/// and the order calls in `orders.ts`, in Dart.
///
/// The site's back end is wain's own PHP file on wainkw.com (4 October; the
/// header of `scripts/publish/wain-api.php` says what it is). The app talks
/// to it for one thing today: placing an order that the shop reads on its
/// board, and following it. The queue and registration stay out of the app.
///
/// A bundle has no origin, so the address has to be absolute — the default is
/// the live site's. `--dart-define=WAIN_BACKEND_URL=none` switches it off,
/// and the order panel falls back to the WhatsApp channel for a place with a
/// number, exactly as the web does with `NEXT_PUBLIC_WAIN_BACKEND=none`.
library;

import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;

import 'order_kit.dart';

const String _configured = String.fromEnvironment('WAIN_BACKEND_URL');

/// Unset or empty → the live site's endpoint; «none» → off; anything else is
/// the endpoint itself. An unset define arrives as the EMPTY string (the
/// `??` trap the web's CI hit), which is why empty means the default and not
/// «off».
String resolveBackendUrl([String configured = _configured]) {
  final c = configured.trim();
  if (c.toLowerCase() == 'none') return '';
  if (c.isEmpty) return 'https://www.wainkw.com/api/wain.php';
  return c;
}

final String kBackendUrl = resolveBackendUrl();
bool get kBackendEnabled => kBackendUrl.isNotEmpty;

/// `REQUEST_DEADLINE_MS` in net.ts: long enough for a cold round trip on a
/// slow mobile connection, short enough that a dead socket is noticed.
const Duration kApiDeadline = Duration(seconds: 15);

/// The server's answer, flat. `ok` with the body's fields in [data], or a
/// refusal named the server's way (`invalid`, `duplicate`, `closed`,
/// `rate_limited`…) — plus three this side adds: `network` (nothing answered),
/// `not_installed` (the host's own 404 page), `bad_reply` (not JSON).
class ApiResult {
  final bool ok;
  final Map<String, Object?> data;
  final String error;
  final int status;
  final String? field;
  const ApiResult.ok(this.data, this.status)
    : ok = true,
      error = '',
      field = null;
  const ApiResult.fail(this.error, this.status, {this.field})
    : ok = false,
      data = const {};

  /// A refusal worth sending again: the server unable to reach its own
  /// database, or a gateway in front of it — never a rule it applied.
  bool get retryable =>
      !ok && (error == 'db_unavailable' || status == 502 || status == 503 || status == 504);
}

/// One action, one request. Throws nothing: a transport failure is an
/// [ApiResult] named `network`, so a caller that forgets to catch cannot hang.
class OrderApi {
  OrderApi({http.Client? client, String? url})
    : _client = client ?? http.Client(),
      url = url ?? kBackendUrl;

  final http.Client _client;
  final String url;

  Future<ApiResult> call(String action, Map<String, Object?> body) async {
    if (url.isEmpty) return const ApiResult.fail('disabled', 0);
    final uri = Uri.parse('$url${url.contains('?') ? '&' : '?'}a=$action');
    http.Response res;
    try {
      res = await _client
          .post(
            uri,
            headers: const {
              'Content-Type': 'application/json',
              'Accept': 'application/json',
            },
            body: jsonEncode(body),
          )
          .timeout(kApiDeadline);
    } on TimeoutException {
      return const ApiResult.fail('timeout', 0);
    } catch (_) {
      return const ApiResult.fail('network', 0);
    }
    Object? json;
    try {
      json = jsonDecode(utf8.decode(res.bodyBytes));
    } catch (_) {
      json = null;
    }
    if (json is Map && json.containsKey('ok')) {
      final m = Map<String, Object?>.from(json);
      if (m['ok'] == true) return ApiResult.ok(m, res.statusCode);
      return ApiResult.fail(
        m['error'] is String ? m['error'] as String : 'error',
        res.statusCode,
        field: m['field'] is String ? m['field'] as String : null,
      );
    }
    return ApiResult.fail(
      res.statusCode == 404 || res.statusCode == 405 ? 'not_installed' : 'bad_reply',
      res.statusCode,
    );
  }

  /// `order_place`, in the server's own column names. Retried once on a
  /// transport failure or a retryable refusal: the id makes that safe — a
  /// repeat either writes the row or meets the row it already wrote.
  Future<ApiResult> placeOrder(
    OrderInput input, {
    required String id,
    required String token,
    required String phone,
  }) async {
    final body = <String, Object?>{
      'id': id,
      'track_token': token,
      'place_slug': input.placeSlug,
      'place_name_ar': input.placeNameAr,
      'lines': [for (final l in input.lines) l.toJson()],
      'total_fils': orderTotal(input.lines),
      'pickup_at': input.pickupAt,
      'customer_name': input.customerName.trim(),
      'customer_phone': phone,
      'note_ar': input.noteAr.trim(),
    };
    var r = await call('order_place', body);
    if (!r.ok && (r.error == 'network' || r.error == 'timeout' || r.retryable)) {
      r = await call('order_place', body);
    }
    return r;
  }

  /// `order_status`: the order, or null for «not there / wrong token», or a
  /// failure when nothing could be asked.
  Future<ApiResult> orderStatus(String id, String token) =>
      call('order_status', {'id': id, 'token': token});

  /// `order_cancel`: the status the order ended up in (`cancelled`, or the
  /// one that made it too late), null when the pair matched nothing.
  Future<ApiResult> cancelOrder(String id, String token) =>
      call('order_cancel', {'id': id, 'token': token});
}

/// Arabic for the failures every caller meets the same way; anything else
/// keeps the caller's own sentence — `describeApiFailure` in backend.ts.
String describeApiFailure(ApiResult r, String fallback) {
  switch (r.error) {
    case 'network':
      return 'انقطع الاتصال. تأكد من الشبكة وجرّب مرة ثانية.';
    case 'timeout':
      return 'طوّل الرد. جرّب مرة ثانية.';
    case 'disabled':
    case 'not_installed':
    case 'db_unavailable':
    case 'db_error':
      return 'الخدمة مو متاحة حالياً. جرّب بعد شوي.';
    case 'rate_limited':
      return 'طلبات كثيرة بسرعة. استنى شوي وجرّب مرة ثانية.';
    default:
      return fallback;
  }
}

/// What the server knows about an order — `OrderState` in orders.ts.
class OrderState {
  final String status;
  final String? readyAt;
  final String? collectedAt;
  final String? cancelledAt;
  const OrderState({
    required this.status,
    this.readyAt,
    this.collectedAt,
    this.cancelledAt,
  });

  static OrderState? fromJson(Object? raw) {
    if (raw is! Map) return null;
    final status = raw['status'];
    if (status is! String) return null;
    return OrderState(
      status: status,
      readyAt: raw['ready_at'] is String ? raw['ready_at'] as String : null,
      collectedAt: raw['collected_at'] is String
          ? raw['collected_at'] as String
          : null,
      cancelledAt: raw['cancelled_at'] is String
          ? raw['cancelled_at'] as String
          : null,
    );
  }

  /// Nothing changes after these, so there is nothing left to poll for.
  bool get isFinal => status == 'collected' || status == 'cancelled';
}
