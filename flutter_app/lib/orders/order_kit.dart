/// طلب مسبق — the pure half, ported from `src/lib/order-kit.ts` and replayed
/// against the web's own answers in `test/order_kit_parity_test.dart`
/// (fixture `orderKit` in `kit_parity.json`, written by
/// `scripts/gen-flutter-fixtures.mjs`).
///
/// Money is integer fils (the dinar has three decimals and floats lie);
/// `buildOrderMessage` is the text the shop receives, byte for byte the web's,
/// so a customer who orders from the app and one who orders from the site put
/// the same message in the same thread. Nothing here reads the catalogue or
/// touches a platform channel.
///
/// Deliberately not a payment system: wain never takes a card and the word
/// «مدفوع» appears nowhere. The message says who pays and when.
library;

import 'dart:math';

import '../data/models.dart';
import '../data/text_kit.dart';

const int kFilsPerDinar = 1000;
const int kMaxQtyPerItem = 20;
const int kMaxLines = 20;

/// Matches the CHECK on orders.note_ar and the web panel's maxLength.
const int kMaxNoteChars = 200;

/// `orderPrepMinutes` bounds — the same numbers as place-kit's clamp and the
/// column's CHECK (orders.test.mjs asserts they agree on the web side).
const int kMinPrepMinutes = 5;
const int kMaxPrepMinutes = 240;
const int kDefaultPrepMinutes = 30;

int clampPrepMinutes(int? minutes) {
  if (minutes == null) return kDefaultPrepMinutes;
  return minutes.clamp(kMinPrepMinutes, kMaxPrepMinutes);
}

/// "٢٫٧٥٠ د.ك" — Arabic-Indic digits and the Arabic decimal separator.
String formatKwd(int fils) {
  final sign = fils < 0 ? '-' : '';
  final abs = fils.abs();
  final dinars = abs ~/ kFilsPerDinar;
  final rest = (abs % kFilsPerDinar).toString().padLeft(3, '0');
  return '$sign${toArabicDigits(dinars)}٫${toArabicDigits(rest)} د.ك';
}

const _arabicIndic = '٠١٢٣٤٥٦٧٨٩';

String _westernDigits(String s) => s.replaceAllMapped(
  RegExp('[٠-٩]'),
  (m) => _arabicIndic.indexOf(m[0]!).toString(),
);

/// "2.750" or "٢٫٧٥٠" → fils; null for anything unparseable, so a typo is a
/// visible error rather than a silent zero.
int? parseKwd(String value) {
  final western = _westernDigits(value.trim())
      .replaceAll('٫', '.')
      .replaceAll(RegExp(r'[،,\s]'), '');
  if (!RegExp(r'^\d{1,5}(\.\d{0,3})?$').hasMatch(western)) return null;
  final parts = western.split('.');
  final whole = int.parse(parts[0]);
  final frac = (parts.length > 1 ? parts[1] : '').padRight(3, '0');
  return whole * kFilsPerDinar + int.parse(frac);
}

class OrderLine {
  final String id;
  final String nameAr;
  final int priceFils;
  final int qty;
  const OrderLine({
    required this.id,
    required this.nameAr,
    required this.priceFils,
    required this.qty,
  });

  Map<String, Object?> toJson() => {
    'id': id,
    'nameAr': nameAr,
    'priceFils': priceFils,
    'qty': qty,
  };

  static OrderLine? fromJson(Object? raw) {
    if (raw is! Map) return null;
    final id = raw['id'];
    final name = raw['nameAr'];
    final price = raw['priceFils'];
    final qty = raw['qty'];
    if (id is! String || name is! String || price is! num || qty is! num)
      return null;
    return OrderLine(
      id: id,
      nameAr: name,
      priceFils: price.toInt(),
      qty: qty.toInt(),
    );
  }
}

int lineTotal(OrderLine l) => l.priceFils * l.qty;
int orderTotal(List<OrderLine> lines) =>
    lines.fold(0, (s, l) => s + lineTotal(l));

/// "18:30" → "٦:٣٠ م". The one place a clock time becomes Arabic.
String timeAr(String hhmm) {
  final m = RegExp(r'^(\d{1,2}):(\d{2})$').firstMatch(hhmm);
  if (m == null) return hhmm;
  final h = int.parse(m[1]!);
  final period = h < 12 ? 'ص' : 'م';
  final h12 = h % 12 == 0 ? 12 : h % 12;
  return '${toArabicDigits(h12)}:${toArabicDigits(m[2]!)} $period';
}

class PickupSlot {
  final String value;
  final String labelAr;
  const PickupSlot(this.value, this.labelAr);
}

String _two(int n) => n.toString().padLeft(2, '0');

/// Pickup slots for the rest of today, on the half hour, the first one after
/// the business's own preparation time. `from` is passed in so a panel
/// renders the same slots it validates against.
List<PickupSlot> pickupSlots(DateTime from, {int count = 8, int? prepMinutes}) {
  var t = DateTime(from.year, from.month, from.day, from.hour, from.minute);
  t = t.add(Duration(minutes: clampPrepMinutes(prepMinutes)));
  // JS: t.setMinutes(t.getMinutes() <= 30 ? 30 : 60) — :60 rolls to the
  // next hour's :00.
  t = DateTime(
    t.year,
    t.month,
    t.day,
    t.hour,
  ).add(Duration(minutes: t.minute <= 30 ? 30 : 60));
  final out = <PickupSlot>[];
  for (var i = 0; i < count; i++) {
    final value = '${_two(t.hour)}:${_two(t.minute)}';
    out.add(PickupSlot(value, timeAr(value)));
    t = t.add(const Duration(minutes: 30));
  }
  return out;
}

