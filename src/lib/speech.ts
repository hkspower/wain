"use client";

/**
 * Listening, for both places that listen.
 *
 * شوق's call had the only microphone on the site, inside `WainAiCall` — which
 * meant the page she hands you to could be reached by voice but not used by
 * voice. «The search box is the same brain with typed input», says the comment
 * that sends you there when recognition is missing; that was true in one
 * direction only.
 *
 * The detection and the locale live here because those are the two things that
 * must not differ between the surfaces. A second copy that forgot `ar-KW`
 * would degrade to the browser's UI language and transcribe Kuwaiti Arabic as
 * whatever it thought it heard — a failure that looks like bad recognition
 * rather than a missing line of setup.
 *
 * The orchestration is deliberately NOT here. A call has ring-back, silence
 * timers and six phases; a search box has a mic that fills a text field. One
 * abstraction over both would serve neither.
 */

/** Minimal typings for the vendor-prefixed Web Speech recognition API. */
export interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  /** Fires once the engine is actually listening — which is only after the
   *  microphone has been granted. That is the moment the call connects. */
  onstart: (() => void) | null;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
}

/**
 * Kuwaiti Arabic, not «Arabic».
 *
 * The generic `ar` models lean Modern Standard and hear «وين» as a name. This
 * is the difference between a mic that works in Kuwait and one that looks like
 * it is broken.
 */
export const SPEECH_LANG = "ar-KW";

export function getRecognition(): SpeechRecognitionLike | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  };
  const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  return Ctor ? new Ctor() : null;
}

/** Whether this browser can listen at all — for hiding a mic that cannot work. */
export function canListen(): boolean {
  if (typeof window === "undefined") return false;
  const w = window as unknown as { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown };
  return Boolean(w.SpeechRecognition ?? w.webkitSpeechRecognition);
}

/**
 * Everything the engine has said so far, joined.
 *
 * Space-joined and end-trimmed, which is exactly what the call has always
 * done. Lifting shared code is only safe while it keeps the behaviour that
 * was tested — joining with "" instead would glue the last word of one result
 * segment to the first of the next on the engines that segment mid-utterance,
 * and «قهوة هادية» would arrive as «قهوةهادية» and match nothing.
 */
export function transcriptOf(e: {
  results: ArrayLike<ArrayLike<{ transcript: string }>>;
}): string {
  const parts: string[] = [];
  for (let i = 0; i < e.results.length; i++) parts.push(e.results[i][0]?.transcript ?? "");
  return parts.join(" ").trim();
}
