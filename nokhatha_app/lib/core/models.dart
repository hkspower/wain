/// النوخذة's data core — the one set of records all four units read from.
///
/// The web build's whole point is that the units are linked, not merely
/// co-located: صافي's market value feeds the XBRL investments line, and
/// التوصيل's delivered orders feed XBRL revenue. That linkage lives here, so
/// it cannot drift between screens.
library;


/// A holding in صافي. Costs and prices are fils per share.
class Holding {
  Holding({
    required this.ticker,
    required this.name,
    required this.quantity,
    required this.avgCostFils,
    required this.priceFils,
  });

  final String ticker;
  final String name;
  final int quantity;
  final int avgCostFils;
  final int priceFils;

  int get costFils => quantity * avgCostFils;
  int get marketValueFils => quantity * priceFils;
  int get profitFils => marketValueFils - costFils;

  /// Profit as a percentage of cost. Null when cost is zero — a percentage of
  /// nothing is not 0%, it is undefined, and printing 0% there is a lie the
  /// user cannot detect.
  double? get profitPercent =>
      costFils == 0 ? null : (profitFils / costFils) * 100;

  Map<String, dynamic> toJson() => {
        'ticker': ticker,
        'name': name,
        'qty': quantity,
        'cost': avgCostFils,
        'price': priceFils,
      };

  /// Read a stored holding. Every field is re-coerced and clamped: stored data
  /// is untrusted input, and the web build crashed once on a value it had
  /// written itself in an older version.
  static Holding? fromJson(Object? raw) {
    if (raw is! Map) return null;
    final ticker = _str(raw['ticker']).toUpperCase();
    if (ticker.isEmpty) return null;
    return Holding(
      ticker: ticker.length > 12 ? ticker.substring(0, 12) : ticker,
      name: _str(raw['name']),
      quantity: _int(raw['qty']).clamp(0, 1000000000),
      avgCostFils: _int(raw['cost']).clamp(0, 1000000000),
      priceFils: _int(raw['price']).clamp(0, 1000000000),
    );
  }
}

enum OrderStatus { fresh, preparing, onWay, delivered, cancelled }

extension OrderStatusLabel on OrderStatus {
  String get arabic => switch (this) {
        OrderStatus.fresh => 'جديد',
        OrderStatus.preparing => 'قيد التحضير',
        OrderStatus.onWay => 'في الطريق',
        OrderStatus.delivered => 'تم التسليم',
        OrderStatus.cancelled => 'ملغي',
      };

  String get id => name;

  /// The next step in the pipeline, or null at the end of it. Cancelled orders
  /// do not advance.
  OrderStatus? get next => switch (this) {
        OrderStatus.fresh => OrderStatus.preparing,
        OrderStatus.preparing => OrderStatus.onWay,
        OrderStatus.onWay => OrderStatus.delivered,
        _ => null,
      };
}

class DeliveryOrder {
  DeliveryOrder({
    required this.id,
    required this.customer,
    required this.phone,
    required this.amountFils,
    this.courier = '',
    this.status = OrderStatus.fresh,
  });

  final String id;
  final String customer;
  final String phone;
  final int amountFils;
  final String courier;
  final OrderStatus status;

  DeliveryOrder copyWith({OrderStatus? status, String? courier}) =>
      DeliveryOrder(
        id: id,
        customer: customer,
        phone: phone,
        amountFils: amountFils,
        courier: courier ?? this.courier,
        status: status ?? this.status,
      );

  Map<String, dynamic> toJson() => {
        'id': id,
        'customer': customer,
        'phone': phone,
        'amount': amountFils,
        'courier': courier,
        'status': status.id,
      };

  static DeliveryOrder? fromJson(Object? raw) {
    if (raw is! Map) return null;
    final id = _str(raw['id']);
    if (id.isEmpty) return null;
    final s = _str(raw['status']);
    return DeliveryOrder(
      id: id,
      customer: _str(raw['customer']),
      phone: _str(raw['phone']),
      amountFils: _int(raw['amount']).clamp(0, 1000000000),
      courier: _str(raw['courier']),
      status: OrderStatus.values.firstWhere(
        (v) => v.id == s,
        orElse: () => OrderStatus.fresh,
      ),
    );
  }
}

/// The whole portfolio, derived — never stored, so it cannot go stale.
class PortfolioTotals {
  const PortfolioTotals({
    required this.costFils,
    required this.marketValueFils,
  });

  final int costFils;
  final int marketValueFils;

  int get profitFils => marketValueFils - costFils;
  double? get profitPercent =>
      costFils == 0 ? null : (profitFils / costFils) * 100;

  static PortfolioTotals of(Iterable<Holding> holdings) {
    var cost = 0, value = 0;
    for (final h in holdings) {
      cost += h.costFils;
      value += h.marketValueFils;
    }
    return PortfolioTotals(costFils: cost, marketValueFils: value);
  }
}

/// التوصيل's figures. Revenue counts delivered orders only — an order that is
/// merely on its way has not earned anything, and a cancelled one never will.
class DeliveryTotals {
  const DeliveryTotals({
    required this.total,
    required this.inProgress,
    required this.delivered,
    required this.revenueFils,
  });

  final int total;
  final int inProgress;
  final int delivered;
  final int revenueFils;

  static DeliveryTotals of(Iterable<DeliveryOrder> orders) {
    var total = 0, inProgress = 0, delivered = 0, revenue = 0;
    for (final o in orders) {
      total++;
      switch (o.status) {
        case OrderStatus.delivered:
          delivered++;
          revenue += o.amountFils;
        case OrderStatus.cancelled:
          break; // neither in progress nor earning
        default:
          inProgress++;
      }
    }
    return DeliveryTotals(
      total: total,
      inProgress: inProgress,
      delivered: delivered,
      revenueFils: revenue,
    );
  }
}

/// The المركز المالي view: the two units seen together, plus what they add up
/// to. This is the number the web build states on screen so the linkage is
/// visible rather than implied.
class UnifiedPosition {
  const UnifiedPosition({required this.portfolio, required this.delivery});

  final PortfolioTotals portfolio;
  final DeliveryTotals delivery;

  int get totalResourcesFils =>
      portfolio.marketValueFils + delivery.revenueFils;
}

/// Sequential order ids: ORD-0001, ORD-0002 … Continues past cancellations,
/// because reusing a cancelled order's number makes two different orders share
/// an identity in whatever the customer wrote down.
String nextOrderId(Iterable<DeliveryOrder> existing) {
  var max = 0;
  for (final o in existing) {
    final m = RegExp(r'^ORD-(\d+)$').firstMatch(o.id);
    if (m != null) {
      final n = int.tryParse(m.group(1)!) ?? 0;
      if (n > max) max = n;
    }
  }
  return 'ORD-${(max + 1).toString().padLeft(4, '0')}';
}

String _str(Object? v) => v is String ? v : (v?.toString() ?? '');

int _int(Object? v) {
  if (v is int) return v;
  if (v is double) return v.isFinite ? v.round() : 0;
  if (v is String) return int.tryParse(v) ?? double.tryParse(v)?.round() ?? 0;
  return 0;
}
