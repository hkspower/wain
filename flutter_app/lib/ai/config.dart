/// The two agents, the words their calls say, and which agent a persona talks
/// to. Mirrors `src/lib/wain-ai.ts`.
///
/// One agent per persona, never shared (14 October, the owner's decision): شوق
/// has her own on ElevenLabs, سالم has his, and each has its own prompt, first
/// message and voice. There is no voice override any more, so a call never puts
/// one persona's voice on the other's agent.
library;

/// شوق's ElevenLabs agent — used ONLY by a sandbox build that asks for it:
///   flutter build … --dart-define=WAIN_AI_AGENT_ID=agent_1701m1gcrccrethae9y3nyv1e116
/// The live app is the free build since 2 October (local_session.dart): the
/// paid account ran dry and a live call showed its English quota error over
/// our own sheet. The web made the same change (src/lib/wain-ai.ts).
const String kSandboxAgentId = 'agent_1701m1gcrccrethae9y3nyv1e116';
const String _configured = String.fromEnvironment('WAIN_AI_AGENT_ID');

/// The agent id, or empty for the free build. Unset, empty and «none» all mean
/// free: an unset define arrives as the EMPTY STRING (the `??` trap the web's
/// CI hit), and since nothing falls back to an agent any more, all three are
/// the same answer.
String resolveAgentId([String configured = _configured]) {
  final c = configured.trim();
  return c.isEmpty || c.toLowerCase() == 'none' ? '' : c;
}

/// شوق's agent id, or empty for her free call (see [resolveAgentId]).
final String kAgentId = resolveAgentId();
bool get kAgentEnabled => kAgentId.isNotEmpty;

/// سالم's own agent (14 October). Named by its own define and read by the same
/// rules: unset, empty and «none» are the free call for him. Nothing falls back
/// to شوق's id: the two personas are two agents, and a missing id for one of
/// them is a free call with that persona's name, never a call to the other's
/// agent. Build with
///   flutter build … --dart-define=WAIN_SALEM_AGENT_ID=agent_5101m4wwgr3ae5qat412ezcnffhn
const String _salemConfigured = String.fromEnvironment('WAIN_SALEM_AGENT_ID');
final String kSalemAgentId = resolveAgentId(_salemConfigured);
bool get kSalemAgentEnabled => kSalemAgentId.isNotEmpty;

const String kSalemName = 'سالم';
const String kSalemRole = 'دليلك في الكويت';
const String kSalemGreeting =
    'هلا! أنا سالم. قول لي وش تبي — قهوة، بحر، طلعة عيال — وأدلّك.';

/// Who a call is with. Each persona has its own agent and never falls back to
/// the other's: her prompt is first-person feminine and her first message is
/// «أنا شوق», so his voice on her agent was his name on her brain (the swap
/// that put it there is gone, 14 October).
enum CallPersona {
  shouq,
  salem;

  /// What the call sheet and its failure sentences say for this one.
  CallPersonaCopy get copy => switch (this) {
    CallPersona.shouq => shouqCallCopy,
    CallPersona.salem => salemCallCopy,
  };
}

/// The agent id a persona calls, or empty for its free call. Both ids are
/// arguments, so the rule can be tested without a build define: the salem
/// branch never reads [shouq].
String agentIdFor(
  CallPersona persona, {
  required String shouq,
  required String salem,
}) => persona == CallPersona.salem ? salem : shouq;

/// The sentences of the call sheet that name the one on the line. The phase
/// words, the buttons and the microphone copy are CallCopy's for both.
class CallPersonaCopy {
  const CallPersonaCopy({
    required this.name,
    required this.role,
    required this.greeting,
    required this.answering,
    required this.callFailed,
    required this.failed,
    required this.offline,
    required this.micNote,
    required this.face,
  });

  /// The name in the title, on the bar and in the sheet's own sentences.
  final String name;
  final String role;

  /// Said while the call rings.
  final String greeting;