/// Short, readable, and said out loud at a counter without confusion.
String orderReference(String id) =>
    id.replaceAll('-', '').substring(0, 6).toUpperCase();

/// Kuwaiti mobile numbers are eight digits and start 5, 6 or 9 — the same
/// shape for a customer's phone and a place's `orderWhatsApp`.
String? normalisePhone(String value) {
  var digits = _westernDigits(value).replaceAll(RegExp(r'[^\d]'), '');
  if (digits.startsWith('00965')) digits = digits.substring(5);
  if (RegExp(r'^965\d{8}$').hasMatch(digits)) digits = digits.substring(3);
  return RegExp(r'^[569]\d{7}$').hasMatch(digits) ? digits : null;
}

final _rng = Random.secure();

/// A v4 UUID from real randomness; the device keeps it, the message carries
/// its first six characters.
String newOrderId() {
  final b = List<int>.generate(16, (_) => _rng.nextInt(256));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  final h = b.map((x) => x.toRadixString(16).padLeft(2, '0')).join();
  return '${h.substring(0, 8)}-${h.substring(8, 12)}-${h.substring(12, 16)}-${h.substring(16, 20)}-${h.substring(20)}';
}

/// 32 hex characters of real randomness.
String newTrackToken() => List<int>.generate(
  16,
  (_) => _rng.nextInt(256),
).map((x) => x.toRadixString(16).padLeft(2, '0')).join();

class OrderInput {
  final String placeSlug;
  final String placeNameAr;
  final List<OrderLine> lines;
  final String pickupAt;
  final String customerName;
  final String customerPhone;
  final String noteAr;
  const OrderInput({
    required this.placeSlug,
    required this.placeNameAr,
    required this.lines,
    required this.pickupAt,
    required this.customerName,
    this.customerPhone = '',
    this.noteAr = '',
  });
}

/// The web's messages, verbatim. `phoneRequired` is false in WhatsApp mode:
/// the shop answers in the thread the customer opened.
List<String> validateOrder(OrderInput input, {bool phoneRequired = true}) {
  final errs = <String>[];
  if (input.lines.isEmpty) errs.add('ما اخترت شي بعد.');
  if (input.lines.length > kMaxLines) errs.add('الطلب كبير — قلّل الأصناف.');
  if (input.lines.any((l) => l.qty < 1 || l.qty > kMaxQtyPerItem)) {
    errs.add('الكمية لازم تكون بين ١ و ${toArabicDigits(kMaxQtyPerItem)}.');
  }
  if (input.lines.any((l) => l.priceFils < 0)) errs.add('في سعر مو مضبوط.');
  if (input.customerName.trim().length < 2) errs.add('اكتب اسمك.');
  if (phoneRequired && normalisePhone(input.customerPhone) == null) {
    errs.add('اكتب رقم كويتي صحيح (٨ أرقام).');
  }
  if (!RegExp(r'^\d{2}:\d{2}$').hasMatch(input.pickupAt))
    errs.add('اختر وقت الاستلام.');
  if (input.noteAr.trim().length > kMaxNoteChars) errs.add('الملاحظة طويلة.');
  return errs;
}

/// The order as the shop receives it. `url` is the place's page, passed in
/// so the text is the web's byte for byte.
String buildOrderMessage({
  required String placeNameAr,
  required String reference,
  required List<OrderLine> lines,
  required String pickupAt,
  required String customerName,
  String? noteAr,
  required String url,
}) {
  final note = noteAr?.trim() ?? '';
  return [
    'طلب مسبق من وين — رقم الطلب $reference',
    placeNameAr,
    '',
    for (final l in lines)
      '${toArabicDigits(l.qty)}× ${l.nameAr} — ${formatKwd(lineTotal(l))}',
    'المجموع التقريبي: ${formatKwd(orderTotal(lines))}',
    '',
    'الاستلام: الساعة ${timeAr(pickupAt)}',
    'الاسم: ${customerName.trim()}',
    if (note.isNotEmpty) 'ملاحظة: $note',
    '',
    'الدفع عند الاستلام 👍',
    url,
  ].join('\n');
}

/// `wa.me/965<digits>?text=` — one recipient. `Uri.encodeComponent` leaves
/// exactly the characters JS's `encodeURIComponent` leaves (-_.!~*'()), so
/// the two sides produce the same link.
String whatsappOrderUrl(String digits, String text) =>
    'https://wa.me/965$digits?text=${Uri.encodeComponent(text)}';

/// Said into the same thread, so the shop finds the order by its reference.
String cancelOrderMessage(String reference) =>
    'السلام عليكم، أبي ألغي الطلب رقم $reference إذا ما بدأتوا فيه. شكراً';

/// Whether this place can take a pre-order from the app, and by what route.
/// The app has no database, so the only channel is WhatsApp, and it needs a
/// number — as `orderChannel()` in `orders.ts` with Supabase unconfigured.
bool ordersByWhatsApp(Place p) =>
    acceptsOrders(p) && (p.orderWhatsApp?.isNotEmpty ?? false);
