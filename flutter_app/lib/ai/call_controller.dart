/// A phone call with شوق or سالم. Owns the session, the honest phase the sheet
/// shows, and the client tools she drives the app with. The persona picks the
/// agent (config.dart): each persona has its own, and a call with no agent for
/// its persona is the free call.
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
import 'agent_health.dart';
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

  /// No voice option: a call is the agent's own voice, whichever persona it is.
  Future<void> start({
    required String agentId,
    required Map<String, ToolHandler> tools,
  });
  Future<void> end();
  void dispose();
}

/// A session for one call. [local] is the free call — the phone's own speech
/// and our own search, with no agent on the line — which the controller
/// decides per call from the persona's agent id.
typedef SessionFactory = AgentSession Function({required bool local});
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
    this.shouqAgentId,
    this.salemAgentId,
    this.keepAlive,
    this.isOffline,
    AgentHealth? health,
  }) : _health = health ?? AgentHealth.instance;

  /// Whether the agent refused for credits lately (agent_health.dart).
  final AgentHealth _health;

  final SessionFactory sessionFactory;
  final List<Place> places;

  /// Lazy: building the index tokenises every document, so it starts when the
  /// call starts ringing (not mid-sentence, on the first tool call).
  final SearchIndex Function() indexOf;

  /// Routes the app (`/search?q=…`, `/places/<slug>`).
  final void Function(String location) navigate;
  final MicCheck? checkMic;
  final Duration dialTimeout;

  /// Each persona's agent. Null reads the build's own (config.dart); an empty
  /// id is that persona's free call. Never each other's: see [agentIdFor].
  final String? shouqAgentId;
  final String? salemAgentId;

  /// Screen awake, and on an agent call the Android foreground service that
  /// keeps the microphone open while the app is behind another one. Started
  /// once the microphone is granted, stopped on every way a call can end.
  final CallKeepAlive? keepAlive;
  bool _kept = false;

  /// No network at all: the call fails at once with a sentence saying so,
  /// instead of ringing for [dialTimeout] first.
  final bool Function()? isOffline;

  CallPhase _phase = CallPhase.idle;
  String? _error;
  String? _lastAction;
  String? _lastQuery;
  String? _lastSlug;
  CallPersona _persona = CallPersona.shouq;
  bool _local = false;
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

  /// The search box moved on from the call's question: a question typed back
  /// later is typed, not «من مكالمتك» (the web's `asked`, 14 October).
  void forgetLastQueryUnless(String typed) {
    if (_lastQuery == null || _lastQuery == typed.trim()) return;
    _lastQuery = null;
    notifyListeners();
  }

  /// The place the call last put on screen — the first of a search, or the
  /// one it opened — for «رسّلها للربع» on the last screen, as on the web.
  String? get lastSlug => _lastSlug;

  /// Who the call is with: the sheet's name, picture and sentences follow it.
  CallPersona get persona => _persona;

  /// Whether a call with [p] would be the free one: no agent on the line for
  /// that persona, or the agent refused for credits lately.
  bool isFree(CallPersona p) => _agentFor(p).isEmpty || !_health.available;

  /// «كمّل مع سالم» is only offered after HER call: the hand-over says «من
  /// مكالمتك مع شوق», which is not true of a call with him.
  bool get canContinueWithSalem =>
      !active && _persona == CallPersona.shouq && _lastQuery != null;

  String _agentFor(CallPersona p) => agentIdFor(
    p,
    shouq: shouqAgentId ?? kAgentId,
    salem: salemAgentId ?? kSalemAgentId,
  );

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
  Future<void> start({CallPersona persona = CallPersona.shouq}) async {
    if (active) return;
    final id = _agentFor(persona);
    final copy = persona.copy;
    // Set before anything can fail, so a refused call shows the right person.
    _persona = persona;
    _local = isFree(persona);
    if (isOffline?.call() ?? false) {
      _error = copy.offline;
      _sheetOpen = true;
      _set(CallPhase.failed);
      return;
    }
    final token = ++_token;
    indexOf();
    _error = null;
    _lastAction = null;
    _lastQuery = null;
    _lastSlug = null;
    _heard = '';
    _elapsed = Duration.zero;
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
    // Not awaited: its permission dialogs must not hold the dial. The service
    // is an agent call's; the free call keeps the screen awake and nothing
    // more (keep_alive.dart).
    keepAlive?.start(title: copy.callTitle, background: !_local);

    _dial = Timer(dialTimeout, () {
      if (token != _token || _phase != CallPhase.ringing) return;
      _fail(CallCopy.noAnswer);
    });

    final session = sessionFactory(local: _local);
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
        if (_local) {
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
        } else if (!_local && isQuotaRefusal(message)) {
          // The account is out of credits (7 October on the web): said as
          // itself, and the next call for a quarter hour is the free one —
          // it used to read as «ما قدرنا نوصلك» and ring the agent again.
          _health.markUnavailable();
          _fail(copy.agentUnavailable);
        } else if (_local) {
          // The phone's recogniser gave up, ringing or live. It used to end a
          // live call as «انتهت المكالمة», which says she hung up on them.
          _fail(CallCopy.speechUnavailable);
        } else if (_phase == CallPhase.ringing) {
          _fail(copy.callFailed);
        } else {
          _finish(CallPhase.ended);
        }
      },
    );

    try {
      await session.start(
        // The free call carries no agent, whether there is none for this
        // persona or the account refused: a local session ignores the id,
        // and handing it one anyway said «agent» of a call with nobody on it.
        agentId: _local ? '' : id,
        tools: {'show_places': _showPlaces, 'open_place': _openPlace},
      );
    } catch (_) {
      if (token == _token) _fail(copy.callFailed);
    }
  }

  Future<String> _showPlaces(Map<String, dynamic> params) async {
    final r = showPlacesForCall(
      '${params['query'] ?? ''}',
      indexOf(),
      places,
      salem: _persona == CallPersona.salem,
    );
    if (r.query.isEmpty) return r.spoken;
    navigate('/search?q=${Uri.encodeQueryComponent(r.query)}');
    _lastAction = lastActionForSearch(r.query, r.total);
    _lastQuery = r.query;
    _lastSlug = r.slugs.isEmpty ? null : r.slugs.first;
    notifyListeners();
    return r.spoken;
  }

  Future<String> _openPlace(Map<String, dynamic> params) async {
    final r = openPlaceForCall(
      '${params['slug'] ?? ''}',
      places,
      salem: _persona == CallPersona.salem,
    );
    if (r.slug == null) return r.spoken;
    navigate('/places/${r.slug}');
    _lastAction = '${CallCopy.didOpen} «${r.place!.nameAr}»';
    _lastSlug = r.slug;
    notifyListeners();
    return r.spoken;
  }

  Future<void> hangUp() async {
    // Only a call in progress can be hung up. The notification's «إنهاء» can
    // arrive after the call has ended on its own (or failed), and used to
    // re-open the sheet as «انتهت المكالمة» over whatever the caller had moved
    // on to.
    if (!active) return;
    final session = _session;
    _teardown();
    _session = null;
    _sheetOpen = true;
    _set(CallPhase.ended);
    try {
      await session?.end();
    } catch (_) {
      /* already gone */
    }
    session?.dispose();
  }

  /// «رسّلها للربع» on the last screen: the place the call put on screen,
  /// opened at its share panel.
  void shareLastPlace() {
    final slug = _lastSlug;
    if (slug == null || active) return;
    closeSheet();
    navigate('/places/$slug?share=1');
  }

  /// «اكتب لسالم» on a phone that cannot listen: the same question, typed.
  void typeToSalem() {
    if (active) return;
    closeSheet();
    navigate('/salem');
  }

  /// «كمّل مع سالم» on the last screen: the same question, typed, with him.
  /// Switching used to mean starting over — the sheet offered another call
  /// and nothing else, and سالم knew nothing of what she had found.
  void continueWithSalem() {
    final q = _lastQuery;
    if (q == null || !canContinueWithSalem) return;
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
