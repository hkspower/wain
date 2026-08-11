/// The one place records live, and the only place the four units read from.
///
/// Everything is persisted to a single readable JSON file (see vault.dart) and
/// written back on every change, so closing the window is not a way to lose an
/// afternoon's work.
library;

import 'package:flutter/foundation.dart';

import 'core/auth.dart';
import 'core/models.dart';
import 'core/vault.dart';
import 'core/xbrl.dart';

class Store extends ChangeNotifier {
  Store({VaultStore? vault}) : _vault = vault ?? Vault();

  final VaultStore _vault;

  final Map<String, Account> _accounts = {};
  final Map<String, LockoutState> _locks = {};
  Session? _session;

  final List<Holding> _holdings = [];
  final List<DeliveryOrder> _orders = [];
  FilingInput _filingInput = _seedFiling;

  bool _ready = false;
  String _vaultPath = '';

  bool get ready => _ready;
  String get vaultPath => _vaultPath;

  Account? get currentUser {
    final s = _session;
    if (s == null || !s.valid(DateTime.now())) return null;
    return _accounts[s.email];
  }

  bool get signedIn => currentUser != null;

  List<Holding> get holdings => List.unmodifiable(_holdings);
  List<DeliveryOrder> get orders => List.unmodifiable(_orders);

  PortfolioTotals get portfolio => PortfolioTotals.of(_holdings);
  DeliveryTotals get delivery => DeliveryTotals.of(_orders);
  UnifiedPosition get position =>
      UnifiedPosition(portfolio: portfolio, delivery: delivery);

  FilingInput get filingInput => _filingInput;

  /// The filing always reads the derived figures, so صافي and التوصيل reach
  /// the balance sheet without anyone retyping them.
  Filing get filing => Filing(Filing(_filingInput).derivedFrom(position));

  // ── lifecycle ────────────────────────────────────────────────────────────

  Future<void> load() async {
    final data = await _vault.read();
    _vaultPath = await _vault.location();

    for (final raw in (data['accounts'] as List? ?? const [])) {
      final a = Account.fromJson(raw);
      if (a != null) _accounts[a.email] = a;
    }
    for (final e in (data['locks'] as Map? ?? const {}).entries) {
      _locks[e.key.toString()] = LockoutState.fromJson(e.value);
    }
    _session = Session.fromJson(data['session']);
    for (final raw in (data['holdings'] as List? ?? const [])) {
      final h = Holding.fromJson(raw);
      if (h != null) _holdings.add(h);
    }
    for (final raw in (data['orders'] as List? ?? const [])) {
      final o = DeliveryOrder.fromJson(raw);
      if (o != null) _orders.add(o);
    }
    final f = data['filing'];
    if (f is Map) _filingInput = _filingFromJson(f);

    _ready = true;
    notifyListeners();
  }

  Future<void> _save() async {
    await _vault.write({
      'accounts': _accounts.values.map((a) => a.toJson()).toList(),
      'locks': _locks.map((k, v) => MapEntry(k, v.toJson())),
      if (_session != null) 'session': _session!.toJson(),
      'holdings': _holdings.map((h) => h.toJson()).toList(),
      'orders': _orders.map((o) => o.toJson()).toList(),
      'filing': _filingToJson(_filingInput),
    });
  }

  Future<void> _commit() async {
    notifyListeners();
    await _save();
  }

  // ── accounts ─────────────────────────────────────────────────────────────

  /// Returns null on success, or the reason it failed — the screen shows the
  /// true cause rather than one vague message for every case.
  Future<String?> register({
    required String name,
    required String email,
    required String password,
  }) async {
    final e = emailProblem(email);
    if (e != null) return e;
    final p = passwordProblem(password);
    if (p != null) return p;
    final key = email.trim().toLowerCase();
    if (_accounts.containsKey(key)) return 'هذا البريد مسجَّل بالفعل.';
    if (name.trim().isEmpty) return 'الاسم مطلوب.';

    final account =
        Account.create(name: name.trim(), email: key, password: password);
    _accounts[key] = account;
    _session = Session(key, DateTime.now().add(kSessionTtl));
    await _commit();
    return null;
  }

  Future<SignInResult> signIn({
    required String email,
    required String password,
  }) async {
    final key = email.trim().toLowerCase();
    final now = DateTime.now();
    final lock = _locks[key] ?? LockoutState();

    if (lock.isLocked(now)) return SignInResult.lockedOut;

    final account = _accounts[key];
    if (account == null) {
      // Still count it: otherwise the lockout can be side-stepped by guessing
      // addresses, and the timing difference alone tells an attacker which
      // addresses are real.
      lock.failures++;
      _locks[key] = lock;
      await _commit();
      return SignInResult.noSuchAccount;
    }
    if (account.suspended) return SignInResult.suspended;

    if (!account.verify(password)) {
      lock.failures++;
      if (lock.failures >= kMaxAttempts) lock.until = now.add(kLockout);
      _locks[key] = lock;
      await _commit();
      return SignInResult.wrongPassword;
    }

    _locks.remove(key);
    _session = Session(key, now.add(kSessionTtl));
    await _commit();
    return SignInResult.ok;
  }

