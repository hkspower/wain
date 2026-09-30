/// شوق's configuration — the agent, the words the call says, the voice swap.
/// Mirrors `src/lib/wain-ai.ts`.
library;

const String kDefaultAgentId = 'agent_1701m1gcrccrethae9y3nyv1e116';
const String _configured = String.fromEnvironment('WAIN_AI_AGENT_ID');

/// The agent id, or empty when switched off with «none».
///
/// `isEmpty` and not `?? default`: an unset define arrives as the EMPTY STRING,
/// and a null-coalescing default never fires for it. That is the exact bug the
/// web's CI had — GitHub expands an unset variable to "", `??` kept it, and
/// every build shipped with شوق switched off while the log said she was on.
String resolveAgentId([String configured = _configured]) {
  final c = configured.trim().isEmpty ? kDefaultAgentId : configured.trim();
  return c.toLowerCase() == 'none' ? '' : c;
}

final String kAgentId = resolveAgentId();
bool get kAgentEnabled => kAgentId.isNotEmpty;

/// Eid — Gulf male, warm and clear. Used for exactly one thing: the mid-call
/// «🔊 بصوت سالم» swap, the same brain with a different speaker. The typed
/// chat sends NO voice override — her voice, as the agent is configured.
const String kSalemVoiceId = 'Ywuz3KyW2N5pqKNpwcCL';

abstract final class CallCopy {
  static const name = 'شوق';
  static const role = 'دليلتك في الكويت';
  static const callHint = 'اضغط عشان تكلّم شوق';
  static const typeHint = 'اكتب عشان تدردش معها';
  static const greeting =
      'هلا! أنا شوق. قول لي وش تبي — قهوة، بحر، طلعة عيال — وأدلّك.';
  static const listening = 'قول وش تبي…';
  static const listeningExamples = '«قهوة هادية» · «مطعم للعائلة» · «بحر»';
  static const loading = 'نجهّز شوق…';
  static const close = 'إغلاق';
  static const centre = 'مركز اتصال وين';
  static const ringing = 'يرن…';
  static const onCall = 'متصل';
  static const answering = 'شوق ترد…';
  static const hangUp = 'إنهاء المكالمة';
  static const callAgain = 'اتصل مرة ثانية';
  static const didSearch = 'دوّرت لك';
  static const didOpen = 'فتحت لك صفحة';
  static const switchToSalem = '🔊 بصوت سالم';
  static const switchToShouq = '🔊 بصوت شوق';
  static const ended = 'انتهت المكالمة';
  static const callFailed = 'ما قدرنا نوصلك بشوق — جرّب مرة ثانية.';
  static const noAnswer =
      'طوّلنا نرن وما وصلنا — تأكد إنك سمحت بالمايك وجرّب مرة ثانية.';
  static const micNote = 'يحتاج إذن المايك عشان تكلّمها.';
  static const micDenied = 'ما وصلنا صوتك — تأكد إن المايك مسموح للتطبيق.';
  static const noMic = 'ما لقينا مايك في جهازك — وصّل مايك وجرّب مرة ثانية.';
  static const micBusy = 'المايك مشغول في تطبيق ثاني — سكّره وجرّب مرة ثانية.';
  static const failed = 'ما قدرنا نشغّل شوق الحين — جرّب مرة ثانية بعدين.';
}

abstract final class ChatCopy {
  static const placeholder = 'اكتب رسالتك…';
  static const send = 'إرسال';
  static const connecting = 'نوصّل شوق…';
  static const connected = 'متصل';
  static const disconnected = 'انتهت المحادثة.';
  static const reconnect = 'ابدأ من جديد';
  static const toolUnavailable =
      'ما أقدر أفتح صفحات من هنا — دوّر بنفسك أو كلّمها بمكالمة.';
  static const failed = 'ما قدرنا نوصلها — جرّب مرة ثانية.';
  static const notConfigured = 'المحادثة مو متاحة الحين.';
}
