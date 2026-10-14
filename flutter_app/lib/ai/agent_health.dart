/// Is the voice agent worth trying right now? The app's half of the web's
/// `lib/agent-health.ts`.
///
/// An agent build depends on an account that can run dry, and on 7 October it
/// did: every call on the live site was refused with «[quota_exceeded] You've
/// run out of credits». A refusal for credits does not change for a while, so
/// it is remembered here for [kAgentOffFor] and the next call in that time is
/// the free call — the phone's own recogniser and our own search, which need
/// no account. In memory only: a quarter hour is shorter than most app
/// sessions, and a timestamp is not worth a preference key.
library;

const Duration kAgentOffFor = Duration(minutes: 15);

class AgentHealth {
  AgentHealth._();
  static final AgentHealth instance = AgentHealth._();

  DateTime? _refusedAt;

  /// Tests fix the clock; the app reads it.
  DateTime Function() now = DateTime.now;

  void markUnavailable() => _refusedAt = now();

  /// Whether a call may try the agent: no refusal for credits in the last
  /// quarter hour.
  bool get available {
    final at = _refusedAt;
    if (at == null) return true;
    final since = now().difference(at);
    return since.isNegative || since >= kAgentOffFor;
  }

  /// For tests: forget everything.
  void reset() => _refusedAt = null;
}

/// The words the server uses for an account out of credits. One test, so the
/// call and the chat cannot disagree about it (the web's `isQuotaRefusal`).
bool isQuotaRefusal(String text) => RegExp(
  r'quota_exceeded|run out of credits|insufficient[_ ]credits',
  caseSensitive: false,
).hasMatch(text);
