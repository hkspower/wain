/// The arithmetic tests, carried over from the web build's Python suite with
/// the same hand-computed expectations. Where a number here matches a number
/// there, that is deliberate: the two implementations must agree, or one of
/// them is wrong and the customer's filing is the thing that finds out.
library;

import 'package:flutter_test/flutter_test.dart';
import 'package:nokhatha/core/models.dart';
import 'package:nokhatha/core/money.dart';
import 'package:nokhatha/core/xbrl.dart';

void main() {
  group('money', () {
    test('formats KWD with three decimals and grouping', () {
      expect(formatKwd(30481400), '30,481.400');
      expect(formatKwd(7500), '7.500');
      expect(formatKwd(0), '0.000');
      expect(formatKwd(1), '0.001');
    });

    test('a loss prints as a loss, not a lie', () {
      expect(formatKwd(-119000), '−119.000');
      expect(formatKwd(852000, signed: true), '+852.000');
    });

    test('never emits Arabic-Indic digits beside Latin ones', () {
      // The web build printed ١٢٬٠٠٠ next to 850 in one table because a bare
      // toLocaleString followed the device. This must be locale-proof.
      expect(formatKwd(12000), '12.000');
      expect(RegExp(r'^[0-9,.−+]+$').hasMatch(formatKwd(1234567)), isTrue);
    });

    // Found by auditing for crashes rather than by a report: the field's
    // formatter allows digits and nothing capped the count, so twenty of them
    // reached int.parse, which throws past 2^63 — inside a validator, while
    // the person is still typing. Not tampering, not a strange input: leaning
    // on a key.
    test('a number too long for an int is refused, not thrown', () {
      expect(parseKwdToFils('9' * 19), isNull);
      expect(parseKwdToFils('9' * 40), isNull);
      expect(parseKwdToFils('٩' * 25), isNull, reason: 'Arabic-Indic too');
      expect(parseKwdToFils('-' + '9' * 30), isNull);
      expect(parseKwdToFils('9' * 19 + '.500'), isNull);
    });

    test('an amount that would wrap past 64 bits is refused', () {
      // 1e12 dinars is the ceiling; a dinar over it must not come back as a
      // negative number, which is what the multiplication used to produce
      final ok = parseKwdToFils('1000000000000');
      expect(ok, isNotNull);
      expect(ok! > 0, isTrue);
      expect(parseKwdToFils('1000000000001'), isNull);
    });

    test('parses what an Arabic keyboard actually produces', () {
      expect(parseKwdToFils('12.500'), 12500);
      expect(parseKwdToFils('12'), 12000);
      expect(parseKwdToFils('١٢٫٥٠٠'), 12500);
      expect(parseKwdToFils('1,250.750'), 1250750);
      expect(parseKwdToFils(''), isNull);
      expect(parseKwdToFils('abc'), isNull);
      expect(parseKwdToFils('1.2345'), isNull); // finer than a fils
    });
  });

  group('صافي — portfolio', () {
    final holdings = [
      Holding(ticker: 'NBK', name: 'الوطني', quantity: 1000, avgCostFils: 900, priceFils: 1752),
      Holding(ticker: 'ZAIN', name: 'زين', quantity: 500, avgCostFils: 600, priceFils: 362),
    ];

    test('cost, value and profit are exact', () {
      final nbk = holdings[0];
      expect(nbk.costFils, 900000);
      expect(nbk.marketValueFils, 1752000);
      expect(nbk.profitFils, 852000);
    });

    test('a losing position is marked as a loss', () {
      final zain = holdings[1];
      expect(zain.profitFils, -119000);
      expect(zain.profitFils.isNegative, isTrue);
    });

    test('totals are the sum of the parts', () {
      final t = PortfolioTotals.of(holdings);
      expect(t.costFils, 1200000);
      expect(t.marketValueFils, 1933000);
      expect(t.profitFils, 733000);
    });

    test('a percentage of nothing is undefined, not zero', () {
      final free = Holding(
          ticker: 'X', name: '', quantity: 10, avgCostFils: 0, priceFils: 100);
      expect(free.profitPercent, isNull);
    });

    test('stored rubbish cannot crash the unit', () {
      expect(Holding.fromJson({'ticker': 123, 'qty': 'abc', 'cost': -5}), isNotNull);
      expect(Holding.fromJson({'ticker': 'AAA', 'qty': 'abc'})!.quantity, 0);
      expect(Holding.fromJson({'ticker': 'AAA', 'cost': -5})!.avgCostFils, 0);
      expect(Holding.fromJson('not a map'), isNull);
      expect(Holding.fromJson({'ticker': ''}), isNull);
    });
  });

  group('التوصيل — delivery', () {
    List<DeliveryOrder> sample() => [
          DeliveryOrder(id: 'ORD-0001', customer: 'أ', phone: '1', amountFils: 7500, status: OrderStatus.delivered),
          DeliveryOrder(id: 'ORD-0002', customer: 'ب', phone: '2', amountFils: 4000, status: OrderStatus.onWay),
          DeliveryOrder(id: 'ORD-0003', customer: 'ج', phone: '3', amountFils: 9000, status: OrderStatus.cancelled),
        ];

    test('revenue counts delivered orders only', () {
      expect(DeliveryTotals.of(sample()).revenueFils, 7500);
    });

    test('a cancelled order is neither in progress nor earning', () {
      final t = DeliveryTotals.of(sample());
      expect(t.total, 3);
      expect(t.inProgress, 1);
      expect(t.delivered, 1);
    });

    test('ids are sequential, zero-padded, and continue past a cancellation', () {
      expect(nextOrderId(sample()), 'ORD-0004');
      expect(nextOrderId([]), 'ORD-0001');
    });

    test('the pipeline advances in order and stops at delivered', () {
      expect(OrderStatus.fresh.next, OrderStatus.preparing);
      expect(OrderStatus.preparing.next, OrderStatus.onWay);
      expect(OrderStatus.onWay.next, OrderStatus.delivered);
      expect(OrderStatus.delivered.next, isNull);
      expect(OrderStatus.cancelled.next, isNull);
    });
  });

  group('XBRL — the annual filing', () {
    FilingInput base({
      int cash = 5000000,
      int receivables = 2000000,
      int inventory = 1000000,
      int ppe = 8000000,
      int investments = 0,
      int payables = 1500000,
      int shortBorrow = 500000,
      int longBorrow = 2000000,
      int eos = 300000,
      int capital = 10000000,
      int reserve = 0,
      int retained = 0,
      int revenue = 6000000,
      int cos = 3000000,
      int expenses = 1300000,
      int months = 12,
      EntityKind kind = EntityKind.wll,
      DateTime? end,
    }) =>
        FilingInput(
          entityName: 'شركة تجريبية',
          commercialRegistration: '123456',
          periodEnd: end ?? DateTime.utc(2026, 12, 31),
          months: months,
          kind: kind,
          cashFils: cash, receivablesFils: receivables, inventoryFils: inventory,
          ppeFils: ppe, investmentsFils: investments,
          payablesFils: payables, shortBorrowingsFils: shortBorrow,
          longBorrowingsFils: longBorrow, endOfServiceFils: eos,
          capitalFils: capital, statutoryReserveFils: reserve,
          retainedEarningsFils: retained,
          revenueFils: revenue, costOfSalesFils: cos, expensesFils: expenses,
        );

    test('every subtotal is computed, and matches the hand total', () {
      final f = Filing(base());
      expect(f.currentAssets, 8000000);
      expect(f.nonCurrentAssets, 8000000);
      expect(f.totalAssets, 16000000);
      expect(f.currentLiabilities, 2000000);
      expect(f.nonCurrentLiabilities, 2300000);
      expect(f.grossProfit, 3000000);
      expect(f.netIncome, 1700000);
      expect(f.retainedEarnings, 1700000);
      expect(f.equity, 11700000);
    });

    test('a hand-balanced sheet balances', () {
      // assets 16,000.000 = liabilities 4,300.000 + equity 11,700.000
      expect(Filing(base()).balances, isTrue);
      expect(Filing(base()).canFile, isTrue);
    });

    test('an unbalanced sheet is refused, with the difference stated', () {
      final f = Filing(base(cash: 5001000));
      expect(f.balances, isFalse);
      final errs = f.audit().where((x) => x.level == FindingLevel.error);
      expect(errs, isNotEmpty);
      expect(errs.first.amountFils, 1000);
      expect(f.canFile, isFalse);
    });

    test('zero capital and negative equity block filing', () {
      expect(Filing(base(capital: 0)).canFile, isFalse);
      expect(Filing(base(capital: 1000, retained: -50000000)).canFile, isFalse);
    });

    test('losses at half the capital raise the companies-law warning', () {
      final f = Filing(base(capital: 10000000, retained: -6700000));
      expect(
        f.audit().where((x) => x.level == FindingLevel.warning).map((x) => x.message),
        contains(contains('نصف رأس المال')),
      );
    });

    test('a quarter warns that the official filing is annual', () {
      final f = Filing(base(months: 3));
      expect(
        f.audit().where((x) => x.level == FindingLevel.warning).map((x) => x.message),
        contains(contains('سنوي')),
      );
    });

    test('the statutory reserve suggestion carries the worked-out amount', () {
      final s = Filing(base()).audit().firstWhere((x) => x.message.contains('الاحتياطي القانوني'));
      expect(s.level, FindingLevel.suggestion);
      expect(s.amountFils, 170000); // 10% of 1,700.000
    });

    test('a reserve already at half the capital stops the suggestion', () {
      final f = Filing(base(reserve: 5000000, payables: 1500000 + 5000000));
      expect(f.audit().any((x) => x.message.contains('الاحتياطي القانوني')), isFalse);
    });

    test('a closed shareholding company gets the zakat estimate', () {
      final f = Filing(base(kind: EntityKind.kscc));
      final z = f.audit().firstWhere((x) => x.message.contains('زكاة'));
      expect(z.amountFils, 17000); // 1% of 1,700.000
    });

    test('a listed company gets labour support and KFAS', () {
      final a = Filing(base(kind: EntityKind.listed)).audit();
      expect(a.firstWhere((x) => x.message.contains('دعم العمالة')).amountFils, 42500);
      // Matched on «مؤسسة الكويت», not «التقدم العلمي»: the message reads
      // «للتقدم العلمي», where the definite article assimilates into the لـ
      // prefix, so the searched form never appears in the string at all.
      expect(a.firstWhere((x) => x.message.contains('مؤسسة الكويت')).amountFils, 17000);
    });

    test('the period starts the day after the prior year end, in UTC', () {
      expect(Filing(base()).periodStart, DateTime.utc(2026, 1, 1));
    });

    test('a quarter ending 31 May starts 1 March — no month overflow', () {
      final f = Filing(base(months: 3, end: DateTime.utc(2026, 5, 31)));
      expect(f.periodStart, DateTime.utc(2026, 3, 1));
    });

    test('the instance is well-formed and states KWD', () {
      final xml = Filing(base()).toInstance();
      expect(xml, contains('<measure>iso4217:KWD</measure>'));
      expect(xml, contains('scheme="http://www.moci.gov.kw">123456<'));
      expect(xml, contains('>16000.000</ifrs-full:Assets>'));
      expect(xml, contains('>16000.000</ifrs-full:EquityAndLiabilities>'));
      expect(xml, contains('>1700.000</ifrs-full:ProfitLoss>'));
    });

    test('a hostile entity name cannot break the document', () {
      final f = Filing(FilingInput(
        entityName: 'شركة <script>&"\'',
        commercialRegistration: '<bad>&',
        periodEnd: DateTime.utc(2026, 12, 31),
      ));
      final xml = f.toInstance();
      expect(xml, isNot(contains('<script>')));
      expect(xml, contains('&lt;script&gt;'));
      expect(xml, contains('&lt;bad&gt;&amp;'));
    });
  });

  group('the units are linked, not merely co-located', () {
    test('portfolio value feeds investments; delivered orders feed revenue', () {
      final position = UnifiedPosition(
        portfolio: PortfolioTotals.of([
          Holding(ticker: 'NBK', name: '', quantity: 1000, avgCostFils: 900, priceFils: 1752),
        ]),
        delivery: DeliveryTotals.of([
          DeliveryOrder(id: 'ORD-0001', customer: '', phone: '', amountFils: 7500, status: OrderStatus.delivered),
          DeliveryOrder(id: 'ORD-0002', customer: '', phone: '', amountFils: 4000, status: OrderStatus.onWay),
        ]),
      );
      expect(position.totalResourcesFils, 1752000 + 7500);

      final derived = Filing(Filing(FilingInput(
        entityName: 'x',
        commercialRegistration: '1',
        periodEnd: DateTime.utc(2026, 12, 31),
      )).derivedFrom(position));

      expect(derived.input.investmentsFils, 1752000);
      expect(derived.input.revenueFils, 7500);
      // and the derivation must roll all the way up
      expect(derived.nonCurrentAssets, 1752000);
      expect(derived.netIncome, 7500);
    });
  });
}
