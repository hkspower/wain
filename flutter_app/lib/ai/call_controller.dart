/// شوق's phone call. Owns the session, the honest phase the sheet shows, the
/// client tools she drives the app with, and the mid-call voice swap.
///
/// Phases are named for what is TRUE, not what is hoped:
///   idle      no call
///   ringing   dialling — the socket is not up yet, and the sheet says so
///   live      connected and listening (the native SDK has no separate "press
///             start" gate, so «متصل» here means the session really opened)
///   answering she is speaking
///   ended     hung up — or dropped
///   failed    it never connected (mic denied, refused, timed out)
library;

import 'dart:async';

import 'package:flutter/foundation.dart';

import '../data/models.dart';
import '../data/search.dart';
import 'config.dart';
import 'tools.dart';

enum CallPhase { idle, ringing, live, answering, ended, failed }

typedef ToolHandler = Future<String> Function(Map<String, dynamic> params);

/// The session, behind an interface so the controller is testable without a
/// microphone, LiveKit or a network.
abstract class AgentSession {
  /// Wire the events before [start].
  void listen({
    required void Function() onConnected,
    required void Function(bool speaking) onSpeaking,
    required void Function() onDisconnected,
    required void Function(String message) onError,
  });
  Future<void> start({
    required String agentId,
    String? voiceId,
    required Map<String, ToolHandler> tools,
  });
  Future<void> end();
  void dispose();
}

typedef SessionFactory = AgentSession Function();
typedef MicCheck = Future<MicResult> Function();

enum MicResult { ok, denied, missing, busy }

class CallController extends ChangeNotifier {
  CallController({
    required this.sessionFactory,
    required this.places,
    required this.indexOf,
    required this.navigate,
    this.checkMic,
    this.dialTimeout = const Duration(seconds: 20),
    this.agentId,
  });

  final SessionFactory sessionFactory;
  final List<Place> places;

  /// Lazy: building the index tokenises every document, so it starts when the
  /// call starts ringing (not mid-sentence, on the first tool call).
  final SearchIndex Function() indexOf;

  /// Routes the app (`/search?q=…`, `/places/<slug>`).
  final void Function(String location) navigate;
  final MicCheck? checkMic;
  final Duration dialTimeout;
  final String? agentId;

  CallPhase _phase = CallPhase.idle;
  String? _error;
  String? _lastAction;
  bool _salemVoice = false;
  Duration _elapsed = Duration.zero;
  bool _sheetOpen = false;

  AgentSession? _session;
  Timer? _dial;
  Timer? _clock;
  DateTime? _liveAt;

  /// Bumped on every start/teardown so a late event from a dead session can
  /// never resurrect a call that was hung up.
  int _token = 0;

  CallPhase get phase => _phase;
  String? get error => _error;
  String? get lastAction => _lastAction;
  bool get salemVoice => _salemVoice;
  Duration get elapsed => _elapsed;
  bool get sheetOpen => _sheetOpen;
  bool get active =>
      _phase == CallPhase.ringing ||
      _phase == CallPhase.live ||
      _phase == CallPhase.answering;

  void _set(CallPhase p) {
    _phase = p;
    notifyListeners();
  }