  /// The status line while the agent is speaking.
  final String answering;
  final String callFailed;
  final String failed;
  final String offline;
  final String micNote;

  /// The picture on the sheet.
  final String face;
}

/// Her copy, unchanged: the words the call has always used.
const shouqCallCopy = CallPersonaCopy(
  name: CallCopy.name,
  role: CallCopy.role,
  greeting: CallCopy.greeting,
  answering: CallCopy.answering,
  callFailed: CallCopy.callFailed,
  failed: CallCopy.failed,
  offline: CallCopy.offline,
  micNote: CallCopy.micNote,
  face: 'assets/img/shouq-face.jpg',
);

/// His: the same sentences as hers, with his name and his grammar (the
/// masculine «يرد» and «تكلّمه»). New on 14 October; the owner should read it.
const salemCallCopy = CallPersonaCopy(
  name: kSalemName,
  role: kSalemRole,
  greeting: kSalemGreeting,
  answering: 'سالم يرد…',
  callFailed: 'ما قدرنا نوصلك بسالم — جرّب مرة ثانية.',
  failed: 'ما قدرنا نشغّل سالم الحين — جرّب مرة ثانية بعدين.',
  offline: 'ما فيه إنترنت — سالم يحتاج اتصال عشان يرد.',
  micNote: 'يحتاج إذن المايك عشان تكلّمه.',
  face: 'assets/img/salem-face.jpg',
);

/// What happens to a conversation once it has happened — the app's half of
/// `WAIN_AI_RECORDING` in `src/lib/wain-ai.ts`, in the same words.
///
/// Read off the live agent's `platform_settings.privacy` on 1 October: calls
/// recorded, calls and typed chats kept with no expiry, topic and sentiment
/// analysis on. The privacy screen used to say «ما نسجّل المكالمة عندنا، ولا
/// نخزّن صوتك», which the agent's own settings contradicted. If those settings
/// change, this and the web's copy change together — re-read the agent first.
abstract final class AiPrivacyCopy {
  // The provider is named once, on the privacy screen; on request (2 October).
  static const chatNotice =
      'المحادثة تنحفظ عند مزوّد خدمة الصوت وما تنمسح تلقائياً.';
  static const details = 'التفاصيل';
  static const consentTitle = 'قبل ما تكلّم شوق أو تكتب لسالم';
  static const consentBody =
      'صوتك، وأي شي تكتبه، يروح لمزوّد خدمة الصوت عشان المساعد يسمعك ويرد عليك — '
      'وينحفظ عندهم تحت حسابنا وما ينمسح تلقائياً. فلا تقول ولا تكتب شي ما تبيه ينحفظ.';
  static const agree = 'أوافق وأكمّل';
  static const notNow = 'مو الحين';
  static const waiting = 'بانتظار موافقتك';
}

abstract final class CallCopy {
  static const name = 'شوق';
  static const role = 'دليلتك في الكويت';
  static const callHint = 'اضغط عشان تكلّم شوق';

  /// Under her name on /find's phone — the web's `WAIN_AI_COPY.phoneLine`.
  static const phoneLine = 'تدوّر لك وين تطلع';
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

  /// The same question, typed, with him — on her answer and on the call's
  /// last screen (the web's `WAIN_AI_COPY.toSalem`).
  static const toSalem = 'كمّل مع سالم';
  static const didSearch = 'دوّرت لك';
  static const didOpen = 'فتحت لك صفحة';
  static const ended = 'انتهت المكالمة';
  static const callFailed = 'ما قدرنا نوصلك بشوق — جرّب مرة ثانية.';
  static const noAnswer =
      'طوّلنا نرن وما وصلنا — تأكد إنك سمحت بالمايك وجرّب مرة ثانية.';
  static const micNote = 'يحتاج إذن المايك عشان تكلّمها.';
  static const micDenied = 'ما وصلنا صوتك — تأكد إن المايك مسموح للتطبيق.';
  static const offline = 'ما فيه إنترنت — شوق تحتاج اتصال عشان ترد.';
  static const micBlocked =
      'المايك مقفول لوين — افتح الإعدادات وسمح له، وارجع اتصل.';
  static const openSettings = 'افتح الإعدادات';
  static const minimise = 'صغّر المكالمة';
  static const backToCall = 'ارجع للمكالمة';
  static const noMic = 'ما لقينا مايك في جهازك — وصّل مايك وجرّب مرة ثانية.';
  static const micBusy = 'المايك مشغول في تطبيق ثاني — سكّره وجرّب مرة ثانية.';
  static const failed = 'ما قدرنا نشغّل شوق الحين — جرّب مرة ثانية بعدين.';

