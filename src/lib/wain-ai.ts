import { WAIN_AI_WIDGET_PATH } from "@/lib/widget-src.g";

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
 * Set NEXT_PUBLIC_ELEVENLABS_AGENT_ID at build time to switch on her agent, and
 * NEXT_PUBLIC_ELEVENLABS_SALEM_AGENT_ID to switch on his (see agentIdFor below).
 * When it is absent the button quietly uses local mode instead — an
 * unconfigured build ships with the lesser assistant, not a broken button.
 */
/**
 * شوق's ElevenLabs agent is OFF unless a build asks for it — the live site
 * runs the free call (local mode above), and only staging.wainkw.com builds
 * with the agent. The owner's decision, 2 October, after the account ran out
 * of credits and a phone showed what that does to a live call: the widget
 * mounted inside our sheet, printed «You've run out of credits
 * [quota_exceeded]» in English over our hang-up button, added its
 * «Powered by» line, while our own header said «متصل». A paid service that
 * can run dry is not something to put in front of every visitor by default.
 *
 * This reverses a default that was ON for a reason worth keeping in mind:
 * «a feature that ships switched off by default ships switched off» — the
 * agent existed for weeks while every visitor got the free call because a
 * variable was never set. That is now the intent rather than the accident.
 *
 * To build with her (staging, or a sandbox on a laptop):
 *
 *   NEXT_PUBLIC_ELEVENLABS_AGENT_ID=agent_1701m1gcrccrethae9y3nyv1e116 npm run build
 *
 * Unset, empty or «none» all mean off — `||` against "" so an unset GitHub
 * variable (which arrives as "") cannot switch anything on or off by
 * accident. An agent id is public by construction (a static export hands the
 * widget everything it needs), and the agent is origin-locked to the three
 * wainkw.com hosts, so writing it here costs nothing.
 */
const OFF = "none";

const configured = (process.env.NEXT_PUBLIC_ELEVENLABS_AGENT_ID || OFF).trim();

export const WAIN_AI_AGENT_ID = configured.toLowerCase() === OFF ? "" : configured;

export const WAIN_AI_AGENT_ENABLED = WAIN_AI_AGENT_ID.length > 0;

/**
 * Two agents, never one with a switch.
 *
 * سالم has his own ElevenLabs agent: his own prompt, first message, voice,
 * widget text and overrides. شوق keeps hers. Until 14 October both personas
 * shared شوق's agent, and his voice came from a mid-call `override-voice-id`,
 * so his voice spoke her brain — the mix the owner asked to end.
 *
 * NOTHING falls back from one id to the other. An unset Salem id means /salem
 * and his call take the free path, never her agent, and the reverse holds too.
 * Both ids are public by construction (a static export hands the widget
 * everything it needs), and each agent is origin-locked to the wainkw.com
 * hosts. Unset, empty or «none» all mean off, the same `||` rule as above.
 */
const salemConfigured = (process.env.NEXT_PUBLIC_ELEVENLABS_SALEM_AGENT_ID || OFF).trim();

export const SALEM_AGENT_ID = salemConfigured.toLowerCase() === OFF ? "" : salemConfigured;

export const SALEM_AGENT_ENABLED = SALEM_AGENT_ID.length > 0;

/** Either agent on: the widget bundle is needed and the quota memory applies. */
export const WAIN_AI_ANY_AGENT_ENABLED = WAIN_AI_AGENT_ENABLED || SALEM_AGENT_ENABLED;

/** Whose agent a call or a typed chat reaches. */
export type CallPersona = "shouq" | "salem";

/** The one agent a persona talks to — "" when that agent is off. */
export function agentIdFor(persona: CallPersona): string {
  return persona === "salem" ? SALEM_AGENT_ID : WAIN_AI_AGENT_ID;
}

export function agentEnabledFor(persona: CallPersona): boolean {
  return agentIdFor(persona).length > 0;
}

/**
 * The grammar of what the call's tools say TO the agent on the line.
 *
 * Their sentences are instructions to whoever is speaking, so the second-person
 * forms must be hers or his: «قولي له» and «لا تسكتين» for شوق, «قول له» and
 * «لا تسكت» for سالم. Until 14 October the tools only ever served her, and the
 * feminine forms were simply the forms; with two agents, a reply in her
 * grammar reaches his agent too. `say(fem, masc)` returns the form for the
 * persona on the line.
 */
