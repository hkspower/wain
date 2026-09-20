/// XBRL — the Kuwaiti annual filing.
///
/// Ported from the web build with its rules intact, because they are the rules
/// that make the file acceptable rather than merely well-formed:
///
///  * every subtotal is COMPUTED from line items, never typed;
///  * the audit separates errors that block filing from companies-law warnings
///    and from suggestions that carry the amount already worked out;
///  * the entity is identified by its commercial-registration number;
///  * the period is computed in UTC and anchored to the first of the opening
///    month — local-midnight parsing shifts the date east of Greenwich, and
///    subtracting months from a 31st overflows into the wrong month.
///
/// Final submission goes through the Ministry of Commerce and Industry's own
/// portal. The file this produces is the filing's content, not its lodgement.
library;

import 'models.dart';
import 'money.dart';

enum EntityKind {
  /// شركة ذات مسؤولية محدودة
  wll,

  /// شركة مساهمة مقفلة — pays zakat at 1%
  kscc,

  /// شركة مساهمة عامة (مدرجة) — labour support 2.5% + KFAS 1%
  listed,
}

enum FindingLevel { error, warning, suggestion }

class Finding {
  const Finding(this.level, this.message, {this.amountFils});
  final FindingLevel level;
  final String message;
  final int? amountFils;
}

/// The line items a filer types. Everything else is derived.
class FilingInput {
  const FilingInput({
    required this.entityName,
    required this.commercialRegistration,
    DateTime? periodEnd,
    this.months = 12,
    this.kind = EntityKind.wll,
    this.cashFils = 0,
    this.receivablesFils = 0,
    this.inventoryFils = 0,
    this.ppeFils = 0,
    this.investmentsFils = 0,
    this.payablesFils = 0,
    this.shortBorrowingsFils = 0,
    this.longBorrowingsFils = 0,
    this.endOfServiceFils = 0,
    this.capitalFils = 0,
    this.statutoryReserveFils = 0,
    this.retainedEarningsFils = 0,
    this.revenueFils = 0,
    this.costOfSalesFils = 0,
    this.expensesFils = 0,
  }) : periodEndOrNull = periodEnd;

  final String entityName;
  final String commercialRegistration;
  /// The period's closing date. Null until the filer sets it — a filing
  /// dated by default is a filing dated wrongly, and today's date is not a
  /// financial year end.
  final DateTime? periodEndOrNull;
  DateTime get periodEnd => periodEndOrNull ?? DateTime.utc(DateTime.now().year, 12, 31);
  bool get hasPeriodEnd => periodEndOrNull != null;
  final int months;
  final EntityKind kind;

  final int cashFils, receivablesFils, inventoryFils;
  final int ppeFils, investmentsFils;
  final int payablesFils, shortBorrowingsFils;
  final int longBorrowingsFils, endOfServiceFils;
  final int capitalFils, statutoryReserveFils, retainedEarningsFils;
  final int revenueFils, costOfSalesFils, expensesFils;
}

/// Every subtotal, computed. Nothing here is typed by a human.
class Filing {
  Filing(this.input);

  final FilingInput input;

  int get currentAssets =>
      input.cashFils + input.receivablesFils + input.inventoryFils;

  /// Investments roll into non-current assets — this is the line صافي feeds.
  int get nonCurrentAssets => input.ppeFils + input.investmentsFils;

  int get totalAssets => currentAssets + nonCurrentAssets;

  int get currentLiabilities => input.payablesFils + input.shortBorrowingsFils;

  int get nonCurrentLiabilities =>
      input.longBorrowingsFils + input.endOfServiceFils;

  int get totalLiabilities => currentLiabilities + nonCurrentLiabilities;

  int get grossProfit => input.revenueFils - input.costOfSalesFils;

  int get netIncome => grossProfit - input.expensesFils;

  /// Retained earnings carry the year's result in — the opening balance plus
  /// what the year made or lost.
  int get retainedEarnings => input.retainedEarningsFils + netIncome;

  int get equity =>
      input.capitalFils + input.statutoryReserveFils + retainedEarnings;

  /// The sheet balances when assets equal what is owed plus what is owned.
  int get imbalance => totalAssets - (totalLiabilities + equity);

  bool get balances => imbalance == 0;

