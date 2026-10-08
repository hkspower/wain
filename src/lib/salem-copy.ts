/**
 * The typed chat's copy lives here, not in wain-ai.ts, because of where
 * wain-ai.ts is bundled: the call button reads it, so it sits in the chunk
 * every page loads, and an export stays in a module whenever any chunk uses
 * it. Kept beside WAIN_AI_COPY it put ~40 of /salem's sentences on every
 * route (measured 7 October, when the fallback lines pushed /search over its
 * budget). Imported by /salem alone.
 */
/**
 * `/salem`'s own copy — for the typed-chat UI itself. Named for and gendered
 * toward سالم now (`connecting`/`connected`/`failed` — see `SALEM_NAME`'s own
 * comment for the identity claim this makes, and its honest limit: the
 * agent's own first line still says «أنا شوق», which this copy cannot
 * change). No `greeting` here still: the first line in the transcript is
 * whatever the wire actually sends, not a written-in-advance line.
 */
export const WAIN_AI_CHAT_COPY = {
  placeholder: "اكتب رسالتك…",
  send: "إرسال",
  connecting: "نوصّل سالم…",
  connected: "متصل",
  disconnected: "خلصت المحادثة — تبي نبدأ من جديد؟",
  // The three ways a session fails, said apart — one «جرّب مرة ثانية» for all
  // of them was wrong for each. The header says only that the line is down;
  // the banner under the transcript says which kind of down.
  offline: "مو متصل",
  failedTimeout: "طوّلنا نوصله — تأكد من النت وجرّب مرة ثانية.",
  failedDropped: "انقطع الاتصال في نص المحادثة — ابدأ من جديد.",
  // Said when a message could not be sent. The bubble is NOT drawn for it.
  sendFailed: "ما انرسلت رسالتك — الاتصال مو مفتوح.",
  // A reply is on its way (read by a screen reader as it appears).
  typing: "يكتب…",
  // Between the old conversation and the new one after «ابدأ من جديد», so a
  // fresh greeting does not land as if it were the next line of the old chat.
  newConversation: "— محادثة جديدة —",
  noResults: "ما لقينا شي لـ",
  // Until the first line of a conversation arrives she has said nothing, and a
  // bare input box under an empty transcript reads as a page that did not load.
  starterLabel: "جرّب تسأل:",
  starters: ["قهوة هادية", "طلعة مع العيال", "عشا على البحر", "شي رخيص"],
  // The typing dots vanished after 45s with no word; this is the word.
  noReply: "ما وصلني رد منها — جرّب ثاني.",
  // Said under the dots when a reply is taking long, so a slow answer is not
  // indistinguishable from a dead one.
  slow: "ثواني وترد عليك…",
  reconnect: "ابدأ من جديد",
  // The chat's own tool call is answered with an error rather than left to
  // hang — see lib/salem-chat.ts — so this is what a visitor reads when they
  // tried to open a place or the map from here and could not.
  toolUnavailable: "ما أقدر أفتح صفحات من هنا — دوّر بنفسك أو كلّمه بمكالمة.",
  failed: "ما قدرنا نوصله — جرّب مرة ثانية.",
  // The server refused for credits (2 and 7 October). No retry this minute
  // changes that, so he does not offer one: the page answers from وين's own
  // search (lib/agent-health.ts) and says so once, in the transcript. It used
  // to be «سالم مو متاح الحين» with a retry button that waited 30 seconds.
  agentFallback: "الخدمة الصوتية مو متاحة الحين — أجاوبك من دليل وين.",
  // The free build (the live site since 2 October): no agent behind the box,
  // so سالم answers from وين's own search inside the page. Every line here is
  // something this page does itself, so a greeting written in advance is
  // honest — unlike the agent's, where only the wire may speak first.
  freeGreeting: "هلا! أنا سالم. اكتب وش تبي — قهوة، بحر، طلعة عيال، منطقة — وأدوّر لك بين أماكن وين.",
  freeStatus: "جاهز",
  freeNotice: "اللي تكتبه يبقى بجهازك — البحث يصير داخل الصفحة وما ينرسل لأحد.",
  freeEmpty: "ما لقيت شي يطابق هذا — جرّب كلمة ثانية، مثل «قهوة» أو «بحر» أو اسم منطقة.",
  notConfigured: "المحادثة مو متاحة الحين.",
  // The chat's memory (lib/salem-followup.ts): what he says when a short
  // reply is read against his last answer rather than as a new question.
  moreIntro: "وهذي غيرها:",
  moreNone: "هذي كل الأماكن اللي عندي عن هالطلب — جرّب كلمة ثانية.",
  refineNone: "ما لقيت شي يجمع الاثنين — هذي اللي عندي قبل.",
  where: "مكانه على الخريطة تحت.",
  directions: "الطريق",
  openPlace: "صفحته",
  followLabel: "تبي",
  // The other ways in, from inside the chat: the same answer as a full page,
  // and his voice. The call button's label is WAIN_AI_COPY.callShouq.
  // The line over a question handed to him from شوق, so the chat says where it
  // picked up rather than looking like the visitor typed it.
  fromCall: "من مكالمتك مع شوق",
  fromShouq: "من جواب شوق",
  seeAll: "شوف الكل بالبحث",
  readAloud: "اقرا لي الردود",
} as const;