  Future<void> signOut() async {
    _session = null;
    await _commit();
  }

  /// How many tries are left before the lock, so the screen can warn before
  /// it happens rather than after.
  int attemptsLeft(String email) {
    final l = _locks[email.trim().toLowerCase()];
    return kMaxAttempts - (l?.failures ?? 0);
  }

  Duration? lockedFor(String email) {
    final l = _locks[email.trim().toLowerCase()];
    if (l?.until == null) return null;
    final left = l!.until!.difference(DateTime.now());
    return left.isNegative ? null : left;
  }

  // ── records ──────────────────────────────────────────────────────────────

  Future<void> addHolding(Holding h) async {
    // Re-adding a ticker updates it in place rather than creating a second row
    // for the same company.
    final i = _holdings.indexWhere((x) => x.ticker == h.ticker);
    if (i >= 0) {
      _holdings[i] = h;
    } else {
      _holdings.add(h);
    }
    await _commit();
  }

  Future<void> removeHolding(String ticker) async {
    _holdings.removeWhere((h) => h.ticker == ticker);
    await _commit();
  }

  Future<void> addOrder({
    required String customer,
    required String phone,
    required int amountFils,
  }) async {
    _orders.add(DeliveryOrder(
      id: nextOrderId(_orders),
      customer: customer,
      phone: phone,
      amountFils: amountFils,
    ));
    await _commit();
  }

  Future<void> advance(String id) async {
    final i = _orders.indexWhere((o) => o.id == id);
    if (i < 0) return;
    final next = _orders[i].status.next;
    if (next == null) return;
    _orders[i] = _orders[i].copyWith(status: next);
    await _commit();
  }

  Future<void> cancel(String id) async {
    final i = _orders.indexWhere((o) => o.id == id);
    if (i < 0) return;
    _orders[i] = _orders[i].copyWith(status: OrderStatus.cancelled);
    await _commit();
  }

  Future<void> updateFiling(FilingInput input) async {
    _filingInput = input;
    await _commit();
  }
}

// ── filing (de)serialisation ───────────────────────────────────────────────

const _seedFiling = FilingInput(
  entityName: '',
  commercialRegistration: '',
  periodEnd: null,
);

Map<String, dynamic> _filingToJson(FilingInput f) => {
      'entity': f.entityName,
      'cr': f.commercialRegistration,
      'end': f.periodEnd.toIso8601String(),
      'months': f.months,
      'kind': f.kind.name,
      'cash': f.cashFils,
      'receivables': f.receivablesFils,
      'inventory': f.inventoryFils,
      'ppe': f.ppeFils,
      'payables': f.payablesFils,
      'shortBorrowings': f.shortBorrowingsFils,
      'longBorrowings': f.longBorrowingsFils,
      'endOfService': f.endOfServiceFils,
      'capital': f.capitalFils,
      'reserve': f.statutoryReserveFils,
      'retained': f.retainedEarningsFils,
      'costOfSales': f.costOfSalesFils,
      'expenses': f.expensesFils,
    };

FilingInput _filingFromJson(Map raw) {
  int n(String k) => raw[k] is int ? raw[k] as int : 0;
  return FilingInput(
    entityName: (raw['entity'] ?? '').toString(),
    commercialRegistration: (raw['cr'] ?? '').toString(),
    periodEnd: DateTime.tryParse((raw['end'] ?? '').toString()),
    months: raw['months'] is int ? raw['months'] as int : 12,
    kind: EntityKind.values.firstWhere(
      (k) => k.name == (raw['kind'] ?? '').toString(),
      orElse: () => EntityKind.wll,
    ),
    cashFils: n('cash'),
    receivablesFils: n('receivables'),
    inventoryFils: n('inventory'),
    ppeFils: n('ppe'),
    payablesFils: n('payables'),
    shortBorrowingsFils: n('shortBorrowings'),
    longBorrowingsFils: n('longBorrowings'),
    endOfServiceFils: n('endOfService'),
    capitalFils: n('capital'),
    statutoryReserveFils: n('reserve'),
    retainedEarningsFils: n('retained'),
    costOfSalesFils: n('costOfSales'),
    expensesFils: n('expenses'),
  );
}
