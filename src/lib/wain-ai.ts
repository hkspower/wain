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
export const WAIN_AI_AGENT_ID = process.env.NEXT_PUBLIC_ELEVENLABS_AGENT_ID ?? "";

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
  holdHint: "اضغطي أو اضغط ٣ ثواني",
  // «قول» not «قل»: the imperative of قال is قول in Kuwaiti and قل in MSA, and
  // شوق is «صوت كويتي شبابي». The two spellings were mixed — «قول وش تبي» two
  // lines down against «قل لي» here — which is the kind of slip that is
  // invisible on screen and unmistakable out loud.
  greeting: "هلا! أنا شوق. قول لي وش تبي — قهوة، بحر، طلعة عيال — وأدلّك.",
  hint: "كلّمها عن الجو اللي تبيه — «أبي قهوة هادية» أو «وين أطلع مع العيال؟»",
  listening: "قول وش تبي…",
  listeningExamples: "«قهوة هادية» · «مطعم للعائلة» · «بحر»",
  processing: "ثواني…",
  loading: "نجهّز شوق…",
  close: "إغلاق",
  micNote: "يحتاج إذن المايك عشان تكلّمها.",
  micDenied: "ما وصلنا صوتك — تأكد إن المايك مسموح للموقع.",
  noSpeech: "ما سمعناك — جرّب مرة ثانية وتكلم بعد الإشارة.",
  unsupported: "متصفحك ما يدعم الإدخال الصوتي — اكتب اللي تبيه.",
  failed: "ما قدرنا نشغّل شوق الحين — جرّب مرة ثانية بعدين.",
} as const;
