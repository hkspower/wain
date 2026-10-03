// The order kit against the web's own answers — `orderKit` in
// test/fixtures/kit_parity.json, written by scripts/gen-flutter-fixtures.mjs
// from the real src/lib/order-kit.ts. A customer who orders from the app and
// one who orders from the site must put the same message, byte for byte, in
// the same WhatsApp thread.
import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:wain/orders/order_kit.dart';

void main() {
  final f =
      (jsonDecode(File('test/fixtures/kit_parity.json').readAsStringSync())
              as Map<String, dynamic>)['orderKit']
          as Map<String, dynamic>;

  List<OrderLine> lines(Object? raw) => [
    for (final l in raw as List) OrderLine.fromJson(l)!,
  ];

  group('money', () {
    test('formatKwd', () {
      for (final c in f['formatKwd'] as List) {
        expect(
          formatKwd((c['fils'] as num).toInt()),
          c['out'],
          reason: '${c['fils']}',
        );
      }
    });
    test('parseKwd', () {
      for (final c in f['parseKwd'] as List) {
        expect(parseKwd(c['s'] as String), c['out'], reason: '«${c['s']}»');
      }
    });
    test('the note cap is the web\'s', () {
      expect(kMaxNoteChars, f['maxNoteChars']);
    });
  });

  group('time and identity', () {
    test('timeAr', () {
      for (final c in f['timeAr'] as List) {
        expect(timeAr(c['t'] as String), c['out'], reason: '«${c['t']}»');
      }
    });
    test('orderReference', () {
      for (final c in f['orderReference'] as List) {
        expect(orderReference(c['id'] as String), c['out']);
      }
    });
    test('normalisePhone', () {
      for (final c in f['normalisePhone'] as List) {
        expect(
          normalisePhone(c['s'] as String),
          c['out'],
          reason: '«${c['s']}»',
        );
      }
    });
    test('pickupSlots, at six clocks × eight preparation times', () {
      for (final c in f['pickupSlots'] as List) {
        final at = (c['at'] as List).cast<int>();
        final got = pickupSlots(
          DateTime(at[0], at[1], at[2], at[3], at[4]),
          count: c['count'] as int,
          prepMinutes: c['prep'] as int?,
        );
        final want = c['out'] as List;
        expect(
          [
            for (final s in got) [s.value, s.labelAr],
          ],
          [
            for (final w in want) [w['value'], w['labelAr']],
          ],
          reason: 'at $at prep ${c['prep']}',
        );
      }
    });
    test('a fresh id is a v4 UUID and a token is 32 hex', () {
      final id = newOrderId();
      expect(
        RegExp(
          r'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',
        ).hasMatch(id),
        isTrue,
        reason: id,
      );
      expect(RegExp(r'^[0-9a-f]{32}$').hasMatch(newTrackToken()), isTrue);
      expect(newOrderId(), isNot(id));
    });
  });

  group('the message', () {
    final names = ['مقاهي المباركية', 'سوق المباركية', 'مطعم تجريبي'];
    final refs = ['3F2B1C', '9A8B7C', 'FD4195'];
    final times = ['18:30', '09:00', '00:30'];
    final customers = [' سالم ', 'نورة', 'أبو خالد'];
    final slugs = ['mubarakiya-tea-houses', 'souq-al-mubarakiya', 'x-y'];
    final baskets = [
      lines([
        {'id': 'm1', 'nameAr': 'چاي كرك', 'priceFils': 250, 'qty': 2},
        {'id': 'm2', 'nameAr': 'قهوة عربية', 'priceFils': 500, 'qty': 1},
      ]),
      lines([
        {'id': 'm3', 'nameAr': 'كيك اليوم', 'priceFils': 1750, 'qty': 1},
      ]),
      lines([
        {'id': 'a', 'nameAr': 'شاورما لحم (كبير)', 'priceFils': 1250, 'qty': 3},
        {'id': 'b', 'nameAr': 'عصير برتقال', 'priceFils': 750, 'qty': 2},
        {'id': 'c', 'nameAr': 'ماي', 'priceFils': 100, 'qty': 20},
      ]),
    ];

    test('is the web\'s, byte for byte, with and without a note', () {
      for (final c in f['messages'] as List) {
        final i = c['basket'] as int;
        final text = buildOrderMessage(
          placeNameAr: names[i],
          reference: refs[i],
          lines: baskets[i],
          pickupAt: times[i],
          customerName: customers[i],
          noteAr: c['noteAr'] as String?,
          url: 'https://www.wainkw.com/places/${slugs[i]}/',
        );
        expect(text, c['text'], reason: 'basket $i note «${c['noteAr']}»');
        expect(whatsappOrderUrl('51234567', text), c['url']);
        expect(cancelOrderMessage(refs[i]), c['cancel']);
      }
    });

    test('never says paid', () {
      for (final c in f['messages'] as List) {
        expect(c['text'] as String, isNot(contains('مدفوع')));
      }
    });
  });

  group('validation', () {
    test('every message is the web\'s, with and without a phone', () {
      for (final c in f['validate'] as List) {
        final i = c['input'] as Map<String, dynamic>;
        final input = OrderInput(
          placeSlug: i['placeSlug'] as String,
          placeNameAr: i['placeNameAr'] as String,
          lines: lines(i['lines']),
          pickupAt: i['pickupAt'] as String,
          customerName: i['customerName'] as String,
          customerPhone: i['customerPhone'] as String,
          noteAr: i['noteAr'] as String,
        );
        expect(
          validateOrder(input, phoneRequired: c['phoneRequired'] as bool),
          (c['out'] as List).cast<String>(),
          reason:
              '${jsonEncode(i).substring(0, 80)} phoneRequired=${c['phoneRequired']}',
        );
      }
    });
  });
}
