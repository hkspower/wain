import 'dart:convert';
import 'package:http/http.dart' as http;
import '../models/product.dart';

/// Talks to the Sporta PHP API on Hostinger (public_html/knet/api/).
/// The server computes order totals from stored prices — the app never
/// sends a price, so totals cannot be tampered with.
class Api {
  static const base = 'https://www.sporta.com.kw/knet/api/';

  static Future<List<Product>> products() async {
    final res = await http.get(Uri.parse('${base}?r=products'))
        .timeout(const Duration(seconds: 15));
    if (res.statusCode != 200) throw Exception('products ${res.statusCode}');
    final body = jsonDecode(utf8.decode(res.bodyBytes)) as Map<String, dynamic>;
    return (body['products'] as List)
        .map((e) => Product.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  /// Creates the order server-side and returns {track_id, pay_url}.
  static Future<({String trackId, String payUrl})> createOrder(
      List<CartItem> items, String lang) async {
    final res = await http
        .post(Uri.parse('${base}?r=order'),
            headers: {'Content-Type': 'application/json'},
            body: jsonEncode({
              'lang': lang,
              'items': items
                  .map((i) => {'slug': i.slug, 'qty': i.qty, 'size': i.size})
                  .toList(),
            }))
        .timeout(const Duration(seconds: 20));
    if (res.statusCode != 200) throw Exception('order ${res.statusCode}');
    final j = jsonDecode(res.body) as Map<String, dynamic>;
    return (trackId: j['track_id'] as String, payUrl: j['pay_url'] as String);
  }

  /// 'paid' | 'pending' | 'failed'
  static Future<String> orderStatus(String trackId) async {
    final res = await http
        .get(Uri.parse('${base}?r=status&id=$trackId'))
        .timeout(const Duration(seconds: 15));
    if (res.statusCode != 200) return 'pending';
    final j = jsonDecode(res.body) as Map<String, dynamic>;
    return (j['payment_status'] ?? 'pending') as String;
  }
}
