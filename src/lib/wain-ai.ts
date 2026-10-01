/**
 * وين AI — the assistant behind the hold-to-talk button.
 *
 * Two ways it can answer, chosen by what is configured:
 *
 * 1. Agent mode — the ElevenLabs Conversational AI widget, speaking as شوق,
 *    a young Kuwaiti woman's voice. Wain ships as a static export with no
 *    server to hold an API key, so the widget does the microphone, streaming
 *    and turn-taking entirely in the browser against an agent you own; the
 *    only thing the site needs is that agent's public ID. The agent drives
 *    the map through a client tool (see WainAi.tsx) — when it recommends
 *    places it can put them in front of the visitor, not just say them.
 *
 * 2. Local mode — no agent configured yet. The browser's own Arabic speech
 *    recognition takes the question, وين's local search engine answers it,
 *    and صوت وين reads the best result aloud in شوق's voice. Fully offline
 *    logic, nothing configured, works today.
 *
 * Set NEXT_PUBLIC_ELEVENLABS_AGENT_ID at build time to switch on agent mode.
 * When it is absent the button quietly uses local mode instead — an
 * unconfigured build ships with the lesser assistant, not a broken button.
 */
/**
 * شوق's agent, built and configured — see docs/wain-ai-agent.md.
 *
 * A default rather than a variable somebody has to remember, because this was
 * the whole reason the call was not a call: the agent existed, the brief was
 * written, the client tools were registered, and every visitor still got the
 * browser's one-question speech recognition because a build-time variable was
 * never set. A feature that ships switched off by default ships switched off.
 *
 * Safe to hard-code, and not a decision taken lightly. An agent id is public
 * by construction: this is a static export, so whatever the widget needs to
 * open a session reaches the browser and can be read off the page. What stops
 * a copied id being used elsewhere is not secrecy — it is that the agent is
 * origin-locked to wainkw.com (require_origin_header plus an allowlist), which
 * is a control that keeps working after the id is public.
 *
 * NEXT_PUBLIC_ELEVENLABS_AGENT_ID still overrides — point a build at a staging
 * agent, or write «none» to ship the browser-speech fallback instead.
 *
 * «none» rather than an empty string, because an empty repository variable and
 * an unset one are the same thing to GitHub Actions: both arrive as "". With
 * only the empty check there was no way to turn شوق off from CI at all, and
 * the off switch matters most on the day she says something wrong on the live
 * site and the owner needs it without waiting for a commit.
 *
 * `||` and not `??`, and the difference is the whole point of the paragraph
 * above. `??` falls back only on null/undefined, so an empty string — which is
 * exactly what `${{ vars.ELEVENLABS_AGENT_ID }}` expands to when the variable
 * has never been set — came through as the id itself and switched شوق OFF. The
 * default beside it was written to stop precisely that, and could not: it was
 * unreachable from CI, which is the only place that sets this at all.
 *
 * Worse, it was unreachable *silently*. deploy.yml prints «شوق: agent mode
 * (built-in default)» for an empty AGENT, so the run log said she was on while
 * the bundle it had just built had her off. Nothing else looks. `||` makes the
 * comment above true: unset or empty → the default, «none» → off.
 */
const DEFAULT_AGENT_ID = "agent_1701m1gcrccrethae9y3nyv1e116";
const OFF = "none";

const configured = process.env.NEXT_PUBLIC_ELEVENLABS_AGENT_ID || DEFAULT_AGENT_ID;

export const WAIN_AI_AGENT_ID =
  configured.trim().toLowerCase() === OFF ? "" : configured;

export const WAIN_AI_AGENT_ENABLED = WAIN_AI_AGENT_ID.trim().length > 0;

