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

/// Eid — Gulf male, warm and clear. The voice of سالم: the mid-call
/// «🔊 بصوت سالم» swap, and the override the typed chat sends.
///
/// An accepted tension, not a solved one, as on the web: it is the same agent —
/// same prompt, tools and knowledge — with a different speaker. Her prompt is
/// first-person feminine and her first message «أنا شوق», so he can still call
/// himself her name on the wire. Fixing that means editing the live agent.
const String kSalemVoiceId = 'Ywuz3KyW2N5pqKNpwcCL';

const String kSalemName = 'سالم';
const String kSalemRole = 'دليلك في الكويت';
const String kSalemGreeting =
    'هلا! أنا سالم. قول لي وش تبي — قهوة، بحر، طلعة عيال — وأدلّك.';

/// What happens to a conversation once it has happened — the app's half of
/// `WAIN_AI_RECORDING` in `src/lib/wain-ai.ts`, in the same words.
///
/// Read off the live agent's `platform_settings.privacy` on 1 October: calls
/// recorded, calls and typed chats kept with no expiry, topic and sentiment
/// analysis on. The privacy screen used to say «ما نسجّل المكالمة عندنا، ولا
/// نخزّن صوتك», which the agent's own settings contradicted. If those settings
/// change, this and the web's copy change together — re-read the agent first.
abstract final class AiPrivacyCopy {
  static const chatNotice = 'المحادثة تنحفظ عند ElevenLabs وما تنمسح تلقائياً.';
  static const details = 'التفاصيل';
  static const consentTitle = 'قبل ما تكلّم شوق أو تكتب لسالم';
  static const consentBody =
      'صوتك، وأي شي تكتبه، يروح لخدمة ElevenLabs عشان شوق تسمعك وترد عليك — '
      'وينحفظ عندهم تحت حسابنا وما ينمسح تلقائياً. فلا تقول ولا تكتب شي ما تبيه ينحفظ.';
  static const agree = 'أوافق وأكمّل';
  static const notNow = 'مو الحين';
  static const waiting = 'بانتظار موافقتك';
}

abstract final class CallCopy {
  static const name = 'شوق';
  static const role = 'دليلتك في الكويت';
  static const callHint = 'اضغط عشان تكلّم شوق';
  static const typeHint = 'اكتب عشان تدردش وياه';
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
  static const micBlocked =
      'المايك مقفول لوين — افتح الإعدادات وسمح له، وارجع اتصل.';
  static const openSettings = 'افتح الإعدادات';
  static const minimise = 'صغّر المكالمة';
  static const backToCall = 'ارجع للمكالمة';
  static const noMic = 'ما لقينا مايك في جهازك — وصّل مايك وجرّب مرة ثانية.';
  static const micBusy = 'المايك مشغول في تطبيق ثاني — سكّره وجرّب مرة ثانية.';
  static const failed = 'ما قدرنا نشغّل شوق الحين — جرّب مرة ثانية بعدين.';
}

abstract final class ChatCopy {
  static const placeholder = 'اكتب رسالتك…';
  static const send = 'إرسال';
  static const connecting = 'نوصّل سالم…';
  static const connected = 'متصل';
  static const disconnected = 'انتهت المحادثة.';
  static const reconnect = 'ابدأ من جديد';
  static const toolUnavailable =
      'ما أقدر أفتح صفحات من هنا — دوّر بنفسك أو كلّمه بمكالمة.';
  static const failed = 'ما قدرنا نوصله — جرّب مرة ثانية.';
  static const notConfigured = 'المحادثة مو متاحة الحين.';

  /// Read out while a reply is on its way; the dots carry it on screen.
  static const typing = 'يكتب…';

  /// When a reply never comes (the web's 45s bound): said, not just dropped.
  static const noReply = 'ما وصلنا رد — جرّب مرة ثانية.';
}
