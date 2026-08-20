/**
 * فهد — the Wain voice assistant.
 *
 * Wain ships as a static export, so there is no server to hold an API key.
 * The ElevenLabs Conversational AI widget handles the microphone, streaming
 * and turn-taking entirely in the browser against an agent you own, which
 * means the only thing this site needs is that agent's public ID.
 *
 * Set NEXT_PUBLIC_ELEVENLABS_AGENT_ID at build time. When it is absent the
 * launcher renders nothing at all, so an unconfigured build simply ships
 * without فهد rather than with a broken button.
 */
export const FAHAD_AGENT_ID = process.env.NEXT_PUBLIC_ELEVENLABS_AGENT_ID ?? "";

export const FAHAD_ENABLED = FAHAD_AGENT_ID.trim().length > 0;

/** CDN bundle that defines the <elevenlabs-convai> custom element. */
export const FAHAD_WIDGET_SRC =
  "https://unpkg.com/@elevenlabs/convai-widget-embed";

export const FAHAD_COPY = {
  name: "فهد",
  role: "دليلك الصوتي",
  launcher: "اسأل فهد",
  greeting: "هلا! أنا فهد. قول لي وين ودك تروح اليوم وأدلّك.",
  hint: "كلّمه عن الجو اللي تبيه — «أبي قهوة هادية» أو «وين أطلع مع العيال؟»",
  loading: "نجهّز فهد…",
  close: "إغلاق",
  micNote: "بيطلب إذن المايك عشان تكلّمه.",
} as const;