/**
 * سالم's voice — for the mid-call switch below, and ONLY for that. It
 * briefly had a second use, `/salem`'s typed chat, and the whole detour is
 * worth recording rather than quietly undone.
 *
 * `/salem` went through two framing mistakes in one session, each corrected
 * on being asked rather than caught by any check here. First: a design
 * canvas explored سالم as a full second CHARACTER, this repository twice
 * ruled that out — «Two choices, not three» in CLAUDE.md — and then,
 * reversing that, `/salem` shipped as if he WERE one: his own name, his own
 * greeting, his own photo, his own headline on `/find`, `SALEM_VOICE_ID` set
 * as a live `tts.voice_id` override. Nothing about the agent backing it had
 * changed to match — still شوق's prompt, still her tools, still her
 * first-person FEMININE grammar throughout, including a `first_message` that
 * says «أنا شوق» — so the first real reply on his own page would have
 * contradicted the page around it. Caught by pulling the live agent config
 * directly and reading what she actually says, not by assuming the plumbing
 * settled the framing question.
 *
 * First correction kept the voice switch and fixed only the naming: her name
 * and photo in the header, «بصوت سالم» as a badge in the exact words
 * `WAIN_AI_COPY.switchToSalem` already uses for the mid-call button, not a
 * second name. Asked directly afterwards to go further — keep her voice,
 * don't change it — and that is what shipped: `lib/salem-chat.ts` sends no
 * `tts` override at all now, `/salem` and `/find`'s typing half read
 * `WAIN_AI_COPY` only, and this file has no second export for `/salem` to
 * import. `SALEM_VOICE_ID` is back to describing exactly one thing, below.
 *
 * Same id `scripts/gen-voice.mjs` and the live TTS bridge
 * (`scripts/publish/tts-endpoint.php`) already use for him — Eid, Gulf male —
 * so a voice heard on a call and a recorded سالم clip elsewhere are the same
 * speaker, the same rule `docs/voice.md`'s three-way table holds the clips
 * and the bridge to.
 *
 * Only the VOICE changes when this is applied. The brain, the tools, her name
 * in the call sheet — all still شوق's. Conversational AI negotiates a
 * session's voice once, at connect: the widget bundle does expose an
 * `override-voice-id` attribute (verified by extracting
 * @elevenlabs/convai-widget-embed and reading it — elevenlabs.io itself is
 * blocked from this repository's own egress, so the published bundle was the
 * only source available), but it is read into the conversation's *initial*
 * overrides, and nothing in that bundle suggests a value change reaches an
 * already-open session. So "switching" — see WainAiCall — means dropping the
 * current `<elevenlabs-convai>` element and mounting a fresh one with this
 * attribute set, not a live hot-swap mid-sentence.
 *
 * The agent has to PERMIT the override, and for its first days it did not:
 * `platform_settings.overrides.conversation_config_override.tts.voice_id` was
 * `false`, so the reconnect carried an override the agent's own config
 * refuses, and the tap meant to hand the caller to سالم could only end their
 * call. Nothing in this repository can see that setting — it lives on the
 * agent — so it is written here, beside the one line that depends on it.
 * Enabled 27 September. Only `voice_id` is open; model, stability and speed
 * stay locked to the agent's own values.
 *
 * Third pass, on request 30 September: his identity is back — his name, his
 * own portrait (`public/find/salem.jpg`/`salem-face.jpg`, regenerated; the
 * originals were deleted along with the second correction), and this file's
 * `tts.voice_id` override reinstated in `lib/salem-chat.ts`. Asked directly,
 * with the first two corrections' reasoning read back in full first — the
 * agent behind `/salem` is still شوق's, unchanged, first-person feminine
 * grammar throughout, `first_message` still «أنا شوق» — and asked to proceed
 * anyway. That fact does not change here: what shipped is his name and his
 * voice over what she says, not a rewritten prompt. The one thing no session
 * can fix without touching the live agent itself is the transcript's own
 * first line, which still reads «أنا شوق» regardless of the header above it.
 * Recorded so the next person does not read this as the tension having been
 * resolved — it has been accepted, on request, not solved.
 */
export const SALEM_VOICE_ID = "Ywuz3KyW2N5pqKNpwcCL"; // Eid — Gulf male, warm and clear