export function agentSay(persona: CallPersona): (fem: string, masc: string) => string {
  return (fem, masc) => (persona === "salem" ? masc : fem);
}

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
 * The bundle that defines the <elevenlabs-convai> custom element — served from
 * this origin since 2 October, out of node_modules, by scripts/vendor-widget.mjs
 * (which says why, and what the file carries besides the package's bytes).
 *
 * It came from `unpkg.com/@elevenlabs/convai-widget-embed@<version>/dist/index.js`
 * until then, and two things learned there still hold:
 *
 * **The version must be exact.** It said `@1` for months — a semver RANGE on a
 * package that has never published a 1.x — so the <script> failed on every
 * call and the visitor was told the connection was the problem. package.json
 * now pins the devDependency without a caret, and `npm run audit:shouq-call`
 * refuses a range there the way it refused one in the URL.
 *
 * **Nothing at build time used to fetch it**, which is how the broken range
 * survived. Now the build copies the very bytes it was given, and the path
 * carries their hash, so the file a page asks for is the file that shipped.
 *
 * Same origin, so there is nothing left to preconnect: the page's own
 * connection is already open and warm by the time anyone reaches the button.
 * The `integrity` is set on the tag (loadWidget in wain-ai-bus.ts), so a
 * changed file on the server is refused rather than run.
 */
export const WAIN_AI_WIDGET_SRC = WAIN_AI_WIDGET_PATH;

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
  // Under her name on /find's phone (2 October): what she is for, in the
  // place a phone shows who you are calling.
  phoneLine: "تدوّر لك وين تطلع",
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
  back: "رجوع",

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
  // The browser's speech service said no for a reason that is not the
  // microphone: Siri/Dictation switched off, a language it does not have, or
  // an app's built-in browser that never asked the phone for speech. Telling
  // these callers to allow the microphone (which is what they got until
  // 3 October) sends them to a switch that is already on.
  speechOff: "التعرّف على الصوت مو شغّال بهالمتصفح — اكتب لسالم، أو افتح الموقع بسفاري أو كروم.",
  typeToSalem: "اكتب لسالم",
  // The same question, typed, with him — on her answer card and on the call's
  // last screen. Said here once so the two buttons cannot drift apart.
  toSalem: "كمّل مع سالم",
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
  // The agent refused for credits (lib/agent-health.ts). Not «جرّب مرة ثانية»
  // as if the same thing might work: the next dial goes to the free call, our
  // own search, which needs no account — and this says so.
  agentUnavailable: "شوق مو متاحة الحين — اتصل مرة ثانية وأدوّر لك من دليل وين.",
  // The call button's label in سالم's header (ShouqCallButton size="pill").
  callShouq: "كلّم شوق",
} as const;

/**
 * The call sheet's words for سالم. Only the words that name him, or agree with
 * him in gender, differ from شوق's — everything else in WAIN_AI_COPY (the mic
 * messages, the buttons, the widget's own labels) is shared, so the two sheets
 * cannot drift apart on anything that is not theirs. «نوصّلك بسالم» reads the
 * same for both; the masculine verbs are where the forms change.
 */
const SALEM_CALL_COPY = {
  name: SALEM_NAME,
  role: SALEM_ROLE,
  greeting: SALEM_GREETING,
  loading: "نجهّز سالم…",
  answering: "سالم يرد…",
  connectingLine: "نوصّلك بسالم…",
  onTheLine: "على الخط — كلّمه عادي",
  micNote: "يحتاج إذن المايك عشان تكلّمه.",
  callShouq: "كلّم سالم",
  callHint: "اضغط عشان تكلّم سالم",
  callFailed: "ما قدرنا نوصلك بسالم — جرّب مرة ثانية.",
  agentUnavailable: "سالم مو متاح الحين — اتصل مرة ثانية وأدوّر لك من دليل وين.",
} as const;

const SALEM_COPY: Record<keyof typeof WAIN_AI_COPY, string> = { ...WAIN_AI_COPY, ...SALEM_CALL_COPY };

/** The words for one persona's call sheet and launcher. */
export function callCopy(persona: CallPersona): Record<keyof typeof WAIN_AI_COPY, string> {
  return persona === "salem" ? SALEM_COPY : WAIN_AI_COPY;
}

/**
 * Where a question handed to سالم came from: her call, or her written answer
 * on /search. Read by `SalemChat` to say so and to ask it as a NEW question —
 * a handover used to be read against whatever was left of an older chat in
 * this tab, so «شي رخيص» from her became «قهوة رخيص» if the last thing typed
 * to him was about coffee.
 */
export type SalemHandoffFrom = "call" | "shouq";

export function salemHandoff(q: string, from?: SalemHandoffFrom): string {
  const params = new URLSearchParams({ q: q.trim().slice(0, 120) });
  if (from) params.set("from", from);
  return `/salem/?${params.toString()}`;
}

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
  // The provider is not named here, on request (2 October): /privacy names it
  // once, behind «التفاصيل».
  chatNotice: "المحادثة تنحفظ عند مزوّد خدمة الصوت وما تنمسح تلقائياً.",
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