  /// The free call (local_session.dart) — the web's local-mode lines.
  static const noSpeech = 'ما سمعناك — جرّب مرة ثانية وتكلم بعد الإشارة.';
  static const speechUnavailable =
      'جوالك ما يقدر يسمعك الحين — اكتب اللي تبيه بالبحث.';
}

abstract final class ChatCopy {
  static const placeholder = 'اكتب رسالتك…';
  static const send = 'إرسال';
  static const connecting = 'نوصّل سالم…';
  static const connected = 'متصل';
  static const disconnected = 'انتهت المحادثة.';
  static const reconnect = 'ابدأ من جديد';

  /// The calls are شوق's: it said «كلّمه بمكالمة», a call to him there is no
  /// button for.
  static const toolUnavailable =
      'ما أقدر أفتح صفحات من هنا — دوّر بنفسك أو كلّم شوق بمكالمة.';
  static const failed = 'ما قدرنا نوصله — جرّب مرة ثانية.';

  /// The server refused for something a retry this minute cannot change (out
  /// of credits, 2 October) — the web's `WAIN_AI_CHAT_COPY.unavailable`.
  static const unavailable = 'سالم مو متاح الحين — جرّب بعد شوي.';

  /// The free chat (the live app since 2 October) — the web's
  /// WAIN_AI_CHAT_COPY.free* lines, the same words.
  static const freeGreeting =
      'هلا! أنا سالم. اكتب وش تبي — قهوة، بحر، طلعة عيال، منطقة — وأدوّر لك بين أماكن وين.';
  static const freeStatus = 'جاهز';
  static const freeNotice =
      'اللي تكتبه يبقى بجهازك — البحث يصير داخل الصفحة وما ينرسل لأحد.';
  static const freeEmpty =
      'ما لقيت شي يطابق هذا — جرّب كلمة ثانية، مثل «قهوة» أو «بحر» أو اسم منطقة.';
  static const unavailableStatus = 'مو متاح الحين';
  static const retryLater = 'جرّب مرة ثانية';
  static const notConfigured = 'المحادثة مو متاحة الحين.';
  static const offline = 'ما فيه إنترنت — المحادثة تحتاج اتصال.';

  /// Read out while a reply is on its way; the dots carry it on screen.
  static const typing = 'يكتب…';

  /// When a reply never comes (the web's 45s bound): said, not just dropped.
  static const noReply = 'ما وصلنا رد — جرّب مرة ثانية.';

  /// The chat's memory (data/salem_followup.dart): what he says when a short
  /// reply is read against his last answer rather than as a new question.
  static const moreIntro = 'وهذي غيرها:';
  static const moreNone =
      'هذي كل الأماكن اللي عندي عن هالطلب — جرّب كلمة ثانية.';
  static const refineNone = 'ما لقيت شي يجمع الاثنين — هذي اللي عندي قبل.';
  static const where = 'مكانه على الخريطة تحت.';