/**
 * سالم's own display identity — his name and role line, matching the shape
 * `WAIN_AI_COPY.name`/`.role` already hold for شوق. Kept separate rather than
 * folded into `WAIN_AI_COPY` because `WAIN_AI_COPY` is still hers — the phone
 * call in `WainAiCall.tsx` never changes identity, only its voice — and a
 * shared object would make it too easy for a future edit to retarget her own
 * surfaces at his name by mistake. `role` is the masculine form of hers
 * («دليلتك» → «دليلك»): the ة in «دليلة» marks the GUIDE's own gender, not
 * the visitor's — شوق is «دليلتك», a female guide, and سالم is «دليلك», a
 * male one, both still addressing the same «you» either way.
 */
export const SALEM_NAME = "سالم";
export const SALEM_ROLE = "دليلك في الكويت";
/**
 * /find's invitation line for his half — not a transcript claim, so it does
 * not carry the same risk `SalemChat.tsx`'s own greeting choice does. /find
 * is the choice screen; nobody reading this card is mid-conversation with
 * the agent yet, so a self-introduction here is marketing copy about what
 * the tap leads to, the same way the call half's `WAIN_AI_COPY.greeting`
 * already is. Same sentence as hers, one word changed — same character,
 * same offer, only the name at the front.
 */
export const SALEM_GREETING = "هلا! أنا سالم. قول لي وش تبي — قهوة، بحر، طلعة عيال — وأدلّك.";

/**
 * CDN bundle that defines the <elevenlabs-convai> custom element.
 *
 * THE VERSION MUST BE EXACT, AND THAT IS NOT A STYLE PREFERENCE.
 *
 * This said `@1` for months, described as «pinned to a major version so a
 * supply-chain change upstream cannot silently become part of this page». Both
 * halves were wrong. `@1` is a semver RANGE, so any 1.x would have been taken
 * silently — and there has never been a 1.x. The registry published 79
 * versions of this package then, 0.1.0 through 0.18.1, and still no 1.x on
 * 1 October, when `latest` was the 0.18.3 pinned below. A
 * range that matches nothing cannot resolve, so the <script> failed on every
 * call: `onerror` → `agentFailed` → «ما قدرنا نوصلك بشوق». Agent mode was
 * unreachable, every time, and the fallback text blamed the connection.
 *
 * It reads as a slow or flaky call rather than a broken URL, which is why it
 * survived: nothing here fetches it at build time, and no test could see it.
 * `npm run audit:shouq-call` now refuses a range — that is the check that
 * would have caught this on the day it was written.
 *
 * The full path is spelled out for a second reason. `unpkg.com/<pkg>@<version>`
 * answers 302 to the package's `unpkg`/`main` entry, and a range answers 302 to
 * the resolved version first — two redirects on the critical path of a call, on
 * a phone, before 451KB of widget starts arriving. Naming `dist/index.js`
 * (which IS this package's `unpkg` field) makes it one request.
 *
 * Bump deliberately, and re-run the audit: it checks the registry for the exact
 * version and for the entry path when it can reach it.
 */
export const WAIN_AI_WIDGET_SRC =
  "https://unpkg.com/@elevenlabs/convai-widget-embed@0.18.3/dist/index.js";

/**
 * Origin of the above, warmed before a tap.
 *
 * Deliberately warmed WITHOUT `crossorigin`, because the widget arrives on a
 * plain `<script src>` — a no-CORS request. A preconnect that carries
 * `crossorigin` opens a different entry in the connection pool, so the script
 * would ignore the socket and open a second one: the classic way to make a
 * preconnect cost a connection instead of saving one.
 */
export const WAIN_AI_WIDGET_ORIGIN = "https://unpkg.com";

/**
 * Where the widget goes once it has loaded, warmed at the same moment.
 *
 * Read out of the published bundle rather than guessed: `dist/index.js` names
 * `https://api.elevenlabs.io` and `wss://api.elevenlabs.io` as its defaults.
 * This one IS warmed with `crossorigin` — its fetches are CORS.
 *
 * It matters because the two round trips are otherwise strictly serial: the
 * CDN, then the bundle, then a cold DNS+TLS to ElevenLabs, and only then does
 * anything ring. Warming both at the first sign of interest overlaps them with
 * the visitor's own reaction time.
 */