  /// Place the call. Called inside the tap, so the gesture that unlocks audio
  /// and the microphone prompt is the user's own.
  Future<void> start({bool salem = false}) async {
    if (active) return;
    final id = agentId ?? kAgentId;
    if (id.isEmpty) {
      _error = CallCopy.failed;
      _sheetOpen = true;
      _set(CallPhase.failed);
      return;
    }
    final token = ++_token;
    indexOf();
    _error = null;
    _lastAction = null;
    _elapsed = Duration.zero;
    _salemVoice = salem;
    _sheetOpen = true;
    _set(CallPhase.ringing);

    // A blocked, missing or busy microphone becomes a sentence instead of
    // silence. Probed before dialling, so «ringing» never hides it.
    final mic = await (checkMic?.call() ?? Future.value(MicResult.ok));
    if (token != _token) return;
    if (mic != MicResult.ok) {
      _fail(switch (mic) {
        MicResult.denied => CallCopy.micDenied,
        MicResult.missing => CallCopy.noMic,
        _ => CallCopy.micBusy,
      });
      return;
    }

    _dial = Timer(dialTimeout, () {
      if (token != _token || _phase != CallPhase.ringing) return;
      _fail(CallCopy.noAnswer);
    });

    final session = sessionFactory();
    _session = session;
    session.listen(
      onConnected: () {
        if (token != _token) return;
        _dial?.cancel();
        _liveAt = DateTime.now();
        _clock?.cancel();
        _clock = Timer.periodic(const Duration(seconds: 1), (_) {
          _elapsed = DateTime.now().difference(_liveAt!);
          notifyListeners();
        });
        _set(CallPhase.live);
      },
      onSpeaking: (speaking) {
        if (token != _token ||
            !(_phase == CallPhase.live || _phase == CallPhase.answering))
          return;
        _set(speaking ? CallPhase.answering : CallPhase.live);
      },
      onDisconnected: () {
        if (token != _token) return;
        _finish(CallPhase.ended);
      },
      onError: (message) {
        if (token != _token) return;
        if (_phase == CallPhase.ringing) {
          _fail(CallCopy.callFailed);
        } else {
          _finish(CallPhase.ended);
        }
      },
    );

    try {
      await session.start(
        agentId: id,
        voiceId: salem ? kSalemVoiceId : null,
        tools: {'show_places': _showPlaces, 'open_place': _openPlace},
      );
    } catch (_) {
      if (token == _token) _fail(CallCopy.callFailed);
    }
  }

  Future<String> _showPlaces(Map<String, dynamic> params) async {
    final r = showPlacesForCall('${params['query'] ?? ''}', indexOf(), places);
    if (r.query.isEmpty) return r.spoken;
    navigate('/search?q=${Uri.encodeQueryComponent(r.query)}');
    _lastAction = lastActionForSearch(r.query, r.total);
    notifyListeners();
    return r.spoken;
  }

  Future<String> _openPlace(Map<String, dynamic> params) async {
    final r = openPlaceForCall('${params['slug'] ?? ''}', places);
    if (r.slug == null) return r.spoken;
    navigate('/places/${r.slug}');
    _lastAction = '${CallCopy.didOpen} «${r.place!.nameAr}»';
    notifyListeners();
    return r.spoken;
  }

  /// There is no live voice hot-swap, so «switch» means a fresh session with
  /// the voice override — a few hundred milliseconds of reconnect, not a
  /// mid-sentence change. Every new call resets to شوق's own voice.
  Future<void> switchVoice() async {
    if (_phase != CallPhase.live && _phase != CallPhase.answering) return;
    final salem = !_salemVoice;
    await hangUp(keepSheet: true);
    await start(salem: salem);
  }

  Future<void> hangUp({bool keepSheet = false}) async {
    final session = _session;
    _teardown();
    _session = null;
    if (!keepSheet) _sheetOpen = true;
    _set(CallPhase.ended);
    try {
      await session?.end();
    } catch (_) {
      /* already gone */
    }
    session?.dispose();
  }

  void closeSheet() {
    if (active) return;
    _sheetOpen = false;
    _phase = CallPhase.idle;
    notifyListeners();
  }

  void _fail(String message) {
    final s = _session;
    _teardown();
    _session = null;
    _error = message;
    _set(CallPhase.failed);
    s?.end();
    s?.dispose();
  }

  void _finish(CallPhase p) {
    final s = _session;
    _teardown();
    _session = null;
    _set(p);
    s?.dispose();
  }

  void _teardown() {
    _token++;
    _dial?.cancel();
    _clock?.cancel();
    _dial = null;
    _clock = null;
  }

  @override
  void dispose() {
    _teardown();
    _session?.dispose();
    super.dispose();
  }
}
