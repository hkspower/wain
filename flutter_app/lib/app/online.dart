/// Whether the phone has any network at all. Everything that needs one — the
/// call, the typed chat, the map's tiles — says so at once instead of waiting
/// out its own timeout: before this a visitor with no signal watched «يرن…»
/// for twenty seconds, or «نوصّل سالم…» for twelve, before learning anything.
///
/// It is the interface's view (`connectivity_plus`): «no network», not «no
/// internet». A Wi-Fi with no way out still reads as online, and for that the
/// existing timeouts remain the answer. The places, search and Explore are
/// bundled and never needed a network.
library;

import 'dart:async';

import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:flutter/foundation.dart';

class Online extends ChangeNotifier {
  bool _offline;
  StreamSubscription<List<ConnectivityResult>>? _sub;

  Online._(this._offline);

  /// Fixed, for tests and for platforms without the plugin.
  factory Online.fixed({bool offline = false}) => Online._(offline);

  /// The phone's own reading, kept current.
  factory Online.platform() {
    final o = Online._(false);
    try {
      final c = Connectivity();
      c.checkConnectivity().then(o._read, onError: (_) {});
      o._sub = c.onConnectivityChanged.listen(o._read, onError: (_) {});
    } catch (_) {
      /* no plugin (web, tests): assume online, as before */
    }
    return o;
  }

  bool get offline => _offline;

  void _read(List<ConnectivityResult> r) =>
      set(offline: r.isEmpty || r.every((x) => x == ConnectivityResult.none));

  @visibleForTesting
  void set({required bool offline}) {
    if (offline == _offline) return;
    _offline = offline;
    notifyListeners();
  }

  @override
  void dispose() {
    _sub?.cancel();
    super.dispose();
  }
}
