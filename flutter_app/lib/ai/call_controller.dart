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
import 'keep_alive.dart';
import 'local_session.dart' show kNoSpeech;
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

/// `blocked` is a refusal the app can no longer ask about (iOS after the first
/// «لا», Android after «لا تسأل مرة ثانية»): only Settings can undo it, so the
/// sheet offers a way there instead of a sentence alone.
enum MicResult { ok, denied, blocked, missing, busy }

class CallController extends ChangeNotifier {
  CallController({
    required this.sessionFactory,
    required this.places,
    required this.indexOf,
    required this.navigate,
    this.checkMic,
    this.dialTimeout = const Duration(seconds: 20),
    this.agentId,
    this.keepAlive,
    this.isOffline,
    this.local = false,
  });

  /// The free call (local_session.dart): no agent, so no agent id is needed,
  /// and once the search has opened the sheet gets out of the way of it — the
  /// web's local mode closes the same way.
  final bool local;

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

  /// Screen awake, and on Android the foreground service that keeps the
  /// microphone open while the app is behind another one. Started once the
  /// microphone is granted, stopped on every way a call can end.
  final CallKeepAlive? keepAlive;
  bool _kept = false;

  /// No network at all: the call fails at once with a sentence saying so,
  /// instead of ringing for [dialTimeout] first.
  final bool Function()? isOffline;

  CallPhase _phase = CallPhase.idle;
  String? _error;
  String? _lastAction;
  String? _lastQuery;
  bool _salemVoice = false;
  Duration _elapsed = Duration.zero;
  bool _sheetOpen = false;
  String _heard = '';

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

  /// What she last searched for in this call, for «كمّل مع سالم» on the last
  /// screen and for /search to know its question came from her call.
  String? get lastQuery => _lastQuery;
  bool get salemVoice => _salemVoice;
  Duration get elapsed => _elapsed;
  bool get sheetOpen => _sheetOpen;

  /// What the free call has heard so far, shown while she listens.
  String get heard => _heard;
  void hear(String words) {
    if (!active) return;
    _heard = words;
    notifyListeners();
  }

  bool get active =>
      _phase == CallPhase.ringing ||
      _phase == CallPhase.live ||
      _phase == CallPhase.answering;

  /// The call is going on with its sheet put away, the way a phone's own call
  /// shrinks to a bar when you go and look at something else.
  bool get minimised => active && !_sheetOpen;

  /// Puts the sheet away without ending the call — to see the page she just
  /// opened, which the full-screen sheet otherwise covers.
  void minimise() {
    if (!active || !_sheetOpen) return;
    _sheetOpen = false;
    notifyListeners();
  }

  void restore() {
    if (!active || _sheetOpen) return;
    _sheetOpen = true;
    notifyListeners();
  }

  void _set(CallPhase p) {
    _phase = p;
    notifyListeners();
  }

  /// Place the call. Called inside the tap, so the gesture that unlocks audio
  /// and the microphone prompt is the user's own.
  Future<void> start({bool salem = false}) async {
    if (active) return;
    final id = agentId ?? kAgentId;
    if (id.isEmpty && !local) {
      _error = CallCopy.failed;
      _sheetOpen = true;
      _set(CallPhase.failed);
      return;
    }
    if (isOffline?.call() ?? false) {
      _error = CallCopy.offline;
      _sheetOpen = true;
      _set(CallPhase.failed);
      return;
    }
    final token = ++_token;
    indexOf();
    _error = null;
    _lastAction = null;
    _lastQuery = null;
    _heard = '';
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
        MicResult.blocked => CallCopy.micBlocked,
        MicResult.missing => CallCopy.noMic,
        _ => CallCopy.micBusy,
      });
      return;
    }

    _kept = true;
    keepAlive?.start();

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
        if (local) {
          // The answer is on the search screen now; the sheet steps aside.
          final s = _session;
          _teardown();
          _session = null;
          _sheetOpen = false;
          _set(CallPhase.idle);
          s?.dispose();
          return;
        }
        _finish(CallPhase.ended);
      },
      onError: (message) {
        if (token != _token) return;
        if (message == kNoSpeech) {
          _fail(CallCopy.noSpeech);
        } else if (local) {
          // The phone's recogniser gave up, ringing or live. It used to end a
          // live call as «انتهت المكالمة», which says she hung up on them.
          _fail(CallCopy.speechUnavailable);
        } else if (_phase == CallPhase.ringing) {
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
    _lastQuery = r.query;
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

  /// «كمّل مع سالم» on the last screen: the same question, typed, with him.
  /// Switching used to mean starting over — the sheet offered another call
  /// and nothing else, and سالم knew nothing of what she had found.
  void continueWithSalem() {
    final q = _lastQuery;
    if (q == null || active) return;
    closeSheet();
    navigate(salemHandoff(q, from: 'call'));
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
    // A call that fails while its sheet is put away must still be seen to.
    _sheetOpen = true;
    _set(CallPhase.failed);
    s?.end();
    s?.dispose();
  }

  void _finish(CallPhase p) {
    final s = _session;
    _teardown();
    _session = null;
    // She hung up, or the line dropped, while the sheet was put away: say so.
    _sheetOpen = true;
    _set(p);
    s?.dispose();
  }

  void _teardown() {
    _token++;
    if (_kept) {
      _kept = false;
      keepAlive?.stop();
    }
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