export const WAIN_AI_API_ORIGIN = "https://api.elevenlabs.io";

export const WAIN_AI_COPY = {
  name: "شوق",
  role: "دليلتك في الكويت",
  launcher: "وين AI",
  /**
   * The button is a call button now, and the label says so.
   *
   * It used to say «اضغطي أو اضغط ٣ ثواني» — hold three seconds — because a
   * voice session seizes the microphone and the audio output, and that is too
   * much for a pocket-tap. The call replaces that guard with a better one: the
   * tap opens a call that is *ringing*, and hanging up is one tap away, which
   * is exactly how every phone anyone owns already behaves. Nobody has to be
   * taught it, and nothing is seized before they can stop it.
   */
  callHint: "اضغط عشان تكلّم شوق",
  // The written half's own hint, same register as callHint above — /find's
  // اكتب half had no line under its button while اتصال's always did, which
  // read as the two halves carrying different amounts of care. «وياه» not
  // «وياها»: the half names سالم now, not شوق — see SALEM_NAME above.
  typeHint: "اكتب عشان تدردش وياه",
  // «قول» not «قل»: the imperative of قال is قول in Kuwaiti and قل in MSA, and
  // شوق is «صوت كويتي شبابي». The two spellings were mixed — «قول وش تبي» two
  // lines down against «قل لي» here — which is the kind of slip that is
  // invisible on screen and unmistakable out loud.
  /**
   * Shown while the call rings — the seconds when there is nothing to hear yet
   * and nothing to do. It says what she is for, so the visitor knows what to
   * say the moment she picks up instead of working it out on the line.
   */
  greeting: "هلا! أنا شوق. قول لي وش تبي — قهوة، بحر، طلعة عيال — وأدلّك.",
  listening: "قول وش تبي…",
  listeningExamples: "«قهوة هادية» · «مطعم للعائلة» · «بحر»",
  loading: "نجهّز شوق…",
  close: "إغلاق",

  // ---- the call ----------------------------------------------------------
  centre: "مركز اتصال وين",
  ringing: "يرن…",
  onCall: "متصل",
  answering: "شوق ترد…",
  hangUp: "إنهاء المكالمة",
  callAgain: "اتصل مرة ثانية",
  // Named as a VOICE change, deliberately not «كلّمي سالم» — it is still شوق
  // answering, her brain and her tools untouched; only the TTS voice reading
  // her replies changes. Calling it a different agent would be a promise this
  // button does not keep.
  /**
   * What she just did to the screen behind the call sheet.
   *
   * Past tense and first person — she is the one who did it, and it has
   * already happened, so «تبحث…» would be a spinner for work that is over.
   * Deliberately no «شوف» link beside it: the page is already showing it, and
   * hanging up is the one control that reveals it.
   */
  didSearch: "دوّرت لك",
  didOpen: "فتحت لك صفحة",
  // The search BEFORE it lands (opening a place has nothing to await). The sheet used to say nothing until
  // the search index had loaded and the route had changed, so a caller heard
  // her say «حطيتهم على الخريطة» over a sheet that still showed nothing.
  // Present tense and honest: it is our own handler running, not a guess at
  // what she is doing.
  searching: "أدوّر لك على",
  // A tool call that changed nothing on the screen — said so the sheet never
  // contradicts what she tells the caller.
  noPlace: "ما لقيت هالمكان",
  // Agent mode, after Start: she is the one who speaks first (her greeting), so
  // «قول وش تبي…» told the caller to talk over her. This says the line is open
  // without asking for anything.
  onTheLine: "على الخط — كلّمها عادي",
  // The ringing headline said «يرن…» in the same breath as the header. The
  // header owns that word; this says what the seconds are being spent on.
  connectingLine: "نوصّلك بشوق…",
  // 15 seconds on the ready screen with Start unpressed: the widget's own
  // button is the only way forward and nothing else on the sheet can press it.
  startNudge: "للحين ما بدأت المكالمة — اضغط «بدء مكالمة» تحت.",
  switchToSalem: "🔊 بصوت سالم",
  switchToShouq: "🔊 بصوت شوق",
  ended: "انتهت المكالمة",
  callFailed: "ما قدرنا نوصلك بشوق — جرّب مرة ثانية.",
  // A call that rang out. Said separately from callFailed because the caller
  // can usually fix this one: the microphone prompt is often still waiting.
  noAnswer: "طوّلنا نرن وما وصلنا — تأكد إنك سمحت بالمايك وجرّب مرة ثانية.",
  // Deliberately no mute button. In agent mode the microphone belongs to the
  // ElevenLabs widget and this component cannot honestly switch it off, so a
  // mute control would work on one path and lie on the other. Hanging up is
  // unambiguous on both.
  micNote: "يحتاج إذن المايك عشان تكلّمها.",
  micDenied: "ما وصلنا صوتك — تأكد إن المايك مسموح للموقع.",
  // Agent mode: the widget is on the sheet but has not started a call yet, so
  // the sheet must not say «متصل». «بدء مكالمة» is quoted exactly as it reads
  // on the widget's own button (the agent's start_call text) — a caller
  // matches the words on the screen, not a paraphrase of them.
  readyToStart: "جاهزة — اضغط «بدء مكالمة»",
  pressStart: "اضغط «بدء مكالمة» تحت، وسمّح للمايك، وبعدها قول وش تبي",
  // The two microphone failures the browser names precisely. Same job as
  // micDenied above: turn a silent «she never heard me» into a sentence.
  noMic: "ما لقينا مايك في جهازك — وصّل مايك وجرّب مرة ثانية.",
  micBusy: "المايك مشغول في تطبيق ثاني — سكّره وجرّب مرة ثانية.",
  noSpeech: "ما سمعناك — جرّب مرة ثانية وتكلم بعد الإشارة.",
  unsupported: "متصفحك ما يدعم الإدخال الصوتي — اكتب اللي تبيه.",
  failed: "ما قدرنا نشغّل شوق الحين — جرّب مرة ثانية بعدين.",
} as const;

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
  notConfigured: "المحادثة مو متاحة الحين.",
} as const;

