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
 */
const DEFAULT_AGENT_ID = "agent_1701m1gcrccrethae9y3nyv1e116";
const OFF = "none";

const configured = process.env.NEXT_PUBLIC_ELEVENLABS_AGENT_ID ?? DEFAULT_AGENT_ID;

export const WAIN_AI_AGENT_ID =
  configured.trim().toLowerCase() === OFF ? "" : configured;

export const WAIN_AI_AGENT_ENABLED = WAIN_AI_AGENT_ID.trim().length > 0;

/**
 * CDN bundle that defines the <elevenlabs-convai> custom element.
 * Pinned to a major version so a supply-chain change upstream cannot silently
 * become part of this page; bump deliberately.
 */
export const WAIN_AI_WIDGET_SRC =
  "https://unpkg.com/@elevenlabs/convai-widget-embed@1";

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
  noSpeech: "ما سمعناك — جرّب مرة ثانية وتكلم بعد الإشارة.",
  unsupported: "متصفحك ما يدعم الإدخال الصوتي — اكتب اللي تبيه.",
  failed: "ما قدرنا نشغّل شوق الحين — جرّب مرة ثانية بعدين.",
} as const;