  /// The opening day of the period, in UTC, anchored to the first of the month.
  DateTime get periodStart {
    final end = DateTime.utc(
        input.periodEnd.year, input.periodEnd.month, input.periodEnd.day);
    // Move back `months - 1` whole months from the end month, then take day 1.
    var year = end.year;
    var month = end.month - (input.months - 1);
    while (month <= 0) {
      month += 12;
      year -= 1;
    }
    return DateTime.utc(year, month, 1);
  }

  /// Everything the filer needs to know before lodging, sorted by whether it
  /// blocks the filing, warns under the companies law, or merely suggests.
  List<Finding> audit() {
    final out = <Finding>[];

    if (!balances) {
      out.add(Finding(
        FindingLevel.error,
        'الميزانية غير متوازنة — الفرق ${formatKwd(imbalance.abs())} د.ك',
        amountFils: imbalance,
      ));
      out.add(const Finding(
        FindingLevel.suggestion,
        'راجع بنود الأصول والالتزامات: الفرق يساوي تماماً ما يجب تعديله في أحد الطرفين.',
      ));
    }
    if (input.capitalFils <= 0) {
      out.add(const Finding(FindingLevel.error, 'رأس المال صفر — لا يمكن الإيداع.'));
    }
    if (equity < 0) {
      out.add(Finding(FindingLevel.error,
          'حقوق الملكية سالبة (${formatKwd(equity)} د.ك).',
          amountFils: equity));
    }

    // Companies law: accumulated losses at half the capital must be addressed.
    if (input.capitalFils > 0 && retainedEarnings < 0 &&
        retainedEarnings.abs() * 2 >= input.capitalFils) {
      out.add(Finding(
        FindingLevel.warning,
        'الخسائر المتراكمة بلغت نصف رأس المال أو أكثر — يستوجب إجراءً وفق قانون الشركات.',
        amountFils: retainedEarnings,
      ));
    }
    if (input.months != 12) {
      out.add(const Finding(FindingLevel.warning,
          'الفترة ليست سنة كاملة — الإيداع الرسمي سنوي.'));
    }
    if (grossProfit < 0) {
      out.add(Finding(FindingLevel.warning,
          'خسارة إجمالية: تكلفة المبيعات تتجاوز الإيرادات.',
          amountFils: grossProfit));
    }
    if (currentLiabilities > currentAssets) {
      out.add(const Finding(FindingLevel.warning,
          'الالتزامات المتداولة تتجاوز الأصول المتداولة — مؤشر سيولة.'));
    }

    // Suggestions carry the amount already worked out, so the filer is not
    // left to compute the thing we are asking them to post.
    final reserveCap = input.capitalFils ~/ 2;
    if (netIncome > 0 && input.statutoryReserveFils < reserveCap) {
      final ten = netIncome ~/ 10;
      final room = reserveCap - input.statutoryReserveFils;
      final transfer = ten < room ? ten : room;
      if (transfer > 0) {
        out.add(Finding(
          FindingLevel.suggestion,
          'تحويل 10% من صافي الربح إلى الاحتياطي القانوني',
          amountFils: transfer,
        ));
      }
    }
    if (input.endOfServiceFils == 0) {
      out.add(const Finding(FindingLevel.suggestion,
          'لا يوجد مخصص لمكافأة نهاية الخدمة — تحقق من التزامك.'));
    }
    if (netIncome > 0 && input.kind == EntityKind.kscc) {
      out.add(Finding(FindingLevel.suggestion, 'زكاة الشركات 1% من صافي الربح',
          amountFils: netIncome ~/ 100));
    }
    if (netIncome > 0 && input.kind == EntityKind.listed) {
      out.add(Finding(FindingLevel.suggestion,
          'ضريبة دعم العمالة الوطنية 2.5% من صافي الربح',
          amountFils: (netIncome * 25) ~/ 1000));
      out.add(Finding(FindingLevel.suggestion, 'حصة مؤسسة الكويت للتقدم العلمي 1%',
          amountFils: netIncome ~/ 100));
    }
    return out;
  }

  bool get canFile =>
      !audit().any((f) => f.level == FindingLevel.error);