/**
 * What happens to a conversation once it has happened, said once because it
 * is said in three places: the line over the typed chat's box, the privacy
 * page, and — in the same words — the Flutter app.
 *
 * Read off the live agent's `platform_settings.privacy` with `agents_get` on
 * 1 October: `record_voice: true`, `retention_days: -1`, `delete_audio` and
 * `delete_transcript_and_pii` both false, topic discovery and sentiment
 * analysis on. So calls are recorded and calls and typed chats are kept with
 * no expiry — and the app's privacy screen said «ما نسجّل المكالمة». The
 * owner chose to keep the settings and say so. **If any of those settings
 * changes, this wording changes in the same sitting**: re-read the agent
 * first, never this comment.
 */
export const WAIN_AI_RECORDING = {
  chatNotice: "المحادثة تنحفظ عند ElevenLabs وما تنمسح تلقائياً.",
  chatNoticeLink: "التفاصيل",
} as const;

/**
 * «N places matched», agreeing, for the sentence she is handed after a search
 * — by the call and by the typed chat alike, so the two cannot drift.
 *
 * It was `${total} أماكن مطابقة` for every total above one — «40 أماكن», with
 * Latin digits — which is the hand-written plural place-kit's `countAr` exists
 * to stop. The adjective agrees too: «مكان مطابق», not «مكان مطابقة». The call
 * was fixed first and the chat kept the old line, with a test pinning
 * «أماكن مطابقة» for two; both read this now.
 */
export const MATCHING_PLACES = {
  one: "مكان واحد مطابق",
  two: "مكانين مطابقين",
  few: "أماكن مطابقة",
  many: "مكان مطابق",
} as const;