  /// What he says to a message that is not about places (8 October — the
  /// web's `opener`, `askTail`, `social`, `askSubject`, `askArea`,
  /// `elsewhere` and `areaNone`, the same words). Each of these was searched:
  /// «السلام عليكم» → «جرّب قصر السلام», «مين أنت؟» → a bridge, «شكراً» and
  /// «هلا» → «ما لقيت شي». None of them changes what the chat remembers.
  static const openerSalam = 'وعليكم السلام!';
  static const openerGreet = 'هلا والله!';
  static const openerMorning = 'صباح النور!';
  static const openerEvening = 'مساء النور!';
  static const askTail =
      'قول لي وش تبي — قهوة، بحر، مطعم، ولا طلعة عيال — وأدوّر لك.';
  static const socialHow = 'الحمد لله بخير!';
  static const socialThanks = 'العفو! إذا تبي شي ثاني قول لي.';
  static const socialAfia = 'الله يعافيك! إذا تبي شي ثاني قول لي.';
  static const socialWho =
      'أنا سالم من وين — أدوّر لك بين أماكن الكويت اللي عندنا: قهوة، بحر، مطاعم، وطلعات. قول لي وش تبي.';
  static const socialNotShouq =
      'لا، أنا سالم. شوق تكلّمك بمكالمة من صفحة «إلى وين؟».';
  static const socialHelp =
      'اكتب لي وش تبي — «قهوة هادية»، «عشا على البحر»، أو اسم منطقة — وأعطيك أماكن على الخريطة، وتقدر ترسلها للربع.';
  static const socialBye = 'الله يسلمك! حيّاك أي وقت.';
  static const socialOk =
      'تمام! إذا تبي غيرها قول «غيره»، أو اسألني عن شي ثاني.';
  static const socialOkFresh = 'تمام! قول لي وش تبي وأدوّر لك.';
  static const socialNo = 'أوكي! إذا احتجت شي قول لي.';

  /// A follow-up with nothing to follow («غيره» as the first thing said), and
  /// «قريب مني» on a screen that never asks where you are.
  static const askSubject =
      'عن شنو؟ قول لي وش تبي — قهوة، بحر، مطعم، ولا طلعة عيال.';
  static const askArea =
      'ما أعرف وين أنت — قول لي منطقتك، مثل «السالمية» أو «حولي»، وأدوّر لك فيها.';

  /// A part of Kuwait the catalogue has nothing in: it used to be «ما لقيت
  /// شي… جرّب… اسم منطقة», said to the name of a governorate.
  static String elsewhere(String area) =>
      'ما عندي أماكن ب$area للحين — جرّب «قهوة» أو «بحر» وأوريك اللي عندي.';

  /// An area named after an answer, with none of that answer's places in it.
  static String areaNone(String area) =>
      'ما عندي منها شي ب$area — هذي اللي عندي قبل.';
  static const directions = 'الطريق';
  static const openPlace = 'صفحته';
  static const followLabel = 'تبي';
  static const noResults = 'ما لقينا شي لـ';

  /// The other ways in, from inside the chat: his call, placed from his header
  /// (since 7 October, as her call; since 14 October it is his, on his agent),
  /// the same answer as a full search, and his voice.
  static const callSalem = 'كلّم سالم';

  /// The line over a question handed to him from شوق (the web's
  /// `WAIN_AI_CHAT_COPY.fromCall` / `fromShouq`).
  static const fromCall = 'من مكالمتك مع شوق';
  static const fromShouq = 'من جواب شوق';
  static const seeAll = 'شوف الكل بالبحث';
  static const readAloud = 'اقرا لي الردود';
}

/// `/salem?q=…&from=call|shouq` — a question handed to سالم, and where it came
/// from. The chat asks it as a NEW question whatever it remembers: read
/// against an older chat, «شي رخيص» from her became a narrowing of that
/// chat's subject (the web's `salemHandoff`).
String salemHandoff(String q, {String? from}) {
  final t = q.trim();
  final params = {
    'q': t.length > 120 ? t.substring(0, 120) : t,
    if (from == 'call' || from == 'shouq') 'from': from!,
  };
  return Uri(path: '/salem', queryParameters: params).toString();
}