  /// Pull صافي and التوصيل in, exactly as the web build's ⟳ احسب من النظام does.
  FilingInput derivedFrom(UnifiedPosition position) => FilingInput(
        entityName: input.entityName,
        commercialRegistration: input.commercialRegistration,
        periodEnd: input.periodEndOrNull,
        months: input.months,
        kind: input.kind,
        cashFils: input.cashFils,
        receivablesFils: input.receivablesFils,
        inventoryFils: input.inventoryFils,
        ppeFils: input.ppeFils,
        investmentsFils: position.portfolio.marketValueFils,
        payablesFils: input.payablesFils,
        shortBorrowingsFils: input.shortBorrowingsFils,
        longBorrowingsFils: input.longBorrowingsFils,
        endOfServiceFils: input.endOfServiceFils,
        capitalFils: input.capitalFils,
        statutoryReserveFils: input.statutoryReserveFils,
        retainedEarningsFils: input.retainedEarningsFils,
        revenueFils: position.delivery.revenueFils,
        costOfSalesFils: input.costOfSalesFils,
        expensesFils: input.expensesFils,
      );

  /// An IFRS-tagged XBRL instance. Amounts are stated in whole KWD as the
  /// framework expects, and every string is XML-escaped — an entity name with
  /// an ampersand in it must not be able to break the document.
  String toInstance() {
    String esc(String s) => s
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&apos;');
    String d(DateTime x) => '${x.year.toString().padLeft(4, '0')}-'
        '${x.month.toString().padLeft(2, '0')}-'
        '${x.day.toString().padLeft(2, '0')}';
    String kwd(int fils) => (fils / filsPerKwd).toStringAsFixed(3);

    final cr = esc(input.commercialRegistration);
    final start = d(periodStart);
    final end = d(input.periodEnd);

    String fact(String tag, String ctx, int fils) =>
        '  <ifrs-full:$tag contextRef="$ctx" unitRef="KWD" decimals="3">'
        '${kwd(fils)}</ifrs-full:$tag>';

    return '''
<?xml version="1.0" encoding="UTF-8"?>
<xbrl xmlns="http://www.xbrl.org/2003/instance"
      xmlns:ifrs-full="https://xbrl.ifrs.org/taxonomy/2024-03-27/ifrs-full"
      xmlns:iso4217="http://www.xbrl.org/2003/iso4217"
      xmlns:xbrli="http://www.xbrl.org/2003/instance">
  <context id="AsOf">
    <entity><identifier scheme="http://www.moci.gov.kw">$cr</identifier></entity>
    <period><instant>$end</instant></period>
  </context>
  <context id="Duration">
    <entity><identifier scheme="http://www.moci.gov.kw">$cr</identifier></entity>
    <period><startDate>$start</startDate><endDate>$end</endDate></period>
  </context>
  <unit id="KWD"><measure>iso4217:KWD</measure></unit>
  <!-- ${esc(input.entityName)} -->
${fact('CashAndCashEquivalents', 'AsOf', input.cashFils)}
${fact('TradeAndOtherCurrentReceivables', 'AsOf', input.receivablesFils)}
${fact('Inventories', 'AsOf', input.inventoryFils)}
${fact('CurrentAssets', 'AsOf', currentAssets)}
${fact('PropertyPlantAndEquipment', 'AsOf', input.ppeFils)}
${fact('NoncurrentFinancialAssets', 'AsOf', input.investmentsFils)}
${fact('NoncurrentAssets', 'AsOf', nonCurrentAssets)}
${fact('Assets', 'AsOf', totalAssets)}
${fact('CurrentLiabilities', 'AsOf', currentLiabilities)}
${fact('NoncurrentLiabilities', 'AsOf', nonCurrentLiabilities)}
${fact('Liabilities', 'AsOf', totalLiabilities)}
${fact('IssuedCapital', 'AsOf', input.capitalFils)}
${fact('StatutoryReserve', 'AsOf', input.statutoryReserveFils)}
${fact('RetainedEarnings', 'AsOf', retainedEarnings)}
${fact('Equity', 'AsOf', equity)}
${fact('EquityAndLiabilities', 'AsOf', totalLiabilities + equity)}
${fact('Revenue', 'Duration', input.revenueFils)}
${fact('CostOfSales', 'Duration', input.costOfSalesFils)}
${fact('GrossProfit', 'Duration', grossProfit)}
${fact('ProfitLoss', 'Duration', netIncome)}
</xbrl>
''';
  }
}
