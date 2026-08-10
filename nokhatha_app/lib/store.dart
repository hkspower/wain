/// The one place records live, and the only place the four units read from.
///
/// Persistence is deliberately not wired to a package yet: the web build keeps
/// everything in the visitor's own browser and says so on screen, and the app
/// will need the same honesty about where data sits before it claims to store
/// anything. Until that decision is made, this holds the working set in memory
/// and seeds it with the same figures the tests assert, so every screen shows
/// real arithmetic rather than lorem ipsum.
library;

import 'package:flutter/foundation.dart';

import 'core/models.dart';
import 'core/xbrl.dart';

class Store extends ChangeNotifier {
  final List<Holding> _holdings = [];
  final List<DeliveryOrder> _orders = [];
  FilingInput _filingInput = FilingInput(
    entityName: 'شركة تجريبية',
    commercialRegistration: '123456',
    periodEnd: DateTime.utc(2026, 12, 31),
    cashFils: 5000000,
    receivablesFils: 2000000,
    inventoryFils: 1000000,
    ppeFils: 8000000,
    payablesFils: 1500000,
    shortBorrowingsFils: 500000,
    longBorrowingsFils: 2000000,
    endOfServiceFils: 300000,
    capitalFils: 10000000,
    costOfSalesFils: 3000000,
    expensesFils: 1300000,
  );

  List<Holding> get holdings => List.unmodifiable(_holdings);
  List<DeliveryOrder> get orders => List.unmodifiable(_orders);

  PortfolioTotals get portfolio => PortfolioTotals.of(_holdings);
  DeliveryTotals get delivery => DeliveryTotals.of(_orders);
  UnifiedPosition get position =>
      UnifiedPosition(portfolio: portfolio, delivery: delivery);

  /// The filing always reads the derived figures, so صافي and التوصيل reach
  /// the balance sheet without anyone retyping them.
  Filing get filing => Filing(Filing(_filingInput).derivedFrom(position));

  void load() {
    if (_holdings.isNotEmpty) return;
    _holdings.addAll([
      Holding(ticker: 'NBK', name: 'بنك الكويت الوطني', quantity: 1000, avgCostFils: 900, priceFils: 1752),
      Holding(ticker: 'ZAIN', name: 'زين', quantity: 500, avgCostFils: 600, priceFils: 362),
      Holding(ticker: 'KFH', name: 'بيت التمويل', quantity: 800, avgCostFils: 700, priceFils: 1297),
    ]);
    _orders.addAll([
      DeliveryOrder(id: 'ORD-0001', customer: 'أحمد', phone: '65894110', amountFils: 7500, status: OrderStatus.delivered),
      DeliveryOrder(id: 'ORD-0002', customer: 'سارة', phone: '65894111', amountFils: 4000, status: OrderStatus.onWay),
      DeliveryOrder(id: 'ORD-0003', customer: 'خالد', phone: '65894112', amountFils: 12250, status: OrderStatus.preparing),
    ]);
    notifyListeners();
  }

  void addHolding(Holding h) {
    // Re-adding a ticker updates it in place rather than creating a second row
    // for the same company — the web build learned this from a duplicated NBK.
    final i = _holdings.indexWhere((x) => x.ticker == h.ticker);
    if (i >= 0) {
      _holdings[i] = h;
    } else {
      _holdings.add(h);
    }
    notifyListeners();
  }

  void addOrder({required String customer, required String phone, required int amountFils}) {
    _orders.add(DeliveryOrder(
      id: nextOrderId(_orders),
      customer: customer,
      phone: phone,
      amountFils: amountFils,
    ));
    notifyListeners();
  }

  void advance(String id) {
    final i = _orders.indexWhere((o) => o.id == id);
    if (i < 0) return;
    final next = _orders[i].status.next;
    if (next == null) return;
    _orders[i] = _orders[i].copyWith(status: next);
    notifyListeners();
  }

  void cancel(String id) {
    final i = _orders.indexWhere((o) => o.id == id);
    if (i < 0) return;
    _orders[i] = _orders[i].copyWith(status: OrderStatus.cancelled);
    notifyListeners();
  }

  void updateFiling(FilingInput input) {
    _filingInput = input;
    notifyListeners();
  }
}
